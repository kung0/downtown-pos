import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import Database from 'better-sqlite3';
import db from './client';

const execFileAsync = promisify(execFile);

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

  await writeSnapshot(destFile);
  rotateBackups();
  await pushToMac(destFile);

  return destFile;
}

// Write a consistent, self-contained snapshot of the live DB to destFile, using
// SQLite's online backup API (safe while the DB is in use) and folding the WAL
// back in so the result is one portable file with no -wal/-shm sidecars. Shared
// by runBackup() and the on-demand pull endpoint (routes/export.ts).
export async function writeSnapshot(destFile: string): Promise<void> {
  await db.backup(destFile);
  collapseToSingleFile(destFile);
}

// After each snapshot, push a copy to the home Mac over Tailscale (one-way
// Taildrop). Best-effort: an offline Mac or a Tailscale hiccup must never break
// the backup or the shift close that triggered it — we only log. Set
// TAILSCALE_SYNC_TARGET to the Mac's tailnet name (e.g. "pcx0118") on the bar
// PC; leave it unset (dev machines) to disable. This only ever sends the
// consistent snapshot, never the live WAL-mode downtown.db.
async function pushToMac(snapshot: string): Promise<void> {
  const target = process.env.TAILSCALE_SYNC_TARGET?.trim();
  if (!target) return;

  // Push under a fixed name so the Mac keeps overwriting one file instead of
  // piling up timestamped copies — dev/analysis just points at downtown-latest.db.
  const latest = path.join(backupDir, 'downtown-latest.db');
  fs.copyFileSync(snapshot, latest);

  try {
    await execFileAsync('tailscale', ['file', 'cp', latest, `${target}:`]);
    console.log(`snapshot pushed to ${target} (taildrop)`);
  } catch (err) {
    console.error('taildrop push failed:', err instanceof Error ? err.message : err);
  }
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
