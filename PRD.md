# Updates — Finalized Product Decisions

## 11. Drawer Selection

After a successful round where at least one player guessed correctly, the next drawer is selected randomly.

### Drawer Selection Rule

The previously selected drawer cannot immediately become the next drawer if another eligible active player exists.

```text
Eligible players: A, B, C, D

Current drawer: A
        ↓
Round ends
        ↓
Randomly select from:

B, C, D
```

### Edge Case

If no other eligible active player exists, the current drawer may remain the drawer.

### Final Rule

```text
Randomly select from eligible active players,
excluding the previous drawer,
unless no other eligible player exists.
```

Spectators and disconnected players are not eligible for drawer selection.

---

# 12. Room Capacity

Each room supports a maximum of:

```text
15 Active Players
+
15 Spectators
=
30 Total Connections
```

### Active Players

Active players can:

* Guess
* Earn points
* Become the drawer
* Participate in the game

### Spectators

Spectators can:

* Watch the drawing
* View the leaderboard
* View the game state
* View chat

Spectators cannot:

* Draw
* Submit guesses for points
* Earn points
* Become the drawer

---

# 13. Username Rules

Each player selects a display name when joining a room.

### Validation Rules

```text
Minimum length: 3 characters
Maximum length: 20 characters

Allowed:
- Letters
- Numbers
- Spaces
- Underscores
```

Examples:

```text
Souma          ✅
Player_01      ✅
Cool Guy       ✅
A              ❌
<svg>          ❌
```

Additional rules:

* Names must be unique within a room.
* The server validates all names.
* Leading and trailing whitespace is removed.
* Multiple spaces may be normalized.
* Usernames are rendered as plain text.
* Usernames must never be rendered as raw HTML.

---

# 18. Player Disconnection and Reconnection

## Guesser Disconnect

When a guesser disconnects during an active round:

```text
Player disconnects
        ↓
Marked as DISCONNECTED
        ↓
Removed from active guesser count
        ↓
Cannot block "everyone guessed correctly"
```

The disconnected player remains eligible for reconnection during the configured grace period.

If the player reconnects:

* Their identity is restored.
* Their score is restored.
* Their room membership is restored.
* If they already guessed correctly, that status remains.
* Otherwise, they may continue guessing in the current round.

A disconnected player must not prevent the server from ending a round because all remaining active guessers have already answered correctly.

---

# 21. PostgreSQL Data Retention and Room Cleanup

PostgreSQL stores room-related data only for the lifetime defined by the room retention policy.

## Abandoned Rooms

A room that becomes abandoned is automatically deleted after:

```text
24 hours
```

## Completed Rooms

A completed room may be deleted in two ways:

```text
1. Manual deletion by the room owner/creator
```

or:

```text
2. Automatic deletion after 2 days
```

### Final Lifecycle

```text
Room Completed
      │
      ├── Manual Delete
      │       ↓
      │    Delete Immediately
      │
      └── No Manual Delete
              ↓
         2 Days Pass
              ↓
         Auto Delete
```

When a room is deleted, all associated room data is deleted.

This includes:

```text
Room
├── Players / memberships
├── Rounds
├── Scores
├── Correct guesses
├── Drawing strokes
├── Chat messages
└── Game events
```

---

# 22. Chat History and Retention

Chat messages belong to the room.

They do not have an independent retention period.

```text
Room Active
      ↓
Chat messages stored with room
      ↓
Late joiners may receive room chat history
      ↓
Room deleted
      ↓
All associated chat messages deleted
```

Therefore:

* Abandoned room deleted after 24 hours → chat deleted.
* Completed room manually deleted → chat deleted immediately.
* Completed room not manually deleted → chat automatically deleted after 2 days.

The room lifecycle controls the chat lifecycle.

---

# 29. Finalized Open Decisions

The following decisions are now finalized:

| Decision                 | Final Rule                                                      |
| ------------------------ | --------------------------------------------------------------- |
| Previous drawer          | Cannot immediately draw again if another eligible player exists |
| Active players           | Maximum 15                                                      |
| Spectators               | Maximum 15                                                      |
| Total room connections   | Maximum 30                                                      |
| Username length          | 3–20 characters                                                 |
| Username uniqueness      | Unique within a room                                            |
| Guesser disconnect       | Removed from active guesser count immediately                   |
| Reconnection             | Identity and score restored during grace period                 |
| Abandoned room retention | Auto-delete after 24 hours                                      |
| Completed room retention | Manual delete or auto-delete after 2 days                       |
| Chat retention           | Exists only with the room                                       |
| Room deletion            | Deletes all associated game data                                |

---

# 30. Final V1 Scope

## Included

```text
React
Node.js
Express
Socket.IO
PostgreSQL

Anonymous players
Temporary player identity
Rooms
15 active players per room
15 spectators per room
Late joiners
Spectator mode

Live drawing
Live cursor synchronization (Cancelled by user - adds unnecessary complexity)
HTML5 Canvas
Stroke batching
Stroke finalization (`draw:end`)
Canvas reconstruction

Live chat
Server-side guess validation
120-second rounds
Time-based scoring
Live leaderboard

Random drawer selection
Previous drawer exclusion
Server-authoritative game logic

Player reconnection
Input validation
Authorization
Rate limiting

Room lifecycle management
Automatic cleanup
Manual room deletion
PostgreSQL persistence
```

## Explicitly Deferred

```text
Voice chat
Video chat
WebRTC
mediasoup
Redis
MongoDB
Multi-instance scaling
Distributed game servers
Kubernetes
User authentication
Persistent user accounts
```

# Final V1 Principle

```text
Client
   ↓ requests actions
Server
   ↓ validates and decides
Database
   ↓ persists meaningful state
Socket.IO
   ↓ distributes live events
Clients
   ↓ render the result
```

> **The client requests. The server decides. PostgreSQL persists. Socket.IO synchronizes.**
