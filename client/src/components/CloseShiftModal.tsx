import { useState } from 'react';
import type { ShiftSummary } from '@downtown/shared';
import { useSession } from '../context/SessionContext';
import { formatMoney } from '../utils/money';
import { formatDateTime } from '../utils/time';

interface Props {
  onClose: () => void;
}

export default function CloseShiftModal({ onClose }: Props) {
  const { session, closeShift } = useSession();
  const [step, setStep] = useState<'confirm' | 'closing' | 'summary'>('confirm');
  const [summary, setSummary] = useState<ShiftSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleClose() {
    setStep('closing');
    setError(null);
    try {
      const s = await closeShift();
      setSummary(s);
      setStep('summary');
    } catch (e: any) {
      setError(e.message);
      setStep('confirm');
    }
  }

  return (
    <div className="modal-overlay" onClick={step === 'summary' ? onClose : undefined}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        {step === 'confirm' && (
          <>
            <div className="modal__header">
              <span className="modal__title">Close Shift</span>
            </div>
            <div className="modal__body">
              <p style={{ margin: 0, color: 'var(--text-muted)' }}>
                Are you sure? All open tabs must be closed first. This cannot be undone.
              </p>
              {error && <p style={{ color: 'var(--danger)', margin: '12px 0 0', fontSize: '13px' }}>{error}</p>}
            </div>
            <div className="modal__footer">
              <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
              <button className="btn btn--danger" onClick={handleClose}>Close Shift</button>
            </div>
          </>
        )}

        {step === 'closing' && (
          <div className="modal__body">
            <div className="placeholder">Closing shift…</div>
          </div>
        )}

        {step === 'summary' && summary && (
          <>
            <div className="modal__header">
              <span className="modal__title">Shift Summary</span>
            </div>
            <div className="modal__body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                {formatDateTime(summary.session.opened_at)} → {summary.session.closed_at ? formatDateTime(summary.session.closed_at) : '—'}
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

              {summary.by_category.length > 0 && (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th style={{ textAlign: 'right' }}>Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.by_category.map(row => (
                      <tr key={row.category}>
                        <td>{row.category}</td>
                        <td style={{ textAlign: 'right' }}>{formatMoney(row.total_cents)}</td>
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
            <div className="modal__footer">
              <button className="btn btn--primary" onClick={onClose}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
