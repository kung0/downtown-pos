// Wipes the menu (categories / products / variants) and re-inserts it from the
// canonical data in src/db/seed.ts. Historical tabs/line_items are NOT touched —
// closed-tab records keep their immutable name/price snapshots.
//
// Pick the database via DB_FILE (defaults to the production downtown.db):
//   DEV : DB_FILE=downtown.dev.db npx tsx scripts/reseed-menu.ts
//   PROD:                          npx tsx scripts/reseed-menu.ts
//
// Run while the matching server is stopped (or expect WAL contention).
import { initSchema } from '../src/db/schema';
import { reseedMenu } from '../src/db/seed';

const dbFile = process.env.DB_FILE ?? 'downtown.db';
console.log(`reseeding menu in data/${dbFile} …`);
initSchema();        // make sure product_variants etc. exist (older prod DBs)
reseedMenu();
console.log('done.');
