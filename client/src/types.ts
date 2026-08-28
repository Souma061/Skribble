export type PlayerRole = "player" | "spectator";

export interface Player {
  id: string;
  username: string;
  role: PlayerRole;
  joinedAt: number;
}

export type GameStatus = "WAITING" | "WORD_SELECTION" | "ACTIVE_ROUND" | "ROUND_ENDING";

export interface GameState {
  status: GameStatus;
  currentDrawerId: string | null;
  roundNumber: number;
}

export interface RoomState {
  id: string;
  name: string;
  ownerId: string;
  players: Player[];
  activePlayerCount: number;
  spectatorCount: number;
  maxActivePlayers: number;
  maxSpectators: number;
  game: GameState;
  createdAt: number;
  isAbandoned: boolean;
  isCompleted: boolean;
}
