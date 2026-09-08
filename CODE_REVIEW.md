# Code Review — Skribble Game

**Reviewed:** 1 September 2026 · full codebase (`client/` + `server/`), including the uncommitted metrics + load-test work in progress.

**Baseline checks at review time**

| Check                              | Result                                    |
| ---------------------------------- | ----------------------------------------- |
| `server` → `pnpm run build` (`tsc`) | ✅ pass                                    |
| `server` → `pnpm run test`          | ✅ pass (all Room + GameEngine assertions) |
| `client` → `pnpm run build`          | ✅ pass                                    |
| `client` → `pnpm run lint`           | ❌ 2 errors                                |

**Overall.** The architecture is sound and the layering is genuinely clean: `rooms.ts` holds pure, testable state transitions; `roomHandlers.ts` owns transport and validation; `drawHandlers.ts` owns the drawing stream; `GameEngine` isolates drawer selection. Authorization is checked on the server for the actions that matter, and the rate limiter is applied consistently to room and chat events.

The problems cluster into three themes:

1. **Unguarded binary decoding** — the new binary drawing protocol can crash the process.
2. **Unbounded growth** — Prometheus label cardinality, stroke history, and chat history all have no ceiling.
3. **Claimed-but-absent features** — reconnection, cursor sync, and real PostgreSQL persistence are specified in `PRD.md` and advertised in `README.md`, but not implemented.

Nothing in this document has been applied to the code. Each item lists the location, the problem, and a recommended fix.

**Suggested order of work:** §1 → §2 → §3 → §4 (crash and denial-of-service first, then the word leak), then §6 and §8 (the two large missing features), then the rest.

---

## 🔴 Critical

### 1. Remote crash via malformed binary drawing chunk

**Where:** `server/src/binaryDrawing.ts:60`, consumed at `server/src/drawHandlers.ts:108-135`

**Problem.** The type guard ends with a structural check:

```ts
export function isBinaryPayload(payload: unknown): payload is Buffer | ArrayBuffer | Uint8Array {
  return (
    Buffer.isBuffer(payload) ||
    payload instanceof ArrayBuffer ||
    payload instanceof Uint8Array ||
    (typeof payload === "object" && payload !== null && "byteLength" in payload) // ← accepts plain objects
  );
}
```

A JSON payload such as `{"byteLength":1}` satisfies the last clause, so `decodeBinaryChunk` runs `new DataView(data)` on a plain object and throws `TypeError`. A genuine but truncated buffer (fewer than 4 bytes) instead throws `RangeError` inside `view.getUint16(0, true)`, because the header is read before any length check.

Neither `decodeBinaryChunk` nor the `draw:chunk` handler has a `try/catch`. An exception thrown synchronously inside a Socket.IO listener escapes to `uncaughtException` and terminates the Node process. Any connected socket can kill the server with a single emit — and the drawer authorization check does not help, because the lobby owner is always authorized (`isDrawerAuthorized`, `drawHandlers.ts:42-52`).

**Fix.** Three layers, all cheap:

1. Drop the structural fallback from the guard — accept only real binary types:

   ```ts
   export function isBinaryPayload(payload: unknown): payload is Buffer | ArrayBuffer | Uint8Array {
     return Buffer.isBuffer(payload) || payload instanceof ArrayBuffer || ArrayBuffer.isView(payload);
   }
   ```

2. Validate the header length before reading it, and return an empty result instead of throwing:

   ```ts
   if (byteLength < 4) return { strokeSeq: 0, points: [] };
   ```

   Also reject implausible `pointCount` values (the existing per-point bounds check already stops the loop, but an explicit cap documents the intent).

3. Wrap the decode call site in `try/catch` and drop the chunk on failure, so a future codec change cannot become a crash again. Consider adding a process-level `uncaughtException` handler that logs and exits deliberately, rather than dying mid-broadcast.

Apply the same guard fix to `client/src/utils/binaryDrawing.ts:73`, which has the identical structural clause.

---

### 2. Prometheus label cardinality is attacker-controlled

**Where:** `server/src/metrics.ts:120-122` and `server/src/metrics.ts:144`

**Problem.** Every distinct label value creates a permanent time series in the registry, and both of these labels come straight from untrusted input.

```ts
socket.onAny((eventName) => {
  socketEventsCounter.inc({ event: eventName, direction: "inbound" });
});
```

