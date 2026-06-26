import { Router } from 'express';
import type { Request, Response } from 'express';
import db from '../db/client';
import { broadcast } from '../ws/server';
import type { Product, ProductVariant } from '@downtown/shared';

const router = Router();

interface ProductRow {
  id: number; name: string; category: string; price_cents: number;
  tax_category: string; available: number; has_variants: number; sort_order: number;
  created_at: string; updated_at: string;
}

interface VariantRow {
  id: number; product_id: number; name: string; price_cents: number;
  available: number; sort_order: number; created_at: string;
}

interface CatRow { name: string; tax_category: string; }

function resolveCategory(category: string): CatRow | undefined {
  return db.prepare('SELECT name, tax_category FROM categories WHERE name = ?').get(category) as CatRow | undefined;
}

function normalize(row: unknown): Product {
  const r = row as ProductRow;
  return { ...r, available: Boolean(r.available), has_variants: Boolean(r.has_variants) } as Product;
}

function normalizeVariant(row: unknown): ProductVariant {
  const r = row as VariantRow;
  return { ...r, available: Boolean(r.available) };
}

function attachVariants(products: Product[]): Product[] {
  if (products.length === 0) return products;
  const variants = db.prepare(
    'SELECT * FROM product_variants ORDER BY sort_order, name'
  ).all() as VariantRow[];
  const byProduct = new Map<number, ProductVariant[]>();
  for (const v of variants) {
    if (!byProduct.has(v.product_id)) byProduct.set(v.product_id, []);
    byProduct.get(v.product_id)!.push(normalizeVariant(v));
  }
  return products.map(p => ({ ...p, variants: byProduct.get(p.id) ?? [] }));
}

router.get('/', (_req: Request, res: Response) => {
  const rows = db.prepare('SELECT * FROM products ORDER BY category, sort_order, name').all();
  res.json(attachVariants(rows.map(normalize)));
});

router.post('/', (req: Request, res: Response) => {
  const { name, category, price_cents, has_variants = false, sort_order = 0 } = req.body;

  if (!name?.trim()) return void res.status(400).json({ error: 'name is required' });
  if (!Number.isInteger(price_cents) || price_cents <= 0) return void res.status(400).json({ error: 'price_cents must be a positive integer' });

  const cat = resolveCategory(category);
  if (!cat) return void res.status(400).json({ error: 'invalid category' });

  const now = new Date().toISOString();
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO products (name, category, price_cents, tax_category, available, has_variants, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
  `).run(name.trim(), category, price_cents, cat.tax_category, has_variants ? 1 : 0, Number(sort_order), now, now);

  const product = attachVariants([normalize(db.prepare('SELECT * FROM products WHERE id = ?').get(lastInsertRowid)!)])[0];
  broadcast({ type: 'menu:product_updated', data: product });
  res.status(201).json(product);
});

router.patch('/reorder', (req: Request, res: Response) => {
  const items = req.body as Array<{ id: number; sort_order: number; category: string }>;
  if (!Array.isArray(items) || items.length === 0) {
    return void res.status(400).json({ error: 'body must be a non-empty array' });
  }

  // Validate all categories exist up front
  for (const item of items) {
    if (!resolveCategory(item.category)) {
      return void res.status(400).json({ error: `invalid category: ${item.category}` });
    }
  }

  const now = new Date().toISOString();
  const stmt = db.prepare(
    'UPDATE products SET sort_order = ?, category = ?, tax_category = ?, updated_at = ? WHERE id = ?'
  );

  db.transaction(() => {
    for (const item of items) {
      const cat = resolveCategory(item.category)!;
      stmt.run(item.sort_order, item.category, cat.tax_category, now, item.id);
    }
  })();

  const updated = items.map(({ id }) =>
    attachVariants([normalize(db.prepare('SELECT * FROM products WHERE id = ?').get(id)!)])[0]
  );
  for (const product of updated) {
    broadcast({ type: 'menu:product_updated', data: product });
  }

  res.status(204).send();
});

router.put('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { name, category, price_cents, has_variants, sort_order = 0 } = req.body;

  if (!name?.trim()) return void res.status(400).json({ error: 'name is required' });
  if (!Number.isInteger(price_cents) || price_cents <= 0) return void res.status(400).json({ error: 'price_cents must be a positive integer' });

  const cat = resolveCategory(category);
  if (!cat) return void res.status(400).json({ error: 'invalid category' });

  const now = new Date().toISOString();
  const hasVariantsVal = has_variants != null ? (has_variants ? 1 : 0) : undefined;

  const { changes } = hasVariantsVal !== undefined
    ? db.prepare(`
        UPDATE products SET name = ?, category = ?, price_cents = ?, tax_category = ?, has_variants = ?, sort_order = ?, updated_at = ?
        WHERE id = ?
      `).run(name.trim(), category, price_cents, cat.tax_category, hasVariantsVal, Number(sort_order), now, id)
    : db.prepare(`
        UPDATE products SET name = ?, category = ?, price_cents = ?, tax_category = ?, sort_order = ?, updated_at = ?
        WHERE id = ?
      `).run(name.trim(), category, price_cents, cat.tax_category, Number(sort_order), now, id);

  if (changes === 0) return void res.status(404).json({ error: 'not found' });

  const product = attachVariants([normalize(db.prepare('SELECT * FROM products WHERE id = ?').get(id)!)])[0];
  broadcast({ type: 'menu:product_updated', data: product });
  res.json(product);
});

router.delete('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);

  const exists = db.prepare('SELECT id FROM products WHERE id = ?').get(id);
  if (!exists) return void res.status(404).json({ error: 'not found' });

  const inUse = db.prepare(
    `SELECT 1 FROM line_items li
     JOIN tabs t ON t.id = li.tab_id
     WHERE li.product_id = ? AND t.status = 'open' LIMIT 1`
  ).get(id);
  if (inUse) return void res.status(409).json({ error: 'Produkt ist in einem offenen Tab — zuerst Tab schließen.' });

  db.transaction(() => {
    db.prepare('UPDATE line_items SET variant_id = NULL WHERE variant_id IN (SELECT id FROM product_variants WHERE product_id = ?)').run(id);
    db.prepare('UPDATE line_items SET product_id = NULL WHERE product_id = ?').run(id);
    db.prepare('DELETE FROM product_variants WHERE product_id = ?').run(id);
    db.prepare('DELETE FROM products WHERE id = ?').run(id);
  })();

  broadcast({ type: 'menu:product_deleted', data: { id } });
  res.status(204).send();
});

router.patch('/:id/availability', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const now = new Date().toISOString();

  const { changes } = db.prepare(
    'UPDATE products SET available = 1 - available, updated_at = ? WHERE id = ?'
  ).run(now, id);

  if (changes === 0) return void res.status(404).json({ error: 'not found' });

  const product = attachVariants([normalize(db.prepare('SELECT * FROM products WHERE id = ?').get(id)!)])[0];
  broadcast({ type: 'menu:product_updated', data: product });
  res.json(product);
});

// ── Variant routes ────────────────────────────────────────────────────────────

router.post('/:id/variants', (req: Request, res: Response) => {
  const productId = Number(req.params.id);
  const { name, price_cents, sort_order = 0 } = req.body;

  if (!name?.trim()) return void res.status(400).json({ error: 'name is required' });
  if (!Number.isInteger(price_cents)) return void res.status(400).json({ error: 'price_cents must be an integer' });

  const exists = db.prepare('SELECT id FROM products WHERE id = ?').get(productId);
  if (!exists) return void res.status(404).json({ error: 'product not found' });

  const now = new Date().toISOString();
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO product_variants (product_id, name, price_cents, available, sort_order, created_at)
    VALUES (?, ?, ?, 1, ?, ?)
  `).run(productId, name.trim(), price_cents, Number(sort_order), now);

  const variant = normalizeVariant(db.prepare('SELECT * FROM product_variants WHERE id = ?').get(lastInsertRowid)!);
  const product = attachVariants([normalize(db.prepare('SELECT * FROM products WHERE id = ?').get(productId)!)])[0];
  broadcast({ type: 'menu:product_updated', data: product });
  res.status(201).json(variant);
});

