export const LOST_CITIES_COLORS = [
  "yellow", "white", "blue", "green", "red", "purple",
] as const;

export type LostCitiesColor = (typeof LOST_CITIES_COLORS)[number];
export type LostCitiesCardKind = "number" | "investment";
export type LostCitiesStatus = "waiting" | "playing" | "finished" | "abandoned";
export type LostCitiesTurnPhase = "play" | "draw";

export interface LostCitiesCard {
  id: string;
  color: LostCitiesColor;
  kind: LostCitiesCardKind;
  value: number | null;
}

export interface LostCitiesPlayerPublic {
  id: string;
  nickname: string;
  isHost: boolean;
  connected: boolean;
  handCount: number;
  expeditions: Record<LostCitiesColor, LostCitiesCard[]>;
}

export interface LostCitiesScoreLine {
  color: LostCitiesColor;
  numberTotal: number;
  investmentCount: number;
  multiplier: number;
  longExpeditionBonus: number;
  total: number;
}

export interface LostCitiesRoomState {
  roomCode: string;
  status: LostCitiesStatus;
  players: LostCitiesPlayerPublic[];
  viewerPlayerId: string;
  viewerHand: LostCitiesCard[];
  currentTurnPlayerId: string | null;
  turnPhase: LostCitiesTurnPhase;
  discardedCardIdThisTurn: string | null;
  drawPileCount: number;
  discardTops: Record<LostCitiesColor, LostCitiesCard | null>;
  discardCounts: Record<LostCitiesColor, number>;
  lastAction: string;
  scores: Record<string, LostCitiesScoreLine[]> | null;
  winnerIds: string[];
}
