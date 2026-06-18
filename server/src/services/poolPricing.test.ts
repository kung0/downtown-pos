import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the DB so getSetting returns controllable values without a real SQLite file.
// The mock must be hoisted before the module under test is imported.
vi.mock('../db/client', () => ({
  default: {
    prepare: () => ({
      get: (key: string) => {
        const defaults: Record<string, number> = {
          pool_rate_standard_cents: 1200,
          pool_rate_peak_cents:     1600,
          pool_rate_daytime_discount_cents: 400,
        };
        return key in defaults ? { value: defaults[key] } : undefined;
      },
    }),
  },
}));

import {
  roundUpTo50,
  roundToNearest15Min,
  computeCost,
  poolRateAt,
  computePoolCostSplit,
  runningCostCents,
} from './poolPricing';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build a UTC Date from a Europe/Berlin wall-clock time. */
function berlin(isoLike: string): Date {
  // isoLike = "2024-03-15T22:30" (Berlin local, no timezone suffix)
  // We rely on the browser/node Intl machinery to get the correct UTC offset.
  // Approach: append a known offset guess, then correct for DST.
  const [datePart, timePart] = isoLike.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [h, min] = timePart.split(':').map(Number);
  // CET is +01:00, CEST is +02:00. Start with +01:00 and correct.
  const guess = new Date(`${datePart}T${timePart}:00+01:00`);
  const actualHour = parseInt(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Berlin', hour: 'numeric', hourCycle: 'h23',
    }).format(guess),
    10,
  );
  return new Date(guess.getTime() - (actualHour - h) * 3_600_000);
}

// ─── roundUpTo50 ─────────────────────────────────────────────────────────────

describe('roundUpTo50', () => {
  it('leaves exact multiples unchanged', () => {
    expect(roundUpTo50(0)).toBe(0);
    expect(roundUpTo50(50)).toBe(50);
    expect(roundUpTo50(1200)).toBe(1200);
  });

  it('rounds up any remainder', () => {
    expect(roundUpTo50(1)).toBe(50);
    expect(roundUpTo50(49)).toBe(50);
    expect(roundUpTo50(51)).toBe(100);
    expect(roundUpTo50(1201)).toBe(1250);
  });
});

// ─── roundToNearest15Min ─────────────────────────────────────────────────────

describe('roundToNearest15Min', () => {
  it('0 s → 0', () => expect(roundToNearest15Min(0)).toBe(0));

  it('3 min → 0', () => expect(roundToNearest15Min(3 * 60)).toBe(0));

  it('exactly 7.5 min (450 s) rounds up to 15', () =>
    expect(roundToNearest15Min(450)).toBe(900));

  it('8 min → 15', () => expect(roundToNearest15Min(8 * 60)).toBe(15 * 60));

  it('7 min → 0 (just below midpoint)', () =>
    expect(roundToNearest15Min(7 * 60)).toBe(0));

  it('22 min → 15', () => expect(roundToNearest15Min(22 * 60)).toBe(15 * 60));

  it('23 min → 30', () => expect(roundToNearest15Min(23 * 60)).toBe(30 * 60));

  it('exactly 15 min → 15', () =>
    expect(roundToNearest15Min(15 * 60)).toBe(15 * 60));

  it('60 min → 60', () =>
    expect(roundToNearest15Min(60 * 60)).toBe(60 * 60));

  it('90 min → 90', () =>
    expect(roundToNearest15Min(90 * 60)).toBe(90 * 60));
});

// ─── computeCost (dart flat rate) ────────────────────────────────────────────

describe('computeCost', () => {
  it('1 hour at 1200 c/h → 1200', () =>
    expect(computeCost(3600, 1200)).toBe(1200));

  it('30 min at 1200 c/h → 600', () =>
    expect(computeCost(1800, 1200)).toBe(600));

  it('rounds up to next 50 cents', () => {
    // 10 min at 1200 c/h = 200 exactly → no rounding needed
    expect(computeCost(600, 1200)).toBe(200);
    // 5 min at 1200 c/h = 100 exactly
    expect(computeCost(300, 1200)).toBe(100);
    // 1 min at 1200 c/h = 20 cents → rounds up to 50
    expect(computeCost(60, 1200)).toBe(50);
  });
});

// ─── poolRateAt ──────────────────────────────────────────────────────────────

