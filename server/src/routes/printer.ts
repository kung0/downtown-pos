import { Router } from 'express';
import type { Request, Response } from 'express';
import db from '../db/client';
import { buildTab } from '../db/helpers';
import { buildReceipt, buildTestPage, buildOrderTicket } from '../printer/escpos';
import { sendToPrinter, pingPrinter } from '../printer/client';
import { getSettings } from './settings';

const router = Router();

function getPrinterIp(): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'printer_ip'").get() as { value: string } | undefined;
  return row?.value?.trim() || null;
}

// Build a map from category name → top-level (parent_id = NULL) category id
function buildCategoryParentMap(): Map<string, number> {
  const rows = db.prepare('SELECT id, name, parent_id FROM categories').all() as { id: number; name: string; parent_id: number | null }[];
  const byId = new Map(rows.map(r => [r.id, r]));
  const map = new Map<string, number>();
  for (const row of rows) {
    // Walk up to find the root
    let cur = row;
    while (cur.parent_id !== null) {
      const parent = byId.get(cur.parent_id);
      if (!parent) break;
      cur = parent;
    }
    map.set(row.name, cur.id);
  }
  return map;
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
// Items are routed to configured order printers by category; unmatched items
// fall back to the receipt printer. If no order printers are configured,
// all items go to the receipt printer (backward-compatible).
router.post('/order', async (req: Request, res: Response) => {
  const receiptIp = getPrinterIp();

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
    category_name: i.category_name ? String(i.category_name) : null,
  }));

  const settings = getSettings();
  const orderPrinters = settings.printer_order_printers ?? [];

  // No order printers configured → send everything to receipt printer
  if (orderPrinters.length === 0) {
    if (!receiptIp) return void res.status(400).json({ error: 'no printer IP configured' });
    try {
      await sendToPrinter(receiptIp, buildOrderTicket({ customer_name: customer_name.trim(), items: lines }));
      return void res.json({ ok: true });
    } catch (e: any) {
      return void res.status(502).json({ error: e.message });
    }
  }

  // Build category → top-level id map for routing
  const catParentMap = buildCategoryParentMap();

  // Group items by which order printer handles them (first match wins);
  // items with no match go to the fallback (receipt printer) bucket.
  const buckets = new Map<string, typeof lines>(); // key = printer id | '__fallback__'
  for (const line of lines) {
    const topLevelId = line.category_name ? catParentMap.get(line.category_name) : undefined;
    const matched = topLevelId !== undefined
      ? orderPrinters.find(p => p.category_ids.includes(topLevelId))
      : undefined;
    const key = matched ? matched.id : '__fallback__';
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(line);
  }

  const errors: string[] = [];

  for (const [key, group] of buckets) {
    if (group.length === 0) continue;
    let ip: string | null;
    if (key === '__fallback__') {
      ip = receiptIp;
    } else {
      ip = orderPrinters.find(p => p.id === key)?.ip?.trim() || null;
    }
    if (!ip) {
      errors.push(`no IP for printer ${key}`);
      continue;
    }
    try {
      await sendToPrinter(ip, buildOrderTicket({ customer_name: customer_name.trim(), items: group }));
    } catch (e: any) {
      errors.push(e.message);
    }
  }

  if (errors.length > 0) {
    return void res.status(502).json({ error: errors.join('; ') });
  }
  res.json({ ok: true });
});

export default router;
