import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  CloudUpload,
  Database,
  Download,
  FileCode2,
  FileSpreadsheet,
  HardDrive,
  Loader2,
  Play,
  Printer,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Table2,
  Upload,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { ErpState, Language } from '../types/erp';
import { runDataQualityChecks } from '../utils/erpEngine';
import { t } from '../utils/formatters';

interface BackupConfigView {
  id: string;
  bucketName: string;
  prefix: string;
  scheduleCron: string;
  timezone: string;
  retentionDays: number;
  enabled: boolean;
}

interface BackupSnapshotView {
  id: string;
  createdAt: string;
  snapshotDate: string;
  triggerType: string;
  status: string;
  storageMode: string;
  bucketName: string;
  objectPath: string;
  gcsUri: string;
  fileSizeBytes: number;
  checksumSha256: string;
  rowCounts: Record<string, number>;
  trialBalanceBalanced: boolean;
  triggeredBy: string;
  errorMessage: string | null;
}

interface DbExportSummary {
  exportedAt: string;
  databaseEngine: string;
  tableCount: number;
  totalRows: number;
  rowCounts: Record<string, number>;
  integrity: {
    trialBalanceBalanced: boolean;
    totalDebit: number;
    totalCredit: number;
    qualityFailures: number;
  };
}

interface DataQualityExportModuleProps {
  state: ErpState;
  lang: Language;
  onExportExcel: () => void;
  onResetState: () => Promise<void>;
  onStartMigration?: () => void;
  onOpenPrintCenter?: () => void;
}

