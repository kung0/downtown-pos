import db from './client';

export function initSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT    NOT NULL,
      category     TEXT    NOT NULL,
      price_cents  INTEGER NOT NULL,
      tax_category TEXT    NOT NULL DEFAULT 'standard',
      available    INTEGER NOT NULL DEFAULT 1,
      sort_order   INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT    NOT NULL,
      updated_at   TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tabs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name   TEXT    NOT NULL,
      status          TEXT    NOT NULL DEFAULT 'open',
      opened_at       TEXT    NOT NULL,
      closed_at       TEXT,
      payment_method  TEXT,
      subtotal_cents  INTEGER,
      tip_cents       INTEGER NOT NULL DEFAULT 0,
      total_cents     INTEGER,
      tax_cents       INTEGER,
      void_reason     TEXT,
      voided_at       TEXT,
      original_tab_id INTEGER REFERENCES tabs(id)
      -- TSE + other later columns are added by the ALTER migrations below,
      -- which keeps fresh and upgraded DBs on the same column set.
    );

    CREATE TABLE IF NOT EXISTS line_items (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      tab_id                INTEGER NOT NULL REFERENCES tabs(id),
      product_id            INTEGER REFERENCES products(id),
      name_snapshot         TEXT    NOT NULL,
      price_snapshot_cents  INTEGER NOT NULL,
      tax_category_snapshot TEXT    NOT NULL DEFAULT 'standard',
      quantity              INTEGER NOT NULL DEFAULT 1,
      note                  TEXT,
      kind                  TEXT    NOT NULL DEFAULT 'product',
      created_at            TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pool_tables (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      label      TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'free',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS billiard_sessions (
      id                         INTEGER PRIMARY KEY AUTOINCREMENT,
      tab_id                     INTEGER NOT NULL REFERENCES tabs(id),
      pool_table_id              INTEGER NOT NULL REFERENCES pool_tables(id),
      started_at                 TEXT    NOT NULL,
      ended_at                   TEXT,
      hourly_rate_snapshot_cents INTEGER NOT NULL,
      computed_cost_cents        INTEGER,
      line_item_id               INTEGER REFERENCES line_items(id),
      created_at                 TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      status      TEXT    NOT NULL DEFAULT 'open',
      opened_at   TEXT    NOT NULL,
      closed_at   TEXT
    );

    CREATE TABLE IF NOT EXISTS events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type  TEXT    NOT NULL,
      tab_id      INTEGER REFERENCES tabs(id),
      payload     TEXT    NOT NULL,
      created_at  TEXT    NOT NULL
    );
    CREATE TABLE IF NOT EXISTS categories (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT    NOT NULL UNIQUE,
      parent_id    INTEGER REFERENCES categories(id),
      tax_category TEXT    NOT NULL DEFAULT 'standard',
      sort_order   INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS waitlist (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      pager_number  TEXT NOT NULL,
      customer_name TEXT,
      notes         TEXT,
      status        TEXT NOT NULL DEFAULT 'waiting',
      created_at    TEXT NOT NULL,
      called_at     TEXT,
      resolved_at   TEXT
    );

    CREATE TABLE IF NOT EXISTS product_variants (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id  INTEGER NOT NULL REFERENCES products(id),
      name        TEXT    NOT NULL,
      price_cents INTEGER NOT NULL,
      available   INTEGER NOT NULL DEFAULT 1,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT    NOT NULL
    );
  `);

  // Migrations — safe to run on every startup
  try { db.exec('ALTER TABLE tabs ADD COLUMN tax_standard_cents INTEGER'); } catch {}
  try { db.exec('ALTER TABLE tabs ADD COLUMN tax_reduced_cents INTEGER'); } catch {}
  try { db.exec("ALTER TABLE pool_tables ADD COLUMN type TEXT NOT NULL DEFAULT 'billiard'"); } catch {}
  try { db.exec("ALTER TABLE waitlist ADD COLUMN type TEXT NOT NULL DEFAULT 'billiard'"); } catch {}
  try { db.exec('ALTER TABLE waitlist ADD COLUMN tab_id INTEGER REFERENCES tabs(id)'); } catch {}
  try { db.exec('ALTER TABLE waitlist ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { db.exec('ALTER TABLE tabs ADD COLUMN card_auth_code TEXT'); } catch {}
  try { db.exec('ALTER TABLE tabs ADD COLUMN card_masked_pan TEXT'); } catch {}
  try { db.exec('ALTER TABLE tabs ADD COLUMN session_id INTEGER REFERENCES sessions(id)'); } catch {}
  try { db.exec('ALTER TABLE tabs ADD COLUMN notes TEXT'); } catch {}
  try { db.exec('ALTER TABLE tabs ADD COLUMN tse_signature TEXT'); } catch {}
  try { db.exec('ALTER TABLE tabs ADD COLUMN tse_timestamp TEXT'); } catch {}
  try { db.exec('ALTER TABLE tabs ADD COLUMN tse_transaction_number TEXT'); } catch {}
  try { db.exec('ALTER TABLE tabs ADD COLUMN tse_status TEXT'); } catch {}
  try { db.exec('ALTER TABLE tabs ADD COLUMN subtotal_standard_cents INTEGER'); } catch {}
  try { db.exec('ALTER TABLE tabs ADD COLUMN subtotal_reduced_cents INTEGER'); } catch {}
  try { db.exec('ALTER TABLE tabs ADD COLUMN tse_start_time TEXT'); } catch {}
  try { db.exec('ALTER TABLE tabs ADD COLUMN tse_signature_counter INTEGER'); } catch {}
  try { db.exec('ALTER TABLE products ADD COLUMN has_variants INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { db.exec('ALTER TABLE line_items ADD COLUMN variant_id INTEGER REFERENCES product_variants(id)'); } catch {}
  try { db.exec('ALTER TABLE tabs ADD COLUMN deleted_at TEXT'); } catch {}
  try { db.exec('ALTER TABLE tabs ADD COLUMN discount_cents INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { db.exec('ALTER TABLE products ADD COLUMN is_misc INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { db.exec('ALTER TABLE tabs ADD COLUMN parked INTEGER NOT NULL DEFAULT 0'); } catch {}

  // Set correct tax_category based on product category (idempotent).
  // Food sections → 7% reduced; drink/café sections → 19% standard.
  db.exec(`
    UPDATE products SET tax_category = 'reduced'  WHERE category IN ('Mittagsangebot', 'Finger Food', 'Nudeln - Suppe', 'Nudeln - Trocken', 'Reis', 'Dessert', 'Food', 'Snacks');
    UPDATE products SET tax_category = 'standard' WHERE category IN ('Warm Coffee', 'Iced Coffee', 'Iced Matcha', 'Aperitifs', 'Bier & Wein', 'Cocktails', 'Shots', 'Softdrinks', 'Coffee & Matcha', 'Drinks');
  `);
}
