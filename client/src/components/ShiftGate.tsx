import { useState } from 'react';
import { useSession } from '../context/SessionContext';
import { formatTime } from '../utils/time';

export default function ShiftGate({ children }: { children: React.ReactNode }) {
  const { session, loading, openShift } = useSession();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <div className="placeholder">Loading…</div>
      </div>
    );
  }

  if (!session || session.status !== 'open') {
    async function handleOpen() {
      setOpening(true);
      setError(null);
      try {
        await openShift();
      } catch (e: any) {
        setError(e.message);
      } finally {
        setOpening(false);
      }
    }

    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        gap: '16px',
      }}>
        <div style={{ fontSize: '28px', fontWeight: 700 }}>Downtown</div>
        <div style={{ color: 'var(--text-muted)', marginBottom: '8px' }}>No shift is open</div>
        <button
          className="btn btn--primary"
          style={{ fontSize: '16px', padding: '12px 32px' }}
          onClick={handleOpen}
          disabled={opening}
        >
          {opening ? 'Opening shift…' : 'Open Shift'}
        </button>
        {error && <div style={{ color: 'var(--danger)', fontSize: '13px' }}>{error}</div>}
      </div>
    );
  }

  return <>{children}</>;
}
