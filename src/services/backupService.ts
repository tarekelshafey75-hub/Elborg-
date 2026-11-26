import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { deflateRawSync, gzipSync } from 'zlib';
import { Storage } from '@google-cloud/storage';
import { desc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  auditLogs,
  backupConfigs,
  backupSnapshots,
  bankTransactions,
  diningTables,
  erpMetadata,
  expenses,
  householdEntries,
  ingredients,
  journalEntries,
  kdsOrders,
  menuItems,
  purchaseInvoices,
  representatives,
  salesInvoiceItems,
  salesInvoices,
  stocktakeEntries,
  users,
  wasteEntries,
} from '../db/schema.ts';
import { loadErpStateFromDb } from '../db/erpRepository.ts';
import { computeTrialBalanceTotals, runDataQualityChecks } from '../utils/erpEngine.ts';

export interface BackupConfigRecord {
  id: string;
  bucketName: string;
  prefix: string;
  scheduleCron: string;
  timezone: string;
  retentionDays: number;
  enabled: boolean;
}

export interface BackupSnapshotRecord {
  id: string;
  createdAt: string;
  snapshotDate: string;
  triggerType: string;
  status: string;
  storageMode: string;
  bucketName: string;
  objectPath: string;
  gcsUri: string;
  localFilePath: string | null;
  fileSizeBytes: number;
  checksumSha256: string;
  rowCounts: Record<string, number>;
  trialBalanceBalanced: boolean;
  triggeredBy: string;
  errorMessage: string | null;
}

const LOCAL_BACKUP_DIR = '/tmp/estadat-backups';

function getDefaultConfig(): BackupConfigRecord {
  return {
    id: 'default',
    bucketName: (process.env.GCS_BACKUP_BUCKET || 'estadat-alborg-erp-backups').trim(),
    prefix: (process.env.GCS_BACKUP_PREFIX || 'snapshots/alborg-menoufia').replace(/^\/+|\/+$/g, ''),
    scheduleCron: (process.env.BACKUP_SCHEDULE_CRON || '0 2 * * *').trim(),
    timezone: (process.env.BACKUP_TIMEZONE || 'Africa/Cairo').trim(),
    retentionDays: Number(process.env.BACKUP_RETENTION_DAYS) || 30,
    enabled: true,
  };
}

function getDatePartsInTimezone(timeZone: string): { dateStr: string; hour: number; minute: number } {
  try {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);

    const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    return {
      dateStr: `${map.year}-${map.month}-${map.day}`,
      hour: Number(map.hour) % 24,
      minute: Number(map.minute),
    };
  } catch {
    const now = new Date();
    return {
      dateStr: now.toISOString().slice(0, 10),
      hour: now.getUTCHours(),
      minute: now.getUTCMinutes(),
    };
  }
}

export async function getOrCreateBackupConfig(): Promise<BackupConfigRecord> {
  try {
    const existing = await db.select().from(backupConfigs).where(eq(backupConfigs.id, 'default')).limit(1);
    if (existing.length > 0) {
      const row = existing[0];
      return {
        id: row.id,
        bucketName: row.bucketName,
        prefix: row.prefix,
        scheduleCron: row.scheduleCron,
        timezone: row.timezone,
        retentionDays: row.retentionDays,
        enabled: row.enabled,
      };
    }

    const defaults = getDefaultConfig();
    await db
      .insert(backupConfigs)
      .values(defaults)
      .onConflictDoNothing({ target: backupConfigs.id });
    return defaults;
  } catch (error) {
    console.error('Failed to load backup configuration:', error);
    throw new Error('Failed to load backup configuration.', { cause: error });
  }
}

