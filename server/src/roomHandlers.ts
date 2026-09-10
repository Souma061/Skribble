import { randomUUID } from "node:crypto";
import { Server, Socket } from "socket.io";
import {
  dbAddPlayer,
  dbClearRoomAbandoned,
  dbCreateRoom,
  dbCreateRound,
  dbDeleteRoom,
  dbFinishRound,
  dbGetRandomWords,
  dbSaveChatMessage,
  dbSaveCorrectGuess,
  dbSaveRoundStrokesBatch,
  dbSetRoomAbandoned,
  dbUpdatePlayerConnection,
  dbUpdatePlayerScore,
  dbUpdateRoomStatus,
  rateLimit,
  socketCleanup,
} from "./db.js";
import { clearRoomStrokes, getRoomStrokes, registerDrawHandlers } from "./drawHandlers.js";
import { calculateRemainingSeconds, crossedTimeThreshold } from "./game/timerUtils.js";
import {
  doesMessageRevealWord,
  findAllowedWord,
  generateMaskedWord,
  getLevenshteinDistance,
  getNextRevealIndex,
  isExactWordMatch,
  validateCustomWord,
} from "./game/wordUtils.js";
import {
  type PlayerRole,
  DRAWER_GRACE_MS,
  RoomError,
  addPlayerScore,
  createRoom,
  deleteRoom,
  getPlayerBySocket,
  getRoom,
  getTimeLeft,
  isUsernameTaken,
  joinRoom,
  leaveRoom,
  listRoomSummaries,
  markDisconnected,
  markRoomCompleted,
  pruneDisconnected,
  serializeRoom,
  startGame,
  sweepExpired,
  validateUsername,
} from "./rooms.js";
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = 30 * 1000; // evict ghosts past their grace window
const ROUND_DURATION_S = 120; // PRD §30: 120-second rounds
const WORD_SELECTION_DURATION_MS = 20_000;

