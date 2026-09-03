import type { GameState } from "./types.js";

export function initialGameState(): GameState {
  return {
    status: "WAITING",
    currentDrawerId: null,
    roundNumber: 0,
  };
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
  }
  return shuffled;
}

export class GameEngine {
  private state: GameState;
  private drawerQueue: string[] = [];

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

  removeQueuedPlayer(playerId: string): boolean {
    const index = this.drawerQueue.indexOf(playerId);
    if (index === -1) return false;
    this.drawerQueue.splice(index, 1);
    return true;
  }
}

export class EngineError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
