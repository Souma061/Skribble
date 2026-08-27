# Product Requirements Document

## 1. Product Overview

### Working Product Description

A real-time multiplayer drawing and guessing game where players join a room, take turns drawing a secret word, and other players attempt to guess the word through a live chat interface.

The faster a player correctly guesses the word, the more points they receive. The game maintains a live leaderboard throughout the session.

The primary technical focus of V1 is the real-time architecture:

* Live drawing
* Live cursor synchronization
* Real-time guessing
* Server-authoritative scoring
* Secure handling of secret game information
* Late joiner synchronization
* Spectator mode
* Event-driven game state

This is **not primarily a WebRTC or video platform**. Voice and video functionality are outside the V1 scope.

---

# 2. Goals

## Primary Goals

### 2.1 Real-Time Multiplayer Gameplay

Players should experience:

* Low-latency drawing
* Live cursor movement
* Real-time guesses
* Live leaderboard updates
* Immediate round state changes

The application should use WebSockets as the primary real-time communication mechanism.

---

### 2.2 Server-Authoritative Game Logic

The server is the single source of truth for:

* Word validation and storage
* Guess validation
* Correct guess order
* Scoring
* Round timing
* Round completion
* Drawer selection
* Player permissions

Clients may request actions, but clients must never determine authoritative game state.

---

### 2.3 Secure Secret Word Handling

The secret word must never be exposed to players who are guessing.

The word must not appear in:

* WebSocket payloads sent to guessers
* REST responses for guessers
* Client-side state
* Browser DevTools-accessible application stores
* Late joiner synchronization payloads
* Public room state objects

The drawer receives the secret word.

Guessers receive only safe information such as:

* Word length
* Optional masked representation
* Round timing
* Drawer identity

The actual word is revealed only after the round ends.

---

### 2.4 Support Late Joiners

Players should be able to join an already-running game.

A late joiner should receive a sanitized snapshot of the current game state, including:

* Current room state
* Current players
* Current drawer
* Leaderboard
* Remaining round time
* Current drawing state/history
* Relevant game events
* Chat history if retained

The secret word must never be included unless the round has already ended and the reveal has occurred.

---

# 3. Non-Goals for V1

The following are explicitly outside V1:

* Voice chat
* Video chat
* WebRTC media infrastructure
* mediasoup
* Redis
* MongoDB
* Kubernetes
* Multi-region deployment
* Multi-instance Socket.IO scaling
* Distributed game servers
* User accounts and login
* Persistent social profiles

These may be considered in future versions.

---

# 4. Technology Stack

## Frontend

* React
* Canvas-based drawing interface
* WebSocket client using Socket.IO

## Backend

* Node.js
* Express
* Socket.IO

## Database

* PostgreSQL

## Package Manager

* pnpm

---

# 5. High-Level Architecture

```text
                         ┌──────────────────────┐
                         │        React         │
                         │                      │
                         │  Drawing Canvas      │
                         │  Live Cursor         │
                         │  Chat                │
                         │  Guess Input         │
                         │  Leaderboard         │
                         └──────────┬───────────┘
                                    │
                         HTTP + WebSocket
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │ Express + Socket.IO  │
                         │                      │
                         │ Game Authority       │
                         │ Round Management     │
                         │ Guess Validation     │
                         │ Scoring              │
                         │ Authorization        │
                         │ Rate Limiting        │
                         └──────────┬───────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │      PostgreSQL      │
                         │                      │
                         │ Rooms                │
                         │ Players              │
                         │ Rounds               │
                         │ Scores               │
                         │ Game History         │
                         │ Drawing History      │
                         └──────────────────────┘
```

---

# 6. Core Product Concepts

## 6.1 Room

A room represents an active multiplayer game session.

A room contains:

* Players
* Spectators
* Current game state
* Current round
* Current drawer
* Leaderboard
* Round history
* Relevant drawing history

---

## 6.2 Player

V1 does not require login.

Players join using a temporary anonymous identity.

A player may have:

* Temporary `playerId`
* Username/display name
* Current room
* Connection state
* Role
* Current score

Because `socket.id` changes after reconnecting, it should not be used as the permanent player identity.

A reconnect mechanism may use a generated identity and reconnect token.

---

## 6.3 Spectator

A spectator can join the room and observe the game.

A spectator can:

* View the drawing
* View the live leaderboard
* View the current game state
* View allowed chat content

A spectator cannot:

