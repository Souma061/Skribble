import { io, Socket } from "socket.io-client";

function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const exact = `--${name}`;
  for (let i = 0; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
    if (arg === exact && i + 1 < process.argv.length) return process.argv[i + 1];
  }
  return undefined;
}

const SERVER_URL = getArg("url") || process.env.SERVER_URL || "http://localhost:9000";
const ROOMS = Number(getArg("rooms") || 3);
const PLAYERS = Number(getArg("players") || 4);
const DURATION = Number(getArg("duration") || 90);
const TOKEN = getArg("token") || process.env.METRICS_TOKEN || "";
const WORD = "Testword";

let ticks = 0, correct = 0, close = 0, ended = 0, assigned = 0, drawerLeftFired = 0;
const groupRoomIds = new Map<string, string>();

async function buildRoom(r: number) {
  const group = `game-${r}`;
  const sockets: Socket[] = [];
  for (let p = 0; p < PLAYERS; p++) {
    const isOwner = p === 0;
    const username = `G${r}P${p}`;
    const s: Socket = io(SERVER_URL, { transports: ["websocket"], reconnection: false });
    sockets.push(s);
    s.on("timer:tick", () => ticks++);
    s.on("round:word-assigned", () => assigned++);
    s.on("guess:correct", () => correct++);
    s.on("guess:close", () => close++);
    s.on("round:ended", (d: { reason: string }) => {
      ended++;
      if (d.reason.includes("drawer left")) drawerLeftFired++;
    });
    // Whoever is picked as drawer sets the known word immediately
    s.on("round:prompt-word", () => s.emit("round:set-word", { word: WORD }));
    s.on("room:created", (d: { roomId: string }) => {
      groupRoomIds.set(group, d.roomId);
      for (const o of sockets) (o as unknown as { roomId?: string }).roomId = d.roomId;
      for (const o of sockets) if (o !== s && o.connected) o.emit("room:join", { roomId: d.roomId, username: (o as unknown as { uname: string }).uname, role: "player" });
    });
    (s as unknown as { uname: string }).uname = username;
    await new Promise<void>((res) => s.on("connect", () => {
      if (isOwner) s.emit("room:create", { roomName: `Game-${r}`, username, role: "player" });
      else {
        const known = groupRoomIds.get(group);
        if (known) s.emit("room:join", { roomId: known, username, role: "player" });
      }
      res();
    }));
    await new Promise((res) => setTimeout(res, 30));
  }
  return sockets;
}

async function run() {
  console.log(`\nGame-flow load: ${ROOMS} rooms x ${PLAYERS} players, ${DURATION}s, word="${WORD}"`);
  const all: Socket[][] = [];
  for (let r = 0; r < ROOMS; r++) all.push(await buildRoom(r));
  await new Promise((res) => setTimeout(res, 3000)); // let joins settle

  // Start a real round in every room. Guesses go out AFTER beginRound
  // (prompt -> set-word -> ACTIVE takes ~1s) and repeat every 15s so a
  // single early/late race can't zero the whole run.
  for (const sockets of all) sockets[0].emit("game:start");
  await new Promise((res) => setTimeout(res, 4000));
  const fireGuesses = () => {
    for (const sockets of all) {
      sockets[1].emit("chat:send", { message: WORD });      // correct
      sockets[2 % sockets.length].emit("chat:send", { message: "nonsenseguess" }); // wrong
    }
  };
  fireGuesses();
  const guessTimer = setInterval(fireGuesses, 15000);

  // Mid-test: drawer leaves room 0 -> exercises finishRound-on-departure
  setTimeout(() => {
    console.log("(drawer-departure probe: disconnecting one socket per room's drawer is manual — skipping auto, rounds run on timer)");
  }, (DURATION * 1000) / 2);

  const metrics = setInterval(async () => {
    try {
      const res = await fetch(`${SERVER_URL}/metrics`, {
        headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {},
      });
      if (!res.ok) return;
      const txt = await res.text();
      const lag = txt.match(/skribble_nodejs_eventloop_lag_seconds\s+([\d.e+-]+)/)?.[1];
      const rss = txt.match(/skribble_process_resident_memory_bytes\s+([\d.e+-]+)/)?.[1];
      console.log(`[metrics] lag=${((parseFloat(lag!) * 1000) || 0).toFixed(2)}ms rss=${((parseFloat(rss!) / 1048576) || 0).toFixed(1)}MB ticks=${ticks} correct=${correct} close=${close} ended=${ended}`);
    } catch { /* unreachable */ }
  }, 10000);

  setTimeout(() => {
    clearInterval(metrics);
    clearInterval(guessTimer);
    console.log(`\n--- Game summary ---`);
    console.log(`word-assigned received: ${assigned} (expect >= ${ROOMS}; 0 = set-word never landed)`);
    console.log(`timer:tick received: ${ticks} (expect ~${ROOMS * PLAYERS} clients x ${DURATION}s)`);
    console.log(`guess:correct: ${correct} (expect >= ${ROOMS}) | guess:close: ${close} | round:ended: ${ended}`);
    console.log(`timer pileup verdict: lag single-digit + ticks ~= rooms x seconds = healthy\n`);
    for (const sockets of all) for (const s of sockets) s.disconnect();
    process.exit(0);
  }, DURATION * 1000);
}

run().catch((e) => { console.error(e); process.exit(1); });
