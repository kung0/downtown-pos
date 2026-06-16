import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { Session, ShiftSummary } from '@downtown/shared';
import { sessionsApi } from '../api';

interface SessionContextValue {
  session: Session | null;
  loading: boolean;
  openShift: () => Promise<void>;
  closeShift: () => Promise<ShiftSummary>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    sessionsApi.current()
      .then(setSession)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const openShift = useCallback(async () => {
    const s = await sessionsApi.open();
    setSession(s);
  }, []);

  const closeShift = useCallback(async (): Promise<ShiftSummary> => {
    if (!session) throw new Error('no session');
    const summary = await sessionsApi.close(session.id);
    setSession(summary.session);
    return summary;
  }, [session]);

  return (
    <SessionContext.Provider value={{ session, loading, openShift, closeShift }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}