export function registerSocketHandlers(io: Server) {
  io.on("connection", (socket) => {
    console.log(`Socket connected: ${socket.id}`);
    socket.on("disconnect", handleDisconnect(io, socket));

    // Room lifecycle — max 5/min each
    socket.on("room:create", (payload) => {
      if (!rateLimit(socket.id, "room:create", 5, 60_000)) return;
      handleCreate(io, socket)(payload);
    });
    socket.on("room:join", (payload) => {
      if (!rateLimit(socket.id, "room:join", 10, 60_000)) return;
      handleJoin(io, socket)(payload);
    });
    socket.on("room:list", () => {
      if (!rateLimit(socket.id, "room:list", 10, 60_000)) return;
      socket.emit("room:list", { rooms: listRoomSummaries() });
    });
    socket.on("room:leave", () => {
      if (!rateLimit(socket.id, "room:leave", 10, 60_000)) return;
      handleLeave(io, socket)();
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

    socket.on("chat:request-sync", () => {
      if (!rateLimit(socket.id, "chat:request-sync", 10, 60_000)) return;
      const roomId = socket.data.roomId as string | undefined;
      const room = getRoom(roomId);
      if (room) {
        socket.emit("chat:history", { history: room.chatHistory || [] });
      }
    });

    // Register drawing stream handlers
    registerDrawHandlers(io, socket);
  });

  setInterval(() => {
    const expired = sweepExpired();
    if (expired.length > 0) {
      for (const roomId of expired) {
        clearRoomStrokes(roomId);
        io.in(roomId).socketsLeave(roomId);
        clearStaleRoomRef(io, roomId);
        dbDeleteRoom(roomId).catch((err) => console.error("[DB] Failed to delete swept room:", err));
        console.log(`Room ${roomId} deleted (sweep expired)`);
      }
      broadcastRoomList(io);
    }
  }, SWEEP_INTERVAL_MS).unref();

  // Ghost eviction: cheap pass, only broadcasts rooms that actually changed.
  setInterval(() => {
    let changed = false;
    for (const roomId of pruneDisconnected()) {
      const room = getRoom(roomId);
      if (room) {
        io.to(roomId).emit("room:state", serializeRoom(room));
        if (room.abandonedAt !== null) {
          dbSetRoomAbandoned(roomId, new Date(room.abandonedAt)).catch((err) =>
            console.error("[DB] Failed to set room abandoned on prune:", err),
          );
        }
      }
      changed = true;
    }
    if (changed) broadcastRoomList(io);
  }, PRUNE_INTERVAL_MS).unref();
}

// Push the lobby list to sockets not currently in a room.
// Called on every membership change so the lobby is live without refresh.
function broadcastRoomList(io: Server) {
  const payload = { rooms: listRoomSummaries() };
  for (const [, s] of io.sockets.sockets) {
    if (!s.data.roomId) s.emit("room:list", payload);
  }
}

// After a room is destroyed server-side, members still carry the dead
// roomId on their socket — clear it so they keep receiving lobby pushes.
function clearStaleRoomRef(io: Server, roomId: string) {
  for (const [, s] of io.sockets.sockets) {
    if (s.data.roomId === roomId) delete s.data.roomId;
  }
}

function handleDisconnect(io: Server, socket: Socket) {
  return () => {
    const roomId = socket.data.roomId as string | undefined;
    if (roomId) {
      try {
        // Sleep, don't delete: the player keeps seat/score for the grace window.
        const before = getRoom(roomId);
        const me = before ? getPlayerBySocket(before, socket.id) : undefined;
        const token = me?.id;
        const wasDrawer =
          !!before &&
          !!token &&
          before.game.currentDrawerId === token &&
          (before.game.status === "WORD_SELECTION" || before.game.status === "ACTIVE_ROUND");
        const room = markDisconnected(roomId, socket.id);
        socket.to(roomId).emit("room:state", serializeRoom(room));

        if (token) {
          dbUpdatePlayerConnection(roomId, token, false).catch((err) =>
            console.error("[DB] Failed to update player disconnect:", err),
          );
        }

        // Bug 1 fix: disconnecting guesser may have been the last one holding up the round.
        // Recheck after marking them offline so the round ends instead of timing out.
        if (
          room.game.status === "ACTIVE_ROUND" &&
          room.currentWord
        ) {
          const liveGuessers = [...room.players.values()].filter(
            (p) => p.isConnected && p.role === "player" && p.id !== room.game.currentDrawerId,
          );
          const allGuessed =
            liveGuessers.length > 0 &&
            liveGuessers.every((p) => room.correctGuesserIds.includes(p.id));
          if (allGuessed) {
            finishRound(io, roomId, "Everyone guessed the word!");
          }
        }

        // Drawer fuse: round continues for a quick blip, ends if truly gone.
        if (wasDrawer && token) {
          if (room.drawerFuseTimeout) clearTimeout(room.drawerFuseTimeout);
          room.drawerFuseTimeout = setTimeout(() => {
            const r = getRoom(roomId);
            const ghost = r?.players.get(token);
            if (
              r &&
              ghost &&
              !ghost.isConnected &&
              r.game.currentDrawerId === token &&
              (r.game.status === "WORD_SELECTION" || r.game.status === "ACTIVE_ROUND")
            ) {
              finishRound(io, roomId, "The drawer left the round");
            }
          }, DRAWER_GRACE_MS);
          room.drawerFuseTimeout.unref();
        }
      } catch {
        // room already gone; nothing to notify
      } finally {
        // Always clear the stale reference (B-1)
        delete socket.data.roomId;
        broadcastRoomList(io);
      }
    }
    // Release per-socket rate-limit buckets (S-2 cleanup)
    socketCleanup(socket.id);
    console.log(`Socket disconnected: ${socket.id}`);
  };
}

function handleCreate(io: Server, socket: Socket) {
  return (payload: { roomName?: string; username?: string; role?: PlayerRole }) => {
    try {
      const username = validateUsername(payload.username ?? "");
      const roomName = (payload.roomName ?? "").trim().slice(0, 50) || `${username}'s room`;
      const role: PlayerRole = payload.role === "spectator" ? "spectator" : "player";
      const room = createRoom(roomName, socket.id, username, role);
      const me = getPlayerBySocket(room, socket.id);
      joinSocketRoom(socket, room.id);
      socket.emit("room:created", { roomId: room.id, room: serializeRoom(room), playerToken: me?.id });
      broadcastRoomList(io);

      // Async DB Persistence: sequence room creation before adding initial player
      dbCreateRoom(room.id, room.name, room.ownerId)
        .then(() => me && dbAddPlayer(room.id, me.id, socket.id, username, role))
        .catch((err) => console.error("[DB] Failed to persist room creation:", err));
    } catch (err) {
      emitError(socket, err);
    }
  };
}

function handleJoin(io: Server, socket: Socket) {
  return (payload: { roomId?: string; username?: string; role?: PlayerRole; playerToken?: string }) => {
    try {
      const username = validateUsername(payload.username ?? "");
      const roomId = payload.roomId ?? "";
      const role: PlayerRole = payload.role === "spectator" ? "spectator" : "player";

      // Revive path bypasses the name check (it's their own seat); everyone else is checked.
      const existingRoom = getRoom(roomId);
      const existingPlayer = payload.playerToken ? existingRoom?.players.get(payload.playerToken) : undefined;
      const isRevive = !!existingPlayer;

      if (!isRevive && isUsernameTaken(existingRoom, username, payload.playerToken)) {
        throw new RoomError("USERNAME_TAKEN", "Username already taken in this room");
      }

      // If reviving with a lingering old socket (e.g. fast browser refresh), detach old socket cleanly
      if (existingPlayer && existingPlayer.socketId && existingPlayer.socketId !== socket.id) {
        const oldSocket = io.sockets.sockets.get(existingPlayer.socketId);
        if (oldSocket) {
          delete oldSocket.data.roomId;
          oldSocket.leave(roomId);
        }
      }

      const room = joinRoom(roomId, socket.id, username, role, Date.now(), payload.playerToken);
      const me = getPlayerBySocket(room, socket.id);

      socket.to(room.id).emit("room:player-joined", { player: me });
      socket.to(room.id).emit("room:state", serializeRoom(room));
      joinSocketRoom(socket, room.id);
      socket.emit("room:joined", { roomId: room.id, room: serializeRoom(room), playerToken: me?.id });
      socket.emit("chat:history", { history: room.chatHistory || [] });
      broadcastRoomList(io);

      const isDrawer = !!me && room.game.currentDrawerId === me.id;

      // Revived drawer is back: cancel the fuse, round continues.
      if (room.drawerFuseTimeout && isDrawer) {
        clearTimeout(room.drawerFuseTimeout);
        delete room.drawerFuseTimeout;
      }

      // Bug 3 fix: re-emit round state to a reviving player so they see the current word/blanks.
      // room:joined carries room.game but not the per-round word payloads.
      if (isRevive && room.game.status === "WORD_SELECTION" && isDrawer) {
        socket.emit("round:prompt-word", {
          suggestions: room.wordSuggestions,
          timeLimitSeconds: WORD_SELECTION_DURATION_MS / 1000,
        });
      }

      if (isRevive && room.game.status === "ACTIVE_ROUND" && room.currentWord) {
        const serverNow = Date.now();
        const timerSync = {
          timeLeft: getTimeLeft(room, serverNow),
          roundEndsAt: room.roundEndsAt,
          roundDurationSec: room.roundDurationSec,
          serverNow,
        };
        if (isDrawer) {
          // Drawer gets the real word back
          socket.emit("round:word-assigned", {
            word: room.currentWord,
            hint: room.currentHint ?? "",
            ...timerSync,
          });
        } else {
          // Guessers get the current blanks + any revealed letters
          const blanks = generateMaskedWord(room.currentWord, room.revealedIndices);
          socket.emit("round:word-masked", {
            blanks,
            letterCount: room.currentWord.length,
            hint: room.currentHint ?? "",
            ...timerSync,
          });
        }
      }

      // Async DB Persistence (upsert — safe to call on revive, updates socketId in DB)
      if (me) {
        dbAddPlayer(room.id, me.id, socket.id, me.username, me.role).catch((err) =>
          console.error("[DB] Failed to persist player on join:", err),
        );
        dbUpdatePlayerConnection(room.id, me.id, true).catch((err) =>
          console.error("[DB] Failed to update player connection on join:", err),
        );
      }
      if (room.abandonedAt === null) {
        dbClearRoomAbandoned(room.id).catch((err) =>
          console.error("[DB] Failed to clear room abandoned on join:", err),
        );
      }
    } catch (err) {
      emitError(socket, err);
    }
  };
}

function handleLeave(io: Server, socket: Socket) {
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
      broadcastRoomList(io);
      if (shouldFinishAfterDrawerDeparture(room, socket.id)) {
        finishRound(io, roomId, "The drawer left the round");
      } else {
        socket.to(roomId).emit("room:state", serializeRoom(room));
      }
      if (room.abandonedAt !== null) {
        dbSetRoomAbandoned(roomId, new Date(room.abandonedAt)).catch((err) =>
          console.error("[DB] Failed to set room abandoned on leave:", err),
        );
      }
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
      const me = getPlayerBySocket(room, socket.id);
      if (!me || me.id !== room.ownerId) {
        throw new RoomError("FORBIDDEN", "Only the room owner can delete the room");
      }
      deleteRoom(roomId);
      clearRoomStrokes(roomId);
      io.to(roomId).emit("room:deleted", {});
      io.in(roomId).socketsLeave(roomId);
      clearStaleRoomRef(io, roomId);
      broadcastRoomList(io);

      dbDeleteRoom(roomId).catch((err) =>
        console.error("[DB] Failed to delete room on owner delete:", err),
      );
    } catch (err) {
      emitError(socket, err);
    }
  };
}

