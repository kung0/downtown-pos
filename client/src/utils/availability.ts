import type { Category } from '@downtown/shared';

// Weekday labels for the availability editor — 1=Mon … 7=Sun (German short form).
export const WEEKDAYS: Array<{ num: number; label: string }> = [
  { num: 1, label: 'Mo' },
  { num: 2, label: 'Di' },
  { num: 3, label: 'Mi' },
  { num: 4, label: 'Do' },
  { num: 5, label: 'Fr' },
  { num: 6, label: 'Sa' },
  { num: 7, label: 'So' },
];

const WD_MAP: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

// Current weekday (1–7) and minutes-since-midnight in Europe/Berlin, regardless
// of the device's own timezone.
function berlinParts(at: Date): { weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(at);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  let hour = parseInt(map.hour, 10);
  if (hour === 24) hour = 0; // some engines emit "24" at midnight
  return { weekday: WD_MAP[map.weekday] ?? 1, minutes: hour * 60 + parseInt(map.minute, 10) };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// Does a single category's own window allow `weekday` / `minutes`? (no cascade)
function ownRuleAllows(cat: Category, weekday: number, minutes: number): boolean {
  const days = cat.avail_days ? cat.avail_days.split(',').map(Number) : null;
  const dayOk = (wd: number) => (days ? days.includes(wd) : true);
  const prevDay = (wd: number) => (wd === 1 ? 7 : wd - 1);

  const start = cat.avail_start ? toMinutes(cat.avail_start) : null;
  const end = cat.avail_end ? toMinutes(cat.avail_end) : null;

  if (start !== null && end !== null && start > end) {
    // Window wraps past midnight (e.g. 22:00–02:00). The evening segment
    // [start, 24:00) belongs to today; the morning segment [0, end) belongs to
    // the day the window *opened* — so the selected weekday is checked against
    // yesterday for those early hours.
    if (minutes >= start) return dayOk(weekday);
    if (minutes < end) return dayOk(prevDay(weekday));
    return false;
  }

  // Same-day window / open-ended bounds: the selected weekday is today.
  if (!dayOk(weekday)) return false;
  if (start !== null && minutes < start) return false;
  if (end !== null && minutes >= end) return false;
  return true;
}

// True when the category (and every ancestor) is within its availability window
// right now. Categories with no window set are always available.
export function isCategoryAvailableNow(
  catId: number,
  byId: Map<number, Category>,
  at: Date = new Date(),
): boolean {
  const { weekday, minutes } = berlinParts(at);
  let cur = byId.get(catId);
  const seen = new Set<number>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (!ownRuleAllows(cur, weekday, minutes)) return false;
    cur = cur.parent_id != null ? byId.get(cur.parent_id) : undefined;
  }
  return true;
}

// True if the category has any availability window configured.
export function hasAvailabilityWindow(cat: Category): boolean {
  return !!(cat.avail_days || cat.avail_start || cat.avail_end);
}

// Compact human label like "Di–Fr · 11:30–15:00" for the menu admin.
export function formatAvailability(cat: Category): string | null {
  if (!hasAvailabilityWindow(cat)) return null;
  const parts: string[] = [];
  if (cat.avail_days) {
    const days = cat.avail_days.split(',').map(Number).sort((a, b) => a - b);
    const labels = WEEKDAYS.reduce<Record<number, string>>((acc, w) => { acc[w.num] = w.label; return acc; }, {});
    // Collapse a contiguous run (e.g. 2,3,4,5 → "Di–Fr"); otherwise list them.
    const contiguous = days.every((d, i) => i === 0 || d === days[i - 1] + 1);
    parts.push(contiguous && days.length > 1
      ? `${labels[days[0]]}–${labels[days[days.length - 1]]}`
      : days.map(d => labels[d]).join(', '));
  }
  if (cat.avail_start || cat.avail_end) {
    parts.push(`${cat.avail_start ?? '00:00'}–${cat.avail_end ?? '24:00'}`);
  }
  return parts.join(' · ');
}
