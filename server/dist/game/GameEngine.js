export function initialGameState() {
    return {
        status: "WAITING",
        currentDrawerId: null,
        roundNumber: 0,
    };
}
function shuffle(items, random) {
    const shuffled = [...items];
    for (let index = shuffled.length - 1; index > 0; index--) {
        const swapIndex = Math.floor(random() * (index + 1));
        [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    return shuffled;
}
export class GameEngine {
    state;
    drawerQueue = [];
    constructor(game = initialGameState()) {
        this.state = game;
    }
    getState() {
        return { ...this.state };
    }
    selectDrawer(playerIds, random = Math.random) {
        if (playerIds.length === 0) {
            throw new EngineError("NO_PLAYERS", "Cannot start a game with no players");
        }
        const eligibleIds = new Set(playerIds);
        this.drawerQueue = this.drawerQueue.filter((id) => eligibleIds.has(id));
        if (this.state.roundNumber === 0) {
            this.drawerQueue = shuffle(playerIds, random);
        }
        const drawer = this.drawerQueue.shift();
        if (!drawer) {
            throw new EngineError("NO_DRAWERS_LEFT", "No eligible drawers remain in this match");
        }
        this.state.currentDrawerId = drawer;
        this.state.roundNumber += 1;
        this.state.status = "WORD_SELECTION";
        return drawer;
    }
    removeQueuedPlayer(playerId) {
        const index = this.drawerQueue.indexOf(playerId);
        if (index === -1)
            return false;
        this.drawerQueue.splice(index, 1);
        return true;
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