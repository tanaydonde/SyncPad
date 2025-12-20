import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

function randomRoomId() {
  return Math.random().toString(36).slice(2, 8);
}

export default function Home() {
  const navigate = useNavigate();
  const [roomInput, setRoomInput] = useState("");

  const examples = useMemo(() => ["cs173", "proofs", "hw-help", randomRoomId()], []);

  function goToRoom(id: string) {
    navigate(`/room/${encodeURIComponent(id)}`);
  }

  function handleGo() {
    const id = roomInput.trim();
    if (!id) {
      goToRoom(randomRoomId()); // blank => random room
      return;
    }
    goToRoom(id);
  }

  function handleRandom() {
    goToRoom(randomRoomId());
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
        alignItems: "center",
        padding: 40,
        boxSizing: "border-box",
      }}
    >
      <div style={{ width: 760 }}>
        <div style={{ textAlign: "center", marginBottom: 22 }}>
          <div style={{ fontSize: 44, fontWeight: 900, letterSpacing: 0.3 }}>
            TexPad
          </div>
          <div style={{ marginTop: 10, opacity: 0.78, fontSize: 14 }}>
            Real-time editor with LaTeX preview
          </div>
        </div>

        <div
          style={{
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 14,
            background: "rgba(255,255,255,0.04)",
            padding: 18,
            boxShadow: "0 10px 28px rgba(0,0,0,0.35)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              justifyContent: "center",
              flexWrap: "wrap",
            }}
          >
            <input
              value={roomInput}
              onChange={(e) => setRoomInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleGo();
              }}
              placeholder="Enter room ID (or leave blank for random)…"
              style={{
                width: 360,
                padding: "12px 14px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.18)",
                background: "rgba(0,0,0,0.25)",
                color: "#eaeaea",
                outline: "none",
                fontSize: 14,
              }}
            />

            <button
              onClick={handleGo}
              style={{
                padding: "12px 16px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.18)",
                background: "rgba(255,255,255,0.10)",
                color: "#eaeaea",
                cursor: "pointer",
                fontWeight: 800,
                minWidth: 120,
              }}
            >
              Go
            </button>
          </div>

          <div style={{ marginTop: 14, fontSize: 12, opacity: 0.7, textAlign: "center" }}>
            Try:{" "}
            {examples.map((x, i) => (
              <span key={x}>
                <button
                  onClick={() => goToRoom(x)}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "rgba(255,255,255,0.85)",
                    textDecoration: "underline",
                    cursor: "pointer",
                    padding: 0,
                    font: "inherit",
                  }}
                >
                  {x}
                </button>
                {i === examples.length - 1 ? "" : " • "}
              </span>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 16, textAlign: "center", fontSize: 12, opacity: 0.65 }}>
          Type <span style={{ fontFamily: "ui-monospace" }}>$x^2$</span> for math, or{" "}
          <span style={{ fontFamily: "ui-monospace" }}>$\text{"{hello}"}$</span> for words.
        </div>
      </div>
    </div>
  );
}