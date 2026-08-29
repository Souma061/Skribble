import { Server, Socket } from "socket.io";
import { randomUUID } from "node:crypto";
import {
  type PlayerRole,
  RoomError,
  createRoom,
  deleteRoom,
  getRoom,
  isUsernameTaken,
  joinRoom,
  leaveRoom,
  markRoomCompleted,
  serializeRoom,
  startGame,
  addPlayerScore,
  sweepExpired,
  validateUsername,
} from "./rooms.js";
import { registerDrawHandlers, clearRoomStrokes } from "./drawHandlers.js";
import { dbCreateRoom, dbAddPlayer, dbGetRandomWords, rateLimit, socketCleanup } from "./db.js";
import {
  generateMaskedWord,
  getLevenshteinDistance,
  getNextRevealIndex,
} from "./game/wordUtils.js";

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const ROUND_DURATION_S = 120; // PRD §30: 120-second rounds

export function registerSocketHandlers(io: Server) {
  io.on("connection", (socket) => {
    console.log(`Socket connected: ${socket.id}`);
    socket.on("disconnect", handleDisconnect(socket));

    // Room lifecycle — max 5/min each
    socket.on("room:create", (payload) => {
      if (!rateLimit(socket.id, "room:create", 5, 60_000)) return;
      handleCreate(socket)(payload);
    });
    socket.on("room:join", (payload) => {
      if (!rateLimit(socket.id, "room:join", 10, 60_000)) return;
      handleJoin(socket)(payload);
    });
    socket.on("room:leave", () => {
      if (!rateLimit(socket.id, "room:leave", 10, 60_000)) return;
      handleLeave(socket)();
    });
    socket.on("room:delete", () => {
      if (!rateLimit(socket.id, "room:delete", 5, 60_000)) return;
      handleDelete(io, socket)();
    });

    // Game flow — max 10/min
    socket.on("game:start", () => {
      if (!rateLimit(socket.id, "game:start", 10, 60_000)) return;
      handleStartGame(io, socket)();
    });
    socket.on("round:set-word", (payload) => {
      if (!rateLimit(socket.id, "round:set-word", 5, 60_000)) return;
      handleSetWord(io, socket)(payload);
    });

    // Chat — max 3 per second
    socket.on("chat:send", (payload) => {
      if (!rateLimit(socket.id, "chat:send", 3, 1_000)) return;
      handleChatSend(io, socket)(payload);
    });

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

function handleDisconnect(socket: Socket) {
  return () => {
    const roomId = socket.data.roomId as string | undefined;
    if (roomId) {
      try {
        const room = leaveRoom(roomId, socket.id);
        socket.to(roomId).emit("room:player-left", {
          playerId: socket.id,
          newOwnerId: room.ownerId,
        });
        socket.to(roomId).emit("room:state", serializeRoom(room));
      } catch {
        // room already gone; nothing to notify
      } finally {
        // Always clear the stale reference (B-1)
        delete socket.data.roomId;
      }
    }
    // Release per-socket rate-limit buckets (S-2 cleanup)
    socketCleanup(socket.id);
    console.log(`Socket disconnected: ${socket.id}`);
  };
}

function handleCreate(socket: Socket) {
  return (payload: { roomName?: string; username?: string; role?: PlayerRole }) => {
    try {
      const username = validateUsername(payload.username ?? "");
      const roomName = (payload.roomName ?? "").trim().slice(0, 50) || `${username}'s room`;
      const role: PlayerRole = payload.role === "spectator" ? "spectator" : "player";
      const room = createRoom(roomName, socket.id, username, role);
      joinSocketRoom(socket, room.id);
      socket.emit("room:created", { roomId: room.id, room: serializeRoom(room) });

      // Async DB Persistence: sequence room creation before adding initial player
      dbCreateRoom(room.id, room.name, room.ownerId).then(() => {
        dbAddPlayer(room.id, socket.id, username, role);
      });
    } catch (err) {
      emitError(socket, err);
    }
  };
}

function handleJoin(socket: Socket) {
  return (payload: { roomId?: string; username?: string; role?: PlayerRole }) => {
    try {
      const username = validateUsername(payload.username ?? "");
      const roomId = payload.roomId ?? "";
      const role: PlayerRole = payload.role === "spectator" ? "spectator" : "player";

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
    } catch (err) {
      emitError(socket, err);
    }
  };
}

function handleLeave(socket: Socket) {
  return () => {
    const roomId = socket.data.roomId as string | undefined;
    if (!roomId) return;
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
    } catch (err) {
      emitError(socket, err);
    }
  };
}

function handleDelete(io: Server, socket: Socket) {
  return () => {
    const roomId = socket.data.roomId as string | undefined;
    if (!roomId) return;
    try {
      const room = getRoom(roomId);
      if (!room) throw new RoomError("ROOM_NOT_FOUND", "Room not found");
      if (room.ownerId !== socket.id) {
        throw new RoomError("FORBIDDEN", "Only the room owner can delete the room");
      }
      deleteRoom(roomId);
      clearRoomStrokes(roomId);
      io.to(roomId).emit("room:deleted", {});
      io.in(roomId).socketsLeave(roomId);
    } catch (err) {
      emitError(socket, err);
    }
  };
}

function handleStartGame(io: Server, socket: Socket) {
  return async () => {
    const roomId = socket.data.roomId as string | undefined;
    if (!roomId) return;
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

      // Fetch word suggestions from DB; fall back to defaults if unavailable
      const FALLBACK_WORDS = ["Sunflower", "Pizza", "Guitar", "Rocket", "Cat", "Castle", "Dragon"];
      const dbWords = await dbGetRandomWords(7);
      const suggestions = dbWords.length >= 3 ? dbWords : FALLBACK_WORDS;

      // Prompt the drawer for word choice
      io.to(drawerId).emit("round:prompt-word", { suggestions });

      const drawer = room.players.get(drawerId);
      console.log(`Game started in room ${roomId}. Drawer: ${drawer?.username} (${drawerId})`);
    } catch (err) {
      emitError(socket, err);
    }
  };
}

function handleSetWord(io: Server, socket: Socket) {
  return (payload: { word: string; hint?: string }) => {
    const roomId = socket.data.roomId as string | undefined;
    const room = getRoom(roomId);
    if (!room || room.game.currentDrawerId !== socket.id || !payload.word?.trim()) return;

    // Only allow during the word-selection phase (guards against mid-round manipulation)
    if (room.game.status !== "WORD_SELECTION") return;

    const word = payload.word.trim().slice(0, 50); // cap at 50 characters (S-4)
    const hint = (payload.hint ?? "").trim().slice(0, 100);

    room.currentWord = word;
    room.currentHint = hint;
    room.game.status = "ACTIVE_ROUND";
    room.revealedIndices.clear();
    room.correctGuesserIds = [];

    // Emit secret word to drawer
    socket.emit("round:word-assigned", {
      word,
      hint,
      timeLeft: ROUND_DURATION_S,
    });

    // Emit masked word to guessers
    const blanks = generateMaskedWord(word, room.revealedIndices);
    socket.to(room.id).emit("round:word-masked", {
      blanks,
      letterCount: word.length,
      hint,
      timeLeft: ROUND_DURATION_S,
    });

    io.to(room.id).emit("room:state", serializeRoom(room));

    // Start countdown loop
    startRoundTimer(io, room.id);
  };
}

function startRoundTimer(io: Server, roomId: string) {
  const room = getRoom(roomId);
  if (!room) return;

  if (room.timerInterval) clearInterval(room.timerInterval);
  room.timeLeft = ROUND_DURATION_S;

  room.timerInterval = setInterval(() => {
    room.timeLeft -= 1;

    // Broadcast 1s tick
    io.to(roomId).emit("timer:tick", { timeLeft: room.timeLeft });

    // 1st Letter Reveal at 60s (50% of 120s)
    if (room.timeLeft === 60 && room.currentWord) {
      const idx = getNextRevealIndex(room.currentWord, room.revealedIndices);
      if (idx !== null) {
        room.revealedIndices.add(idx);
        const blanks = generateMaskedWord(room.currentWord, room.revealedIndices);
        io.to(roomId).emit("round:hint-reveal", { blanks });
      }
    }

    // 2nd Letter Reveal at 30s (25% of 120s)
    if (room.timeLeft === 30 && room.currentWord) {
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

function handleChatSend(io: Server, socket: Socket) {
  return (payload: { message?: string }) => {
    const roomId = socket.data.roomId as string | undefined;
    const room = getRoom(roomId);
    if (!room || typeof payload?.message !== "string" || !payload.message.trim()) return;

    // Cap chat message to 200 characters max to prevent payload abuse
    const rawMessage = payload.message.trim().slice(0, 200);
    const guess = rawMessage.toLowerCase();
    const secret = (room.currentWord ?? "").toLowerCase();
    const player = room.players.get(socket.id);
    const username = player?.username || "Guest";

    // If active round and sender is an active player (not drawer or spectator)
    if (
      room.game.status === "ACTIVE_ROUND" &&
      room.currentWord &&
      player?.role === "player" &&
      socket.id !== room.game.currentDrawerId &&
      !room.correctGuesserIds.includes(socket.id)
    ) {
      // 1. EXACT MATCH
      if (guess === secret) {
        room.correctGuesserIds.push(socket.id);
        const points = 100 + (room.timeLeft * 2);

        addPlayerScore(room.id, socket.id, points);

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
        const activeGuessers = [...room.players.values()].filter(
          (p) => p.role === "player" && p.id !== room.game.currentDrawerId
        );

        if (room.correctGuesserIds.length >= activeGuessers.length) {
          if (room.timerInterval) clearInterval(room.timerInterval);
          delete room.timerInterval;
          finishRound(io, room.id, "All players guessed correctly!");
        }
        return;
      }

      // 2. CLOSE GUESS (1 letter typo away, skip computation if length difference > 1)
      if (Math.abs(guess.length - secret.length) <= 1 && getLevenshteinDistance(guess, secret) === 1) {
        socket.emit("guess:close", {
          message: `"${rawMessage}" is so close! Check spelling!`,
        });
        return; // Don't broadcast typo to public chat
      }
    }

    // Standard Chat Message
    io.to(room.id).emit("chat:message", {
      id: randomUUID(),
      username,
      message: rawMessage,
      type: "CHAT",
    });
  };
}

function finishRound(io: Server, roomId: string, reason: string) {
  const room = getRoom(roomId);
  if (!room) return;

  // Flat drawer bonus — awarded once per round if at least one guesser got it right (B-4)
  if (room.correctGuesserIds.length > 0 && room.game.currentDrawerId) {
    addPlayerScore(room.id, room.game.currentDrawerId, 50);
  }

  // Transition to COMPLETED on the final round, ROUND_ENDING otherwise (B-6)
  const isGameOver = room.maxRounds > 0 && room.game.roundNumber >= room.maxRounds;

  if (isGameOver) {
    room.game.status = "COMPLETED";
    markRoomCompleted(roomId);
  } else {
    room.game.status = "ROUND_ENDING";
  }

  io.to(roomId).emit("room:state", serializeRoom(room));
  io.to(roomId).emit("round:ended", {
    word: room.currentWord,
    reason,
  });
}

function joinSocketRoom(socket: Socket, roomId: string) {
  socket.join(roomId);
  socket.data.roomId = roomId;
}

function emitError(socket: Socket, err: unknown) {
  if (err instanceof RoomError) {
    socket.emit("room:error", { code: err.code, message: err.message });
  } else {
    console.error(err);
    socket.emit("room:error", { code: "INTERNAL", message: "Something went wrong" });
  }
}
