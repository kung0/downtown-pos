import { Router } from 'express';
import type { Request, Response } from 'express';
import db from '../db/client';
import { buildTab, logEvent, computeTaxBreakdown, writeClose } from '../db/helpers';
import { broadcast } from '../ws/server';
import { signOrOffline } from '../services/tse';

const router = Router();

function getActiveSessionId(): number | null {
  const row = db.prepare("SELECT id FROM sessions WHERE status = 'open' ORDER BY id DESC LIMIT 1").get() as any;
  return row?.id ?? null;
}

// GET /api/tabs — all open tabs with items and running total
router.get('/', (_req: Request, res: Response) => {
  const tabRows = db.prepare(
    "SELECT * FROM tabs WHERE status = 'open' ORDER BY opened_at ASC"
  ).all() as any[];

  if (tabRows.length === 0) return void res.json([]);

  const ids = tabRows.map((t: any) => t.id);
  const allItems = db.prepare(
    `SELECT * FROM line_items WHERE tab_id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at ASC`
  ).all(...ids) as any[];

  const tabs = tabRows.map((row: any) => {
    const items = allItems.filter((i: any) => i.tab_id === row.id);
    const running_total_cents = items.reduce((sum: number, i: any) => sum + i.price_snapshot_cents * i.quantity, 0);
    return { ...row, items, running_total_cents };
  });

  res.json(tabs);
});

