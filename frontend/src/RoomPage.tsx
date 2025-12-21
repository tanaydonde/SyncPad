import { useEffect, useRef, useState, useMemo } from "react";
import { useParams } from "react-router-dom";
import "katex/dist/katex.min.css";
import katex from "katex";
import { useNavigate } from "react-router-dom";

import * as Y from 'yjs';

function u8ToB64(u8: Uint8Array): string {
  let s = "";
  for(let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}

function b64ToU8(b64: string): Uint8Array {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

function findDiff(prev: string, cur: string) {
  if(prev === cur) return null;

  let start = 0;
  const prevLen = prev.length;
  const curLen = cur.length;

  while(start < prevLen && start < curLen && prev[start] === cur[start]){
    start++;
  }

  let endPrev = prevLen-1;
  let endCur = curLen-1;
  while(endPrev >= start && endCur >= start && prev[endPrev] === cur[endCur]) {
    endPrev--;
    endCur--;
  }

  const deleteCount = Math.max(0, endPrev - start + 1);
  const insertText = cur.slice(start, endCur + 1);
  
  return {start, deleteCount, insertText};
}

function escapeHtml(s: string) {
  return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function renderLatexMixed(input: string) {
  let html = escapeHtml(input)

  //for $$ ... $$ (centers it)
  html = html.replace(/\$\$([\s\S]+?)\$\$/g, (_, expr) => {
    return katex.renderToString(String(expr).trim(), {
      displayMode: true,
      throwOnError: false,
    });
  });


  //for $ ... $ 
  html = html.replace(/\$([^\n$]+?)\$/g, (_, expr) => {
    return katex.renderToString(String(expr).trim(), {
      displayMode: false,
      throwOnError: false,
    });
  });

  html = html.replace(/\n/g, "<br/>");
  return html;
}

type RemoteCursor = { start: number, end: number, ts: number};

type CaretRect = { x: number; y: number; h: number };

type HighlightRect = { x: number, y : number, w: number, h: number};

function getTextNodeAndOffset(root: HTMLElement, index: number) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode() as Text | null;
    let remaining = index;

    while(node) {
        let length = node.nodeValue?.length ?? 0;
        if(remaining <= length) return {node, offset: remaining};
        remaining -= length;
        node = walker.nextNode() as Text | null;
    }

    const t = document.createTextNode(root.textContent ?? "");
    root.textContent = "";
    root.appendChild(t);
    return { node: t, offset: Math.min(index, t.nodeValue?.length ?? 0)};
}

function caretRectFromIndex(root: HTMLElement, index: number): CaretRect | null {
    const { node, offset } = getTextNodeAndOffset(root, index);
    const range = document.createRange();
    range.setStart(node, offset);
    range.setEnd(node, offset);
    let rect = range.getClientRects()[0];
    
    if (!rect) {
        const next = Math.min(offset + 1, node.nodeValue?.length ?? offset);
        if (next !== offset) {
            range.setEnd(node, next);
            rect = range.getClientRects()[0];
        }
    }
    if (!rect) return null;

    const rootRect = root.getBoundingClientRect();

    return {x: rect.left - rootRect.left,
        y: rect.top - rootRect.top,
        h: rect.height || 16
    }
}

function getHighlightRects(root: HTMLElement, startIdx: number, endIdx: number): HighlightRect[] {
    const start = getTextNodeAndOffset(root, startIdx);
    const end = getTextNodeAndOffset(root, endIdx);

    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);

    const rootRect = root.getBoundingClientRect();
    const rects = Array.from(range.getClientRects());

    return rects.map((r) => ({
        x: r.left - rootRect.left,
        y: r.top - rootRect.top,
        w: r.width,
        h: r.height || 16,
    })).filter((r) => r.w > 0 && r.h > 0)
}

function colorFromId(id: string) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return `hsl(${h % 360}, 70%, 45%)`;
}

function labelFromId(id: string) {
    return `User ${id.slice(-4)}`;
}