export async function updateBackupConfig(
  patch: Partial<Omit<BackupConfigRecord, 'id'>>
): Promise<BackupConfigRecord> {
  try {
    const current = await getOrCreateBackupConfig();
    const next: BackupConfigRecord = {
      id: 'default',
      bucketName: patch.bucketName !== undefined ? patch.bucketName.trim() || current.bucketName : current.bucketName,
      prefix:
        patch.prefix !== undefined
          ? patch.prefix.replace(/^\/+|\/+$/g, '') || current.prefix
          : current.prefix,
      scheduleCron: patch.scheduleCron !== undefined ? patch.scheduleCron.trim() || current.scheduleCron : current.scheduleCron,
      timezone: patch.timezone !== undefined ? patch.timezone.trim() || current.timezone : current.timezone,
      retentionDays:
        patch.retentionDays !== undefined && Number.isFinite(Number(patch.retentionDays))
          ? Math.max(1, Math.min(365, Math.round(Number(patch.retentionDays))))
          : current.retentionDays,
      enabled: patch.enabled !== undefined ? Boolean(patch.enabled) : current.enabled,
    };

    await db
      .insert(backupConfigs)
      .values({ ...next, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: backupConfigs.id,
        set: {
          bucketName: next.bucketName,
          prefix: next.prefix,
          scheduleCron: next.scheduleCron,
          timezone: next.timezone,
          retentionDays: next.retentionDays,
          enabled: next.enabled,
          updatedAt: new Date(),
        },
      });

    return next;
  } catch (error) {
    console.error('Failed to update backup configuration:', error);
    throw new Error('Failed to update backup configuration.', { cause: error });
  }
}

export async function listBackupSnapshots(limit = 20): Promise<BackupSnapshotRecord[]> {
  try {
    const rows = await db
      .select()
      .from(backupSnapshots)
      .orderBy(desc(backupSnapshots.createdAt))
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      snapshotDate: r.snapshotDate,
      triggerType: r.triggerType,
      status: r.status,
      storageMode: r.storageMode,
      bucketName: r.bucketName,
      objectPath: r.objectPath,
      gcsUri: r.gcsUri,
      localFilePath: r.localFilePath,
      fileSizeBytes: r.fileSizeBytes,
      checksumSha256: r.checksumSha256,
      rowCounts: r.rowCounts ?? {},
      trialBalanceBalanced: r.trialBalanceBalanced,
      triggeredBy: r.triggeredBy,
      errorMessage: r.errorMessage,
    }));
  } catch (error) {
    console.error('Failed to list backup snapshots:', error);
    throw new Error('Failed to list backup snapshots.', { cause: error });
  }
}

export async function getBackupSnapshotById(id: string): Promise<BackupSnapshotRecord | null> {
  try {
    const rows = await db.select().from(backupSnapshots).where(eq(backupSnapshots.id, id)).limit(1);
    if (!rows.length) return null;
    const r = rows[0];
    return {
      id: r.id,
      createdAt: r.createdAt,
      snapshotDate: r.snapshotDate,
      triggerType: r.triggerType,
      status: r.status,
      storageMode: r.storageMode,
      bucketName: r.bucketName,
      objectPath: r.objectPath,
      gcsUri: r.gcsUri,
      localFilePath: r.localFilePath,
      fileSizeBytes: r.fileSizeBytes,
      checksumSha256: r.checksumSha256,
      rowCounts: r.rowCounts ?? {},
      trialBalanceBalanced: r.trialBalanceBalanced,
      triggeredBy: r.triggeredBy,
      errorMessage: r.errorMessage,
    };
  } catch (error) {
    console.error('Failed to load backup snapshot:', error);
    throw new Error('Failed to load backup snapshot.', { cause: error });
  }
}

