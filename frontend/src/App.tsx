import { useEffect, useRef, useState, useMemo } from "react";
import { BrowserRouter, Routes, Route, useNavigate, useParams } from "react-router-dom";

function randomRoomId() {
  return Math.random().toString(36).slice(2, 8);
}

function Home() {
  const navigate = useNavigate();
  
  function handleCreate() {
    const id = randomRoomId();
    navigate(`/room/${id}`);
  }

  function handleJoin() {
    const id = prompt("Enter room ID:");
    if (!id) return;
    navigate(`/room/${id.trim()}`);
  }

  return (
    <div style={{ padding: 16 }}>
      <h1>Sync Pad</h1>
      <button onClick={handleCreate} style={{ marginRight: 8 }}>
        Create a room
      </button>
      <button onClick={handleJoin}>Join an existing room</button>
    </div>
  );
}

function RoomPage() {
  const {roomId} = useParams();
  const room = roomId ?? "default"

  const [text, setText] = useState("");
  const [status, setStatus] = useState("disconnected");
  const wsRef = useRef<WebSocket | null>(null);

  const shareLink = useMemo(() => `${window.location.origin}/room/${encodeURIComponent(room)}`, [room]);

  useEffect(() => {
    const ws = new WebSocket(`ws://${window.location.hostname}:8080/ws?room=${encodeURIComponent(room)}`);
    wsRef.current = ws;

    ws.onopen = () => setStatus("connected");
    ws.onclose = () => setStatus("disconnected");
    ws.onerror = () => setStatus("error");
    ws.onmessage = (event) => setText(String(event.data));

    return () => ws.close();

  }, [room]);

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const newText = e.target.value;
    setText(newText);

    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(newText);
    }
  }

  async function copyLink() {
    try{
      await navigator.clipboard.writeText(shareLink);
      alert("Copied link!");
    } catch {
      alert("Could not copy. Copy from the address bar.");
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Room ID: {room}</h2>
        <div style={{ marginTop: 6 }}>
          <span>Status: {status}</span>
          <button onClick={copyLink} style={{ marginLeft: 12 }}>
            Copy link
          </button>
        </div>
        <div style={{ marginTop: 6, fontSize: 12 }}>{shareLink}</div>
      </div>

      <textarea
        style={{ width: 650, height: 350 }}
        value={text}
        onChange={handleChange}
      />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/room/:roomId" element={<RoomPage />} />
      </Routes>
    </BrowserRouter>
  );
}