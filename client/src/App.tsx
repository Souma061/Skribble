import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { Header } from "./components/Header";
import { LobbyView } from "./components/LobbyView";
import { RoomView } from "./components/RoomView";
import type { PlayerRole, RoomState, RoomSummary } from "./types";

const SOCKET_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:9000";

const AUTH_KEY = "skribble.auth";

interface SavedAuth {
  playerToken: string;
  roomId: string;
  username: string;
  role: PlayerRole;
}

function loadAuth(): SavedAuth | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    return raw ? (JSON.parse(raw) as SavedAuth) : null;
  } catch {
    return null;
  }
}

function App() {
  const [connected, setConnected] = useState(false);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeSocket, setActiveSocket] = useState<Socket | null>(null);
  const [roomList, setRoomList] = useState<RoomSummary[]>([]);
  // Stable identity (token); socket.id is only the wire address.
  const [playerToken, setPlayerToken] = useState<string | null>(
    () => loadAuth()?.playerToken ?? null,
  );

  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket: Socket = io(SOCKET_URL, {
      transports: ["websocket", "polling"],
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setActiveSocket(socket);
      setConnected(true);
      console.log("Connected to Socket.IO:", socket.id);
      // Rejoin with saved token: fresh load and network blip look identical here.
      const auth = loadAuth();
      if (auth?.playerToken && auth?.roomId) {
        socket.emit("room:join", {
          roomId: auth.roomId,
          username: auth.username,
          role: auth.role,
          playerToken: auth.playerToken,
        });
      }
    });

    socket.on("disconnect", () => {
      setActiveSocket(null);
      setConnected(false);
      console.log("Disconnected from Socket.IO");
    });

    // Room Event Listeners
    socket.on(
      "room:created",
      (payload: { roomId: string; room: RoomState; playerToken?: string }) => {
        if (payload.playerToken) {
          setPlayerToken(payload.playerToken);
          try {
            const me = payload.room.players.find(
              (p) => p.id === payload.playerToken,
            );
            localStorage.setItem(
              AUTH_KEY,
              JSON.stringify({
                playerToken: payload.playerToken,
                roomId: payload.roomId,
                username: me?.username ?? "",
                role: me?.role ?? "player",
              } satisfies SavedAuth),
            );
          } catch {
            // private-mode storage; game still works, just no auto-rejoin
          }
        }
        setRoom(payload.room);
        setLoading(false);
        setErrorMessage(null);
      },
    );

    socket.on(
      "room:joined",
      (payload: { roomId: string; room: RoomState; playerToken?: string }) => {
        if (payload.playerToken) {
          setPlayerToken(payload.playerToken);
          try {
            const me = payload.room.players.find(
              (p) => p.id === payload.playerToken,
            );
            localStorage.setItem(
              AUTH_KEY,
              JSON.stringify({
                playerToken: payload.playerToken,
                roomId: payload.roomId,
                username: me?.username ?? "",
                role: me?.role ?? "player",
              } satisfies SavedAuth),
            );
          } catch {
            // private-mode storage; game still works, just no auto-rejoin
          }
        }
        setRoom(payload.room);
        setLoading(false);
        setErrorMessage(null);
      },
    );

    socket.on("room:state", (updatedRoom: RoomState) => {
      setRoom(updatedRoom);
    });

    socket.on("room:left", () => {
      try {
        localStorage.removeItem(AUTH_KEY);
      } catch {
        // ignore
      }
      setPlayerToken(null);
      setRoom(null);
      setLoading(false);
    });

    socket.on("room:deleted", () => {
      try {
        localStorage.removeItem(AUTH_KEY);
      } catch {
        // ignore
      }
      setPlayerToken(null);
      setRoom(null);
      setErrorMessage("The room was deleted by the host.");
      setLoading(false);
    });

    socket.on("room:error", (err: { code: string; message: string }) => {
      // Saved room is gone (swept/deleted while away): stop retrying it.
      if (err.code === "ROOM_NOT_FOUND" || err.code === "ROOM_ABANDONED") {
        try {
          localStorage.removeItem(AUTH_KEY);
        } catch {
          // ignore
        }
      }
      setErrorMessage(err.message || "An error occurred");
      setLoading(false);
    });

    socket.on("room:list", (payload: { rooms: RoomSummary[] }) => {
      setRoomList(payload.rooms ?? []);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const handleCreateRoom = (
    username: string,
    roomName: string,
    role: PlayerRole,
  ) => {
    if (!socketRef.current) return;
    setLoading(true);
    socketRef.current.emit("room:create", { username, roomName, role });
  };

  const handleJoinRoom = (
    username: string,
    roomId: string,
    role: PlayerRole,
  ) => {
    if (!socketRef.current) return;
    setLoading(true);
    socketRef.current.emit("room:join", { username, roomId, role });
  };

  const handleLeaveRoom = () => {
    if (!socketRef.current) return;
    socketRef.current.emit("room:leave");
    // Do NOT optimistically clear room here — wait for server's room:left event
    // to avoid stuck screen if the leave fails server-side.
  };

  const handleDeleteRoom = () => {
    if (!socketRef.current) return;
    socketRef.current.emit("room:delete");
  };

  const handleStartGame = () => {
    if (!socketRef.current) return;
    socketRef.current.emit("game:start");
  };

  const handleListRooms = () => {
    if (!socketRef.current) return;
    socketRef.current.emit("room:list");
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#FDF8F9] bg-[radial-gradient(#E9E4F7_1px,transparent_1px)] [background-size:20px_20px]">
      <Header connected={connected} roomId={room?.id} roomName={room?.name} />

      <main className="flex-1 flex flex-col items-center justify-center p-4">
        {!room ? (
          <LobbyView
            onCreateRoom={handleCreateRoom}
            onJoinRoom={handleJoinRoom}
            errorMessage={errorMessage}
            onClearError={() => setErrorMessage(null)}
            loading={loading}
            rooms={roomList}
            onRefreshRooms={handleListRooms}
          />
        ) : (
          <RoomView
            socket={activeSocket}
            room={room}
            currentPlayerToken={playerToken}
            connected={connected}
            onLeaveRoom={handleLeaveRoom}
            onDeleteRoom={handleDeleteRoom}
            onStartGame={handleStartGame}
          />
        )}
      </main>

      <footer className="py-4 text-center text-xs font-bold text-[#9CA3AF]">
        Skribble Party &bull; Soft Pastel Multiplayer Drawing & Guessing
        Experience
      </footer>
    </div>
  );
}

export default App;