async function buildSnapshotPayload() {
  const [
    userRows,
    metaRows,
    ingredientRows,
    menuRows,
    tableRows,
    salesRows,
    salesItemRows,
    purchaseRows,
    expenseRows,
    wasteRows,
    stocktakeRows,
    journalRows,
    bankRows,
    repRows,
    householdRows,
    kdsRows,
    auditRows,
    assembledState,
  ] = await Promise.all([
    db.select({ id: users.id, uid: users.uid, email: users.email, displayName: users.displayName, createdAt: users.createdAt }).from(users),
    db.select().from(erpMetadata),
    db.select().from(ingredients),
    db.select().from(menuItems),
    db.select().from(diningTables),
    db.select().from(salesInvoices),
    db.select().from(salesInvoiceItems),
    db.select().from(purchaseInvoices),
    db.select().from(expenses),
    db.select().from(wasteEntries),
    db.select().from(stocktakeEntries),
    db.select().from(journalEntries),
    db.select().from(bankTransactions),
    db.select().from(representatives),
    db.select().from(householdEntries),
    db.select().from(kdsOrders),
    db.select().from(auditLogs),
    loadErpStateFromDb(),
  ]);

  const trialBalance = computeTrialBalanceTotals(assembledState);
  const dqChecks = runDataQualityChecks(assembledState);
  const qualityFailures = dqChecks.filter((c) => c.status === 'ERROR').length;

  const rowCounts: Record<string, number> = {
    users: userRows.length,
    erp_metadata: metaRows.length,
    ingredients: ingredientRows.length,
    menu_items: menuRows.length,
    dining_tables: tableRows.length,
    sales_invoices: salesRows.length,
    sales_invoice_items: salesItemRows.length,
    purchase_invoices: purchaseRows.length,
    expenses: expenseRows.length,
    waste_entries: wasteRows.length,
    stocktake_entries: stocktakeRows.length,
    journal_entries: journalRows.length,
    bank_transactions: bankRows.length,
    representatives: repRows.length,
    household_entries: householdRows.length,
    kds_orders: kdsRows.length,
    audit_logs: auditRows.length,
  };

  return {
    rowCounts,
    trialBalanceBalanced: trialBalance.balanced,
    totalDebit: trialBalance.totalDebit,
    totalCredit: trialBalance.totalCredit,
    qualityFailures,
    tables: {
      users: userRows,
      erp_metadata: metaRows,
      ingredients: ingredientRows,
      menu_items: menuRows,
      dining_tables: tableRows,
      sales_invoices: salesRows,
      sales_invoice_items: salesItemRows,
      purchase_invoices: purchaseRows,
      expenses: expenseRows,
      waste_entries: wasteRows,
      stocktake_entries: stocktakeRows,
      journal_entries: journalRows,
      bank_transactions: bankRows,
      representatives: repRows,
      household_entries: householdRows,
      kds_orders: kdsRows,
      audit_logs: auditRows,
    },
  };
}

function cleanupOldLocalArchives(retentionDays: number) {
  try {
    if (!fs.existsSync(LOCAL_BACKUP_DIR)) return;
    const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    for (const file of fs.readdirSync(LOCAL_BACKUP_DIR)) {
      if (!file.endsWith('.json.gz')) continue;
      const fullPath = path.join(LOCAL_BACKUP_DIR, file);
      const stat = fs.statSync(fullPath);
      if (stat.mtimeMs < cutoffMs) {
        fs.unlinkSync(fullPath);
      }
    }
  } catch {
    // non-fatal cleanup
  }
}

export async function generateSnapshotBufferForDownload(snapshotId: string): Promise<{
  filename: string;
  buffer: Buffer;
}> {
  const existing = await getBackupSnapshotById(snapshotId);
  if (existing?.localFilePath && fs.existsSync(existing.localFilePath)) {
    return {
      filename: `${snapshotId}.json.gz`,
      buffer: fs.readFileSync(existing.localFilePath),
    };
  }

  // Fallback: attempt GCS download if stored remotely and not cached locally
  if (existing?.storageMode === 'gcs') {
    const storage = new Storage();
    const [contents] = await storage.bucket(existing.bucketName).file(existing.objectPath).download();
    return {
      filename: `${snapshotId}.json.gz`,
      buffer: contents,
    };
  }

  throw new Error('Snapshot archive file is no longer available locally or in Cloud Storage.');
}

let activeBackupPromise: Promise<BackupSnapshotRecord> | null = null;

