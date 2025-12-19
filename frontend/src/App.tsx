import { BrowserRouter, Routes, Route } from "react-router-dom";
import Home from './Home.tsx'
import RoomPage from './RoomPage.tsx'

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