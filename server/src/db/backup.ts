import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import db from './client';

const dataDir = path.join(__dirname, '../../data');
const backupDir = path.join(dataDir, 'backups');
const MAX_BACKUPS = 14;

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
  const files = fs
    .readdirSync(backupDir)
    .filter((f) => f.startsWith('downtown-') && f.endsWith('.db'))
    .sort();

  const excess = files.length - MAX_BACKUPS;
  for (const f of files.slice(0, Math.max(excess, 0))) {
    fs.unlinkSync(path.join(backupDir, f));
    for (const ext of ['-wal', '-shm']) {
      const sidecar = path.join(backupDir, f + ext);
      if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
    }
  }
}