export async function runDatabaseSnapshotBackup(options: {
  triggerType: 'cloud_scheduler' | 'daily_auto' | 'manual';
  triggeredBy: string;
}): Promise<BackupSnapshotRecord> {
  if (activeBackupPromise) {
    return activeBackupPromise;
  }

  const run = async (): Promise<BackupSnapshotRecord> => {
    const config = await getOrCreateBackupConfig();
    const nowIso = new Date().toISOString();
    const { dateStr } = getDatePartsInTimezone(config.timezone);
    const compactTs = nowIso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const snapshotId = `SNAP-${dateStr.replace(/-/g, '')}-${compactTs.slice(9)}`;
    const objectPath = `${config.prefix}/${dateStr}/${snapshotId}.json.gz`;
    const gcsUri = `gs://${config.bucketName}/${objectPath}`;

    const snapshotPayload = await buildSnapshotPayload();
    const fullDocument = {
      snapshotVersion: '1.0',
      snapshotId,
      createdAt: nowIso,
      snapshotDate: dateStr,
      timezone: config.timezone,
      restaurant: 'Estadat Al-Borg Menoufia ERP',
      databaseEngine: 'PostgreSQL (Cloud SQL)',
      integrity: {
        trialBalanceBalanced: snapshotPayload.trialBalanceBalanced,
        totalDebit: snapshotPayload.totalDebit,
        totalCredit: snapshotPayload.totalCredit,
        qualityFailures: snapshotPayload.qualityFailures,
      },
      rowCounts: snapshotPayload.rowCounts,
      tables: snapshotPayload.tables,
    };

    const rawJson = JSON.stringify(fullDocument);
    const gzipped = gzipSync(Buffer.from(rawJson, 'utf8'), { level: 9 });
    const checksumSha256 = createHash('sha256').update(gzipped).digest('hex');
    const fileSizeBytes = gzipped.byteLength;

    fs.mkdirSync(LOCAL_BACKUP_DIR, { recursive: true });
    const localFilePath = path.join(LOCAL_BACKUP_DIR, `${snapshotId}.json.gz`);
    fs.writeFileSync(localFilePath, gzipped);
    cleanupOldLocalArchives(config.retentionDays);

    let status: 'uploaded_gcs' | 'local_archive_gcs_pending' = 'uploaded_gcs';
    let storageMode: 'gcs' | 'local_archive' = 'gcs';
    let errorMessage: string | null = null;

    try {
      const storage = new Storage();
      const bucket = storage.bucket(config.bucketName);
      await bucket.file(objectPath).save(gzipped, {
        resumable: false,
        contentType: 'application/gzip',
        metadata: {
          contentEncoding: 'gzip',
          metadata: {
            snapshotId,
            snapshotDate: dateStr,
            checksumSha256,
            triggerType: options.triggerType,
            trialBalanceBalanced: String(snapshotPayload.trialBalanceBalanced),
          },
        },
      });

      const latestManifest = {
        snapshotId,
        snapshotDate: dateStr,
        createdAt: nowIso,
        gcsUri,
        fileSizeBytes,
        checksumSha256,
        rowCounts: snapshotPayload.rowCounts,
        trialBalanceBalanced: snapshotPayload.trialBalanceBalanced,
      };
      await bucket
        .file(`${config.prefix}/latest-manifest.json`)
        .save(JSON.stringify(latestManifest, null, 2), {
          resumable: false,
          contentType: 'application/json',
        });
    } catch (gcsError: any) {
      status = 'local_archive_gcs_pending';
      storageMode = 'local_archive';
      const rawMsg = String(gcsError?.message || 'Cloud Storage bucket unavailable');
      errorMessage =
        rawMsg.includes('does not exist') || rawMsg.includes('404')
          ? `GCS bucket "${config.bucketName}" not found yet. Snapshot verified and saved locally; run scripts/setup-cloud-backup.sh to create the bucket.`
          : `GCS upload pending IAM/bucket provisioning (${rawMsg.slice(0, 140)}). Snapshot verified and archived locally.`;
    }

    const record: BackupSnapshotRecord = {
      id: snapshotId,
      createdAt: nowIso,
      snapshotDate: dateStr,
      triggerType: options.triggerType,
      status,
      storageMode,
      bucketName: config.bucketName,
      objectPath,
      gcsUri,
      localFilePath,
      fileSizeBytes,
      checksumSha256,
      rowCounts: snapshotPayload.rowCounts,
      trialBalanceBalanced: snapshotPayload.trialBalanceBalanced,
      triggeredBy: options.triggeredBy,
      errorMessage,
    };

    await db.insert(backupSnapshots).values(record);
    return record;
  };

  activeBackupPromise = run().finally(() => {
    activeBackupPromise = null;
  });
  return activeBackupPromise;
}

