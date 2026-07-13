import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import db from './client';

const dataDir = path.join(__dirname, '../../data');
const backupDir = path.join(dataDir, 'backups');
const MAX_AGE_DAYS = 14;
const BACKUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // safety net alongside shift-close backups

export async function runBackup(): Promise<string> {
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destFile = path.join(backupDir, `downtown-${timestamp}.db`);

  await db.backup(destFile);
  collapseToSingleFile(destFile);
  rotateBackups();

  return destFile;
}

// Runs alongside the shift-close trigger so backups don't stop if a shift is
// left open for an unusually long time (or never closed).
export function startBackupLoop(): void {
  setInterval(() => {
    runBackup().catch((err) => console.error('backup failed:', err));
  }, BACKUP_INTERVAL_MS);
}

// db.backup() copies the source's WAL journal mode into the destination too,
// leaving -wal/-shm sidecars next to it. Fold those back in so every backup
// is one self-contained file — otherwise rotation deletes the .db but orphans
// its sidecars.
function collapseToSingleFile(file: string): void {
  const copy = new Database(file);
  copy.pragma('journal_mode = DELETE');
  copy.close();
}

function rotateBackups(): void {
  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const files = fs
    .readdirSync(backupDir)
    .filter((f) => f.startsWith('downtown-') && f.endsWith('.db'));

  for (const f of files) {
    const filePath = path.join(backupDir, f);
    if (fs.statSync(filePath).mtimeMs < cutoff) {
      fs.unlinkSync(filePath);
      for (const ext of ['-wal', '-shm']) {
        const sidecar = filePath + ext;
        if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
      }
    }
  }
}