A client that emits randomly named events in a loop adds one series per name, forever — an unauthenticated memory-exhaustion path, made worse because `/metrics` then has to serialize all of them on every scrape. The HTTP middleware has the same shape:

```ts
const route = req.route?.path || req.path || "unknown";
```

`req.route` is undefined for unmatched requests, so `req.path` is used and every 404 URL becomes its own series.

**Fix.**

- Keep an allow-list of the events the server actually handles and bucket everything else:

  ```ts
  const TRACKED_EVENTS = new Set([
    "room:create", "room:join", "room:leave", "room:delete",
    "game:start", "round:set-word", "chat:send",
    "draw:start", "draw:chunk", "draw:clear", "draw:undo", "draw:request-sync",
    "connection", "disconnect",
  ]);
  const label = TRACKED_EVENTS.has(eventName) ? eventName : "other";
  ```

- In the middleware, use `req.route?.path ?? "unknown"` only — never the raw path. With just `/health` and `/metrics` registered, that keeps cardinality at a handful of series.

---

### 3. Drawing events have no rate limit and no memory ceiling

**Where:** `server/src/drawHandlers.ts` (all handlers), versus `server/src/roomHandlers.ts:33-70`

**Problem.** Room and chat events are all wrapped in `rateLimit(...)`, but the drawing stream is not: `draw:start`, `draw:chunk`, `draw:undo`, and `draw:request-sync` are registered with no throttle. Meanwhile `roomDrawHistories` has no cap on strokes per room or points per stroke, and there is no `draw:end` event, so a stroke is never finalized server-side. An authorized drawer (or the lobby owner, who is authorized whenever the game is not in `WORD_SELECTION`/`ACTIVE_ROUND`) can therefore grow server memory without bound, and `draw:request-sync` will serialize the entire accumulated history back to any client on demand.

**Fix.**

- Apply the existing limiter to the drawing events, with limits matched to the client's 60 ms batch interval — for example `draw:chunk` at ~30/second, `draw:start` at ~60/minute, `draw:undo` and `draw:request-sync` at ~10/minute. Wrap them the same way `roomHandlers.ts` does, so the mechanism stays uniform.
- Add explicit ceilings in `drawHandlers.ts`: a maximum stroke count per room (drop or shift-out the oldest beyond it) and a maximum point count per stroke. The JSON path already caps points *per chunk* at 500, which does not bound the stroke total.
- Add a `draw:end` event (see also §16) so strokes are explicitly finalized; this makes the caps easier to enforce and fixes the missing `action:"end"` metric at the same time.

---

### 4. The secret word leaks through public chat

**Where:** `server/src/roomHandlers.ts:311-378`

**Problem.** The guess-validation branch is entered only when the sender is an active player, is not the drawer, and is not already in `correctGuesserIds`. Everyone excluded by those conditions falls through to the unconditional broadcast at the end of the handler: 

```ts
io.to(room.id).emit("chat:message", { id: randomUUID(), username, message: rawMessage, type: "CHAT" });
```

So the drawer can simply type the answer, and so can the first player who guesses correctly — their message is no longer treated as a guess, so it is relayed verbatim to everyone still guessing. The drawer's restriction is client-side only (`disabled={isDrawer}` at `client/src/components/RoomView.tsx:267`), which any raw socket emit bypasses.

**Fix.** Enforce it on the server, in `handleChatSend`:

- If the sender is the drawer during `ACTIVE_ROUND`, either reject the message outright or suppress it when it contains the secret word (case-insensitive, after whitespace normalization).
- For players already in `correctGuesserIds`, either route their messages to a separate "already guessed" channel visible only to other finished guessers and the drawer (the usual skribbl.io behaviour), or apply the same secret-word filter.
- Reuse `getLevenshteinDistance` to also suppress near-misses, which leak nearly as much.
- Spectators are already safe (they never receive `round:word-assigned`), but they go through the same broadcast, so the filter should cover them too.

---

### 5. `/metrics` is publicly exposed

**Where:** `server/src/index.ts:27`

**Problem.** `app.get("/metrics", metricsHandler)` has no authentication. It exposes active room and player counts, cached stroke counts, RSS, heap, GC timings, and event-loop lag — useful reconnaissance, and a cheap amplification target once §2 has inflated the registry.

**Fix.** Require a bearer token from an env var (for example `METRICS_TOKEN`), or serve `/metrics` on a separate port bound to localhost and let the platform scrape it internally. Declare whichever variable you choose in `server/.env.example` and `render.yaml`.