describe('poolRateAt', () => {
  const STD = 1200, PEAK = 1600, DISC = 400;

  it('weekday evening (after 17:00) → standard, no discount', () => {
    // Monday 20:00 Berlin
    expect(poolRateAt(berlin('2024-03-18T20:00'), STD, PEAK, DISC)).toBe(1200);
  });

  it('weekday afternoon (before 17:00) → standard minus discount', () => {
    // Monday 14:00 Berlin
    expect(poolRateAt(berlin('2024-03-18T14:00'), STD, PEAK, DISC)).toBe(800);
  });

  it('friday evening → peak, no discount', () => {
    // Friday 20:00 Berlin
    expect(poolRateAt(berlin('2024-03-15T20:00'), STD, PEAK, DISC)).toBe(1600);
  });

  it('friday afternoon (before 17:00) → peak minus discount', () => {
    // Friday 14:00 Berlin
    expect(poolRateAt(berlin('2024-03-15T14:00'), STD, PEAK, DISC)).toBe(1200);
  });

  it('saturday night → peak, no discount', () => {
    // Saturday 22:00 Berlin
    expect(poolRateAt(berlin('2024-03-16T22:00'), STD, PEAK, DISC)).toBe(1600);
  });

  it('sunday evening → standard, no discount', () => {
    // Sunday 20:00 Berlin
    expect(poolRateAt(berlin('2024-03-17T20:00'), STD, PEAK, DISC)).toBe(1200);
  });

  // ── midnight / same-day logic ──────────────────────────────────────────────

  it('00:30 Saturday counts as Friday (peak, no discount)', () => {
    // Friday night bled into Saturday morning — should still be Friday peak
    expect(poolRateAt(berlin('2024-03-16T00:30'), STD, PEAK, DISC)).toBe(1600);
  });

  it('01:00 Sunday counts as Saturday (peak, no discount)', () => {
    expect(poolRateAt(berlin('2024-03-17T01:00'), STD, PEAK, DISC)).toBe(1600);
  });

  it('03:00 Monday counts as Sunday (standard, no discount)', () => {
    expect(poolRateAt(berlin('2024-03-18T03:00'), STD, PEAK, DISC)).toBe(1200);
  });

  it('07:59 Friday counts as Thursday (standard, no discount)', () => {
    // Just before 08:00 — still the previous day, and effHour = 7+24 = 31 → no discount
    expect(poolRateAt(berlin('2024-03-15T07:59'), STD, PEAK, DISC)).toBe(1200);
  });

  it('08:00 Friday counts as Friday peak with daytime discount', () => {
    // Exactly 08:00 — now it IS Friday, effHour = 8 < 17 → discount applies
    expect(poolRateAt(berlin('2024-03-15T08:00'), STD, PEAK, DISC)).toBe(1200); // 1600 - 400
  });
});

// ─── computePoolCostSplit ─────────────────────────────────────────────────────

describe('computePoolCostSplit', () => {
  it('exactly 1 hour on a weekday evening → standard rate', () => {
    // Mon 19:00–20:00 (no boundary crossing)
    const start = berlin('2024-03-18T19:00');
    const end   = berlin('2024-03-18T20:00');
    expect(computePoolCostSplit(start, end)).toBe(1200);
  });

  it('exactly 1 hour on a friday evening → peak rate', () => {
    const start = berlin('2024-03-15T20:00');
    const end   = berlin('2024-03-15T21:00');
    expect(computePoolCostSplit(start, end)).toBe(1600);
  });

  it('30 min on a weekday evening → 600 (half of 1200)', () => {
    const start = berlin('2024-03-18T19:00');
    const end   = berlin('2024-03-18T19:30');
    expect(computePoolCostSplit(start, end)).toBe(600);
  });

  // ── crossing 17:00 ────────────────────────────────────────────────────────

  it('session crosses 17:00 on a weekday: 1h before + 1h after → mixed rates', () => {
    // Mon 16:00–18:00: 1h at (1200-400)=800, 1h at 1200 → raw 2000 → roundUpTo50 = 2000
    const start = berlin('2024-03-18T16:00');
    const end   = berlin('2024-03-18T18:00');
    expect(computePoolCostSplit(start, end)).toBe(2000);
  });

  it('session crosses 17:00 on a friday: 1h before + 1h after → peak rates', () => {
    // Fri 16:00–18:00: 1h at (1600-400)=1200, 1h at 1600 → raw 2800 → 2800
    const start = berlin('2024-03-15T16:00');
    const end   = berlin('2024-03-15T18:00');
    expect(computePoolCostSplit(start, end)).toBe(2800);
  });

  it('30 min spanning 17:00 on a weekday → prorated', () => {
    // Mon 16:45–17:15: 15 min at 800, 15 min at 1200 → raw (0.25*800 + 0.25*1200) = 500 → roundUpTo50 = 500
    const start = berlin('2024-03-18T16:45');
    const end   = berlin('2024-03-18T17:15');
    expect(computePoolCostSplit(start, end)).toBe(500);
  });

  // ── crossing midnight ──────────────────────────────────────────────────────

  it('session crosses midnight Friday→Saturday: billed as Friday (peak) throughout', () => {
    // Fri 23:30–Sat 00:30 (no 08:00/17:00 boundary in range)
    // At 23:30 Fri → peak. At 00:30 Sat → effDay=Fri → still peak.
    // 1h at 1600 → 1600
    const start = berlin('2024-03-15T23:30');
    const end   = berlin('2024-03-16T00:30');
    expect(computePoolCostSplit(start, end)).toBe(1600);
  });

  it('session crosses midnight Sunday→Monday: billed as Sunday (standard) throughout', () => {
    // Sun 23:30–Mon 00:30
    // Sun is standard. 00:30 Mon → effDay=Sun → still standard.
    // 1h at 1200 → 1200
    const start = berlin('2024-03-17T23:30');
    const end   = berlin('2024-03-18T00:30');
    expect(computePoolCostSplit(start, end)).toBe(1200);
  });

  it('session crosses midnight Thursday→Friday: early-morning hours count as Thursday', () => {
    // Thu 23:00–Fri 01:00 (2h): 00:xx Fri → effDay=Thu → standard throughout
    // No 08:00 or 17:00 boundary in range.
    // 2h at 1200 → 2400
    const start = berlin('2024-03-14T23:00');
    const end   = berlin('2024-03-15T01:00');
    expect(computePoolCostSplit(start, end)).toBe(2400);
  });

  // ── crossing 08:00 ────────────────────────────────────────────────────────

  it('session crosses 08:00 on a weekday: early segment has no discount', () => {
    // Mon 07:00–09:00: 1h before 08:00 (effDay=Sun, effHour=31 → standard no discount → 1200)
    //                  1h after  08:00 (Mon, effHour=8 → standard with discount → 800)
    // raw = 1200 + 800 = 2000 → roundUpTo50 = 2000
    const start = berlin('2024-03-18T07:00');
    const end   = berlin('2024-03-18T09:00');
    expect(computePoolCostSplit(start, end)).toBe(2000);
  });

  it('session crosses 08:00 on a friday: peak before and peak-with-discount after', () => {
    // Fri 07:00–09:00: 1h before 08:00 (effDay=Thu → standard no discount → 1200)
    //                  1h after  08:00 (Fri, effHour=8 → peak with discount → 1200)
    // raw = 1200 + 1200 = 2400 → 2400
    const start = berlin('2024-03-15T07:00');
    const end   = berlin('2024-03-15T09:00');
    expect(computePoolCostSplit(start, end)).toBe(2400);
  });

  // ── 0-second session ──────────────────────────────────────────────────────

  it('zero-duration session → 0 cents', () => {
    const t = berlin('2024-03-18T20:00');
    expect(computePoolCostSplit(t, t)).toBe(0);
  });
});

