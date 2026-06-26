import db from './client';

type Tax = 'standard' | 'reduced';

// Variant price_cents is an UPCHARGE (delta) added to the product's base
// price_cents — this matches OrdersPage and the add-to-tab route
// (product.price_cents + variant.price_cents). 0 = same price as base.
interface SeedVariant { name: string; price_cents: number; }

interface SeedProduct {
  name: string;
  category: string;
  price_cents: number; // base price (the "from" price when the product has variants)
  sort_order: number;
  tax_category?: Tax;
  variants?: SeedVariant[];
  is_misc?: boolean;
}

// ── Category tree ────────────────────────────────────────────────────────────
// Parents carry the tax rate for their section; children inherit it. Mirrors the
// printed menu: Essen (7%), Café (19%), Getränke/Bar (19%).
const CATEGORY_TREE = [
  { parent: 'Essen', tax: 'reduced', children: [
    { name: 'Mittagsangebot',   tax: 'reduced', sort: 10 },
    { name: 'Finger Food',      tax: 'reduced', sort: 20 },
    { name: 'Nudeln - Suppe',   tax: 'reduced', sort: 30 },
    { name: 'Nudeln - Trocken', tax: 'reduced', sort: 40 },
    { name: 'Reis',             tax: 'reduced', sort: 50 },
    { name: 'Dessert',          tax: 'reduced', sort: 60 },
  ]},
  { parent: 'Café', tax: 'standard', children: [
    { name: 'Warm Coffee', tax: 'standard', sort: 10 },
    { name: 'Iced Coffee', tax: 'standard', sort: 20 },
    { name: 'Iced Matcha', tax: 'standard', sort: 30 },
  ]},
  { parent: 'Getränke', tax: 'standard', children: [
    { name: 'Aperitifs',   tax: 'standard', sort: 10 },
    { name: 'Bier & Wein', tax: 'standard', sort: 20 },
    { name: 'Cocktails',   tax: 'standard', sort: 30 },
    { name: 'Shots',       tax: 'standard', sort: 40 },
    { name: 'Softdrinks',  tax: 'standard', sort: 50 },
  ]},
  { parent: 'Sonstiges', tax: 'standard', children: [
    { name: 'Sonstiges Essen',    tax: 'reduced',  sort: 10 },
    { name: 'Sonstiges Getränk',  tax: 'standard', sort: 20 },
  ]},
] as const;

// Protein choice shared by the gebraten rice/noodle dishes. Ente/Garnelen +1€.
const proteinVariants: SeedVariant[] = [
  { name: 'Hähnchen', price_cents: 0 },
  { name: 'Rind',     price_cents: 0 },
  { name: 'Tofu',     price_cents: 0 },
  { name: 'Ente',     price_cents: 100 },
  { name: 'Garnelen', price_cents: 100 },
];

// Sauce choice for the fried items — no price difference.
const sauceVariants: SeedVariant[] = [
  { name: 'Red sauce',   price_cents: 0 },
  { name: 'Black sauce', price_cents: 0 },
  { name: 'No sauce',    price_cents: 0 },
];