---

## 🟠 Major correctness gaps

### 6. Reconnection is not implemented

**Where:** `server/src/roomHandlers.ts:82-107`, `server/src/rooms.ts:230`, `client/src/App.tsx:19-80`

**Claimed by:** `PRD.md` §18 and §29 ("Identity and score restored during grace period"), `README.md` ("Player reconnection with identity/score restore during a grace period").

**Problem.** Players are keyed by `socket.id`, which is regenerated on every reconnect. `handleDisconnect` calls `leaveRoom` immediately — there is no `DISCONNECTED` marker and no grace period, so the player is gone from `room.players` at once. That makes the restore logic unreachable:

```ts
score: existingPlayer?.score ?? 0,   // rooms.ts:230 — existingPlayer is always undefined on reconnect
```

The client side is worse. `App.tsx` registers `connect` and `disconnect` handlers but never re-joins, so after a drop the stale `room` object stays rendered against a dead `socketId`: `isOwner` and `isDrawer` silently become `false`, the player list still shows them, and the only way out is a manual reload. `PRD.md` §18 also requires that a disconnected player not block the "everyone guessed correctly" check — currently they are removed entirely, which satisfies that by accident, but the check at `roomHandlers.ts:348` is only re-evaluated on a new correct guess, so a round will not end early when the last un-guessed player leaves; it waits out the timer.

**Fix.**

- Introduce a stable player identity independent of `socket.id`: generate a `playerToken` (UUID) on first join, return it to the client, and have the client persist it in `localStorage` and send it with `room:create` / `room:join`. Key `room.players` by that token and keep `socketId` as a mutable field.
- On disconnect, mark the player `isConnected: false` and record `disconnectedAt` instead of deleting them; start a grace timer (a `GRACE_MS` constant next to `ABANDONED_MS`). On expiry, remove them and re-broadcast state.
- On reconnect with a known token, restore `username`, `score`, `role`, room membership, and correct-guesser status, then re-emit `room:state` and `draw:sync`.
- Exclude disconnected players from the `activeGuessers` count, and re-evaluate the round-end condition when a player disconnects — not only when a guess arrives.
- Skip the `USERNAME_TAKEN` check when the token matches an existing (disconnected) member, otherwise reconnecting players are rejected by their own name.

---

### 7. Drawer disconnect mid-round is unhandled

**Where:** `server/src/roomHandlers.ts:82-107`, timer at `:255-296`, `finishRound` at `:379`

**Problem.** Nothing inspects whether the leaving socket was the drawer. The 1 s interval keeps ticking for the remainder of the 120 s round with `room.game.currentDrawerId` pointing at a socket that no longer exists: nobody is authorized to draw (`isDrawerAuthorized` compares against the departed id), guessers stare at a frozen canvas, and when the timer finally expires `finishRound` awards the +50 drawer bonus to a player who has left.

**Fix.** In the disconnect path, if the leaving player was `currentDrawerId` and the status is `WORD_SELECTION` or `ACTIVE_ROUND`, clear the round timer and call `finishRound(io, roomId, "The drawer left the round")`. Guard the drawer bonus in `finishRound` with a `room.players.has(room.game.currentDrawerId)` check. The same applies when the drawer never picks a word — a `WORD_SELECTION` phase currently has no timeout at all, so a silent drawer stalls the room indefinitely; add a selection deadline that auto-picks a suggestion.

---

### 8. PostgreSQL persists almost nothing

**Where:** `server/src/db.ts`, `server/prisma/schema.prisma`

**Claimed by:** `README.md` ("PostgreSQL persists"), `PRD.md` §21/§22 retention rules and §30 "PostgreSQL persistence".

**Problem.** The schema models `Room`, `Player`, `Round`, `CorrectGuess`, `DrawingStroke`, `ChatMessage`, and `Word`. Only the first two are ever written, by `dbCreateRoom` and `dbAddPlayer`. Specifically:

- `dbSaveStroke` (`db.ts:86`) and `dbGetRoundStrokes` (`db.ts:118`) are **dead code** — imported nowhere.
- `Round`, `CorrectGuess`, and `ChatMessage` rows are never created, so there is no match history and late joiners cannot be given chat history (§12).
- `Player.score` is never updated; scores exist only in memory (`addPlayerScore`) and vanish with the process.
- `Room.status`, `Room.completedAt`, and `Room.abandonedAt` are never updated after creation, so every persisted room is stuck at `WAITING`.
- Neither `deleteRoom` nor `sweepExpired` issues any DB delete, so rows accumulate forever. `onDelete: Cascade` is correctly declared throughout the schema, so the cleanup itself would be a single `prisma.room.delete`.

