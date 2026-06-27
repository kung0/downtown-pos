import { Router } from 'express';
import type { Request, Response } from 'express';
import db from '../db/client';
import { summarizeClosedTabs } from '../db/helpers';
import { buildShiftReport } from '../printer/escpos';
import { sendToPrinter } from '../printer/client';

const router = Router();

function buildSummary(sessionRow: any) {
  const closed = db.prepare(
    "SELECT * FROM tabs WHERE session_id = ? AND status = 'closed'"
  ).all(sessionRow.id) as any[];

  return { session: sessionRow, ...summarizeClosedTabs(closed) };
}

// GET /api/sessions — all sessions, newest first
router.get('/', (_req: Request, res: Response) => {
  const rows = db.prepare('SELECT * FROM sessions ORDER BY id DESC').all();
  res.json(rows);
});

// GET /api/sessions/current
router.get('/current', (_req: Request, res: Response) => {
  const session = db.prepare("SELECT * FROM sessions WHERE status = 'open' ORDER BY id DESC LIMIT 1").get() as any;
  res.json(session ?? null);
});

// POST /api/sessions — open a new shift
router.post('/', (_req: Request, res: Response) => {
  const existing = db.prepare("SELECT id FROM sessions WHERE status = 'open'").get();
  if (existing) {
    return void res.status(409).json({ error: 'a shift is already open' });
  }
  const now = new Date().toISOString();
  const { lastInsertRowid } = db.prepare(
    "INSERT INTO sessions (status, opened_at) VALUES ('open', ?)"
  ).run(now);
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(Number(lastInsertRowid));
  res.status(201).json(session);
});

// POST /api/sessions/:id/close — close shift, return summary
router.post('/:id/close', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as any;
  if (!session) return void res.status(404).json({ error: 'session not found' });
  if (session.status === 'closed') return void res.status(409).json({ error: 'session already closed' });

  const unparked = db.prepare(
    "SELECT id, customer_name FROM tabs WHERE session_id = ? AND status = 'open' AND parked = 0"
  ).all(id) as Array<{ id: number; customer_name: string }>;
  if (unparked.length > 0) {
    return void res.status(409).json({
      error: 'open_tabs',
      message: 'Alle offenen Tabs müssen zuerst geparkt werden.',
      tabs: unparked,
    });
  }

  const now = new Date().toISOString();
  db.prepare("UPDATE sessions SET status = 'closed', closed_at = ? WHERE id = ?").run(now, id);
  const updated = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as any;
  const summary = buildSummary(updated);
  res.json(summary);

  // auto-print shift report (fire and forget — don't block the response)
  const printerRow = db.prepare("SELECT value FROM settings WHERE key = 'printer_ip'").get() as { value: string } | undefined;
  const printerIp = printerRow?.value?.trim();
  if (printerIp) {
    sendToPrinter(printerIp, buildShiftReport(summary)).catch(() => {});
  }
});

// GET /api/sessions/:id/summary — summary for any session
router.get('/:id/summary', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as any;
  if (!session) return void res.status(404).json({ error: 'session not found' });
  res.json(buildSummary(session));
});

export default router;
