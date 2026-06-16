import { Router } from 'express';
import type { Request, Response } from 'express';
import db from '../db/client';
import { broadcast } from '../ws/server';
import type { Product } from '@downtown/shared';

const router = Router();

interface ProductRow {
  id: number; name: string; category: string; price_cents: number;
  tax_category: string; available: number; sort_order: number;
  created_at: string; updated_at: string;
}

interface CatRow { name: string; tax_category: string; }

function resolveCategory(category: string): CatRow | undefined {
  return db.prepare('SELECT name, tax_category FROM categories WHERE name = ?').get(category) as CatRow | undefined;
}

function normalize(row: unknown): Product {
  const r = row as ProductRow;
  return { ...r, available: Boolean(r.available) } as Product;
}

router.get('/', (_req: Request, res: Response) => {
  const rows = db.prepare('SELECT * FROM products ORDER BY category, sort_order, name').all();
  res.json(rows.map(normalize));
});

router.post('/', (req: Request, res: Response) => {
  const { name, category, price_cents, sort_order = 0 } = req.body;

  if (!name?.trim()) return void res.status(400).json({ error: 'name is required' });
  if (!Number.isInteger(price_cents) || price_cents <= 0) return void res.status(400).json({ error: 'price_cents must be a positive integer' });

  const cat = resolveCategory(category);
  if (!cat) return void res.status(400).json({ error: 'invalid category' });

  const now = new Date().toISOString();
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO products (name, category, price_cents, tax_category, available, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?, ?)
  `).run(name.trim(), category, price_cents, cat.tax_category, Number(sort_order), now, now);

  const product = normalize(db.prepare('SELECT * FROM products WHERE id = ?').get(lastInsertRowid)!);
  broadcast({ type: 'menu:product_updated', data: product });
  res.status(201).json(product);
});

router.put('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { name, category, price_cents, sort_order = 0 } = req.body;

  if (!name?.trim()) return void res.status(400).json({ error: 'name is required' });
  if (!Number.isInteger(price_cents) || price_cents <= 0) return void res.status(400).json({ error: 'price_cents must be a positive integer' });

  const cat = resolveCategory(category);
  if (!cat) return void res.status(400).json({ error: 'invalid category' });

  const now = new Date().toISOString();
  const { changes } = db.prepare(`
    UPDATE products SET name = ?, category = ?, price_cents = ?, tax_category = ?, sort_order = ?, updated_at = ?
    WHERE id = ?
  `).run(name.trim(), category, price_cents, cat.tax_category, Number(sort_order), now, id);

  if (changes === 0) return void res.status(404).json({ error: 'not found' });

  const product = normalize(db.prepare('SELECT * FROM products WHERE id = ?').get(id)!);
  broadcast({ type: 'menu:product_updated', data: product });
  res.json(product);
});

router.patch('/:id/availability', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const now = new Date().toISOString();

  const { changes } = db.prepare(
    'UPDATE products SET available = 1 - available, updated_at = ? WHERE id = ?'
  ).run(now, id);

  if (changes === 0) return void res.status(404).json({ error: 'not found' });

  const product = normalize(db.prepare('SELECT * FROM products WHERE id = ?').get(id)!);
  broadcast({ type: 'menu:product_updated', data: product });
  res.json(product);
});

export default router;
