import { Router } from 'express';
import type { Request, Response } from 'express';
import db from '../db/client';
import { buildTab } from '../db/helpers';
import { buildReceipt, buildTestPage } from '../printer/escpos';
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

  try {
    await sendToPrinter(ip, buildReceipt(tab));
    res.json({ ok: true });
  } catch (e: any) {
    res.status(502).json({ error: e.message });
  }
});

export default router;