// POST /api/tabs/quick-pay — pay immediately without keeping a tab open
router.post('/quick-pay', async (req: Request, res: Response) => {
  const { items, payment_method, tip_cents = 0, card_auth_code = null, card_masked_pan = null } = req.body;

  if (!['cash', 'card'].includes(payment_method)) {
    return void res.status(400).json({ error: 'payment_method must be "cash" or "card"' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return void res.status(400).json({ error: 'items must be a non-empty array' });
  }

  const sessionId = getActiveSessionId();
  if (!sessionId) return void res.status(403).json({ error: 'no shift is open — open a shift first' });

  const tip = Math.max(0, Math.floor(Number(tip_cents)));
  const now = new Date().toISOString();
  const berlinTime = new Date().toLocaleTimeString('de-DE', {
    timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const customerName = `Walk-in · ${berlinTime}`;

  // Phase 1: resolve products and compute financials before the async TSE call
  interface ResolvedItem { product: any; qty: number; }
  const resolvedItems: ResolvedItem[] = [];

  for (const { product_id, quantity = 1 } of items as Array<{ product_id: number; quantity?: number }>) {
    const qty = Math.max(1, Math.floor(Number(quantity)));
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(product_id) as any;
    if (!product) return void res.status(404).json({ error: `product ${product_id} not found` });
    resolvedItems.push({ product, qty });
  }

  const tax = computeTaxBreakdown(resolvedItems.map(r => ({
    price_snapshot_cents: r.product.price_cents,
    quantity: r.qty,
    tax_category_snapshot: r.product.tax_category,
  })));
  const total = tax.subtotal_cents + tip;

  // Phase 2: TSE signing (async, before DB transaction)
  const { tse, error } = await signOrOffline({
    payment_method: payment_method as 'cash' | 'card',
    subtotal_standard_cents: tax.subtotal_standard_cents,
    subtotal_reduced_cents: tax.subtotal_reduced_cents,
    tip_cents: tip,
    total_cents: total,
  });
  if (error) return void res.status(502).json({ error: `TSE signing failed: ${error}` });

  // Phase 3: DB transaction (synchronous, TSE result in hand)
  const doQuickPay = db.transaction(() => {
    const { lastInsertRowid } = db.prepare(
      "INSERT INTO tabs (customer_name, status, opened_at, tip_cents, session_id) VALUES (?, 'open', ?, 0, ?)"
    ).run(customerName, now, sessionId);
    const tabId = Number(lastInsertRowid);
    logEvent('tab_opened', tabId, { customer_name: customerName });

    for (const { product, qty } of resolvedItems) {
      db.prepare(`
        INSERT INTO line_items (tab_id, product_id, name_snapshot, price_snapshot_cents, tax_category_snapshot, quantity, note, kind, created_at)
        VALUES (?, ?, ?, ?, ?, ?, NULL, 'product', ?)
      `).run(tabId, product.id, product.name, product.price_cents, product.tax_category, qty, now);
      logEvent('item_added', tabId, { product_id: product.id, name: product.name, price_cents: product.price_cents, qty });
    }

    writeClose(tabId, {
      closed_at: now, payment_method, tax, tip_cents: tip, total_cents: total,
      card_auth_code, card_masked_pan, tse,
    });

    logEvent('tab_closed', tabId, {
      payment_method, subtotal: tax.subtotal_cents, tax: tax.tax_cents, tip, total,
      tse_transaction_number: tse?.tse_transaction_number ?? null,
    });

    return tabId;
  });

  try {
    const tabId = doQuickPay();
    const closedTab = buildTab(tabId)!;
    broadcast({ type: 'tab:closed', data: closedTab });
    res.status(201).json(closedTab);
  } catch (e: any) {
    res.status(e.status ?? 500).json({ error: e.message });
  }
});

// GET /api/tabs/history — all closed + voided tabs, newest first
router.get('/history', (req: Request, res: Response) => {
  const { session_id } = req.query;

  let rows: any[];
  if (session_id) {
    rows = db.prepare(
      `SELECT * FROM tabs
       WHERE status != 'open' AND session_id = ?
       ORDER BY COALESCE(closed_at, voided_at) DESC`
    ).all(session_id) as any[];
  } else {
    rows = db.prepare(
      `SELECT * FROM tabs WHERE status != 'open'
       ORDER BY COALESCE(closed_at, voided_at) DESC LIMIT 500`
    ).all() as any[];
  }

  if (rows.length === 0) return void res.json([]);

  const ids = rows.map((t: any) => t.id);
  const allItems = db.prepare(
    `SELECT * FROM line_items WHERE tab_id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at ASC`
  ).all(...ids) as any[];

  const tabs = rows.map((row: any) => ({
    ...row,
    items: allItems.filter((i: any) => i.tab_id === row.id),
  }));

  res.json(tabs);
});

// GET /api/tabs/:id
router.get('/:id', (req: Request, res: Response) => {
  const tab = buildTab(Number(req.params.id));
  if (!tab) return void res.status(404).json({ error: 'not found' });
  res.json(tab);
});

// POST /api/tabs — open new tab
router.post('/', (req: Request, res: Response) => {
  const { customer_name, notes } = req.body;
  if (!customer_name?.trim()) return void res.status(400).json({ error: 'customer_name is required' });

  const sessionId = getActiveSessionId();
  if (!sessionId) return void res.status(403).json({ error: 'no shift is open — open a shift first' });

  const existing = db.prepare(
    "SELECT id FROM tabs WHERE customer_name = ? AND status = 'open' LIMIT 1"
  ).get(customer_name.trim());
  if (existing) return void res.status(409).json({ error: `a tab named "${customer_name.trim()}" is already open` });

  const notesVal = notes?.trim() || null;
  const now = new Date().toISOString();
  const { lastInsertRowid } = db.prepare(
    "INSERT INTO tabs (customer_name, notes, status, opened_at, tip_cents, session_id) VALUES (?, ?, 'open', ?, 0, ?)"
  ).run(customer_name.trim(), notesVal, now, sessionId);

  const tabId = Number(lastInsertRowid);
  logEvent('tab_opened', tabId, { customer_name: customer_name.trim() });

  const tab = buildTab(tabId)!;
  broadcast({ type: 'tab:opened', data: tab });
  res.status(201).json(tab);
});

// PATCH /api/tabs/:id/notes — update notes on an open tab
router.patch('/:id/notes', (req: Request, res: Response) => {
  const tabId = Number(req.params.id);
  const { notes } = req.body;

  const tabRow = db.prepare("SELECT id FROM tabs WHERE id = ? AND status = 'open'").get(tabId);
  if (!tabRow) return void res.status(404).json({ error: 'tab not found or not open' });

  const notesVal = notes?.trim() || null;
  db.prepare('UPDATE tabs SET notes = ? WHERE id = ?').run(notesVal, tabId);
  logEvent('tab_updated', tabId, { notes: notesVal });

  const tab = buildTab(tabId)!;
  broadcast({ type: 'tab:updated', data: tab });
  res.json(tab);
});

// POST /api/tabs/:id/items — add or increment item
router.post('/:id/items', (req: Request, res: Response) => {
  const tabId = Number(req.params.id);
  const { product_id, note, quantity = 1 } = req.body;
  const qty = Math.max(1, Math.floor(Number(quantity)));

  const tabRow = db.prepare("SELECT id FROM tabs WHERE id = ? AND status = 'open'").get(tabId);
  if (!tabRow) return void res.status(404).json({ error: 'tab not found or not open' });

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(product_id) as any;
  if (!product) return void res.status(404).json({ error: 'product not found' });

  const now = new Date().toISOString();
  const noteVal = note ?? null;

  const existing = db.prepare(
    "SELECT * FROM line_items WHERE tab_id = ? AND product_id = ? AND (note IS ?) AND kind = 'product'"
  ).get(tabId, product_id, noteVal) as any;

  if (existing) {
    db.prepare('UPDATE line_items SET quantity = quantity + ? WHERE id = ?').run(qty, existing.id);
  } else {
    db.prepare(`
      INSERT INTO line_items (tab_id, product_id, name_snapshot, price_snapshot_cents, tax_category_snapshot, quantity, note, kind, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'product', ?)
    `).run(tabId, product_id, product.name, product.price_cents, product.tax_category, qty, noteVal, now);
  }

  logEvent('item_added', tabId, { product_id, name: product.name, price_cents: product.price_cents, qty });

  const tab = buildTab(tabId)!;
  broadcast({ type: 'tab:updated', data: tab });
  res.json(tab);
});

// DELETE /api/tabs/:id/items/:itemId — decrement or delete item
router.delete('/:id/items/:itemId', (req: Request, res: Response) => {
  const tabId = Number(req.params.id);
  const itemId = Number(req.params.itemId);

  const tabRow = db.prepare("SELECT id FROM tabs WHERE id = ? AND status = 'open'").get(tabId);
  if (!tabRow) return void res.status(404).json({ error: 'tab not found or not open' });

  const item = db.prepare('SELECT * FROM line_items WHERE id = ? AND tab_id = ?').get(itemId, tabId) as any;
  if (!item) return void res.status(404).json({ error: 'item not found' });

  if (item.kind === 'billiard' || item.quantity <= 1) {
    if (item.kind === 'billiard') {
      db.prepare('UPDATE billiard_sessions SET line_item_id = NULL WHERE line_item_id = ?').run(itemId);
    }
    db.prepare('DELETE FROM line_items WHERE id = ?').run(itemId);
  } else {
    db.prepare('UPDATE line_items SET quantity = quantity - 1 WHERE id = ?').run(itemId);
  }

  logEvent('item_removed', tabId, { item_id: itemId, name: item.name_snapshot });

  const tab = buildTab(tabId)!;
  broadcast({ type: 'tab:updated', data: tab });
  res.json(tab);
});

// DELETE /api/tabs/:id — delete an open tab (immutable once closed)
router.delete('/:id', (req: Request, res: Response) => {
  const tabId = Number(req.params.id);

  const tabRow = db.prepare("SELECT * FROM tabs WHERE id = ? AND status = 'open'").get(tabId) as any;
  if (!tabRow) return void res.status(404).json({ error: 'tab not found or not open' });

  const activeSession = db.prepare(
    'SELECT id FROM billiard_sessions WHERE tab_id = ? AND ended_at IS NULL LIMIT 1'
  ).get(tabId);
  if (activeSession) return void res.status(409).json({ error: 'stop the running table first' });

  logEvent('tab_deleted', tabId, { customer_name: tabRow.customer_name });

  db.prepare('UPDATE waitlist SET tab_id = NULL WHERE tab_id = ?').run(tabId);
  db.prepare('UPDATE events SET tab_id = NULL WHERE tab_id = ?').run(tabId);
  db.prepare('DELETE FROM billiard_sessions WHERE tab_id = ?').run(tabId);
  db.prepare('DELETE FROM line_items WHERE tab_id = ?').run(tabId);
  db.prepare('DELETE FROM tabs WHERE id = ?').run(tabId);

  broadcast({ type: 'tab:deleted', data: { id: tabId } });
  res.json({ id: tabId });
});

// POST /api/tabs/:id/split-pay — pay selected items (with qty), leave rest on tab
// body: { items: Array<{ id: number, quantity: number }>, payment_method, tip_cents }
router.post('/:id/split-pay', async (req: Request, res: Response) => {
  const tabId = Number(req.params.id);
  const { items: splitItems, payment_method, tip_cents = 0, card_auth_code = null, card_masked_pan = null } = req.body;

  if (!['cash', 'card'].includes(payment_method)) {
    return void res.status(400).json({ error: 'payment_method must be "cash" or "card"' });
  }
  if (!Array.isArray(splitItems) || splitItems.length === 0) {
    return void res.status(400).json({ error: 'items must be a non-empty array' });
  }

  const tabRow = db.prepare("SELECT * FROM tabs WHERE id = ? AND status = 'open'").get(tabId) as any;
  if (!tabRow) return void res.status(404).json({ error: 'tab not found or not open' });

  const sessionId = getActiveSessionId();
  if (!sessionId) return void res.status(403).json({ error: 'no shift is open' });

  const itemIds = (splitItems as Array<{ id: number; quantity: number }>).map(i => i.id);
  const placeholders = itemIds.map(() => '?').join(',');
  const dbItems = db.prepare(
    `SELECT * FROM line_items WHERE id IN (${placeholders}) AND tab_id = ?`
  ).all(...itemIds, tabId) as any[];

  if (dbItems.length !== itemIds.length) {
    return void res.status(400).json({ error: 'some item ids are invalid or do not belong to this tab' });
  }
  if (dbItems.some((i: any) => i.kind === 'billiard')) {
    return void res.status(400).json({ error: 'billiard items cannot be split off — stop the table first' });
  }

  // Build split qty map and validate quantities
  const splitQtyMap = new Map<number, number>(
    (splitItems as Array<{ id: number; quantity: number }>).map(i => [i.id, i.quantity])
  );
  for (const dbItem of dbItems) {
    const qty = splitQtyMap.get(dbItem.id) ?? 0;
    if (!Number.isInteger(qty) || qty < 1 || qty > dbItem.quantity) {
      return void res.status(400).json({
        error: `invalid quantity ${qty} for item ${dbItem.id} (max ${dbItem.quantity})`,
      });
    }
  }

  const tip = Math.max(0, Math.floor(Number(tip_cents)));
  const now = new Date().toISOString();
  const berlinTime = new Date().toLocaleTimeString('de-DE', {
    timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit',
  });

  const tax = computeTaxBreakdown(dbItems.map(dbItem => ({
    price_snapshot_cents: dbItem.price_snapshot_cents,
    quantity: splitQtyMap.get(dbItem.id)!,
    tax_category_snapshot: dbItem.tax_category_snapshot,
  })));
  const total = tax.subtotal_cents + tip;

  const { tse, error } = await signOrOffline({
    payment_method: payment_method as 'cash' | 'card',
    subtotal_standard_cents: tax.subtotal_standard_cents,
    subtotal_reduced_cents: tax.subtotal_reduced_cents,
    tip_cents: tip,
    total_cents: total,
  });
  if (error) return void res.status(502).json({ error: `TSE signing failed: ${error}` });

  const doSplitPay = db.transaction(() => {
    const splitName = `${tabRow.customer_name} · split ${berlinTime}`;
    const { lastInsertRowid } = db.prepare(
      "INSERT INTO tabs (customer_name, status, opened_at, tip_cents, session_id) VALUES (?, 'open', ?, 0, ?)"
    ).run(splitName, now, sessionId);
    const splitTabId = Number(lastInsertRowid);
    logEvent('tab_opened', splitTabId, { customer_name: splitName });

    for (const dbItem of dbItems) {
      const qty = splitQtyMap.get(dbItem.id)!;
      db.prepare(`
        INSERT INTO line_items (tab_id, product_id, name_snapshot, price_snapshot_cents, tax_category_snapshot, quantity, note, kind, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'product', ?)
      `).run(splitTabId, dbItem.product_id, dbItem.name_snapshot, dbItem.price_snapshot_cents,
         dbItem.tax_category_snapshot, qty, dbItem.note, now);
    }

    writeClose(splitTabId, {
      closed_at: now, payment_method, tax, tip_cents: tip, total_cents: total,
      card_auth_code, card_masked_pan, tse,
    });

    logEvent('tab_closed', splitTabId, {
      payment_method, subtotal: tax.subtotal_cents, tax: tax.tax_cents, tip, total,
      split_from_tab_id: tabId,
    });

    // Reduce or remove items from the original tab
    for (const dbItem of dbItems) {
      const qty = splitQtyMap.get(dbItem.id)!;
      if (qty >= dbItem.quantity) {
        db.prepare('DELETE FROM line_items WHERE id = ?').run(dbItem.id);
      } else {
        db.prepare('UPDATE line_items SET quantity = quantity - ? WHERE id = ?').run(qty, dbItem.id);
      }
    }
    logEvent('split_paid', tabId, { split_tab_id: splitTabId, payment_method, total });

    return splitTabId;
  });

  try {
    const splitTabId = doSplitPay();
    const paidTab = buildTab(splitTabId)!;
    const remainingTab = buildTab(tabId)!;
    broadcast({ type: 'tab:closed', data: paidTab });
    broadcast({ type: 'tab:updated', data: remainingTab });
    res.json({ paid_tab: paidTab, remaining_tab: remainingTab });
  } catch (e: any) {
    res.status(e.status ?? 500).json({ error: e.message });
  }
});

// POST /api/tabs/:id/close
router.post('/:id/close', async (req: Request, res: Response) => {
  const tabId = Number(req.params.id);
  const { payment_method, tip_cents = 0, card_auth_code = null, card_masked_pan = null } = req.body;

  if (!['cash', 'card'].includes(payment_method)) {
    return void res.status(400).json({ error: 'payment_method must be "cash" or "card"' });
  }

  const tip = Math.max(0, Math.floor(Number(tip_cents)));

  const tabRow = db.prepare("SELECT id FROM tabs WHERE id = ? AND status = 'open'").get(tabId);
  if (!tabRow) return void res.status(404).json({ error: 'tab not found or not open' });

  const activeSession = db.prepare(
    'SELECT id FROM billiard_sessions WHERE tab_id = ? AND ended_at IS NULL LIMIT 1'
  ).get(tabId);
  if (activeSession) return void res.status(409).json({ error: 'stop the running table first' });

  const tab = buildTab(tabId)!;
  const tax = computeTaxBreakdown(tab.items ?? []);
  const total = tax.subtotal_cents + tip;

  const { tse, error } = await signOrOffline({
    payment_method: payment_method as 'cash' | 'card',
    subtotal_standard_cents: tax.subtotal_standard_cents,
    subtotal_reduced_cents: tax.subtotal_reduced_cents,
    tip_cents: tip,
    total_cents: total,
  });
  if (error) return void res.status(502).json({ error: `TSE signing failed: ${error}` });

  const now = new Date().toISOString();

  writeClose(tabId, {
    closed_at: now, payment_method, tax, tip_cents: tip, total_cents: total,
    card_auth_code, card_masked_pan, tse,
  });

  logEvent('tab_closed', tabId, {
    payment_method, subtotal: tax.subtotal_cents, tax: tax.tax_cents, tip, total,
    tse_transaction_number: tse?.tse_transaction_number ?? null,
  });

  const closedTab = buildTab(tabId)!;
  broadcast({ type: 'tab:closed', data: closedTab });
  res.json(closedTab);
});

export default router;
