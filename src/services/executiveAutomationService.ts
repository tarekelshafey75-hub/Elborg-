import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { Storage } from '@google-cloud/storage';
import { desc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { loadErpStateFromDb } from '../db/erpRepository.ts';
import { auditLogs, executiveAutomationConfigs, executiveAutomationRuns } from '../db/schema.ts';
import {
  ExecutiveDigestBundleData,
  generateFinancialPerformanceSummaryPdf,
} from '../utils/executivePdfBuilder.ts';

export interface ExecutiveAutomationConfigRecord {
  id: string;
  gcsBucketName: string;
  monthlyFolderPrefix: string;
  monthlyPdfEnabled: boolean;
  monthlyDayOfMonth: number;
  monthlyHour: number;
  timezone: string;
  weeklyDigestEnabled: boolean;
  weeklyDayOfWeek: number;
  weeklyHour: number;
  weeklyRecipientEmail: string;
  weeklyCcEmails: string;
  weeklyIncludePdf: boolean;
}

export interface ExecutiveAutomationRunRecord {
  id: string;
  runType: 'monthly_pdf' | 'weekly_digest';
  createdAt: string;
  periodKey: string;
  triggerType: string;
  triggeredBy: string;
  status: string;
  storageMode: 'gcs' | 'local_archive';
  bucketName: string;
  objectPath: string;
  gcsUri: string;
  localFilePath: string | null;
  emlFilePath: string | null;
  fileSizeBytes: number;
  checksumSha256: string;
  recipientEmail: string | null;
  emailSubject: string | null;
  emailHtmlPreview: string | null;
  kpiSnapshot: Record<string, unknown> | null;
  riskSnapshot: Record<string, unknown> | null;
  errorMessage: string | null;
}

const LOCAL_ARCHIVE_ROOT = path.resolve('/tmp/estadat-executive-archives');

function sanitizePathSegment(value: string, fallback: string): string {
  const cleaned = value
    .replace(/\\/g, '/')
    .replace(/\.\./g, '')
    .replace(/[^a-zA-Z0-9._/-]/g, '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/{2,}/g, '/');
  return cleaned || fallback;
}

function sanitizeBucketName(value: string, fallback: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '');
  return cleaned.length >= 3 ? cleaned : fallback;
}

function sanitizeEmailHeaderValue(value: string): string {
  return value.replace(/[\r\n\0]/g, '').trim();
}

function isValidEmailAddress(email: string): boolean {
  return /^[^\s@<>(),;:"'\r\n]+@[^\s@<>(),;:"'\r\n]+\.[^\s@<>(),;:"'\r\n]{2,}$/.test(email.trim());
}

function sanitizeRecipientList(raw: string, fallback: string): string {
  const valid = raw
    .split(',')
    .map((s) => sanitizeEmailHeaderValue(s))
    .filter((s) => s.length > 0 && isValidEmailAddress(s));
  return valid.length > 0 ? valid.join(', ') : fallback;
}

function resolveConfinedLocalPath(relativePath: string): string {
  fs.mkdirSync(LOCAL_ARCHIVE_ROOT, { recursive: true });
  const safeRel = relativePath.replace(/^\/+/, '').replace(/\.\./g, '');
  const resolved = path.resolve(LOCAL_ARCHIVE_ROOT, safeRel);
  if (!resolved.startsWith(LOCAL_ARCHIVE_ROOT + path.sep)) {
    throw new Error('Invalid local archive path.');
  }
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  return resolved;
}

function escapeHtml(raw: string | number | null | undefined): string {
  const str = String(raw ?? '');
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtMoneyEn(val: number, dec = 0): string {
  return val.toLocaleString('en-US', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
}

function getDefaultConfig(): ExecutiveAutomationConfigRecord {
  return {
    id: 'default',
    gcsBucketName: sanitizeBucketName(
      process.env.GCS_BACKUP_BUCKET || 'estadat-alborg-erp-backups',
      'estadat-alborg-erp-backups'
    ),
    monthlyFolderPrefix: sanitizePathSegment(
      process.env.GCS_MONTHLY_PDF_PREFIX || 'archives/financial-performance-summary',
      'archives/financial-performance-summary'
    ),
    monthlyPdfEnabled: true,
    monthlyDayOfMonth: 1,
    monthlyHour: 6,
    timezone: 'Africa/Cairo',
    weeklyDigestEnabled: false,
    weeklyDayOfWeek: 0,
    weeklyHour: 8,
    weeklyRecipientEmail: 'tarek.elshafey75@gmail.com',
    weeklyCcEmails: '',
    weeklyIncludePdf: true,
  };
}

function getTimezoneCalendarParts(timeZone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  dayOfWeek: number;
  monthKey: string;
  weekKey: string;
} {
  const now = new Date();
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth() + 1;
  let day = now.getUTCDate();
  let hour = now.getUTCHours();

  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hour12: false,
    }).formatToParts(now);
    const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    year = Number(map.year) || year;
    month = Number(map.month) || month;
    day = Number(map.day) || day;
    hour = Number(map.hour) % 24;
  } catch {
    // keep UTC fallback
  }

  const localMidnightUtc = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = localMidnightUtc.getUTCDay();
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const daysSinceJan1 = Math.floor((localMidnightUtc.getTime() - jan1.getTime()) / 86400000);
  const weekNum = Math.max(1, Math.ceil((daysSinceJan1 + jan1.getUTCDay() + 1) / 7));

  return {
    year,
    month,
    day,
    hour,
    dayOfWeek,
    monthKey: `${year}-${String(month).padStart(2, '0')}`,
    weekKey: `${year}-W${String(weekNum).padStart(2, '0')}`,
  };
}

