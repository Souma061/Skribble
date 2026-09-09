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
- Live chat and leaderboard
- Server-authoritative game logic: server-side guess validation, random drawer selection (previous drawer excluded), 120-second rounds, time-based scoring
- Player reconnection with identity/score restore during a grace period
- Room lifecycle: auto-delete abandoned rooms after 24h, completed rooms after 2 days, or manual deletion by the owner
- Input validation, authorization, and rate limiting

See [`PRD.md`](./PRD.md) for the finalized product decisions.

## Project Structure

```text
skribble_game/
├── client/    # React + Vite frontend
├── server/    # Express + Socket.IO backend
├── render.yaml  # Render deployment config
└── PRD.md
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
| `pnpm run test`    | server   | Run Room + GameEngine tests         |
| `pnpm run build`   | server   | Type-check and compile to `dist/`   |
| `pnpm run start`   | server   | Run compiled server                 |
| `pnpm run dev`     | client   | Vite dev server                     |
| `pnpm run build`   | client   | Type-check and build for production |
| `pnpm run lint`    | client   | ESLint                              |
| `pnpm run preview` | client   | Preview the production build        |

## Deployment

- **Server**: `render.yaml` deploys `server/` to Render with `DATABASE_URL` and a generated `METRICS_TOKEN`; `/health` is the health check. Scrape `/metrics` with `Authorization: Bearer <METRICS_TOKEN>`.
- **Client**: `client/vercel.json` deploys to Vercel; the Socket.IO URL is `https://skribble-eight.vercel.app` by default (set `CLIENT_URL` on the server to match).
