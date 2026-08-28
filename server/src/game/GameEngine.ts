import type { GameState } from "./types.js";

export function initialGameState(): GameState {
  return {
    status: "WAITING",
    currentDrawerId: null,
    roundNumber: 0,
  };
}

export class GameEngine {
  private state: GameState;

  constructor(game: GameState = initialGameState()) {
    this.state = game;
  }

  getState(): GameState {
    return this.state;
  }

  selectDrawer(playerIds: string[], random: () => number = Math.random): string {
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
  constructor(public code: string, message: string) {
    super(message);
  }
}
