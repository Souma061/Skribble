import { randomUUID } from "node:crypto";
import { GameEngine } from "./game/GameEngine.js";
import { calculateRemainingSeconds } from "./game/timerUtils.js";
export const MAX_ACTIVE_PLAYERS = 15;
export const MAX_SPECTATORS = 15;
export const MAX_CONNECTIONS = 30;
export const USERNAME_RE = /^[A-Za-z0-9 _]{3,20}$/;
export const ABANDONED_MS = 24 * 60 * 60 * 1000; // 24 hours
export const COMPLETED_MS = 2 * 24 * 60 * 60 * 1000; // 48 hours (2 days)
export const GRACE_MS = 120 * 1000; // reconnection window: ghosts evicted after 2 min
export const DRAWER_GRACE_MS = 30 * 1000; // drawer fuse: finish round if drawer gone 30s
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
export function isUsernameTaken(room, username, exceptToken) {
    if (!room)
        return false;
    const target = normalizeUsername(username).toLowerCase();
    return [...room.players.values()].some((p) => p.username.toLowerCase() === target && p.id !== exceptToken);
}
// Resolve the live player for a socket. Keys are tokens — never look up by socket id directly.
export function getPlayerBySocket(room, socketId) {
    for (const player of room.players.values()) {
        if (player.socketId === socketId)
            return player;
    }
    return undefined;
}
export function getActivePlayerCount(room) {
    let count = 0;
    for (const player of room.players.values()) {
        if (player.role === "player" && player.isConnected)
            count++;
    }
    return count;
}
export function getSpectatorCount(room) {
    let count = 0;
    for (const player of room.players.values()) {
        if (player.role === "spectator" && player.isConnected)
            count++;
    }
    return count;
}
export function getRoomCount() {
    return rooms.size;
}
// Public lobby listing: joinable rooms only (no empty or abandoned ghosts)
export function listRoomSummaries() {
    return [...rooms.values()]
        .filter((room) => room.players.size > 0 && room.abandonedAt === null)
        .map((room) => ({
        id: room.id,
        name: room.name,
        activePlayerCount: getActivePlayerCount(room),
        spectatorCount: getSpectatorCount(room),
        status: room.game.status,
        roundNumber: room.game.roundNumber,
    }))
        .sort((a, b) => b.activePlayerCount - a.activePlayerCount);
}
export function getTotalPlayerCount() {
    let count = 0;
    for (const room of rooms.values()) {
        count += room.players.size;
    }
    return count;
}
function generateRoomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}
export function createRoom(name, socketId, username, role = "player") {
    const normalizedUser = validateUsername(username);
    const now = Date.now();
    const engine = new GameEngine();
    const token = randomUUID();
    let roomId = generateRoomCode();
    while (rooms.has(roomId)) {
        roomId = generateRoomCode();
    }
    const room = {
        id: roomId,
        ownerId: token,
        name: name.trim() || `${normalizedUser}'s room`,
        players: new Map([
            [
                token,
                {
                    id: token,
                    socketId,
                    username: normalizedUser,
                    role,
                    score: 0,
                    joinedAt: now,
                    isConnected: true,
                    disconnectedAt: null,
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
        chatHistory: [],
    };
    rooms.set(room.id, room);
    return room;
}
export function startGame(roomId, socketId) {
    const room = rooms.get(roomId);
    if (!room)
        throw new RoomError("ROOM_NOT_FOUND", "Room not found");
    const caller = getPlayerBySocket(room, socketId);
    if (!caller || caller.id !== room.ownerId) {
        throw new RoomError("FORBIDDEN", "Only the room owner can start the game");
    }
    // Guard: cannot start while a round is live (WORD_SELECTION/ACTIVE_ROUND).
    // ROUND_ENDING is advanceable — that's how the next round begins.
    // COMPLETED/WAITING start (or restart) a fresh match.
    if (room.game.status === "ACTIVE_ROUND" || room.game.status === "WORD_SELECTION") {
        throw new RoomError("GAME_IN_PROGRESS", "A round is already in progress");
    }
    const eligiblePlayers = [...room.players.values()]
        .filter((p) => p.role === "player" && p.isConnected)
        .map((p) => p.socketId);
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
export function joinRoom(roomId, socketId, username, role = "player", now = Date.now(), playerToken) {
    const room = rooms.get(roomId);
    if (!room)
        throw new RoomError("ROOM_NOT_FOUND", "Room not found");
    // Check if room has expired beyond the 24h abandoned window
    if (room.abandonedAt !== null && now - room.abandonedAt >= ABANDONED_MS) {
        rooms.delete(roomId);
        throw new RoomError("ROOM_ABANDONED", "Room has expired and is no longer available");
    }
    // Revive path: a known token for a sleeping player reclaims its seat.
    // A token for an already-connected player is ignored (no hijacking).
    const ghost = playerToken ? room.players.get(playerToken) : undefined;
    if (ghost && !ghost.isConnected) {
        const oldSocketId = ghost.socketId;
        ghost.socketId = socketId;
        ghost.isConnected = true;
        ghost.disconnectedAt = null;
        // Live-round references are socket-id based: remap them to the new wire.
        // correctGuesserIds stores stable player tokens — no remap needed.
        if (room.game.currentDrawerId === oldSocketId) {
            room.game.currentDrawerId = socketId;
        }
        room.engine.swapQueuedPlayer(oldSocketId, socketId);
        if (room.abandonedAt !== null)
            room.abandonedAt = null;
        return room;
    }
    // Ghost seats don't count against capacity — only live connections do.
    const liveCount = [...room.players.values()].filter((p) => p.isConnected).length;
    if (liveCount >= MAX_CONNECTIONS) {
        throw new RoomError("ROOM_FULL", "Room is full (max 30 total connections)");
    }
    // Check role-specific capacity
    if (role === "player" && getActivePlayerCount(room) >= MAX_ACTIVE_PLAYERS) {
        throw new RoomError("ACTIVE_PLAYERS_FULL", "Active player limit reached (max 15 active players)");
    }
    if (role === "spectator" && getSpectatorCount(room) >= MAX_SPECTATORS) {
        throw new RoomError("SPECTATORS_FULL", "Spectator limit reached (max 15 spectators)");
    }
    const normalizedUser = validateUsername(username);
    if (isUsernameTaken(room, normalizedUser)) {
        throw new RoomError("USERNAME_TAKEN", "Username already taken in this room");
    }
    // If room was abandoned, re-activate it
    if (room.abandonedAt !== null) {
        room.abandonedAt = null;
    }
    const token = randomUUID();
    // If room has no active owner or owner is missing, designate the joining player as owner
    if (!room.ownerId || !room.players.has(room.ownerId)) {
        room.ownerId = token;
    }
    room.players.set(token, {
        id: token,
        socketId,
        username: normalizedUser,
        role,
        score: 0,
        joinedAt: now,
        isConnected: true,
        disconnectedAt: null,
    });
    return room;
}
export function addPlayerScore(roomId, socketId, points) {
    const room = rooms.get(roomId);
    if (!room)
        return;
    const player = getPlayerBySocket(room, socketId);
    if (player) {
        player.score += points;
    }
}
// Socket drop: player sleeps, everything is kept for the grace window.
export function markDisconnected(roomId, socketId, now = Date.now()) {
    const room = rooms.get(roomId);
    if (!room)
        throw new RoomError("ROOM_NOT_FOUND", "Room not found");
    const player = getPlayerBySocket(room, socketId);
    if (player && player.isConnected) {
        player.isConnected = false;
        player.disconnectedAt = now;
    }
    return room;
}
// Evict ghosts past the grace window. Returns affected room ids for broadcast.
export function pruneDisconnected(now = Date.now()) {
    const affected = [];
    for (const room of rooms.values()) {
        let changed = false;
        for (const [token, player] of room.players) {
            if (!player.isConnected && player.disconnectedAt !== null && now - player.disconnectedAt >= GRACE_MS) {
                if (room.engine.removeQueuedPlayer(player.socketId)) {
                    room.maxRounds = Math.max(room.game.roundNumber, room.maxRounds - 1);
                }
                room.players.delete(token);
                changed = true;
            }
        }
        if (changed) {
            if (room.ownerId && !room.players.has(room.ownerId)) {
                const remaining = [...room.players.values()].sort((a, b) => a.joinedAt - b.joinedAt);
                const nextOwner = remaining.find((p) => p.role === "player" && p.isConnected) ||
                    remaining.find((p) => p.isConnected) ||
                    remaining[0];
                if (nextOwner)
                    room.ownerId = nextOwner.id;
            }
            // No connected players left: room goes abandoned (timers torn down like empty leave)
            if (![...room.players.values()].some((p) => p.isConnected)) {
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
                if (room.drawerFuseTimeout) {
                    clearTimeout(room.drawerFuseTimeout);
                    delete room.drawerFuseTimeout;
                }
            }
            affected.push(room.id);
        }
    }
    return affected;
}
export function leaveRoom(roomId, socketId, now = Date.now()) {
    const room = rooms.get(roomId);
    if (!room)
        throw new RoomError("ROOM_NOT_FOUND", "Room not found");
    const player = getPlayerBySocket(room, socketId);
    if (player) {
        if (room.engine.removeQueuedPlayer(socketId)) {
            room.maxRounds = Math.max(room.game.roundNumber, room.maxRounds - 1);
        }
        room.players.delete(player.id);
    }
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
        if (room.drawerFuseTimeout) {
            clearTimeout(room.drawerFuseTimeout);
            delete room.drawerFuseTimeout;
        }
    }
    else if (player && room.ownerId === player.id) {
        // Reassign ownership to earliest joined connected active player, or earliest connected spectator
        const remaining = [...room.players.values()].sort((a, b) => a.joinedAt - b.joinedAt);
        const nextOwner = remaining.find((p) => p.role === "player" && p.isConnected) ||
            remaining.find((p) => p.isConnected) ||
            remaining[0];
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
    if (room?.drawerFuseTimeout) {
        clearTimeout(room.drawerFuseTimeout);
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