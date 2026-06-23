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

  const now = new Date().toISOString();
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO categories (name, parent_id, tax_category, sort_order, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(name.trim(), parent_id, tax_category, Number(sort_order), now);

  const row = normalize(db.prepare('SELECT * FROM categories WHERE id = ?').get(lastInsertRowid)!);
  res.status(201).json(row);
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

  const now = new Date().toISOString();
  const oldName = existing.name;
  const oldTax  = existing.tax_category;

  db.transaction(() => {
    db.prepare(`
      UPDATE categories SET name = ?, parent_id = ?, tax_category = ?, sort_order = ?
      WHERE id = ?
    `).run(name, parent_id, tax_category, Number(sort_order), id);

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
