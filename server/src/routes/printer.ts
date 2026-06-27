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

// Map each category name to its ancestor chain, most specific first:
// [ownId, parentId, …, rootId]. Routing walks this chain and picks the most
// specific order printer that claims any id in it, so assigning a subcategory
// to a printer overrides whatever its parent is assigned to.
function buildCategoryChainMap(): Map<string, number[]> {
  const rows = db.prepare('SELECT id, name, parent_id FROM categories').all() as { id: number; name: string; parent_id: number | null }[];
  const byId = new Map(rows.map(r => [r.id, r]));
  const map = new Map<string, number[]>();
  for (const row of rows) {
    const chain: number[] = [];
    const seen = new Set<number>();
    let cur: typeof row | undefined = row;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      chain.push(cur.id);
      cur = cur.parent_id !== null ? byId.get(cur.parent_id) : undefined;
    }
    map.set(row.name, chain);
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

  // Build category name → ancestor chain map for routing
  const catChainMap = buildCategoryChainMap();

  // Group items by which order printer handles them. For each item we walk its
  // category chain from most specific (own category) to least specific (root)
  // and pick the first printer that claims a category in the chain — so a
  // subcategory assignment overrides its parent. Items with no match go to the
  // fallback (receipt printer) bucket.
  const buckets = new Map<string, typeof lines>(); // key = printer id | '__fallback__'
  for (const line of lines) {
    const chain = line.category_name ? catChainMap.get(line.category_name) : undefined;
    let matched: typeof orderPrinters[number] | undefined;
    if (chain) {
      for (const catId of chain) {
        matched = orderPrinters.find(p => p.category_ids.includes(catId));
        if (matched) break;
      }
    }
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
