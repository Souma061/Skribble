export type GameStatus = "WAITING" | "WORD_SELECTION" | "ACTIVE_ROUND" | "ROUND_ENDING";
export interface GameState {
  status: GameStatus;
  currentDrawerId: string | null;
  roundNumber: number;
};

