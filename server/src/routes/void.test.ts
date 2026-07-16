import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import express from 'express';
import type { AddressInfo } from 'net';

// Real SQLite, in memory — the void logic is mostly SQL, so mocking it away
// would test nothing. Everything outside the DB (WS, TSE, printer) is stubbed.
const db = new Database(':memory:');
vi.mock('../db/client', () => ({ default: db }));
vi.mock('../ws/server', () => ({ broadcast: vi.fn() }));
vi.mock('../services/tse', () => ({ signOrOffline: vi.fn(async () => ({ tse: null })) }));
vi.mock('../printer/escpos', () => ({ buildReceipt: () => Buffer.from('') }));
vi.mock('../printer/client', () => ({ sendToPrinter: vi.fn(async () => {}) }));

const { initSchema } = await import('../db/schema');
const { summarizeClosedTabs } = await import('../db/helpers');
const tabsRouter = (await import('./tabs')).default;

const app = express();
app.use(express.json());
app.use('/api/tabs', tabsRouter);
const server = app.listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

async function voidTab(id: number, reason: unknown) {
  const res = await fetch(`${base}/api/tabs/${id}/void`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
  return { status: res.status, body: await res.json() };
}

const now = '2026-07-16T20:00:00.000Z';

// A closed cash sale: 2× beer @ 4,00 (19%) + 1× fries @ 3,00 (7%), 1,00 tip.
function seedClosedTab(sessionId: number | null): number {
  const { lastInsertRowid } = db.prepare(
    "INSERT INTO tabs (customer_name, status, opened_at, closed_at, payment_method, subtotal_cents, discount_cents, tax_cents, tax_standard_cents, tax_reduced_cents, subtotal_standard_cents, subtotal_reduced_cents, tip_cents, total_cents, session_id) VALUES (?, 'closed', ?, ?, 'cash', 1100, 0, 324, 128, 196, 800, 300, 100, 1200, ?)"
  ).run('Lukas + friends', now, now, sessionId);
  const tabId = Number(lastInsertRowid);
  const insItem = db.prepare(
    "INSERT INTO line_items (tab_id, product_id, name_snapshot, price_snapshot_cents, tax_category_snapshot, quantity, kind, created_at) VALUES (?, NULL, ?, ?, ?, ?, 'product', ?)"
  );
  insItem.run(tabId, 'Pils', 400, 'standard', 2, now);
  insItem.run(tabId, 'Pommes', 300, 'reduced', 1, now);
  return tabId;
}

function openShift(): number {
  const { lastInsertRowid } = db.prepare(
    "INSERT INTO sessions (status, opened_at) VALUES ('open', ?)"
  ).run(now);
  return Number(lastInsertRowid);
}

beforeEach(() => {
  db.exec('PRAGMA foreign_keys = OFF');
  for (const t of ['line_items', 'events', 'tabs', 'sessions']) db.exec(`DELETE FROM ${t}`);
});

initSchema();

describe('POST /api/tabs/:id/void', () => {
  it('leaves the original tab completely untouched', async () => {
    const shift = openShift();
    const origId = seedClosedTab(shift);
    const before = db.prepare('SELECT * FROM tabs WHERE id = ?').get(origId);

    const { status } = await voidTab(origId, 'Falsch gebucht');

    expect(status).toBe(201);
    expect(db.prepare('SELECT * FROM tabs WHERE id = ?').get(origId)).toEqual(before);
  });

  it('books a negated Storno that references the original', async () => {
    const shift = openShift();
    const origId = seedClosedTab(shift);

    const { body: storno } = await voidTab(origId, 'Falsch gebucht');

    expect(storno.status).toBe('voided');
    expect(storno.original_tab_id).toBe(origId);
    expect(storno.void_reason).toBe('Falsch gebucht');
    expect(storno.voided_at).toBeTruthy();
    expect(storno.session_id).toBe(shift);
    expect(storno.total_cents).toBe(-1200);
    expect(storno.subtotal_cents).toBe(-1100);
    expect(storno.tip_cents).toBe(-100);
    expect(storno.tax_standard_cents).toBe(-128);
    expect(storno.tax_reduced_cents).toBe(-196);
    // Quantities negate too, so unit counts net out — not just revenue.
    expect(storno.items.map((i: any) => [i.name_snapshot, i.quantity, i.price_snapshot_cents]))
      .toEqual([['Pils', -2, 400], ['Pommes', -1, 300]]);
  });

  it('nets the sale to zero in the shift report, and drops it from the counts', async () => {
    const shift = openShift();
    const origId = seedClosedTab(shift);
    await voidTab(origId, 'Falsch gebucht');

    const rows = db.prepare("SELECT * FROM tabs WHERE status IN ('closed', 'voided')").all();
    const summary = summarizeClosedTabs(rows);

    expect(summary.total_cents).toBe(0);
    expect(summary.tip_cents).toBe(0);
    expect(summary.tax_cents).toBe(0);
    expect(summary.tab_count).toBe(0);
  });

  it('logs the void on both the Storno and the original trail', async () => {
    const shift = openShift();
    const origId = seedClosedTab(shift);
    const { body: storno } = await voidTab(origId, 'Falsch gebucht');

    const origEvents = db.prepare("SELECT * FROM events WHERE tab_id = ? AND event_type = 'tab_voided'").all(origId) as any[];
    const stornoEvents = db.prepare("SELECT * FROM events WHERE tab_id = ? AND event_type = 'tab_voided'").all(storno.id) as any[];

    expect(JSON.parse(origEvents[0].payload).storno_tab_id).toBe(storno.id);
    expect(JSON.parse(stornoEvents[0].payload).original_tab_id).toBe(origId);
  });

  it('refuses to void the same tab twice', async () => {
    const shift = openShift();
    const origId = seedClosedTab(shift);
    await voidTab(origId, 'Falsch gebucht');

    const second = await voidTab(origId, 'Nochmal');

    expect(second.status).toBe(409);
    expect(db.prepare("SELECT COUNT(*) c FROM tabs WHERE status = 'voided'").get()).toEqual({ c: 1 });
  });

  it('rejects an empty reason, an open tab, and a tab from another shift', async () => {
    const shift = openShift();
    const closedId = seedClosedTab(shift);
    expect((await voidTab(closedId, '   ')).status).toBe(400);

    const { lastInsertRowid } = db.prepare(
      "INSERT INTO tabs (customer_name, status, opened_at, tip_cents, session_id) VALUES ('Maria', 'open', ?, 0, ?)"
    ).run(now, shift);
    expect((await voidTab(Number(lastInsertRowid), 'Grund')).status).toBe(400);

    const otherShiftTab = seedClosedTab(shift + 99);
    expect((await voidTab(otherShiftTab, 'Grund')).status).toBe(409);

    expect((await voidTab(9999, 'Grund')).status).toBe(404);
    expect(db.prepare("SELECT COUNT(*) c FROM tabs WHERE status = 'voided'").get()).toEqual({ c: 0 });
  });

  it('refuses to void when no shift is open', async () => {
    const origId = seedClosedTab(1);
    expect((await voidTab(origId, 'Grund')).status).toBe(403);
  });
});
