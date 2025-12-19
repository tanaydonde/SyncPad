import {useNavigate} from "react-router-dom";

function randomRoomId() {
  return Math.random().toString(36).slice(2, 8);
}

export default function Home() {
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