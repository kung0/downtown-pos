import type { ShiftSummary } from '@downtown/shared';
import { formatMoney } from '../utils/money';
import { formatDateTime } from '../utils/time';

export default function SummaryBody({ summary }: { summary: ShiftSummary }) {
  return (
    <div className="reports-body">
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

      <div className="reports-section">
        <h2 className="reports-section__title">Zahlung</h2>
        <div className="table-container">
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
        </div>
      </div>

      {summary.by_top_category.length > 0 && (
        <div className="reports-section">
          <h2 className="reports-section__title">Kategorie</h2>
          <div className="table-container">
            <table className="table">
              <tbody>
                {summary.by_top_category.map(row => (
                  <tr key={row.category}>
                    <td>{row.category}</td>
                    <td style={{ textAlign: 'right' }}>{formatMoney(row.total_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {summary.top_drinks.length > 0 && (
        <div className="reports-section">
          <h2 className="reports-section__title">Top Getränke</h2>
          <div className="table-container">
            <table className="table">
              <tbody>
                {summary.top_drinks.map((d, i) => (
                  <tr key={d.name}>
                    <td>{i + 1}. {d.name}</td>
                    <td style={{ textAlign: 'right' }}>{d.qty}x</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {summary.top_food.length > 0 && (
        <div className="reports-section">
          <h2 className="reports-section__title">Top Speisen</h2>
          <div className="table-container">
            <table className="table">
              <tbody>
                {summary.top_food.map((f, i) => (
                  <tr key={f.name}>
                    <td>{i + 1}. {f.name}</td>
                    <td style={{ textAlign: 'right' }}>{f.qty}x</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="reports-section">
        <h2 className="reports-section__title">MwSt.</h2>
        <div className="table-container">
          <table className="table">
            <tbody>
              <tr>
                <td style={{ color: 'var(--text-muted)' }}>inkl. MwSt. 19 %</td>
                <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{formatMoney(summary.tax_standard_cents)}</td>
              </tr>
              <tr>
                <td style={{ color: 'var(--text-muted)' }}>inkl. MwSt. 7 %</td>
                <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{formatMoney(summary.tax_reduced_cents)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
