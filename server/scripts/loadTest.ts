import { io, Socket } from "socket.io-client";

function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const exact = `--${name}`;
  for (let i = 0; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length);
    }
    if (arg === exact && i + 1 < process.argv.length) {
      return process.argv[i + 1];
    }
  }
  return undefined;
}

const SERVER_URL = getArg("url") || process.env.SERVER_URL || "http://localhost:9000";
const NUM_ROOMS = Number(getArg("rooms") || process.env.ROOMS) || 5;
const PLAYERS_PER_ROOM = Number(getArg("players") || process.env.PLAYERS) || 4; // 20 players total by default
const DURATION_SECONDS = Number(getArg("duration") || process.env.DURATION) || 30;
const METRICS_TOKEN = getArg("token") || process.env.METRICS_TOKEN || "";

console.log(`\n🚀 Starting Skribble Load Test`);
console.log(`Server URL: ${SERVER_URL}`);
console.log(`Simulating: ${NUM_ROOMS} rooms × ${PLAYERS_PER_ROOM} players = ${NUM_ROOMS * PLAYERS_PER_ROOM} concurrent clients`);
console.log(`Duration:   ${DURATION_SECONDS}s`);
console.log(`Metrics:    ${METRICS_TOKEN ? "authenticated" : "no token — Lag/RSS will show N/A (pass --token=... or set METRICS_TOKEN)"}\n`);

interface ClientSession {
  socket: Socket;
  roomId: string;
  roomGroup: string;
  username: string;
  isOwner: boolean;
}

const clients: ClientSession[] = [];
const groupRoomIds = new Map<string, string>();
let totalMessagesSent = 0;
let totalMessagesReceived = 0;
let errorsCount = 0;

