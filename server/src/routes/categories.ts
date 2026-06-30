import { Router } from 'express';
import type { Request, Response } from 'express';
import db from '../db/client';
import type { Category } from '@downtown/shared';

const router = Router();

interface CatRow {
  id: number; name: string; parent_id: number | null;
  tax_category: string; sort_order: number; created_at: string;
}

function normalize(row: unknown): Category {
  return row as Category;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Parse the availability window out of a request body. Returns the three
// columns to store, or an error string if anything is malformed.
function parseAvailability(body: any):
  | { avail_days: string | null; avail_start: string | null; avail_end: string | null }
  | { error: string } {
  let avail_days: string | null = null;
  if (body.avail_days !== undefined && body.avail_days !== null && body.avail_days !== '') {
    const raw = String(body.avail_days).split(',').map((s: string) => s.trim()).filter(Boolean);
    const days = raw.map(Number);
    if (days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) {
      return { error: 'avail_days must be weekday numbers 1–7' };
    }
    const uniq = [...new Set(days)].sort((a, b) => a - b);
    // 7 days selected = no restriction; store null.
    avail_days = uniq.length === 0 || uniq.length === 7 ? null : uniq.join(',');
  }

  const parseTime = (v: unknown): string | null | { error: string } => {
    if (v === undefined || v === null || v === '') return null;
    const s = String(v);
    return TIME_RE.test(s) ? s : { error: 'time must be HH:MM (24h)' };
  };
  const start = parseTime(body.avail_start);
  if (start && typeof start === 'object') return start;
  const end = parseTime(body.avail_end);
  if (end && typeof end === 'object') return end;

  return { avail_days, avail_start: start as string | null, avail_end: end as string | null };
}

// GET /api/categories — flat list, parents first then children ordered by sort_order
router.get('/', (_req: Request, res: Response) => {
  const rows = db.prepare(`
    SELECT * FROM categories
    ORDER BY COALESCE(parent_id, id), sort_order, name
  `).all();
  res.json(rows.map(normalize));
});

// POST /api/categories
router.post('/', (req: Request, res: Response) => {
  const { name, parent_id = null, tax_category: bodyTax, sort_order = 0 } = req.body;

  if (!name?.trim()) return void res.status(400).json({ error: 'name is required' });

  if (bodyTax !== undefined && !['standard', 'reduced'].includes(bodyTax)) {
    return void res.status(400).json({ error: 'invalid tax_category' });
  }

  let tax_category: string;
  if (parent_id !== null) {
    const parent = db.prepare('SELECT id, tax_category FROM categories WHERE id = ?').get(parent_id) as CatRow | undefined;
    if (!parent) return void res.status(400).json({ error: 'parent not found' });
    tax_category = bodyTax ?? parent.tax_category;
  } else {
    tax_category = bodyTax ?? 'standard';
  }

  const conflict = db.prepare('SELECT id FROM categories WHERE name = ?').get(name.trim());
  if (conflict) return void res.status(400).json({ error: 'a category with that name already exists' });

  const avail = parseAvailability(req.body);
  if ('error' in avail) return void res.status(400).json({ error: avail.error });

  const now = new Date().toISOString();
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO categories (name, parent_id, tax_category, sort_order, created_at, avail_days, avail_start, avail_end)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name.trim(), parent_id, tax_category, Number(sort_order), now, avail.avail_days, avail.avail_start, avail.avail_end);

  const row = normalize(db.prepare('SELECT * FROM categories WHERE id = ?').get(lastInsertRowid)!);
  res.status(201).json(row);
});

// PATCH /api/categories/reorder
router.patch('/reorder', (req: Request, res: Response) => {
  const items = req.body as Array<{ id: number; sort_order: number; parent_id: number | null }>;
  if (!Array.isArray(items) || items.length === 0) {
    return void res.status(400).json({ error: 'body must be a non-empty array' });
  }

  // Build proposed parent map for cycle detection
  const parentMap = new Map<number, number | null>(items.map(i => [i.id, i.parent_id]));

  for (const item of items) {
    const seen = new Set<number>();
    let cursor = item.parent_id;
    while (cursor !== null) {
      if (cursor === item.id) {
        return void res.status(400).json({ error: 'circular reference detected' });
      }
      if (seen.has(cursor)) break;
      seen.add(cursor);
      cursor = parentMap.has(cursor) ? (parentMap.get(cursor) ?? null) : null;
    }
  }

  const stmt = db.prepare('UPDATE categories SET sort_order = ?, parent_id = ? WHERE id = ?');
  db.transaction(() => {
    for (const item of items) {
      stmt.run(item.sort_order, item.parent_id, item.id);
    }
  })();

  res.status(204).send();
});

