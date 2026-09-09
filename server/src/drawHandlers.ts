import { Server, Socket } from "socket.io";
import { decodeBinaryChunk, isBinaryPayload } from "./binaryDrawing.js";
import { rateLimit } from "./db.js";
import {
  drawingBytesCounter,
  drawingChunksCounter,
  drawingPointsCounter,
  drawingStrokesCounter,
} from "./metrics.js";
import { getPlayerBySocket, getRoom } from "./rooms.js";

export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface Stroke {
  id: string;
  seq?: number | undefined;
  color: string;
  size: number;
  points: NormalizedPoint[];
}

const roomDrawHistories = new Map<string, Stroke[]>();

/** Maximum number of points buffered per stroke to prevent unbounded memory growth */
const MAX_POINTS_PER_STROKE = 10_000;

/** Only accept valid CSS hex colors: #RGB or #RRGGBB */
const HEX_COLOR_RE = /^#[0-9A-Fa-f]{3,6}$/;

export function getRoomStrokes(roomId: string): Stroke[] {
  return roomDrawHistories.get(roomId) || [];
}

export function getTotalCachedStrokesCount(): number {
  let count = 0;
  for (const strokes of roomDrawHistories.values()) {
    count += strokes.length;
  }
  return count;
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

  // In the lobby, only the owner can test draw. End-state canvases are read-only.
  // Ghosts can't draw: revive first (new socket id), then the drawer check passes again.
  const me = room ? getPlayerBySocket(room, socketId) : undefined;
  if (!me?.isConnected) return false;
  return room.game.status === "WAITING" && me.id === room.ownerId;
}