async function run() {
  const startTime = Date.now();

  for (let r = 0; r < NUM_ROOMS; r++) {
    const roomName = `LoadTest-Room-${r + 1}`;
    const roomGroup = `group-${r + 1}`;

    for (let p = 0; p < PLAYERS_PER_ROOM; p++) {
      const isOwner = p === 0;
      const username = `Bot_R${r + 1}_P${p + 1}`;

      const socket = io(SERVER_URL, {
        transports: ["websocket"],
        reconnection: false,
      });

      socket.on("connect_error", (err) => {
        errorsCount++;
      });

      socket.onAny(() => {
        totalMessagesReceived++;
      });

      socket.on("room:created", (data: { roomId: string }) => {
        const assignedRoomId = data.roomId;
        groupRoomIds.set(roomGroup, assignedRoomId);
        const fellowBots = clients.filter((c) => c.roomGroup === roomGroup);
        fellowBots.forEach((c) => (c.roomId = assignedRoomId));

        // Have fellow bots join this specific created room
        for (const bot of fellowBots) {
          if (!bot.isOwner && bot.socket.connected) {
            bot.socket.emit("room:join", {
              roomId: assignedRoomId,
              username: bot.username,
              role: "player",
            });
          }
        }
      });

      socket.on("connect", () => {
        if (isOwner) {
          socket.emit("room:create", {
            roomName,
            username,
            role: "player",
          });
        } else {
          // Join on own connect — fixes the room:created race where
          // fellow bots don't exist yet when the owner gets roomId.
          const knownRoomId = groupRoomIds.get(roomGroup);
          if (knownRoomId) {
            socket.emit("room:join", {
              roomId: knownRoomId,
              username,
              role: "player",
            });
          }
        }
      });

      clients.push({
        socket,
        roomId: "",
        roomGroup,
        username,
        isOwner,
      });

      // Stagger connections slightly
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  }

  // Periodic traffic simulator (chat, drawing)
  const trafficInterval = setInterval(() => {
    for (const client of clients) {
      if (!client.socket.connected) continue;

      // Send chat
      if (Math.random() < 0.3) {
        client.socket.emit("chat:send", {
          message: `Guess #${Math.floor(Math.random() * 1000)}`,
        });
        totalMessagesSent++;
      }

      // If owner (drawer in lobby), simulate continuous drawing
      if (client.isOwner && Math.random() < 0.6) {
        const strokeId = `stroke-${Date.now()}-${Math.random().toString(36).substring(7)}`;
        client.socket.emit("draw:start", {
          strokeId,
          color: "#2E1065",
          size: 4,
          startPoint: { x: Math.random(), y: Math.random() },
        });
        totalMessagesSent++;

        // Stream 3-5 chunks of drawing points
        client.socket.emit("draw:chunk", {
          strokeId,
          points: [
            { x: Math.random(), y: Math.random() },
            { x: Math.random(), y: Math.random() },
            { x: Math.random(), y: Math.random() },
          ],
        });
        totalMessagesSent++;
      }
    }
  }, 250);

  // Status display loop
  const statsInterval = setInterval(async () => {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const connectedCount = clients.filter((c) => c.socket.connected).length;

    let eventLoopLag = "N/A";
    let memoryRss = "N/A";
    let drawingStats = "Strokes: 0 | Pts: 0";

    try {
      const res = await fetch(`${SERVER_URL}/metrics`, {
        headers: METRICS_TOKEN ? { Authorization: `Bearer ${METRICS_TOKEN}` } : {},
      });
      if (res.ok) {
        const text = await res.text();
        const lagMatch = text.match(/skribble_nodejs_eventloop_lag_seconds\s+([\d.e+-]+)/);
        if (lagMatch) {
          const lagMs = (parseFloat(lagMatch[1]) * 1000).toFixed(2);
          eventLoopLag = `${lagMs} ms`;
        }
        const memMatch = text.match(/skribble_process_resident_memory_bytes\s+([\d.e+-]+)/);
        if (memMatch) {
          const memMb = (parseFloat(memMatch[1]) / (1024 * 1024)).toFixed(1);
          memoryRss = `${memMb} MB`;
        }

        const strokesMatch = text.match(/skribble_drawing_strokes_total\{action="start"\}\s+([\d.]+)/);
        const pointsMatch = text.match(/skribble_drawing_points_total\{format="json"\}\s+([\d.]+)/);
        const cachedMatch = text.match(/skribble_drawing_cached_strokes\s+([\d.]+)/);

        const totalStrokes = strokesMatch ? strokesMatch[1] : "0";
        const totalPoints = pointsMatch ? pointsMatch[1] : "0";
        const cachedStrokes = cachedMatch ? cachedMatch[1] : "0";

        drawingStats = `Strokes: ${totalStrokes} (cached: ${cachedStrokes}) | Pts: ${totalPoints}`;
      }
    } catch {
      // server metrics unreachable during interval
    }

    console.log(
      `[${elapsed}s/${DURATION_SECONDS}s] Sockets: ${connectedCount}/${clients.length} | Sent: ${totalMessagesSent} | Rcvd: ${totalMessagesReceived} | Lag: ${eventLoopLag} | RSS: ${memoryRss} | ${drawingStats}`,
    );
  }, 2000);

  // End test after duration
  setTimeout(() => {
    clearInterval(trafficInterval);
    clearInterval(statsInterval);

    console.log(`\n🛑 Test completed. Disconnecting all simulated clients...`);
    for (const client of clients) {
      client.socket.disconnect();
    }

    console.log(`\n--- Final Summary ---`);
    console.log(`Total messages sent:     ${totalMessagesSent}`);
    console.log(`Total messages received: ${totalMessagesReceived}`);
    console.log(`Total errors:            ${errorsCount}`);
    console.log(`Check live server metrics at: ${SERVER_URL}/metrics\n`);

    process.exit(0);
  }, DURATION_SECONDS * 1000);
}

run().catch((err) => {
  console.error("Load test failed:", err);
  process.exit(1);
});