export default function RoomPage() {
  const navigate = useNavigate();

  const {roomId} = useParams();
  const room = roomId ?? "default"

  const [text, setText] = useState("");
  const [status, setStatus] = useState("disconnected");
  const wsRef = useRef<WebSocket | null>(null);

  const [copied, setCopied] = useState(false);
  const [users, setUsers] = useState(0);

  const editorRef = useRef<HTMLDivElement | null>(null);

  const shareLink = useMemo(() => `${window.location.origin}/room/${encodeURIComponent(room)}`, [room]);

  const clientId = useMemo(() => {
    const key = "syncpad_client_id";
    let id = sessionStorage.getItem(key);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(key, id);
    }
    return id;
  }, []);

  const [remoteCursors, setRemoteCursors] = useState<Record<string, RemoteCursor>>({});
  const [remoteRects, setRemoteRects] = useState<Record<string, CaretRect>>({});
  const [remoteHighlights, setRemoteHighlights] = useState<Record<string, HighlightRect[]>>({});

  const ydocRef = useRef<Y.Doc | null>(null);
  const ytextRef = useRef<Y.Text | null>(null);

  const lastTextRef = useRef<string>("");
  const lastStateSentRef = useRef(0);

  useEffect(() => {
    let closedByCleanup = false;
    let retryTimer: number | null = null;
    let attempt = 0;

    const connect = () => {
      const WS_BASE = import.meta.env.VITE_WS_BASE ?? `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.hostname}:8080`;

    const ws = new WebSocket(`${WS_BASE}/ws?room=${encodeURIComponent(room)}`);
      wsRef.current = ws;

      ws.onopen = () => {
        attempt = 0;
        setStatus("connected");
        sendCursorNow();

        const doc = ydocRef.current;
        if (!doc) return;

        const onUpdate = (update: Uint8Array, origin: any) => {
          if(origin !== "local") return;
          if (ws.readyState !== WebSocket.OPEN) return;
          
          //regular updates
          ws.send(JSON.stringify({type: "y_update", clientId, update: u8ToB64(update)}));

          //full snapshot
          const full = Y.encodeStateAsUpdate(doc);
          ws.send(JSON.stringify({ type: "y_state", clientId, state: u8ToB64(full) }));
          
        }

        doc.on("update", onUpdate);

        const cleanup = () => {
          doc.off("update", onUpdate);
        };

        ws.addEventListener("close", cleanup, { once: true });
      }

      ws.onmessage = (event) => {
        const msg = JSON.parse(String(event.data));

        if(msg.type === "presence") {
          setUsers(msg.count);
          return;
        }
        
        if(msg.type === "y_sync") {
          const doc = ydocRef.current;
          if (!doc) return;

          if (msg.state) {
            const update = b64ToU8(msg.state);
            Y.applyUpdate(doc, update, "remote");
          }
          return;
        }

        if(msg.type === "y_update" && msg.clientId !== clientId) {
          const doc = ydocRef.current;
          if (!doc) return;

          if (msg.update) {
            const update = b64ToU8(msg.update);
            Y.applyUpdate(doc, update, "remote");
          }
          return;
        }

        if(msg.type === "cursor" && msg.clientId !== clientId) {
          setRemoteCursors(prev => ({
            ...prev,
            [msg.clientId]: {start: msg.start, end: msg.end, ts: Date.now()}
          }));
          return;
        }
      }

      const scheduleReconnect = () => {
        if (closedByCleanup) return;

        setStatus("reconnecting");

        // backoff: 250ms, 500ms, 1s, 2s, 4s, 5s...
        const delay = Math.min(5000, 250 * Math.pow(2, attempt));
        attempt++;

        retryTimer = window.setTimeout(() => {
          connect();}, delay);
      };

      ws.onclose = scheduleReconnect;

      ws.onerror = () => {
        setStatus("error");
        try{
          ws.close();
        } catch {}
      }
    };

    connect();

    return () => {
      closedByCleanup = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };

  }, [room, clientId]);

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;

    const domText = el.textContent ?? "";
    if (domText !== text) {
      el.textContent = text;
    }
  }, [text]);

  useEffect(() => {
    const el = editorRef.current;
    if(!el) return;

    const time = Date.now();
    const ttl = 5000;

    const W = 500;
    const H = 350;

    const nextCarrets: Record<string, CaretRect> = {};
    const nextHighlights: Record<string, HighlightRect[]> = {};

    for(const [id, c] of Object.entries(remoteCursors)) {
        if(time - c.ts >= ttl) continue;

        if(c.start !== c.end ) {
            const rects = getHighlightRects(el, c.start, c.end).filter(r => 
              r.x + r.w > 0 && r.x < W && r.y + r.h > 0 && r.y < H
            );
            if (rects.length) nextHighlights[id] = rects;
        }
        else{
            const r = caretRectFromIndex(el, c.start);
            if(r && r.x + 2 > 0 && r.x < W && r.y + r.h > 0 && r.y < H) nextCarrets[id] = r;
        }
    }

    setRemoteHighlights(nextHighlights);
    setRemoteRects(nextCarrets);
  }, [remoteCursors, text])

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;

    const onScroll = () => {
        setRemoteCursors((prev) => ({ ...prev }));
    };

    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, [])

  useEffect(() => {
    const ttl = 5000
    const interval = window.setInterval(() => {
        const time = Date.now();
        setRemoteCursors(prev => {
            let changed = false;
            const next: Record<string, RemoteCursor> = {};
            for(const [id, c] of Object.entries(prev)) {
                if(time - c.ts < ttl) next[id] = c;
                else changed = true;
            }
            return changed ? next : prev;
        });
    }, 1000);

    return () => window.clearInterval(interval);
  }, [])

  useEffect(() => {
    const doc = new Y.Doc();
    const ytext = doc.getText("content");

    ydocRef.current = doc;
    ytextRef.current = ytext;

    const onChange = () => {
      const s = ytext.toString();
      lastTextRef.current = s;
      setText(s);
    };

    ytext.observe(onChange);

    onChange();

    return () => {
      ytext.unobserve(onChange);
      doc.destroy();
      ydocRef.current = null;
      ytextRef.current = null;
    };

  }, [])

  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || status !== "connected") return;

    const tick = () => {
        if (document.visibilityState === "visible") {
            sendCursorNow();
        }
    };

    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
    
  }, [status, room, clientId]);

  async function copyLink() {
    try{
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      alert("Could not copy. Copy from the address bar.");
    }
  }

  const cursorTimerRef = useRef<number | null>(null);

  function getSelectionRangeInEditor(): { start: number; end: number } | null {
    const el = editorRef.current;
    if (!el) return null;

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;

    const range = sel.getRangeAt(0);

    if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return null;

    const preStart = document.createRange();
    preStart.selectNodeContents(el);
    preStart.setEnd(range.startContainer, range.startOffset);
    const start = preStart.toString().length;

    const preEnd = document.createRange();
    preEnd.selectNodeContents(el);
    preEnd.setEnd(range.endContainer, range.endOffset);
    const end = preEnd.toString().length;

    return { start, end };
  }

  function sendCursorNow() {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const r = getSelectionRangeInEditor();
    if (!r) return;

    ws.send(JSON.stringify({
      type: "cursor",
      clientId,
      start: r.start,
      end: r.end,
    }));
  }

  function scheduleSendCursor() {
    if(cursorTimerRef.current !== null) return;

    cursorTimerRef.current = window.setTimeout(() => {
      cursorTimerRef.current = null;
      sendCursorNow();
    }, 40);
  }

  function syncAndBroadcast(){
    const el = editorRef.current;
    const doc = ydocRef.current;
    const ytext = ytextRef.current;
    if (!el || !doc || !ytext) return;

    const cur = el.textContent ?? "";
    const prev = lastTextRef.current;

    const d = findDiff(prev, cur);
    if(!d) {
      scheduleSendCursor();
      return;
    }

    doc.transact(() => {
      if(d.deleteCount > 0) ytext.delete(d.start, d.deleteCount);
      if(d.insertText.length > 0) ytext.insert(d.start, d.insertText);
    }, "local")

    scheduleSendCursor();
  }
  function execWithFallback(exec: () => void) {
    exec();

    requestAnimationFrame(() => {
      const el = editorRef.current;
      if (!el) return;

      const domText = el.textContent ?? "";
      if (domText !== lastTextRef.current) syncAndBroadcast();
    })
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        width: "100vw",
        background: "#1f1f1f",
        color: "#eaeaea",
        display: "flex",
        justifyContent: "center",
        padding: 40,
        boxSizing: "border-box",
      }}
    >
      <div style={{ width: 1030}}>
        <div style={{ textAlign: "center", marginBottom: 18 }}>
          <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: 0.3 }}>
            Room {room}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            marginBottom: 14,
            padding: "10px 12px",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 10,
            background: "rgba(255,255,255,0.04)",
          }}
        >
          <button
            onClick={() => navigate("/")}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.15)",
              background: "rgba(255,255,255,0.06)",
              color: "#eaeaea",
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            Home
          </button>
          
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                background: "rgba(255,255,255,0.08)",
                fontSize: 13,
              }}
            >
              Status: <span style={{ fontWeight: 600 }}>{status}</span>
            </span>

            <span
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                background: "rgba(255,255,255,0.08)",
                fontSize: 13,
              }}
            >
              Users: <span style={{ fontWeight: 600 }}>{users}</span>
            </span>
          </div>

          <button
            onClick={copyLink}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.18)",
              background: copied ? "rgba(34,197,94,0.18)" : "rgba(255,255,255,0.08)",
              color: "#eaeaea",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            {copied ? "Copied!" : "Copy link"}
          </button>
        </div>

        <div style={{
          display: "flex", 
          gap: 30,
          justifyContent: "center",
          alignItems: "flex-start",
          flexWrap: "wrap",
        }}>
          <div style={{ flex: "0 0 auto" }}>
            <div style={{ marginBottom: 8, fontSize: 12, opacity: 0.8 }}>Editor</div>

            <div style={{ position: "relative", width: 500, height: 350 }}>
              <div
                ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                style={{
                  width: 500,
                  height: 350,
                  border: "1px solid rgba(255,255,255,0.18)",
                  borderRadius: 12,
                  padding: 12,
                  overflow: "auto",
                  whiteSpace: "pre-wrap",
                  outline: "none",
                  background: "rgba(255,255,255,0.03)",
                  color: "#eaeaea",
                  boxShadow: "0 10px 28px rgba(0,0,0,0.35)",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                  fontSize: 14,
                  lineHeight: 1.5,
                  boxSizing: "border-box",
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    execWithFallback(() => document.execCommand("insertLineBreak"));
                  }
                }}
                onPaste={(e) => {
                  e.preventDefault();
                  const plain = e.clipboardData.getData("text/plain");
                  execWithFallback(() => document.execCommand("insertText", false, plain));
                }}
                onMouseUp={scheduleSendCursor}
                onKeyUp={scheduleSendCursor}
                onMouseDown={scheduleSendCursor}
                onInput={syncAndBroadcast}
              />

              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  width: 500,
                  height: 350,
                  pointerEvents: "none",
                }}
              >
                {Object.entries(remoteHighlights).flatMap(([id, rects]) =>
                  rects.map((r, i) => (
                    <div
                      key={`${id}-hl-${i}`}
                      title={labelFromId(id)}
                      style={{
                        position: "absolute",
                        left: r.x,
                        top: r.y,
                        width: r.w,
                        height: r.h,
                        background: colorFromId(id),
                        opacity: 0.22,
                        borderRadius: 3,
                      }}
                    />
                  ))
                )}

                {Object.entries(remoteRects).map(([id, r]) => (
                  <div
                    key={id}
                    title={labelFromId(id)}
                    style={{
                      position: "absolute",
                      left: r.x,
                      top: r.y,
                      width: 2,
                      height: r.h,
                      background: colorFromId(id),
                      borderRadius: 2,
                    }}
                  />
                ))}
              </div>
            </div>
          </div>

          <div style={{ flex: "0 0 auto" }}>
            <div style={{ marginBottom: 8, fontSize: 12, opacity: 0.8 }}>Preview</div>

            <div
              style={{
                width: 500,
                height: 350,
                border: "1px solid rgba(0,0,0,0.12)",
                borderRadius: 12,
                padding: 12,
                overflow: "auto",
                whiteSpace: "pre-wrap",
                background: "#ffffff",
                color: "#111827",
                boxShadow: "0 10px 28px rgba(0,0,0,0.28)",
                fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
                fontSize: 15,
                lineHeight: 1.6,
              }}
              dangerouslySetInnerHTML={{ __html: renderLatexMixed(text) }}
            />
          </div>
        </div>

        {/* Optional: tiny footer tip */}
        <div style={{ marginTop: 14, fontSize: 12, opacity: 0.7, textAlign: "center" }}>
          Use <span style={{ fontFamily: "ui-monospace" }}>$x^2$</span> for math, or{" "}
          <span style={{ fontFamily: "ui-monospace" }}>$\text{"{hello}"}$</span> for words.
        </div>
      </div>
    </div>
  );
}