import { describe, it, expect, vi } from 'vitest';

// Mock the DB so summarizeClosedTabs' line-item queries (by_category, top
// sellers) return empty results without a real SQLite file. The sums under
// test are computed from the rows passed in, not from the DB.
vi.mock('./client', () => ({
  default: {
    prepare: () => ({
      all: () => [],
      get: () => undefined,
    }),
  },
}));

import { summarizeClosedTabs } from './helpers';

// Minimal closed-tab row; only the fields the summary sums matter here.
function tab(over: Record<string, unknown>) {
  return {
    id: 1, status: 'closed', original_tab_id: null, payment_method: 'cash',
    subtotal_cents: 0, discount_cents: 0, tip_cents: 0, total_cents: 0,
    tax_cents: 0, tax_standard_cents: 0, tax_reduced_cents: 0,
    ...over,
  };
}

describe('summarizeClosedTabs', () => {
  it('sums discount_cents across closed tabs', () => {
    const summary = summarizeClosedTabs([
      tab({ id: 1, discount_cents: 100 }),
      tab({ id: 2, discount_cents: 250 }),
      tab({ id: 3 }),
    ]);
    expect(summary.discount_cents).toBe(350);
  });

  it('nets out negated Storno discounts against the originals they reverse', () => {
    const summary = summarizeClosedTabs([
      tab({ id: 1, discount_cents: 200 }),
      tab({ id: 2, status: 'voided', original_tab_id: 1, discount_cents: -200 }),
      tab({ id: 3, discount_cents: 150 }),
    ]);
    expect(summary.discount_cents).toBe(150);
  });

  it('returns zero discount for an empty shift', () => {
    expect(summarizeClosedTabs([]).discount_cents).toBe(0);
  });
});
