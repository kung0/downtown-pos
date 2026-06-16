import db from '../db/client';
import type { TableType } from '@downtown/shared';

// All pool/dart cost math lives here so the live ticker and the final bill use
// exactly the same calculation — what the customer sees ticking up is what they
// pay. Money is integer cents; pool cost is rounded up to the next 50 cents.

export function roundUpTo50(rawCents: number): number {
  return Math.ceil(rawCents / 50) * 50;
}

// Flat rate over the whole elapsed time. Used for dart (single rate, no peak /
// daytime / business-day logic).
export function computeCost(elapsedSeconds: number, hourlyRateCents: number): number {
  return roundUpTo50((elapsedSeconds / 3600) * hourlyRateCents);
}

export function getSetting(key: string, fallback: number): number {
  return Number((db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any)?.value ?? fallback);
}

// Pool rate effective at a given instant. Fri/Sat → peak, otherwise standard;
// a daytime discount applies before 17:00. 00:00–07:59 belongs to the PREVIOUS
// business day, so e.g. 04:00 Sunday is still billed at Saturday's peak rate.
export function poolRateAt(date: Date, standard: number, peak: number, discount: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin', weekday: 'short', hour: 'numeric', hourCycle: 'h23',
  }).formatToParts(date);
  const weekday = parts.find(p => p.type === 'weekday')!.value;
  const hour    = parseInt(parts.find(p => p.type === 'hour')!.value, 10);
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const effDay  = hour < 8 ? DAYS[(DAYS.indexOf(weekday) + 6) % 7] : weekday;
  const effHour = hour < 8 ? hour + 24 : hour;
  return (effDay === 'Fri' || effDay === 'Sat' ? peak : standard) - (effHour < 17 ? discount : 0);
}

function berlinBoundaryToUTC(year: number, month: number, day: number, hour: number): Date {
  // Start with CET (+01:00) as estimate, then correct for DST
  const mm = String(month).padStart(2, '0'), dd = String(day).padStart(2, '0'), hh = String(hour).padStart(2, '0');
  const guess = new Date(`${year}-${mm}-${dd}T${hh}:00:00+01:00`);
  const actual = parseInt(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin', hour: 'numeric', hourCycle: 'h23',
  }).format(guess), 10);
  return new Date(guess.getTime() - (actual - hour) * 3_600_000);
}

// Prorated pool cost across every rate boundary (08:00 and 17:00 Berlin) the
// session spans, so a session that crosses peak/daytime is billed correctly.
export function computePoolCostSplit(startUtc: Date, endUtc: Date): number {
  const standard = getSetting('pool_rate_standard_cents', 1200);
  const peak     = getSetting('pool_rate_peak_cents', 1600);
  const discount = getSetting('pool_rate_daytime_discount_cents', 400);

  // Collect all 08:00 and 17:00 Berlin boundaries between start and end
  const boundaries: Date[] = [];
  // Iterate Berlin calendar days from (start - 1 day) to (end + 1 day) to catch overnight boundaries.
  // NB: Date.UTC takes a 0-based month, so the Berlin month must be decremented.
  const [sy, sm, sd] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' })
    .format(startUtc).split('-').map(Number);
  let cur = new Date(Date.UTC(sy, sm - 1, sd) - 86_400_000);
  const limit = endUtc.getTime() + 86_400_000;
  while (cur.getTime() < limit) {
    const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' })
      .format(cur).split('-').map(Number);
    for (const h of [8, 17]) {
      const b = berlinBoundaryToUTC(y, m, d, h);
      if (b > startUtc && b < endUtc) boundaries.push(b);
    }
    cur = new Date(cur.getTime() + 86_400_000);
  }
  boundaries.sort((a, b) => a.getTime() - b.getTime());

  const points = [startUtc, ...boundaries, endUtc];
  let rawCents = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const secs = (points[i + 1].getTime() - points[i].getTime()) / 1000;
    rawCents += (secs / 3600) * poolRateAt(points[i], standard, peak, discount);
  }
  return roundUpTo50(rawCents);
}

// The running/final cost of a session at instant `now`. Dart bills a flat
// snapshot rate; pool prorates across rate boundaries (and reads live settings).
// Used by both the live ticker and /stop, so live always matches the bill.
export function runningCostCents(
  tableType: TableType,
  startedAt: Date,
  hourlyRateSnapshotCents: number,
  now: Date,
): number {
  if (tableType === 'dart') {
    const elapsed = Math.floor((now.getTime() - startedAt.getTime()) / 1000);
    return computeCost(elapsed, hourlyRateSnapshotCents);
  }
  return computePoolCostSplit(startedAt, now);
}
