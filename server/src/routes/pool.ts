import { Router } from 'express';
import type { Request, Response } from 'express';
import type { TableType } from '@downtown/shared';
import db from '../db/client';
import { buildTab, logEvent } from '../db/helpers';
import { broadcast } from '../ws/server';
import { startTicker, stopTicker } from '../ws/ticker';
import { getSetting, poolRateAt, runningCostCents } from '../services/poolPricing';

const router = Router();

interface SessionRow {
  id: number; tab_id: number; pool_table_id: number; started_at: string;
  ended_at: string | null; hourly_rate_snapshot_cents: number;
  computed_cost_cents: number | null; line_item_id: number | null; created_at: string;
  prepaid_cents: number;
  tab_customer_name?: string;
}

function getTableWithSession(tableId: number) {
  const table = db.prepare('SELECT * FROM pool_tables WHERE id = ?').get(tableId) as any;
  if (!table) return null;

  const sessionRow = db.prepare(`
    SELECT bs.*, t.customer_name as tab_customer_name
    FROM billiard_sessions bs
    JOIN tabs t ON bs.tab_id = t.id
    WHERE bs.pool_table_id = ? AND bs.ended_at IS NULL
  `).get(tableId) as SessionRow | undefined;

  const active_session = sessionRow
    ? { ...sessionRow, tab: { id: sessionRow.tab_id, customer_name: sessionRow.tab_customer_name! } }
    : null;

  return { ...table, active_session };
}

// GET /api/pool
router.get('/', (_req: Request, res: Response) => {
  const tables = db.prepare('SELECT * FROM pool_tables ORDER BY id ASC').all() as any[];
  res.json(tables.map(t => getTableWithSession(t.id)));
});