* Draw
* Submit a word
* Earn guessing points
* Become the drawer

### Open Decision

Whether a spectator can switch to player mode during an active round or must wait until the next round.

Recommended behavior:

> A spectator becomes an active player at the beginning of the next round.

This avoids players joining halfway through a round and immediately affecting scoring fairness.

---

# 7. Game Flow

## 7.1 Game Start

1. Players join a room.
2. The server selects a drawer.
3. The selected drawer receives permission to submit a word.
4. The drawer submits a word.
5. The server validates and stores the word.
6. The round begins.

---

## 7.2 Round Duration

Each round lasts:

**120 seconds**

The server owns the authoritative timer.

The server stores:

```text
roundStartedAt
roundEndsAt
```

Clients receive the deadline and render the countdown locally.

A client-side timer is purely visual.

The server determines whether the round has actually ended.

---

## 7.3 Drawing Phase

The current drawer can:

* Draw on the canvas
* Move their cursor
* Continue drawing until the round ends

Guessers and spectators can observe the drawing.

Only the currently authorized drawer may send valid drawing events.

The server must reject drawing events from any other player.

---

## 7.4 Guessing

Players submit guesses through the chat/guess interface.

The server:

1. Receives the guess.
2. Normalizes the guess.
3. Compares it against the secret word.
4. Determines whether it is correct.
5. Records the player's first correct answer.
6. Assigns rank and points.

The secret word is never sent to the guesser's client for comparison.

All guess validation occurs server-side.

---

# 8. Correct Guess Behavior

When a player guesses correctly:

* The server records the correct guess.
* The server records the order/rank.
* The server calculates the points.
* The leaderboard updates.
* The player remains able to use chat.
* The player is not locked out of the chat interface.

A player may continue sending messages or guesses after correctly answering.

However:

> A player can receive points only once per round.

Example:

```text
Player A → wrong
Player A → wrong
Player A → correct
           ↓
        Rank #1
           ↓
        Points awarded

Player A → correct again
           ↓
        No additional points
```

---

# 9. Scoring and Ranking

Correct guesses are ranked based on who answers correctly first.

The ranking supports:

```text
Rank 1
Rank 2
Rank 3
...
Rank 10
```

The first correct player receives the highest number of points.

Subsequent correct players receive progressively fewer points.

### Open Decision

The exact scoring formula has not yet been finalized.

Possible approaches include:

### Fixed Rank-Based Points

```text
Rank 1 → Highest points
Rank 2 → Slightly fewer
Rank 3 → Fewer
...
Rank 10 → Lowest ranked points
```

### Time-Based Scoring

Points decrease based on elapsed time.

### Hybrid

Rank determines the primary score while elapsed time can influence tie-breaking.

The final formula should be explicitly defined before implementation.

---

# 10. Round Completion

A round can end in the following situations.

## Case A: Everyone Eligible Has Guessed Correctly

If all active guessers have correctly answered:

1. End the round early.
2. Reveal the word.
3. Finalize the round.
4. Update the leaderboard.
5. Select the next drawer randomly.
6. Start the next round.

---

## Case B: Timer Expires and At Least One Player Guessed Correctly

If the 120-second timer expires and one or more players correctly guessed:

1. End the round.
2. Reveal the word.
3. Finalize scores.
4. Update the leaderboard.
5. Select the next drawer randomly.
6. Begin the next round.

---

## Case C: Timer Expires and Nobody Guessed Correctly

If zero players guess the word correctly:

1. End the current round.
2. Reveal the word.
3. Do not award points.
4. Keep the same drawer.
5. The drawer submits a new word.
6. Start a new 120-second round.

The previous word must not be reused because it has already been revealed.

---

# 11. Drawer Selection

After a successful round where at least one player guessed correctly:

```text
Round ends
    ↓
Random eligible player selected
    ↓
New drawer
    ↓
New word submission
    ↓
Next round
```

### Eligibility

The exact rules for who can become the next drawer should exclude:

* Spectators
* Disconnected players
* Any role that is not actively participating

### Open Decision

Whether the immediately previous drawer can be selected again.

---

# 12. Drawing Architecture

Drawing data and cursor data should be treated differently.

## 12.1 Live Cursor

Cursor movement is ephemeral.

Flow:

```text
pointermove
    ↓
Capture latest position
    ↓
Throttle / animation frame sampling
    ↓
Socket.IO
    ↓
Other clients
    ↓
Interpolation
    ↓
Smooth remote cursor
```