function parseScheduleHour(cronExpr: string): number {
  const parts = cronExpr.trim().split(/\s+/);
  const hourPart = parts[1];
  const parsed = Number(hourPart);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 23 ? parsed : 2;
}

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let schedulerWarmupTimeout: ReturnType<typeof setTimeout> | null = null;

export function startDailyBackupScheduler() {
  if (process.env.ENABLE_IN_PROCESS_DAILY_BACKUP === 'false') {
    return;
  }
  if (schedulerInterval || schedulerWarmupTimeout) {
    return;
  }

  const checkAndRunDailySnapshot = async () => {
    try {
      const config = await getOrCreateBackupConfig();
      if (!config.enabled) return;

      const { dateStr, hour } = getDatePartsInTimezone(config.timezone);
      const targetHour = parseScheduleHour(config.scheduleCron);
      if (hour < targetHour) return;

      const recent = await listBackupSnapshots(5);
      const alreadyRanToday = recent.some((snap) => snap.snapshotDate === dateStr);
      if (alreadyRanToday) return;

      await runDatabaseSnapshotBackup({
        triggerType: 'daily_auto',
        triggeredBy: `Daily Scheduler (${config.scheduleCron} ${config.timezone})`,
      });
    } catch (err) {
      console.error('Daily backup scheduler tick failed:', err);
    }
  };

  // Delay initial check by 90s to avoid any startup DB probes
  schedulerWarmupTimeout = setTimeout(() => {
    checkAndRunDailySnapshot();
    schedulerInterval = setInterval(checkAndRunDailySnapshot, 15 * 60 * 1000);
    if (typeof schedulerInterval.unref === 'function') {
      schedulerInterval.unref();
    }
  }, 90 * 1000);

  if (typeof schedulerWarmupTimeout.unref === 'function') {
    schedulerWarmupTimeout.unref();
  }
}

function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let str: string;
  if (value instanceof Date) {
    str = value.toISOString();
  } else if (typeof value === 'object') {
    str = JSON.stringify(value);
  } else {
    str = String(value);
  }
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function rowsToCsv(rows: Record<string, unknown>[], includeBom = true): string {
  const bom = includeBom ? '\uFEFF' : '';
  if (rows.length === 0) {
    return `${bom}(empty table — 0 rows)\r\n`;
  }
  const colSet = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      colSet.add(k);
    }
  }
  const columns = Array.from(colSet);
  const headerLine = columns.map(escapeCsvCell).join(',');
  const dataLines = rows.map((row) => columns.map((col) => escapeCsvCell(row[col])).join(','));
  return `${bom}${[headerLine, ...dataLines].join('\r\n')}\r\n`;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildZipArchive(entries: { name: string; content: Buffer }[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  const now = new Date();
  const dosTime =
    ((now.getHours() & 0x1f) << 11) | ((now.getMinutes() & 0x3f) << 5) | ((now.getSeconds() >> 1) & 0x1f);
  const dosDate =
    (((Math.max(1980, now.getFullYear()) - 1980) & 0x7f) << 9) |
    (((now.getMonth() + 1) & 0x0f) << 5) |
    (now.getDate() & 0x1f);

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const raw = entry.content;
    const compressed = deflateRawSync(raw, { level: 6 });
    const checksum = crc32(raw);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed 2.0
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 flag
    localHeader.writeUInt16LE(8, 8); // deflate compression
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(raw.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuf, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0x0800, 8); // UTF-8 flag
    centralHeader.writeUInt16LE(8, 10); // deflate
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(raw.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + compressed.length;
  }

  const centralDirBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirBuf, eocd]);
}

