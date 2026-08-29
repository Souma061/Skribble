import { randomUUID } from "node:crypto";
import { GameEngine } from "./game/GameEngine.js";
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
        throw new RoomError("INVALID_USERNAME", "Username must be 3–20 chars: letters, numbers, spaces, underscores");
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
        timeLeft: 0,
        correctGuesserIds: [],
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
    const eligiblePlayers = [...room.players.values()]
        .filter((p) => p.role === "player")
        .map((p) => p.id);
    if (eligiblePlayers.length === 0) {
        throw new RoomError("NO_ACTIVE_PLAYERS", "Need at least 1 active player to start the game");
    }
    const drawerId = room.engine.selectDrawer(eligiblePlayers);
    room.game = room.engine.getState();
    room.game.status = "WORD_SELECTION";
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
    room.players.delete(socketId);
    // If room is now empty, mark as abandoned
    if (room.players.size === 0) {
        room.abandonedAt = now;
        if (room.timerInterval) {
            clearInterval(room.timerInterval);
            delete room.timerInterval;
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
            rooms.delete(id);
            expired.push(id);
        }
    }
    return expired;
}
export function serializeRoom(room) {
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
        timeLeft: room.timeLeft,
        correctGuesserCount: room.correctGuesserIds.length,
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