Cursor events should not be persisted in PostgreSQL.

The latest cursor position replaces the previous position.

Occasional packet loss is acceptable for cursor movement.

---

## 12.2 Drawing Strokes

Drawing should use logical strokes.

Example:

```text
Stroke
├── strokeId
├── playerId
├── color
├── width
└── points
      ├── [x, y]
      ├── [x, y]
      ├── [x, y]
      └── [x, y]
```

During drawing:

```text
pointerdown
    ↓
stroke-start

pointermove
    ↓
collect coordinates

small batch / animation frame
    ↓
stroke-points

pointerup
    ↓
stroke-end
```

The server verifies that the sender is the current drawer before broadcasting drawing events.

---

# 13. Drawing Persistence

The database should not receive every mouse movement as an individual event.

The system should persist meaningful drawing data, such as:

* Completed strokes
* Batched stroke segments
* Canvas reconstruction data

This allows late joiners and reconnecting clients to rebuild the current drawing.

Cursor movement remains transient and is never stored as historical game data.

---

# 14. Live Cursor Synchronization

The application should capture cursor movement using pointer events.

The client should avoid emitting a WebSocket event for every raw pointer event.

Instead:

```text
pointermove
    ↓
Store latest cursor position
    ↓
Send at controlled intervals
    ↓
Remote client receives target position
    ↓
Interpolate toward target
    ↓
Smooth cursor rendering
```

Remote cursor rendering should use interpolation to reduce visible network jitter.

---

# 15. Chat

Chat messages are transmitted through the Socket.IO connection.

Guesses are submitted through the same general interaction flow but are validated by the server.

Possible outcomes:

```text
Normal message
```

or:

```text
Incorrect guess
```

or:

```text
Correct guess
```

The server determines how the message should be handled.

### Open Decision

Whether correct guesses should be visible to all players as the actual guessed word or represented by a system message such as:

```text
Player A guessed the word!
```

This should be decided explicitly because showing the actual correct guess may reveal the answer to everyone else.

---

# 16. Leaderboard

The leaderboard updates in real time.

It reflects cumulative points for the current game session.

Example:

```text
1. Player A — 1500
2. Player B — 1200
3. Player C — 950
4. Player D — 700
```

The server calculates score changes.

Clients only receive the resulting leaderboard state.

Clients must never submit:

```text
addPoints
updateScore
setLeaderboard
```

as authoritative actions.

---

# 17. Late Joiners

A player may join while a round is active.

The server provides a sanitized state snapshot.

Example:

```text
ROOM SNAPSHOT

players
spectators
currentDrawer
leaderboard
round status
roundEndsAt
drawing history
allowed chat history
```

The snapshot must not contain:

```text
secretWord
internal scoring secrets
private player tokens
server-only state
```

After receiving the snapshot, the late joiner continues receiving live Socket.IO events.

---

# 18. Reconnection

Because V1 does not have user accounts, the application should support temporary player identity.

Conceptually:

```text
Player joins
    ↓
Server generates player identity
    ↓
Client receives reconnect credential
    ↓
Connection lost
    ↓
Player reconnects
    ↓
Server restores player identity
```

This allows the player to retain:

* Identity
* Score
* Room membership
* Game participation status

### Open Decision

How long a disconnected player remains eligible for reconnection before being removed from the room.

---

# 19. Security Requirements

## 19.1 Never Trust the Client

The client may:

* Inspect WebSocket messages
* Modify application state
* Replay events
* Fabricate events
* Spam events
* Send malformed payloads

Therefore, the server validates every meaningful action.

---

## 19.2 Secret Word Protection

The secret word must only be available to:

* The server
* The authorized drawer

It must never be included in shared room state.

The application should maintain separate state views:

```text
Internal Server State
        │
        ├── Drawer View
        ├── Guesser View
        └── Spectator / Late Joiner View
```

---

## 19.3 Event Authorization

Examples:

Only the current drawer can:

```text
submit-word
stroke-start
stroke-points
stroke-end
```

Only eligible players can:

```text
submit guesses
receive scoring eligibility
participate in drawer selection
```

The server derives identity from the socket/session context.

The server must not trust a client-supplied `playerId`.

---

## 19.4 Input Validation

All user-controlled inputs should have validation for:

