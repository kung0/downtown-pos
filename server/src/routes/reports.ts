import { Router } from 'express';
import type { Request, Response } from 'express';
import db from '../db/client';
import { summarizeClosedTabs } from '../db/helpers';

const router = Router();

// Convert "00:00 Berlin" on a given calendar day to its UTC instant.
// Guesses CET (+01:00), then corrects for the actual Berlin offset (DST-aware).
function berlinDayStartUtc(year: number, month: number, day: number): Date {
  const mm = String(month).padStart(2, '0'), dd = String(day).padStart(2, '0');
  const guess = new Date(`${year}-${mm}-${dd}T00:00:00+01:00`);
  const actualHour = parseInt(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin', hour: 'numeric', hourCycle: 'h23',
  }).format(guess), 10);
  return new Date(guess.getTime() - actualHour * 3_600_000);
}

// [start, end) UTC instants spanning the Berlin calendar day YYYY-MM-DD.
function berlinDayRangeUtc(dateStr: string): [string, string] {
  const [y, m, d] = dateStr.split('-').map(Number);
  const start = berlinDayStartUtc(y, m, d);
  const next = new Date(Date.UTC(y, m - 1, d) + 86_400_000);
  const [ny, nm, nd] = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' })
    .format(next).split('-').map(Number);
  const end = berlinDayStartUtc(ny, nm, nd);
  return [start.toISOString(), end.toISOString()];
}

// GET /api/reports/daily?date=YYYY-MM-DD (Europe/Berlin date)
router.get('/daily', (req: Request, res: Response) => {
  const date = (req.query.date as string) ||
    new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });

  const [startUtc, endUtc] = berlinDayRangeUtc(date);
  // 'voided' Storno records carry negated amounts (closed_at set to the reversal
  // time) so they net out the originals they reverse within the same day.
  const closed = db.prepare(`
    SELECT * FROM tabs
    WHERE status IN ('closed', 'voided')
    AND closed_at >= ? AND closed_at < ?
  `).all(startUtc, endUtc) as any[];

  const summary = summarizeClosedTabs(closed);
  const billiard_cents = summary.by_category.find(c => c.category === 'Billiard')?.total_cents ?? 0;
  const avg_tab_cents = summary.tab_count > 0 ? Math.round(summary.subtotal_cents / summary.tab_count) : 0;

  res.json({ date, ...summary, avg_tab_cents, billiard_cents });
});

export default router;