async function startRoundFlow(io: Server, roomId: string, socketId?: string) {
  const { room, drawerId } = startGame(roomId, socketId);
  // Clear any strokes from lobby or prior rounds
  clearRoomStrokes(roomId);
  io.to(roomId).emit("draw:clear");

  // Broadcast new room state (roundNumber, currentDrawerId, WORD_SELECTION)
  io.to(roomId).emit("room:state", serializeRoom(room));
  io.to(roomId).emit("game:started", {
    drawerId,
    roundNumber: room.game.roundNumber,
  });

  dbUpdateRoomStatus(roomId, "WORD_SELECTION").catch((err) =>
    console.error("[DB] Failed to set room status WORD_SELECTION:", err),
  );

  // Fetch word suggestions from DB; fall back to defaults if unavailable
  const FALLBACK_WORDS = ["Sunflower", "Pizza", "Guitar", "Rocket", "Cat", "Castle", "Dragon"];
  const dbWords = await dbGetRandomWords(7);
  const suggestions = dbWords.length >= 3 ? dbWords : FALLBACK_WORDS;

  const currentRoom = getRoom(roomId);
  if (
    !currentRoom ||
    currentRoom.game.status !== "WORD_SELECTION" ||
    currentRoom.game.currentDrawerId !== drawerId
  ) {
    return;
  }

  currentRoom.wordSuggestions = suggestions;
  const drawer = currentRoom.players.get(drawerId);
  if (drawer?.socketId) {
    io.to(drawer.socketId).emit("round:prompt-word", {
      suggestions,
      timeLimitSeconds: WORD_SELECTION_DURATION_MS / 1000,
    });
  }

  currentRoom.wordSelectionTimeout = setTimeout(() => {
    const fallbackWord = currentRoom.wordSuggestions[0];
    if (fallbackWord) {
      beginRound(io, currentRoom.id, drawerId, fallbackWord, "");
    }
  }, WORD_SELECTION_DURATION_MS);
  currentRoom.wordSelectionTimeout.unref();

  console.log(`Game started in room ${roomId}. Drawer: ${drawer?.username} (${drawerId})`);
}

