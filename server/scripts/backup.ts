// Manually snapshot the database — the same backup that runs automatically
// after every shift close (see src/routes/sessions.ts). Useful for testing
// or for grabbing an on-demand snapshot outside a shift close.
//
// Pick the database via DB_FILE (defaults to the production downtown.db):
//   DEV : DB_FILE=downtown.dev.db npx tsx scripts/backup.ts
//   PROD:                          npx tsx scripts/backup.ts
import { runBackup } from '../src/db/backup';

runBackup()
  .then((file) => {
    console.log(`backup written to ${file}`);
  })
  .catch((err) => {
    console.error('backup failed:', err);
    process.exit(1);
  });
