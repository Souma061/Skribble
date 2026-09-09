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
const WORD = "Stormword";

// Disconnect-storm probe: build score, drop ALL sockets mid-round at once,
// reconnect with identical usernames, report what survived.
async function run() {
  const N = 8;
  const sockets: Socket[] = [];
  const usernames = Array.from({ length: N }, (_, i) => `StormP${i}`);

  const owner: Socket = io(SERVER_URL, { transports: ["websocket"], reconnection: false });
  await new Promise<void>((res) => owner.on("connect", () => res()));
  owner.emit("room:create", { roomName: "Storm", username: usernames[0], role: "player" });
  const created: { roomId: string; playerToken: string } = await new Promise((res) =>
    owner.on("room:created", (d: { roomId: string; playerToken: string }) => res(d)),
  );
  const roomId = created.roomId;
  const tokens: Record<string, string> = { [usernames[0]]: created.playerToken };
  sockets.push(owner);

  for (let i = 1; i < N; i++) {
    const s: Socket = io(SERVER_URL, { transports: ["websocket"], reconnection: false });
    await new Promise<void>((res) => s.on("connect", () => res()));
    const uname = usernames[i];
    s.on("room:joined", (d: { playerToken: string }) => {
      tokens[uname] = d.playerToken;
    });
    s.emit("room:join", { roomId, username: uname, role: "player" });
    s.on("round:prompt-word", () => s.emit("round:set-word", { word: WORD }));
    sockets.push(s);
  }
  owner.on("round:prompt-word", () => owner.emit("round:set-word", { word: WORD }));
  let latestScores: Record<string, number> = {};
  owner.on("room:state", (room: { players: { username: string; score: number }[] }) => {
    latestScores = {};
    for (const p of room.players) latestScores[p.username] = p.score;
  });
  await new Promise((res) => setTimeout(res, 2000));

  owner.emit("game:start");
  await new Promise((res) => setTimeout(res, 3000));
  // Build a nonzero score before the storm
  sockets[1].emit("chat:send", { message: WORD });
  await new Promise((res) => setTimeout(res, 1500));

  const preScores = latestScores;
  console.log("scores before storm:", JSON.stringify(preScores));

  // STORM: simultaneous drop mid-round
  console.log("STORM: disconnecting all 8 sockets at once...");
  for (const s of sockets) s.disconnect();
  await new Promise((res) => setTimeout(res, 2000));

  // Reconnect with identical usernames AND saved tokens (mirrors App.tsx localStorage flow)
  console.log("reconnecting with same usernames + tokens...");
  const errors: string[] = [];
  let postScores: Record<string, number> = {};
  for (let i = 0; i < N; i++) {
    const s: Socket = io(SERVER_URL, { transports: ["websocket"], reconnection: false });
    await new Promise<void>((res) => s.on("connect", () => res()));
    s.on("room:error", (e: { code: string }) => errors.push(`${usernames[i]}:${e.code}`));
    s.on("room:joined", (d: { room: { players: { username: string; score: number }[] } }) => {
      for (const p of d.room.players) postScores[p.username] = p.score;
    });
    s.emit("room:join", { roomId, username: usernames[i], role: "player", playerToken: tokens[usernames[i]] });
    await new Promise((res) => setTimeout(res, 100));
    s.disconnect();
  }
  await new Promise((res) => setTimeout(res, 1000));

  console.log("join errors:", errors.length ? errors.join(", ") : "none");
  console.log("scores after rejoin:", JSON.stringify(postScores));
  const kept = Object.keys(preScores).filter((u) => (postScores[u] ?? -1) === preScores[u] && preScores[u] > 0);
  console.log(`\n--- Storm verdict: ${kept.length > 0 ? "scores SURVIVED (reconnection works)" : "scores LOST (no reconnection — expected until playerToken+grace lands)"} ---\n`);
  process.exit(0);
}

run().catch((e) => { console.error(e); process.exit(1); });
