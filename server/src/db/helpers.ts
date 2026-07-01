import db from './client';
import type { Tab, LineItem, BilliardSession } from '@downtown/shared';
import type { TseResult } from '../services/tse';

interface TabRow {
  id: number; customer_name: string; notes: string | null; status: string; opened_at: string;
  closed_at: string | null; payment_method: string | null; subtotal_cents: number | null;
  discount_cents: number; tip_cents: number; total_cents: number | null; tax_cents: number | null;
  tax_standard_cents: number | null; tax_reduced_cents: number | null;
  void_reason: string | null; voided_at: string | null; deleted_at: string | null; original_tab_id: number | null;
  card_auth_code: string | null; card_masked_pan: string | null;
  tse_signature: string | null; tse_start_time: string | null; tse_timestamp: string | null;
  tse_transaction_number: string | null; tse_signature_counter: number | null;
  tse_status: 'ok' | 'offline' | null;
  subtotal_standard_cents: number | null; subtotal_reduced_cents: number | null;
  session_id: number | null;
}

export function buildTab(id: number): Tab | undefined {
  const row = db.prepare('SELECT * FROM tabs WHERE id = ?').get(id) as TabRow | undefined;
  if (!row) return undefined;
  const items = db.prepare(`
    SELECT li.*, bs.started_at AS session_started_at, bs.ended_at AS session_ended_at,
           bs.computed_cost_cents AS session_computed_cost_cents
    FROM line_items li
    LEFT JOIN billiard_sessions bs ON bs.line_item_id = li.id
    WHERE li.tab_id = ?
    ORDER BY li.created_at ASC
  `).all(id) as LineItem[];
  const running_total_cents = items.reduce(
    (sum, i) => sum + i.price_snapshot_cents * i.quantity, 0
  );
  const active_sessions = db.prepare(`
    SELECT bs.*, pt.label AS table_label, pt.type AS table_type
    FROM billiard_sessions bs
    JOIN pool_tables pt ON pt.id = bs.pool_table_id
    WHERE bs.tab_id = ? AND bs.ended_at IS NULL
  `).all(id) as BilliardSession[];
  return { ...row, items, running_total_cents, active_sessions } as Tab;
}

export function logEvent(event_type: string, tab_id: number | null, payload: object): void {
  db.prepare('INSERT INTO events (event_type, tab_id, payload, created_at) VALUES (?, ?, ?, ?)')
    .run(event_type, tab_id, JSON.stringify(payload), new Date().toISOString());
}

export interface TaxBreakdown {
  subtotal_cents: number;
  subtotal_standard_cents: number;
  subtotal_reduced_cents: number;
  tax_standard_cents: number;
  tax_reduced_cents: number;
  tax_cents: number;
}

// Tax is always *included* in the price. drinks/coffee → 19%, food/snacks → 7%.
// formula: Math.round(lineTotal * rate / (100 + rate)). See claude.md.
export function computeTaxBreakdown(
  items: Array<{ price_snapshot_cents: number; quantity: number; tax_category_snapshot: string }>
): TaxBreakdown {
  let subtotal_standard_cents = 0, subtotal_reduced_cents = 0;
  let tax_standard_cents = 0, tax_reduced_cents = 0;
  for (const item of items) {
    const lineTotal = item.price_snapshot_cents * item.quantity;
    if (item.tax_category_snapshot === 'reduced') {
      subtotal_reduced_cents += lineTotal;
      tax_reduced_cents += Math.round(lineTotal * 7 / 107);
    } else {
      subtotal_standard_cents += lineTotal;
      tax_standard_cents += Math.round(lineTotal * 19 / 119);
    }
  }
  return {
    subtotal_cents: subtotal_standard_cents + subtotal_reduced_cents,
    subtotal_standard_cents,
    subtotal_reduced_cents,
    tax_standard_cents,
    tax_reduced_cents,
    tax_cents: tax_standard_cents + tax_reduced_cents,
  };
}

// Proportionally reduces standard/reduced subtotals and recomputes tax on the
// discounted amounts. The returned subtotal_cents = original - discount.
export function applyDiscountToTax(tax: TaxBreakdown, discount_cents: number): TaxBreakdown {
  if (discount_cents <= 0 || tax.subtotal_cents === 0) return tax;
  const disc = Math.min(discount_cents, tax.subtotal_cents);
  const disc_std = Math.round(disc * tax.subtotal_standard_cents / tax.subtotal_cents);
  const disc_red = disc - disc_std;
  const std = tax.subtotal_standard_cents - disc_std;
  const red = tax.subtotal_reduced_cents - disc_red;
  const tax_std = Math.round(std * 19 / 119);
  const tax_red = Math.round(red * 7 / 107);
  return {
    subtotal_cents: std + red,
    subtotal_standard_cents: std,
    subtotal_reduced_cents: red,
    tax_standard_cents: tax_std,
    tax_reduced_cents: tax_red,
    tax_cents: tax_std + tax_red,
  };
}

export interface CloseSaleParams {
  closed_at: string;
  payment_method: string;
  tax: TaxBreakdown;      // post-discount; tax.subtotal_cents = original_subtotal - discount
  discount_cents?: number;
  tip_cents: number;
  total_cents: number;
  card_auth_code: string | null;
  card_masked_pan: string | null;
  tse: TseResult | null;
}

