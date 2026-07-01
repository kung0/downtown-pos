import { Router } from 'express';
import type { Request, Response } from 'express';
import db from '../db/client';
import { buildTab, logEvent, computeTaxBreakdown, applyDiscountToTax, writeClose } from '../db/helpers';
import { broadcast } from '../ws/server';
import { signOrOffline } from '../services/tse';
import { buildReceipt } from '../printer/escpos';
import { sendToPrinter } from '../printer/client';
import type { Tab } from '@downtown/shared';

function maybePrint(tab: Tab): void {
  const rows = db.prepare("SELECT key, value FROM settings WHERE key IN ('printer_ip', 'printer_auto_print')").all() as { key: string; value: string }[];
  const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
  if (map.printer_auto_print !== '1' || !map.printer_ip?.trim()) return;
  sendToPrinter(map.printer_ip.trim(), buildReceipt(tab)).catch(err =>
    console.error('[printer] auto-print failed:', err.message)
  );
}

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
  const ph = ids.map(() => '?').join(',');
  const allItems = db.prepare(
    `SELECT li.*, bs.started_at AS session_started_at, bs.ended_at AS session_ended_at,
            bs.computed_cost_cents AS session_computed_cost_cents
     FROM line_items li
     LEFT JOIN billiard_sessions bs ON bs.line_item_id = li.id
     WHERE li.tab_id IN (${ph})
     ORDER BY li.created_at ASC`
  ).all(...ids) as any[];

  const allSessions = db.prepare(
    `SELECT bs.*, pt.label AS table_label, pt.type AS table_type
     FROM billiard_sessions bs
     JOIN pool_tables pt ON pt.id = bs.pool_table_id
     WHERE bs.tab_id IN (${ph}) AND bs.ended_at IS NULL`
  ).all(...ids) as any[];

  const tabs = tabRows.map((row: any) => {
    const items = allItems.filter((i: any) => i.tab_id === row.id);
    const active_sessions = allSessions.filter((s: any) => s.tab_id === row.id);
    const running_total_cents = items.reduce((sum: number, i: any) => sum + i.price_snapshot_cents * i.quantity, 0);
    return { ...row, items, active_sessions, running_total_cents };
  });

  res.json(tabs);
});

// POST /api/tabs/quick-pay — pay immediately without keeping a tab open
router.post('/quick-pay', async (req: Request, res: Response) => {
  const { items, payment_method, tip_cents = 0, discount_cents = 0, card_auth_code = null, card_masked_pan = null } = req.body;

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
  interface ResolvedItem { product: any; qty: number; itemName: string; itemPrice: number; variantId: number | null; }
  const resolvedItems: ResolvedItem[] = [];
  const disc = Math.max(0, Math.floor(Number(discount_cents)));

  for (const { product_id, quantity = 1, variant_id, custom_price_cents } of items as Array<{ product_id: number; quantity?: number; variant_id?: number; custom_price_cents?: number }>) {
    const qty = Math.max(1, Math.floor(Number(quantity)));
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(product_id) as any;
    if (!product) return void res.status(404).json({ error: `product ${product_id} not found` });

    if (product.is_misc && (!Number.isInteger(custom_price_cents) || (custom_price_cents as number) <= 0)) {
      return void res.status(400).json({ error: `custom_price_cents required for misc product ${product_id}` });
    }

    let itemName: string = product.name;
    let itemPrice: number = product.is_misc ? (custom_price_cents as number) : product.price_cents;
    let variantId: number | null = null;

    if (variant_id) {
      const variant = db.prepare('SELECT * FROM product_variants WHERE id = ? AND product_id = ?').get(variant_id, product_id) as any;
      if (!variant) return void res.status(404).json({ error: `variant ${variant_id} not found` });
      itemName = `${product.name} (${variant.name})`;
      // Variant price is an upcharge added to the base price (matches the
      // add-to-tab route and OrdersPage). 0 = same price as base.
      itemPrice = product.price_cents + variant.price_cents;
      variantId = variant.id;
    }

    resolvedItems.push({ product, qty, itemName, itemPrice, variantId });
  }

  const rawTax = computeTaxBreakdown(resolvedItems.map(r => ({
    price_snapshot_cents: r.itemPrice,
    quantity: r.qty,
    tax_category_snapshot: r.product.tax_category,
  })));
  const discount = Math.min(disc, rawTax.subtotal_cents);
  const tax = applyDiscountToTax(rawTax, discount);
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

    for (const { product, qty, itemName, itemPrice, variantId } of resolvedItems) {
      db.prepare(`
        INSERT INTO line_items (tab_id, product_id, variant_id, name_snapshot, price_snapshot_cents, tax_category_snapshot, quantity, note, kind, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'product', ?)
      `).run(tabId, product.id, variantId, itemName, itemPrice, product.tax_category, qty, now);
      logEvent('item_added', tabId, { product_id: product.id, variant_id: variantId, name: itemName, price_cents: itemPrice, qty });
    }

    writeClose(tabId, {
      closed_at: now, payment_method, tax, discount_cents: discount, tip_cents: tip, total_cents: total,
      card_auth_code, card_masked_pan, tse,
    });

    logEvent('tab_closed', tabId, {
      payment_method, subtotal: tax.subtotal_cents + discount, discount, tax: tax.tax_cents, tip, total,
      tse_transaction_number: tse?.tse_transaction_number ?? null,
    });

    return tabId;
  });

  try {
    const tabId = doQuickPay();
    const closedTab = buildTab(tabId)!;
    broadcast({ type: 'tab:closed', data: closedTab });
    maybePrint(closedTab);
    res.status(201).json(closedTab);
  } catch (e: any) {
    res.status(e.status ?? 500).json({ error: e.message });
  }
});