const PRODUCTS: SeedProduct[] = [
  // ── MITTAGSANGEBOT (Di–Fr 11:30–15:00, 7%) ────────────────────────────────
  { name: 'Phở',                       category: 'Mittagsangebot', price_cents: 1200, sort_order: 10,
    variants: [{ name: 'Rindfleisch', price_cents: 0 }, { name: 'Tofu (Vegan)', price_cents: 0 }] },
  { name: 'Cơm Chiên',                 category: 'Mittagsangebot', price_cents: 1100, sort_order: 20,
    variants: [{ name: 'Hähnchen', price_cents: 0 }, { name: 'Rind', price_cents: 0 },
               { name: 'Ente', price_cents: 100 }, { name: 'Garnelen', price_cents: 100 }] },
  { name: 'Cơm Chiên Chay (Vegan)',    category: 'Mittagsangebot', price_cents: 1000, sort_order: 30 },
  { name: 'Popcorn Chicken with Fries', category: 'Mittagsangebot', price_cents: 1100, sort_order: 40 },
  { name: 'Bánh Mì',                   category: 'Mittagsangebot', price_cents: 700, sort_order: 50,
    variants: [{ name: 'Classic (Schweinefleisch, Pate)', price_cents: 0 }, { name: 'Vegetarisch (Tofu)', price_cents: 0 }] },
  { name: '+ Softdrink (beim Kauf einer Speise)', category: 'Mittagsangebot', price_cents: 300, sort_order: 60,
    variants: [{ name: 'Cola', price_cents: 0 }, { name: 'Fanta', price_cents: 0 },
               { name: 'Sprite', price_cents: 0 }, { name: 'Trade Island Iced Tea', price_cents: 0 }] },
  { name: '+ Hausgemachte Limo (beim Kauf einer Speise)', category: 'Mittagsangebot', price_cents: 400, sort_order: 70 },

  // ── FINGER FOOD / VORSPEISEN (7%) ─────────────────────────────────────────
  { name: 'Gỏi Cuốn (2 St.)',  category: 'Finger Food', price_cents: 500, sort_order: 10,
    variants: [{ name: 'Garnelen', price_cents: 0 }, { name: 'Vegan (Tofu)', price_cents: 0 }] },
  { name: 'Chả Giò (4 St.)',    category: 'Finger Food', price_cents: 500, sort_order: 20,
    variants: [{ name: 'mit Fischsoße', price_cents: 0 }, { name: 'Vegan (Süßsauer-Soße)', price_cents: 0 }] },
  { name: 'Bánh Bao',          category: 'Finger Food', price_cents: 500, sort_order: 30,
    variants: [{ name: 'Fleisch & Ei', price_cents: 0 }, { name: 'Vegan (Tofu & Morcheln)', price_cents: 0 }] },
  { name: 'Bánh Bao Xá Xíu (2 St.)', category: 'Finger Food', price_cents: 600, sort_order: 40 },
  { name: 'Bánh Mì',           category: 'Finger Food', price_cents: 800, sort_order: 50,
    variants: [{ name: 'Schweinefleisch & Pate', price_cents: 0 }, { name: 'Vegan (Tofu)', price_cents: 0 }] },
  { name: 'Popcorn Chicken',    category: 'Finger Food', price_cents: 900, sort_order: 60, variants: sauceVariants },
  { name: 'Chicken Wings (6 St.)',  category: 'Finger Food', price_cents: 900,  sort_order: 70, variants: sauceVariants },
  { name: 'Chicken Wings (12 St.)', category: 'Finger Food', price_cents: 1600, sort_order: 80, variants: sauceVariants },
  { name: 'Tofu Bites',        category: 'Finger Food', price_cents: 600, sort_order: 90, variants: sauceVariants },
  { name: 'Pommes Frites',     category: 'Finger Food', price_cents: 400, sort_order: 100 },
  { name: 'Portion Reis',      category: 'Finger Food', price_cents: 200, sort_order: 110 },
  { name: 'Chips',             category: 'Finger Food', price_cents: 200, sort_order: 120 },

  // ── NUDELN - SUPPE (7%) ───────────────────────────────────────────────────
  { name: 'Phở Bò',     category: 'Nudeln - Suppe', price_cents: 1400, sort_order: 10,
    variants: [{ name: 'Rindfleisch', price_cents: 0 }, { name: 'Vegan (Gemüse & Tofu)', price_cents: 0 }] },
  { name: 'Bún Bò Huế', category: 'Nudeln - Suppe', price_cents: 1400, sort_order: 20 },

  // ── NUDELN - TROCKEN (7%) ─────────────────────────────────────────────────
  { name: 'Bún Nước Mắm', category: 'Nudeln - Trocken', price_cents: 1300, sort_order: 10,
    variants: [{ name: 'Rind', price_cents: 0 }, { name: 'Frühlingsrollen', price_cents: 0 }, { name: 'Vegan', price_cents: 0 }] },
  { name: 'Phở Xào',      category: 'Nudeln - Trocken', price_cents: 1300, sort_order: 20, variants: proteinVariants },
  { name: 'Mì Xào',       category: 'Nudeln - Trocken', price_cents: 1300, sort_order: 30, variants: proteinVariants },

  // ── REIS (7%) ─────────────────────────────────────────────────────────────
  { name: 'Cơm Chiên',        category: 'Reis', price_cents: 1300, sort_order: 10, variants: proteinVariants },
  { name: 'Cơm Sườn Trứng',   category: 'Reis', price_cents: 1400, sort_order: 20 },
  { name: 'Cơm Tôm Thịt Rim', category: 'Reis', price_cents: 1400, sort_order: 30 },
  { name: 'Cơm Cà Ri',        category: 'Reis', price_cents: 1300, sort_order: 40, variants: proteinVariants },

  // ── DESSERT (7%) ──────────────────────────────────────────────────────────
  { name: 'Homemade Rare Cheesecake', category: 'Dessert', price_cents: 500, sort_order: 10 },
  { name: 'Cookie',                   category: 'Dessert', price_cents: 200, sort_order: 20 },

  // ── WARM COFFEE (19%) ─────────────────────────────────────────────────────
  { name: 'Flat White',       category: 'Warm Coffee', price_cents: 450, sort_order: 10 },
  { name: 'Latte Macchiato',  category: 'Warm Coffee', price_cents: 500, sort_order: 20 },
  { name: 'Americano',        category: 'Warm Coffee', price_cents: 400, sort_order: 30 },
  { name: 'Double Espresso',  category: 'Warm Coffee', price_cents: 350, sort_order: 40 },
  { name: 'Warm Viet Coffee', category: 'Warm Coffee', price_cents: 450, sort_order: 50 },

  // ── ICED COFFEE (19%) ─────────────────────────────────────────────────────
  { name: 'Salted Cream Viet Iced Coffee',       category: 'Iced Coffee', price_cents: 550, sort_order: 10 },
  { name: 'Vietnamese Iced Coffee',              category: 'Iced Coffee', price_cents: 450, sort_order: 20 },
  { name: 'Brown Sugar Shaken Viet Iced Coffee', category: 'Iced Coffee', price_cents: 450, sort_order: 30 },
  { name: 'Dalgona Coffee',                      category: 'Iced Coffee', price_cents: 450, sort_order: 40 },
  { name: 'Iced Latte',                          category: 'Iced Coffee', price_cents: 450, sort_order: 50 },

  // ── ICED MATCHA (Ceremonial Grade Uji Matcha, 19%) ────────────────────────
  { name: 'Coconut Matcha Cloud',    category: 'Iced Matcha', price_cents: 600, sort_order: 10 },
  { name: 'Strawberry Matcha Latte', category: 'Iced Matcha', price_cents: 550, sort_order: 20 },
  { name: 'Mango Matcha Latte',      category: 'Iced Matcha', price_cents: 550, sort_order: 30 },
  { name: 'Matcha Latte',            category: 'Iced Matcha', price_cents: 500, sort_order: 40 },
  { name: 'Yuzu Tonic Matcha',       category: 'Iced Matcha', price_cents: 600, sort_order: 50 },

  // ── APERITIFS (19%) ───────────────────────────────────────────────────────
  { name: 'Aperol Spritz',     category: 'Aperitifs', price_cents: 700, sort_order: 10 },
  { name: 'Campari Spritz',    category: 'Aperitifs', price_cents: 700, sort_order: 20 },
  { name: 'Limoncello Spritz', category: 'Aperitifs', price_cents: 700, sort_order: 30 },
  { name: 'Lillet Wildberry',  category: 'Aperitifs', price_cents: 700, sort_order: 40 },

  // ── BIER & WEIN (Schlappeseppel, 19%) ─────────────────────────────────────
  { name: 'Helles vom Fass 0,4l',         category: 'Bier & Wein', price_cents: 450, sort_order: 10 },
  { name: 'Helles 0,5l',                  category: 'Bier & Wein', price_cents: 450, sort_order: 20 },
  { name: 'Pils / Helles / Radler 0,33l', category: 'Bier & Wein', price_cents: 350, sort_order: 30 },
  { name: 'Hefeweizen hell 0,5l',         category: 'Bier & Wein', price_cents: 450, sort_order: 40 },
  { name: 'Bananenweizen 0,5l',           category: 'Bier & Wein', price_cents: 500, sort_order: 50 },
  { name: 'Apfelwein 0,4l',               category: 'Bier & Wein', price_cents: 500, sort_order: 60,
    variants: [{ name: 'süß', price_cents: 0 }, { name: 'sauer', price_cents: 0 },
               { name: 'pur', price_cents: 0 }, { name: 'cola', price_cents: 0 }] },
  { name: 'Wein 0,2l',          category: 'Bier & Wein', price_cents: 600,  sort_order: 70,
    variants: [{ name: 'rot', price_cents: 0 }, { name: 'weiß', price_cents: 0 }] },
  { name: 'Flasche Wein 0,75l', category: 'Bier & Wein', price_cents: 1800, sort_order: 80,
    variants: [{ name: 'rot', price_cents: 0 }, { name: 'weiß', price_cents: 0 }] },

  // ── COCKTAILS (19%) ───────────────────────────────────────────────────────
  // Signature
  { name: 'Viet Espresso Martini', category: 'Cocktails', price_cents: 1000, sort_order: 10 },
  { name: 'Lychee Gin Fizz',       category: 'Cocktails', price_cents: 1000, sort_order: 20 },
  { name: 'Fireball Sour',         category: 'Cocktails', price_cents: 800,  sort_order: 30 },
  { name: 'White Viet',            category: 'Cocktails', price_cents: 900,  sort_order: 40 },
  { name: 'Boozy Sữa Đá',          category: 'Cocktails', price_cents: 800,  sort_order: 50 },
  // Classic
  { name: 'Pina Colada',   category: 'Cocktails', price_cents: 900, sort_order: 60 },
  { name: 'Gin Sour',      category: 'Cocktails', price_cents: 900, sort_order: 70 },
  { name: 'Amaretto Sour', category: 'Cocktails', price_cents: 900, sort_order: 80 },
  { name: 'Whiskey Sour',  category: 'Cocktails', price_cents: 900, sort_order: 90 },
  { name: 'Cuba Libre',    category: 'Cocktails', price_cents: 800, sort_order: 100 },
  { name: 'Caipirinha',    category: 'Cocktails', price_cents: 800, sort_order: 110 },
  { name: 'Mojito',        category: 'Cocktails', price_cents: 800, sort_order: 120 },
  { name: 'Paloma',        category: 'Cocktails', price_cents: 900, sort_order: 130 },
  // Long Drinks
  { name: 'Gin Tonic',          category: 'Cocktails', price_cents: 700, sort_order: 140 },
  { name: 'Jacky Cola',         category: 'Cocktails', price_cents: 700, sort_order: 150 },
  { name: 'Wodka Redbull',      category: 'Cocktails', price_cents: 800, sort_order: 160 },
  { name: 'Skinny Bitch',       category: 'Cocktails', price_cents: 700, sort_order: 170 },
  { name: 'Fireball Apfelsaft', category: 'Cocktails', price_cents: 600, sort_order: 180 },
  { name: 'Rum Cola',           category: 'Cocktails', price_cents: 600, sort_order: 190 },
  // Alcoholfree
  { name: 'Virgin Colada', category: 'Cocktails', price_cents: 700, sort_order: 200 },
  { name: 'Ipanema',       category: 'Cocktails', price_cents: 700, sort_order: 210 },

  // ── SHOTS (19%) ───────────────────────────────────────────────────────────
  { name: 'Random Shot', category: 'Shots', price_cents: 150, sort_order: 10 },
  { name: 'Shot',        category: 'Shots', price_cents: 250, sort_order: 20 },
  { name: 'Soju',        category: 'Shots', price_cents: 800, sort_order: 30,
    variants: [{ name: 'Plum', price_cents: 0 }, { name: 'Strawberry', price_cents: 0 },
               { name: 'Blueberry', price_cents: 0 }, { name: 'Joghurt', price_cents: 0 },
               { name: 'Grape', price_cents: 0 }, { name: 'Apple', price_cents: 0 }] },

  // ── SOFTDRINKS (19%) ──────────────────────────────────────────────────────
  { name: 'Cola / Fanta / Sprite / Ginger Ale / Apfelsaft 0,4l', category: 'Softdrinks', price_cents: 400, sort_order: 10,
    variants: [{ name: 'Cola', price_cents: 0 }, { name: 'Cola Zero', price_cents: 0 },
               { name: 'Fanta', price_cents: 0 }, { name: 'Sprite', price_cents: 0 },
               { name: 'Ginger Ale', price_cents: 0 }, { name: 'Apfelsaft', price_cents: 0 },
               { name: 'Apfelschorle', price_cents: 0 }] },
  { name: 'Trade Island Iced Tea 0,33l', category: 'Softdrinks', price_cents: 400, sort_order: 20,
    variants: [{ name: 'Pfirsich', price_cents: 0 }, { name: 'Pomegranate', price_cents: 0 },
               { name: 'Mango Maracuja', price_cents: 0 }, { name: 'Blaubeeren', price_cents: 0 },
               { name: 'Mint-Lime', price_cents: 0 }, { name: 'Lemon-Lime', price_cents: 0 },
               { name: 'Cherry Cassis (zuckerfrei)', price_cents: 0 }] },
  { name: 'Hausgemachte Limonade 0,4l', category: 'Softdrinks', price_cents: 500, sort_order: 30 },
  { name: 'Saft / Schorle 0,4l',        category: 'Softdrinks', price_cents: 500, sort_order: 40,
    variants: [{ name: 'Orange', price_cents: 0 }, { name: 'Maracuja', price_cents: 0 },
               { name: 'Ananas', price_cents: 0 }, { name: 'Banane', price_cents: 0 }, { name: 'Kirsch', price_cents: 0 }] },
  { name: 'Mate 0,5l', category: 'Softdrinks', price_cents: 400, sort_order: 50,
    variants: [{ name: 'MioMio Original', price_cents: 0 }, { name: 'MioMio Ginger', price_cents: 0 }] },
  { name: 'Redbull',     category: 'Softdrinks', price_cents: 400, sort_order: 60 },
  { name: 'Wasser 0,33l', category: 'Softdrinks', price_cents: 250, sort_order: 70 },
  { name: 'Wasser 1l',    category: 'Softdrinks', price_cents: 500, sort_order: 80 },
  { name: 'Tee',          category: 'Softdrinks', price_cents: 300, sort_order: 90 },

  // ── SONSTIGES (misc catch-all) ────────────────────────────────────────────
  { name: 'Sonstiges Essen',    category: 'Sonstiges Essen',    price_cents: 0, sort_order: 10, is_misc: true, tax_category: 'reduced' },
  { name: 'Sonstiges Getränk',  category: 'Sonstiges Getränk',  price_cents: 0, sort_order: 10, is_misc: true, tax_category: 'standard' },
];

