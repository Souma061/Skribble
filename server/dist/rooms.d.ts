import { GameEngine } from "./game/GameEngine.js";
import type { GameState } from "./game/types.js";
export declare const MAX_ACTIVE_PLAYERS = 15;
export declare const MAX_SPECTATORS = 15;
export declare const MAX_CONNECTIONS = 30;
export declare const USERNAME_RE: RegExp;
export declare const ABANDONED_MS: number;
export declare const COMPLETED_MS: number;
export declare const GRACE_MS: number;
export declare const DRAWER_GRACE_MS: number;
export type PlayerRole = "player" | "spectator";
export interface Player {
    id: string;
    socketId: string;
    username: string;
    role: PlayerRole;
    score: number;
    joinedAt: number;
    isConnected: boolean;
    disconnectedAt: number | null;
}
export interface ChatMessage {
    id: string;
    username: string;
    message: string;
    type: "CHAT" | "CORRECT_GUESS";
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
    engine: GameEngine;
    currentWord?: string;
    currentHint?: string;
    revealedIndices: Set<number>;
    roundDurationSec: number;
    roundEndsAt?: number;
    lastTimerBroadcastSecond?: number;
    timerInterval?: NodeJS.Timeout;
    wordSelectionTimeout?: NodeJS.Timeout;
    drawerFuseTimeout?: NodeJS.Timeout;
    wordSuggestions: string[];
    correctGuesserIds: string[];
    maxRounds: number;
    chatHistory: ChatMessage[];
}
export declare function normalizeUsername(raw: string): string;
export declare function validateUsername(raw: string): string;
export declare function isUsernameTaken(room: Room | undefined, username: string, exceptToken?: string): boolean;
export declare function getPlayerBySocket(room: Room, socketId: string): Player | undefined;
export declare function getActivePlayerCount(room: Room): number;
export declare function getSpectatorCount(room: Room): number;
export declare function getRoomCount(): number;
export interface RoomSummary {
    id: string;
    name: string;
    activePlayerCount: number;
    spectatorCount: number;
    status: GameState["status"];
    roundNumber: number;
}
export declare function listRoomSummaries(): RoomSummary[];
export declare function getTotalPlayerCount(): number;
export declare function createRoom(name: string, socketId: string, username: string, role?: PlayerRole): Room;
export declare function startGame(roomId: string, socketId: string): {
    room: Room;
    drawerId: string;
};
export declare function joinRoom(roomId: string, socketId: string, username: string, role?: PlayerRole, now?: number, playerToken?: string): Room;
export declare function addPlayerScore(roomId: string, socketId: string, points: number): void;
export declare function markDisconnected(roomId: string, socketId: string, now?: number): Room;
export declare function pruneDisconnected(now?: number): string[];
export declare function leaveRoom(roomId: string, socketId: string, now?: number): Room;
export declare function deleteRoom(roomId: string): boolean;
export declare function getRoom(roomId: string | undefined): Room | undefined;
export declare function markRoomCompleted(roomId: string, now?: number): Room;
export declare function sweepExpired(now?: number): string[];
export declare function getTimeLeft(room: Room, now?: number): number;
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
    timeLeft: number;
    roundDurationSec: number;
    serverNow: number;
    roundEndsAt?: number;
    correctGuesserCount: number;
    maxRounds: number;
};
export declare class RoomError extends Error {
    code: string;
    constructor(code: string, message: string);
}
//# sourceMappingURL=rooms.d.ts.map