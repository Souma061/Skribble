import { PrismaClient } from "@prisma/client";
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

/**
 * Save a newly created room to PostgreSQL
 */
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

/**
 * Upsert/Record player joined
 */
export async function dbAddPlayer(roomId: string, id: string, username: string, role: "player" | "spectator") {
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
        socketId: id,
        role: role === "spectator" ? "SPECTATOR" : "PLAYER",
        isConnected: true,
      },
      create: {
        id,
        roomId,
        socketId: id,
        username,
        role: role === "spectator" ? "SPECTATOR" : "PLAYER",
      },
    });
  } catch (err) {
    console.error("[DB] Failed to add player:", err);
    return null;
  }
}

/**
 * Persist a finalized drawing stroke to PostgreSQL
 */
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

/**
 * Fetch all strokes for a round
 */
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

/**
 * Fetch N random words from the Word bank table
 */
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