export async function getOrCreateExecutiveAutomationConfig(): Promise<ExecutiveAutomationConfigRecord> {
  const existing = await db
    .select()
    .from(executiveAutomationConfigs)
    .where(eq(executiveAutomationConfigs.id, 'default'))
    .limit(1);

  if (existing.length > 0) {
    const r = existing[0];
    return {
      id: r.id,
      gcsBucketName: r.gcsBucketName,
      monthlyFolderPrefix: r.monthlyFolderPrefix,
      monthlyPdfEnabled: r.monthlyPdfEnabled,
      monthlyDayOfMonth: r.monthlyDayOfMonth,
      monthlyHour: r.monthlyHour,
      timezone: r.timezone,
      weeklyDigestEnabled: r.weeklyDigestEnabled,
      weeklyDayOfWeek: r.weeklyDayOfWeek,
      weeklyHour: r.weeklyHour,
      weeklyRecipientEmail: r.weeklyRecipientEmail,
      weeklyCcEmails: r.weeklyCcEmails,
      weeklyIncludePdf: r.weeklyIncludePdf,
    };
  }

  const defaults = getDefaultConfig();
  await db
    .insert(executiveAutomationConfigs)
    .values(defaults)
    .onConflictDoNothing({ target: executiveAutomationConfigs.id });
  return defaults;
}

export async function updateExecutiveAutomationConfig(
  patch: Partial<Omit<ExecutiveAutomationConfigRecord, 'id'>>
): Promise<ExecutiveAutomationConfigRecord> {
  const current = await getOrCreateExecutiveAutomationConfig();

  const next: ExecutiveAutomationConfigRecord = {
    id: 'default',
    gcsBucketName:
      patch.gcsBucketName !== undefined
        ? sanitizeBucketName(patch.gcsBucketName, current.gcsBucketName)
        : current.gcsBucketName,
    monthlyFolderPrefix:
      patch.monthlyFolderPrefix !== undefined
        ? sanitizePathSegment(patch.monthlyFolderPrefix, current.monthlyFolderPrefix)
        : current.monthlyFolderPrefix,
    monthlyPdfEnabled:
      patch.monthlyPdfEnabled !== undefined ? Boolean(patch.monthlyPdfEnabled) : current.monthlyPdfEnabled,
    monthlyDayOfMonth:
      patch.monthlyDayOfMonth !== undefined && Number.isFinite(Number(patch.monthlyDayOfMonth))
        ? Math.max(1, Math.min(28, Math.round(Number(patch.monthlyDayOfMonth))))
        : current.monthlyDayOfMonth,
    monthlyHour:
      patch.monthlyHour !== undefined && Number.isFinite(Number(patch.monthlyHour))
        ? Math.max(0, Math.min(23, Math.round(Number(patch.monthlyHour))))
        : current.monthlyHour,
    timezone:
      patch.timezone !== undefined && patch.timezone.trim() ? patch.timezone.trim().slice(0, 64) : current.timezone,
    weeklyDigestEnabled:
      patch.weeklyDigestEnabled !== undefined ? Boolean(patch.weeklyDigestEnabled) : current.weeklyDigestEnabled,
    weeklyDayOfWeek:
      patch.weeklyDayOfWeek !== undefined && Number.isFinite(Number(patch.weeklyDayOfWeek))
        ? Math.max(0, Math.min(6, Math.round(Number(patch.weeklyDayOfWeek))))
        : current.weeklyDayOfWeek,
    weeklyHour:
      patch.weeklyHour !== undefined && Number.isFinite(Number(patch.weeklyHour))
        ? Math.max(0, Math.min(23, Math.round(Number(patch.weeklyHour))))
        : current.weeklyHour,
    weeklyRecipientEmail:
      patch.weeklyRecipientEmail !== undefined
        ? sanitizeRecipientList(patch.weeklyRecipientEmail, current.weeklyRecipientEmail)
        : current.weeklyRecipientEmail,
    weeklyCcEmails:
      patch.weeklyCcEmails !== undefined
        ? patch.weeklyCcEmails.trim() === ''
          ? ''
          : sanitizeRecipientList(patch.weeklyCcEmails, '')
        : current.weeklyCcEmails,
    weeklyIncludePdf:
      patch.weeklyIncludePdf !== undefined ? Boolean(patch.weeklyIncludePdf) : current.weeklyIncludePdf,
  };

  await db
    .insert(executiveAutomationConfigs)
    .values({ ...next, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: executiveAutomationConfigs.id,
      set: {
        gcsBucketName: next.gcsBucketName,
        monthlyFolderPrefix: next.monthlyFolderPrefix,
        monthlyPdfEnabled: next.monthlyPdfEnabled,
        monthlyDayOfMonth: next.monthlyDayOfMonth,
        monthlyHour: next.monthlyHour,
        timezone: next.timezone,
        weeklyDigestEnabled: next.weeklyDigestEnabled,
        weeklyDayOfWeek: next.weeklyDayOfWeek,
        weeklyHour: next.weeklyHour,
        weeklyRecipientEmail: next.weeklyRecipientEmail,
        weeklyCcEmails: next.weeklyCcEmails,
        weeklyIncludePdf: next.weeklyIncludePdf,
        updatedAt: new Date(),
      },
    });

  return next;
}