The net effect is that the retention policy the PRD specifies is implemented for the in-memory map and not at all for the database it is supposed to govern.

**Fix.**

- Create a `Round` row when the drawer's word is set, and store its id on the in-memory `Room`; write `endedAt` in `finishRound`.
- Write a `CorrectGuess` row on each correct guess (`scoreAwarded`, `timeTakenSeconds` are both already available from `points` and `ROUND_DURATION_S - room.timeLeft`), and update `Player.score` there and for the drawer bonus.
- Persist chat via `dbSaveChatMessage` on broadcast, and add a `dbGetRecentMessages(roomId, limit)` to hydrate late joiners.
- Call `dbSaveStroke` on stroke finalization (once `draw:end` exists — see §3/§16), or drop the two dead functions if stroke replay is out of scope. Choose one; leaving them unused is the worst of both.
- Mirror lifecycle transitions to the DB: `Room.status` on each game-state change, `abandonedAt` when the last player leaves, `completedAt` in `markRoomCompleted`.
- Have `deleteRoom` and `sweepExpired` delete the corresponding `Room` rows so cascades clear the children. Note that `sweepExpired` is pure and synchronous today and is unit-tested as such — do the DB delete in the caller (`roomHandlers.ts:72-79`), which already iterates the returned ids, rather than making the state module async.
- All DB helpers already swallow errors and return `null`, which is the right call for a game that must survive a DB outage — but that also means these failures are invisible. Add a metric or a rate-limited warning so a broken `DATABASE_URL` does not look like success.

---

### 9. `sweepExpired` leaks round timers

**Where:** `server/src/rooms.ts:291-308`

**Problem.** The sweep deletes rooms straight from the map:

```ts
if (isAbandonedExpired || isCompletedExpired) {
  rooms.delete(id);   // no clearInterval(room.timerInterval)
  expired.push(id);
}
```

`deleteRoom` (`:271`) correctly clears `room.timerInterval` first; the sweep does not. Any room that expires while a timer is live leaves a 1 s interval running forever, mutating a detached object and emitting into an empty Socket.IO room. In practice the abandoned path is protected because `leaveRoom` clears the timer when the last player leaves, but the completed path and any future call site are not — and the omission is invisible.

**Fix.** Clear the interval inside the sweep loop before deleting, or route both paths through `deleteRoom(id)` so there is exactly one place that tears a room down. The latter is preferable: it makes the invariant "rooms are only ever removed by `deleteRoom`" enforceable.

---

### 10. Players are not guaranteed one turn each

**Where:** `server/src/game/GameEngine.ts:22-36`, `server/src/rooms.ts:161`

**Problem.** `maxRounds` is set to the active-player count, with the comment stating the intent:

```ts
room.maxRounds = eligiblePlayers.length; // each active player draws once per match
```

But `selectDrawer` picks uniformly at random from everyone except the immediately-previous drawer. Over N rounds with N players, some players draw twice and others never draw at all. `PRD.md` §29 only requires "previous drawer cannot immediately draw again", which the engine does satisfy — so this is a mismatch between the comment/`maxRounds` derivation and the actual behaviour, not a spec violation. It is still a visible fairness problem in a 5-round game.

**Fix.** Replace random selection with a shuffled turn queue held in `GameState`: shuffle the eligible ids when a match starts, pop one per round, and reshuffle for the next match with the constraint that the new first drawer is not the previous last drawer. That satisfies the PRD rule and makes `maxRounds = playerCount` actually mean what the comment says. `GameEngine.test.ts` already injects a deterministic `random`, so the new logic stays testable in the same style.

**Related:** `maxRounds` is fixed when the match starts and never adjusted when players join or leave mid-match, so a match can end with players who never drew, or run rounds with a stale target. Decide explicitly whether late joiners are added to the queue.

---

### 11. Live cursor synchronization is missing

**Where:** nowhere — a search for cursor events across `client/` and `server/` returns only Tailwind `cursor-*` class names.

**Claimed by:** `PRD.md` §30 "Included → Live cursor synchronization", `README.md` ("Live cursor sync, chat, and leaderboard").

