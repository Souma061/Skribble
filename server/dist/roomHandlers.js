import { Server, Socket } from "socket.io";
import { randomUUID } from "node:crypto";
import { RoomError, createRoom, deleteRoom, getRoom, isUsernameTaken, joinRoom, leaveRoom, serializeRoom, startGame, addPlayerScore, sweepExpired, validateUsername, } from "./rooms.js";
import { registerDrawHandlers, clearRoomStrokes } from "./drawHandlers.js";
import { dbCreateRoom, dbAddPlayer } from "./db.js";
import { generateMaskedWord, getLevenshteinDistance, getNextRevealIndex, } from "./game/wordUtils.js";
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
export function registerSocketHandlers(io) {
    io.on("connection", (socket) => {
        console.log(`Socket connected: ${socket.id}`);
        socket.on("disconnect", handleDisconnect(socket));
        socket.on("room:create", handleCreate(socket));
        socket.on("room:join", handleJoin(socket));
        socket.on("room:leave", handleLeave(socket));
        socket.on("room:delete", handleDelete(io, socket));
        socket.on("game:start", handleStartGame(io, socket));
        // Word Selection & Chat Guesses
        socket.on("round:set-word", handleSetWord(io, socket));
        socket.on("chat:send", handleChatSend(io, socket));
        // Register drawing stream handlers
        registerDrawHandlers(io, socket);
    });
    setInterval(() => {
        for (const roomId of sweepExpired()) {
            clearRoomStrokes(roomId);
            io.in(roomId).socketsLeave(roomId);
            console.log(`Room ${roomId} deleted (sweep expired)`);
        }
    }, SWEEP_INTERVAL_MS).unref();
}
function handleDisconnect(socket) {
    return () => {
        const roomId = socket.data.roomId;
        if (roomId) {
            try {
                const room = leaveRoom(roomId, socket.id);
                socket.to(roomId).emit("room:player-left", {
                    playerId: socket.id,
                    newOwnerId: room.ownerId,
                });
                socket.to(roomId).emit("room:state", serializeRoom(room));
            }
            catch {
                // room already gone; nothing to notify
            }
        }
        console.log(`Socket disconnected: ${socket.id}`);
    };
}
function handleCreate(socket) {
    return (payload) => {
        try {
            const username = validateUsername(payload.username ?? "");
            const roomName = (payload.roomName ?? "").trim() || `${username}'s room`;
            const role = payload.role === "spectator" ? "spectator" : "player";
            const room = createRoom(roomName, socket.id, username, role);
            joinSocketRoom(socket, room.id);
            socket.emit("room:created", { roomId: room.id, room: serializeRoom(room) });
            // Async DB Persistence
            dbCreateRoom(room.id, room.name, room.ownerId);
            dbAddPlayer(room.id, socket.id, username, role);
        }
        catch (err) {
            emitError(socket, err);
        }
    };
}
function handleJoin(socket) {
    return (payload) => {
        try {
            const username = validateUsername(payload.username ?? "");
            const roomId = payload.roomId ?? "";
            const role = payload.role === "spectator" ? "spectator" : "player";
            if (isUsernameTaken(getRoom(roomId), username, socket.id)) {
                throw new RoomError("USERNAME_TAKEN", "Username already taken in this room");
            }
            const room = joinRoom(roomId, socket.id, username, role);
            const player = room.players.get(socket.id);
            socket.to(room.id).emit("room:player-joined", { player });
            socket.to(room.id).emit("room:state", serializeRoom(room));
            joinSocketRoom(socket, room.id);
            socket.emit("room:joined", { roomId: room.id, room: serializeRoom(room) });
            // Async DB Persistence
            dbAddPlayer(room.id, socket.id, username, role);
        }
        catch (err) {
            emitError(socket, err);
        }
    };
}
function handleLeave(socket) {
    return () => {
        const roomId = socket.data.roomId;
        if (!roomId)
            return;
        try {
            const room = leaveRoom(roomId, socket.id);
            socket.leave(roomId);
            delete socket.data.roomId;
            socket.emit("room:left", {});
            socket.to(roomId).emit("room:player-left", {
                playerId: socket.id,
                newOwnerId: room.ownerId,
            });
            socket.to(roomId).emit("room:state", serializeRoom(room));
        }
        catch (err) {
            emitError(socket, err);
        }
    };
}
function handleDelete(io, socket) {
    return () => {
        const roomId = socket.data.roomId;
        if (!roomId)
            return;
        try {
            const room = getRoom(roomId);
            if (!room)
                throw new RoomError("ROOM_NOT_FOUND", "Room not found");
            if (room.ownerId !== socket.id) {
                throw new RoomError("FORBIDDEN", "Only the room owner can delete the room");
            }
            deleteRoom(roomId);
            clearRoomStrokes(roomId);
            io.to(roomId).emit("room:deleted", {});
            io.in(roomId).socketsLeave(roomId);
        }
        catch (err) {
            emitError(socket, err);
        }
    };
}
function handleStartGame(io, socket) {
    return () => {
        const roomId = socket.data.roomId;
        if (!roomId)
            return;
        try {
            const { room, drawerId } = startGame(roomId, socket.id);
            // Clear any strokes from lobby or prior rounds
            clearRoomStrokes(roomId);
            io.to(roomId).emit("draw:clear");
            // Broadcast new room state (roundNumber, currentDrawerId, WORD_SELECTION)
            io.to(roomId).emit("room:state", serializeRoom(room));
            io.to(roomId).emit("game:started", {
                drawerId,
                roundNumber: room.game.roundNumber,
            });
            // Prompt the drawer for word choice
            io.to(drawerId).emit("round:prompt-word", {
                suggestions: ["Sunflower", "Pizza", "Guitar", "Rocket", "Cat", "Castle", "Dragon"],
            });
            const drawer = room.players.get(drawerId);
            console.log(`Game started in room ${roomId}. Drawer is: ${drawer?.username} (${drawerId})`);
        }
        catch (err) {
            emitError(socket, err);
        }
    };
}
function handleSetWord(io, socket) {
    return (payload) => {
        const roomId = socket.data.roomId;
        const room = getRoom(roomId);
        if (!room || room.game.currentDrawerId !== socket.id || !payload.word?.trim())
            return;
        const word = payload.word.trim();
        const hint = (payload.hint ?? "").trim();
        room.currentWord = word;
        room.currentHint = hint;
        room.game.status = "ACTIVE_ROUND";
        room.revealedIndices.clear();
        room.correctGuesserIds = [];
        // Emit secret word to drawer
        socket.emit("round:word-assigned", {
            word,
            hint,
            timeLeft: 80,
        });
        // Emit masked word to guessers
        const blanks = generateMaskedWord(word, room.revealedIndices);
        socket.to(room.id).emit("round:word-masked", {
            blanks,
            letterCount: word.length,
            hint,
            timeLeft: 80,
        });
        io.to(room.id).emit("room:state", serializeRoom(room));
        // Start 80s Countdown Loop
        startRoundTimer(io, room.id);
    };
}
function startRoundTimer(io, roomId) {
    const room = getRoom(roomId);
    if (!room)
        return;
    if (room.timerInterval)
        clearInterval(room.timerInterval);
    room.timeLeft = 80;
    room.timerInterval = setInterval(() => {
        room.timeLeft -= 1;
        // Broadcast 1s tick
        io.to(roomId).emit("timer:tick", { timeLeft: room.timeLeft });
        // 1st Letter Reveal at 40s (50% mark)
        if (room.timeLeft === 40 && room.currentWord) {
            const idx = getNextRevealIndex(room.currentWord, room.revealedIndices);
            if (idx !== null) {
                room.revealedIndices.add(idx);
                const blanks = generateMaskedWord(room.currentWord, room.revealedIndices);
                io.to(roomId).emit("round:hint-reveal", { blanks });
            }
        }
        // 2nd Letter Reveal at 20s (25% mark)
        if (room.timeLeft === 20 && room.currentWord) {
            const idx = getNextRevealIndex(room.currentWord, room.revealedIndices);
            if (idx !== null) {
                room.revealedIndices.add(idx);
                const blanks = generateMaskedWord(room.currentWord, room.revealedIndices);
                io.to(roomId).emit("round:hint-reveal", { blanks });
            }
        }
        // Round Ends
        if (room.timeLeft <= 0) {
            clearInterval(room.timerInterval);
            delete room.timerInterval;
            finishRound(io, roomId, "Time's up!");
        }
    }, 1000);
}
function handleChatSend(io, socket) {
    return (payload) => {
        const roomId = socket.data.roomId;
        const room = getRoom(roomId);
        if (!room || !payload.message?.trim())
            return;
        const guess = payload.message.trim().toLowerCase();
        const secret = (room.currentWord ?? "").toLowerCase();
        const player = room.players.get(socket.id);
        const username = player?.username || "Guest";
        // If active round and sender is an active guesser
        if (room.game.status === "ACTIVE_ROUND" &&
            room.currentWord &&
            socket.id !== room.game.currentDrawerId &&
            !room.correctGuesserIds.includes(socket.id)) {
            // 1. EXACT MATCH
            if (guess === secret) {
                room.correctGuesserIds.push(socket.id);
                const points = 100 + (room.timeLeft * 2);
                addPlayerScore(room.id, socket.id, points);
                if (room.game.currentDrawerId) {
                    addPlayerScore(room.id, room.game.currentDrawerId, 50); // Drawer bonus
                }
                // Notify guesser & update room scores
                socket.emit("guess:correct", { points, word: room.currentWord });
                io.to(room.id).emit("room:state", serializeRoom(room));
                io.to(room.id).emit("chat:message", {
                    id: randomUUID(),
                    username: "System",
                    message: `🎉 ${username} guessed the word! (+${points} pts)`,
                    type: "CORRECT_GUESS",
                });
                // Check if all guessers have finished
                const activeGuessers = [...room.players.values()].filter((p) => p.role === "player" && p.id !== room.game.currentDrawerId);
                if (room.correctGuesserIds.length >= activeGuessers.length) {
                    if (room.timerInterval)
                        clearInterval(room.timerInterval);
                    delete room.timerInterval;
                    finishRound(io, room.id, "All players guessed correctly!");
                }
                return;
            }
            // 2. CLOSE GUESS (1 letter typo away)
            if (getLevenshteinDistance(guess, secret) === 1) {
                socket.emit("guess:close", {
                    message: `"${payload.message.trim()}" is so close! Check spelling!`,
                });
                return; // Don't broadcast typo to public chat
            }
        }
        // Standard Chat Message
        io.to(room.id).emit("chat:message", {
            id: randomUUID(),
            username,
            message: payload.message.trim(),
            type: "CHAT",
        });
    };
}
function finishRound(io, roomId, reason) {
    const room = getRoom(roomId);
    if (!room)
        return;
    room.game.status = "ROUND_ENDING";
    io.to(roomId).emit("room:state", serializeRoom(room));
    io.to(roomId).emit("round:ended", {
        word: room.currentWord,
        reason,
    });
}
function joinSocketRoom(socket, roomId) {
    socket.join(roomId);
    socket.data.roomId = roomId;
}
function emitError(socket, err) {
    if (err instanceof RoomError) {
        socket.emit("room:error", { code: err.code, message: err.message });
    }
    else {
        console.error(err);
        socket.emit("room:error", { code: "INTERNAL", message: "Something went wrong" });
    }
}
//# sourceMappingURL=roomHandlers.js.map