function mapRunRow(r: typeof executiveAutomationRuns.$inferSelect): ExecutiveAutomationRunRecord {
  return {
    id: r.id,
    runType: r.runType === 'weekly_digest' ? 'weekly_digest' : 'monthly_pdf',
    createdAt: r.createdAt,
    periodKey: r.periodKey,
    triggerType: r.triggerType,
    triggeredBy: r.triggeredBy,
    status: r.status,
    storageMode: r.storageMode === 'gcs' ? 'gcs' : 'local_archive',
    bucketName: r.bucketName,
    objectPath: r.objectPath,
    gcsUri: r.gcsUri,
    localFilePath: r.localFilePath,
    emlFilePath: r.emlFilePath,
    fileSizeBytes: r.fileSizeBytes,
    checksumSha256: r.checksumSha256,
    recipientEmail: r.recipientEmail,
    emailSubject: r.emailSubject,
    emailHtmlPreview: r.emailHtmlPreview,
    kpiSnapshot: r.kpiSnapshot ?? null,
    riskSnapshot: r.riskSnapshot ?? null,
    errorMessage: r.errorMessage,
  };
}

export async function listExecutiveAutomationRuns(limit = 25): Promise<ExecutiveAutomationRunRecord[]> {
  const rows = await db
    .select()
    .from(executiveAutomationRuns)
    .orderBy(desc(executiveAutomationRuns.createdAt))
    .limit(limit);
  return rows.map(mapRunRow);
}

export async function getExecutiveAutomationRunById(id: string): Promise<ExecutiveAutomationRunRecord | null> {
  const rows = await db
    .select()
    .from(executiveAutomationRuns)
    .where(eq(executiveAutomationRuns.id, id))
    .limit(1);
  return rows.length > 0 ? mapRunRow(rows[0]) : null;
}

async function uploadBufferToCloudStorageOrLocal(params: {
  bucketName: string;
  objectPath: string;
  buffer: Buffer;
  contentType: string;
  metadata: Record<string, string>;
}): Promise<{ storageMode: 'gcs' | 'local_archive'; localFilePath: string; errorMessage: string | null }> {
  const localFilePath = resolveConfinedLocalPath(params.objectPath);
  fs.writeFileSync(localFilePath, params.buffer);

  try {
    const storage = new Storage();
    const bucket = storage.bucket(params.bucketName);
    await bucket.file(params.objectPath).save(params.buffer, {
      contentType: params.contentType,
      resumable: false,
      metadata: {
        metadata: params.metadata,
      },
    });
    return { storageMode: 'gcs', localFilePath, errorMessage: null };
  } catch (err: any) {
    const reason = String(err?.message || 'GCS upload unavailable');
    return {
      storageMode: 'local_archive',
      localFilePath,
      errorMessage: `Local archive stored (${reason.slice(0, 140)})`,
    };
  }
}