export async function exportAllPostgresTablesBundle(exportedBy = 'Authenticated User') {
  const [basePayload, configRows, snapRows] = await Promise.all([
    buildSnapshotPayload(),
    db.select().from(backupConfigs),
    db.select().from(backupSnapshots).orderBy(desc(backupSnapshots.createdAt)),
  ]);

  const allTables: Record<string, Record<string, unknown>[]> = {
    ...basePayload.tables,
    backup_configs: configRows as unknown as Record<string, unknown>[],
    backup_snapshots: snapRows as unknown as Record<string, unknown>[],
  };

  const rowCounts: Record<string, number> = {
    ...basePayload.rowCounts,
    backup_configs: configRows.length,
    backup_snapshots: snapRows.length,
  };

  const tableNames = Object.keys(allTables);
  const totalRows = Object.values(rowCounts).reduce((sum, n) => sum + n, 0);
  const exportedAt = new Date().toISOString();

  const jsonDocument = {
    exportVersion: '2.0',
    exportedAt,
    exportedBy,
    restaurant: 'Estadat Al-Borg Menoufia ERP',
    databaseEngine: 'PostgreSQL (Cloud SQL)',
    tableCount: tableNames.length,
    totalRows,
    integrity: {
      trialBalanceBalanced: basePayload.trialBalanceBalanced,
      totalDebit: basePayload.totalDebit,
      totalCredit: basePayload.totalCredit,
      qualityFailures: basePayload.qualityFailures,
    },
    rowCounts,
    tables: allTables,
  };

  const csvTables: Record<string, string> = {};
  const combinedCsvSections: string[] = [
    `# Estadat Al-Borg PostgreSQL Full Database CSV Export`,
    `# Exported At: ${exportedAt}`,
    `# Exported By: ${exportedBy}`,
    `# Tables: ${tableNames.length} | Total Rows: ${totalRows} | Trial Balance Balanced: ${basePayload.trialBalanceBalanced}`,
    '',
  ];

  for (const tableName of tableNames) {
    const rows = allTables[tableName] || [];
    csvTables[tableName] = rowsToCsv(rows, true);
    combinedCsvSections.push(`=== [TABLE: ${tableName}] (${rows.length} rows) ===`);
    combinedCsvSections.push(rowsToCsv(rows, false).trimEnd());
    combinedCsvSections.push('');
  }

  const combinedCsv = `\uFEFF${combinedCsvSections.join('\r\n')}`;
  const fullJsonText = JSON.stringify(jsonDocument, null, 2);

  return {
    exportedAt,
    exportedBy,
    tableCount: tableNames.length,
    totalRows,
    rowCounts,
    integrity: jsonDocument.integrity,
    jsonDocument,
    fullJsonText,
    combinedCsv,
    csvTables,
    allTables,
  };
}

export type FullDatabaseExportFormat = 'zip' | 'json-zip' | 'json' | 'csv';

