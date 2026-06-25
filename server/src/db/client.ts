import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// DB_FILE lets dev point at its own database (downtown.dev.db) so it never
// touches the live till data. Production leaves it unset → downtown.db.
const dbFile = process.env.DB_FILE ?? 'downtown.db';
const db = new Database(path.join(dataDir, dbFile));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export default db;
