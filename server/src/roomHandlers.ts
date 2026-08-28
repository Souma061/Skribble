import { Server, Socket } from "socket.io";
import {
  type PlayerRole,
  RoomError,
  createRoom,
  deleteRoom,
  getRoom,
  isUsernameTaken,
  joinRoom,
  leaveRoom,
  serializeRoom,
  sweepExpired,
  validateUsername,
} from "./rooms.js";

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

export function registerSocketHandlers(io: Server) {
  io.on("connection", (socket) => {
    console.log(`Socket connected: ${socket.id}`);
    socket.on("disconnect", handleDisconnect(socket));
    socket.on("room:create", handleCreate(socket));
    socket.on("room:join", handleJoin(socket));
    socket.on("room:leave", handleLeave(socket));
    socket.on("room:delete", handleDelete(io, socket));
  });

  setInterval(() => {
    for (const roomId of sweepExpired()) {
      io.in(roomId).socketsLeave(roomId);
      console.log(`Room ${roomId} deleted (sweep expired)`);
    }
  }, SWEEP_INTERVAL_MS).unref();
}

function handleDisconnect(socket: Socket) {
  return () => {
    const roomId = socket.data.roomId as string | undefined;
    if (roomId) {
      try {
        const room = leaveRoom(roomId, socket.id);
        socket.to(roomId).emit("room:player-left", {
          playerId: socket.id,
          newOwnerId: room.ownerId,
        });
        socket.to(roomId).emit("room:state", serializeRoom(room));
      } catch {
        // room already gone; nothing to notify
      }
    }
    console.log(`Socket disconnected: ${socket.id}`);
  };
}

function handleCreate(socket: Socket) {
  return (payload: { roomName?: string; username?: string; role?: PlayerRole }) => {
    try {
      const username = validateUsername(payload.username ?? "");
      const roomName = (payload.roomName ?? "").trim() || `${username}'s room`;
      const role: PlayerRole = payload.role === "spectator" ? "spectator" : "player";
      const room = createRoom(roomName, socket.id, username, role);
      joinSocketRoom(socket, room.id);
      socket.emit("room:created", { roomId: room.id, room: serializeRoom(room) });
    } catch (err) {
      emitError(socket, err);
    }
  };
}

function handleJoin(socket: Socket) {
  return (payload: { roomId?: string; username?: string; role?: PlayerRole }) => {
    try {
      const username = validateUsername(payload.username ?? "");
      const roomId = payload.roomId ?? "";
      const role: PlayerRole = payload.role === "spectator" ? "spectator" : "player";

      if (isUsernameTaken(getRoom(roomId), username, socket.id)) {
        throw new RoomError("USERNAME_TAKEN", "Username already taken in this room");
      }

      const room = joinRoom(roomId, socket.id, username, role);
      const player = room.players.get(socket.id);

      socket.to(room.id).emit("room:player-joined", { player });
      socket.to(room.id).emit("room:state", serializeRoom(room));
      joinSocketRoom(socket, room.id);
      socket.emit("room:joined", { roomId: room.id, room: serializeRoom(room) });
    } catch (err) {
      emitError(socket, err);
    }
  };
}

function handleLeave(socket: Socket) {
  return () => {
    const roomId = socket.data.roomId as string | undefined;
    if (!roomId) return;
    try {
      const room = leaveRoom(roomId, socket.id);
      socket.leave(roomId);
      delete socket.data.roomId;
      socket.emit("room:left", {});
      socket.to(roomId).emit("room:player-left", {
        playerId: socket.id,
        newOwnerId: room.ownerId,
      });
      socket.to(roomId).emit("room:state", serializeRoom(room));
    } catch (err) {
      emitError(socket, err);
    }
  };
}

function handleDelete(io: Server, socket: Socket) {
  return () => {
    const roomId = socket.data.roomId as string | undefined;
    if (!roomId) return;
    try {
      const room = getRoom(roomId);
      if (!room) throw new RoomError("ROOM_NOT_FOUND", "Room not found");
      if (room.ownerId !== socket.id) {
        throw new RoomError("FORBIDDEN", "Only the room owner can delete the room");
      }
      deleteRoom(roomId);
      io.to(roomId).emit("room:deleted", {});
      io.in(roomId).socketsLeave(roomId);
    } catch (err) {
      emitError(socket, err);
    }
  };
}

function joinSocketRoom(socket: Socket, roomId: string) {
  socket.join(roomId);
  socket.data.roomId = roomId;
}

function emitError(socket: Socket, err: unknown) {
  if (err instanceof RoomError) {
    socket.emit("room:error", { code: err.code, message: err.message });
  } else {
    console.error(err);
    socket.emit("room:error", { code: "INTERNAL", message: "Something went wrong" });
  }
}
