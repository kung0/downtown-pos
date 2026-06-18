import { Router } from 'express';
import type { Request, Response } from 'express';
import db from '../db/client';
import { buildTab } from '../db/helpers';
import { buildReceipt, buildTestPage, buildOrderTicket } from '../printer/escpos';
import { sendToPrinter, pingPrinter } from '../printer/client';

const router = Router();

function getPrinterIp(): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'printer_ip'").get() as { value: string } | undefined;
  return row?.value?.trim() || null;
}

// GET /api/printer/status
router.get('/status', async (_req: Request, res: Response) => {
  const ip = getPrinterIp();
  if (!ip) return void res.json({ configured: false, online: false });

  const online = await pingPrinter(ip);
  res.json({ configured: true, ip, online });
});

// POST /api/printer/test
router.post('/test', async (_req: Request, res: Response) => {
  const ip = getPrinterIp();
  if (!ip) return void res.status(400).json({ error: 'no printer IP configured' });

  try {
    await sendToPrinter(ip, buildTestPage());
    res.json({ ok: true });
  } catch (e: any) {
    res.status(502).json({ error: e.message });
  }
});

// POST /api/printer/receipt/:tabId
router.post('/receipt/:tabId', async (req: Request, res: Response) => {
  const ip = getPrinterIp();
  if (!ip) return void res.status(400).json({ error: 'no printer IP configured' });

  const tab = buildTab(Number(req.params.tabId));
  if (!tab) return void res.status(404).json({ error: 'tab not found' });
  if (tab.status === 'open') return void res.status(400).json({ error: 'tab is still open' });

  const bewirtung = req.body?.bewirtung === true;

  try {
    await sendToPrinter(ip, buildReceipt(tab, { bewirtung }));
    res.json({ ok: true });
  } catch (e: any) {
    res.status(502).json({ error: e.message });
  }
});

// POST /api/printer/order — kitchen/bar order ticket for newly added items
router.post('/order', async (req: Request, res: Response) => {
  const ip = getPrinterIp();
  if (!ip) return void res.status(400).json({ error: 'no printer IP configured' });

  const { customer_name, items } = req.body ?? {};
  if (typeof customer_name !== 'string' || !customer_name.trim()) {
    return void res.status(400).json({ error: 'customer_name is required' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return void res.status(400).json({ error: 'items must be a non-empty array' });
  }

  const lines = items.map((i: any) => ({
    name: String(i.name ?? ''),
    quantity: Math.max(1, Math.floor(Number(i.quantity) || 1)),
    note: i.note ? String(i.note) : null,
  }));

  try {
    await sendToPrinter(ip, buildOrderTicket({ customer_name: customer_name.trim(), items: lines }));
    res.json({ ok: true });
  } catch (e: any) {
    res.status(502).json({ error: e.message });
  }
});

export default router;
