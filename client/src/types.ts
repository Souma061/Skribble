export type PlayerRole = "player" | "spectator";

export interface Player {
  id: string;
  socketId?: string;
  username: string;
  role: PlayerRole;
  score: number;
  joinedAt: number;
  isConnected?: boolean;
  disconnectedAt?: number | null;
}

export type GameStatus =
  "WAITING" | "WORD_SELECTION" | "ACTIVE_ROUND" | "ROUND_ENDING" | "COMPLETED";

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
  timeLeft?: number;
  roundEndsAt?: number;
  roundDurationSec?: number;
  serverNow?: number;
  correctGuesserCount?: number;
  maxRounds?: number;
  chatHistory?: ChatMessage[];
}

export interface RoomSummary {
  id: string;
  name: string;
  activePlayerCount: number;
  spectatorCount: number;
  status: GameStatus;
  roundNumber: number;
}

export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface Stroke {
  id: string;
  seq?: number | undefined;
  color: string;
  size: number;
  points: NormalizedPoint[];
}

export interface StrokeStartPayload {
  strokeId: string;
  seq?: number | undefined;
  color: string;
  size: number;
  startPoint: NormalizedPoint;
}

export interface StrokeChunkPayload {
  strokeId: string;
  points: NormalizedPoint[];
}

export interface ChatMessage {
  id: string;
  username: string;
  message: string;
  type: "CHAT" | "CORRECT_GUESS" | "CLOSE_GUESS" | "SYSTEM";
}