export function registerDrawHandlers(io: Server, socket: Socket) {
  // 1. Stroke started — max 60/min (one per pointer-down, not per frame)
  socket.on(
    "draw:start",
    (payload: {
      strokeId?: string;
      seq?: number;
      color?: string;
      size?: number;
      startPoint?: NormalizedPoint;
    }) => {
      if (!rateLimit(socket.id, "draw:start", 60, 60_000)) return;
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
      const seq = typeof payload.seq === "number" ? payload.seq : undefined;
      const color =
        typeof payload.color === "string" && HEX_COLOR_RE.test(payload.color)
          ? payload.color
          : "#2E1065";
      const size =
        typeof payload.size === "number" && payload.size >= 1 && payload.size <= 50
          ? payload.size
          : 6;
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
        seq,
        color,
        size,
        points: [startPoint],
      });

      drawingStrokesCounter.inc({ action: "start" });
      drawingPointsCounter.inc({ format: "json" }, 1);

      socket.to(roomId).emit("draw:start", {
        strokeId,
        ...(seq !== undefined ? { seq } : {}),
        color,
        size,
        startPoint,
      });
    },
  );

  // 2. Stroke chunk streamed — max 30/s (client batches at ~60 ms; Binary & JSON support)
  socket.on("draw:chunk", (payload: unknown) => {
    if (!rateLimit(socket.id, "draw:chunk", 30, 1_000)) return;
    const roomId = socket.data.roomId as string | undefined;
    if (!roomId) return;
    if (!isDrawerAuthorized(roomId, socket.id)) return;

    // A. Binary Protocol Path
    if (isBinaryPayload(payload)) {
      let decoded;
      try {
        decoded = decodeBinaryChunk(payload);
      } catch {
        return;
      }

      const { strokeSeq, points } = decoded;
      if (points.length === 0) return;

      const byteLength =
        payload instanceof ArrayBuffer
          ? payload.byteLength
          : typeof Buffer !== "undefined" && Buffer.isBuffer(payload)
            ? payload.length
            : ArrayBuffer.isView(payload)
              ? payload.byteLength
              : 0;

      drawingChunksCounter.inc({ format: "binary" });
      drawingPointsCounter.inc({ format: "binary" }, points.length);
      drawingBytesCounter.inc({ format: "binary" }, byteLength);

      const strokes = roomDrawHistories.get(roomId);
      if (strokes && strokes.length > 0) {
        const lastStroke = strokes[strokes.length - 1];
        if (lastStroke?.points.length === 0 && lastStroke.seq === strokeSeq) {
          if (lastStroke.points.length + points.length <= MAX_POINTS_PER_STROKE)
            lastStroke.points.push(...points);
        } else {
          const target = strokes.find((s) => s.seq === strokeSeq);
          if (target && target.points.length + points.length <= MAX_POINTS_PER_STROKE)
            target.points.push(...points);
        }
      }

      // Zero-copy binary broadcast directly to room
      socket.to(roomId).emit("draw:chunk", payload);
      return;
    }

    // B. JSON Fallback Path
    const jsonPayload = payload as { strokeId?: string; points?: NormalizedPoint[] };
    if (
      typeof jsonPayload?.strokeId !== "string" ||
      !Array.isArray(jsonPayload?.points) ||
      jsonPayload.points.length === 0
    ) {
      return;
    }

    const strokeId = jsonPayload.strokeId.slice(0, 50);
    const safePoints: NormalizedPoint[] = jsonPayload.points.slice(0, 500).map((p) => ({
      x: Math.max(0, Math.min(1, typeof p?.x === "number" && !isNaN(p.x) ? p.x : 0)),
      y: Math.max(0, Math.min(1, typeof p?.y === "number" && !isNaN(p.y) ? p.y : 0)),
    }));

    drawingChunksCounter.inc({ format: "json" });
    drawingPointsCounter.inc({ format: "json" }, safePoints.length);
    drawingBytesCounter.inc({ format: "json" }, JSON.stringify(jsonPayload).length);

    const strokes = roomDrawHistories.get(roomId);
    if (strokes && strokes.length > 0) {
      const lastStroke = strokes[strokes.length - 1];
      if (lastStroke && lastStroke.id === strokeId) {
        if (lastStroke.points.length + safePoints.length <= MAX_POINTS_PER_STROKE)
          lastStroke.points.push(...safePoints);
      } else {
        const currentStroke = strokes.find((s) => s.id === strokeId);
        if (currentStroke && currentStroke.points.length + safePoints.length <= MAX_POINTS_PER_STROKE)
          currentStroke.points.push(...safePoints);
      }
    }

    socket.to(roomId).emit("draw:chunk", { strokeId, points: safePoints });
  });

  // 3. Clear canvas — max 10/min
  socket.on("draw:clear", () => {
    if (!rateLimit(socket.id, "draw:clear", 10, 60_000)) return;
    const roomId = socket.data.roomId as string | undefined;
    if (!roomId) return;
    if (!isDrawerAuthorized(roomId, socket.id)) return;

    drawingStrokesCounter.inc({ action: "clear" });
    roomDrawHistories.set(roomId, []);
    io.to(roomId).emit("draw:clear");
  });

  // 4. Undo last stroke — max 10/min
  socket.on("draw:undo", () => {
    if (!rateLimit(socket.id, "draw:undo", 10, 60_000)) return;
    const roomId = socket.data.roomId as string | undefined;
    if (!roomId) return;
    if (!isDrawerAuthorized(roomId, socket.id)) return;

    const strokes = roomDrawHistories.get(roomId);
    if (strokes && strokes.length > 0) {
      drawingStrokesCounter.inc({ action: "undo" });
      strokes.pop();
      io.to(roomId).emit("draw:sync", { history: strokes });
    }
  });

  // 5. Request sync (on initial load / reconnect) — max 10/min
  socket.on("draw:request-sync", () => {
    if (!rateLimit(socket.id, "draw:request-sync", 10, 60_000)) return;
    const roomId = socket.data.roomId as string | undefined;
    if (!roomId) return;

    const history = roomDrawHistories.get(roomId) || [];
    socket.emit("draw:sync", { history });
  });
}
