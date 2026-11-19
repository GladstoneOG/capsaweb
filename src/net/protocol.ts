import type { ClientIntent, SanitizedRoomState } from '@engine/types';

export interface LobbyListing {
  code: string;
  hostName: string;
  hasPassword: boolean;
  playerCount: number;
  maxPlayers: number;
  gameState: string;
  rulesSummary: string;
  updatedAt: number;
}

// Messages exchanged between Host and Peer (over WebRTC DataChannel OR WS Relay fallback)
export type HostToPeerMessage =
  | { type: 'STATE_SYNC'; state: SanitizedRoomState }
  | { type: 'ACTION_ERROR'; message: string }
  | { type: 'KICKED'; message: string };

export type PeerToHostMessage = {
  type: 'INTENT';
  intent: ClientIntent;
};

// Messages exchanged between Browser and SignalRoomDO WebSocket
export type SignalServerMessage =
  | { type: 'welcome'; role: 'host' | 'peer'; peerId: string; hostPeerId?: string }
  | { type: 'peer-connected'; peerId: string; sessionId: string; name: string }
  | { type: 'peer-disconnected'; peerId: string }
  | { type: 'host-disconnected'; message: string }
  | { type: 'kicked'; message: string }
  | { type: 'error'; code: string; message: string }
  | { type: 'rtc-offer'; from: string; sdp: RTCSessionDescriptionInit }
  | { type: 'rtc-answer'; from: string; sdp: RTCSessionDescriptionInit }
  | { type: 'rtc-ice'; from: string; candidate: RTCIceCandidateInit }
  | { type: 'relay-from-peer'; from: string; payload: PeerToHostMessage }
  | { type: 'relay-from-host'; payload: HostToPeerMessage };

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export type LocalTransportState = 'local' | 'host' | 'p2p' | 'relay' | 'connecting';

export const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.l.google.com:19302' },
  ],
};
