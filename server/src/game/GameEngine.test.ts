import { GameEngine, initialGameState } from "./GameEngine.js";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) console.log("  ok -", msg);
  else { console.log("  FAIL -", msg); failed++; }
}

const rand = () => 0; // deterministic: pick first candidate

const engine = new GameEngine();
assert(engine.getState().status === "WAITING", "starts in WAITING with roundNumber 0");
assert(engine.getState().roundNumber === 0 && engine.getState().currentDrawerId === null, "initial game state");

const players = ["A", "B", "C"];
const first = engine.selectDrawer(players, rand);
assert(first === "A", "round 1 drawer is A");
assert(engine.getState().status === "WORD_SELECTION", "transitions to WORD_SELECTION");
assert(engine.getState().roundNumber === 1, "roundNumber bumped to 1");

const second = engine.selectDrawer(players, rand);
assert(second === "B", "previous drawer (A) excluded, picks B");

const third = engine.selectDrawer(players, rand);
assert(third === "A", "previous drawer (B) excluded, picks from [A,C] -> A");

// Single-player edge: no other eligible, previous excluded -> falls back to same player
const solo = new GameEngine(initialGameState());
solo.selectDrawer(["X"], rand);
const solo2 = solo.selectDrawer(["X"], rand);
assert(solo2 === "X", "sole player remains drawer when no other eligible");

console.log(failed ? `RESULT: FAIL (${failed})` : "RESULT: PASS");
process.exit(failed ? 1 : 0);
