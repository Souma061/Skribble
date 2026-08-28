export function initialGameState() {
    return {
        status: "WAITING",
        currentDrawerId: null,
        roundNumber: 0,
    };
}
export class GameEngine {
    state;
    constructor(game = initialGameState()) {
        this.state = game;
    }
    getState() {
        return this.state;
    }
    selectDrawer(playerIds, random = Math.random) {
        if (playerIds.length === 0) {
            throw new EngineError("NO_PLAYERS", "Cannot start a game with no players");
        }
        const prev = this.state.currentDrawerId;
        const candidates = playerIds.filter((id) => id !== prev);
        const pool = candidates.length > 0 ? candidates : playerIds;
        const drawer = pool[Math.floor(random() * pool.length)] ?? "";
        this.state.currentDrawerId = drawer;
        this.state.roundNumber += 1;
        this.state.status = "WORD_SELECTION";
        return drawer;
    }
}
export class EngineError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}
//# sourceMappingURL=GameEngine.js.map