export async function runMonthlyPdfArchive(options?: {
  triggerType?: 'scheduler' | 'manual';
  triggeredBy?: string;
  periodKey?: string;
}): Promise<ExecutiveAutomationRunRecord> {
  const config = await getOrCreateExecutiveAutomationConfig();
  const cal = getTimezoneCalendarParts(config.timezone);
  const periodKey = options?.periodKey || cal.monthKey;
  const triggerType = options?.triggerType || 'manual';
  const triggeredBy = options?.triggeredBy || 'Executive CFO';

  const erpState = await loadErpStateFromDb();
  const pdfResult = generateFinancialPerformanceSummaryPdf(erpState, {
    periodTag: periodKey,
    reportHeading: 'Financial Performance Summary',
    includeWeeklyDigestNote: false,
  });

  const checksumSha256 = createHash('sha256').update(pdfResult.buffer).digest('hex');
  const runId = `PDF-${periodKey}-${Date.now().toString().slice(-6)}`;
  const objectPath = sanitizePathSegment(
    `${config.monthlyFolderPrefix}/${periodKey}/${runId}_${pdfResult.filename}`,
    `archives/${periodKey}/${pdfResult.filename}`
  );
  const gcsUri = `gs://${config.gcsBucketName}/${objectPath}`;

  const uploadRes = await uploadBufferToCloudStorageOrLocal({
    bucketName: config.gcsBucketName,
    objectPath,
    buffer: pdfResult.buffer,
    contentType: 'application/pdf',
    metadata: {
      periodKey,
      checksumSha256,
      triggerType,
      reportType: 'financial_performance_summary',
    },
  });

  const createdAt = new Date().toISOString();
  const record: ExecutiveAutomationRunRecord = {
    id: runId,
    runType: 'monthly_pdf',
    createdAt,
    periodKey,
    triggerType,
    triggeredBy,
    status: uploadRes.storageMode === 'gcs' ? 'archived_gcs' : 'archived_local',
    storageMode: uploadRes.storageMode,
    bucketName: config.gcsBucketName,
    objectPath,
    gcsUri,
    localFilePath: uploadRes.localFilePath,
    emlFilePath: null,
    fileSizeBytes: pdfResult.buffer.length,
    checksumSha256,
    recipientEmail: null,
    emailSubject: null,
    emailHtmlPreview: null,
    kpiSnapshot: pdfResult.bundleData.kpi as unknown as Record<string, unknown>,
    riskSnapshot: pdfResult.bundleData.riskCounts as unknown as Record<string, unknown>,
    errorMessage: uploadRes.errorMessage,
  };

  await db.insert(executiveAutomationRuns).values({
    id: record.id,
    runType: record.runType,
    createdAt: record.createdAt,
    periodKey: record.periodKey,
    triggerType: record.triggerType,
    triggeredBy: record.triggeredBy,
    status: record.status,
    storageMode: record.storageMode,
    bucketName: record.bucketName,
    objectPath: record.objectPath,
    gcsUri: record.gcsUri,
    localFilePath: record.localFilePath,
    emlFilePath: null,
    fileSizeBytes: record.fileSizeBytes,
    checksumSha256: record.checksumSha256,
    recipientEmail: null,
    emailSubject: null,
    emailHtmlPreview: null,
    kpiSnapshot: record.kpiSnapshot,
    riskSnapshot: record.riskSnapshot,
    errorMessage: record.errorMessage,
  });

  await db.insert(auditLogs).values({
    id: `AUD-${Date.now()}`,
    timestamp: createdAt.slice(0, 16).replace('T', ' '),
    actor: triggeredBy,
    role: 'cfo',
    action: 'أرشفة ملخص الأداء المالي الشهري PDF',
    entityType: 'executive_pdf_archive',
    entityId: record.id,
    details: `${pdfResult.filename} → ${record.gcsUri} (${uploadRes.storageMode})`,
  });

  return record;
}

