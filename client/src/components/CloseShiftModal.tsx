import { useState, useEffect } from 'react';
import type { ShiftSummary, Tab } from '@downtown/shared';
import { useSession } from '../context/SessionContext';
import { sessionsApi, tabsApi } from '../api';
import { formatMoney } from '../utils/money';
import SummaryBody from './ShiftSummaryView';

interface Props {
  onClose: () => void;
}

export default function CloseShiftModal({ onClose }: Props) {
  const { session, closeShift } = useSession();
  const [summary, setSummary] = useState<ShiftSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unparkedTabs, setUnparkedTabs] = useState<Tab[]>([]);
  const [parkingIds, setParkingIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!session) return;
    Promise.all([
      sessionsApi.summary(session.id),
      tabsApi.list(),
    ])
      .then(([s, allTabs]) => {
        setSummary(s);
        setUnparkedTabs(allTabs.filter(t => !t.parked));
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [session?.id]);

  async function handleParkOne(tab: Tab) {
    setParkingIds(prev => new Set(prev).add(tab.id));
    try {
      await tabsApi.park(tab.id);
      setUnparkedTabs(prev => prev.filter(t => t.id !== tab.id));
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setParkingIds(prev => { const s = new Set(prev); s.delete(tab.id); return s; });
    }
  }

  async function handleParkAll() {
    const ids = unparkedTabs.map(t => t.id);
    ids.forEach(id => setParkingIds(prev => new Set(prev).add(id)));
    await Promise.all(unparkedTabs.map(t => tabsApi.park(t.id).catch(() => null)));
    setUnparkedTabs([]);
    setParkingIds(new Set());
  }

  async function handleCloseShift() {
    setClosing(true);
    setError(null);
    try {
      const s = await closeShift();
      setSummary(s);
      setDone(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setClosing(false);
    }
  }

  const hasUnparked = unparkedTabs.length > 0;

  return (
    <div className="modal-overlay">
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal__header">
          <span className="modal__title">Shift Report</span>
        </div>

        <div className="modal__body">
          {loading ? (
            <div className="placeholder">Loading…</div>
          ) : hasUnparked ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ margin: 0, fontWeight: 600 }}>
                {unparkedTabs.length} offene{unparkedTabs.length !== 1 ? ' Tabs' : 'r Tab'} — bitte zuerst parken.
              </p>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
                Geparkte Tabs bleiben offen und können beim nächsten Besuch bezahlt werden.
              </p>
              <table className="table">
                <tbody>
                  {unparkedTabs.map(t => (
                    <tr key={t.id}>
                      <td>{t.customer_name}</td>
                      <td style={{ textAlign: 'right', color: 'var(--text-muted)', fontSize: 13 }}>
                        {formatMoney(t.running_total_cents ?? 0)}
                      </td>
                      <td style={{ textAlign: 'right', paddingLeft: 8 }}>
                        <button
                          className="btn btn--ghost btn--sm"
                          style={{ color: 'var(--amber, #d97706)' }}
                          disabled={parkingIds.has(t.id)}
                          onClick={() => handleParkOne(t)}
                        >
                          ⏸ Parken
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : summary ? (
            <SummaryBody summary={summary} />
          ) : (
            <p style={{ margin: 0, color: 'var(--danger)' }}>{error ?? 'Could not load summary.'}</p>
          )}
          {error && !loading && !hasUnparked && summary && (
            <p style={{ color: 'var(--danger)', margin: '12px 0 0', fontSize: '13px' }}>{error}</p>
          )}
        </div>

        <div className="modal__footer">
          {done ? (
            <button className="btn btn--primary" onClick={onClose}>Done</button>
          ) : hasUnparked ? (
            <>
              <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
              <button
                className="btn btn--sm"
                style={{ background: 'var(--amber, #d97706)', color: '#fff', border: 'none' }}
                disabled={parkingIds.size > 0}
                onClick={handleParkAll}
              >
                Alle parken
              </button>
            </>
          ) : (
            <>
              <button className="btn btn--ghost" onClick={onClose} disabled={closing}>Cancel</button>
              <button
                className="btn btn--danger"
                onClick={handleCloseShift}
                disabled={closing || loading}
              >
                {closing ? 'Closing…' : 'Close Shift'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