* Maximum length
* Expected type
* Valid numeric ranges
* Coordinate bounds
* Maximum drawing points per batch
* Control characters where appropriate

Free-text content must be rendered safely.

React's normal escaping should be preserved.

The application should avoid unsafe rendering such as unnecessary use of:

```text
dangerouslySetInnerHTML
```

---

## 19.5 Payload Limits

Drawing events and chat events should have bounded payload sizes.

The server should reject:

* Extremely large coordinate arrays
* Invalid coordinates
* `NaN`
* `Infinity`
* Malformed objects
* Excessively long messages
* Excessively large words

---

# 20. Rate Limiting

Rate limiting should be action-specific.

Example categories:

```text
guess
chat
drawing
cursor
join-room
submit-word
```

Each action may have a different allowed rate.

For example:

```text
join-room      → low frequency
submit-word    → very low frequency
chat           → moderate frequency
guess          → moderate frequency
drawing        → high frequency but bounded
cursor         → high frequency / sampled
```

Rate limiting should occur before expensive processing where possible.

### Implementation Decision

The exact rate-limiting mechanism has not yet been finalized for the PostgreSQL-only V1 architecture.

---

# 21. PostgreSQL Persistence

PostgreSQL is the persistent database for V1.

The database should store meaningful, durable information.

Potential entities include:

```text
rooms
players
room_memberships
rounds
round_results
scores
drawing_strokes
game_events
```

The exact schema remains to be designed.

---

## 21.1 Persistent Data

Examples:

### Room

```text
roomId
status
createdAt
configuration
```

### Player

```text
playerId
displayName
connection/reconnection metadata
```

### Room Membership

```text
roomId
playerId
role
joinedAt
status
```

### Round

```text
roundId
roomId
drawerId
secretWord
startedAt
endsAt
status
```

### Correct Guess

```text
roundId
playerId
rank
elapsedTime
pointsAwarded
```

### Score

```text
roomId
playerId
totalScore
```

### Drawing Data

```text
strokeId
roundId
drawerId
color
width
points
```

### Meaningful Events

Examples:

```text
PLAYER_JOINED
PLAYER_LEFT
ROUND_STARTED
PLAYER_GUESSED_CORRECTLY
ROUND_ENDED
DRAWER_CHANGED
```

---

# 22. Data That Should Not Be Persisted Continuously

The database should not be used as the real-time transport layer.

Do not continuously store:

```text
CURSOR_MOVED
CURSOR_MOVED
CURSOR_MOVED
CURSOR_MOVED
```

Likewise, avoid storing every raw browser pointer event individually.

These events should flow through:

```text
Client
   ↓
Socket.IO
   ↓
Game Server
   ↓
Room Broadcast
   ↓
Other Clients
```

and then expire naturally.

---

# 23. In-Memory Active Game State

### Important Architectural Decision Still Required

The system must define where the current active game state lives while a room is running.

Possible options:

### Option A: PostgreSQL as Continuous State Store

Every important state transition is persisted immediately.

### Option B: Active State in Server Memory + PostgreSQL Persistence

The Node.js server maintains active room state in memory and persists meaningful transitions.

Example:

```text
ACTIVE MEMORY

currentDrawer
currentWord
correctGuessers
round deadline
connected players
```

PostgreSQL stores durable history and recoverable state.

For V1 and a single server instance, this may be a practical approach, but crash recovery requirements must be considered.

This decision is not yet finalized.

---

# 24. Game State Model

A room may have states similar to:

```text
WAITING
    ↓
WORD_SELECTION
    ↓
ACTIVE_ROUND
    ↓
ROUND_ENDING
    ↓
NEXT_DRAWER
    ↓
WORD_SELECTION
```

If nobody guesses correctly:

```text
ACTIVE_ROUND
    ↓
TIME_EXPIRED
    ↓
WORD_REVEAL
    ↓
SAME_DRAWER
    ↓
WORD_SELECTION
    ↓
ACTIVE_ROUND
```

---

# 25. Real-Time Event Categories

Events should be separated conceptually by their reliability and importance.

## Category A: Authoritative Game Events

Examples:

```text
join-room
submit-word
submit-guess
round-start
round-end
score-update
drawer-selected
```

These require:

* Validation
* Authorization
* Server authority

---

## Category B: Drawing Events

Examples:

```text
stroke-start
stroke-points
stroke-end
```

These are frequent but structured.

The server verifies the drawer before broadcasting.

---

## Category C: Ephemeral Events

