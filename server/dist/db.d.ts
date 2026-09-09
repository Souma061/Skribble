import { PrismaClient } from "@prisma/client";
export declare const prisma: PrismaClient<import("@prisma/client").Prisma.PrismaClientOptions, never, import("@prisma/client/runtime/library").DefaultArgs>;
/**
 * Save a newly created room to PostgreSQL
 */
export declare function dbCreateRoom(id: string, name: string, ownerId: string): Promise<{
    id: string;
    name: string;
    ownerId: string;
    status: import("@prisma/client").$Enums.RoomStatus;
    createdAt: Date;
    abandonedAt: Date | null;
    completedAt: Date | null;
} | null>;
/**
 * Upsert/Record player joined
 */
export declare function dbAddPlayer(roomId: string, token: string, socketId: string, username: string, role: "player" | "spectator"): Promise<{
    id: string;
    roomId: string;
    socketId: string | null;
    username: string;
    role: import("@prisma/client").$Enums.PlayerRole;
    score: number;
    isConnected: boolean;
    joinedAt: Date;
} | null>;
/**
 * Persist a finalized drawing stroke to PostgreSQL
 */
export declare function dbSaveStroke(roundId: string, strokeOrder: number, color: string, size: number, points: {
    x: number;
    y: number;
}[]): Promise<{
    id: string;
    roundId: string;
    strokeOrder: number;
    color: string;
    size: number;
    points: import("@prisma/client/runtime/library").JsonValue;
    createdAt: Date;
} | null>;
/**
 * Fetch all strokes for a round
 */
export declare function dbGetRoundStrokes(roundId: string): Promise<{
    id: string;
    roundId: string;
    strokeOrder: number;
    color: string;
    size: number;
    points: import("@prisma/client/runtime/library").JsonValue;
    createdAt: Date;
}[]>;
/**
 * Fetch N random words from the Word bank table
 */
export declare function dbGetRandomWords(count?: number): Promise<string[]>;
/**
 * Returns true if the event is allowed, false if it should be dropped.
 *
 * @param socketId  - unique socket identifier
 * @param event     - event name (e.g. "chat:send")
 * @param limit     - max calls allowed per window
 * @param windowMs  - rolling window size in milliseconds
 */
export declare function rateLimit(socketId: string, event: string, limit: number, windowMs: number): boolean;
/**
 * Remove all rate-limit buckets for a socket (call on disconnect).
 */
export declare function socketCleanup(socketId: string): void;
//# sourceMappingURL=db.d.ts.map