**Fix.** Either implement it or remove the claim. Implementation is small and should reuse the existing patterns: a `cursor:move` event throttled to roughly the 60 ms batch interval, authorized through the same `isDrawerAuthorized` check, broadcast with `socket.to(roomId).volatile.emit(...)` so backpressure drops stale positions rather than queueing them, and rendered as an overlay in `DrawingCanvas` (a second absolutely-positioned canvas, so cursor repaints do not force a stroke redraw). Do not persist cursor positions.

---

### 12. Late joiners get no chat history, and history is unbounded client-side

**Where:** `client/src/components/RoomView.tsx:65` and `:124-126`

**Claimed by:** `PRD.md` §22 ("Late joiners may receive room chat history").

**Problem.** Messages live only in React state on each client. A player joining mid-match sees an empty chat, and nothing ever clears `messages` between rounds or matches, so it grows for the lifetime of the session — every entry re-rendered on each new message.

**Fix.** Persist chat server-side (§8) and emit the last N messages on join alongside `room:joined`. Cap the client array (for example, keep the most recent 200) and clear it on `game:started` for a fresh match. While there, note that `RoundEndModal` and `GameOverModal` derive their scoreboards from `room.players`, which is correct — only chat is client-only state.

---

## 🟡 Minor and polish

### 13. The displayed room code cannot be used to join

**Where:** `client/src/components/RoomView.tsx:227`

The UI labels a truncated UUID as the room code — `Code: ${room.id.slice(0, 8)}` — but joining requires the full UUID, so anyone who reads the code off the screen and types it gets `ROOM_NOT_FOUND`. Only the copy-to-clipboard button (which copies `room.id` in full) works.

**Fix.** Either display the full id, or introduce a real short join code: a 6–8 character room code stored on the room and resolved server-side in `joinRoom`. The short code is the better product answer and also stops the internal UUID from being the thing users paste around.

### 14. `pnpm run lint` fails in `client/`

Two errors block a clean lint run:

- `client/src/App.tsx:122` — `react-hooks/refs`: `socket={socketRef.current}` reads a ref during render. Harmless today (the socket is created in an effect and `RoomView` only mounts after a server event, so the ref is always populated by then), but `App` will not re-render when the ref changes. **Fix:** hold the socket in `useState` and set it once inside the effect, so the value flows through render properly.
- `client/src/components/RoundEndModal.tsx:26` — `react-hooks/set-state-in-effect`: `setCountdown(6)` synchronously in an effect body. **Fix:** derive the countdown from `isOpen` with a `key` reset on the modal, or move the reset into the same effect that owns the interval.

### 15. Round duration mismatch in initial client state

`client/src/components/RoomView.tsx:59` initialises `timeLeft` to `80`, but `ROUND_DURATION_S` is `120`. The first render before the first `timer:tick` shows a wrong number. **Fix:** initialise to `120`, ideally from a shared constant rather than a literal duplicated across packages.

### 16. Metrics instrumentation inaccuracies (uncommitted work in progress)

- `server/src/drawHandlers.ts:95` — `draw:start` always increments `drawingPointsCounter{format:"json"}`, even when the stroke is streamed in binary, so the JSON point count is inflated by one per stroke regardless of transport. Label it by the transport actually used, or count start points in a separate metric.
- There is no `action:"end"` increment, even though the label comment documents `start, end, clear, undo` — because **no `draw:end` event exists**. The client's `handlePointerUp` (`DrawingCanvas.tsx:338`) flushes the batch and clears local state without notifying the server, so strokes are never finalized server-side. `{action="start"}` and `{action="end"}` can therefore never reconcile. Adding `draw:end` also helps §3 and §8.
- `drawingBytesCounter{format="json"}` measures `JSON.stringify(payload).length` — UTF-16 code units, not bytes, and excluding Socket.IO framing. Rename the metric or use `Buffer.byteLength(...)`.
- `activeSocketConnectionsGauge` has both a `collect()` hook and manual `.set()` calls in the connect/disconnect handlers. The `collect()` hook already produces a correct value at scrape time; the manual sets are redundant. Keep one mechanism.
- `getTotalCachedStrokesCount` and `getTotalPlayerCount` iterate every room on every scrape. Fine at 30 connections per room, worth noting if room counts grow.

### 17. Load-test script bugs (uncommitted work in progress)

**Where:** `server/scripts/loadTest.ts`

