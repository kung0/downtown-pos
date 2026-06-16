import db from './client';

const CATEGORY_TREE = [
  { parent: 'Getränke', tax: 'standard', children: [
    { name: 'Bier & Wein',    tax: 'standard', sort: 10 },
    { name: 'Aperitifs',      tax: 'standard', sort: 20 },
    { name: 'Cocktails',      tax: 'standard', sort: 30 },
    { name: 'Shots',          tax: 'standard', sort: 40 },
    { name: 'Softdrinks',     tax: 'standard', sort: 50 },
  ]},
  { parent: 'Café', tax: 'standard', children: [
    { name: 'Coffee & Matcha', tax: 'standard', sort: 10 },
  ]},
  { parent: 'Essen', tax: 'reduced', children: [
    { name: 'Food',            tax: 'reduced', sort: 10 },
    { name: 'Snacks',          tax: 'reduced', sort: 20 },
    { name: 'Mittagsangebot',  tax: 'reduced', sort: 30 },
  ]},
] as const;

const PRODUCTS: Array<{
  name: string;
  category: string;
  price_cents: number;
  sort_order: number;
  tax_category?: string;
}> = [
  // ── BIER & WEIN ──────────────────────────────────────────────────────────
  { name: 'Helles vom Fass 0,4l',           category: 'Bier & Wein', price_cents:  450, sort_order:  10 },
  { name: 'Helles 0,5l',                    category: 'Bier & Wein', price_cents:  450, sort_order:  20 },
  { name: 'Pils / Helles / Radler 0,33l',   category: 'Bier & Wein', price_cents:  350, sort_order:  30 },
  { name: 'Hefeweizen hell 0,5l',           category: 'Bier & Wein', price_cents:  450, sort_order:  40 },
  { name: 'Bananenweizen 0,5l',             category: 'Bier & Wein', price_cents:  500, sort_order:  50 },
  { name: 'Apfelwein 0,4l',                category: 'Bier & Wein', price_cents:  500, sort_order:  60 },
  { name: 'Wein (rot/weiß) 0,2l',          category: 'Bier & Wein', price_cents:  600, sort_order:  70 },
  { name: 'Flasche Wein (rot/weiß) 0,75l', category: 'Bier & Wein', price_cents: 1800, sort_order:  80 },

  // ── APERITIFS ─────────────────────────────────────────────────────────────
  { name: 'Aperol Spritz',     category: 'Aperitifs', price_cents: 700, sort_order: 10 },
  { name: 'Campari Spritz',    category: 'Aperitifs', price_cents: 700, sort_order: 20 },
  { name: 'Limoncello Spritz', category: 'Aperitifs', price_cents: 700, sort_order: 30 },
  { name: 'Lillet Wildberry',  category: 'Aperitifs', price_cents: 700, sort_order: 40 },

  // ── COCKTAILS ─────────────────────────────────────────────────────────────
  // Signature
  { name: 'Viet Espresso Martini', category: 'Cocktails', price_cents: 1000, sort_order:  10 },
  { name: 'Lychee Gin Fizz',       category: 'Cocktails', price_cents: 1000, sort_order:  20 },
  { name: 'Fireball Sour',         category: 'Cocktails', price_cents:  800, sort_order:  30 },
  { name: 'White Viet',            category: 'Cocktails', price_cents:  900, sort_order:  40 },
  { name: 'Boozy Sữa Đá',          category: 'Cocktails', price_cents:  800, sort_order:  50 },
  // Classic
  { name: 'Pina Colada',   category: 'Cocktails', price_cents: 900, sort_order:  60 },
  { name: 'Gin Sour',      category: 'Cocktails', price_cents: 900, sort_order:  70 },
  { name: 'Amaretto Sour', category: 'Cocktails', price_cents: 900, sort_order:  80 },
  { name: 'Whiskey Sour',  category: 'Cocktails', price_cents: 900, sort_order:  90 },
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

  // ── SHOTS ─────────────────────────────────────────────────────────────────
  { name: 'Random Shot', category: 'Shots', price_cents: 150, sort_order: 10 },
  { name: 'Shot',        category: 'Shots', price_cents: 250, sort_order: 20 },
  { name: 'Soju',        category: 'Shots', price_cents: 800, sort_order: 30 },

  // ── SOFTDRINKS ────────────────────────────────────────────────────────────
  { name: 'Cola / Fanta / Sprite / Ginger Ale 0,4l', category: 'Softdrinks', price_cents: 400, sort_order:  10 },
  { name: 'Trade Island Iced Tea 0,33l',              category: 'Softdrinks', price_cents: 400, sort_order:  20 },
  { name: 'Hausgemachte Limonade 0,4l',               category: 'Softdrinks', price_cents: 500, sort_order:  30 },
  { name: 'Saft / Schorle 0,4l',                     category: 'Softdrinks', price_cents: 500, sort_order:  40 },
  { name: 'Mate 0,5l',                               category: 'Softdrinks', price_cents: 400, sort_order:  50 },
  { name: 'Redbull',                                 category: 'Softdrinks', price_cents: 400, sort_order:  60 },
  { name: 'Wasser 0,33l',                            category: 'Softdrinks', price_cents: 250, sort_order:  70 },
  { name: 'Wasser 1l',                               category: 'Softdrinks', price_cents: 500, sort_order:  80 },
  { name: 'Tee',                                     category: 'Softdrinks', price_cents: 300, sort_order:  90 },
  // Lunch deal drink addons (standard tax, priced for the Mittagsangebot)
  { name: 'Mittag: Softdrink',          category: 'Softdrinks', price_cents: 300, sort_order: 100 },
  { name: 'Mittag: Hausgemachte Limo',  category: 'Softdrinks', price_cents: 400, sort_order: 110 },

  // ── COFFEE & MATCHA ───────────────────────────────────────────────────────
  // Warm
  { name: 'Flat White',       category: 'Coffee & Matcha', price_cents: 450, sort_order:  10 },
  { name: 'Latte Macchiato',  category: 'Coffee & Matcha', price_cents: 500, sort_order:  20 },
  { name: 'Americano',        category: 'Coffee & Matcha', price_cents: 400, sort_order:  30 },
  { name: 'Double Espresso',  category: 'Coffee & Matcha', price_cents: 350, sort_order:  40 },
  { name: 'Warm Viet Coffee', category: 'Coffee & Matcha', price_cents: 450, sort_order:  50 },
  // Iced Coffee
  { name: 'Salted Cream Viet Iced Coffee',       category: 'Coffee & Matcha', price_cents: 550, sort_order:  60 },
  { name: 'Vietnamese Iced Coffee',              category: 'Coffee & Matcha', price_cents: 450, sort_order:  70 },
  { name: 'Brown Sugar Shaken Viet Iced Coffee', category: 'Coffee & Matcha', price_cents: 450, sort_order:  80 },
  { name: 'Dalgona Coffee',                      category: 'Coffee & Matcha', price_cents: 450, sort_order:  90 },
  { name: 'Iced Latte',                          category: 'Coffee & Matcha', price_cents: 450, sort_order: 100 },
  // Iced Matcha
  { name: 'Coconut Matcha Cloud',    category: 'Coffee & Matcha', price_cents: 600, sort_order: 110 },
  { name: 'Strawberry Matcha Latte', category: 'Coffee & Matcha', price_cents: 550, sort_order: 120 },
  { name: 'Mango Matcha Latte',      category: 'Coffee & Matcha', price_cents: 550, sort_order: 130 },
  { name: 'Matcha Latte',            category: 'Coffee & Matcha', price_cents: 500, sort_order: 140 },
  { name: 'Yuzu Tonic Matcha',       category: 'Coffee & Matcha', price_cents: 600, sort_order: 150 },

  // ── SNACKS (7% reduced) ───────────────────────────────────────────────────
  // Finger Food
  { name: 'Gỏi Cuốn (2 St.)',         category: 'Snacks', price_cents:  500, sort_order:  10 },
  { name: 'Chả Giò (4 St.)',           category: 'Snacks', price_cents:  500, sort_order:  20 },
  { name: 'Bánh Bao',                 category: 'Snacks', price_cents:  500, sort_order:  30 },
  { name: 'Bánh Bao Xá Xíu (2 St.)',  category: 'Snacks', price_cents:  600, sort_order:  40 },
  { name: 'Popcorn Chicken',           category: 'Snacks', price_cents:  900, sort_order:  50 },
  { name: 'Chicken Wings (6 St.)',     category: 'Snacks', price_cents:  900, sort_order:  60 },
  { name: 'Chicken Wings (12 St.)',    category: 'Snacks', price_cents: 1500, sort_order:  70 },
  { name: 'Tofu Bites',               category: 'Snacks', price_cents:  600, sort_order:  80 },
  { name: 'Pommes Frites',            category: 'Snacks', price_cents:  400, sort_order:  90 },
  { name: 'Chips',                    category: 'Snacks', price_cents:  200, sort_order: 100 },
  // Dessert
  { name: 'Homemade Cheesecake',      category: 'Snacks', price_cents:  500, sort_order: 110 },
  { name: 'Cookie',                   category: 'Snacks', price_cents:  200, sort_order: 120 },

  // ── FOOD (7% reduced) ─────────────────────────────────────────────────────
  { name: 'Bánh Mì',                       category: 'Food', price_cents:  800, sort_order:  10 },
  { name: 'Phở Bò',                        category: 'Food', price_cents: 1400, sort_order:  20 },
  { name: 'Bún Bò Huế',                    category: 'Food', price_cents: 1400, sort_order:  30 },
  { name: 'Bún Nước Mắm',                  category: 'Food', price_cents: 1300, sort_order:  40 },
  { name: 'Phở Xào',                       category: 'Food', price_cents: 1300, sort_order:  50 },
  { name: 'Mì Xào',                        category: 'Food', price_cents: 1300, sort_order:  60 },
  { name: 'Cơm Chiên',                     category: 'Food', price_cents: 1300, sort_order:  70 },
  { name: 'Cơm Sườn Trứng',               category: 'Food', price_cents: 1400, sort_order:  80 },
  { name: 'Cơm Tôm Thịt Rim',             category: 'Food', price_cents: 1400, sort_order:  90 },
  { name: 'Cơm Cà Ri',                    category: 'Food', price_cents: 1300, sort_order: 100 },
  // Upcharge for duck / shrimp option on noodle & rice dishes
  { name: '+1€ Aufpreis (Ente/Garnelen)',  category: 'Food', price_cents:  100, sort_order: 110 },

  // ── MITTAGSANGEBOT (Di–Fr 11:30–15:00, 7% reduced) ───────────────────────
  { name: 'Mittag: Phở',                      category: 'Mittagsangebot', price_cents: 1200, sort_order: 10 },
  { name: 'Mittag: Cơm Chiên',                category: 'Mittagsangebot', price_cents: 1100, sort_order: 20 },
  { name: 'Mittag: Cơm Chiên Chay (vegan)',   category: 'Mittagsangebot', price_cents: 1000, sort_order: 30 },
  { name: 'Mittag: Popcorn Chicken + Pommes', category: 'Mittagsangebot', price_cents: 1000, sort_order: 40 },
  { name: 'Mittag: Bánh Mì',                  category: 'Mittagsangebot', price_cents:  700, sort_order: 50 },
];