function buildWeeklyDigestEmailBodies(
  data: ExecutiveDigestBundleData,
  weekKey: string,
  pdfFilename: string | null
): { subject: string; htmlBody: string; textBody: string } {
  const { kpi, risks, riskCounts } = data;
  const subject = sanitizeEmailHeaderValue(
    `[Estadat Al-Borg CFO Digest] Weekly KPI & Risk Status Update (${weekKey})`
  );

  const signedRev = kpi.revMomPct === null ? 'N/A' : `${kpi.revMomPct > 0 ? '+' : ''}${kpi.revMomPct.toFixed(1)}%`;
  const signedGp = kpi.gpMomPct === null ? 'N/A' : `${kpi.gpMomPct > 0 ? '+' : ''}${kpi.gpMomPct.toFixed(1)}%`;
  const signedEbitda =
    kpi.ebitdaMomPct === null ? 'N/A' : `${kpi.ebitdaMomPct > 0 ? '+' : ''}${kpi.ebitdaMomPct.toFixed(1)}%`;

  const riskRowsHtml = risks
    .map((r) => {
      const impactColor =
        r.impact === 'high' ? '#b91c1c' : r.impact === 'medium' ? '#b45309' : '#047857';
      const statusLabel =
        r.status === 'mitigated' ? 'Mitigated' : r.status === 'in_progress' ? 'In Progress' : 'Open';
      return `
        <tr>
          <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-family:monospace;font-weight:700;">${escapeHtml(r.code)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;">
            <div style="font-weight:600;color:#0f172a;">${escapeHtml(r.titleEn)}</div>
            <div style="font-size:11px;color:#475569;">${escapeHtml(r.titleAr)}</div>
          </td>
          <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-weight:700;color:${impactColor};text-transform:uppercase;">${escapeHtml(r.impact)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-weight:600;">${escapeHtml(statusLabel)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:right;font-family:monospace;">${escapeHtml(fmtMoneyEn(r.financialExposureEgp))} EGP</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:11px;color:#334155;">
            <div>${escapeHtml(r.mitigationEn)}</div>
            <div style="color:#0f766e;margin-top:2px;">Latest update: ${escapeHtml(r.latestAuditSummaryEn)}</div>
          </td>
        </tr>`;
    })
    .join('');

  const htmlBody = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <div style="max-width:780px;margin:0 auto;background:#ffffff;border:1px solid #cbd5e1;border-radius:12px;overflow:hidden;">
    <div style="background:#0f172a;color:#ffffff;padding:20px 24px;">
      <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#5eead4;font-weight:700;">
        Estadat Sports Investment — Menoufia Tower Branch
      </div>
      <h1 style="margin:6px 0 4px;font-size:19px;">Weekly Executive KPI &amp; Risk Status Digest (${escapeHtml(weekKey)})</h1>
      <div style="font-size:12px;color:#cbd5e1;">
        Scope: ${escapeHtml(kpi.periodLabel)} | Generated: ${escapeHtml(kpi.generatedAt.slice(0, 16).replace('T', ' '))} UTC
      </div>
    </div>

    <div style="padding:20px 24px;">
      <h2 style="margin:0 0 12px;font-size:14px;color:#0f172a;">1. Weekly KPI Performance Snapshot</h2>
      <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:20px;">
        <thead>
          <tr style="background:#f1f5f9;text-align:left;color:#475569;">
            <th style="padding:8px 10px;border:1px solid #e2e8f0;">KPI Metric</th>
            <th style="padding:8px 10px;border:1px solid #e2e8f0;text-align:right;">Current Figure</th>
            <th style="padding:8px 10px;border:1px solid #e2e8f0;text-align:right;">MoM / Target Context</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding:8px 10px;border:1px solid #e2e8f0;font-weight:600;">Gross Revenue (Incl. VAT) / Net Ex-VAT</td>
            <td style="padding:8px 10px;border:1px solid #e2e8f0;text-align:right;font-family:monospace;font-weight:700;">${escapeHtml(fmtMoneyEn(kpi.grossRevenue))} / ${escapeHtml(fmtMoneyEn(kpi.netRevenue))} EGP</td>
            <td style="padding:8px 10px;border:1px solid #e2e8f0;text-align:right;font-family:monospace;">MoM: ${escapeHtml(signedRev)}</td>
          </tr>
          <tr>
            <td style="padding:8px 10px;border:1px solid #e2e8f0;font-weight:600;">Gross Profit &amp; GP Margin</td>
            <td style="padding:8px 10px;border:1px solid #e2e8f0;text-align:right;font-family:monospace;font-weight:700;color:#047857;">${escapeHtml(fmtMoneyEn(kpi.grossProfit))} EGP (${escapeHtml(kpi.gpMarginPct.toFixed(1))}%)</td>
            <td style="padding:8px 10px;border:1px solid #e2e8f0;text-align:right;font-family:monospace;">MoM: ${escapeHtml(signedGp)} | COGS ${escapeHtml(kpi.cogsPct.toFixed(1))}%</td>
          </tr>
          <tr>
            <td style="padding:8px 10px;border:1px solid #e2e8f0;font-weight:600;">Operating EBITDA (Ex-Usufruct)</td>
            <td style="padding:8px 10px;border:1px solid #e2e8f0;text-align:right;font-family:monospace;font-weight:700;">${escapeHtml(fmtMoneyEn(kpi.ebitdaOperating))} EGP</td>
            <td style="padding:8px 10px;border:1px solid #e2e8f0;text-align:right;font-family:monospace;">Incl. Usufruct: ${escapeHtml(fmtMoneyEn(kpi.ebitdaAccounting))} EGP (${escapeHtml(signedEbitda)})</td>
          </tr>
          <tr>
            <td style="padding:8px 10px;border:1px solid #e2e8f0;font-weight:600;">Treasury &amp; Inventory Position</td>
            <td style="padding:8px 10px;border:1px solid #e2e8f0;text-align:right;font-family:monospace;font-weight:700;">CIB ${escapeHtml(fmtMoneyEn(kpi.cibBankBalance))} EGP</td>
            <td style="padding:8px 10px;border:1px solid #e2e8f0;text-align:right;font-family:monospace;">Inv WAC: ${escapeHtml(fmtMoneyEn(kpi.inventoryValue))} EGP | Live POS: ${escapeHtml(kpi.livePosCount)}</td>
          </tr>
        </tbody>
      </table>

      <h2 style="margin:0 0 8px;font-size:14px;color:#0f172a;">
        2. Risk Register Status Updates (${escapeHtml(riskCounts.total)} Total · ${escapeHtml(riskCounts.highUnmitigated)} High Unmitigated · Exposure ${escapeHtml(fmtMoneyEn(riskCounts.totalExposureEgp))} EGP)
      </h2>
      <table style="width:100%;border-collapse:collapse;font-size:12px;border:1px solid #e2e8f0;">
        <thead>
          <tr style="background:#f1f5f9;text-align:left;color:#475569;">
            <th style="padding:8px 10px;border-bottom:1px solid #cbd5e1;">Code</th>
            <th style="padding:8px 10px;border-bottom:1px solid #cbd5e1;">Risk Item</th>
            <th style="padding:8px 10px;border-bottom:1px solid #cbd5e1;">Impact</th>
            <th style="padding:8px 10px;border-bottom:1px solid #cbd5e1;">Status</th>
            <th style="padding:8px 10px;border-bottom:1px solid #cbd5e1;text-align:right;">Exposure</th>
            <th style="padding:8px 10px;border-bottom:1px solid #cbd5e1;">Mitigation &amp; Audit Note</th>
          </tr>
        </thead>
        <tbody>${riskRowsHtml}</tbody>
      </table>

      <div style="margin-top:18px;padding:12px 14px;background:#f0fdfa;border:1px solid #99f6e4;border-radius:8px;font-size:12px;color:#115e59;">
        <strong>Attached Report:</strong> ${
          pdfFilename
            ? `${escapeHtml(pdfFilename)} (Generated via shared Financial Performance Summary PDF engine)`
            : 'HTML Summary Only (PDF attachment disabled in settings)'
        }
      </div>
    </div>
  </div>
</body>
</html>`;

  const textBody = [
    `ESTADAT AL-BORG FINANCIAL ERP — WEEKLY EXECUTIVE DIGEST (${weekKey})`,
    `Scope: ${kpi.periodLabel}`,
    ``,
    `1. WEEKLY KPI SNAPSHOT`,
    `- Gross Revenue: ${fmtMoneyEn(kpi.grossRevenue)} EGP (Net Ex-VAT: ${fmtMoneyEn(kpi.netRevenue)} EGP, MoM: ${signedRev})`,
    `- Gross Profit: ${fmtMoneyEn(kpi.grossProfit)} EGP (${kpi.gpMarginPct.toFixed(1)}%, MoM: ${signedGp})`,
    `- Operating EBITDA (Ex-Usufruct): ${fmtMoneyEn(kpi.ebitdaOperating)} EGP | Accounting Net Result: ${fmtMoneyEn(kpi.ebitdaAccounting)} EGP (${signedEbitda})`,
    `- CIB Bank (1102): ${fmtMoneyEn(kpi.cibBankBalance)} EGP | Inventory WAC: ${fmtMoneyEn(kpi.inventoryValue)} EGP`,
    ``,
    `2. RISK REGISTER UPDATES (${riskCounts.total} total, ${riskCounts.open} open, ${riskCounts.inProgress} in progress, ${riskCounts.mitigated} mitigated)`,
    ...risks.map(
      (r) =>
        `- [${r.code}] (${r.impact.toUpperCase()} / ${r.status}) ${r.titleEn} | Exposure: ${fmtMoneyEn(r.financialExposureEgp)} EGP | ${r.latestAuditSummaryEn}`
    ),
    ``,
    pdfFilename ? `Attachment: ${pdfFilename}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return { subject, htmlBody, textBody };
}