- **Chat is silently dropped.** The script emits `{ text: ... }`; the server reads `payload.message` (`roomHandlers.ts:313`) and returns early. Every simulated chat message is discarded, so guess validation, the Levenshtein close-guess path, and scoring are never exercised. **Fix:** emit `{ message }`.
- **Non-owner bots almost never join.** The `room:created` handler filters the `clients` array for bots sharing a `roomGroup`, but fellow bots are pushed into `clients` only *after* the owner's socket is created, with a 30 ms stagger between each. `room:created` typically arrives before any of them exist, so the list holds just the owner and the join emits never fire. The test effectively runs N single-player rooms — far less socket fan-out than intended. **Fix:** pre-register all sessions for a group before connecting any of them, or store the created `roomId` per group and have each bot join on its own `connect` event.
- **The binary protocol is untested.** The script only emits JSON `draw:chunk` payloads, so the encoder from the most recent commit — and the entire binary path added alongside it, including the crash in §1 — is never exercised under load. **Fix:** use `encodeBinaryChunk` (or a copy of it) for most chunks and keep a JSON minority to cover the fallback.
- **The script is never typechecked.** `server/tsconfig.json` has `"include": ["src/**/*"]`, so `scripts/` is outside the build. `pnpm run build` passes regardless of type errors in the load test. **Fix:** add `"scripts/**/*"` to `include`, or add a separate `tsconfig.scripts.json`.
- Minor: the `connect_error` handler takes an unused `err` parameter — log it, since a failed connection is exactly what the test exists to surface.

### 18. Client binary decoder ignores `byteOffset`

**Where:** `client/src/utils/binaryDrawing.ts:52`

```ts
const buffer = data instanceof Uint8Array ? data.buffer : data;
```

For a `Uint8Array` that is a view into a larger pooled buffer, this decodes from the start of the pool rather than the view, yielding garbage points. The server implementation handles this correctly (`server/src/binaryDrawing.ts:24-31`, passing `byteOffset` and `byteLength` to `DataView`). **Fix:** mirror the server version. Better still, extract one shared codec module rather than maintaining two hand-synchronized copies — the duplication is already drifting.

### 19. Drawing is permitted during `ROUND_ENDING`

**Where:** `server/src/drawHandlers.ts:42-52`, `client/src/components/RoomView.tsx:249-256`

`isDrawerAuthorized` returns `room.ownerId === socketId` for any status other than `WORD_SELECTION`/`ACTIVE_ROUND`, and the client passes `isDrawer={isOwner}` under the same condition — so the owner keeps a live canvas during `ROUND_ENDING` and `COMPLETED`, drawing over the just-revealed word while the round-end modal is up. **Fix:** restrict lobby drawing to `WAITING` explicitly, on both sides.

### 20. Round advancement is manual and the button is misleading

**Where:** `client/src/components/RoomView.tsx:378-386`

The server never advances past `ROUND_ENDING`; the owner must click through every round. The button is also enabled during `ACTIVE_ROUND` with the label "Next Turn / Drawer", but `startGame` rejects that with `GAME_IN_PROGRESS` (`rooms.ts:141-144`) — so the advertised action produces an error toast. **Fix:** disable the button during `WORD_SELECTION`/`ACTIVE_ROUND`, and either auto-advance after a short `ROUND_ENDING` delay (the usual behaviour, and `RoundEndModal` already runs a countdown) or relabel it honestly.

### 21. Build artifacts are committed

`server/.gitignore` contains only `.env` and `node_modules`, so `server/dist/` — 40+ generated `.js`, `.d.ts`, and `.map` files — is tracked in git, along with `server/prisma/seed.js` and `seed.d.ts`. The tracked copies are already stale relative to `src/`, which makes diffs noisy and reviews misleading.

**Fix.** Add `dist/`, `prisma/*.js`, `prisma/*.d.ts`, and `*.map` to `server/.gitignore`, then `git rm -r --cached server/dist` in a dedicated commit.

### 22. Deployment configuration gaps

**Where:** `render.yaml`, `client/vercel.json`, `server/src/index.ts:15`