export function seedIfEmpty(): void {
  const now = new Date().toISOString();

  const categoryCount = (
    db.prepare('SELECT COUNT(*) as n FROM categories').get() as { n: number }
  ).n;

  if (categoryCount === 0) {
    const insertParent = db.prepare(`
      INSERT INTO categories (name, parent_id, tax_category, sort_order, created_at)
      VALUES (?, NULL, ?, ?, ?)
    `);
    const insertChild = db.prepare(`
      INSERT INTO categories (name, parent_id, tax_category, sort_order, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const seedCats = db.transaction(() => {
      let parentSort = 0;
      for (const group of CATEGORY_TREE) {
        parentSort += 10;
        const { lastInsertRowid } = insertParent.run(group.parent, group.tax, parentSort, now);
        for (const child of group.children) {
          insertChild.run(child.name, lastInsertRowid, child.tax, child.sort, now);
        }
      }
    });
    seedCats();
    console.log('  seeded categories');
  }

  const productCount = (
    db.prepare('SELECT COUNT(*) as n FROM products').get() as { n: number }
  ).n;

  if (productCount === 0) {
    const taxFor = (cat: string) =>
      (cat === 'Food' || cat === 'Snacks' || cat === 'Mittagsangebot') ? 'reduced' : 'standard';

    const insert = db.prepare(`
      INSERT INTO products (name, category, price_cents, tax_category, available, sort_order, created_at, updated_at)
      VALUES (@name, @category, @price_cents, @tax_category, 1, @sort_order, @now, @now)
    `);
    const run = db.transaction(() => {
      for (const p of PRODUCTS) {
        const tax_category = p.tax_category ?? taxFor(p.category);
        insert.run({ ...p, tax_category, now });
      }
    });
    run();
    console.log(`  seeded ${PRODUCTS.length} products`);
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

  // Seed (fresh DB) / migrate (older DB) the time-based rate settings these are
  // the only keys read by the app. Idempotent on every startup.
  const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING');
  upsert.run('dart_hourly_rate_cents', '800');
  upsert.run('pool_rate_standard_cents', '1200');
  upsert.run('pool_rate_peak_cents', '1600');
  upsert.run('pool_rate_daytime_discount_cents', '400');
}
