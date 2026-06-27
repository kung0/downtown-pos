import { useState, useEffect } from 'react';
import type { ShiftSummary, Tab } from '@downtown/shared';
import { useSession } from '../context/SessionContext';
import { sessionsApi, tabsApi } from '../api';
import { formatMoney } from '../utils/money';
import { formatDateTime } from '../utils/time';

interface Props {
  onClose: () => void;
}

function SummaryBody({ summary }: { summary: ShiftSummary }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
        {formatDateTime(summary.session.opened_at)} → {summary.session.closed_at ? formatDateTime(summary.session.closed_at) : 'offen'}
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-card__label">Total</div>
          <div className="stat-card__value">{formatMoney(summary.total_cents)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__label">Tabs</div>
          <div className="stat-card__value">{summary.tab_count}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__label">Avg Tab</div>
          <div className="stat-card__value">{formatMoney(summary.avg_tab_cents)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__label">Tips</div>
          <div className="stat-card__value">{formatMoney(summary.tip_cents)}</div>
        </div>
      </div>

      <table className="table">
        <tbody>
          <tr>
            <td>Cash ({summary.cash_count})</td>
            <td style={{ textAlign: 'right' }}>{formatMoney(summary.cash_cents)}</td>
          </tr>
          <tr>
            <td>Card ({summary.card_count})</td>
            <td style={{ textAlign: 'right' }}>{formatMoney(summary.card_cents)}</td>
          </tr>
        </tbody>
      </table>

      {summary.by_top_category.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Kategorie</th>
              <th style={{ textAlign: 'right' }}>Umsatz</th>
            </tr>
          </thead>
          <tbody>
            {summary.by_top_category.map(row => (
              <tr key={row.category}>
                <td>{row.category}</td>
                <td style={{ textAlign: 'right' }}>{formatMoney(row.total_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {summary.top_drinks.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Top Getränke</th>
              <th style={{ textAlign: 'right' }}>Anzahl</th>
            </tr>
          </thead>
          <tbody>
            {summary.top_drinks.map((d, i) => (
              <tr key={d.name}>
                <td>{i + 1}. {d.name}</td>
                <td style={{ textAlign: 'right' }}>{d.qty}x</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {summary.top_food.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Top Speisen</th>
              <th style={{ textAlign: 'right' }}>Anzahl</th>
            </tr>
          </thead>
          <tbody>
            {summary.top_food.map((f, i) => (
              <tr key={f.name}>
                <td>{i + 1}. {f.name}</td>
                <td style={{ textAlign: 'right' }}>{f.qty}x</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <table className="table">
        <tbody>
          <tr>
            <td style={{ color: 'var(--text-muted)', fontSize: '13px' }}>inkl. MwSt. 19 %</td>
            <td style={{ textAlign: 'right', color: 'var(--text-muted)', fontSize: '13px' }}>{formatMoney(summary.tax_standard_cents)}</td>
          </tr>
          <tr>
            <td style={{ color: 'var(--text-muted)', fontSize: '13px' }}>inkl. MwSt. 7 %</td>
            <td style={{ textAlign: 'right', color: 'var(--text-muted)', fontSize: '13px' }}>{formatMoney(summary.tax_reduced_cents)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
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
