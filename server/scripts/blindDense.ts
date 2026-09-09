import { io, Socket } from "socket.io-client";
import { encodeBinaryChunk } from "../../client/src/utils/binaryDrawing.js";

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
const DURATION = Number(getArg("duration") || 60);
const TOKEN = getArg("token") || process.env.METRICS_TOKEN || "";

// Dense-stroke probe: max-size (500pt) JSON + binary chunks at the 30/s
// rate-limit edge, then measures draw:request-sync payload growth.
async function run() {
  const owner: Socket = io(SERVER_URL, { transports: ["websocket"], reconnection: false });
  await new Promise<void>((res) => owner.on("connect", () => res()));
  owner.emit("room:create", { roomName: "Dense", username: "DenseOwner", role: "player" });
  const roomId: string = await new Promise((res) =>
    owner.on("room:created", (d: { roomId: string }) => res(d.roomId)),
  );

  const watcher: Socket = io(SERVER_URL, { transports: ["websocket"], reconnection: false });
  await new Promise<void>((res) => watcher.on("connect", () => res()));
  watcher.emit("room:join", { roomId, username: "DenseWatcher", role: "player" });

  let chunksReceived = 0;
  watcher.on("draw:chunk", () => chunksReceived++);

  owner.emit("draw:start", {
    strokeId: "dense-1", color: "#000000", size: 6, startPoint: { x: 0.5, y: 0.5 },
  });

  // Alternate JSON-500pt / binary-500pt chunks every 33ms (~30/s)
  let sent = 0, binary = false, t = 0;
  const pump = setInterval(() => {
    const pts = Array.from({ length: 500 }, (_, i) => ({
      x: (t + i / 500) % 1, y: (Math.sin((t + i / 500) * 6.28) + 1) / 2,
    }));
    if (binary) owner.emit("draw:chunk", encodeBinaryChunk(1, pts));
    else owner.emit("draw:chunk", { strokeId: "dense-1", points: pts });
    binary = !binary; t += 0.01; sent++;
  }, 33);

  // Sample sync payload every 5s
  const samples: { history: number; bytes: number; ms: number }[] = [];
  const sampler = setInterval(() => {
    const start = Date.now();
    watcher.once("draw:sync", (d: { history: unknown[] }) => {
      const bytes = Buffer.byteLength(JSON.stringify(d.history));
      samples.push({ history: d.history.length, bytes, ms: Date.now() - start });
      console.log(`[sync] strokes=${d.history.length} bytes=${(bytes / 1024).toFixed(0)}KB in ${Date.now() - start}ms`);
    });
    watcher.emit("draw:request-sync");
  }, 5000);

  // Metrics snapshot every 10s
  const metrics = setInterval(async () => {
    try {
      const res = await fetch(`${SERVER_URL}/metrics`, {
        headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {},
      });
      if (!res.ok) return;
      const txt = await res.text();
      const pick = (re: RegExp) => txt.match(re)?.[1] ?? "?";
      console.log(`[metrics] lag=${(parseFloat(pick(/skribble_nodejs_eventloop_lag_seconds\s+([\d.e+-]+)/)) * 1000).toFixed(2)}ms rss=${(parseFloat(pick(/skribble_process_resident_memory_bytes\s+([\d.e+-]+)/)) / 1048576).toFixed(1)}MB cached=${pick(/skribble_drawing_cached_strokes\s+([\d.]+)/)}`);
    } catch { /* unreachable */ }
  }, 10000);

  setTimeout(() => {
    clearInterval(pump); clearInterval(sampler); clearInterval(metrics);
    const last = samples[samples.length - 1];
    console.log(`\n--- Dense summary ---`);
    console.log(`chunks sent: ${sent} | chunk broadcasts received: ${chunksReceived}`);
    console.log(last ? `final sync: ${last.history} strokes, ${(last.bytes / 1024).toFixed(0)}KB in ${last.ms}ms` : "no sync samples");
    console.log(`OOM test: re-run with --duration=600 and watch RSS slope\n`);
    owner.disconnect(); watcher.disconnect();
    process.exit(0);
  }, DURATION * 1000);
}

run().catch((e) => { console.error(e); process.exit(1); });