// GET /api/tabs/history — all tabs (open + closed), newest first
router.get('/history', (req: Request, res: Response) => {
  const { session_id } = req.query;

  let rows: any[];
  if (session_id) {
    rows = db.prepare(
      `SELECT * FROM tabs WHERE session_id = ? ORDER BY opened_at DESC`
    ).all(session_id) as any[];
  } else {
    rows = db.prepare(
      `SELECT * FROM tabs ORDER BY opened_at DESC LIMIT 500`
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

// GET /api/tabs/:id/events
router.get('/:id/events', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const rows = db.prepare(
    'SELECT * FROM events WHERE tab_id = ? ORDER BY created_at ASC'
  ).all(id) as Array<{ id: number; event_type: string; tab_id: number; payload: string; created_at: string }>;
  res.json(rows.map(r => ({ ...r, payload: JSON.parse(r.payload) })));
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

// PATCH /api/tabs/:id/name — rename an open tab
router.patch('/:id/name', (req: Request, res: Response) => {
  const tabId = Number(req.params.id);
  const { customer_name } = req.body;
  if (!customer_name?.trim()) return void res.status(400).json({ error: 'customer_name is required' });
  const name = customer_name.trim();

  const tabRow = db.prepare("SELECT id FROM tabs WHERE id = ? AND status = 'open'").get(tabId);
  if (!tabRow) return void res.status(404).json({ error: 'tab not found or not open' });

  const existing = db.prepare(
    "SELECT id FROM tabs WHERE customer_name = ? AND status = 'open' AND id != ? LIMIT 1"
  ).get(name, tabId);
  if (existing) return void res.status(409).json({ error: `a tab named "${name}" is already open` });

  db.prepare('UPDATE tabs SET customer_name = ? WHERE id = ?').run(name, tabId);
  logEvent('tab_updated', tabId, { customer_name: name });

  const tab = buildTab(tabId)!;
  broadcast({ type: 'tab:updated', data: tab });
  res.json(tab);
});

// POST /api/tabs/:id/items — add or increment item
router.post('/:id/items', (req: Request, res: Response) => {
  const tabId = Number(req.params.id);
  const { product_id, note, quantity = 1, variant_id, custom_price_cents } = req.body;
  const qty = Math.max(1, Math.floor(Number(quantity)));

  const tabRow = db.prepare("SELECT id FROM tabs WHERE id = ? AND status = 'open'").get(tabId);
  if (!tabRow) return void res.status(404).json({ error: 'tab not found or not open' });

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(product_id) as any;
  if (!product) return void res.status(404).json({ error: 'product not found' });

  if (product.is_misc && (!Number.isInteger(custom_price_cents) || custom_price_cents <= 0)) {
    return void res.status(400).json({ error: 'custom_price_cents required for misc products' });
  }

  const now = new Date().toISOString();
  const noteVal = note ?? null;

  let itemName: string = product.name;
  let itemPrice: number = product.is_misc ? custom_price_cents : product.price_cents;
  let variantIdVal: number | null = null;

  if (variant_id) {
    const variant = db.prepare('SELECT * FROM product_variants WHERE id = ? AND product_id = ?').get(variant_id, product_id) as any;
    if (!variant) return void res.status(404).json({ error: 'variant not found' });
    itemName = `${product.name} (${variant.name})`;
    itemPrice = product.price_cents + variant.price_cents;
    variantIdVal = variant.id;
  }

  // Misc items always get their own line (each has a custom price, never dedup).
  if (!product.is_misc) {
    const existing = db.prepare(
      "SELECT * FROM line_items WHERE tab_id = ? AND product_id = ? AND (variant_id IS ?) AND (note IS ?) AND kind = 'product'"
    ).get(tabId, product_id, variantIdVal, noteVal) as any;

    if (existing) {
      db.prepare('UPDATE line_items SET quantity = quantity + ? WHERE id = ?').run(qty, existing.id);
      logEvent('item_added', tabId, { product_id, variant_id: variantIdVal, name: itemName, price_cents: itemPrice, qty });
      const tab = buildTab(tabId)!;
      broadcast({ type: 'tab:updated', data: tab });
      return void res.json(tab);
    }
  }

  db.prepare(`
    INSERT INTO line_items (tab_id, product_id, variant_id, name_snapshot, price_snapshot_cents, tax_category_snapshot, quantity, note, kind, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'product', ?)
  `).run(tabId, product_id, variantIdVal, itemName, itemPrice, product.tax_category, qty, noteVal, now);

  logEvent('item_added', tabId, { product_id, variant_id: variantIdVal, name: itemName, price_cents: itemPrice, qty });

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

  logEvent('item_removed', tabId, { item_id: itemId, name: item.name_snapshot, price_cents: item.price_snapshot_cents, quantity_removed: 1 });

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

  const deletedItems = db.prepare(
    'SELECT name_snapshot, price_snapshot_cents, quantity FROM line_items WHERE tab_id = ?'
  ).all(tabId) as Array<{ name_snapshot: string; price_snapshot_cents: number; quantity: number }>;

  const now = new Date().toISOString();
  logEvent('tab_deleted', tabId, { customer_name: tabRow.customer_name, items: deletedItems });

  db.prepare('UPDATE waitlist SET tab_id = NULL WHERE tab_id = ?').run(tabId);
  db.prepare("UPDATE tabs SET status = 'deleted', deleted_at = ? WHERE id = ?").run(now, tabId);

  const deletedTab = buildTab(tabId)!;
  broadcast({ type: 'tab:deleted', data: deletedTab });
  res.json({ id: tabId });
});

// POST /api/tabs/:id/split-pay — pay selected items, leave rest on tab
// items: Array<{ id, quantity, amount_cents? }>
//   product items  → split by quantity
//   billiard items → split by amount_cents (e.g. pay 6 € of a 12 € session)
router.post('/:id/split-pay', async (req: Request, res: Response) => {
  const tabId = Number(req.params.id);
  const { items: splitItems, payment_method, tip_cents = 0, discount_cents = 0, card_auth_code = null, card_masked_pan = null } = req.body;

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

  const itemIds = (splitItems as Array<{ id: number; quantity: number; amount_cents?: number }>).map(i => i.id);
  const placeholders = itemIds.map(() => '?').join(',');
  const dbItems = db.prepare(
    `SELECT * FROM line_items WHERE id IN (${placeholders}) AND tab_id = ?`
  ).all(...itemIds, tabId) as any[];

  if (dbItems.length !== itemIds.length) {
    return void res.status(400).json({ error: 'some item ids are invalid or do not belong to this tab' });
  }

  // Build pay-amount map: item id → cents being paid now
  const payAmounts = new Map<number, number>();
  const payQtys = new Map<number, number>();

  for (const reqItem of splitItems as Array<{ id: number; quantity: number; amount_cents?: number }>) {
    const dbItem = dbItems.find((i: any) => i.id === reqItem.id);
    if (!dbItem) continue;
    if (dbItem.kind === 'billiard') {
      const amount = Math.floor(Number(reqItem.amount_cents ?? 0));
      if (amount < 1 || amount > dbItem.price_snapshot_cents) {
        return void res.status(400).json({
          error: `invalid amount_cents ${amount} for billiard item ${dbItem.id} (max ${dbItem.price_snapshot_cents})`,
        });
      }
      payAmounts.set(dbItem.id, amount);
    } else {
      const qty = reqItem.quantity;
      if (!Number.isInteger(qty) || qty < 1 || qty > dbItem.quantity) {
        return void res.status(400).json({
          error: `invalid quantity ${qty} for item ${dbItem.id} (max ${dbItem.quantity})`,
        });
      }
      payAmounts.set(dbItem.id, dbItem.price_snapshot_cents * qty);
      payQtys.set(dbItem.id, qty);
    }
  }

  const tip = Math.max(0, Math.floor(Number(tip_cents)));
  const now = new Date().toISOString();
  const berlinTime = new Date().toLocaleTimeString('de-DE', {
    timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit',
  });

  const rawTaxSplit = computeTaxBreakdown(dbItems.map((dbItem: any) => ({
    price_snapshot_cents: payAmounts.get(dbItem.id)!,
    quantity: 1,
    tax_category_snapshot: dbItem.tax_category_snapshot,
  })));
  const discSplit = Math.min(Math.max(0, Math.floor(Number(discount_cents))), rawTaxSplit.subtotal_cents);
  const tax = applyDiscountToTax(rawTaxSplit, discSplit);
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
      const paidAmount = payAmounts.get(dbItem.id)!;
      db.prepare(`
        INSERT INTO line_items (tab_id, product_id, name_snapshot, price_snapshot_cents, tax_category_snapshot, quantity, note, kind, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(splitTabId, dbItem.product_id, dbItem.name_snapshot, paidAmount,
         dbItem.tax_category_snapshot, 1, dbItem.note, dbItem.kind, now);
    }

    writeClose(splitTabId, {
      closed_at: now, payment_method, tax, discount_cents: discSplit, tip_cents: tip, total_cents: total,
      card_auth_code, card_masked_pan, tse,
    });

    logEvent('tab_closed', splitTabId, {
      payment_method, subtotal: tax.subtotal_cents + discSplit, discount: discSplit, tax: tax.tax_cents, tip, total,
      split_from_tab_id: tabId,
    });

    // Reduce or remove items from the original tab
    for (const dbItem of dbItems) {
      if (dbItem.kind === 'billiard') {
        const paidAmount = payAmounts.get(dbItem.id)!;
        const remaining = dbItem.price_snapshot_cents - paidAmount;
        if (remaining <= 0) {
          // Full billiard paid — unlink session and delete item
          db.prepare('UPDATE billiard_sessions SET line_item_id = NULL WHERE line_item_id = ?').run(dbItem.id);
          db.prepare('DELETE FROM line_items WHERE id = ?').run(dbItem.id);
        } else {
          // Partial — reduce the price on the original item
          db.prepare('UPDATE line_items SET price_snapshot_cents = ? WHERE id = ?').run(remaining, dbItem.id);
        }
      } else {
        const qty = payQtys.get(dbItem.id)!;
        if (qty >= dbItem.quantity) {
          db.prepare('DELETE FROM line_items WHERE id = ?').run(dbItem.id);
        } else {
          db.prepare('UPDATE line_items SET quantity = quantity - ? WHERE id = ?').run(qty, dbItem.id);
        }
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
    maybePrint(paidTab);
    res.json({ paid_tab: paidTab, remaining_tab: remainingTab });
  } catch (e: any) {
    res.status(e.status ?? 500).json({ error: e.message });
  }
});

// POST /api/tabs/:id/close
router.post('/:id/close', async (req: Request, res: Response) => {
  const tabId = Number(req.params.id);
  const { payment_method, tip_cents = 0, discount_cents = 0, card_auth_code = null, card_masked_pan = null } = req.body;

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
  const rawTaxClose = computeTaxBreakdown(tab.items ?? []);
  const discClose = Math.min(Math.max(0, Math.floor(Number(discount_cents))), rawTaxClose.subtotal_cents);
  const tax = applyDiscountToTax(rawTaxClose, discClose);
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
    closed_at: now, payment_method, tax, discount_cents: discClose, tip_cents: tip, total_cents: total,
    card_auth_code, card_masked_pan, tse,
  });

  logEvent('tab_closed', tabId, {
    payment_method, subtotal: tax.subtotal_cents + discClose, discount: discClose, tax: tax.tax_cents, tip, total,
    tse_transaction_number: tse?.tse_transaction_number ?? null,
  });

  const closedTab = buildTab(tabId)!;
  broadcast({ type: 'tab:closed', data: closedTab });
  maybePrint(closedTab);
  res.json(closedTab);
});

// POST /api/tabs/:id/correct-tip — fix the tip on a closed tab, compliantly.
// Closed tabs are immutable, so we do NOT edit the original. Instead we book a
// Storno (voided, negated copy referencing the original) that reverses it, plus
// a fresh reissue closed with the corrected tip. Original + Storno net to zero
// and the reissue carries the right figure. Only the current shift's tabs are
// eligible, so the storno + reissue land in the same open shift as the original.
router.post('/:id/correct-tip', async (req: Request, res: Response) => {
  const origId = Number(req.params.id);
  const newTip = Math.max(0, Math.floor(Number(req.body.tip_cents)));
  if (!Number.isFinite(newTip)) {
    return void res.status(400).json({ error: 'tip_cents must be a number' });
  }

  const sessionId = getActiveSessionId();
  if (!sessionId) return void res.status(403).json({ error: 'no shift is open — open a shift first' });

  const orig = db.prepare('SELECT * FROM tabs WHERE id = ?').get(origId) as any;
  if (!orig) return void res.status(404).json({ error: 'tab not found' });
  if (orig.status !== 'closed') return void res.status(400).json({ error: 'only a closed tab can have its tip corrected' });
  if (orig.session_id !== sessionId) {
    return void res.status(409).json({ error: 'tab belongs to another shift — only current-shift tabs can be corrected' });
  }
  const alreadyVoided = db.prepare("SELECT id FROM tabs WHERE original_tab_id = ? AND status = 'voided'").get(origId);
  if (alreadyVoided) return void res.status(409).json({ error: 'this tab has already been corrected' });
  if ((orig.tip_cents ?? 0) === newTip) return void res.status(400).json({ error: 'tip is unchanged' });

  const items = db.prepare(
    'SELECT * FROM line_items WHERE tab_id = ? ORDER BY created_at ASC, id ASC'
  ).all(origId) as any[];

  // The corrected sale keeps the same goods + discount; only the tip differs.
  const disc = Math.max(0, orig.discount_cents ?? 0);
  const rawTax = computeTaxBreakdown(items);
  const discApplied = Math.min(disc, rawTax.subtotal_cents);
  const tax = applyDiscountToTax(rawTax, discApplied);
  const reissueTotal = tax.subtotal_cents + newTip;
  const pay = orig.payment_method as 'cash' | 'card';

  // Sign both transactions (async) before opening the DB transaction. The storno
  // signs the reversal (negated amounts); the reissue signs the corrected sale.
  const stornoSign = await signOrOffline({
    payment_method: pay,
    subtotal_standard_cents: -(orig.subtotal_standard_cents ?? 0),
    subtotal_reduced_cents: -(orig.subtotal_reduced_cents ?? 0),
    tip_cents: -(orig.tip_cents ?? 0),
    total_cents: -(orig.total_cents ?? 0),
  });
  if (stornoSign.error) return void res.status(502).json({ error: `TSE signing failed: ${stornoSign.error}` });
  const reissueSign = await signOrOffline({
    payment_method: pay,
    subtotal_standard_cents: tax.subtotal_standard_cents,
    subtotal_reduced_cents: tax.subtotal_reduced_cents,
    tip_cents: newTip,
    total_cents: reissueTotal,
  });
  if (reissueSign.error) return void res.status(502).json({ error: `TSE signing failed: ${reissueSign.error}` });

  const now = new Date().toISOString();
  const insItem = db.prepare(`
    INSERT INTO line_items (tab_id, product_id, variant_id, name_snapshot, price_snapshot_cents, tax_category_snapshot, quantity, note, kind, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const doCorrect = db.transaction(() => {
    // ── 1. Storno: voided, negated copy that reverses the original ──
    const { lastInsertRowid: sRow } = db.prepare(
      "INSERT INTO tabs (customer_name, status, opened_at, tip_cents, session_id) VALUES (?, 'voided', ?, 0, ?)"
    ).run(`${orig.customer_name} · Storno`, now, sessionId);
    const stornoId = Number(sRow);
    // Negate quantity so both revenue and unit counts net out in reports.
    for (const it of items) {
      insItem.run(stornoId, it.product_id, it.variant_id ?? null, it.name_snapshot,
        it.price_snapshot_cents, it.tax_category_snapshot, -it.quantity, it.note, it.kind, now);
    }
    db.prepare(`
      UPDATE tabs SET
        closed_at = ?, voided_at = ?, void_reason = ?, original_tab_id = ?,
        payment_method = ?, subtotal_cents = ?, discount_cents = ?, tax_cents = ?,
        tax_standard_cents = ?, tax_reduced_cents = ?, subtotal_standard_cents = ?, subtotal_reduced_cents = ?,
        tip_cents = ?, total_cents = ?,
        tse_signature = ?, tse_start_time = ?, tse_timestamp = ?, tse_transaction_number = ?, tse_signature_counter = ?, tse_status = ?
      WHERE id = ?
    `).run(
      now, now, 'Trinkgeld-Korrektur', origId,
      pay, -(orig.subtotal_cents ?? 0), -discApplied, -(orig.tax_cents ?? 0),
      -(orig.tax_standard_cents ?? 0), -(orig.tax_reduced_cents ?? 0), -(orig.subtotal_standard_cents ?? 0), -(orig.subtotal_reduced_cents ?? 0),
      -(orig.tip_cents ?? 0), -(orig.total_cents ?? 0),
      stornoSign.tse?.tse_signature ?? null, stornoSign.tse?.tse_start_time ?? null,
      stornoSign.tse?.tse_timestamp ?? null, stornoSign.tse?.tse_transaction_number ?? null,
      stornoSign.tse?.tse_signature_counter ?? null, stornoSign.tse ? 'ok' : 'offline',
      stornoId,
    );
    logEvent('tab_voided', stornoId, { original_tab_id: origId, reason: 'Trinkgeld-Korrektur' });

    // ── 2. Reissue: fresh closed sale with the corrected tip ──
    const { lastInsertRowid: rRow } = db.prepare(
      "INSERT INTO tabs (customer_name, status, opened_at, tip_cents, session_id) VALUES (?, 'open', ?, 0, ?)"
    ).run(orig.customer_name, now, sessionId);
    const reissueId = Number(rRow);
    for (const it of items) {
      insItem.run(reissueId, it.product_id, it.variant_id ?? null, it.name_snapshot,
        it.price_snapshot_cents, it.tax_category_snapshot, it.quantity, it.note, it.kind, now);
    }
    writeClose(reissueId, {
      closed_at: now, payment_method: pay, tax, discount_cents: discApplied,
      tip_cents: newTip, total_cents: reissueTotal,
      card_auth_code: orig.card_auth_code, card_masked_pan: orig.card_masked_pan, tse: reissueSign.tse,
    });
    logEvent('tab_closed', reissueId, {
      payment_method: pay, subtotal: tax.subtotal_cents + discApplied, discount: discApplied,
      tax: tax.tax_cents, tip: newTip, total: reissueTotal, corrected_from_tab_id: origId,
      tse_transaction_number: reissueSign.tse?.tse_transaction_number ?? null,
    });

    // Record the correction on the original tab's own activity trail.
    logEvent('tip_corrected', origId, {
      old_tip: orig.tip_cents ?? 0, new_tip: newTip, storno_tab_id: stornoId, reissue_tab_id: reissueId,
    });

    return { stornoId, reissueId };
  });

  const { stornoId, reissueId } = doCorrect();
  const storno = buildTab(stornoId)!;
  const reissue = buildTab(reissueId)!;
  broadcast({ type: 'tab:voided', data: storno });
  broadcast({ type: 'tab:closed', data: reissue });
  maybePrint(reissue);
  res.status(201).json({ storno, reissue });
});

// PATCH /api/tabs/:id/park — mark tab as parked (customer left without paying)
router.patch('/:id/park', (req: Request, res: Response) => {
  const tabId = Number(req.params.id);
  const tabRow = db.prepare("SELECT * FROM tabs WHERE id = ? AND status = 'open'").get(tabId) as any;
  if (!tabRow) return void res.status(404).json({ error: 'tab not found or not open' });
  if (tabRow.parked) return void res.status(409).json({ error: 'tab is already parked' });

  db.prepare('UPDATE tabs SET parked = 1 WHERE id = ?').run(tabId);
  logEvent('tab_parked', tabId, {});
  const updated = buildTab(tabId)!;
  broadcast({ type: 'tab:parked', data: updated });
  res.json(updated);
});

// PATCH /api/tabs/:id/unpark — resume a parked tab
router.patch('/:id/unpark', (req: Request, res: Response) => {
  const tabId = Number(req.params.id);
  const tabRow = db.prepare("SELECT * FROM tabs WHERE id = ? AND status = 'open'").get(tabId) as any;
  if (!tabRow) return void res.status(404).json({ error: 'tab not found or not open' });
  if (!tabRow.parked) return void res.status(409).json({ error: 'tab is not parked' });

  db.prepare('UPDATE tabs SET parked = 0 WHERE id = ?').run(tabId);
  logEvent('tab_unparked', tabId, {});
  const updated = buildTab(tabId)!;
  broadcast({ type: 'tab:unparked', data: updated });
  res.json(updated);
});

export default router;
