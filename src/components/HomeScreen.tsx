import { useState } from 'react';
import { Bot, BookOpen, LogIn, Plus, Sparkles, X } from 'lucide-react';

interface HomeScreenProps {
  initialRoomCode: string;
  initialName: string;
  busy: boolean;
  error: string | null;
  onHost: (name: string) => void;
  onJoin: (code: string, name: string) => void;
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
  const [code, setCode] = useState(initialRoomCode);
  const [showRules, setShowRules] = useState(false);

  const cleanName = name.trim() || 'Player';
  const cleanCode = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);

  return (
    <div className="home-wrap">
      <div className="panel home-card">
        <div className="brand-header">
          <div className="brand-emblem">
            <Sparkles size={13} />
            <span>Big Two · Host &amp; Peer</span>
          </div>
          <h1 className="brand-title">Capsa Banting</h1>
          <p className="brand-sub">Fast, peer-to-peer Indonesian Big Two on the emerald felt.</p>
        </div>

        <div className="field-group">
          <label className="field-label" htmlFor="player-name">
            Display Name
          </label>
          <input
            id="player-name"
            className="input"
            type="text"
            maxLength={20}
            placeholder="Enter your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="home-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => onHost(cleanName)}
          >
            <Plus size={18} />
            {busy ? 'Creating Room…' : 'Host Multiplayer Room'}
          </button>

          <form
            className="join-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (cleanCode.length === 4 && !busy) onJoin(cleanCode, cleanName);
            }}
          >
            <input
              className="input input-code"
              type="text"
              maxLength={4}
              placeholder="CODE"
              aria-label="Room Code"
              value={cleanCode}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
            <button
              type="submit"
              className="btn btn-secondary"
              disabled={busy || cleanCode.length !== 4}
            >
              <LogIn size={16} />
              Join
            </button>
          </form>

          <div className="divider">or</div>

          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => onSolo(cleanName)}
          >
            <Bot size={17} />
            Play Solo vs Bots (Offline)
          </button>
        </div>

        {error && <div className="error-banner">{error}</div>}

        <div className="home-footer">
          <span>WebRTC P2P · Cloudflare Signaling</span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setShowRules(true)}
          >
            <BookOpen size={14} />
            Rules &amp; Scoring
          </button>
        </div>
      </div>

      {showRules && (
        <div className="modal-backdrop" onClick={() => setShowRules(false)}>
          <div className="panel modal-box" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 className="modal-title">Capsa Banting Rules</h2>
              <button type="button" className="btn-icon" onClick={() => setShowRules(false)}>
                <X size={16} />
              </button>
            </div>
            <p className="modal-sub">4 players · 13 cards each (or 26 in Double Deck mode)</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: '0.86rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              <div>
                <strong style={{ color: 'var(--text-primary)' }}>Card Order:</strong>{' '}
                Rank <code>3 &lt; 4 &lt; … &lt; A &lt; 2</code> · Suit <code>♦ &lt; ♣ &lt; ♥ &lt; ♠</code>.
                The holder of <strong>3♦</strong> leads the opening play and must include it.
              </div>
              <div>
                <strong style={{ color: 'var(--text-primary)' }}>Combinations:</strong>{' '}
                Single, Pair, Tris, or 5-Card hands ranked{' '}
                <code>Straight &lt; Flush &lt; Full House &lt; Bomber (4+1) &lt; Straight Flush</code>.
                Flushes rank by <strong>suit first</strong>, then highest card. Straights span{' '}
                <code>A-2-3-4-5</code> (lowest) up to <code>J-Q-K-A-2</code> (highest).
              </div>
              <div>
                <strong style={{ color: 'var(--text-primary)' }}>Bombing 2s:</strong>{' '}
                When enabled, a <strong>Bomber</strong> or <strong>Straight Flush</strong> can slam a single <code>2</code> or pair of <code>2</code>s.
              </div>
              <div>
                <strong style={{ color: 'var(--text-primary)' }}>Hibah &amp; Undo Pass:</strong>{' '}
                If a trick winner empties their hand, lead passes clockwise (Hibah). You can undo your pass before the next player acts.
              </div>
              <div>
                <strong style={{ color: 'var(--text-primary)' }}>Scoring:</strong>{' '}
                1st gets <strong>+3</strong>, 2nd <strong>+2</strong>, 3rd <strong>+1</strong>, 4th <strong>0</strong>. First to reach target points (default 15) wins the match.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