function handleStartGame(io: Server, socket: Socket) {
  return async () => {
    const roomId = socket.data.roomId as string | undefined;
    if (!roomId) return;
    try {
      const room = getRoom(roomId);
      if (room?.roundAdvanceTimeout) {
        clearTimeout(room.roundAdvanceTimeout);
        delete room.roundAdvanceTimeout;
      }
      await startRoundFlow(io, roomId, socket.id);
    } catch (err) {
      emitError(socket, err);
    }
  };
}

function handleSetWord(io: Server, socket: Socket) {
  return (payload: { word?: string; hint?: string }) => {
    const roomId = socket.data.roomId as string | undefined;
    const room = getRoom(roomId);
    if (!room) return;
    const me = getPlayerBySocket(room, socket.id);
    if (!me || room.game.currentDrawerId !== me.id || !payload.word?.trim()) return;

    if (room.game.status !== "WORD_SELECTION") return;

    const word =
      findAllowedWord(room.wordSuggestions, payload.word) ?? validateCustomWord(payload.word);
    if (!word) {
      socket.emit("room:error", {
        code: "INVALID_WORD",
        message:
          "Custom topics must be 2–40 characters using letters, numbers, spaces, apostrophes, hyphens, or &",
      });
      return;
    }

    const hint = (payload.hint ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
    if (hint && doesMessageRevealWord(hint, word)) {
      socket.emit("room:error", {
        code: "INVALID_HINT",
        message: "The hint cannot contain the secret topic",
      });
      return;
    }

    beginRound(io, room.id, me.id, word, hint);
  };
}

function beginRound(io: Server, roomId: string, drawerId: string, word: string, hint: string) {
  const room = getRoom(roomId);
  if (!room || room.game.status !== "WORD_SELECTION" || room.game.currentDrawerId !== drawerId) {
    return;
  }

  if (room.wordSelectionTimeout) {
    clearTimeout(room.wordSelectionTimeout);
    delete room.wordSelectionTimeout;
  }

  room.currentWord = word;
  room.currentHint = hint;
  room.wordSuggestions = [];
  room.game.status = "ACTIVE_ROUND";
  room.revealedIndices.clear();
  room.correctGuesserIds = [];

  const roundId = randomUUID();
  room.currentRoundId = roundId;
  const drawerPlayer = room.players.get(drawerId);
  if (drawerPlayer) {
    dbCreateRound(
      roundId,
      room.id,
      room.game.roundNumber,
      drawerPlayer.id,
      word,
      ROUND_DURATION_S,
    ).catch((err) => console.error("[DB] Failed to create round in DB:", err));
  }
  dbUpdateRoomStatus(room.id, "ACTIVE_ROUND").catch((err) =>
    console.error("[DB] Failed to set room status ACTIVE_ROUND in DB:", err),
  );

  startRoundTimer(io, room.id);
  const serverNow = Date.now();
  const timerSync = {
    timeLeft: getTimeLeft(room, serverNow),
    roundEndsAt: room.roundEndsAt,
    roundDurationSec: room.roundDurationSec,
    serverNow,
  };

  if (drawerPlayer?.socketId) {
    io.to(drawerPlayer.socketId).emit("round:word-assigned", {
      word,
      hint,
      ...timerSync,
    });
  }

  const blanks = generateMaskedWord(word, room.revealedIndices);
  const exceptSockets = drawerPlayer?.socketId ? [drawerPlayer.socketId] : [];
  io.to(room.id)
    .except(exceptSockets)
    .emit("round:word-masked", {
      blanks,
      letterCount: word.length,
      hint,
      ...timerSync,
    });

  io.to(room.id).emit("room:state", serializeRoom(room));
}

function startRoundTimer(io: Server, roomId: string) {
  const room = getRoom(roomId);
  if (!room) return;

  if (room.timerInterval) clearInterval(room.timerInterval);

  const roundEndsAt = Date.now() + ROUND_DURATION_S * 1000;
  room.roundDurationSec = ROUND_DURATION_S;
  room.roundEndsAt = roundEndsAt;
  room.lastTimerBroadcastSecond = ROUND_DURATION_S;

  const timer = setInterval(() => {
    if (room.game.status !== "ACTIVE_ROUND" || room.roundEndsAt !== roundEndsAt) {
      clearInterval(timer);
      if (room.timerInterval === timer) delete room.timerInterval;
      return;
    }

    const previousTimeLeft = room.lastTimerBroadcastSecond ?? room.roundDurationSec;
    const serverNow = Date.now();
    const timeLeft = calculateRemainingSeconds(roundEndsAt, serverNow);
    if (timeLeft === previousTimeLeft) return;

    room.lastTimerBroadcastSecond = timeLeft;
    io.to(roomId).emit("timer:tick", { timeLeft, roundEndsAt, serverNow });

    if (timeLeft > 0 && crossedTimeThreshold(previousTimeLeft, timeLeft, 60)) {
      revealNextHint(io, roomId);
    }
    if (timeLeft > 0 && crossedTimeThreshold(previousTimeLeft, timeLeft, 30)) {
      revealNextHint(io, roomId);
    }

    if (timeLeft <= 0) {
      finishRound(io, roomId, "Time's up!");
    }
  }, 1000);

  room.timerInterval = timer;
  timer.unref();
}

function revealNextHint(io: Server, roomId: string) {
  const room = getRoom(roomId);
  if (!room?.currentWord) return;

  const index = getNextRevealIndex(room.currentWord, room.revealedIndices);
  if (index === null) return;

  room.revealedIndices.add(index);
  const blanks = generateMaskedWord(room.currentWord, room.revealedIndices);
  io.to(roomId).emit("round:hint-reveal", { blanks });
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
    const player = room ? getPlayerBySocket(room, socket.id) : undefined;
    const username = player?.username || "Guest";

    // Drawer cannot participate in guess validation — the word-reveal filter below
    // already blocks them from leaking the secret; this comment makes the intent explicit.
    // (The drawer's chat is not disabled server-side but is filtered client-side via
    //  ChatBox disabled={isDrawer}. Any raw socket bypass still hits the reveal filter.)

    // Players who already guessed correctly are excluded from further guess attempts.
    // If active round and sender is an active player (not drawer or spectator, not already correct)
    if (
      room.game.status === "ACTIVE_ROUND" &&
      room.currentWord &&
      player?.role === "player" &&
      player.id !== room.game.currentDrawerId &&
      !room.correctGuesserIds.includes(player.id)  // stable token — survives reconnect
    ) {
      // 1. EXACT MATCH
      if (isExactWordMatch(rawMessage, room.currentWord)) {
        room.correctGuesserIds.push(player.id);  // store token, not socket.id
        const points = 100 + getTimeLeft(room) * 2;

        addPlayerScore(room.id, socket.id, points);

        // Notify guesser & update room scores
        socket.emit("guess:correct", { points, word: room.currentWord });
        io.to(room.id).emit("room:state", serializeRoom(room));

        const sysMsg = {
          id: randomUUID(),
          username: "System",
          message: `🎉 ${username} guessed the word! (+${points} pts)`,
          type: "CORRECT_GUESS" as const,
        };
        if (!room.chatHistory) room.chatHistory = [];
        if (room.chatHistory.length >= 200) room.chatHistory.shift();
        room.chatHistory.push(sysMsg);
        io.to(room.id).emit("chat:message", sysMsg);

        // Async DB Persistence: correct guess, updated score, and system message
        if (player) {
          dbUpdatePlayerScore(room.id, player.id, player.score).catch((err) =>
            console.error("[DB] Failed to update player score:", err),
          );
          if (room.currentRoundId) {
            const timeTaken = ROUND_DURATION_S - getTimeLeft(room);
            dbSaveCorrectGuess(room.currentRoundId, player.id, points, timeTaken).catch((err) =>
              console.error("[DB] Failed to save correct guess:", err),
            );
          }
        }
        dbSaveChatMessage(sysMsg.id, room.id, null, sysMsg.message, "CORRECT_GUESS").catch((err) =>
          console.error("[DB] Failed to save system chat message:", err),
        );

        // Check if every connected non-drawer player has now guessed — finish early if so.
        const liveGuessers = [...room.players.values()].filter(
          (p) => p.isConnected && p.role === "player" && p.id !== room.game.currentDrawerId,
        );
        if (liveGuessers.length > 0 && liveGuessers.every((p) => room.correctGuesserIds.includes(p.id))) {
          finishRound(io, room.id, "Everyone guessed the word!");
        }
        return;
      }

      // 2. CLOSE GUESS (1 letter typo away, skip computation if length difference > 1)
      if (
        Math.abs(guess.length - secret.length) <= 1 &&
        getLevenshteinDistance(guess, secret) === 1
      ) {
        socket.emit("guess:close", {
          message: `"${rawMessage}" is so close! Check spelling!`,
        });
        return; // Don't broadcast typo to public chat
      }
    }

    // Never allow any participant to reveal the secret through public chat.
    if (
      room.game.status === "ACTIVE_ROUND" &&
      room.currentWord &&
      doesMessageRevealWord(rawMessage, room.currentWord)
    ) {
      return;
    }

    // Standard Chat Message
    const chatMsg = {
      id: randomUUID(),
      username,
      message: rawMessage,
      type: "CHAT" as const,
    };
    if (!room.chatHistory) room.chatHistory = [];
    if (room.chatHistory.length >= 200) room.chatHistory.shift();
    room.chatHistory.push(chatMsg);
    io.to(room.id).emit("chat:message", chatMsg);

    // Async DB Persistence: chat message
    dbSaveChatMessage(chatMsg.id, room.id, player?.id ?? null, chatMsg.message, "CHAT").catch((err) =>
      console.error("[DB] Failed to save chat message:", err),
    );
  };
}

