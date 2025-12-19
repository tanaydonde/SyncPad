import { useEffect, useRef, useState, useMemo } from "react";
import { useParams } from "react-router-dom";

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

  useEffect(() => {
    let closedByCleanup = false;
    let retryTimer: number | null = null;
    let attempt = 0;

    const connect = () => {
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${window.location.hostname}:8080/ws?room=${encodeURIComponent(room)}`);
      wsRef.current = ws;

      ws.onopen = () => {
        attempt = 0;
        setStatus("connected");
        ws.send(JSON.stringify({ type: "cursor_request", clientId }));
        sendCursorNow();
      }

      ws.onmessage = (event) => {
        const msg = JSON.parse(String(event.data));

        if(msg.type === "presence"){
          setUsers(msg.count)
        } else if(msg.type === "doc" && msg.clientId !== clientId) {
          setText(msg.text);
        } else if(msg.type == "cursor" && msg.clientId !== clientId) {

          setRemoteCursors(prev => ({
            ...prev,
            [msg.clientId]: {start: msg.start, end: msg.end, ts: Date.now()}
          }));
        } else if(msg.type === "cursor_request" && msg.from !== clientId) {
            sendCursorNow();
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

    const W = 650;
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
    if (!el) return;

    const newText = el.textContent ?? "";
    
    if(newText === text) {
      scheduleSendCursor();
      return;
    }
    
    setText(newText);

    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "edit", text: newText, clientId }));
    }

    scheduleSendCursor();
  }
  function execWithFallback(exec: () => void) {
    exec();

    requestAnimationFrame(() => {
      const el = editorRef.current;
      if (!el) return;

      const domText = el.textContent ?? "";
      if (domText !== text) syncAndBroadcast();
    })
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Room ID: {room}</h2>

        <div style={{ marginTop: 6 }}>
          <span>Status: {status}</span>
          <span style={{ marginLeft: 12 }}>Users: {users}</span>

          <button onClick={copyLink} style={{ marginLeft: 12 }}>
            {copied ? "Copied!" : "Copy link"}
          </button>
        </div>

        <div style={{ marginTop: 6, fontSize: 12 }}>{shareLink}</div>
      </div>
      <div style = {{position: "relative", width: 650, height: 350}}>
        <div
          ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            style={{
                width: 650,
                height: 350,
                border: "1px solid #ccc",
                borderRadius: 8,
                padding: 10,
                overflow: "auto",
                whiteSpace: "pre-wrap",
                outline: "none",
                fontFamily: "inherit",
                fontSize: "inherit",
            }}
            onKeyDown={(e) => {
              if(e.key === "Enter") {
                e.preventDefault();
                execWithFallback(() => document.execCommand("insertLineBreak"));
              }
            }}
            onPaste={(e) => {
              e.preventDefault();
              const plain = e.clipboardData.getData("text/plain")
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
            width: 650,
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
  );
}