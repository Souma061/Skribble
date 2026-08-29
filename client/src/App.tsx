import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { Header } from "./components/Header";
import { LobbyView } from "./components/LobbyView";
import { RoomView } from "./components/RoomView";
import type { PlayerRole, RoomState } from "./types";

const SOCKET_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:9000";

function App() {
  const [connected, setConnected] = useState(false);
  const [socketId, setSocketId] = useState<string | null>(null);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket: Socket = io(SOCKET_URL, {
      transports: ["websocket", "polling"],
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      setSocketId(socket.id ?? null);
      console.log("Connected to Socket.IO:", socket.id);
    });

    socket.on("disconnect", () => {
      setConnected(false);
      setSocketId(null);
      console.log("Disconnected from Socket.IO");
    });

    // Room Event Listeners
    socket.on("room:created", (payload: { roomId: string; room: RoomState }) => {
      setRoom(payload.room);
      setLoading(false);
      setErrorMessage(null);
    });

    socket.on("room:joined", (payload: { roomId: string; room: RoomState }) => {
      setRoom(payload.room);
      setLoading(false);
      setErrorMessage(null);
    });

    socket.on("room:state", (updatedRoom: RoomState) => {
      setRoom(updatedRoom);
    });

    socket.on("room:left", () => {
      setRoom(null);
      setLoading(false);
    });

    socket.on("room:deleted", () => {
      setRoom(null);
      setErrorMessage("The room was deleted by the host.");
      setLoading(false);
    });

    socket.on("room:error", (err: { code: string; message: string }) => {
      setErrorMessage(err.message || "An error occurred");
      setLoading(false);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const handleCreateRoom = (username: string, roomName: string, role: PlayerRole) => {
    if (!socketRef.current) return;
    setLoading(true);
    socketRef.current.emit("room:create", { username, roomName, role });
  };

  const handleJoinRoom = (username: string, roomId: string, role: PlayerRole) => {
    if (!socketRef.current) return;
    setLoading(true);
    socketRef.current.emit("room:join", { username, roomId, role });
  };

  const handleLeaveRoom = () => {
    if (!socketRef.current) return;
    socketRef.current.emit("room:leave");
    setRoom(null);
  };

  const handleDeleteRoom = () => {
    if (!socketRef.current) return;
    socketRef.current.emit("room:delete");
  };

  const handleStartGame = () => {
    if (!socketRef.current) return;
    socketRef.current.emit("game:start");
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#FDF8F9] bg-[radial-gradient(#E9E4F7_1px,transparent_1px)] [background-size:20px_20px]">
      <Header
        connected={connected}
        roomId={room?.id}
        roomName={room?.name}
      />

      <main className="flex-1 flex flex-col items-center justify-center p-4">
        {!room ? (
          <LobbyView
            onCreateRoom={handleCreateRoom}
            onJoinRoom={handleJoinRoom}
            errorMessage={errorMessage}
            onClearError={() => setErrorMessage(null)}
            loading={loading}
          />
        ) : (
          <RoomView
            socket={socketRef.current}
            room={room}
            currentSocketId={socketId}
            onLeaveRoom={handleLeaveRoom}
            onDeleteRoom={handleDeleteRoom}
            onStartGame={handleStartGame}
          />
        )}
      </main>

      <footer className="py-4 text-center text-xs font-bold text-[#9CA3AF]">
        Skribble Party &bull; Soft Pastel Multiplayer Drawing & Guessing Experience
      </footer>
    </div>
  );
}

export default App;