export async function buildFullDatabaseDownloadPayload(
  format: FullDatabaseExportFormat,
  exportedBy: string
): Promise<{
  filename: string;
  contentType: string;
  buffer: Buffer;
  summary: { tableCount: number; totalRows: number; rowCounts: Record<string, number> };
}> {
  const bundle = await exportAllPostgresTablesBundle(exportedBy);
  const dateStamp = bundle.exportedAt.slice(0, 10);

  if (format === 'json') {
    return {
      filename: `Estadat_AlBorg_PostgreSQL_Full_Data_${dateStamp}.json`,
      contentType: 'application/json; charset=utf-8',
      buffer: Buffer.from(bundle.fullJsonText, 'utf8'),
      summary: { tableCount: bundle.tableCount, totalRows: bundle.totalRows, rowCounts: bundle.rowCounts },
    };
  }

  if (format === 'csv') {
    return {
      filename: `Estadat_AlBorg_PostgreSQL_All_Tables_${dateStamp}.csv`,
      contentType: 'text/csv; charset=utf-8',
      buffer: Buffer.from(bundle.combinedCsv, 'utf8'),
      summary: { tableCount: bundle.tableCount, totalRows: bundle.totalRows, rowCounts: bundle.rowCounts },
    };
  }

  if (format === 'json-zip') {
    const tableFileEntries: { name: string; content: Buffer }[] = [];
    const manifestTables: Array<{
      tableName: string;
      file: string;
      rowCount: number;
      sizeBytes: number;
      sha256: string;
    }> = [];

    for (const [tableName, rows] of Object.entries(bundle.allTables)) {
      const filePath = `${tableName}.json`;
      const tablePayload = {
        table: tableName,
        databaseEngine: 'PostgreSQL (Cloud SQL)',
        restaurant: 'Estadat Al-Borg Menoufia ERP',
        exportedAt: bundle.exportedAt,
        exportedBy: bundle.exportedBy,
        rowCount: rows.length,
        records: rows,
      };
      const jsonBuffer = Buffer.from(JSON.stringify(tablePayload, null, 2), 'utf8');
      const sha256 = createHash('sha256').update(jsonBuffer).digest('hex');

      tableFileEntries.push({
        name: filePath,
        content: jsonBuffer,
      });

      manifestTables.push({
        tableName,
        file: filePath,
        rowCount: rows.length,
        sizeBytes: jsonBuffer.length,
        sha256,
      });
    }

    const manifestBuffer = Buffer.from(
      JSON.stringify(
        {
          auditStandard: 'Estadat Al-Borg External Audit Data Package v1.0',
          exportedAt: bundle.exportedAt,
          exportedBy: bundle.exportedBy,
          databaseEngine: 'PostgreSQL (Cloud SQL)',
          tableCount: bundle.tableCount,
          totalRows: bundle.totalRows,
          integrity: bundle.integrity,
          tables: manifestTables,
        },
        null,
        2
      ),
      'utf8'
    );

    const zipEntries: { name: string; content: Buffer }[] = [
      { name: 'audit_manifest.json', content: manifestBuffer },
      ...tableFileEntries,
    ];

    return {
      filename: `Estadat_AlBorg_PostgreSQL_Audit_JSON_Bundle_${dateStamp}.zip`,
      contentType: 'application/zip',
      buffer: buildZipArchive(zipEntries),
      summary: { tableCount: bundle.tableCount, totalRows: bundle.totalRows, rowCounts: bundle.rowCounts },
    };
  }

  const zipEntries: { name: string; content: Buffer }[] = [
    {
      name: 'manifest.json',
      content: Buffer.from(
        JSON.stringify(
          {
            exportedAt: bundle.exportedAt,
            exportedBy: bundle.exportedBy,
            databaseEngine: 'PostgreSQL (Cloud SQL)',
            tableCount: bundle.tableCount,
            totalRows: bundle.totalRows,
            integrity: bundle.integrity,
            rowCounts: bundle.rowCounts,
          },
          null,
          2
        ),
        'utf8'
      ),
    },
    {
      name: 'all_tables_full.json',
      content: Buffer.from(bundle.fullJsonText, 'utf8'),
    },
    {
      name: 'all_tables_combined.csv',
      content: Buffer.from(bundle.combinedCsv, 'utf8'),
    },
  ];

  for (const [tableName, csvStr] of Object.entries(bundle.csvTables)) {
    zipEntries.push({
      name: `csv/${tableName}.csv`,
      content: Buffer.from(csvStr, 'utf8'),
    });
  }

  for (const [tableName, rows] of Object.entries(bundle.allTables)) {
    zipEntries.push({
      name: `json/${tableName}.json`,
      content: Buffer.from(JSON.stringify(rows, null, 2), 'utf8'),
    });
  }

  return {
    filename: `Estadat_AlBorg_PostgreSQL_JSON_CSV_Bundle_${dateStamp}.zip`,
    contentType: 'application/zip',
    buffer: buildZipArchive(zipEntries),
    summary: { tableCount: bundle.tableCount, totalRows: bundle.totalRows, rowCounts: bundle.rowCounts },
  };
}
