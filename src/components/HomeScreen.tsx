import { useState, type CSSProperties } from 'react';
import { ArrowRight, Bot, HelpCircle, Users, X } from 'lucide-react';
import type { Card } from '@engine/types';
import { PlayingCard } from './PlayingCard';

const HERO_CARDS: Card[] = [
  { id: 'h1', rank: 'Q', suit: 'C' },
  { id: 'h2', rank: 'K', suit: 'H' },
  { id: 'h3', rank: '2', suit: 'S' },
  { id: 'h4', rank: 'A', suit: 'D' },
  { id: 'h5', rank: 'J', suit: 'S' },
];

interface HomeScreenProps {
  initialRoomCode: string;
  initialName: string;
  busy: boolean;
  error: string | null;
  onHost: (name: string) => void;
  onJoin: (code: string, name: string) => void;
  onSolo: (name: string) => void;
}

export function HomeScreen({ initialRoomCode, initialName, busy, error, onHost, onJoin, onSolo }: HomeScreenProps) {
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState(initialRoomCode);
  const [showRules, setShowRules] = useState(false);

  const cleanName = name.trim() || 'Player';
  const cleanCode = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  const invited = initialRoomCode.length === 4;

  return (
    <div className="screen">
      <div className="home">
        <div className="hero-fan" aria-hidden="true">
          {HERO_CARDS.map((card, i) => (
            <div key={card.id} className="hero-card" style={{ '--off': i - 2 } as CSSProperties}>
              <PlayingCard card={card} size="lg" />
            </div>
          ))}
        </div>

        <div className="home-card">
          <h1 className="brand">
            Capsa <span>Banting</span>
          </h1>
          <p className="tagline">Grab three friends, shuffle up, and slam those 2s.</p>

          <label className="field">
            <span className="field-label">What should we call you?</span>
            <input
              className="input"
              type="text"
              maxLength={20}
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          {invited ? (
            <button
              type="button"
              className="btn btn-primary btn-lg"
              disabled={busy}
              onClick={() => onJoin(cleanCode, cleanName)}
            >
              Join table {cleanCode}
              <ArrowRight size={18} />
            </button>
          ) : (
            <button type="button" className="btn btn-primary btn-lg" disabled={busy} onClick={() => onHost(cleanName)}>
              <Users size={18} />
              {busy ? 'Setting the table…' : 'Host a table'}
            </button>
          )}

          <form
            className="join"
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
              aria-label="Room code"
              value={cleanCode}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
            <button type="submit" className="btn btn-ghost" disabled={busy || cleanCode.length !== 4}>
              Join
              <ArrowRight size={16} />
            </button>
          </form>

          <button type="button" className="link-btn" disabled={busy} onClick={() => onSolo(cleanName)}>
            <Bot size={16} />
            Or practice against bots
          </button>

          {error && <div className="alert">{error}</div>}
        </div>

        <div className="home-foot">
          <span>Peer-to-peer · no sign-up</span>
          <button type="button" className="link-btn link-btn--sm" onClick={() => setShowRules(true)}>
            <HelpCircle size={14} />
            How to play
          </button>
        </div>
      </div>

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
                <b>Goal:</b> be the first to empty your hand. 4 players, 13 cards each.
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
