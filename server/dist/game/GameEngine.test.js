import { EngineError, GameEngine } from "./GameEngine.js";
import { calculateRemainingSeconds, crossedTimeThreshold } from "./timerUtils.js";
import { doesMessageRevealWord, findAllowedWord, isExactWordMatch, validateCustomWord, } from "./wordUtils.js";
let failed = 0;
function assert(cond, msg) {
    if (cond)
        console.log("  ok -", msg);
    else {
        console.log("  FAIL -", msg);
        failed++;
    }
}
const rand = () => 0; // deterministic: pick first candidate
const engine = new GameEngine();
assert(engine.getState().status === "WAITING", "starts in WAITING with roundNumber 0");
assert(engine.getState().roundNumber === 0 && engine.getState().currentDrawerId === null, "initial game state");
const players = ["A", "B", "C"];
const first = engine.selectDrawer(players, rand);
assert(engine.getState().status === "WORD_SELECTION", "transitions to WORD_SELECTION");
assert(engine.getState().roundNumber === 1, "roundNumber bumped to 1");
const second = engine.selectDrawer(players, rand);
const third = engine.selectDrawer(players, rand);
assert(new Set([first, second, third]).size === 3, "each player draws exactly once per match");
try {
    engine.selectDrawer(players, rand);
    assert(false, "should reject a round after the drawer queue is exhausted");
}
catch (error) {
    assert(error instanceof EngineError && error.code === "NO_DRAWERS_LEFT", "rejects rounds after every player has drawn");
}
const departureEngine = new GameEngine();
departureEngine.selectDrawer(players, rand);
assert(departureEngine.removeQueuedPlayer("C"), "removes a departing player from the queue");
assert(departureEngine.selectDrawer(players.filter((id) => id !== "C"), rand) === "A", "skips departed drawers");
assert(isExactWordMatch("  Red   Apple ", "red apple"), "normalizes exact guesses");
assert(findAllowedWord(["Sunflower", "Red Apple"], " red   apple ") === "Red Apple", "accepts only a normalized server suggestion");
assert(findAllowedWord(["Sunflower"], "Rocket") === undefined, "distinguishes custom words from suggestions");
assert(validateCustomWord("Tom & Jerry") === "Tom & Jerry", "accepts a valid custom topic");
assert(validateCustomWord("<script>") === undefined, "rejects unsafe custom-topic characters");
assert(validateCustomWord("x".repeat(41)) === undefined, "rejects oversized custom topics");
assert(doesMessageRevealWord("The answer is red apple!", "Red Apple"), "detects secret words in chat");
assert(!doesMessageRevealWord("A caterpillar", "cat"), "does not match secret fragments inside words");
const deadline = 1_000_000;
assert(calculateRemainingSeconds(deadline, deadline - 120_000) === 120, "calculates full round time");
assert(calculateRemainingSeconds(deadline, deadline - 59_001) === 60, "rounds remaining time up");
assert(calculateRemainingSeconds(deadline, deadline + 1) === 0, "never returns negative time");
assert(crossedTimeThreshold(61, 59, 60), "detects a skipped reveal threshold");
assert(!crossedTimeThreshold(60, 59, 60), "reveals each threshold only once");
console.log(failed ? `RESULT: FAIL (${failed})` : "RESULT: PASS");
process.exit(failed ? 1 : 0);
//# sourceMappingURL=GameEngine.test.js.map