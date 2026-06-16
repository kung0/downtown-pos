import { Router } from 'express';
import type { Request, Response } from 'express';
import db from '../db/client';
import { broadcast } from '../ws/server';

const router = Router();

function activeList() {
  const rows = db.prepare(`
    SELECT w.*, t.customer_name as tab_customer_name
    FROM waitlist w
    LEFT JOIN tabs t ON w.tab_id = t.id
    WHERE w.status IN ('waiting', 'called')
    ORDER BY w.sort_order ASC, w.id ASC
  `).all() as any[];

  return rows.map(r => ({
    id: r.id,
    pager_number: r.pager_number,
    notes: r.notes,
    status: r.status,
    type: r.type,
    sort_order: r.sort_order,
    tab_id: r.tab_id,
    tab: r.tab_id ? { id: r.tab_id, customer_name: r.tab_customer_name } : undefined,
    created_at: r.created_at,
    called_at: r.called_at,
  }));
}

function broadcastList() {
  broadcast({ type: 'waitlist:updated', data: activeList() });
}

// GET /api/waitlist
router.get('/', (_req: Request, res: Response) => {
  res.json(activeList());
});

// POST /api/waitlist
router.post('/', (req: Request, res: Response) => {
  const { pager_number, tab_id, type = 'billiard', notes } = req.body;

  if (!pager_number?.toString().trim()) {
    return void res.status(400).json({ error: 'pager_number is required' });
  }
  if (!tab_id) {
    return void res.status(400).json({ error: 'tab_id is required' });
  }
  if (!['billiard', 'dart'].includes(type)) {
    return void res.status(400).json({ error: 'type must be billiard or dart' });
  }

  const tab = db.prepare("SELECT id FROM tabs WHERE id = ? AND status = 'open'").get(tab_id);
  if (!tab) return void res.status(404).json({ error: 'tab not found or not open' });

  const now = new Date().toISOString();
  const maxRow = db.prepare(
    "SELECT COALESCE(MAX(sort_order), -1) as m FROM waitlist WHERE type = ? AND status IN ('waiting', 'called')"
  ).get(type) as { m: number };
  const sort_order = maxRow.m + 1;

  db.prepare(
    'INSERT INTO waitlist (pager_number, tab_id, type, notes, status, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(pager_number.toString().trim(), tab_id, type, notes?.trim() || null, 'waiting', sort_order, now);

  broadcastList();
  res.status(201).json(activeList());
});

// PATCH /api/waitlist/:id/move
router.patch('/:id/move', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { direction } = req.body as { direction: 'up' | 'down' };

  if (!['up', 'down'].includes(direction)) {
    return void res.status(400).json({ error: 'direction must be up or down' });
  }

  const entry = db.prepare(
    "SELECT id, type FROM waitlist WHERE id = ? AND status IN ('waiting', 'called')"
  ).get(id) as { id: number; type: string } | undefined;
  if (!entry) return void res.status(404).json({ error: 'not found' });

  const entries = db.prepare(
    "SELECT id FROM waitlist WHERE type = ? AND status IN ('waiting', 'called') ORDER BY sort_order ASC, id ASC"
  ).all(entry.type) as { id: number }[];

  const idx = entries.findIndex(e => e.id === id);
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;

  if (swapIdx < 0 || swapIdx >= entries.length) {
    return void res.json(activeList());
  }

  [entries[idx], entries[swapIdx]] = [entries[swapIdx], entries[idx]];

  const updateStmt = db.prepare('UPDATE waitlist SET sort_order = ? WHERE id = ?');
  db.transaction(() => {
    entries.forEach((e, i) => updateStmt.run(i, e.id));
  })();

  broadcastList();
  res.json(activeList());
});

// PATCH /api/waitlist/:id/restore
router.patch('/:id/restore', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const entry = db.prepare("SELECT id FROM waitlist WHERE id = ? AND status = 'seated'").get(id);
  if (!entry) return void res.status(404).json({ error: 'not found or not seated' });
  db.prepare("UPDATE waitlist SET status = 'waiting', resolved_at = NULL WHERE id = ?").run(id);
  broadcastList();
  res.json(activeList());
});

// PATCH /api/waitlist/:id/call
router.patch('/:id/call', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const entry = db.prepare('SELECT id FROM waitlist WHERE id = ?').get(id);
  if (!entry) return void res.status(404).json({ error: 'not found' });

  db.prepare("UPDATE waitlist SET status = 'called', called_at = ? WHERE id = ?")
    .run(new Date().toISOString(), id);
  broadcastList();
  res.json(activeList());
});

// DELETE /api/waitlist/:id
router.delete('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  db.prepare("UPDATE waitlist SET status = 'seated', resolved_at = ? WHERE id = ?")
    .run(new Date().toISOString(), id);
  broadcastList();
  res.json(activeList());
});

export default router;