router.put('/:id/variants/:vid', (req: Request, res: Response) => {
  const productId = Number(req.params.id);
  const variantId = Number(req.params.vid);
  const { name, price_cents, sort_order = 0 } = req.body;

  if (!name?.trim()) return void res.status(400).json({ error: 'name is required' });
  if (!Number.isInteger(price_cents)) return void res.status(400).json({ error: 'price_cents must be an integer' });

  const { changes } = db.prepare(`
    UPDATE product_variants SET name = ?, price_cents = ?, sort_order = ?
    WHERE id = ? AND product_id = ?
  `).run(name.trim(), price_cents, Number(sort_order), variantId, productId);

  if (changes === 0) return void res.status(404).json({ error: 'variant not found' });

  const variant = normalizeVariant(db.prepare('SELECT * FROM product_variants WHERE id = ?').get(variantId)!);
  const product = attachVariants([normalize(db.prepare('SELECT * FROM products WHERE id = ?').get(productId)!)])[0];
  broadcast({ type: 'menu:product_updated', data: product });
  res.json(variant);
});

router.patch('/:id/variants/:vid/availability', (req: Request, res: Response) => {
  const productId = Number(req.params.id);
  const variantId = Number(req.params.vid);

  const { changes } = db.prepare(
    'UPDATE product_variants SET available = 1 - available WHERE id = ? AND product_id = ?'
  ).run(variantId, productId);

  if (changes === 0) return void res.status(404).json({ error: 'variant not found' });

  const variant = normalizeVariant(db.prepare('SELECT * FROM product_variants WHERE id = ?').get(variantId)!);
  const product = attachVariants([normalize(db.prepare('SELECT * FROM products WHERE id = ?').get(productId)!)])[0];
  broadcast({ type: 'menu:product_updated', data: product });
  res.json(variant);
});

router.delete('/:id/variants/:vid', (req: Request, res: Response) => {
  const productId = Number(req.params.id);
  const variantId = Number(req.params.vid);

  const { changes } = db.prepare(
    'DELETE FROM product_variants WHERE id = ? AND product_id = ?'
  ).run(variantId, productId);

  if (changes === 0) return void res.status(404).json({ error: 'variant not found' });

  const product = attachVariants([normalize(db.prepare('SELECT * FROM products WHERE id = ?').get(productId)!)])[0];
  broadcast({ type: 'menu:product_updated', data: product });
  res.json({ id: variantId });
});

export default router;
