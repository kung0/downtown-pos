import { describe, it, expect } from 'vitest';
import { isCategoryAvailableNow } from './availability';
import type { Category } from '@downtown/shared';

function cat(partial: Partial<Category>): Category {
  return {
    id: 1, name: 'Test', parent_id: null, tax_category: 'standard',
    sort_order: 0, created_at: '', avail_days: null, avail_start: null, avail_end: null,
    ...partial,
  };
}

function at(c: Category, iso: string): boolean {
  return isCategoryAvailableNow(c.id, new Map([[c.id, c]]), new Date(iso));
}

// June 2026 → Berlin is UTC+2, so these UTC instants map to:
//   2026-06-05T21:00:00Z → Fri 23:00   2026-06-05T23:30:00Z → Sat 01:30
//   2026-06-06T00:30:00Z → Sat 02:30   2026-06-06T21:00:00Z → Sat 23:00
describe('isCategoryAvailableNow — wrap past midnight', () => {
  it('Fri 22:00–02:00 covers Friday night into Saturday morning', () => {
    const c = cat({ avail_days: '5', avail_start: '22:00', avail_end: '02:00' });
    expect(at(c, '2026-06-05T21:00:00Z')).toBe(true);  // Fri 23:00 — evening segment
    expect(at(c, '2026-06-05T23:30:00Z')).toBe(true);  // Sat 01:30 — morning tail, anchored Fri
    expect(at(c, '2026-06-06T00:30:00Z')).toBe(false); // Sat 02:30 — past the window
    expect(at(c, '2026-06-06T21:00:00Z')).toBe(false); // Sat 23:00 — Saturday not selected
  });

  it('every-day 22:00–02:00 wraps without a day restriction', () => {
    const c = cat({ avail_start: '22:00', avail_end: '02:00' });
    expect(at(c, '2026-06-05T21:00:00Z')).toBe(true);  // Fri 23:00
    expect(at(c, '2026-06-05T23:30:00Z')).toBe(true);  // Sat 01:30
    expect(at(c, '2026-06-06T00:30:00Z')).toBe(false); // Sat 02:30
  });
});

describe('isCategoryAvailableNow — same-day window (Mittagsangebot)', () => {
  const c = cat({ avail_days: '2,3,4,5', avail_start: '11:30', avail_end: '15:00' });
  it('open during Tue–Fri lunch, closed otherwise', () => {
    expect(at(c, '2026-06-05T10:00:00Z')).toBe(true);  // Fri 12:00
    expect(at(c, '2026-06-05T13:30:00Z')).toBe(false); // Fri 15:30 — after close
    expect(at(c, '2026-06-05T08:00:00Z')).toBe(false); // Fri 10:00 — before open
    expect(at(c, '2026-06-06T10:00:00Z')).toBe(false); // Sat 12:00 — wrong day
  });
});

describe('isCategoryAvailableNow — no window', () => {
  it('is always available', () => {
    expect(at(cat({}), '2026-06-06T00:30:00Z')).toBe(true);
  });
});
