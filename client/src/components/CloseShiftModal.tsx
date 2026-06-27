import { useState, useEffect } from 'react';
import type { ShiftSummary } from '@downtown/shared';
import { useSession } from '../context/SessionContext';
import { sessionsApi } from '../api';
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

  useEffect(() => {
    if (!session) return;
    sessionsApi.summary(session.id)
      .then(setSummary)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [session?.id]);

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

  return (
    <div className="modal-overlay">
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal__header">
          <span className="modal__title">Shift Report</span>
        </div>

        <div className="modal__body">
          {loading ? (
            <div className="placeholder">Loading…</div>
          ) : summary ? (
            <SummaryBody summary={summary} />
          ) : (
            <p style={{ margin: 0, color: 'var(--danger)' }}>{error ?? 'Could not load summary.'}</p>
          )}
          {error && !loading && summary && (
            <p style={{ color: 'var(--danger)', margin: '12px 0 0', fontSize: '13px' }}>{error}</p>
          )}
        </div>

        <div className="modal__footer">
          {done ? (
            <button className="btn btn--primary" onClick={onClose}>Done</button>
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
