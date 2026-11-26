import 'dotenv/config';
import { pathToFileURL } from 'url';
import { runDatabaseSnapshotBackup } from '../services/backupService.ts';

async function main() {
  const result = await runDatabaseSnapshotBackup({
    triggerType: 'cloud_scheduler',
    triggeredBy: 'CLI / Scheduled Job',
  });
  console.log('Al-Borg ERP PostgreSQL Snapshot Backup Result:', JSON.stringify(result, null, 2));
  process.exit(0);
}

const isDirectEntry = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectEntry) {
  main().catch((err) => {
    console.error('Backup job failed:', err);
    process.exit(1);
  });
}