function shouldFinishAfterDrawerDeparture(
  room: NonNullable<ReturnType<typeof getRoom>>,
  playerId: string,
): boolean {
  return (
    room.players.size > 0 &&
    room.game.currentDrawerId === playerId &&
    (room.game.status === "WORD_SELECTION" || room.game.status === "ACTIVE_ROUND")
  );
}

function finishRound(io: Server, roomId: string, reason: string) {
  const room = getRoom(roomId);
  if (!room) return;

  // Guard: prevent double-finish from concurrent events (e.g. disconnect + guess-all)
  if (room.game.status !== "ACTIVE_ROUND" && room.game.status !== "WORD_SELECTION") return;

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
  room.wordSuggestions = [];

  // Flat drawer bonus — awarded once per round if at least one guesser got it right (B-4).
  // Ghost drawers earn nothing: they weren't there to draw.
  const drawer = room.game.currentDrawerId
    ? room.players.get(room.game.currentDrawerId)
    : undefined;
  if (room.correctGuesserIds.length > 0 && drawer?.isConnected) {
    addPlayerScore(room.id, drawer.id, 50);
    dbUpdatePlayerScore(room.id, drawer.id, drawer.score).catch((err) =>
      console.error("[DB] Failed to update drawer score on round end:", err),
    );
  }

  // Finalize round & batch-persist strokes if needed
  if (room.currentRoundId) {
    dbFinishRound(room.currentRoundId).catch((err) =>
      console.error("[DB] Failed to finish round in DB:", err),
    );
    const strokes = getRoomStrokes(roomId);
    if (strokes.length > 0) {
      dbSaveRoundStrokesBatch(room.currentRoundId, strokes).catch((err) =>
        console.error("[DB] Failed to batch save round strokes:", err),
      );
    }
  }

  // Transition to COMPLETED on the final round, ROUND_ENDING otherwise (B-6)
  const isGameOver = room.maxRounds > 0 && room.game.roundNumber >= room.maxRounds;

  if (isGameOver) {
    room.game.status = "COMPLETED";
    markRoomCompleted(roomId);
    dbUpdateRoomStatus(roomId, "COMPLETED", new Date()).catch((err) =>
      console.error("[DB] Failed to set room status COMPLETED:", err),
    );
  } else {
    room.game.status = "ROUND_ENDING";
    dbUpdateRoomStatus(roomId, "ROUND_ENDING").catch((err) =>
      console.error("[DB] Failed to set room status ROUND_ENDING:", err),
    );

    // Auto-advance after 8 seconds
    room.roundAdvanceTimeout = setTimeout(() => {
      const currentRoom = getRoom(roomId);
      if (currentRoom && currentRoom.game.status === "ROUND_ENDING") {
        startRoundFlow(io, roomId).catch((err) =>
          console.error("Auto-advance failed:", err),
        );
      }
    }, 8000);
    room.roundAdvanceTimeout.unref();
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