// Maps a category name to its tax rate from the tree above.
const TAX_BY_CATEGORY = new Map<string, Tax>();
for (const group of CATEGORY_TREE) {
  for (const child of group.children) TAX_BY_CATEGORY.set(child.name, child.tax);
}

// Inserts the full category tree + products + variants. Assumes the three
// tables are empty (caller guarantees this — seedIfEmpty guards on counts,
// reseedMenu wipes first).
function insertMenu(now: string): void {
  const insertParent = db.prepare(
    'INSERT INTO categories (name, parent_id, tax_category, sort_order, created_at) VALUES (?, NULL, ?, ?, ?)'
  );
  const insertChild = db.prepare(
    'INSERT INTO categories (name, parent_id, tax_category, sort_order, created_at) VALUES (?, ?, ?, ?, ?)'
  );
  const insertProduct = db.prepare(`
    INSERT INTO products (name, category, price_cents, tax_category, available, has_variants, is_misc, sort_order, created_at, updated_at)
    VALUES (@name, @category, @price_cents, @tax_category, 1, @has_variants, @is_misc, @sort_order, @now, @now)
  `);
  const insertVariant = db.prepare(`
    INSERT INTO product_variants (product_id, name, price_cents, available, sort_order, created_at)
    VALUES (?, ?, ?, 1, ?, ?)
  `);

  let parentSort = 0;
  for (const group of CATEGORY_TREE) {
    parentSort += 10;
    const { lastInsertRowid } = insertParent.run(group.parent, group.tax, parentSort, now);
    for (const child of group.children) {
      insertChild.run(child.name, lastInsertRowid, child.tax, child.sort, now);
    }
  }

  for (const p of PRODUCTS) {
    const tax_category = p.tax_category ?? TAX_BY_CATEGORY.get(p.category) ?? 'standard';
    const has_variants = p.variants && p.variants.length > 0 ? 1 : 0;
    const { lastInsertRowid } = insertProduct.run({
      name: p.name, category: p.category, price_cents: p.price_cents,
      tax_category, has_variants, is_misc: p.is_misc ? 1 : 0, sort_order: p.sort_order, now,
    });
    if (p.variants) {
      p.variants.forEach((v, i) =>
        insertVariant.run(Number(lastInsertRowid), v.name, v.price_cents, (i + 1) * 10, now));
    }
  }
}

