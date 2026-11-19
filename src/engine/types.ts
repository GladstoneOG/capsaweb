export type Suit = 'D' | 'C' | 'H' | 'S'; // Diamonds ♦ < Clubs ♣ < Hearts ♥ < Spades ♠
export type Rank = '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A' | '2';

export interface Card {
  id: string; // e.g. "3_D" or "3_D_1" in double deck
  suit: Suit;
  rank: Rank;
}

export type ComboType =
  | 'single'
  | 'pair'
  | 'tris'
  | 'straight'
  | 'flush'
  | 'fullhouse'
  | 'bomber'
  | 'straightflush'
  | 'invalid';

export interface Combination {
  type: ComboType;
  cards: Card[];
}

export interface CapsaRules {
  pointsToWin: number;
  turnDuration: number; // seconds, 0 = disabled
  enableBombsSingle: boolean;
  enableBombsPair: boolean;
  enableTrading: boolean;
  enableDoubleDeck: boolean;
  doubleDeck26Cards: boolean;
}

export const DEFAULT_RULES: CapsaRules = {
  pointsToWin: 15,
  turnDuration: 30,
  enableBombsSingle: true,
  enableBombsPair: true,
  enableTrading: false,
  enableDoubleDeck: false,
  doubleDeck26Cards: false,
};

export type PlayerTransport = 'local' | 'host' | 'p2p' | 'relay' | 'connecting' | 'bot';

export interface Player {
  id: string;
  sessionId?: string;
  name: string;
  isHost: boolean;
  isReady: boolean;
  isBot: boolean;
  autoPlay?: boolean;
  disconnected?: boolean;
  transport: PlayerTransport;
  cards: Card[];
  passed: boolean;
  score: number;
  roundPoints: number;
  finishRank?: number;
  lastPlay: Card[] | null;
}

export interface SanitizedPlayer {
  id: string;
  name: string;
  isHost: boolean;
  isReady: boolean;
  isBot: boolean;
  autoPlay?: boolean;
  disconnected?: boolean;
  transport: PlayerTransport;
  cards: Card[] | null; // non-null only for the viewing player
  cardCount: number;
  passed: boolean;
  score: number;
  roundPoints: number;
  finishRank?: number;
  lastPlay: Card[] | null;
}

export interface DiceDuelPlayer {
  id: string;
  name: string;
  roll: number;
}

export interface DiceShowdown {
  playerA: DiceDuelPlayer;
  playerB: DiceDuelPlayer;
  winnerId: string;
  winnerName: string;
  reason: string;
  rollsHistory: { rollA: number; rollB: number }[];
}

export interface TradeRequest {
  requesterId: string;
  requesterName: string;
  requestedCard: Card;
  targetPlayerId: string | null;
  targetPlayerName: string | null;
}

export interface TradeRecord {
  requesterId: string;
  requesterName: string;
  targetPlayerId: string;
  targetPlayerName: string;
  requestedCard: Card;
  extraCard: Card;
  timestamp: number;
}

export interface TradingState {
  pendingRequest: TradeRequest | null;
  history: TradeRecord[];
}

export interface LastTrick {
  winnerId: string;
  winnerName: string;
  cards: Card[];
  hibah: boolean;
  timestamp: number;
}

export interface ActivityEntry {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  system: boolean;
  timestamp: number;
}

export type GameState = 'lobby' | 'playing' | 'roundover' | 'gameover';

export interface RoomState {
  code: string;
  mode: 'solo' | 'multiplayer';
  gameState: GameState;
  rules: CapsaRules;
  players: Player[];
  turnIndex: number;
  roundNumber: number;
  activePlay: Combination | null;
  lastPlayerPlayedId: string | null;
  lastTrick: LastTrick | null;
  firstPlayMade: boolean;
  startingCard: Card | null;
  undoPassEligiblePlayerId: string | null;
  diceShowdown: DiceShowdown | null;
  tradingState: TradingState | null;
  turnDeadline: number | null;
  activity: ActivityEntry[];
  stateVersion: number;
}

export interface SanitizedRoomState {
  code: string;
  mode: 'solo' | 'multiplayer';
  viewerId: string;
  gameState: GameState;
  rules: CapsaRules;
  players: SanitizedPlayer[];
  turnIndex: number;
  roundNumber: number;
  activePlay: Combination | null;
  lastPlayerPlayedId: string | null;
  lastTrick: LastTrick | null;
  firstPlayMade: boolean;
  startingCard: Card | null;
  canUndoPass: boolean;
  diceShowdown: DiceShowdown | null;
  tradingState: TradingState | null;
  turnDeadline: number | null;
  serverNow: number;
  activity: ActivityEntry[];
  stateVersion: number;
}

export type ClientIntent =
  | { type: 'TOGGLE_READY' }
  | { type: 'UPDATE_RULES'; rules: Partial<CapsaRules> }
  | { type: 'ADD_BOT' }
  | { type: 'REMOVE_PLAYER'; playerId: string }
  | { type: 'START_GAME' }
  | { type: 'NEXT_ROUND' }
  | { type: 'PLAY_CARDS'; cardIds: string[] }
  | { type: 'PASS' }
  | { type: 'UNDO_PASS' }
  | { type: 'TRADE_REQUEST'; rank: Rank; suit: Suit }
  | { type: 'TRADE_FULFILL'; extraCardId: string }
  | { type: 'TRADE_DECLINE' }
  | { type: 'TRADE_CANCEL' }
  | { type: 'DISMISS_DICE' }
  | { type: 'TOGGLE_AUTOPLAY' }
  | { type: 'CHAT'; text: string };
