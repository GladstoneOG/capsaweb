import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import {
  ArrowRight,
  Bot,
  HelpCircle,
  Lock,
  RefreshCw,
  Users,
  X,
} from 'lucide-react';
import type { Card } from '@engine/types';
import { fetchOpenRooms, type LobbyListing } from '@net/session';
import { Avatar } from './Avatar';
import { PlayingCard } from './PlayingCard';

const HERO_CARDS: Card[] = [
  { id: 'h1', rank: 'J', suit: 'C' },
  { id: 'h2', rank: 'Q', suit: 'H' },
  { id: 'h3', rank: '2', suit: 'S' },
  { id: 'h4', rank: 'K', suit: 'D' },
  { id: 'h5', rank: 'A', suit: 'S' },
];

interface HomeScreenProps {
  initialRoomCode: string;
  initialName: string;
  busy: boolean;
  error: string | null;
  onHost: (name: string, password?: string) => void;
  onJoin: (code: string, name: string, password?: string) => void;
  onSolo: (name: string) => void;
}

export function HomeScreen({
  initialRoomCode,
  initialName,
  busy,
  error,
  onHost,
  onJoin,
  onSolo,
}: HomeScreenProps) {
  const [name, setName] = useState(initialName);
  const [password, setPassword] = useState('');
  const [showRules, setShowRules] = useState(false);
  const [rooms, setRooms] = useState<LobbyListing[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [joinPromptRoom, setJoinPromptRoom] = useState<{
    code: string;
    hostName: string;
  } | null>(null);
  const [joinPassword, setJoinPassword] = useState('');
  const [liveInvite, setLiveInvite] = useState<{ code: string; hasPassword: boolean } | null>(null);

  const cleanName = name.trim() || 'Player';
  const invitedCode = initialRoomCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);

  const clearRoomParam = useCallback(() => {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has('room')) {
        url.searchParams.delete('room');
        window.history.replaceState({}, '', url.pathname);
      }
    } catch {
      // ignore
    }
  }, []);

  // Validate any ?room=XXXX invite link; silently strip stale/closed room URLs
  useEffect(() => {
    if (invitedCode.length !== 4) return;
    let cancelled = false;
    void fetch(`/api/room/${invitedCode}/status`)
      .then((res) => (res.ok ? (res.json() as Promise<{ hasHost?: boolean; hasPassword?: boolean }>) : null))
      .then((status) => {
        if (cancelled) return;
        if (status?.hasHost) {
          setLiveInvite({ code: invitedCode, hasPassword: Boolean(status.hasPassword) });
        } else {
          clearRoomParam();
        }
      })
      .catch(() => {
        if (!cancelled) clearRoomParam();
      });
    return () => {
      cancelled = true;
    };
  }, [invitedCode, clearRoomParam]);

  const loadRooms = useCallback(async (showSpin = false) => {
    if (showSpin) setLoadingRooms(true);
    const list = await fetchOpenRooms();
    setRooms(list);
    setLoadingRooms(false);
  }, []);

  useEffect(() => {
    void loadRooms(true);
    const id = window.setInterval(() => void loadRooms(false), 5000);
    return () => window.clearInterval(id);
  }, [loadRooms]);

  const handleSelectRoom = (room: LobbyListing) => {
    if (busy || room.gameState !== 'lobby' || room.playerCount >= room.maxPlayers) return;
    if (room.hasPassword) {
      setJoinPromptRoom({ code: room.code, hostName: room.hostName });
      setJoinPassword('');
      return;
    }
    onJoin(room.code, cleanName);
  };

  const handleAcceptInvite = () => {
    if (!liveInvite || busy) return;
    if (liveInvite.hasPassword) {
      setJoinPromptRoom({ code: liveInvite.code, hostName: `Table ${liveInvite.code}` });
      setJoinPassword('');
      return;
    }
    onJoin(liveInvite.code, cleanName);
  };

  return (
    <div className="screen">
      <div className="home">
        <div className="home-card">
          <div className="hero-fan" aria-hidden="true">
            {HERO_CARDS.map((card, i) => (
              <div key={card.id} className="hero-card" style={{ '--off': i - 2 } as CSSProperties}>
                <PlayingCard card={card} size="lg" />
              </div>
            ))}
          </div>

          <h1 className="brand">
            Capsa <span>Banting</span>
          </h1>
          <p className="tagline">Host a table or hop right into an open lobby.</p>

          {liveInvite && (
            <div className="invite-banner">
              <span>
                Invite to <strong>{liveInvite.code}</strong>
                {liveInvite.hasPassword && <Lock size={12} style={{ marginLeft: 5, verticalAlign: '-1px' }} />}
              </span>
              <div className="invite-banner-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={busy}
                  onClick={handleAcceptInvite}
                >
                  Join
                  <ArrowRight size={14} />
                </button>
                <button
                  type="button"
                  className="icon-btn icon-btn--sm"
                  aria-label="Dismiss invite"
                  onClick={() => {
                    setLiveInvite(null);
                    clearRoomParam();
                  }}
                >
                  <X size={13} />
                </button>
              </div>
            </div>
          )}

          <div className="home-inputs">
            <label className="field">
              <span className="field-label">Your name</span>
              <input
                className="input"
                type="text"
                maxLength={20}
                placeholder="Enter name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>

            <label className="field">
              <span className="field-label">
                <Lock size={11} /> Password <span className="opt-tag">optional</span>
              </span>
              <input
                className="input"
                type="password"
                maxLength={32}
                placeholder="Leave blank for open room"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          </div>

          <button
            type="button"
            className="btn btn-primary btn-lg"
            disabled={busy}
            onClick={() => onHost(cleanName, password)}
          >
            <Users size={18} />
            {busy ? 'Creating table…' : 'Host game'}
          </button>

          <button type="button" className="link-btn" disabled={busy} onClick={() => onSolo(cleanName)}>
            <Bot size={16} />
            Or practice offline vs bots
          </button>

          {error && <div className="alert">{error}</div>}
        </div>

        {/* Live Lobby Browser */}
        <section className="lobbies-card" aria-label="Open Lobbies">
          <div className="lobbies-head">
            <div className="lobbies-title">
              <span className="live-dot" />
              <strong>Open Lobbies</strong>
              <span className="lobbies-count">{rooms.length}</span>
            </div>
            <button
              type="button"
              className={`icon-btn icon-btn--sm${loadingRooms ? ' is-spin' : ''}`}
              aria-label="Refresh lobbies"
              onClick={() => void loadRooms(true)}
            >
              <RefreshCw size={14} />
            </button>
          </div>

          {rooms.length === 0 ? (
            <div className="lobbies-empty">
              {loadingRooms ? 'Checking for active tables…' : 'No open tables right now — host one above!'}
            </div>
          ) : (
            <div className="lobbies-list">
              {rooms.map((room) => {
                const isOpen = room.gameState === 'lobby' && room.playerCount < room.maxPlayers;
                return (
                  <div key={room.code} className={`lobby-item${isOpen ? '' : ' is-busy'}`}>
                    <Avatar name={room.hostName} size="sm" />
                    <div className="lobby-item-main">
                      <div className="lobby-item-top">
                        <strong>{room.hostName}'s Table</strong>
                        <span className="lobby-code-chip">{room.code}</span>
                        {room.hasPassword && (
                          <span className="lock-chip" title="Password protected">
                            <Lock size={11} />
                          </span>
                        )}
                      </div>
                      <div className="lobby-item-sub">
                        <span>
                          {room.playerCount}/{room.maxPlayers} players
                        </span>
                        {room.rulesSummary && <span>· {room.rulesSummary}</span>}
                      </div>
                    </div>
                    <button
                      type="button"
                      className={`btn btn-sm ${isOpen ? 'btn-primary' : 'btn-ghost'}`}
                      disabled={!isOpen || busy}
                      onClick={() => handleSelectRoom(room)}
                    >
                      {room.gameState !== 'lobby'
                        ? 'In game'
                        : room.playerCount >= room.maxPlayers
                          ? 'Full'
                          : 'Join'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <div className="home-foot">
          <span>Peer-to-peer · no sign-up</span>
          <button type="button" className="link-btn link-btn--sm" onClick={() => setShowRules(true)}>
            <HelpCircle size={14} />
            How to play
          </button>
        </div>
      </div>

      {/* Password Prompt Modal for locked rooms */}
      {joinPromptRoom && (
        <div className="modal-backdrop" onClick={() => setJoinPromptRoom(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="modal-close"
              aria-label="Close"
              onClick={() => setJoinPromptRoom(null)}
            >
              <X size={16} />
            </button>
            <div className="eyebrow">
              <Lock size={12} /> Locked table · {joinPromptRoom.code}
            </div>
            <h2 className="modal-title">Join {joinPromptRoom.hostName}</h2>
            <p className="modal-sub">Enter the room password to take a seat.</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!joinPassword.trim()) return;
                const target = joinPromptRoom;
                setJoinPromptRoom(null);
                onJoin(target.code, cleanName, joinPassword);
              }}
            >
              <input
                className="input"
                type="password"
                autoFocus
                placeholder="Room password"
                value={joinPassword}
                onChange={(e) => setJoinPassword(e.target.value)}
              />
              <div className="modal-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setJoinPromptRoom(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={!joinPassword.trim()}>
                  Join table
                  <ArrowRight size={15} />
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showRules && (
        <div className="modal-backdrop" onClick={() => setShowRules(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-close" aria-label="Close" onClick={() => setShowRules(false)}>
              <X size={16} />
            </button>
            <div className="eyebrow">Quick rules</div>
            <h2 className="modal-title">How Capsa works</h2>
            <ul className="rules-list">
              <li>
                <b>Goal:</b> be the first to empty your hand. 4 players, 13 cards each (or 26 in Double Deck 26).
              </li>
              <li>
                <b>Order:</b> 3 is lowest, 2 is highest. Suits go ♦ &lt; ♣ &lt; ♥ &lt; ♠.
              </li>
              <li>
                <b>Opening:</b> whoever holds 3♦ leads, and has to play it.
              </li>
              <li>
                <b>Combos:</b> singles, pairs, triples, or five-card hands — Straight &lt; Flush &lt; Full House &lt;
                Bomber &lt; Straight Flush. Flushes compare by suit first.
              </li>
              <li>
                <b>Bombs:</b> a Bomber or Straight Flush can slam a single 2 or a pair of 2s.
              </li>
              <li>
                <b>Hibah:</b> win a trick with your last card and the lead passes to the next player.
              </li>
              <li>
                <b>Scoring:</b> 1st +3, 2nd +2, 3rd +1, last 0. First to the target wins.
              </li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
