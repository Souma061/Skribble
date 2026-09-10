# Skribble Game

A multi-player real-time drawing and guessing game (Pictionary-style). One player draws while the rest guess; the drawer picks a word from a list and strokes are synced live over Socket.IO.

**The client requests. The server decides. PostgreSQL persists. Socket.IO synchronizes.**

## Stack

| Layer    | Tech                                                         |
| -------- | ------------------------------------------------------------ |
| Client   | React 19, TypeScript, Vite, Tailwind CSS 4, Socket.IO client |
| Server   | Node.js, Express, Socket.IO, TypeScript                      |
| Database | PostgreSQL via Prisma                                        |

## Features

- Rooms with up to **15 active players + 15 spectators** (30 total connections)
- Live canvas drawing with binary stroke batching and canvas reconstruction
- Live chat with late-joiner history, secret-word filtering, and close-guess hints
- Server-authoritative game logic: drawer selection via shuffled queue (each player draws once per match), 120-second rounds, time-based scoring
- Player reconnection: stable `playerToken` identity persisted in `localStorage`, 120-second grace period for disconnects, fast browser refresh rebind
- Drawer disconnect handling: 30-second fuse timer — round ends if drawer doesn't return
- Rate limiting on all socket events including drawing
- Room listing with live player counts
- PostgreSQL persistence: rooms, players, rounds, strokes, chat, and correct guesses
- Room lifecycle: auto-delete abandoned rooms after 24h, completed rooms after 2 days, or manual deletion by the owner

See [`PRD.md`](./PRD.md) for the finalized product decisions and [`CODE_REVIEW.md`](./CODE_REVIEW.md) for the security/quality audit.

## Project Structure

```text
skribble_game/
├── client/        # React + Vite frontend
├── server/        # Express + Socket.IO backend
├── render.yaml    # Render deployment config
├── PRD.md
└── CODE_REVIEW.md
```

## Getting Started

Requires Node.js, `pnpm`, and a local PostgreSQL database.

### Server

```sh
cd server
pnpm install
cp .env.example .env        # set DATABASE_URL, PORT, CLIENT_URL, METRICS_TOKEN
pnpm exec prisma migrate dev
pnpm exec prisma db seed
pnpm run dev               # http://localhost:9000
```

### Client

```sh
cd client
pnpm install
pnpm run dev               # http://localhost:5173
```

The client connects to the server via `VITE_SERVER_URL` (default `http://localhost:9000`), so set it to your server URL for local dev.

### Scripts

| Command            | Location | Description                         |
| ------------------ | -------- | ----------------------------------- |
| `pnpm run dev`     | server   | Run server with hot reload          |
| `pnpm run test`    | server   | Run binary drawing, GameEngine, and room tests |
| `pnpm run build`   | server   | Type-check and compile to `dist/`   |
| `pnpm run start`   | server   | Run compiled server                 |
| `pnpm run dev`     | client   | Vite dev server                     |
| `pnpm run build`   | client   | Type-check and build for production |
| `pnpm run lint`    | client   | ESLint                              |
| `pnpm run preview` | client   | Preview the production build        |

## Deployment

- **Server**: `render.yaml` deploys `server/` to Render with `DATABASE_URL` and a generated `METRICS_TOKEN`; `/health` is the health check. Scrape `/metrics` with `Authorization: Bearer <METRICS_TOKEN>`.
- **Client**: `client/vercel.json` deploys to Vercel; the Socket.IO URL is `https://skribble-eight.vercel.app` by default (set `CLIENT_URL` on the server to match).

## Architecture

The server enforces all game rules — the client is a thin rendering layer.

```
Client (React + Socket.IO)
    │
    ├─ emit: room:create, room:join, game:start, round:set-word
    ├─ emit: draw:start, draw:chunk, draw:end, draw:clear, draw:undo
    ├─ emit: chat:send, chat:request-sync
    │
    ▼
Server (Express + Socket.IO)
    ├─ rooms.ts        — pure state transitions (join, leave, sweep, prune)
    ├─ roomHandlers.ts — socket event wiring, validation, timers, round flow
    ├─ drawHandlers.ts — binary/JSON drawing stream, stroke persistence
    ├─ GameEngine      — drawer queue, word masking, round lifecycle
    ├─ db.ts           — Prisma queries, rate limiter, metrics
    └─ index.ts        — Express app, health/metrics endpoints
    │
    ▼
PostgreSQL (Prisma)
    ├─ Room, Player, Round, CorrectGuess, DrawingStroke, ChatMessage, Word
```

### Identity Model

Each player has a stable `playerToken` (UUID) generated on first join and stored in the browser's `localStorage`. This token is the primary key for room membership — it survives disconnects, browser refreshes, and network blips. `socket.id` is an ephemeral wire address that gets remapped on rejoin.

### Reconnection Flow

1. Client connects and sends `room:join` with its saved `playerToken`
2. Server finds the ghost player (seat reserved for up to 120 seconds)
3. Socket ID is rebound, round state is re-emitted (word/blanks for drawer, masked word for guessers)
4. If the ghost was the drawer, the fuse timer is cancelled and the round continues
5. If grace period expires, the ghost is evicted and another player can take the name
