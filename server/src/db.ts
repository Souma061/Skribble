import { MessageType, PrismaClient, RoomStatus } from "@prisma/client";
import { getRoom } from "./rooms.js";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;


// Save a newly created room to PostgreSQL

export async function dbCreateRoom(id: string, name: string, ownerId: string) {
  try {
    return await prisma.room.upsert({
      where: { id },
      update: { name, ownerId },
      create: {
        id,
        name,
        ownerId,
        status: "WAITING",
      },
    });
  } catch (err) {
    console.error("[DB] Failed to create room:", err);
    return null;
  }
}

// Upsert/Record player joined
export async function dbAddPlayer(roomId: string, token: string, socketId: string, username: string, role: "player" | "spectator") {
  try {
    // Ensure parent Room exists to satisfy PostgreSQL foreign key constraint (Player_roomId_fkey)
    const inMemoryRoom = getRoom(roomId);
    if (inMemoryRoom) {
      await prisma.room.upsert({
        where: { id: roomId },
        update: {},
        create: {
          id: roomId,
          name: inMemoryRoom.name,
          ownerId: inMemoryRoom.ownerId,
          status: "WAITING",
        },
      });
    }

    return await prisma.player.upsert({
      where: {
        roomId_username: {
          roomId,
          username,
        },
      },
      update: {
        socketId,
        role: role === "spectator" ? "SPECTATOR" : "PLAYER",
        isConnected: true,
      },
      create: {
        id: token,
        roomId,
        socketId,
        username,
        role: role === "spectator" ? "SPECTATOR" : "PLAYER",
      },
    });
  } catch (err) {
    console.error("[DB] Failed to add player:", err);
    return null;
  }
}

// Persist a finalized drawing stroke to PostgreSQL
export async function dbSaveStroke(
  roundId: string,
  strokeOrder: number,
  color: string,
  size: number,
  points: { x: number; y: number }[]
) {
  try {
    // Round points to 3 decimal places for compression
    const compressedPoints = points.map((p) => ({
      x: Math.round(p.x * 1000) / 1000,
      y: Math.round(p.y * 1000) / 1000,
    }));

    return await prisma.drawingStroke.create({
      data: {
        roundId,
        strokeOrder,
        color,
        size,
        points: compressedPoints,
      },
    });
  } catch (err) {
    console.error("[DB] Failed to save stroke:", err);
    return null;
  }
}

// Fetch all strokes for a round
export async function dbGetRoundStrokes(roundId: string) {
  try {
    return await prisma.drawingStroke.findMany({
      where: { roundId },
      orderBy: { strokeOrder: "asc" },
    });
  } catch (err) {
    console.error("[DB] Failed to fetch round strokes:", err);
    return [];
  }
}

// Fetch N random words from the Word bank table
export async function dbGetRandomWords(count: number = 7): Promise<string[]> {
  try {
    const words = await prisma.$queryRaw<{ word: string }[]>`
      SELECT word FROM "Word" ORDER BY RANDOM() LIMIT ${count}
    `;
    return words.map((w) => w.word);
  } catch (err) {
    console.error("[DB] Failed to fetch random words:", err);
    return [];
  }
}

/**
 * Update room status and optional completion/abandonment timestamps
 */
export async function dbUpdateRoomStatus(
  roomId: string,
  status: RoomStatus,
  completedAt?: Date | null,
  abandonedAt?: Date | null,
) {
  try {
    const data: { status: RoomStatus; completedAt?: Date | null; abandonedAt?: Date | null } = { status };
    if (completedAt !== undefined) data.completedAt = completedAt;
    if (abandonedAt !== undefined) data.abandonedAt = abandonedAt;

    return await prisma.room.update({
      where: { id: roomId },
      data,
    });
  } catch (err) {
    console.error("[DB] Failed to update room status:", err);
    return null;
  }
}

/**
 * Mark a room as abandoned in PostgreSQL
 */
export async function dbSetRoomAbandoned(roomId: string, abandonedAt: Date = new Date()) {
  try {
    return await prisma.room.update({
      where: { id: roomId },
      data: { abandonedAt },
    });
  } catch (err) {
    console.error("[DB] Failed to set room abandoned:", err);
    return null;
  }
}

/**
 * Clear abandoned state when a room is revived
 */
export async function dbClearRoomAbandoned(roomId: string) {
  try {
    return await prisma.room.update({
      where: { id: roomId },
      data: { abandonedAt: null },
    });
  } catch (err) {
    console.error("[DB] Failed to clear room abandoned:", err);
    return null;
  }
}

/**
 * Delete room explicitly from PostgreSQL (cascades to all child records)
 */
export async function dbDeleteRoom(roomId: string) {
  try {
    return await prisma.room.delete({
      where: { id: roomId },
    });
  } catch (err) {
    if ((err as { code?: string })?.code !== "P2025") {
      console.error("[DB] Failed to delete room:", err);
    }
    return null;
  }
}

/**
 * Update player score in PostgreSQL
 */
export async function dbUpdatePlayerScore(roomId: string, playerId: string, score: number) {
  try {
    return await prisma.player.update({
      where: { id: playerId },
      data: { score },
    });
  } catch (err) {
    console.error("[DB] Failed to update player score:", err);
    return null;
  }
}

/**
 * Update player connection status in PostgreSQL
 */
export async function dbUpdatePlayerConnection(roomId: string, playerId: string, isConnected: boolean) {
  try {
    return await prisma.player.update({
      where: { id: playerId },
      data: { isConnected },
    });
  } catch (err) {
    console.error("[DB] Failed to update player connection:", err);
    return null;
  }
}

