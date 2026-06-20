import { useState, useEffect } from 'react';
import type { Session, ShiftSummary } from '@downtown/shared';
import { sessionsApi, exportApi } from '../api';
import { formatMoney } from '../utils/money';
import { formatDateTime, formatTime } from '../utils/time';

function sessionLabel(s: Session, index: number, total: number): string {
  const num = total - index;
  const start = formatTime(s.opened_at);
  const end = s.closed_at ? formatTime(s.closed_at) : 'open';
  const date = new Date(s.opened_at).toLocaleDateString('de-DE', {
    timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric',
  });
  return `Schicht #${num} · ${date} · ${start} → ${end}`;
}

export default function ReportsPage() {
  const [sessions, setSessions]   = useState<Session[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [summary, setSummary]     = useState<ShiftSummary | null>(null);
  const [loading, setLoading]     = useState(true);
  const [sumLoading, setSumLoading] = useState(false);

  // DSFinV-K export state — default to previous calendar month
  const [exportFrom, setExportFrom] = useState(() => {
    const now = new Date();
    const y = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const m = now.getMonth() === 0 ? 12 : now.getMonth();
    return `${y}-${String(m).padStart(2, '0')}-01`;
  });
  const [exportTo, setExportTo] = useState(() => {
    const now = new Date();
    // last day of previous month = day 0 of current month
    const last = new Date(now.getFullYear(), now.getMonth(), 0);
    return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
  });
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState('');

  useEffect(() => {
    sessionsApi.list()
      .then(list => {
        setSessions(list);
        const first = list[0] ?? null;
        if (first) setSelectedId(first.id);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedId) { setSummary(null); return; }
    setSumLoading(true);
    sessionsApi.summary(selectedId)
      .then(setSummary)
      .catch(console.error)
      .finally(() => setSumLoading(false));
  }, [selectedId]);

  if (loading) return <div className="page"><div className="placeholder">Loading…</div></div>;

  if (sessions.length === 0) {
    return (
      <div className="page">
        <div className="page__header"><h1 className="page__title">Reports</h1></div>
        <div className="placeholder">No shifts recorded yet</div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1 className="page__title">Reports</h1>
        <select
          className="field__input"
          style={{ width: 'auto' }}
          value={selectedId ?? ''}
          onChange={e => setSelectedId(Number(e.target.value))}
        >
          {sessions.map((s, i) => (
            <option key={s.id} value={s.id}>
              {sessionLabel(s, i, sessions.length)}
            </option>
          ))}
        </select>
      </div>

      <div className="settings-section" style={{ marginTop: '24px' }}>
        <div className="settings-section__title">DSFinV-K Export</div>
        <div className="settings-section__fields" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: '16px', alignItems: 'flex-end' }}>
          <div className="field">
            <label className="field__label">Von</label>
            <input
              type="date"
              className="price-input__field"
              style={{ padding: '8px 10px', border: '1.5px solid var(--border)', borderRadius: 'var(--radius)', fontSize: '14px', background: 'var(--surface)', color: 'var(--text)', fontFamily: 'inherit' }}
              value={exportFrom}
              onChange={e => { setExportFrom(e.target.value); setExportErr(''); }}
            />
          </div>
          <div className="field">
            <label className="field__label">Bis</label>
            <input
              type="date"
              className="price-input__field"
              style={{ padding: '8px 10px', border: '1.5px solid var(--border)', borderRadius: 'var(--radius)', fontSize: '14px', background: 'var(--surface)', color: 'var(--text)', fontFamily: 'inherit' }}
              value={exportTo}
              onChange={e => { setExportTo(e.target.value); setExportErr(''); }}
            />
          </div>
        </div>
        <div className="settings-section__footer">
          {exportErr && (
            <span style={{ fontSize: '13px', color: 'var(--danger)' }}>{exportErr}</span>
          )}
          {!exportErr && (
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              ZIP mit Kassenabschluss, Bonkopf, Bonpos u.a.
            </span>
          )}
          <button
            className="btn btn--primary"
            disabled={exporting || !exportFrom || !exportTo}
            onClick={async () => {
              setExporting(true);
              setExportErr('');
              try {
                await exportApi.dsfinvk(exportFrom, exportTo);
              } catch (e) {
                setExportErr((e as Error).message);
              } finally {
                setExporting(false);
              }
            }}
          >
            {exporting ? 'Exportieren…' : 'Exportieren'}
          </button>
        </div>
      </div>

      {sumLoading ? (
        <div className="placeholder">Loading…</div>
      ) : !summary || summary.tab_count === 0 ? (
        <div className="placeholder">No closed tabs this shift</div>
      ) : (
        <div className="reports-body">
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>
            {formatDateTime(summary.session.opened_at)}
            {' → '}
            {summary.session.closed_at ? formatDateTime(summary.session.closed_at) : 'open'}
          </div>

          <div className="stat-grid">
            <div className="stat-card">
              <div className="stat-card__label">Total revenue</div>
              <div className="stat-card__value">{formatMoney(summary.total_cents)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-card__label">Tabs closed</div>
              <div className="stat-card__value">{summary.tab_count}</div>
            </div>
            <div className="stat-card">
              <div className="stat-card__label">Avg tab</div>
              <div className="stat-card__value">
                {formatMoney(summary.tab_count > 0 ? Math.round(summary.subtotal_cents / summary.tab_count) : 0)}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-card__label">Tips</div>
              <div className="stat-card__value">{formatMoney(summary.tip_cents)}</div>
            </div>
          </div>

          <div className="reports-section">
            <h2 className="reports-section__title">Payment split</h2>
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Method</th>
                    <th style={{ textAlign: 'right' }}>Tabs</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Cash</td>
                    <td style={{ textAlign: 'right' }}>{summary.cash_count}</td>
                    <td style={{ textAlign: 'right' }}>{formatMoney(summary.cash_cents)}</td>
                  </tr>
                  <tr>
                    <td>Card</td>
                    <td style={{ textAlign: 'right' }}>{summary.card_count}</td>
                    <td style={{ textAlign: 'right' }}>{formatMoney(summary.card_cents)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="reports-section">
            <h2 className="reports-section__title">By category</h2>
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th style={{ textAlign: 'right' }}>Revenue</th>
                    <th style={{ textAlign: 'right' }}>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.by_category.map(row => (
                    <tr key={row.category}>
                      <td>{row.category}</td>
                      <td style={{ textAlign: 'right' }}>{formatMoney(row.total_cents)}</td>
                      <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                        {summary.subtotal_cents > 0
                          ? `${Math.round(row.total_cents / summary.subtotal_cents * 100)} %`
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="reports-section">
            <h2 className="reports-section__title">Tax summary</h2>
            <div className="table-container">
              <table className="table">
                <tbody>
                  <tr>
                    <td>Subtotal (gross)</td>
                    <td style={{ textAlign: 'right' }}>{formatMoney(summary.subtotal_cents)}</td>
                  </tr>
                  {summary.tax_standard_cents > 0 && (
                    <tr>
                      <td style={{ color: 'var(--text-muted)' }}>inkl. MwSt. 19 % (Getränke)</td>
                      <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                        {formatMoney(summary.tax_standard_cents)}
                      </td>
                    </tr>
                  )}
                  {summary.tax_reduced_cents > 0 && (
                    <tr>
                      <td style={{ color: 'var(--text-muted)' }}>inkl. MwSt. 7 % (Speisen)</td>
                      <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                        {formatMoney(summary.tax_reduced_cents)}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
