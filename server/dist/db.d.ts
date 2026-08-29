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
export declare function dbAddPlayer(roomId: string, id: string, username: string, role: "player" | "spectator"): Promise<{
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
//# sourceMappingURL=db.d.ts.map