function wrapBase64Lines(base64: string, lineLength = 76): string {
  const chunks: string[] = [];
  for (let i = 0; i < base64.length; i += lineLength) {
    chunks.push(base64.slice(i, i + lineLength));
  }
  return chunks.join('\r\n');
}

function buildRfc2822EmlBundle(params: {
  to: string;
  cc: string;
  subject: string;
  textBody: string;
  htmlBody: string;
  pdfFilename: string | null;
  pdfBuffer: Buffer | null;
}): Buffer {
  const mixedBoundary = `----=_EstadatMixed_${Date.now().toString(16)}`;
  const altBoundary = `----=_EstadatAlt_${Date.now().toString(16)}`;
  const safeTo = sanitizeEmailHeaderValue(params.to);
  const safeCc = sanitizeEmailHeaderValue(params.cc);
  const safeSubject = sanitizeEmailHeaderValue(params.subject);

  const headers = [
    `From: "Estadat Al-Borg ERP" <noreply@estadat-alborg.erp>`,
    `To: ${safeTo}`,
    safeCc ? `Cc: ${safeCc}` : null,
    `Subject: ${safeSubject}`,
    `Date: ${new Date().toUTCString()}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
  ]
    .filter(Boolean)
    .join('\r\n');

  const parts: string[] = [
    headers,
    '',
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    '',
    `--${altBoundary}`,
    `Content-Type: text/plain; charset="utf-8"`,
    `Content-Transfer-Encoding: base64`,
    '',
    wrapBase64Lines(Buffer.from(params.textBody, 'utf-8').toString('base64')),
    '',
    `--${altBoundary}`,
    `Content-Type: text/html; charset="utf-8"`,
    `Content-Transfer-Encoding: base64`,
    '',
    wrapBase64Lines(Buffer.from(params.htmlBody, 'utf-8').toString('base64')),
    '',
    `--${altBoundary}--`,
  ];

  if (params.pdfFilename && params.pdfBuffer) {
    const safeFile = sanitizePathSegment(path.basename(params.pdfFilename), 'Financial_Performance_Summary.pdf');
    parts.push(
      '',
      `--${mixedBoundary}`,
      `Content-Type: application/pdf; name="${safeFile}"`,
      `Content-Disposition: attachment; filename="${safeFile}"`,
      `Content-Transfer-Encoding: base64`,
      '',
      wrapBase64Lines(params.pdfBuffer.toString('base64'))
    );
  }

  parts.push('', `--${mixedBoundary}--`, '');
  return Buffer.from(parts.join('\r\n'), 'utf-8');
}

export async function runWeeklyExecutiveDigest(options?: {
  triggerType?: 'scheduler' | 'manual';
  triggeredBy?: string;
  weekKey?: string;
}): Promise<ExecutiveAutomationRunRecord> {
  const config = await getOrCreateExecutiveAutomationConfig();
  const cal = getTimezoneCalendarParts(config.timezone);
  const weekKey = options?.weekKey || cal.weekKey;
  const triggerType = options?.triggerType || 'manual';
  const triggeredBy = options?.triggeredBy || 'Executive CFO';

  const erpState = await loadErpStateFromDb();
  const pdfResult = generateFinancialPerformanceSummaryPdf(erpState, {
    periodTag: weekKey,
    reportHeading: 'Weekly Executive KPI & Risk Review',
    includeWeeklyDigestNote: true,
  });

  const pdfFilename = config.weeklyIncludePdf ? pdfResult.filename : null;
  const { subject, htmlBody, textBody } = buildWeeklyDigestEmailBodies(
    pdfResult.bundleData,
    weekKey,
    pdfFilename
  );

  const emlBuffer = buildRfc2822EmlBundle({
    to: config.weeklyRecipientEmail,
    cc: config.weeklyCcEmails,
    subject,
    textBody,
    htmlBody,
    pdfFilename,
    pdfBuffer: config.weeklyIncludePdf ? pdfResult.buffer : null,
  });

  const runId = `DIGEST-${weekKey}-${Date.now().toString().slice(-6)}`;
  const emlFilename = `${runId}_Executive_Weekly_Digest.eml`;
  const pdfObjectPath = sanitizePathSegment(
    `${config.monthlyFolderPrefix}/weekly-digests/${weekKey}/${runId}_${pdfResult.filename}`,
    `weekly-digests/${weekKey}/${pdfResult.filename}`
  );
  const emlObjectPath = sanitizePathSegment(
    `${config.monthlyFolderPrefix}/weekly-digests/${weekKey}/${emlFilename}`,
    `weekly-digests/${weekKey}/${emlFilename}`
  );

  const checksumSha256 = createHash('sha256').update(emlBuffer).digest('hex');

  const pdfUpload = await uploadBufferToCloudStorageOrLocal({
    bucketName: config.gcsBucketName,
    objectPath: pdfObjectPath,
    buffer: pdfResult.buffer,
    contentType: 'application/pdf',
    metadata: { weekKey, runId, type: 'weekly_digest_pdf' },
  });

  const emlUpload = await uploadBufferToCloudStorageOrLocal({
    bucketName: config.gcsBucketName,
    objectPath: emlObjectPath,
    buffer: emlBuffer,
    contentType: 'message/rfc822',
    metadata: {
      weekKey,
      runId,
      recipient: config.weeklyRecipientEmail,
      type: 'weekly_digest_eml',
    },
  });

  const gcsUri = `gs://${config.gcsBucketName}/${emlObjectPath}`;
  const createdAt = new Date().toISOString();

  const record: ExecutiveAutomationRunRecord = {
    id: runId,
    runType: 'weekly_digest',
    createdAt,
    periodKey: weekKey,
    triggerType,
    triggeredBy,
    status: emlUpload.storageMode === 'gcs' ? 'bundled_gcs' : 'bundled_local',
    storageMode: emlUpload.storageMode,
    bucketName: config.gcsBucketName,
    objectPath: emlObjectPath,
    gcsUri,
    localFilePath: pdfUpload.localFilePath,
    emlFilePath: emlUpload.localFilePath,
    fileSizeBytes: emlBuffer.length,
    checksumSha256,
    recipientEmail: config.weeklyRecipientEmail,
    emailSubject: subject,
    emailHtmlPreview: htmlBody,
    kpiSnapshot: pdfResult.bundleData.kpi as unknown as Record<string, unknown>,
    riskSnapshot: pdfResult.bundleData.riskCounts as unknown as Record<string, unknown>,
    errorMessage: emlUpload.errorMessage,
  };

  await db.insert(executiveAutomationRuns).values({
    id: record.id,
    runType: record.runType,
    createdAt: record.createdAt,
    periodKey: record.periodKey,
    triggerType: record.triggerType,
    triggeredBy: record.triggeredBy,
    status: record.status,
    storageMode: record.storageMode,
    bucketName: record.bucketName,
    objectPath: record.objectPath,
    gcsUri: record.gcsUri,
    localFilePath: record.localFilePath,
    emlFilePath: record.emlFilePath,
    fileSizeBytes: record.fileSizeBytes,
    checksumSha256: record.checksumSha256,
    recipientEmail: record.recipientEmail,
    emailSubject: record.emailSubject,
    emailHtmlPreview: record.emailHtmlPreview,
    kpiSnapshot: record.kpiSnapshot,
    riskSnapshot: record.riskSnapshot,
    errorMessage: record.errorMessage,
  });

  await db.insert(auditLogs).values({
    id: `AUD-${Date.now() + 1}`,
    timestamp: createdAt.slice(0, 16).replace('T', ' '),
    actor: triggeredBy,
    role: 'cfo',
    action: 'تجهيز حزمة الملخص الأسبوعي التنفيذي (KPI + المخاطر + PDF)',
    entityType: 'weekly_executive_digest',
    entityId: record.id,
    details: `${config.weeklyRecipientEmail} · ${emlFilename}`,
  });

  return record;
}

export async function getAutomationRunFileForDownload(
  runId: string,
  kind: 'pdf' | 'eml'
): Promise<{ filename: string; contentType: string; buffer: Buffer }> {
  const run = await getExecutiveAutomationRunById(runId);
  if (!run) {
    throw new Error('Automation archive record not found.');
  }

  if (kind === 'pdf') {
    if (run.localFilePath) {
      const resolved = path.resolve(run.localFilePath);
      if (resolved.startsWith(LOCAL_ARCHIVE_ROOT + path.sep) && fs.existsSync(resolved)) {
        return {
          filename: path.basename(resolved),
          contentType: 'application/pdf',
          buffer: fs.readFileSync(resolved),
        };
      }
    }
    const erpState = await loadErpStateFromDb();
    const regenerated = generateFinancialPerformanceSummaryPdf(erpState, {
      periodTag: run.periodKey,
      reportHeading:
        run.runType === 'weekly_digest' ? 'Weekly Executive KPI & Risk Review' : 'Financial Performance Summary',
      includeWeeklyDigestNote: run.runType === 'weekly_digest',
    });
    return {
      filename: regenerated.filename,
      contentType: 'application/pdf',
      buffer: regenerated.buffer,
    };
  }

  // kind === 'eml'
  if (run.emlFilePath) {
    const resolved = path.resolve(run.emlFilePath);
    if (resolved.startsWith(LOCAL_ARCHIVE_ROOT + path.sep) && fs.existsSync(resolved)) {
      return {
        filename: path.basename(resolved),
        contentType: 'message/rfc822',
        buffer: fs.readFileSync(resolved),
      };
    }
  }

  const config = await getOrCreateExecutiveAutomationConfig();
  const erpState = await loadErpStateFromDb();
  const pdfRes = generateFinancialPerformanceSummaryPdf(erpState, {
    periodTag: run.periodKey,
    reportHeading: 'Weekly Executive KPI & Risk Review',
    includeWeeklyDigestNote: true,
  });
  const { subject, htmlBody, textBody } = buildWeeklyDigestEmailBodies(
    pdfRes.bundleData,
    run.periodKey,
    pdfRes.filename
  );
  const emlBuffer = buildRfc2822EmlBundle({
    to: run.recipientEmail || config.weeklyRecipientEmail,
    cc: config.weeklyCcEmails,
    subject,
    textBody,
    htmlBody,
    pdfFilename: pdfRes.filename,
    pdfBuffer: pdfRes.buffer,
  });
  return {
    filename: `${run.id}_Executive_Weekly_Digest.eml`,
    contentType: 'message/rfc822',
    buffer: emlBuffer,
  };
}

let schedulerStarted = false;
let schedulerRunning = false;

export function startExecutiveAutomationScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const tick = async () => {
    if (schedulerRunning) return;
    schedulerRunning = true;
    try {
      const config = await getOrCreateExecutiveAutomationConfig();
      const cal = getTimezoneCalendarParts(config.timezone);
      const recentRuns = await listExecutiveAutomationRuns(30);

      // 1. Check Monthly Financial Performance Summary PDF archival
      if (config.monthlyPdfEnabled && cal.day === config.monthlyDayOfMonth && cal.hour >= config.monthlyHour) {
        const alreadyArchived = recentRuns.some(
          (r) => r.runType === 'monthly_pdf' && r.periodKey === cal.monthKey
        );
        if (!alreadyArchived) {
          await runMonthlyPdfArchive({
            triggerType: 'scheduler',
            triggeredBy: `Monthly Scheduler (${config.timezone})`,
            periodKey: cal.monthKey,
          });
        }
      }

      // 2. Check Weekly Executive Digest bundling
      if (
        config.weeklyDigestEnabled &&
        cal.dayOfWeek === config.weeklyDayOfWeek &&
        cal.hour >= config.weeklyHour
      ) {
        const alreadyBundled = recentRuns.some(
          (r) => r.runType === 'weekly_digest' && r.periodKey === cal.weekKey
        );
        if (!alreadyBundled) {
          await runWeeklyExecutiveDigest({
            triggerType: 'scheduler',
            triggeredBy: `Weekly Digest Scheduler (${config.timezone})`,
            weekKey: cal.weekKey,
          });
        }
      }
    } catch (err) {
      console.error('Executive automation scheduler tick error:', err);
    } finally {
      schedulerRunning = false;
    }
  };

  setTimeout(() => {
    void tick();
  }, 15000);
  setInterval(() => {
    void tick();
  }, 5 * 60 * 1000);
}
