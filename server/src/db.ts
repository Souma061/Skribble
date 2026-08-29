import { PrismaClient } from "@prisma/client";

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
    return await prisma.room.create({
      data: {
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
