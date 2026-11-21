import type { ClientIntent, SanitizedRoomState } from '@engine/types';

export interface LobbyListing {
  code: string;
  hostName: string;
  hasPassword: boolean;
  playerCount: number;
  maxPlayers: number;
  gameState: string;
  rulesSummary: string;
  rejoinableCount: number;
  updatedAt: number;
}

// Messages sent from Browser Client -> Authoritative Cloudflare Durable Object Room
export type ClientToRoomMessage =
  | { type: 'INTENT'; intent: ClientIntent }
  | { type: 'LEAVE' };

// Messages sent from Authoritative Cloudflare Durable Object Room -> Browser Client
export type RoomToClientMessage =
  | { type: 'welcome'; peerId: string; sessionId: string }
  | { type: 'STATE_SYNC'; state: SanitizedRoomState }
  | { type: 'ACTION_ERROR'; message: string }
  | { type: 'KICKED'; message: string }
  | { type: 'error'; code: string; message: string };

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';

export type LocalTransportState =
  | 'local'
  | 'host'
  | 'p2p'
  | 'relay'
  | 'online'
  | 'reconnecting'
  | 'connecting';