export const DataQualityExportModule: React.FC<DataQualityExportModuleProps> = ({
  state,
  lang,
  onExportExcel,
  onResetState,
  onStartMigration,
  onOpenPrintCenter,
}) => {
  const { authFetch } = useAuth();
  const [subTab, setSubTab] = useState<'dq' | 'backups' | 'excel' | 'audit' | 'architecture'>('dq');
  const [importedPreview, setImportedPreview] = useState<{ sheetName: string; headers: string[]; rows: unknown[][] } | null>(null);
  const [backupConfig, setBackupConfig] = useState<BackupConfigView | null>(null);
  const [backupSnapshots, setBackupSnapshots] = useState<BackupSnapshotView[]>([]);
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupRunning, setBackupRunning] = useState(false);
  const [backupSaving, setBackupSaving] = useState(false);
  const [backupFeedback, setBackupFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [dbSummary, setDbSummary] = useState<DbExportSummary | null>(null);
  const [dbSummaryLoading, setDbSummaryLoading] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<'zip' | 'json-zip' | 'json' | 'csv' | null>(null);
  const [dbExportFeedback, setDbExportFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const checks = useMemo(() => runDataQualityChecks(state), [state]);

  const loadBackupStatus = useCallback(async () => {
    setBackupLoading(true);
    try {
      const res = await authFetch('/api/erp/backups/status');
      if (res.ok) {
        const data = await res.json();
        if (data?.config) setBackupConfig(data.config);
        if (Array.isArray(data?.snapshots)) setBackupSnapshots(data.snapshots);
      }
    } catch {
      setBackupFeedback({
        type: 'err',
        text: t(lang, 'تعذر تحميل سجل النسخ الاحتياطي.', 'Unable to load backup history.'),
      });
    } finally {
      setBackupLoading(false);
    }
  }, [authFetch, lang]);

  const loadDbExportSummary = useCallback(async () => {
    setDbSummaryLoading(true);
    try {
      const res = await authFetch('/api/erp/export/full-database/summary');
      if (res.ok) {
        const data = (await res.json()) as DbExportSummary;
        setDbSummary(data);
      }
    } catch {
      // ignore initial summary fetch errors
    } finally {
      setDbSummaryLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    if (subTab === 'backups') {
      loadBackupStatus();
    }
    if (subTab === 'excel' || subTab === 'dq') {
      loadDbExportSummary();
    }
  }, [subTab, loadBackupStatus, loadDbExportSummary]);

  const handleExportFullDatabase = async (format: 'zip' | 'json-zip' | 'json' | 'csv') => {
    setExportingFormat(format);
    setDbExportFeedback(null);
    try {
      const res = await authFetch(`/api/erp/export/full-database?format=${format}`);
      if (!res.ok) {
        const errPayload = await res.json().catch(() => ({}));
        throw new Error(errPayload?.error || 'Export failed');
      }

      const tableCount = res.headers.get('X-Export-Table-Count') || String(dbSummary?.tableCount ?? 16);
      const totalRows = res.headers.get('X-Export-Total-Rows') || String(dbSummary?.totalRows ?? 0);
      const disposition = res.headers.get('Content-Disposition') || '';
      const nameMatch = disposition.match(/filename="([^"]+)"/);
      const fallbackExt = format === 'zip' || format === 'json-zip' ? 'zip' : format === 'json' ? 'json' : 'csv';
      const filename =
        nameMatch?.[1] ||
        `Estadat_AlBorg_PostgreSQL_Full_Data_${new Date().toISOString().slice(0, 10)}.${fallbackExt}`;

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setDbExportFeedback({
        type: 'ok',
        text: t(
          lang,
          `تم تصدير جميع جداول PostgreSQL (${tableCount} جدول / ${totalRows} سجل) في الملف ${filename}`,
          `Exported all ${tableCount} PostgreSQL tables (${totalRows} rows) into ${filename}`
        ),
      });
      loadDbExportSummary();
    } catch (err: any) {
      setDbExportFeedback({
        type: 'err',
        text:
          err?.message ||
          t(lang, 'تعذر تصدير حزمة قاعدة بيانات PostgreSQL.', 'Unable to export PostgreSQL database bundle.'),
      });
    } finally {
      setExportingFormat(null);
    }
  };

  const handleSaveBackupConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!backupConfig) return;
    setBackupSaving(true);
    setBackupFeedback(null);
    try {
      const res = await authFetch('/api/erp/backups/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(backupConfig),
      });
      if (res.ok) {
        const data = await res.json();
        setBackupConfig(data.config);
        setBackupFeedback({
          type: 'ok',
          text: t(lang, 'تم حفظ إعدادات الجدولة وحاوية التخزين السحابي.', 'Cloud Storage backup schedule saved.'),
        });
      } else {
        throw new Error('Failed to save');
      }
    } catch {
      setBackupFeedback({
        type: 'err',
        text: t(lang, 'تعذر حفظ إعدادات النسخ الاحتياطي.', 'Failed to save backup schedule.'),
      });
    } finally {
      setBackupSaving(false);
    }
  };

  const handleRunBackupNow = async () => {
    setBackupRunning(true);
    setBackupFeedback(null);
    try {
      const res = await authFetch('/api/erp/backups/run', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data?.snapshot) {
        setBackupSnapshots((prev) => [data.snapshot, ...prev.filter((s) => s.id !== data.snapshot.id)]);
        if (data.config) setBackupConfig(data.config);
        setBackupFeedback({
          type: 'ok',
          text:
            data.snapshot.storageMode === 'gcs'
              ? t(
                  lang,
                  `تم تصدير النسخة ${data.snapshot.id} ورفعها إلى Cloud Storage بنجاح.`,
                  `Snapshot ${data.snapshot.id} exported and uploaded to Cloud Storage.`
                )
              : t(
                  lang,
                  `تم حفظ النسخة ${data.snapshot.id} محلياً مع فحص التكامل (بانتظار تفعيل حاوية GCS).`,
                  `Snapshot ${data.snapshot.id} verified and archived locally (GCS bucket provisioning pending).`
                ),
        });
      } else {
        throw new Error(data?.error || 'Backup failed');
      }
    } catch (err: any) {
      setBackupFeedback({
        type: 'err',
        text: err?.message || t(lang, 'فشل إنشاء اللقطة الاحتياطية.', 'Snapshot export failed.'),
      });
    } finally {
      setBackupRunning(false);
    }
  };

  const handleDownloadSnapshot = async (snapshotId: string) => {
    try {
      const res = await authFetch(`/api/erp/backups/${encodeURIComponent(snapshotId)}/download`);
      if (!res.ok) {
        throw new Error('Download failed');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${snapshotId}.json.gz`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setBackupFeedback({
        type: 'err',
        text: t(lang, 'تعذر تحميل ملف النسخة الاحتياطية.', 'Unable to download snapshot archive.'),
      });
    }
  };

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf);
    const firstSheet = wb.SheetNames[0];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[firstSheet], { header: 1 });
    const headers = (aoa[0] || []).map(String);
    const rows = aoa.slice(1, 9);
    setImportedPreview({ sheetName: firstSheet, headers, rows });
  };

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-teal-700 dark:text-teal-400" />
            {t(lang, 'جودة البيانات، التصدير الشامل وبنية النظام', 'Data Quality Audit, Full DB Export & Architecture')}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {t(
              lang,
              'فحوصات التدقيق الآلية + تصدير حزمة PostgreSQL الكاملة (JSON/CSV) + مصنف Excel + سجل المراجعة غير القابل للحذف',
              'Automated ledger integrity checks + Full PostgreSQL JSON/CSV bundle + Excel workbook + Immutable audit trail'
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 no-print">
          {onOpenPrintCenter && (
            <button
              type="button"
              onClick={onOpenPrintCenter}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors"
            >
              <Printer className="w-4 h-4" />
              <span>{t(lang, 'طباعة كل الملفات (A4 / PDF)', 'Print All Files (A4 / PDF)')}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>{t(lang, 'طباعة التقرير', 'Print')}</span>
          </button>

          <button
            type="button"
            onClick={() => handleExportFullDatabase('json-zip')}
            disabled={exportingFormat !== null}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors"
            title={t(
              lang,
              'تحميل حزمة ZIP تحتوي على ملفات JSON منفصلة لكل جدول PostgreSQL للتدقيق الخارجي',
              'Download ZIP archive with separate JSON files for every PostgreSQL table for external audit'
            )}
          >
            {exportingFormat === 'json-zip' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Archive className="w-4 h-4" />
            )}
            <span>
              {exportingFormat === 'json-zip'
                ? t(lang, 'جاري تجهيز حزمة التدقيق...', 'Preparing Audit ZIP...')
                : t(lang, 'حزمة البيانات الكاملة (ZIP - JSON منفصل)', 'Full Data Bundle (JSON ZIP)')}
            </span>
          </button>

          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg overflow-x-auto">
            {(
              [
                { id: 'dq', ar: 'فحص جودة البيانات', en: 'Data Quality' },
                { id: 'backups', ar: 'النسخ الاحتياطي Cloud Storage', en: 'Cloud Backups & DR' },
                { id: 'excel', ar: 'التصدير الشامل و ETL', en: 'Full Export & ETL' },
                { id: 'audit', ar: 'سجل التدقيق', en: 'Audit Trail' },
                { id: 'architecture', ar: 'المخطط النجمي والـ API', en: 'Star Schema & APIs' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSubTab(tab.id)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  subTab === tab.id
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {lang === 'ar' ? tab.ar : tab.en}
              </button>
            ))}
          </div>
        </div>
      </div>

      {dbExportFeedback && (
        <div
          className={`px-4 py-3 rounded-xl border text-xs flex items-center justify-between gap-3 ${
            dbExportFeedback.type === 'ok'
              ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
              : 'bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
          }`}
        >
          <span className="flex items-center gap-2 font-medium">
            {dbExportFeedback.type === 'ok' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
            )}
            <span>{dbExportFeedback.text}</span>
          </span>
          <button
            type="button"
            onClick={() => setSubTab('excel')}
            className="text-xs font-bold underline whitespace-nowrap shrink-0 cursor-pointer"
          >
            {t(lang, 'خيارات JSON / CSV الفردية', 'JSON / CSV Options')}
          </button>
        </div>
      )}

      {/* TAB 1: DATA QUALITY CHECKS */}
      {subTab === 'dq' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-slate-900">
              {t(lang, 'تقرير جودة البيانات والتطابق المحاسبي (DATA_QUALITY)', 'Automated Data Quality & Reconciliation Audit')}
            </h2>
            <div className="flex items-center gap-2">
              {onStartMigration && (
                <button
                  onClick={onStartMigration}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-teal-700 hover:bg-teal-800 text-xs font-semibold text-white transition-colors"
                >
                  <Database className="w-3.5 h-3.5" />
                  {t(lang, 'ترحيل إلى PostgreSQL', 'Migrate to PostgreSQL')}
                </button>
              )}
              <button
                onClick={onResetState}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {t(lang, 'إعادة ضبط لبيانات Q1 الأساسية', 'Reset to Q1 Baseline')}
              </button>
            </div>
          </div>
          <div className="divide-y divide-slate-100">
            {checks.map((c) => (
              <div key={c.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                  {c.status === 'PASS' ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                  ) : c.status === 'WARN' ? (
                    <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <div className="text-xs font-bold text-slate-900">
                      <span className="font-mono-num text-slate-500 me-2" dir="ltr">{c.code}</span>
                      {lang === 'ar' ? c.titleAr : c.titleEn}
                    </div>
                    <div className="text-xs text-slate-600 mt-0.5">
                      {lang === 'ar' ? c.detailAr : c.detailEn}
                    </div>
                  </div>
                </div>
                <div className="text-end shrink-0">
                  <div
                    className={`text-xs font-bold ${
                      c.status === 'PASS' ? 'text-emerald-700' : c.status === 'WARN' ? 'text-amber-700' : 'text-red-600'
                    }`}
                  >
                    {c.status}
                  </div>
                  <div className="text-xs font-mono-num text-slate-700 mt-0.5" dir="ltr">{c.metricValue}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 1B: CLOUD STORAGE DAILY SNAPSHOT BACKUPS & DISASTER RECOVERY */}
      {subTab === 'backups' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <CloudUpload className="w-4 h-4 text-teal-700" />
                  {t(
                    lang,
                    'النسخ الاحتياطي اليومي التلقائي إلى Google Cloud Storage (Disaster Recovery)',
                    'Daily Cloud Storage Snapshot Schedule & Disaster Recovery'
                  )}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {t(
                    lang,
                    'تصدير لقطة مضغوطة يومياً لجميع جداول فرع البرج مع بصمة SHA-256 والتحقق من اتزان القيود.',
                    'Daily compressed (.json.gz) relational snapshots with SHA-256 checksums and trial balance verification.'
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={loadBackupStatus}
                  disabled={backupLoading}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${backupLoading ? 'animate-spin' : ''}`} />
                  {t(lang, 'تحديث', 'Refresh')}
                </button>
                <button
                  type="button"
                  onClick={handleRunBackupNow}
                  disabled={backupRunning}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold disabled:opacity-60 transition-colors"
                >
                  {backupRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  {t(lang, 'تصدير نسخة احتياطية الآن', 'Export Snapshot Now')}
                </button>
              </div>
            </div>

            {backupFeedback && (
              <div
                className={`p-3 rounded-lg border text-xs flex items-center gap-2 ${
                  backupFeedback.type === 'ok'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-red-50 border-red-200 text-red-800'
                }`}
              >
                {backupFeedback.type === 'ok' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                )}
                <span>{backupFeedback.text}</span>
              </div>
            )}

            {backupConfig && (
              <form onSubmit={handleSaveBackupConfig} className="grid grid-cols-1 md:grid-cols-5 gap-3 pt-2 border-t border-slate-100">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    {t(lang, 'حاوية Cloud Storage (Bucket)', 'GCS Bucket Name')}
                  </label>
                  <input
                    type="text"
                    value={backupConfig.bucketName}
                    onChange={(e) => setBackupConfig({ ...backupConfig, bucketName: e.target.value })}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-mono-num"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    {t(lang, 'مسار المجلد (Prefix)', 'Object Prefix')}
                  </label>
                  <input
                    type="text"
                    value={backupConfig.prefix}
                    onChange={(e) => setBackupConfig({ ...backupConfig, prefix: e.target.value })}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-mono-num"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    {t(lang, 'جدول التشغيل (Cron)', 'Daily Cron (Africa/Cairo)')}
                  </label>
                  <input
                    type="text"
                    value={backupConfig.scheduleCron}
                    onChange={(e) => setBackupConfig({ ...backupConfig, scheduleCron: e.target.value })}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-mono-num"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    {t(lang, 'مدة الاحتفاظ (أيام)', 'Retention (Days)')}
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={backupConfig.retentionDays}
                    onChange={(e) =>
                      setBackupConfig({ ...backupConfig, retentionDays: Number(e.target.value) || 30 })
                    }
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-mono-num"
                    dir="ltr"
                  />
                </div>
                <div className="flex items-end justify-between gap-2">
                  <label className="flex items-center gap-2 text-xs font-medium text-slate-700 pb-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={backupConfig.enabled}
                      onChange={(e) => setBackupConfig({ ...backupConfig, enabled: e.target.checked })}
                      className="rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                    />
                    {t(lang, 'مفعل يومياً', 'Daily Active')}
                  </label>
                  <button
                    type="submit"
                    disabled={backupSaving}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-800"
                  >
                    <Save className="w-3.5 h-3.5" />
                    {t(lang, 'حفظ', 'Save')}
                  </button>
                </div>
              </form>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-teal-700" />
                {t(lang, 'سجل اللقطات الاحتياطية والتعافي من الكوارث', 'Snapshot Export History & Recovery Archives')}
              </h3>
              <span className="text-xs text-slate-500 font-mono-num" dir="ltr">
                {backupSnapshots.length} snapshots
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'المعرف والتوقيت', 'Snapshot & Time')}</th>
                    <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'المشغل', 'Trigger')}</th>
                    <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'مسار التخزين السحابي', 'GCS Destination URI')}</th>
                    <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'الحجم / البصمة', 'Size / SHA-256')}</th>
                    <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'الحالة', 'Status')}</th>
                    <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'استعادة', 'Recovery')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {backupSnapshots.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-500">
                        {backupLoading
                          ? t(lang, 'جاري تحميل سجل النسخ الاحتياطي...', 'Loading snapshot history...')
                          : t(
                              lang,
                              'لا توجد لقطات بعد — اضغط "تصدير نسخة احتياطية الآن" لإنشاء أول نسخة.',
                              'No snapshots yet — click "Export Snapshot Now" to create the first backup.'
                            )}
                      </td>
                    </tr>
                  ) : (
                    backupSnapshots.map((snap) => {
                      const totalRows = Object.values(snap.rowCounts || {}).reduce((acc, n) => acc + n, 0);
                      return (
                        <tr key={snap.id} className="hover:bg-slate-50">
                          <td className="py-2.5 px-4">
                            <div className="font-mono-num font-bold text-slate-900" dir="ltr">{snap.id}</div>
                            <div className="font-mono-num text-[11px] text-slate-500" dir="ltr">
                              {snap.createdAt.slice(0, 19).replace('T', ' ')} UTC
                            </div>
                          </td>
                          <td className="py-2.5 px-4">
                            <div className="font-medium text-slate-800">{snap.triggerType}</div>
                            <div className="text-[11px] text-slate-500">{snap.triggeredBy}</div>
                          </td>
                          <td className="py-2.5 px-4 max-w-[260px]">
                            <div className="font-mono-num text-[11px] text-slate-700 truncate" dir="ltr" title={snap.gcsUri}>
                              {snap.gcsUri}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {totalRows} {t(lang, 'سجل', 'rows')} ·{' '}
                              {snap.trialBalanceBalanced
                                ? t(lang, 'ميزان متزن', 'Balanced')
                                : t(lang, 'غير متزن', 'Unbalanced')}
                            </div>
                          </td>
                          <td className="py-2.5 px-4 font-mono-num" dir="ltr">
                            <div className="text-slate-900 font-semibold">
                              {(snap.fileSizeBytes / 1024).toFixed(1)} KB
                            </div>
                            <div className="text-[11px] text-slate-500">{snap.checksumSha256.slice(0, 12)}…</div>
                          </td>
                          <td className="py-2.5 px-4">
                            {snap.storageMode === 'gcs' ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-emerald-200 bg-emerald-50 text-emerald-800 text-[11px] font-semibold">
                                <CheckCircle2 className="w-3 h-3" />
                                {t(lang, 'مرفوعة إلى GCS', 'Uploaded to GCS')}
                              </span>
                            ) : (
                              <div>
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-800 text-[11px] font-semibold">
                                  <HardDrive className="w-3 h-3" />
                                  {t(lang, 'أرشيف محلي (بانتظار GCS)', 'Local Archive (GCS Pending)')}
                                </span>
                                {snap.errorMessage && (
                                  <div className="text-[10px] text-slate-500 mt-1 max-w-[220px] truncate" title={snap.errorMessage}>
                                    {snap.errorMessage}
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 px-4 text-end">
                            <button
                              type="button"
                              onClick={() => handleDownloadSnapshot(snap.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 bg-white hover:bg-slate-50 text-[11px] font-semibold text-slate-700"
                            >
                              <Download className="w-3 h-3" />
                              .json.gz
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: FULL POSTGRESQL JSON/CSV EXPORT, EXCEL WORKBOOK & ETL UPLOADER */}
      {subTab === 'excel' && (
        <div className="space-y-6">
          {/* Comprehensive PostgreSQL JSON/CSV Database Bundle Card */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Database className="w-4 h-4 text-teal-700 dark:text-teal-400" />
                  {t(
                    lang,
                    'تصدير البيانات بالكامل من قاعدة بيانات PostgreSQL (حزمة JSON / CSV)',
                    'Export Full Data — Comprehensive PostgreSQL JSON/CSV Bundle'
                  )}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  {t(
                    lang,
                    'يستخرج جميع الجداول الفعلية الـ 16 من Cloud SQL PostgreSQL في حزمة JSON/CSV شاملة مع التحقق من توازن ميزان المراجعة.',
                    'Queries all 16 live tables directly from Cloud SQL PostgreSQL into a complete JSON/CSV bundle with trial balance integrity checks.'
                  )}
                </p>
              </div>

              <button
                type="button"
                onClick={loadDbExportSummary}
                disabled={dbSummaryLoading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${dbSummaryLoading ? 'animate-spin' : ''}`} />
                <span>{t(lang, 'تحديث إحصاءات الجداول', 'Refresh Table Counts')}</span>
              </button>
            </div>

            {dbSummary && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 rounded-lg px-3.5 py-2.5">
                  <div className="flex flex-wrap items-center gap-3 font-mono-num" dir="ltr">
                    <span>
                      <strong>{dbSummary.tableCount}</strong> {t(lang, 'جدول PostgreSQL', 'PostgreSQL Tables')}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      <strong>{dbSummary.totalRows}</strong> {t(lang, 'إجمالي السجلات', 'Total Rows')}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className={dbSummary.integrity.trialBalanceBalanced ? 'text-emerald-700 dark:text-emerald-400 font-semibold' : 'text-red-600 font-semibold'}>
                      {dbSummary.integrity.trialBalanceBalanced
                        ? t(lang, 'ميزان المراجعة متزن ✓', 'Trial Balance Balanced ✓')
                        : t(lang, 'عدم اتزان بالميزان', 'Trial Balance Mismatch')}
                    </span>
                  </div>
                  <span className="font-mono-num text-[11px] text-slate-500 dark:text-slate-400" dir="ltr">
                    {dbSummary.databaseEngine}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
                  {Object.entries(dbSummary.rowCounts).map(([tableName, count]) => (
                    <div
                      key={tableName}
                      className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40"
                    >
                      <div className="font-mono-num text-[11px] text-slate-600 dark:text-slate-300 truncate" dir="ltr" title={tableName}>
                        {tableName}
                      </div>
                      <div className="font-mono-num text-sm font-bold text-slate-900 dark:text-slate-100 mt-0.5" dir="ltr">
                        {count}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 pt-1">
              <button
                type="button"
                onClick={() => handleExportFullDatabase('json-zip')}
                disabled={exportingFormat !== null}
                className="py-2.5 px-4 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer transition-colors"
              >
                {exportingFormat === 'json-zip' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Archive className="w-4 h-4" />}
                <span>
                  {t(
                    lang,
                    'حزمة التدقيق الخارجي: JSON منفصل (.zip)',
                    'External Audit Bundle: Separate JSONs (.zip)'
                  )}
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleExportFullDatabase('zip')}
                disabled={exportingFormat !== null}
                className="py-2.5 px-4 rounded-lg border border-teal-700/40 dark:border-teal-600/50 bg-teal-50/70 dark:bg-teal-950/40 hover:bg-teal-100/80 dark:hover:bg-teal-900/50 disabled:opacity-60 text-teal-900 dark:text-teal-200 text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer transition-colors"
              >
                {exportingFormat === 'zip' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Archive className="w-4 h-4" />}
                <span>{t(lang, 'حزمة شاملة (JSON + CSV .zip)', 'Combined Bundle (JSON + CSV .zip)')}</span>
              </button>

              <button
                type="button"
                onClick={() => handleExportFullDatabase('json')}
                disabled={exportingFormat !== null}
                className="py-2.5 px-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-60 text-slate-800 dark:text-slate-100 text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer transition-colors"
              >
                {exportingFormat === 'json' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileCode2 className="w-4 h-4 text-teal-700 dark:text-teal-400" />}
                <span>{t(lang, 'ملف JSON موحد (16 جدول)', 'Single Complete JSON (.json)')}</span>
              </button>

              <button
                type="button"
                onClick={() => handleExportFullDatabase('csv')}
                disabled={exportingFormat !== null}
                className="py-2.5 px-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-60 text-slate-800 dark:text-slate-100 text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer transition-colors"
              >
                {exportingFormat === 'csv' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Table2 className="w-4 h-4 text-teal-700 dark:text-teal-400" />}
                <span>{t(lang, 'ملف CSV شامل (16 جدول)', 'Download Combined CSV (.csv)')}</span>
              </button>
            </div>

            <div className="text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 rounded-lg px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2">
              <span>
                {t(
                  lang,
                  'محتويات حزمة التدقيق الخارجي (JSON ZIP): ملف audit_manifest.json مع بصمات SHA-256 + 16 ملف JSON منفصل (<table_name>.json) لكل جدول في PostgreSQL.',
                  'External Audit Bundle (JSON ZIP) includes: audit_manifest.json with per-table SHA-256 checksums + 16 separate JSON files (<table_name>.json) for every PostgreSQL table.'
                )}
              </span>
              <span className="font-mono-num text-teal-700 dark:text-teal-400 font-semibold" dir="ltr">
                audit_manifest.json + 16× *.json
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
                <FileSpreadsheet className="w-5 h-5 text-teal-700 dark:text-teal-400" />
                {t(lang, 'تصدير مصنف النظام الكامل (Estadat_AlBorg_ERP_Oct2026_Strategy2027.xlsx)', 'Export Full Multi-Sheet ERP Workbook (.xlsx)')}
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                {t(
                  lang,
                  'يقوم هذا الإجراء بتوليد ملف Excel حقيقي يحتوي على 11 ورقة عمل مترابطة تشمل فعلي 9M 2026 وموازنة 2027:',
                  'Generates a live multi-sheet Excel (.xlsx) workbook with 11 sheets covering 9M 2026 Actuals & 2027 Strategy:'
                )}
              </p>
              <ul className="grid grid-cols-2 gap-2 text-xs font-mono-num text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/60 p-3 rounded-lg border border-slate-200 dark:border-slate-700" dir="ltr">
                <li>1. CONTROL_PANEL</li>
                <li>2. 9M_2026_ACTUALS</li>
                <li>3. STRATEGY_2027</li>
                <li>4. CHART_OF_ACCOUNTS</li>
                <li>5. INGREDIENTS</li>
                <li>6. MENU_ENGINEERING</li>
                <li>7. SALES_INVOICES</li>
                <li>8. JOURNAL_LINES</li>
                <li>9. BANK_RECON</li>
                <li>10. VISA_FEE_ANALYSIS</li>
                <li>11. DATA_QUALITY</li>
              </ul>
              <button
                type="button"
                onClick={onExportExcel}
                className="w-full py-2.5 px-4 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                {t(lang, 'تحميل ملف Excel ERP المحدث (أكتوبر 2026 + 2027)', 'Download Updated Oct 2026 + 2027 Excel ERP')}
              </button>
            </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <Upload className="w-5 h-5 text-teal-700" />
              {t(lang, 'استيراد ومعاينة ملفات CSV / Excel (ETL Mapper)', 'Import & Preview CSV / Excel Files (ETL)')}
            </div>
            <p className="text-xs text-slate-600">
              {t(
                lang,
                'ارفع كشف حساب بنك CIB أو ملف مبيعات Foodics/POS بصيغة .xlsx أو .csv لمعاينة ربط الأعمدة قبل الترحيل.',
                'Upload a CIB Bank statement or Foodics POS export (.xlsx / .csv) to preview column mapping before ingestion.'
              )}
            </p>
            <label className="block border border-dashed border-slate-300 rounded-lg p-6 text-center cursor-pointer hover:bg-slate-50 transition-colors">
              <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFileImport} className="hidden" />
              <span className="text-xs font-semibold text-teal-700">
                {t(lang, 'اختر ملف Excel أو CSV للمعاينة', 'Choose .xlsx or .csv file to inspect')}
              </span>
            </label>

            {importedPreview && (
              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <div className="px-3 py-2 bg-slate-50 text-xs font-bold text-slate-700 border-b border-slate-200">
                  Sheet: {importedPreview.sheetName}
                </div>
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      {importedPreview.headers.slice(0, 6).map((h, i) => (
                        <th key={i} className="py-1.5 px-2 text-start font-semibold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {importedPreview.rows.map((r, rIdx) => (
                      <tr key={rIdx}>
                        {r.slice(0, 6).map((cell, cIdx) => (
                          <td key={cIdx} className="py-1.5 px-2 text-slate-700 truncate max-w-[140px]">{String(cell ?? '')}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          </div>
        </div>
      )}

      {/* TAB 3: AUDIT TRAIL */}
      {subTab === 'audit' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {t(lang, 'سجل التدقيق والرقابة الداخلية (AUDIT_LOG)', 'Immutable Audit Trail (AUDIT_LOG)')}
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                {t(
                  lang,
                  'يمكن للمراجع الخارجي تحميل حزمة ZIP تضم ملف JSON مستقل لكل جدول من جداول PostgreSQL مع بصمة SHA-256.',
                  'External auditors can download a full PostgreSQL ZIP bundle containing a separate JSON file per table with SHA-256 manifest.'
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleExportFullDatabase('json-zip')}
              disabled={exportingFormat !== null}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors"
            >
              {exportingFormat === 'json-zip' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Archive className="w-4 h-4" />
              )}
              <span>
                {exportingFormat === 'json-zip'
                  ? t(lang, 'جاري التصدير...', 'Exporting...')
                  : t(lang, 'تحميل حزمة التدقيق الكاملة (ZIP / JSON منفصل)', 'Download Full Data Bundle (Separate JSON .zip)')}
              </span>
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300">
                  <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'التوقيت', 'Timestamp')}</th>
                  <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'المستخدم / الصلاحية', 'User / Role')}</th>
                  <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'الإجراء', 'Action')}</th>
                  <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'المرجع', 'Entity Ref')}</th>
                  <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'التفاصيل', 'Details')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {state.auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="py-2.5 px-4 font-mono-num text-slate-600 dark:text-slate-300" dir="ltr">{log.timestamp}</td>
                    <td className="py-2.5 px-4 font-medium text-slate-900 dark:text-slate-100">{log.user} · {log.role}</td>
                    <td className="py-2.5 px-4 text-teal-800 dark:text-teal-400 font-semibold">{log.action}</td>
                    <td className="py-2.5 px-4 font-mono-num text-slate-700 dark:text-slate-300" dir="ltr">{log.entityId}</td>
                    <td className="py-2.5 px-4 text-slate-600 dark:text-slate-400">{log.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: STAR SCHEMA & REST API ARCHITECTURE */}
      {subTab === 'architecture' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Database className="w-4 h-4 text-teal-700" />
              {t(lang, 'نموذج البيانات النجمي (Star Schema ERD)', 'Star Schema Data Model (Facts & Dimensions)')}
            </h2>
            <div className="text-xs text-slate-700 space-y-2 leading-relaxed">
              <div>
                <span className="font-bold text-slate-900">Fact Tables:</span>{' '}
                <span className="font-mono-num" dir="ltr">FactSales, FactSalesLines, FactPurchases, FactInventory, FactWaste, FactExpenses, FactJournalLines, FactBank</span>
              </div>
              <div>
                <span className="font-bold text-slate-900">Dimension Tables:</span>{' '}
                <span className="font-mono-num" dir="ltr">DimDate, DimBranches, DimAccounts (COA), DimProducts, DimIngredients, DimRecipes (BOM), DimSuppliers, DimPaymentMethods</span>
              </div>
              <div>
                <span className="font-bold text-slate-900">{t(lang, 'قاعدة الأتمتة:', 'Automation Pipeline:')}</span>{' '}
                {t(
                  lang,
                  'فاتورة المبيعات → فصل 14% VAT → خصم تكلفة المكونات BOM بالتكلفة المرجحة WAC → توليد قيد مزدوج متوازن (1101/1102/1103 مدين = 4101 + 2201 دائن، و 5101 مدين = 1201 دائن) → تحديث فوري للخزينة وميزان المراجعة.',
                  'Sales Invoice → 14% VAT Split → BOM WAC Cost Deduction → Balanced Double-Entry Journal → Real-time SSE Treasury & Ledger Sync.'
                )}
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-bold text-slate-900">
              {t(lang, 'واجهات البرمجة الفعالة (Active REST & SSE APIs)', 'Live REST & SSE Integration Endpoints')}
            </h2>
            <div className="bg-slate-900 text-slate-100 p-3.5 rounded-lg text-[11px] font-mono-num space-y-1.5" dir="ltr">
              <div>GET  /api/erp/state                  — Full ERP state + Trial Balance</div>
              <div>GET  /api/erp/events                 — Real-time SSE (Ledger & Treasury Sync)</div>
              <div>POST /api/erp/sales                  — Checkout + BOM + Auto Journal</div>
              <div>POST /api/erp/sync                   — Offline POS batch sync</div>
              <div>POST /api/erp/purchases              — Supplier PO + WAC recalc</div>
              <div>POST /api/erp/waste                  — Spoilage + Dr 5305 / Cr 1201</div>
              <div>POST /api/erp/journal/:id/reverse    — Immutable reversal entry</div>
              <div>POST /api/erp/integrations/foodics   — Foodics webhook ingestion</div>
              <div>GET  /api/erp/integrations/eta/:id   — Egypt ETA e-Invoice v1.0 JSON</div>
              <div>POST /api/erp/backups/run            — Daily Cloud Storage snapshot export</div>
              <div>GET  /api/erp/backups/status         — Snapshot history & GCS DR config</div>
              <div>GET  /api/erp/export/full-database   — All 16 PostgreSQL tables (json-zip/zip/json/csv)</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