// Wipes and re-inserts the menu (categories / products / variants) to match the
// current printed menu. Used by scripts/reseed-menu.ts. Foreign keys are turned
// off during the wipe so products still referenced by historical line_items can
// be deleted — those line_items keep their immutable name/price snapshots and
// are untouched.
export function reseedMenu(): void {
  const now = new Date().toISOString();
  db.pragma('foreign_keys = OFF');
  const tx = db.transaction(() => {
    db.exec('DELETE FROM product_variants; DELETE FROM products; DELETE FROM categories;');
    insertMenu(now);
  });
  tx();
  db.pragma('foreign_keys = ON');
  const pc = (db.prepare('SELECT COUNT(*) n FROM products').get() as { n: number }).n;
  const vc = (db.prepare('SELECT COUNT(*) n FROM product_variants').get() as { n: number }).n;
  const cc = (db.prepare('SELECT COUNT(*) n FROM categories').get() as { n: number }).n;
  console.log(`  reseeded menu: ${cc} categories, ${pc} products, ${vc} variants`);
}

export function seedIfEmpty(): void {
  const now = new Date().toISOString();

  const categoryCount = (db.prepare('SELECT COUNT(*) as n FROM categories').get() as { n: number }).n;
  const productCount = (db.prepare('SELECT COUNT(*) as n FROM products').get() as { n: number }).n;

  if (categoryCount === 0 && productCount === 0) {
    db.transaction(() => insertMenu(now))();
    console.log(`  seeded ${CATEGORY_TREE.length} category groups + ${PRODUCTS.length} products`);
  }

  // Ensure misc catch-all products exist (migration for DBs seeded before this feature).
  const miscEssen = db.prepare("SELECT id FROM products WHERE is_misc = 1 AND name = 'Sonstiges Essen'").get();
  if (!miscEssen) {
    let parentId = (db.prepare("SELECT id FROM categories WHERE name = 'Sonstiges' AND parent_id IS NULL").get() as { id: number } | undefined)?.id;
    if (!parentId) {
      parentId = Number((db.prepare("INSERT INTO categories (name, parent_id, tax_category, sort_order, created_at) VALUES ('Sonstiges', NULL, 'standard', 999, ?)").run(now)).lastInsertRowid);
    }
    const getOrInsertChild = (name: string, tax: string, sort: number): void => {
      const exists = db.prepare('SELECT id FROM categories WHERE name = ? AND parent_id = ?').get(name, parentId);
      if (!exists) db.prepare('INSERT INTO categories (name, parent_id, tax_category, sort_order, created_at) VALUES (?, ?, ?, ?, ?)').run(name, parentId, tax, sort, now);
    };
    getOrInsertChild('Sonstiges Essen',   'reduced',  10);
    getOrInsertChild('Sonstiges Getränk', 'standard', 20);
    db.prepare(`INSERT INTO products (name, category, price_cents, tax_category, available, has_variants, is_misc, sort_order, created_at, updated_at) VALUES (?, ?, 0, ?, 1, 0, 1, 10, ?, ?)`).run('Sonstiges Essen',   'Sonstiges Essen',   'reduced',  now, now);
    db.prepare(`INSERT INTO products (name, category, price_cents, tax_category, available, has_variants, is_misc, sort_order, created_at, updated_at) VALUES (?, ?, 0, ?, 1, 0, 1, 10, ?, ?)`).run('Sonstiges Getränk', 'Sonstiges Getränk', 'standard', now, now);
    console.log('  seeded misc catch-all products');
  }

  const insertTable = db.prepare(
    'INSERT INTO pool_tables (label, type, status, created_at) VALUES (?, ?, ?, ?)'
  );

  const billiardCount = (
    db.prepare("SELECT COUNT(*) as n FROM pool_tables WHERE type = 'billiard'").get() as { n: number }
  ).n;
  if (billiardCount === 0) {
    for (let i = 1; i <= 5; i++) insertTable.run(`Table ${i}`, 'billiard', 'free', now);
    console.log('  seeded 5 pool tables');
  }

  const dartCount = (
    db.prepare("SELECT COUNT(*) as n FROM pool_tables WHERE type = 'dart'").get() as { n: number }
  ).n;
  if (dartCount === 0) {
    insertTable.run('Dart', 'dart', 'free', now);
    console.log('  seeded 1 dart board');
  }

  // Seed (fresh DB) / migrate (older DB) the time-based rate settings — these are
  // the only keys read by the app. Idempotent on every startup.
  const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING');
  upsert.run('dart_hourly_rate_cents', '800');
  upsert.run('pool_rate_standard_cents', '1200');
  upsert.run('pool_rate_peak_cents', '1600');
  upsert.run('pool_rate_daytime_discount_cents', '400');
}