Examples:

```text
cursor-update
typing-indicator
temporary UI state
```

These events are transient.

Occasional loss is acceptable.

They should not be persisted.

---

# 26. Late Joiner Synchronization Flow

```text
Late Joiner
    │
    ▼
Join Room Request
    │
    ▼
Server validates request
    │
    ▼
Build sanitized room snapshot
    │
    ├── Players
    ├── Current drawer
    ├── Leaderboard
    ├── Remaining time
    ├── Canvas history
    └── Allowed game state
    │
    ▼
Send snapshot
    │
    ▼
Begin receiving live events
```

The secret word must never enter this synchronization flow.

---

# 27. Failure and Edge Cases

The following cases need explicit implementation handling.

## Drawer Disconnects

Open decision:

What happens if the drawer disconnects during an active round?

Possible approaches:

* Pause the round temporarily
* Allow a reconnect grace period
* Cancel and restart the round
* Select another drawer

---

## Guesser Disconnects

The server must determine whether disconnected players remain part of:

```text
activeGuessers
```

Otherwise a disconnected player could prevent:

```text
everyone guessed correctly
```

from ever becoming true.

---

## Server Restart

If active state exists only in memory, a server restart could destroy the current round.

The crash recovery behavior should be defined.

---

## Database Failure

The application should define expected behavior if PostgreSQL becomes temporarily unavailable.

For V1, graceful failure is sufficient; complex distributed failover is not required.

---

# 28. Core Success Criteria

V1 is considered successful if it can support the following flow reliably:

```text
Multiple players join a room
        ↓
A drawer is selected
        ↓
Drawer receives a secret word
        ↓
120-second round begins
        ↓
Drawer draws in real time
        ↓
Other players see drawing and cursor updates
        ↓
Players submit guesses
        ↓
Server validates guesses
        ↓
Correct answers are ranked
        ↓
Points are awarded
        ↓
Leaderboard updates live
        ↓
Round ends correctly
        ↓
Word is revealed
        ↓
Next drawer selected
        ↓
Game continues
```

Additionally:

* Late joiners can synchronize safely.
* Spectators can observe without affecting gameplay.
* The secret word cannot be discovered through normal client state or network inspection.
* Clients cannot award themselves points.
* Non-drawers cannot draw.
* High-frequency cursor events do not overload the database.
* Drawing history can be reconstructed for late joiners.

---

# 29. Open Decisions Before Implementation

The following items still need to be finalized:

1. Exact scoring formula for ranks 1–10.
2. Whether the previous drawer can immediately be selected again.
3. Whether correct guesses are visible as actual text or converted into a system message.
4. Exact spectator-to-player transition rules.
5. Maximum number of players per room.
6. Maximum number of spectators.
7. Username/display-name rules.
8. Reconnection grace period.
9. Drawer disconnect behavior.
10. Guesser disconnect behavior during a round.
11. Exact rate-limiting strategy.
12. Whether active game state lives fully in PostgreSQL or partially in server memory.
13. Database retention and cleanup policy.
14. Whether chat history is persisted and how much history late joiners receive.
15. Exact word validation rules.
16. Whether words can repeat within the same game session.
17. Whether completed games remain available historically.

---

# 30. Final V1 Definition

## Included

```text
React
Node.js
Express
Socket.IO
PostgreSQL

Anonymous players
Rooms
Spectator mode
Late joiners
Live drawing
Live cursor
Live chat
Server-side guessing
120-second rounds
Ranked guessing
Live leaderboard
Random drawer selection
Drawing reconstruction
Reconnection support
Input validation
Authorization
Rate limiting
```

## Deferred

```text
Voice chat
Video chat
WebRTC
mediasoup
Redis
MongoDB
Multi-instance deployment
Distributed scaling
Kubernetes
User accounts
```

---

# Product Principle

The core rule of the system is:

> **The client is an interface. The server is the authority.**

The client can request actions.

The server decides:

```text
Who can draw
What the secret word is
Whether a guess is correct
Who guessed first
How many points are awarded
When the round ends
Who becomes the next drawer
What information each client is allowed to see
```

The real-time system should distinguish clearly between:

```text
Authoritative events
        ↓
Validated and controlled by server

Persistent state
        ↓
Stored in PostgreSQL

Ephemeral real-time events
        ↓
Transported through Socket.IO
        ↓
Not persisted
```

This separation is the core architectural principle of V1.