// ─── runningCostCents: 15-min rounding end-to-end ────────────────────────────

describe('runningCostCents — 15-min rounding', () => {
  it('3 min dart session → 0 cents (rounds to 0)', () => {
    const start = berlin('2024-03-18T20:00');
    const now   = new Date(start.getTime() + 3 * 60_000);
    expect(runningCostCents('dart', start, 1200, now)).toBe(0);
  });

  it('8 min dart session → bills 15 min', () => {
    // 15 min at 1200 c/h = 300 cents
    const start = berlin('2024-03-18T20:00');
    const now   = new Date(start.getTime() + 8 * 60_000);
    expect(runningCostCents('dart', start, 1200, now)).toBe(300);
  });

  it('exactly 15 min dart → bills 15 min (300 cents at 1200 c/h)', () => {
    const start = berlin('2024-03-18T20:00');
    const now   = new Date(start.getTime() + 15 * 60_000);
    expect(runningCostCents('dart', start, 1200, now)).toBe(300);
  });

  it('3 min pool session → 0 cents (rounds to 0)', () => {
    const start = berlin('2024-03-18T20:00');
    const now   = new Date(start.getTime() + 3 * 60_000);
    expect(runningCostCents('billiard', start, 0, now)).toBe(0);
  });

  it('8 min pool session → bills 15 min at current rate', () => {
    // 15 min at 1200 c/h = 300 cents (weekday evening, standard, no discount)
    const start = berlin('2024-03-18T20:00');
    const now   = new Date(start.getTime() + 8 * 60_000);
    expect(runningCostCents('billiard', start, 0, now)).toBe(300);
  });

  it('22 min pool session → rounds to 15 min', () => {
    const start = berlin('2024-03-18T20:00');
    const now   = new Date(start.getTime() + 22 * 60_000);
    // 15 min at 1200 c/h = 300 cents
    expect(runningCostCents('billiard', start, 0, now)).toBe(300);
  });

  it('23 min pool session → rounds to 30 min', () => {
    const start = berlin('2024-03-18T20:00');
    const now   = new Date(start.getTime() + 23 * 60_000);
    // 30 min at 1200 c/h = 600 cents
    expect(runningCostCents('billiard', start, 0, now)).toBe(600);
  });

  it('60 min pool session → stays 60 min', () => {
    const start = berlin('2024-03-18T20:00');
    const now   = new Date(start.getTime() + 60 * 60_000);
    expect(runningCostCents('billiard', start, 0, now)).toBe(1200);
  });

  // ── rounding interacts with rate boundary ─────────────────────────────────

  it('8 min pool session starting at 16:55: rounded to 15 min crosses 17:00', () => {
    // Start 16:55, rounded end = 17:10 → crosses the 17:00 boundary
    // 5 min at (1200-400)=800 + 10 min at 1200 → raw = 5/60*800 + 10/60*1200 = 66.67 + 200 = 266.67 → roundUpTo50 = 300
    const start = berlin('2024-03-18T16:55');
    const now   = new Date(start.getTime() + 8 * 60_000);
    expect(runningCostCents('billiard', start, 0, now)).toBe(300);
  });
});