/**
 * Create a new round record in PostgreSQL
 */
export async function dbCreateRound(
  roundId: string,
  roomId: string,
  roundNumber: number,
  drawerId: string,
  word: string,
  durationSeconds: number,
) {
  try {
    return await prisma.round.create({
      data: {
        id: roundId,
        roomId,
        roundNumber,
        drawerId,
        word,
        durationSeconds,
      },
    });
  } catch (err) {
    console.error("[DB] Failed to create round:", err);
    return null;
  }
}

/**
 * Finalize a round record in PostgreSQL
 */
export async function dbFinishRound(roundId: string, endedAt: Date = new Date()) {
  try {
    return await prisma.round.update({
      where: { id: roundId },
      data: { endedAt },
    });
  } catch (err) {
    console.error("[DB] Failed to finish round:", err);
    return null;
  }
}

/**
 * Persist a correct guess
 */
export async function dbSaveCorrectGuess(
  roundId: string,
  playerId: string,
  scoreAwarded: number,
  timeTakenSeconds: number,
) {
  try {
    return await prisma.correctGuess.upsert({
      where: {
        roundId_playerId: { roundId, playerId },
      },
      update: { scoreAwarded, timeTakenSeconds },
      create: {
        roundId,
        playerId,
        scoreAwarded,
        timeTakenSeconds,
      },
    });
  } catch (err) {
    console.error("[DB] Failed to save correct guess:", err);
    return null;
  }
}

/**
 * Persist a chat message or system alert
 */
export async function dbSaveChatMessage(
  id: string,
  roomId: string,
  playerId: string | null,
  message: string,
  type: MessageType = "CHAT",
) {
  try {
    return await prisma.chatMessage.create({
      data: {
        id,
        roomId,
        playerId,
        message,
        type,
      },
    });
  } catch (err) {
    console.error("[DB] Failed to save chat message:", err);
    return null;
  }
}

/**
 * Batch-persist strokes for a round (useful fallback or synchronization)
 */
export async function dbSaveRoundStrokesBatch(
  roundId: string,
  strokes: Array<{ color: string; size: number; points: { x: number; y: number }[] }>,
) {
  try {
    if (strokes.length === 0) return;
    const records = strokes.map((stroke, index) => ({
      roundId,
      strokeOrder: index + 1,
      color: stroke.color,
      size: stroke.size,
      points: stroke.points.map((p) => ({
        x: Math.round(p.x * 1000) / 1000,
        y: Math.round(p.y * 1000) / 1000,
      })),
    }));

    return await prisma.drawingStroke.createMany({
      data: records,
    });
  } catch (err) {
    console.error("[DB] Failed to batch save round strokes:", err);
    return null;
  }
}

/**
 * Periodic database sweeper:
 * - Abandoned rooms deleted after 24h
 * - Completed rooms deleted after 48h
 * Cascade deletes automatically clean child tables.
 */
export async function dbSweepExpiredRooms(now = new Date()): Promise<{ abandonedCount: number; completedCount: number }> {
  const ABANDONED_THRESHOLD = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const COMPLETED_THRESHOLD = new Date(now.getTime() - 48 * 60 * 60 * 1000);

  try {
    const abandonedResult = await prisma.room.deleteMany({
      where: {
        abandonedAt: {
          not: null,
          lte: ABANDONED_THRESHOLD,
        },
      },
    });

    const completedResult = await prisma.room.deleteMany({
      where: {
        completedAt: {
          not: null,
          lte: COMPLETED_THRESHOLD,
        },
      },
    });

    if (abandonedResult.count > 0 || completedResult.count > 0) {
      console.log(`[DB Sweeper] Purged ${abandonedResult.count} abandoned rooms and ${completedResult.count} completed rooms.`);
    }

    return {
      abandonedCount: abandonedResult.count,
      completedCount: completedResult.count,
    };
  } catch (err) {
    console.error("[DB Sweeper] Failed during database sweep:", err);
    return { abandonedCount: 0, completedCount: 0 };
  }
}

// ---------------------------------------------------------------------------
// Simple per-socket token-bucket rate limiter (no external deps)
// ---------------------------------------------------------------------------

interface Bucket {
  count: number;
  windowStart: number;
}

// key = `${socketId}:${event}`
const buckets = new Map<string, Bucket>();

/**
 * Returns true if the event is allowed, false if it should be dropped.
 *
 * @param socketId  - unique socket identifier
 * @param event     - event name (e.g. "chat:send")
 * @param limit     - max calls allowed per window
 * @param windowMs  - rolling window size in milliseconds
 */
export function rateLimit(
  socketId: string,
  event: string,
  limit: number,
  windowMs: number,
): boolean {
  const key = `${socketId}:${event}`;
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStart >= windowMs) {
    // New window
    buckets.set(key, { count: 1, windowStart: now });
    return true;
  }

  if (bucket.count >= limit) return false;

  bucket.count += 1;
  return true;
}

/**
 * Remove all rate-limit buckets for a socket (call on disconnect).
 */
export function socketCleanup(socketId: string) {
  for (const key of buckets.keys()) {
    if (key.startsWith(`${socketId}:`)) buckets.delete(key);
  }
}

/**
 * Evict expired rate-limit buckets. Call periodically to prevent unbounded growth
 * from sockets that never cleanly disconnected.
 */
export function sweepRateLimitBuckets(maxWindowMs = 60_000) {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart >= maxWindowMs) buckets.delete(key);
  }
}