- The build command runs `prisma generate` but never `prisma migrate deploy`, so **migrations are never applied in production** — the schema only exists wherever someone ran `migrate dev` by hand. Add `pnpm exec prisma migrate deploy` to the build or start command. There is also **no `prisma/migrations/` directory in the repo at all** — only `schema.prisma` — so there is no migration history to deploy even once the command is added. The README's `prisma migrate dev` step generates it locally per developer, which means no two environments are guaranteed to share a schema. Commit the migrations.
- `CLIENT_URL` is not declared in `envVars`, so the server silently falls back to the hardcoded `https://skribble-eight.vercel.app` for both CORS and the Socket.IO origin. A deployment to any other client URL fails CORS with no signal. Declare it (`sync: false`), and consider failing fast at boot when it is unset in production rather than defaulting.
- `client/vercel.json` does not document or set `VITE_SERVER_URL`; the client falls back to `http://localhost:9000`, which cannot work in production. Note it in the README deployment section at minimum.
- Whichever token you add for `/metrics` (§5) belongs in both `render.yaml` and `server/.env.example`.

### 23. Dead configuration and unused exports

- `server/nodemon.json` invokes `ts-node src/index.ts`. `ts-node` is not a dependency and the project uses `tsx watch` — the file is stale and will mislead. Delete it.
- `getRoomStrokes` (`drawHandlers.ts:26`) is exported and unused. Either wire it into the `draw:request-sync` handler (which currently reaches into the map directly) or drop it.
- `server/pnpm-workspace.yaml` and `client/pnpm-workspace.yaml` declare two independent installs with no root workspace file, so `pnpm install` at the repository root does nothing. That is a valid choice for two separately deployed packages, but it should be stated in the README — and it guarantees the duplicated types in `client/src/types.ts` and the duplicated binary codec (§18) keep drifting. A root workspace with a shared `types`/`protocol` package would remove both duplications.

---

## Documentation accuracy

`README.md` and `PRD.md` describe several features that do not exist in the code. Whether the fix is code or prose, the two should be reconciled — right now the documentation cannot be trusted as a description of the system.

| Claim                                                     | Source                       | Reality                                                                   |
| --------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------- |
| "PostgreSQL persists"                                     | README tagline, PRD §30      | Only `Room` and `Player` rows written; no scores, rounds, strokes, or chat |
| "Live cursor sync"                                        | README features, PRD §30     | Not implemented at all (§11)                                              |
| "Player reconnection with identity/score restore"         | README features, PRD §18/§29 | Not implemented; players are deleted on disconnect (§6)                   |
| "Room lifecycle: auto-delete abandoned/completed rooms"    | README features, PRD §21     | In-memory only; DB rows are never deleted (§8)                            |
| "Late joiners may receive room chat history"               | PRD §22                      | No chat persistence; late joiners see an empty chat (§12)                 |
| "Rate limiting"                                           | README features, PRD §30     | Applied to room/chat events, absent on all drawing events (§3)            |
| "Each active player draws once per match"                  | `rooms.ts:161` comment       | Random selection; some players draw twice, others never (§10)             |
| `pnpm run test` "Run Room + GameEngine tests"              | README scripts table         | Accurate — both suites pass                                              |

Also missing from the README: the `test:load` script and the `/metrics` endpoint added in the uncommitted work.

---

## Test coverage notes

`rooms.test.ts` and `GameEngine.test.ts` are hand-rolled assertion scripts — no framework, `process.exit(failed ? 1 : 0)` at the end. They are readable, deterministic (`GameEngine.test.ts` injects `random`), and cover room capacity, username rules, ownership transfer, the abandonment lifecycle, sweeping, and the in-progress guard. That is the right set of things to test, and the pure-function design of `rooms.ts` is what makes it possible.

The gaps worth closing, roughly in order of risk:

1. **`binaryDrawing.ts` codec** — round-trip encode/decode, plus the malformed inputs from §1 (empty buffer, 3-byte buffer, plain object with `byteLength`, oversized `pointCount`). This is the highest-value missing test and needs no socket harness.
2. **Guess validation** — exact match, case and whitespace insensitivity, the Levenshtein close-guess boundary, the drawer and already-guessed exclusions from §4, and the time-based score formula.
3. **`generateMaskedWord` / `getNextRevealIndex`** — spaces and underscores preserved, no index revealed twice, `null` when exhausted.
4. **`rateLimit`** — window rollover and `socketCleanup` releasing buckets.
5. **Round lifecycle** — timer reveals at 60 s and 30 s, `finishRound` transitioning to `COMPLETED` on the final round, the drawer bonus only when someone guessed. This needs the timer loop to be injectable; extracting it from `roomHandlers.ts` would make it testable and shrink a 400-line module.

Keeping the current no-framework style is fine and consistent; the important thing is that the codec gets covered before the next protocol change.
