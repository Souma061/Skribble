import { Server, Socket } from "socket.io";
import { getRoom } from "./rooms.js";

export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface Stroke {
  id: string;
  color: string;
  size: number;
  points: NormalizedPoint[];
}

const roomDrawHistories = new Map<string, Stroke[]>();

export function getRoomStrokes(roomId: string): Stroke[] {
  return roomDrawHistories.get(roomId) || [];
}

export function clearRoomStrokes(roomId: string) {
  roomDrawHistories.delete(roomId);
}

function isDrawerAuthorized(roomId: string, socketId: string): boolean {
  const room = getRoom(roomId);
  if (!room) return false;

  // During an active game round: ONLY the selected drawer can draw
  if (room.game.status === "ACTIVE_ROUND" || room.game.status === "WORD_SELECTION") {
    return room.game.currentDrawerId === socketId;
  }

  // When game is WAITING in the lobby: only the room owner can test draw
  return room.ownerId === socketId;
}

export function registerDrawHandlers(io: Server, socket: Socket) {
  // 1. Stroke started
  socket.on(
    "draw:start",
    (payload: { strokeId?: string; color?: string; size?: number; startPoint?: NormalizedPoint }) => {
      const roomId = socket.data.roomId as string | undefined;
      if (
        !roomId ||
        typeof payload?.strokeId !== "string" ||
        !payload.startPoint ||
        typeof payload.startPoint.x !== "number" ||
        typeof payload.startPoint.y !== "number"
      ) {
        return;
      }
      if (!isDrawerAuthorized(roomId, socket.id)) return;

      const strokeId = payload.strokeId.slice(0, 50);
      const color = typeof payload.color === "string" ? payload.color.slice(0, 20) : "#2E1065";
      const size = typeof payload.size === "number" && payload.size >= 1 && payload.size <= 50 ? payload.size : 6;
      const startPoint: NormalizedPoint = {
        x: Math.max(0, Math.min(1, payload.startPoint.x)),
        y: Math.max(0, Math.min(1, payload.startPoint.y)),
      };

      if (!roomDrawHistories.has(roomId)) {
        roomDrawHistories.set(roomId, []);
      }

      const strokes = roomDrawHistories.get(roomId)!;
      strokes.push({
        id: strokeId,
        color,
        size,
        points: [startPoint],
      });

      socket.to(roomId).emit("draw:start", { strokeId, color, size, startPoint });
    }
  );

  // 2. Stroke chunk streamed
  socket.on("draw:chunk", (payload: { strokeId?: string; points?: NormalizedPoint[] }) => {
    const roomId = socket.data.roomId as string | undefined;
    if (
      !roomId ||
      typeof payload?.strokeId !== "string" ||
      !Array.isArray(payload?.points) ||
      payload.points.length === 0
    ) {
      return;
    }
    if (!isDrawerAuthorized(roomId, socket.id)) return;

    const strokeId = payload.strokeId.slice(0, 50);

    // Cap points to 500 max and clamp coordinates to normalized [0, 1] range
    const safePoints: NormalizedPoint[] = payload.points.slice(0, 500).map((p) => ({
      x: Math.max(0, Math.min(1, typeof p?.x === "number" && !isNaN(p.x) ? p.x : 0)),
      y: Math.max(0, Math.min(1, typeof p?.y === "number" && !isNaN(p.y) ? p.y : 0)),
    }));

    const strokes = roomDrawHistories.get(roomId);
    if (strokes && strokes.length > 0) {
      // O(1) fast-path: active chunk is almost always the most recent stroke
      const lastStroke = strokes[strokes.length - 1];
      if (lastStroke && lastStroke.id === strokeId) {
        lastStroke.points.push(...safePoints);
      } else {
        const currentStroke = strokes.find((s) => s.id === strokeId);
        if (currentStroke) {
          currentStroke.points.push(...safePoints);
        }
      }
    }

    socket.to(roomId).emit("draw:chunk", { strokeId, points: safePoints });
  });

  // 3. Clear canvas
  socket.on("draw:clear", () => {
    const roomId = socket.data.roomId as string | undefined;
    if (!roomId) return;
    if (!isDrawerAuthorized(roomId, socket.id)) return;

    roomDrawHistories.set(roomId, []);
    io.to(roomId).emit("draw:clear");
  });

  // 4. Undo last stroke
  socket.on("draw:undo", () => {
    const roomId = socket.data.roomId as string | undefined;
    if (!roomId) return;
    if (!isDrawerAuthorized(roomId, socket.id)) return;

    const strokes = roomDrawHistories.get(roomId);
    if (strokes && strokes.length > 0) {
      strokes.pop();
      io.to(roomId).emit("draw:sync", { history: strokes });
    }
  });

  // 5. Request sync (on initial load / reconnect)
  socket.on("draw:request-sync", () => {
    const roomId = socket.data.roomId as string | undefined;
    if (!roomId) return;

    const history = roomDrawHistories.get(roomId) || [];
    socket.emit("draw:sync", { history });
  });
}
