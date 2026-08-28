import type { GameState } from "./game/types.js";
export declare const MAX_ACTIVE_PLAYERS = 15;
export declare const MAX_SPECTATORS = 15;
export declare const MAX_CONNECTIONS = 30;
export declare const USERNAME_RE: RegExp;
export declare const ABANDONED_MS: number;
export declare const COMPLETED_MS: number;
export type PlayerRole = "player" | "spectator";
export interface Player {
    id: string;
    username: string;
    role: PlayerRole;
    joinedAt: number;
}
export interface Room {
    id: string;
    ownerId: string;
    name: string;
    players: Map<string, Player>;
    createdAt: number;
    abandonedAt: number | null;
    completedAt: number | null;
    game: GameState;
}
export declare function normalizeUsername(raw: string): string;
export declare function validateUsername(raw: string): string;
export declare function isUsernameTaken(room: Room | undefined, username: string, exceptSocketId?: string): boolean;
export declare function getActivePlayerCount(room: Room): number;
export declare function getSpectatorCount(room: Room): number;
export declare function createRoom(name: string, socketId: string, username: string, role?: PlayerRole): Room;
export declare function joinRoom(roomId: string, socketId: string, username: string, role?: PlayerRole, now?: number): Room;
export declare function leaveRoom(roomId: string, socketId: string, now?: number): Room;
export declare function deleteRoom(roomId: string): boolean;
export declare function getRoom(roomId: string): Room | undefined;
export declare function markRoomCompleted(roomId: string, now?: number): Room;
export declare function sweepExpired(now?: number): string[];
export declare function serializeRoom(room: Room): {
    id: string;
    name: string;
    ownerId: string;
    players: Player[];
    activePlayerCount: number;
    spectatorCount: number;
    maxActivePlayers: number;
    maxSpectators: number;
    game: GameState;
    createdAt: number;
    isAbandoned: boolean;
    isCompleted: boolean;
};
export declare class RoomError extends Error {
    code: string;
    constructor(code: string, message: string);
}
//# sourceMappingURL=rooms.d.ts.map