// Marks a tab closed with finalized financials + TSE fields. Single UPDATE,
// shared by close / quick-pay / split-pay so the column set can't drift.
export function writeClose(tabId: number, p: CloseSaleParams): void {
  const disc = p.discount_cents ?? 0;
  // tax.subtotal_cents is post-discount; add discount back to store the original item total
  const originalSubtotal = p.tax.subtotal_cents + disc;
  db.prepare(`
    UPDATE tabs SET
      status = 'closed',
      closed_at = ?,
      payment_method = ?,
      subtotal_cents = ?,
      discount_cents = ?,
      tax_cents = ?,
      tax_standard_cents = ?,
      tax_reduced_cents = ?,
      subtotal_standard_cents = ?,
      subtotal_reduced_cents = ?,
      tip_cents = ?,
      total_cents = ?,
      card_auth_code = ?,
      card_masked_pan = ?,
      tse_signature = ?,
      tse_start_time = ?,
      tse_timestamp = ?,
      tse_transaction_number = ?,
      tse_signature_counter = ?,
      tse_status = ?
    WHERE id = ?
  `).run(
    p.closed_at, p.payment_method,
    originalSubtotal, disc,
    p.tax.tax_cents, p.tax.tax_standard_cents, p.tax.tax_reduced_cents,
    p.tax.subtotal_standard_cents, p.tax.subtotal_reduced_cents,
    p.tip_cents, p.total_cents, p.card_auth_code, p.card_masked_pan,
    p.tse?.tse_signature ?? null,
    p.tse?.tse_start_time ?? null,
    p.tse?.tse_timestamp ?? null,
    p.tse?.tse_transaction_number ?? null,
    p.tse?.tse_signature_counter ?? null,
    p.tse ? 'ok' : 'offline', tabId,
  );
}

// Aggregates a set of already-fetched closed tab rows into report totals.
// Shared by the daily report and the per-shift summary. Returns zeros (and an
// empty by_category) for an empty input.
export function summarizeClosedTabs(closed: any[]) {
  // Money is summed over every row incl. 'voided' Storni: their negated amounts
  // net out the originals they reverse, so totals stay exact even if a tip
  // correction lands in a different report window than the original sale.
  const sum = (field: string) => closed.reduce((s: number, t: any) => s + (t[field] ?? 0), 0);
  const cashTabs = closed.filter((t: any) => t.payment_method === 'cash');
  const cardTabs = closed.filter((t: any) => t.payment_method === 'card');

  // Counts, by contrast, are "real" sales only: drop the voided Storni and the
  // originals they superseded, so a correction doesn't inflate tab_count / avg.
  const supersededIds = new Set(
    closed.filter((t: any) => t.status === 'voided' && t.original_tab_id != null).map((t: any) => t.original_tab_id)
  );
  const realTabs = closed.filter((t: any) => t.status !== 'voided' && !supersededIds.has(t.id));

  const ids = closed.map((t: any) => t.id);
  const ph = ids.length === 0 ? '' : ids.map(() => '?').join(',');

  const by_category = ids.length === 0 ? [] : db.prepare(`
    SELECT COALESCE(p.category, 'Billiard') as category,
           SUM(li.price_snapshot_cents * li.quantity) as total_cents
    FROM line_items li
    LEFT JOIN products p ON li.product_id = p.id
    WHERE li.tab_id IN (${ph})
    GROUP BY COALESCE(p.category, 'Billiard')
    ORDER BY total_cents DESC
  `).all(...ids) as Array<{ category: string; total_cents: number }>;

  const by_top_category = ids.length === 0 ? [] : db.prepare(`
    SELECT
      CASE
        WHEN li.kind = 'billiard' THEN 'Billard'
        WHEN li.tax_category_snapshot = 'reduced' THEN 'Essen'
        ELSE 'Getränke'
      END as category,
      SUM(li.price_snapshot_cents * li.quantity) as total_cents
    FROM line_items li
    WHERE li.tab_id IN (${ph})
    GROUP BY 1
    ORDER BY 2 DESC
  `).all(...ids) as Array<{ category: string; total_cents: number }>;

  const top_drinks = ids.length === 0 ? [] : db.prepare(`
    SELECT li.name_snapshot as name, SUM(li.quantity) as qty
    FROM line_items li
    WHERE li.tab_id IN (${ph})
      AND li.kind = 'product'
      AND li.tax_category_snapshot = 'standard'
    GROUP BY li.name_snapshot
    ORDER BY qty DESC
    LIMIT 10
  `).all(...ids) as Array<{ name: string; qty: number }>;

  const top_food = ids.length === 0 ? [] : db.prepare(`
    SELECT li.name_snapshot as name, SUM(li.quantity) as qty
    FROM line_items li
    WHERE li.tab_id IN (${ph})
      AND li.kind = 'product'
      AND li.tax_category_snapshot = 'reduced'
    GROUP BY li.name_snapshot
    ORDER BY qty DESC
    LIMIT 10
  `).all(...ids) as Array<{ name: string; qty: number }>;

  const total_cents = sum('total_cents');
  const avg_tab_cents = realTabs.length > 0 ? Math.round(total_cents / realTabs.length) : 0;

  return {
    tab_count: realTabs.length,
    subtotal_cents: sum('subtotal_cents'),
    tip_cents: sum('tip_cents'),
    total_cents,
    tax_cents: sum('tax_cents'),
    tax_standard_cents: sum('tax_standard_cents'),
    tax_reduced_cents: sum('tax_reduced_cents'),
    cash_cents: cashTabs.reduce((s: number, t: any) => s + (t.total_cents ?? 0), 0),
    card_cents: cardTabs.reduce((s: number, t: any) => s + (t.total_cents ?? 0), 0),
    cash_count: realTabs.filter((t: any) => t.payment_method === 'cash').length,
    card_count: realTabs.filter((t: any) => t.payment_method === 'card').length,
    avg_tab_cents,
    by_category,
    by_top_category,
    top_drinks,
    top_food,
  };
}
