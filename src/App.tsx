import { useCallback, useEffect, useState } from 'react';
import type { ClientIntent } from '@engine/types';
import {
  HostMultiplayerSession,
  LocalSoloSession,
  PeerMultiplayerSession,
  createRoomCode,
  type GameSession,
  type SessionSnapshot,
} from '@net/session';
import { GameTable } from '@ui/GameTable';
import { HomeScreen } from '@ui/HomeScreen';
import { LobbyView } from '@ui/LobbyView';

const NAME_KEY = 'capsa_player_name';

function getInitialName(): string {
  try {
    return localStorage.getItem(NAME_KEY) || '';
  } catch {
    return '';
  }
}

function getInitialRoomCode(): string {
  try {
    const params = new URLSearchParams(window.location.search);
    return (params.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  } catch {
    return '';
  }
}

export function App() {
  const [session, setSession] = useState<GameSession | null>(null);
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [homeError, setHomeError] = useState<string | null>(null);
  const [initialRoomCode] = useState(getInitialRoomCode);
  const [savedName, setSavedName] = useState(getInitialName);

  useEffect(() => {
    if (!session) {
      setSnapshot(null);
      return;
    }
    const unsub = session.subscribe((next) => {
      setSnapshot(next);
    });
    return () => {
      unsub();
    };
  }, [session]);

  const persistName = (name: string) => {
    setSavedName(name);
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch {
      // ignore
    }
  };

  const leaveSession = useCallback(() => {
    setSession((prev) => {
      prev?.destroy();
      return null;
    });
    setSnapshot(null);
    setHomeError(null);
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

  const handleHost = async (name: string) => {
    persistName(name);
    setBusy(true);
    setHomeError(null);
    try {
      const code = await createRoomCode();
      const hostSession = new HostMultiplayerSession(code, name);
      setSession(hostSession);
      try {
        window.history.replaceState({}, '', `/?room=${code}`);
      } catch {
        // ignore
      }
    } catch (err) {
      setHomeError(err instanceof Error ? err.message : 'Unable to create room.');
    } finally {
      setBusy(false);
    }
  };

  const handleJoin = (code: string, name: string) => {
    persistName(name);
    setHomeError(null);
    const cleanCode = code.toUpperCase();
    const peerSession = new PeerMultiplayerSession(cleanCode, name);
    setSession(peerSession);
    try {
      window.history.replaceState({}, '', `/?room=${cleanCode}`);
    } catch {
      // ignore
    }
  };

  const handleSolo = (name: string) => {
    persistName(name);
    setHomeError(null);
    setSession(new LocalSoloSession(name));
  };

  const sendIntent = useCallback(
    (intent: ClientIntent) => {
      session?.sendIntent(intent);
    },
    [session]
  );

  const fatalBeforeRoom =
    session &&
    snapshot &&
    !snapshot.room &&
    (snapshot.status === 'error' || snapshot.status === 'disconnected');

  useEffect(() => {
    if (fatalBeforeRoom && snapshot?.error) {
      const msg = snapshot.error;
      session?.destroy();
      setSession(null);
      setSnapshot(null);
      setHomeError(msg);
    }
  }, [fatalBeforeRoom, snapshot?.error, session]);

  return (
    <div className="app-bg">
      {!session || !snapshot ? (
        <HomeScreen
          initialRoomCode={initialRoomCode}
          initialName={savedName}
          busy={busy}
          error={homeError}
          onHost={handleHost}
          onJoin={handleJoin}
          onSolo={handleSolo}
        />
      ) : !snapshot.room ? (
        <div className="screen">
          <div className="status-card">
            <div className="eyebrow">Linking up</div>
            <h2 className="modal-title">Connecting to table…</h2>
            <p className="modal-sub">Negotiating a peer connection with the host.</p>
            <button type="button" className="btn btn-ghost" onClick={leaveSession}>
              Cancel
            </button>
          </div>
        </div>
      ) : snapshot.status === 'disconnected' || snapshot.status === 'error' ? (
        <div className="screen">
          <div className="status-card">
            <div className="eyebrow">Connection lost</div>
            <h2 className="modal-title">Table closed</h2>
            <p className="modal-sub">
              {snapshot.error || 'The connection to the host was lost.'}
            </p>
            <button type="button" className="btn btn-primary" onClick={leaveSession}>
              Back to home
            </button>
          </div>
        </div>
      ) : snapshot.room.gameState === 'lobby' ? (
        <LobbyView
          room={snapshot.room}
          error={snapshot.error}
          onIntent={sendIntent}
          onLeave={leaveSession}
        />
      ) : (
        <GameTable
          room={snapshot.room}
          transport={snapshot.transport}
          error={snapshot.error}
          onIntent={sendIntent}
          onLeave={leaveSession}
        />
      )}
    </div>
  );
}

export default App;