// POST /api/pool/:tableId/start
router.post('/:tableId/start', (req: Request, res: Response) => {
  const tableId = Number(req.params.tableId);
  const { tab_id } = req.body;

  const table = db.prepare('SELECT * FROM pool_tables WHERE id = ?').get(tableId) as any;
  if (!table) return void res.status(404).json({ error: 'table not found' });
  if (table.status !== 'free') return void res.status(409).json({ error: 'table already in use' });

  const tab = db.prepare("SELECT id FROM tabs WHERE id = ? AND status = 'open'").get(tab_id);
  if (!tab) return void res.status(404).json({ error: 'tab not found or not open' });

  let hourlyRateCents: number;
  if (table.type === 'dart') {
    hourlyRateCents = getSetting('dart_hourly_rate_cents', 800);
  } else {
    hourlyRateCents = poolRateAt(
      new Date(),
      getSetting('pool_rate_standard_cents', 1200),
      getSetting('pool_rate_peak_cents', 1600),
      getSetting('pool_rate_daytime_discount_cents', 400),
    );
  }

  const now = new Date().toISOString();
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO billiard_sessions (tab_id, pool_table_id, started_at, hourly_rate_snapshot_cents, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(tab_id, tableId, now, hourlyRateCents, now);

  const sessionId = Number(lastInsertRowid);
  db.prepare("UPDATE pool_tables SET status = 'in_use' WHERE id = ?").run(tableId);
  logEvent('billiard_started', tab_id, { session_id: sessionId, table_id: tableId });

  startTicker(sessionId, tableId, new Date(now), hourlyRateCents);

  const result = getTableWithSession(tableId);
  broadcast({ type: 'pool:session_started', data: result });
  const updatedTab = buildTab(tab_id);
  if (updatedTab) broadcast({ type: 'tab:updated', data: updatedTab });
  res.json(result);
});

// POST /api/pool/:tableId/stop
router.post('/:tableId/stop', (req: Request, res: Response) => {
  const tableId = Number(req.params.tableId);

  const session = db.prepare(
    'SELECT * FROM billiard_sessions WHERE pool_table_id = ? AND ended_at IS NULL'
  ).get(tableId) as SessionRow | undefined;

  if (!session) return void res.status(404).json({ error: 'no active session on this table' });

  const now = new Date();
  const nowIso = now.toISOString();
  const tableRow = db.prepare('SELECT label, type FROM pool_tables WHERE id = ?').get(tableId) as any;
  const costCents = runningCostCents(
    (tableRow?.type ?? 'billiard') as TableType,
    new Date(session.started_at), session.hourly_rate_snapshot_cents, now,
  );

  stopTicker(session.id);

  db.prepare('UPDATE billiard_sessions SET ended_at = ?, computed_cost_cents = ? WHERE id = ?')
    .run(nowIso, costCents, session.id);

  const activityName = tableRow?.type === 'dart' ? 'Dart' : 'Billard';
  const nameSnapshot = activityName;

  // Anything paid while the table was still running is credited here, so the tab
  // only gets billed the remainder. computed_cost_cents stays the full cost —
  // the gap between it and the line item is what the receipt shows as prepaid.
  const prepaid = session.prepaid_cents ?? 0;
  const dueCents = Math.max(0, costCents - prepaid);

  const { lastInsertRowid } = db.prepare(`
    INSERT INTO line_items
      (tab_id, product_id, name_snapshot, price_snapshot_cents, tax_category_snapshot, quantity, kind, created_at)
    VALUES (?, NULL, ?, ?, 'standard', 1, 'billiard', ?)
  `).run(session.tab_id, nameSnapshot, dueCents, nowIso);

  const lineItemId = Number(lastInsertRowid);
  db.prepare('UPDATE billiard_sessions SET line_item_id = ? WHERE id = ?').run(lineItemId, session.id);
  db.prepare("UPDATE pool_tables SET status = 'free' WHERE id = ?").run(tableId);

  logEvent('billiard_stopped', session.tab_id, {
    session_id: session.id, table_id: tableId, cost_cents: costCents,
    prepaid_cents: prepaid, due_cents: dueCents,
  });

  const result = getTableWithSession(tableId);
  broadcast({ type: 'pool:session_stopped', data: result });

  const updatedTab = buildTab(session.tab_id);
  if (updatedTab) broadcast({ type: 'tab:updated', data: updatedTab });

  res.json(result);
});

// POST /api/pool/:tableId/reopen  — undo a stop: removes line item, restarts ticker
router.post('/:tableId/reopen', (req: Request, res: Response) => {
  const tableId = Number(req.params.tableId);

  const session = db.prepare(
    'SELECT * FROM billiard_sessions WHERE pool_table_id = ? AND ended_at IS NOT NULL ORDER BY ended_at DESC LIMIT 1'
  ).get(tableId) as SessionRow | undefined;

  if (!session) return void res.status(404).json({ error: 'no stopped session found' });

  const tab = db.prepare("SELECT id FROM tabs WHERE id = ? AND status = 'open'").get(session.tab_id);
  if (!tab) return void res.status(409).json({ error: 'tab is already closed' });

  db.prepare('UPDATE billiard_sessions SET ended_at = NULL, computed_cost_cents = NULL, line_item_id = NULL WHERE id = ?')
    .run(session.id);

  if (session.line_item_id) {
    db.prepare('DELETE FROM line_items WHERE id = ?').run(session.line_item_id);
  }
  db.prepare("UPDATE pool_tables SET status = 'in_use' WHERE id = ?").run(tableId);

  startTicker(session.id, tableId, new Date(session.started_at), session.hourly_rate_snapshot_cents);

  const result = getTableWithSession(tableId);
  broadcast({ type: 'pool:session_started', data: result });

  const updatedTab = buildTab(session.tab_id);
  if (updatedTab) broadcast({ type: 'tab:updated', data: updatedTab });

  res.json(result);
});

// POST /api/pool/:tableId/cancel  — undo a start: ends session without charging
router.post('/:tableId/cancel', (req: Request, res: Response) => {
  const tableId = Number(req.params.tableId);

  const session = db.prepare(
    'SELECT * FROM billiard_sessions WHERE pool_table_id = ? AND ended_at IS NULL'
  ).get(tableId) as SessionRow | undefined;

  if (!session) return void res.status(404).json({ error: 'no active session on this table' });
  // Cancel writes the session off at 0 €. If part of it is already paid there's
  // nothing to undo it against — stop the table instead so the payment lands on
  // a line item.
  if (session.prepaid_cents > 0) {
    return void res.status(409).json({ error: 'session is already partly paid — stop it instead of cancelling' });
  }

  stopTicker(session.id);
  db.prepare('UPDATE billiard_sessions SET ended_at = ?, computed_cost_cents = 0 WHERE id = ?')
    .run(new Date().toISOString(), session.id);
  db.prepare("UPDATE pool_tables SET status = 'free' WHERE id = ?").run(tableId);

  const result = getTableWithSession(tableId);
  broadcast({ type: 'pool:session_stopped', data: result });
  const cancelledTab = buildTab(session.tab_id);
  if (cancelledTab) broadcast({ type: 'tab:updated', data: cancelledTab });
  res.json(result);
});

// PATCH /api/pool/:tableId/session/start  — adjust start time of active session
router.patch('/:tableId/session/start', (req: Request, res: Response) => {
  const tableId = Number(req.params.tableId);
  const { started_at_berlin } = req.body as { started_at_berlin?: string };

  if (!started_at_berlin || !/^\d{2}:\d{2}$/.test(started_at_berlin)) {
    return void res.status(400).json({ error: 'expected started_at_berlin as HH:MM' });
  }

  const session = db.prepare(
    'SELECT * FROM billiard_sessions WHERE pool_table_id = ? AND ended_at IS NULL'
  ).get(tableId) as SessionRow | undefined;
  if (!session) return void res.status(404).json({ error: 'no active session on this table' });

  const [hh, mm] = started_at_berlin.split(':').map(Number);
  const now = new Date();

  // Resolve HH:MM in Berlin to UTC, using today; if that's in the future use yesterday
  function resolveUTC(dayOffset: number): Date {
    const ref = new Date(now.getTime() - dayOffset * 86_400_000);
    const [y, mo, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' })
      .format(ref).split('-').map(Number);
    const moS = String(mo).padStart(2,'0'), dS = String(d).padStart(2,'0');
    const hhS = String(hh).padStart(2,'0'), mmS = String(mm).padStart(2,'0');
    const guess = new Date(`${y}-${moS}-${dS}T${hhS}:${mmS}:00+01:00`);
    const actual = parseInt(new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Berlin', hour: 'numeric', hourCycle: 'h23',
    }).format(guess), 10);
    return new Date(guess.getTime() - (actual - hh) * 3_600_000);
  }

  let newStart = resolveUTC(0);
  if (newStart >= now) newStart = resolveUTC(1);
  if (newStart >= now) return void res.status(400).json({ error: 'start time is in the future' });

  const newStartIso = newStart.toISOString();
  db.prepare('UPDATE billiard_sessions SET started_at = ? WHERE id = ?').run(newStartIso, session.id);
  logEvent('billiard_start_adjusted', session.tab_id, {
    session_id: session.id, table_id: tableId,
    old_started_at: session.started_at, new_started_at: newStartIso,
  });

  stopTicker(session.id);
  startTicker(session.id, tableId, newStart, session.hourly_rate_snapshot_cents);

  const result = getTableWithSession(tableId);
  broadcast({ type: 'pool:session_started', data: result });
  res.json(result);
});

// GET /api/pool/:tableId/history
router.get('/:tableId/history', (req: Request, res: Response) => {
  const tableId = Number(req.params.tableId);
  const rows = db.prepare(`
    SELECT bs.id, bs.tab_id, t.customer_name AS tab_customer_name,
           bs.started_at, bs.ended_at, bs.computed_cost_cents
    FROM billiard_sessions bs
    JOIN tabs t ON bs.tab_id = t.id
    WHERE bs.pool_table_id = ? AND bs.line_item_id IS NOT NULL
    ORDER BY bs.ended_at DESC
    LIMIT 50
  `).all(tableId);
  res.json(rows);
});

export default router;