// PUT /api/categories/:id
router.put('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as CatRow | undefined;
  if (!existing) return void res.status(404).json({ error: 'not found' });

  const name      = (req.body.name as string | undefined)?.trim() ?? existing.name;
  const parent_id = 'parent_id' in req.body ? req.body.parent_id : existing.parent_id;
  const sort_order = req.body.sort_order ?? existing.sort_order;

  if (!name) return void res.status(400).json({ error: 'name is required' });

  let tax_category = existing.tax_category;
  if (parent_id !== null) {
    if (parent_id === id) return void res.status(400).json({ error: 'cannot be its own parent' });
    const parent = db.prepare('SELECT id, tax_category FROM categories WHERE id = ?').get(parent_id) as CatRow | undefined;
    if (!parent) return void res.status(400).json({ error: 'parent not found' });
    // cycle detection: walk up from parent — none should be id
    let cursor: CatRow | undefined = parent;
    while (cursor) {
      if (cursor.id === id) return void res.status(400).json({ error: 'circular reference: would create a cycle' });
      cursor = cursor.parent_id !== null
        ? db.prepare('SELECT id, parent_id, tax_category FROM categories WHERE id = ?').get(cursor.parent_id) as CatRow | undefined
        : undefined;
    }
    tax_category = req.body.tax_category ?? parent.tax_category;
  } else {
    const bodyTax = req.body.tax_category;
    if (bodyTax !== undefined && !['standard', 'reduced'].includes(bodyTax)) {
      return void res.status(400).json({ error: 'invalid tax_category' });
    }
    tax_category = bodyTax ?? existing.tax_category;
  }

  const conflict = db.prepare('SELECT id FROM categories WHERE name = ? AND id != ?').get(name, id);
  if (conflict) return void res.status(400).json({ error: 'a category with that name already exists' });

  // Availability is only touched when at least one of its fields is in the body,
  // so callers that don't know about it leave the existing window untouched.
  const existingRow = existing as unknown as Category;
  let avail = { avail_days: existingRow.avail_days, avail_start: existingRow.avail_start, avail_end: existingRow.avail_end };
  if ('avail_days' in req.body || 'avail_start' in req.body || 'avail_end' in req.body) {
    const parsed = parseAvailability(req.body);
    if ('error' in parsed) return void res.status(400).json({ error: parsed.error });
    avail = parsed;
  }

  const now = new Date().toISOString();
  const oldName = existing.name;
  const oldTax  = existing.tax_category;

  db.transaction(() => {
    db.prepare(`
      UPDATE categories SET name = ?, parent_id = ?, tax_category = ?, sort_order = ?, avail_days = ?, avail_start = ?, avail_end = ?
      WHERE id = ?
    `).run(name, parent_id, tax_category, Number(sort_order), avail.avail_days, avail.avail_start, avail.avail_end, id);

    if (name !== oldName) {
      db.prepare('UPDATE products SET category = ?, updated_at = ? WHERE category = ?').run(name, now, oldName);
    }
    if (tax_category !== oldTax) {
      db.prepare('UPDATE products SET tax_category = ?, updated_at = ? WHERE category = ?').run(tax_category, now, name);
    }
  })();

  res.json(normalize(db.prepare('SELECT * FROM categories WHERE id = ?').get(id)!));
});

// DELETE /api/categories/:id
router.delete('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as CatRow | undefined;
  if (!cat) return void res.status(404).json({ error: 'not found' });

  const childCount = (db.prepare('SELECT COUNT(*) as n FROM categories WHERE parent_id = ?').get(id) as { n: number }).n;
  if (childCount > 0) return void res.status(400).json({ error: 'delete subcategories first' });

  const productCount = (db.prepare('SELECT COUNT(*) as n FROM products WHERE category = ? AND available = 1').get(cat.name) as { n: number }).n;
  if (productCount > 0) return void res.status(400).json({ error: `${productCount} active product(s) still use this category` });

  db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  res.json({ id });
});

export default router;
