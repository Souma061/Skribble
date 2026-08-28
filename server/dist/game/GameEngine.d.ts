import type { GameState } from "./types.js";
export declare function initialGameState(): GameState;
export declare class GameEngine {
    private state;
    constructor(game?: GameState);
    getState(): GameState;
    selectDrawer(playerIds: string[], random?: () => number): string;
}
export declare class EngineError extends Error {
    code: string;
    constructor(code: string, message: string);
}
//# sourceMappingURL=GameEngine.d.ts.map