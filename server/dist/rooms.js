import { randomUUID } from "node:crypto";
import { GameEngine } from "./game/GameEngine.js";
import { calculateRemainingSeconds } from "./game/timerUtils.js";
export const MAX_ACTIVE_PLAYERS = 15;
export const MAX_SPECTATORS = 15;
export const MAX_CONNECTIONS = 30;
export const USERNAME_RE = /^[A-Za-z0-9 _]{3,20}$/;
export const ABANDONED_MS = 24 * 60 * 60 * 1000; // 24 hours
export const COMPLETED_MS = 2 * 24 * 60 * 60 * 1000; // 48 hours (2 days)
const rooms = new Map();
export function normalizeUsername(raw) {
    return raw.trim().replace(/\s+/g, " ");
}
export function validateUsername(raw) {
    const name = normalizeUsername(raw);
    if (!USERNAME_RE.test(name)) {
        throw new RoomError("INVALID_USERNAME", "Username must be 3-20 chars: letters, numbers, spaces, underscores");
    }
    return name;
}
export function isUsernameTaken(room, username, exceptSocketId) {
    if (!room)
        return false;
    const target = normalizeUsername(username).toLowerCase();
    return [...room.players.values()].some((p) => p.username.toLowerCase() === target && p.id !== exceptSocketId);
}
export function getActivePlayerCount(room) {
    let count = 0;
    for (const player of room.players.values()) {
        if (player.role === "player")
            count++;
    }
    return count;
}
export function getSpectatorCount(room) {
    let count = 0;
    for (const player of room.players.values()) {
        if (player.role === "spectator")
            count++;
    }
    return count;
}
export function getRoomCount() {
    return rooms.size;
}
export function getTotalPlayerCount() {
    let count = 0;
    for (const room of rooms.values()) {
        count += room.players.size;
    }
    return count;
}
export function createRoom(name, socketId, username, role = "player") {
    const normalizedUser = validateUsername(username);
    const now = Date.now();
    const engine = new GameEngine();
    const room = {
        id: randomUUID(),
        ownerId: socketId,
        name: name.trim() || `${normalizedUser}'s room`,
        players: new Map([
            [
                socketId,
                {
                    id: socketId,
                    username: normalizedUser,
                    role,
                    score: 0,
                    joinedAt: now,
                },
            ],
        ]),
        createdAt: now,
        abandonedAt: null,
        completedAt: null,
        game: engine.getState(),
        engine,
        revealedIndices: new Set(),
        roundDurationSec: 0,
        wordSuggestions: [],
        correctGuesserIds: [],
        maxRounds: 0,
    };
    rooms.set(room.id, room);
    return room;
}
export function startGame(roomId, socketId) {
    const room = rooms.get(roomId);
    if (!room)
        throw new RoomError("ROOM_NOT_FOUND", "Room not found");
    if (room.ownerId !== socketId) {
        throw new RoomError("FORBIDDEN", "Only the room owner can start the game");
    }
    // Guard: cannot start a new round while one is already running or ending
    if (room.game.status === "ACTIVE_ROUND" ||
        room.game.status === "WORD_SELECTION" ||
        room.game.status === "ROUND_ENDING") {
        throw new RoomError("GAME_IN_PROGRESS", "A round is already in progress");
    }
    const eligiblePlayers = [...room.players.values()]
        .filter((p) => p.role === "player")
        .map((p) => p.id);
    if (eligiblePlayers.length < 2) {
        throw new RoomError("NOT_ENOUGH_PLAYERS", "At least two active players are required");
    }
    // Fresh game: first start (WAITING) or Play Again after a completed match (COMPLETED)
    if (room.game.status === "WAITING" || room.game.status === "COMPLETED") {
        if (room.game.status === "COMPLETED") {
            for (const player of room.players.values()) {
                player.score = 0;
            }
            room.completedAt = null;
        }
        room.maxRounds = eligiblePlayers.length;
        room.engine = new GameEngine();
        room.game = room.engine.getState();
    }
    if (room.wordSelectionTimeout) {
        clearTimeout(room.wordSelectionTimeout);
        delete room.wordSelectionTimeout;
    }
    const drawerId = room.engine.selectDrawer(eligiblePlayers);
    room.game = room.engine.getState();
    room.game.status = "WORD_SELECTION";
    delete room.currentWord;
    delete room.currentHint;
    delete room.roundEndsAt;
    delete room.lastTimerBroadcastSecond;
    room.roundDurationSec = 0;
    room.wordSuggestions = [];
    room.correctGuesserIds = [];
    room.revealedIndices.clear();
    return { room, drawerId };
}
export function joinRoom(roomId, socketId, username, role = "player", now = Date.now()) {
    const room = rooms.get(roomId);
    if (!room)
        throw new RoomError("ROOM_NOT_FOUND", "Room not found");
    // Check if room has expired beyond the 24h abandoned window
    if (room.abandonedAt !== null && now - room.abandonedAt >= ABANDONED_MS) {
        rooms.delete(roomId);
        throw new RoomError("ROOM_ABANDONED", "Room has expired and is no longer available");
    }
    const existingPlayer = room.players.get(socketId);
    // Check total room capacity
    if (!existingPlayer && room.players.size >= MAX_CONNECTIONS) {
        throw new RoomError("ROOM_FULL", "Room is full (max 30 total connections)");
    }
    // Check role-specific capacity
    if (!existingPlayer || existingPlayer.role !== role) {
        if (role === "player" && getActivePlayerCount(room) >= MAX_ACTIVE_PLAYERS) {
            throw new RoomError("ACTIVE_PLAYERS_FULL", "Active player limit reached (max 15 active players)");
        }
        if (role === "spectator" && getSpectatorCount(room) >= MAX_SPECTATORS) {
            throw new RoomError("SPECTATORS_FULL", "Spectator limit reached (max 15 spectators)");
        }
    }
    const normalizedUser = validateUsername(username);
    if (isUsernameTaken(room, normalizedUser, socketId)) {
        throw new RoomError("USERNAME_TAKEN", "Username already taken in this room");
    }
    // If room was abandoned, re-activate it
    if (room.abandonedAt !== null) {
        room.abandonedAt = null;
    }
    // If room has no active owner or owner is missing, designate the joining player as owner
    if (!room.ownerId || !room.players.has(room.ownerId)) {
        room.ownerId = socketId;
    }
    room.players.set(socketId, {
        id: socketId,
        username: normalizedUser,
        role,
        score: existingPlayer?.score ?? 0,
        joinedAt: existingPlayer?.joinedAt ?? now,
    });
    return room;
}
export function addPlayerScore(roomId, socketId, points) {
    const room = rooms.get(roomId);
    if (!room)
        return;
    const player = room.players.get(socketId);
    if (player) {
        player.score += points;
    }
}
export function leaveRoom(roomId, socketId, now = Date.now()) {
    const room = rooms.get(roomId);
    if (!room)
        throw new RoomError("ROOM_NOT_FOUND", "Room not found");
    if (room.engine.removeQueuedPlayer(socketId)) {
        room.maxRounds = Math.max(room.game.roundNumber, room.maxRounds - 1);
    }
    room.players.delete(socketId);
    // If room is now empty, mark as abandoned
    if (room.players.size === 0) {
        room.abandonedAt = now;
        if (room.timerInterval) {
            clearInterval(room.timerInterval);
            delete room.timerInterval;
        }
        delete room.roundEndsAt;
        delete room.lastTimerBroadcastSecond;
        if (room.wordSelectionTimeout) {
            clearTimeout(room.wordSelectionTimeout);
            delete room.wordSelectionTimeout;
        }
    }
    else if (room.ownerId === socketId) {
        // Reassign ownership to earliest joined active player, or earliest spectator
        const remaining = [...room.players.values()].sort((a, b) => a.joinedAt - b.joinedAt);
        const nextOwner = remaining.find((p) => p.role === "player") || remaining[0];
        if (nextOwner) {
            room.ownerId = nextOwner.id;
        }
    }
    return room;
}
export function deleteRoom(roomId) {
    const room = rooms.get(roomId);
    if (room?.timerInterval) {
        clearInterval(room.timerInterval);
    }
    if (room?.wordSelectionTimeout) {
        clearTimeout(room.wordSelectionTimeout);
    }
    return rooms.delete(roomId);
}
export function getRoom(roomId) {
    if (!roomId)
        return undefined;
    return rooms.get(roomId);
}
export function markRoomCompleted(roomId, now = Date.now()) {
    const room = rooms.get(roomId);
    if (!room)
        throw new RoomError("ROOM_NOT_FOUND", "Room not found");
    room.completedAt = now;
    return room;
}
export function sweepExpired(now = Date.now()) {
    const expired = [];
    for (const [id, room] of rooms) {
        // 1. Abandoned rooms with 0 players for >= 24 hours
        const isAbandonedExpired = room.players.size === 0 &&
            room.abandonedAt !== null &&
            now - room.abandonedAt >= ABANDONED_MS;
        // 2. Completed rooms for >= 48 hours (2 days)
        const isCompletedExpired = room.completedAt !== null && now - room.completedAt >= COMPLETED_MS;
        if (isAbandonedExpired || isCompletedExpired) {
            deleteRoom(id);
            expired.push(id);
        }
    }
    return expired;
}
export function getTimeLeft(room, now = Date.now()) {
    return room.roundEndsAt === undefined ? 0 : calculateRemainingSeconds(room.roundEndsAt, now);
}
export function serializeRoom(room) {
    const serverNow = Date.now();
    return {
        id: room.id,
        name: room.name,
        ownerId: room.ownerId,
        players: [...room.players.values()],
        activePlayerCount: getActivePlayerCount(room),
        spectatorCount: getSpectatorCount(room),
        maxActivePlayers: MAX_ACTIVE_PLAYERS,
        maxSpectators: MAX_SPECTATORS,
        game: room.game,
        createdAt: room.createdAt,
        isAbandoned: room.abandonedAt !== null,
        isCompleted: room.completedAt !== null,
        timeLeft: getTimeLeft(room, serverNow),
        roundDurationSec: room.roundDurationSec,
        serverNow,
        ...(room.roundEndsAt !== undefined ? { roundEndsAt: room.roundEndsAt } : {}),
        correctGuesserCount: room.correctGuesserIds.length,
        maxRounds: room.maxRounds,
    };
}
export class RoomError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "RoomError";
    }
}
//# sourceMappingURL=rooms.js.map