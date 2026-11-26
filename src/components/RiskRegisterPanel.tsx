import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  Edit3,
  History,
  Plus,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react';
import type {
  AuditLogEntry,
  Language,
  RiskAuditEntry,
  RiskCategory,
  RiskFocusArea,
  RiskImpact,
  RiskStatus,
  StrategyRisk,
} from '../types/erp';
import { fmtMoney, t } from '../utils/formatters';

export interface RiskRegisterPanelProps {
  risks: StrategyRisk[];
  globalAuditLogs?: AuditLogEntry[];
  lang: Language;
  onCreateRisk?: (risk: Partial<StrategyRisk>) => Promise<void>;
  onUpdateRisk?: (id: string, patch: Partial<StrategyRisk> & { auditNote?: string }) => Promise<void>;
  onDeleteRisk?: (id: string) => Promise<void>;
  compact?: boolean;
  readOnlyPrint?: boolean;
}

const ASSIGNEE_PRESETS: { ar: string; en: string }[] = [
  { ar: 'المدير المالي CFO', en: 'Chief Financial Officer (CFO)' },
  { ar: 'المراقب المالي والمحاسب العام', en: 'Financial Controller & Chief Accountant' },
  { ar: 'الشؤون القانونية والعقود', en: 'Legal & Contracts Department' },
  { ar: 'الإدارة الهندسية وإدارة الأصول', en: 'Engineering & Asset Management' },
  { ar: 'مدير تطوير الأعمال ولجنة الاستثمار (JV)', en: 'Business Dev & JV Investment Committee' },
  { ar: 'مدير التشغيل والمشتريات والصيانة', en: 'Operations, Procurement & Maintenance' },
  { ar: 'أمين الخزينة ومراقب التكاليف', en: 'Treasury & Cost Control Lead' },
  { ar: 'مدير الموارد البشرية', en: 'Human Resources Director' },
];

export function normalizeRisk(r: StrategyRisk, idx: number): Required<
  Pick<
    StrategyRisk,
    | 'id'
    | 'code'
    | 'riskAr'
    | 'riskEn'
    | 'category'
    | 'focusArea'
    | 'likelihood'
    | 'impact'
    | 'mitigationAr'
    | 'mitigationEn'
    | 'ownerAr'
    | 'ownerEn'
    | 'status'
    | 'dueDate'
    | 'financialExposureEgp'
  >
> & {
  updatedAt?: string;
  auditHistory: RiskAuditEntry[];
} {
  const defaultHistory: RiskAuditEntry[] = [
    {
      id: `RAUD-BASE-${r.id}`,
      timestamp: r.updatedAt || '2026-10-01 09:00',
      actor: r.ownerAr || 'المدير المالي CFO',
      actionType: 'created',
      summaryAr: `تسجيل الخطر المبدئي: ${r.mitigationAr}`,
      summaryEn: `Initial risk baseline: ${r.mitigationEn || r.mitigationAr}`,
      newStatus: r.status ?? 'open',
      newImpact: r.impact ?? 'medium',
      newMitigation: r.mitigationAr,
      newOwner: r.ownerAr || 'المدير المالي CFO',
    },
  ];
  return {
    id: r.id,
    code: r.code || `RSK-${String(idx + 1).padStart(2, '0')}`,
    riskAr: r.riskAr,
    riskEn: r.riskEn || r.riskAr,
    category: r.category ?? 'financial',
    focusArea: r.focusArea ?? 'usufruct',
    likelihood: r.likelihood ?? 'medium',
    impact: r.impact ?? 'medium',
    mitigationAr: r.mitigationAr,
    mitigationEn: r.mitigationEn || r.mitigationAr,
    ownerAr: r.ownerAr || 'المدير المالي CFO',
    ownerEn: r.ownerEn || r.ownerAr || 'Chief Financial Officer (CFO)',
    status: r.status ?? 'open',
    dueDate: r.dueDate || '2026-12-31',
    financialExposureEgp: Number(r.financialExposureEgp) || 0,
    updatedAt: r.updatedAt,
    auditHistory: Array.isArray(r.auditHistory) && r.auditHistory.length > 0 ? r.auditHistory : defaultHistory,
  };
}

export const RiskRegisterPanel: React.FC<RiskRegisterPanelProps> = ({
  risks,
  globalAuditLogs = [],
  lang,
  onCreateRisk,
  onUpdateRisk,
  onDeleteRisk,
  readOnlyPrint = false,
}) => {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | RiskCategory>('all');
  const [focusFilter, setFocusFilter] = useState<'all' | RiskFocusArea>('all');
  const [impactFilter, setImpactFilter] = useState<'all' | RiskImpact>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | RiskStatus>('all');
  const [savingId, setSavingId] = useState<string | null>(null);

  const [showAddForm, setShowAddForm] = useState(false);
  const [isSubmittingNew, setIsSubmittingNew] = useState(false);
  const [newRisk, setNewRisk] = useState<{
    riskAr: string;
    riskEn: string;
    category: RiskCategory;
    focusArea: RiskFocusArea;
    impact: RiskImpact;
    likelihood: StrategyRisk['likelihood'];
    mitigationAr: string;
    ownerAr: string;
    dueDate: string;
    financialExposureEgp: string;
  }>({
    riskAr: '',
    riskEn: '',
    category: 'financial',
    focusArea: 'usufruct',
    impact: 'high',
    likelihood: 'medium',
    mitigationAr: '',
    ownerAr: ASSIGNEE_PRESETS[0].ar,
    dueDate: '2026-12-31',
    financialExposureEgp: '',
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<StrategyRisk>>({});
  const [editAuditNote, setEditAuditNote] = useState('');
  const [expandedHistoryIds, setExpandedHistoryIds] = useState<Record<string, boolean>>({});

  const normalizedRisks = useMemo(
    () => (risks ?? []).map((r, i) => normalizeRisk(r, i)),
    [risks]
  );

  const auditTimelineByRiskId = useMemo(() => {
    const map = new Map<string, RiskAuditEntry[]>();
    for (const r of normalizedRisks) {
      const merged: RiskAuditEntry[] = [...r.auditHistory];
      const existingTs = new Set(merged.map((e) => e.timestamp.slice(0, 16)));
      const matchingGlobal = (globalAuditLogs ?? []).filter(
        (g) => g.entityType === 'RiskRegister' && (g.entityId === r.code || g.entityId === r.id)
      );
      for (const g of matchingGlobal) {
        if (!existingTs.has(g.timestamp.slice(0, 16))) {
          merged.push({
            id: g.id,
            timestamp: g.timestamp,
            actor: g.user,
            actionType: 'updated',
            summaryAr: g.action,
            summaryEn: g.action,
            note: g.details,
          });
        }
      }
      merged.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      map.set(r.id, merged);
    }
    return map;
  }, [normalizedRisks, globalAuditLogs]);

  const stats = useMemo(() => {
    const total = normalizedRisks.length;
    const highList = normalizedRisks.filter((r) => r.impact === 'high');
    const medList = normalizedRisks.filter((r) => r.impact === 'medium');
    const lowList = normalizedRisks.filter((r) => r.impact === 'low');

    const openList = normalizedRisks.filter((r) => r.status === 'open');
    const inProgressList = normalizedRisks.filter((r) => r.status === 'in_progress');
    const mitigatedList = normalizedRisks.filter((r) => r.status === 'mitigated');

    const financialCount = normalizedRisks.filter((r) => r.category === 'financial').length;
    const operationalCount = normalizedRisks.filter((r) => r.category === 'operational').length;

    const sumExposure = (list: typeof normalizedRisks) =>
      list.reduce((sum, r) => sum + (r.financialExposureEgp || 0), 0);

    const totalExposure = sumExposure(normalizedRisks);
    const activeExposure = sumExposure(normalizedRisks.filter((r) => r.status !== 'mitigated'));
    const mitigatedPct = total > 0 ? Math.round((mitigatedList.length / total) * 100) : 0;
    const inProgressPct = total > 0 ? Math.round((inProgressList.length / total) * 100) : 0;
    const openPct = Math.max(0, 100 - mitigatedPct - inProgressPct);

    const byFocus: {
      focus: RiskFocusArea;
      ar: string;
      en: string;
      total: number;
      high: number;
      medium: number;
      low: number;
      mitigated: number;
      exposure: number;
    }[] = (
      [
        { focus: 'usufruct', ar: 'حق الانتفاع التعاقدي', en: 'Usufruct Contract' },
        { focus: 'unused_space', ar: 'المساحات غير المستغلة (80%)', en: '80% Unused Land' },
        { focus: 'general', ar: 'التشغيل والمالية العامة', en: 'Core Finance & Ops' },
      ] as const
    ).map((f) => {
      const items = normalizedRisks.filter((r) => r.focusArea === f.focus);
      return {
        focus: f.focus,
        ar: f.ar,
        en: f.en,
        total: items.length,
        high: items.filter((r) => r.impact === 'high').length,
        medium: items.filter((r) => r.impact === 'medium').length,
        low: items.filter((r) => r.impact === 'low').length,
        mitigated: items.filter((r) => r.status === 'mitigated').length,
        exposure: sumExposure(items),
      };
    });

    return {
      total,
      highCount: highList.length,
      mediumCount: medList.length,
      lowCount: lowList.length,
      highExposure: sumExposure(highList),
      mediumExposure: sumExposure(medList),
      lowExposure: sumExposure(lowList),
      openCount: openList.length,
      inProgressCount: inProgressList.length,
      mitigatedCount: mitigatedList.length,
      openExposure: sumExposure(openList),
      inProgressExposure: sumExposure(inProgressList),
      mitigatedExposure: sumExposure(mitigatedList),
      mitigatedPct,
      inProgressPct,
      openPct,
      financialCount,
      operationalCount,
      usufructAndSpaceCount: normalizedRisks.filter(
        (r) => r.focusArea === 'usufruct' || r.focusArea === 'unused_space'
      ).length,
      totalExposure,
      activeExposure,
      byFocus,
    };
  }, [normalizedRisks]);

  const filteredRisks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return normalizedRisks.filter((r) => {
      if (categoryFilter !== 'all' && r.category !== categoryFilter) return false;
      if (focusFilter !== 'all' && r.focusArea !== focusFilter) return false;
      if (impactFilter !== 'all' && r.impact !== impactFilter) return false;
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (!q) return true;
      return (
        r.code.toLowerCase().includes(q) ||
        r.riskAr.toLowerCase().includes(q) ||
        r.riskEn.toLowerCase().includes(q) ||
        r.mitigationAr.toLowerCase().includes(q) ||
        r.mitigationEn.toLowerCase().includes(q) ||
        r.ownerAr.toLowerCase().includes(q) ||
        r.ownerEn.toLowerCase().includes(q)
      );
    });
  }, [normalizedRisks, categoryFilter, focusFilter, impactFilter, statusFilter, search]);

  const impactStyles: Record<RiskImpact, string> = {
    high: 'bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800/60',
    medium: 'bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800/60',
    low: 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60',
  };

  const statusStyles: Record<RiskStatus, string> = {
    open: 'bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800/60',
    in_progress: 'bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800/60',
    mitigated: 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60',
  };

  const statusProgressPct = (st: RiskStatus) => (st === 'mitigated' ? 100 : st === 'in_progress' ? 50 : 10);
  const statusProgressColor = (st: RiskStatus) =>
    st === 'mitigated' ? 'bg-emerald-600' : st === 'in_progress' ? 'bg-amber-500' : 'bg-red-600';

  const categoryLabel = (c: RiskCategory) =>
    c === 'financial' ? t(lang, 'مخاطر مالية', 'Financial') : t(lang, 'مخاطر تشغيلية', 'Operational');

  const focusLabel = (f: RiskFocusArea) => {
    if (f === 'usufruct') return t(lang, 'حق الانتفاع', 'Usufruct Contract');
    if (f === 'unused_space') return t(lang, 'المساحات غير المستغلة (80%)', 'Unused Land (80%)');
    return t(lang, 'تشغيل ومالية عامة', 'Core Operations');
  };

  const impactLabel = (imp: RiskImpact) => {
    if (imp === 'high') return t(lang, 'عالي · High', 'High');
    if (imp === 'medium') return t(lang, 'متوسط · Medium', 'Medium');
    return t(lang, 'منخفض · Low', 'Low');
  };

  const statusLabel = (st: RiskStatus) => {
    if (st === 'mitigated') return t(lang, 'تمت المعالجة', 'Mitigated');
    if (st === 'in_progress') return t(lang, 'قيد التنفيذ', 'In Progress');
    return t(lang, 'مفتوح', 'Open');
  };

  const renderImpactBadge = (imp: RiskImpact) => {
    const Icon = imp === 'high' ? ShieldAlert : imp === 'medium' ? AlertTriangle : ShieldCheck;
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-bold whitespace-nowrap ${impactStyles[imp]}`}
      >
        <Icon className="w-3.5 h-3.5 shrink-0" />
        <span>{impactLabel(imp)}</span>
      </span>
    );
  };

  const renderStatusBadge = (st: RiskStatus) => {
    const Icon = st === 'mitigated' ? CheckCircle2 : st === 'in_progress' ? Clock : AlertTriangle;
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-semibold whitespace-nowrap ${statusStyles[st]}`}
      >
        <Icon className="w-3.5 h-3.5 shrink-0" />
        <span>{statusLabel(st)}</span>
      </span>
    );
  };

  const handleSubmitNew = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onCreateRisk || !newRisk.riskAr.trim() || !newRisk.mitigationAr.trim()) return;
    setIsSubmittingNew(true);
    try {
      const preset = ASSIGNEE_PRESETS.find((p) => p.ar === newRisk.ownerAr);
      await onCreateRisk({
        riskAr: newRisk.riskAr.trim(),
        riskEn: newRisk.riskEn.trim() || newRisk.riskAr.trim(),
        category: newRisk.category,
        focusArea: newRisk.focusArea,
        impact: newRisk.impact,
        likelihood: newRisk.likelihood,
        mitigationAr: newRisk.mitigationAr.trim(),
        mitigationEn: newRisk.mitigationAr.trim(),
        ownerAr: newRisk.ownerAr.trim() || ASSIGNEE_PRESETS[0].ar,
        ownerEn: preset?.en || newRisk.ownerAr.trim() || ASSIGNEE_PRESETS[0].en,
        dueDate: newRisk.dueDate || '2026-12-31',
        financialExposureEgp: Number(newRisk.financialExposureEgp) || 0,
        status: 'open',
      });
      setNewRisk({
        riskAr: '',
        riskEn: '',
        category: 'financial',
        focusArea: 'usufruct',
        impact: 'high',
        likelihood: 'medium',
        mitigationAr: '',
        ownerAr: ASSIGNEE_PRESETS[0].ar,
        dueDate: '2026-12-31',
        financialExposureEgp: '',
      });
      setShowAddForm(false);
    } finally {
      setIsSubmittingNew(false);
    }
  };

  const toggleHistory = (id: string) => {
    setExpandedHistoryIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const actionTypeLabel = (at: RiskAuditEntry['actionType']) => {
    switch (at) {
      case 'created':
        return t(lang, 'إنشاء وتسجيل', 'Created');
      case 'status_change':
        return t(lang, 'تغيير الحالة', 'Status Change');
      case 'impact_change':
        return t(lang, 'تعديل التأثير', 'Impact Change');
      case 'mitigation_update':
        return t(lang, 'تحديث خطة المعالجة', 'Mitigation Update');
      case 'owner_change':
        return t(lang, 'تغيير المكلف', 'Owner Change');
      default:
        return t(lang, 'تحديث ومراجعة', 'Progress Review');
    }
  };

  const handleStartEdit = (r: ReturnType<typeof normalizeRisk>) => {
    setEditingId(r.id);
    setEditAuditNote('');
    // Automatically expand Historical Audit Log so the CFO reviews previous mitigation efforts before updating progress
    setExpandedHistoryIds((prev) => ({ ...prev, [r.id]: true }));
    setEditDraft({
      riskAr: r.riskAr,
      riskEn: r.riskEn,
      category: r.category,
      focusArea: r.focusArea,
      impact: r.impact,
      likelihood: r.likelihood,
      mitigationAr: r.mitigationAr,
      mitigationEn: r.mitigationEn,
      ownerAr: r.ownerAr,
      ownerEn: r.ownerEn,
      status: r.status,
      dueDate: r.dueDate,
      financialExposureEgp: r.financialExposureEgp,
    });
  };

  const handleSaveEdit = async (id: string) => {
    if (!onUpdateRisk) return;
    setSavingId(id);
    try {
      const preset = ASSIGNEE_PRESETS.find((p) => p.ar === editDraft.ownerAr);
      await onUpdateRisk(id, {
        ...editDraft,
        ...(preset ? { ownerEn: preset.en } : {}),
        ...(editAuditNote.trim() ? { auditNote: editAuditNote.trim() } : {}),
      });
      setEditingId(null);
      setEditDraft({});
      setEditAuditNote('');
    } finally {
      setSavingId(null);
    }
  };

  const handleExportCsv = () => {
    const headers = [
      'Code',
      'Category',
      'Scope',
      'Risk (AR)',
      'Risk (EN)',
      'Impact',
      'Likelihood',
      'Corrective Action (AR)',
      'Assigned Owner',
      'Due Date',
      'Mitigation Status',
      'Exposure (EGP)',
      'Audit Entries',
      'Latest Audit Event',
    ];
    const rows = normalizedRisks.map((r) => {
      const history = auditTimelineByRiskId.get(r.id) ?? r.auditHistory;
      const latest = history[0];
      return [
        r.code,
        r.category,
        r.focusArea,
        `"${r.riskAr.replace(/"/g, '""')}"`,
        `"${r.riskEn.replace(/"/g, '""')}"`,
        r.impact.toUpperCase(),
        r.likelihood.toUpperCase(),
        `"${r.mitigationAr.replace(/"/g, '""')}"`,
        `"${r.ownerAr.replace(/"/g, '""')}"`,
        r.dueDate,
        r.status,
        r.financialExposureEgp,
        history.length,
        `"${(latest ? `${latest.timestamp}: ${lang === 'ar' ? latest.summaryAr : latest.summaryEn}` : '').replace(/"/g, '""')}"`,
      ];
    });
    const csv = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `estadat_cfo_risk_register_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const hasActiveFilter =
    categoryFilter !== 'all' ||
    focusFilter !== 'all' ||
    impactFilter !== 'all' ||
    statusFilter !== 'all' ||
    search.trim().length > 0;

  return (
    <section
      id="cfo-risk-register"
      className="bg-white border border-slate-200 rounded-xl overflow-hidden"
    >
      {/* Header */}
      <div className="px-5 py-4 print:px-3.5 print:py-2.5 border-b border-slate-200 bg-slate-50/70 flex flex-col lg:flex-row print:flex-row lg:items-center print:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-red-600 shrink-0" />
            <span>
              {t(
                lang,
                'لوحة متابعة حالة المخاطر وسجل التصحيح (Risk Register & Status Dashboard)',
                'CFO Risk Status-Tracking Dashboard & Risk Register'
              )}
            </span>
          </h2>
          <p className="text-xs print:text-[10px] text-slate-500 mt-0.5">
            {t(
              lang,
              'تصنيف المخاطر المالية والتشغيلية لحق الانتفاع والـ 80% مساحات غير مستغلة، وتصور درجات التأثير، وتحديث تقدم المعالجة.',
              'Track mitigation progress, visualize High/Medium/Low Risk Impact, and edit status & corrective action owners inline.'
            )}
          </p>
        </div>

        {!readOnlyPrint && (
          <div className="no-print flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{t(lang, 'تصدير CSV', 'Export CSV')}</span>
            </button>
            {onCreateRisk && (
              <button
                type="button"
                onClick={() => setShowAddForm((prev) => !prev)}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {showAddForm ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                <span>{showAddForm ? t(lang, 'إلغاء', 'Cancel') : t(lang, 'إضافة خطر وتكليف', 'Add Risk & Assign')}</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Status-Tracking Dashboard Visualization */}
      <div className="p-5 print:p-3 border-b border-slate-200 space-y-5 print:space-y-2.5">
        {/* Top Row: Mitigation Progress Tracker + Impact Level Visualizer */}
        <div className="grid grid-cols-1 xl:grid-cols-12 print:grid-cols-12 gap-5 print:gap-2.5 print-avoid-break">
          {/* Mitigation Progress Status Panel */}
          <div className="xl:col-span-6 print:col-span-6 p-4 print:p-2.5 rounded-xl border border-slate-200 bg-slate-50/40 space-y-3.5 print:space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-bold text-slate-900">
                  {t(lang, 'مؤشر تقدم تنفيذ المعالجة (Mitigation Progress)', 'Mitigation Progress Tracker')}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {t(
                    lang,
                    `${stats.mitigatedCount} مكتمل · ${stats.inProgressCount} قيد التنفيذ · ${stats.openCount} مفتوح (اضغط على الحالة للتصفية)`,
                    `${stats.mitigatedCount} mitigated · ${stats.inProgressCount} in progress · ${stats.openCount} open`
                  )}
                </div>
              </div>
              <div className="text-end shrink-0">
                <div className="text-xl font-bold font-mono-num text-emerald-700" dir="ltr">
                  {stats.mitigatedPct}%
                </div>
                <div className="text-[10px] text-slate-500">
                  {t(lang, 'نسبة الإغلاق', 'Mitigated')}
                </div>
              </div>
            </div>

            {/* Stacked Progress Bar */}
            <div
              className="h-3 w-full rounded-md overflow-hidden bg-slate-200 dark:bg-slate-800 flex border border-slate-200 dark:border-slate-700"
              role="img"
              aria-label={t(lang, 'شريط تقدم معالجة المخاطر', 'Risk mitigation progress bar')}
            >
              {stats.mitigatedCount > 0 && (
                <div
                  className="bg-emerald-600 h-full transition-all duration-200"
                  style={{ width: `${(stats.mitigatedCount / Math.max(1, stats.total)) * 100}%` }}
                  title={`${t(lang, 'تمت المعالجة', 'Mitigated')}: ${stats.mitigatedCount}`}
                />
              )}
              {stats.inProgressCount > 0 && (
                <div
                  className="bg-amber-500 h-full transition-all duration-200"
                  style={{ width: `${(stats.inProgressCount / Math.max(1, stats.total)) * 100}%` }}
                  title={`${t(lang, 'قيد التنفيذ', 'In Progress')}: ${stats.inProgressCount}`}
                />
              )}
              {stats.openCount > 0 && (
                <div
                  className="bg-red-600 h-full transition-all duration-200"
                  style={{ width: `${(stats.openCount / Math.max(1, stats.total)) * 100}%` }}
                  title={`${t(lang, 'مفتوح', 'Open')}: ${stats.openCount}`}
                />
              )}
            </div>

            {/* Interactive Status Stage Tiles */}
            <div className="grid grid-cols-3 gap-2.5 text-xs">
              <button
                type="button"
                onClick={() => setStatusFilter((prev) => (prev === 'open' ? 'all' : 'open'))}
                className={`p-2.5 rounded-lg border text-start transition-colors cursor-pointer ${
                  statusFilter === 'open'
                    ? 'border-red-500 bg-red-50 dark:bg-red-950/50 ring-1 ring-red-500'
                    : 'border-slate-200 bg-white hover:bg-red-50/40 dark:hover:bg-red-950/30'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[11px] font-semibold text-red-700">{t(lang, 'مفتوح · Open', 'Open')}</span>
                  <span className="font-mono-num font-bold text-red-700" dir="ltr">{stats.openCount}</span>
                </div>
                <div className="text-[10px] text-slate-500 font-mono-num mt-1" dir="ltr">
                  {fmtMoney(stats.openExposure, 0)} EGP
                </div>
              </button>

              <button
                type="button"
                onClick={() => setStatusFilter((prev) => (prev === 'in_progress' ? 'all' : 'in_progress'))}
                className={`p-2.5 rounded-lg border text-start transition-colors cursor-pointer ${
                  statusFilter === 'in_progress'
                    ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/50 ring-1 ring-amber-500'
                    : 'border-slate-200 bg-white hover:bg-amber-50/40 dark:hover:bg-amber-950/30'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[11px] font-semibold text-amber-800">{t(lang, 'قيد التنفيذ', 'In Progress')}</span>
                  <span className="font-mono-num font-bold text-amber-800" dir="ltr">{stats.inProgressCount}</span>
                </div>
                <div className="text-[10px] text-slate-500 font-mono-num mt-1" dir="ltr">
                  {fmtMoney(stats.inProgressExposure, 0)} EGP
                </div>
              </button>

              <button
                type="button"
                onClick={() => setStatusFilter((prev) => (prev === 'mitigated' ? 'all' : 'mitigated'))}
                className={`p-2.5 rounded-lg border text-start transition-colors cursor-pointer ${
                  statusFilter === 'mitigated'
                    ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/50 ring-1 ring-emerald-600'
                    : 'border-slate-200 bg-white hover:bg-emerald-50/40 dark:hover:bg-emerald-950/30'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[11px] font-semibold text-emerald-700">{t(lang, 'تمت المعالجة', 'Mitigated')}</span>
                  <span className="font-mono-num font-bold text-emerald-700" dir="ltr">{stats.mitigatedCount}</span>
                </div>
                <div className="text-[10px] text-slate-500 font-mono-num mt-1" dir="ltr">
                  {fmtMoney(stats.mitigatedExposure, 0)} EGP
                </div>
              </button>
            </div>
          </div>

          {/* Risk Impact Distribution Panel (High / Medium / Low Color-Coded Badges) */}
          <div className="xl:col-span-6 print:col-span-6 p-4 print:p-2.5 rounded-xl border border-slate-200 bg-slate-50/40 space-y-3.5 print:space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-bold text-slate-900">
                  {t(lang, 'توزيع درجة التأثير (Risk Impact: High / Medium / Low)', 'Risk Impact Distribution (High / Medium / Low)')}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {t(
                    lang,
                    `التعرض المالي النشط: ${fmtMoney(stats.activeExposure, 0)} ج.م من إجمالي ${fmtMoney(stats.totalExposure, 0)} ج.م`,
                    `Active exposure: ${fmtMoney(stats.activeExposure, 0)} EGP of ${fmtMoney(stats.totalExposure, 0)} EGP total`
                  )}
                </div>
              </div>
              <div className="text-end shrink-0 font-mono-num">
                <div className="text-sm font-bold text-slate-900" dir="ltr">
                  {stats.financialCount} {t(lang, 'مالي', 'Fin')} / {stats.operationalCount} {t(lang, 'تشغيلي', 'Ops')}
                </div>
                <div className="text-[10px] text-teal-800 font-medium">
                  {stats.usufructAndSpaceCount} {t(lang, 'انتفاع وفراغ 80%', 'Usufruct & 80% Space')}
                </div>
              </div>
            </div>

            {/* Stacked Impact Severity Bar */}
            <div
              className="h-3 w-full rounded-md overflow-hidden bg-slate-200 dark:bg-slate-800 flex border border-slate-200 dark:border-slate-700"
              role="img"
              aria-label={t(lang, 'توزيع درجات تأثير المخاطر', 'Risk impact severity distribution')}
            >
              {stats.highCount > 0 && (
                <div
                  className="bg-red-600 h-full transition-all duration-200"
                  style={{ width: `${(stats.highCount / Math.max(1, stats.total)) * 100}%` }}
                  title={`High: ${stats.highCount}`}
                />
              )}
              {stats.mediumCount > 0 && (
                <div
                  className="bg-amber-500 h-full transition-all duration-200"
                  style={{ width: `${(stats.mediumCount / Math.max(1, stats.total)) * 100}%` }}
                  title={`Medium: ${stats.mediumCount}`}
                />
              )}
              {stats.lowCount > 0 && (
                <div
                  className="bg-emerald-600 h-full transition-all duration-200"
                  style={{ width: `${(stats.lowCount / Math.max(1, stats.total)) * 100}%` }}
                  title={`Low: ${stats.lowCount}`}
                />
              )}
            </div>

            {/* Interactive Impact Level Cards with Color-Coded Badges */}
            <div className="grid grid-cols-3 gap-2.5 text-xs">
              <button
                type="button"
                onClick={() => setImpactFilter((prev) => (prev === 'high' ? 'all' : 'high'))}
                className={`p-2.5 rounded-lg border text-start transition-colors cursor-pointer ${
                  impactFilter === 'high'
                    ? 'border-red-600 bg-red-50 dark:bg-red-950/50 ring-1 ring-red-600'
                    : 'border-slate-200 bg-white hover:bg-red-50/30 dark:hover:bg-red-950/30'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 text-[10px] font-bold">
                    High
                  </span>
                  <span className="font-mono-num font-bold text-slate-900" dir="ltr">
                    {stats.highCount} ({stats.total > 0 ? Math.round((stats.highCount / stats.total) * 100) : 0}%)
                  </span>
                </div>
                <div className="text-[10px] text-slate-500 font-mono-num mt-1" dir="ltr">
                  {fmtMoney(stats.highExposure, 0)} EGP
                </div>
              </button>

              <button
                type="button"
                onClick={() => setImpactFilter((prev) => (prev === 'medium' ? 'all' : 'medium'))}
                className={`p-2.5 rounded-lg border text-start transition-colors cursor-pointer ${
                  impactFilter === 'medium'
                    ? 'border-amber-600 bg-amber-50 dark:bg-amber-950/50 ring-1 ring-amber-600'
                    : 'border-slate-200 bg-white hover:bg-amber-50/30 dark:hover:bg-amber-950/30'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 text-[10px] font-bold">
                    Medium
                  </span>
                  <span className="font-mono-num font-bold text-slate-900" dir="ltr">
                    {stats.mediumCount} ({stats.total > 0 ? Math.round((stats.mediumCount / stats.total) * 100) : 0}%)
                  </span>
                </div>
                <div className="text-[10px] text-slate-500 font-mono-num mt-1" dir="ltr">
                  {fmtMoney(stats.mediumExposure, 0)} EGP
                </div>
              </button>

              <button
                type="button"
                onClick={() => setImpactFilter((prev) => (prev === 'low' ? 'all' : 'low'))}
                className={`p-2.5 rounded-lg border text-start transition-colors cursor-pointer ${
                  impactFilter === 'low'
                    ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/50 ring-1 ring-emerald-600'
                    : 'border-slate-200 bg-white hover:bg-emerald-50/30 dark:hover:bg-emerald-950/30'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold">
                    Low
                  </span>
                  <span className="font-mono-num font-bold text-slate-900" dir="ltr">
                    {stats.lowCount} ({stats.total > 0 ? Math.round((stats.lowCount / stats.total) * 100) : 0}%)
                  </span>
                </div>
                <div className="text-[10px] text-slate-500 font-mono-num mt-1" dir="ltr">
                  {fmtMoney(stats.lowExposure, 0)} EGP
                </div>
              </button>
            </div>
          </div>
        </div>

        {/* Bottom Row: Scope & Usufruct / 80% Idle Land Status Breakdown */}
        <div className="grid grid-cols-1 md:grid-cols-3 print:grid-cols-3 gap-3 print:gap-2 print-avoid-break">
          {stats.byFocus.map((f) => {
            const active = focusFilter === f.focus;
            const closedPct = f.total > 0 ? Math.round((f.mitigated / f.total) * 100) : 0;
            return (
              <button
                key={f.focus}
                type="button"
                onClick={() => setFocusFilter((prev) => (prev === f.focus ? 'all' : f.focus))}
                className={`p-3.5 print:p-2 rounded-lg border text-start transition-colors cursor-pointer ${
                  active
                    ? 'border-teal-700 bg-teal-50 dark:bg-teal-950/40 ring-1 ring-teal-700'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-900">{lang === 'ar' ? f.ar : f.en}</span>
                  <span className="text-[11px] font-mono-num font-bold text-slate-700" dir="ltr">
                    {f.total} {t(lang, 'بند', 'items')}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-2 text-[11px] font-mono-num" dir="ltr">
                  <span className="text-red-700 font-semibold">{f.high}H</span>
                  <span className="text-slate-300 dark:text-slate-600">·</span>
                  <span className="text-amber-700 font-semibold">{f.medium}M</span>
                  <span className="text-slate-300 dark:text-slate-600">·</span>
                  <span className="text-emerald-700 font-semibold">{f.low}L</span>
                  <span className="text-slate-300 dark:text-slate-600">·</span>
                  <span className="text-slate-600">{fmtMoney(f.exposure, 0)} EGP</span>
                </div>
                <div className="mt-2 h-1.5 w-full rounded bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div className="h-full bg-emerald-600 transition-all" style={{ width: `${closedPct}%` }} />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Add New Risk Drawer */}
      {!readOnlyPrint && showAddForm && onCreateRisk && (
        <form onSubmit={handleSubmitNew} className="p-5 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              {t(lang, 'تسجيل خطر جديد وتكليف مسؤول الإجراء التصحيحي', 'Register New Risk & Assign Corrective Action Owner')}
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <label className="space-y-1 lg:col-span-2">
              <span className="font-semibold text-slate-700">{t(lang, 'وصف الخطر (بالعربية) *', 'Risk Description (AR) *')}</span>
              <input
                type="text"
                required
                value={newRisk.riskAr}
                onChange={(e) => setNewRisk((p) => ({ ...p, riskAr: e.target.value }))}
                placeholder={t(lang, 'مثال: تأخر موافقة المحافظة على ربط المرافق لملعب البادل...', 'e.g. Delay in utility connection permit for 80% idle zone...')}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-900"
              />
            </label>

            <label className="space-y-1">
              <span className="font-semibold text-slate-700">{t(lang, 'تصنيف الخطر', 'Risk Category')}</span>
              <select
                value={newRisk.category}
                onChange={(e) => setNewRisk((p) => ({ ...p, category: e.target.value as RiskCategory }))}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-900"
              >
                <option value="financial">{t(lang, 'مخاطر مالية (Financial)', 'Financial')}</option>
                <option value="operational">{t(lang, 'مخاطر تشغيلية (Operational)', 'Operational')}</option>
              </select>
            </label>

            <label className="space-y-1">
              <span className="font-semibold text-slate-700">{t(lang, 'النطاق المرتبط', 'Scope / Asset')}</span>
              <select
                value={newRisk.focusArea}
                onChange={(e) => setNewRisk((p) => ({ ...p, focusArea: e.target.value as RiskFocusArea }))}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-900"
              >
                <option value="usufruct">{t(lang, 'حق الانتفاع (عقد المحافظة)', 'Usufruct Contract')}</option>
                <option value="unused_space">{t(lang, 'المساحات غير المستغلة (80%)', 'Unused Space (80%)')}</option>
                <option value="general">{t(lang, 'التشغيل والمالية العامة', 'General Finance & Ops')}</option>
              </select>
            </label>

            <label className="space-y-1">
              <span className="font-semibold text-slate-700">{t(lang, 'درجة التأثير (Impact)', 'Impact Level')}</span>
              <select
                value={newRisk.impact}
                onChange={(e) => setNewRisk((p) => ({ ...p, impact: e.target.value as RiskImpact }))}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-900"
              >
                <option value="high">{t(lang, 'عالي (High)', 'High')}</option>
                <option value="medium">{t(lang, 'متوسط (Medium)', 'Medium')}</option>
                <option value="low">{t(lang, 'منخفض (Low)', 'Low')}</option>
              </select>
            </label>

            <label className="space-y-1">
              <span className="font-semibold text-slate-700">{t(lang, 'الاحتمالية', 'Likelihood')}</span>
              <select
                value={newRisk.likelihood}
                onChange={(e) => setNewRisk((p) => ({ ...p, likelihood: e.target.value as StrategyRisk['likelihood'] }))}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-900"
              >
                <option value="confirmed">{t(lang, 'مؤكد (Confirmed)', 'Confirmed')}</option>
                <option value="high">{t(lang, 'مرتفع (High)', 'High')}</option>
                <option value="medium">{t(lang, 'متوسط (Medium)', 'Medium')}</option>
                <option value="low">{t(lang, 'منخفض (Low)', 'Low')}</option>
              </select>
            </label>

            <label className="space-y-1">
              <span className="font-semibold text-slate-700">{t(lang, 'التعرض المالي (ج.م)', 'Financial Exposure (EGP)')}</span>
              <input
                type="number"
                min={0}
                value={newRisk.financialExposureEgp}
                onChange={(e) => setNewRisk((p) => ({ ...p, financialExposureEgp: e.target.value }))}
                placeholder="500000"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-900 font-mono-num"
                dir="ltr"
              />
            </label>

            <label className="space-y-1">
              <span className="font-semibold text-slate-700">{t(lang, 'تاريخ الاستحقاق', 'Due Date')}</span>
              <input
                type="date"
                value={newRisk.dueDate}
                onChange={(e) => setNewRisk((p) => ({ ...p, dueDate: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-900 font-mono-num"
                dir="ltr"
              />
            </label>

            <label className="space-y-1 lg:col-span-2">
              <span className="font-semibold text-slate-700">{t(lang, 'الإجراء التصحيحي المطلوب *', 'Corrective Action / Mitigation *')}</span>
              <input
                type="text"
                required
                value={newRisk.mitigationAr}
                onChange={(e) => setNewRisk((p) => ({ ...p, mitigationAr: e.target.value }))}
                placeholder={t(lang, 'تحديد خطة المعالجة الواضحة والمخرج المطلوب...', 'Specific corrective action step...')}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-900"
              />
            </label>

            <label className="space-y-1 lg:col-span-2">
              <span className="font-semibold text-slate-700">{t(lang, 'المسؤول المكلف بالتنفيذ *', 'Assigned Action Owner *')}</span>
              <div className="flex gap-2">
                <select
                  value={ASSIGNEE_PRESETS.some((p) => p.ar === newRisk.ownerAr) ? newRisk.ownerAr : '__custom__'}
                  onChange={(e) => {
                    if (e.target.value !== '__custom__') {
                      setNewRisk((p) => ({ ...p, ownerAr: e.target.value }));
                    }
                  }}
                  className="w-1/2 px-2.5 py-2 rounded-lg border border-slate-200 bg-white text-slate-900"
                >
                  {ASSIGNEE_PRESETS.map((p) => (
                    <option key={p.ar} value={p.ar}>
                      {lang === 'ar' ? p.ar : p.en}
                    </option>
                  ))}
                  <option value="__custom__">{t(lang, 'اسم / مسؤول مخصص...', 'Custom owner...')}</option>
                </select>
                <input
                  type="text"
                  required
                  value={newRisk.ownerAr}
                  onChange={(e) => setNewRisk((p) => ({ ...p, ownerAr: e.target.value }))}
                  placeholder={t(lang, 'اسم أو منصب المكلف بالتنفيذ', 'Owner name or role')}
                  className="w-1/2 px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-900"
                />
              </div>
            </label>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="px-3.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              {t(lang, 'إلغاء', 'Cancel')}
            </button>
            <button
              type="submit"
              disabled={isSubmittingNew}
              className="px-4 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-xs font-semibold cursor-pointer"
            >
              {isSubmittingNew ? t(lang, 'جاري الحفظ...', 'Saving...') : t(lang, 'حفظ في قاعدة البيانات', 'Save to Register')}
            </button>
          </div>
        </form>
      )}

      {/* Filter Bar */}
      {!readOnlyPrint && (
        <div className="px-5 py-3 border-b border-slate-200 bg-white flex flex-wrap items-center gap-2.5 text-xs">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t(lang, 'بحث بالخطر، الإجراء التصحيحي، أو المسؤول المكلف...', 'Search risk, action, or assignee...')}
              className="w-full ps-8 pe-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50/70 text-slate-900 text-xs"
            />
          </div>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as 'all' | RiskCategory)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs"
            aria-label={t(lang, 'تصفية حسب التصنيف', 'Filter by category')}
          >
            <option value="all">{t(lang, 'كل التصنيفات (مالية + تشغيلية)', 'All Categories')}</option>
            <option value="financial">{t(lang, 'مخاطر مالية', 'Financial Only')}</option>
            <option value="operational">{t(lang, 'مخاطر تشغيلية', 'Operational Only')}</option>
          </select>

          <select
            value={focusFilter}
            onChange={(e) => setFocusFilter(e.target.value as 'all' | RiskFocusArea)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs"
            aria-label={t(lang, 'تصفية حسب النطاق', 'Filter by scope')}
          >
            <option value="all">{t(lang, 'كل النطاقات', 'All Scopes')}</option>
            <option value="usufruct">{t(lang, 'حق الانتفاع', 'Usufruct Contract')}</option>
            <option value="unused_space">{t(lang, 'المساحات غير المستغلة (80%)', 'Unused Space (80%)')}</option>
            <option value="general">{t(lang, 'التشغيل العام', 'General Operations')}</option>
          </select>

          <select
            value={impactFilter}
            onChange={(e) => setImpactFilter(e.target.value as 'all' | RiskImpact)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs"
            aria-label={t(lang, 'تصفية حسب التأثير', 'Filter by impact')}
          >
            <option value="all">{t(lang, 'كل درجات التأثير', 'All Impacts')}</option>
            <option value="high">High ({stats.highCount})</option>
            <option value="medium">Medium ({stats.mediumCount})</option>
            <option value="low">Low ({stats.lowCount})</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | RiskStatus)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs"
            aria-label={t(lang, 'تصفية حسب الحالة', 'Filter by status')}
          >
            <option value="all">{t(lang, 'كل الحالات', 'All Statuses')}</option>
            <option value="open">{t(lang, 'مفتوح', 'Open')}</option>
            <option value="in_progress">{t(lang, 'قيد التنفيذ', 'In Progress')}</option>
            <option value="mitigated">{t(lang, 'تمت المعالجة', 'Mitigated')}</option>
          </select>

          {hasActiveFilter && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setCategoryFilter('all');
                setFocusFilter('all');
                setImpactFilter('all');
                setStatusFilter('all');
              }}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer"
            >
              {t(lang, 'مسح التصفية', 'Reset')}
            </button>
          )}
        </div>
      )}

      {/* Risk Register Table */}
      <div className="overflow-x-auto">
        <table className={`w-full text-start ${readOnlyPrint ? 'text-[10.5px] print:text-[9px]' : 'text-xs print:text-[9px]'}`}>
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <th className="py-2.5 px-3 font-semibold">{t(lang, 'الكود', 'ID')}</th>
              <th className="py-2.5 px-3 font-semibold">{t(lang, 'التصنيف والنطاق', 'Classification & Scope')}</th>
              <th className="py-2.5 px-3 font-semibold">{t(lang, 'الخطر والتعرض المالي', 'Risk & Exposure')}</th>
              <th className="py-2.5 px-3 font-semibold">{t(lang, 'درجة التأثير', 'Risk Impact')}</th>
              <th className="py-2.5 px-3 font-semibold">{t(lang, 'الإجراء التصحيحي', 'Corrective Action')}</th>
              <th className="py-2.5 px-3 font-semibold">{t(lang, 'المسؤول المكلف', 'Assigned Owner')}</th>
              <th className="py-2.5 px-3 font-semibold">{t(lang, 'حالة المعالجة والموعد', 'Mitigation Status & Due')}</th>
              {!readOnlyPrint && (
                <th className="py-2.5 px-3 font-semibold text-center">{t(lang, 'تعديل / حذف', 'Actions')}</th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredRisks.map((r) => {
              const isEditing = editingId === r.id && !readOnlyPrint;
              const isSaving = savingId === r.id;
              const historyEntries = auditTimelineByRiskId.get(r.id) ?? r.auditHistory;
              const isHistoryOpen = Boolean(expandedHistoryIds[r.id]);

              return (
                <React.Fragment key={r.id}>
                  <tr
                    onKeyDown={(e) => {
                      if (isEditing && e.key === 'Escape') {
                        setEditingId(null);
                        setEditDraft({});
                        setEditAuditNote('');
                      }
                    }}
                    className={`${isEditing ? 'bg-teal-50/70 dark:bg-teal-950/30' : 'hover:bg-slate-50/70'} align-top transition-colors`}
                  >
                    <td className="py-3 px-3 font-mono-num font-bold text-slate-700 whitespace-nowrap" dir="ltr">
                      <div>{r.code}</div>
                      {!readOnlyPrint && (
                        <button
                          type="button"
                          onClick={() => toggleHistory(r.id)}
                          className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-medium text-slate-500 hover:text-teal-700 cursor-pointer"
                          title={t(lang, 'عرض السجل التاريخي للتدقيق', 'View Historical Audit Log')}
                        >
                          <History className="w-3 h-3" />
                          <span>{historyEntries.length}</span>
                        </button>
                      )}
                    </td>

                    {/* Category + Scope */}
                    <td className={`py-3 px-3 print:py-1.5 print:px-1.5 space-y-1 ${readOnlyPrint ? 'whitespace-normal' : 'whitespace-nowrap print:whitespace-normal'}`}>
                      {isEditing ? (
                        <div className="space-y-1.5 min-w-[150px]">
                          <select
                            value={editDraft.category ?? r.category}
                            onChange={(e) => setEditDraft((d) => ({ ...d, category: e.target.value as RiskCategory }))}
                            className="w-full px-2 py-1 rounded border border-slate-300 bg-white text-[11px]"
                          >
                            <option value="financial">{t(lang, 'مالية', 'Financial')}</option>
                            <option value="operational">{t(lang, 'تشغيلية', 'Operational')}</option>
                          </select>
                          <select
                            value={editDraft.focusArea ?? r.focusArea}
                            onChange={(e) => setEditDraft((d) => ({ ...d, focusArea: e.target.value as RiskFocusArea }))}
                            className="w-full px-2 py-1 rounded border border-slate-300 bg-white text-[11px]"
                          >
                            <option value="usufruct">{t(lang, 'حق الانتفاع', 'Usufruct')}</option>
                            <option value="unused_space">{t(lang, '80% مساحات غير مستغلة', '80% Unused Land')}</option>
                            <option value="general">{t(lang, 'تشغيل عام', 'General')}</option>
                          </select>
                        </div>
                      ) : (
                        <>
                          <div className="text-[11px] font-semibold text-slate-800">
                            {categoryLabel(r.category)}
                          </div>
                          <div className="flex items-center gap-1 text-[11px] text-teal-800 font-medium">
                            <Building2 className="w-3 h-3 shrink-0" />
                            <span>{focusLabel(r.focusArea)}</span>
                          </div>
                        </>
                      )}
                    </td>

                    {/* Risk Title + Exposure */}
                    <td className={`py-3 px-3 print:py-1.5 print:px-1.5 ${readOnlyPrint ? 'min-w-0' : 'min-w-[230px] print:min-w-0'}`}>
                      {isEditing ? (
                        <div className="space-y-1.5">
                          <input
                            type="text"
                            value={editDraft.riskAr ?? r.riskAr}
                            onChange={(e) => setEditDraft((d) => ({ ...d, riskAr: e.target.value }))}
                            className="w-full px-2 py-1 rounded border border-slate-300 bg-white text-xs font-semibold"
                          />
                          <input
                            type="number"
                            min={0}
                            value={editDraft.financialExposureEgp ?? r.financialExposureEgp}
                            onChange={(e) =>
                              setEditDraft((d) => ({ ...d, financialExposureEgp: Number(e.target.value) || 0 }))
                            }
                            placeholder="Exposure EGP"
                            className="w-full px-2 py-1 rounded border border-slate-300 bg-white text-[11px] font-mono-num"
                            dir="ltr"
                          />
                        </div>
                      ) : (
                        <>
                          <div className="font-semibold text-slate-900 leading-5">
                            {lang === 'ar' ? r.riskAr : r.riskEn}
                          </div>
                          {r.financialExposureEgp > 0 && (
                            <div className="text-[11px] text-slate-500 mt-1 font-mono-num" dir="ltr">
                              {t(lang, 'التعرض:', 'Exposure:')} {fmtMoney(r.financialExposureEgp, 0)} EGP
                            </div>
                          )}
                        </>
                      )}
                    </td>

                    {/* Risk Impact (Color-Coded Badge in view mode, editable dropdown in inline Edit mode) */}
                    <td className="py-3 px-3 whitespace-nowrap">
                      {isEditing ? (
                        <select
                          value={editDraft.impact ?? r.impact}
                          disabled={isSaving}
                          onChange={(e) => setEditDraft((d) => ({ ...d, impact: e.target.value as RiskImpact }))}
                          className={`px-2 py-1 rounded border text-[11px] font-bold bg-white cursor-pointer ${
                            impactStyles[(editDraft.impact ?? r.impact) as RiskImpact]
                          }`}
                          aria-label={t(lang, 'تحديد درجة التأثير', 'Select impact level')}
                        >
                          <option value="high">High ({t(lang, 'عالي', 'High')})</option>
                          <option value="medium">Medium ({t(lang, 'متوسط', 'Medium')})</option>
                          <option value="low">Low ({t(lang, 'منخفض', 'Low')})</option>
                        </select>
                      ) : (
                        renderImpactBadge(r.impact)
                      )}
                      <div className="text-[10px] text-slate-400 mt-1 font-mono-num uppercase" dir="ltr">
                        {t(lang, 'الاحتمال:', 'Prob:')} {r.likelihood}
                      </div>
                    </td>

                    {/* Corrective Action + Audit Note input in Edit mode */}
                    <td className={`py-3 px-3 print:py-1.5 print:px-1.5 ${readOnlyPrint ? 'min-w-0' : 'min-w-[240px] print:min-w-0'}`}>
                      {isEditing ? (
                        <div className="space-y-1.5">
                          <textarea
                            rows={2}
                            value={editDraft.mitigationAr ?? r.mitigationAr}
                            onChange={(e) =>
                              setEditDraft((d) => ({
                                ...d,
                                mitigationAr: e.target.value,
                                mitigationEn: e.target.value,
                              }))
                            }
                            className="w-full px-2 py-1 rounded border border-slate-300 bg-white text-xs"
                          />
                          <input
                            type="text"
                            value={editAuditNote}
                            onChange={(e) => setEditAuditNote(e.target.value)}
                            placeholder={t(
                              lang,
                              'ملاحظة التقدم لسجل التدقيق التاريخي (اختياري)...',
                              'Progress / audit log note (optional)...'
                            )}
                            className="w-full px-2 py-1 rounded border border-teal-300 dark:border-teal-800 bg-white text-[11px]"
                          />
                        </div>
                      ) : (
                        <div className="text-slate-700 leading-5 print:leading-snug">
                          {lang === 'ar' ? r.mitigationAr : r.mitigationEn}
                        </div>
                      )}
                    </td>

                    {/* Assigned Owner */}
                    <td className={`py-3 px-3 print:py-1.5 print:px-1.5 ${readOnlyPrint ? 'min-w-0' : 'min-w-[180px] print:min-w-0'}`}>
                      {isEditing ? (
                        <div className="space-y-1.5">
                          <select
                            value={
                              ASSIGNEE_PRESETS.some((p) => p.ar === (editDraft.ownerAr ?? r.ownerAr))
                                ? (editDraft.ownerAr ?? r.ownerAr)
                                : '__custom__'
                            }
                            onChange={(e) => {
                              if (e.target.value !== '__custom__') {
                                const preset = ASSIGNEE_PRESETS.find((p) => p.ar === e.target.value);
                                setEditDraft((d) => ({
                                  ...d,
                                  ownerAr: e.target.value,
                                  ownerEn: preset?.en || e.target.value,
                                }));
                              }
                            }}
                            className="w-full px-2 py-1 rounded border border-slate-300 bg-white text-[11px]"
                          >
                            {ASSIGNEE_PRESETS.map((p) => (
                              <option key={p.ar} value={p.ar}>
                                {lang === 'ar' ? p.ar : p.en}
                              </option>
                            ))}
                            <option value="__custom__">{t(lang, 'مخصص...', 'Custom...')}</option>
                          </select>
                          <input
                            type="text"
                            value={editDraft.ownerAr ?? r.ownerAr}
                            onChange={(e) =>
                              setEditDraft((d) => ({
                                ...d,
                                ownerAr: e.target.value,
                                ownerEn: e.target.value,
                              }))
                            }
                            className="w-full px-2 py-1 rounded border border-slate-300 bg-white text-xs"
                          />
                        </div>
                      ) : (
                        <div className="flex items-start gap-1.5 text-slate-800 font-medium">
                          <UserCheck className="w-3.5 h-3.5 text-teal-700 shrink-0 mt-0.5" />
                          <span>{lang === 'ar' ? r.ownerAr : r.ownerEn}</span>
                        </div>
                      )}
                    </td>

                    {/* Mitigation Progress Status + Due Date */}
                    <td className={`py-3 px-3 print:py-1.5 print:px-1.5 space-y-1.5 ${readOnlyPrint ? 'whitespace-normal' : 'whitespace-nowrap print:whitespace-normal'}`}>
                      {isEditing ? (
                        <div className="space-y-1.5 min-w-[148px]">
                          <select
                            autoFocus
                            value={editDraft.status ?? r.status}
                            disabled={isSaving}
                            onChange={(e) => setEditDraft((d) => ({ ...d, status: e.target.value as RiskStatus }))}
                            aria-label={t(lang, 'تحديث حالة تنفيذ المعالجة', 'Update mitigation progress status')}
                            className={`w-full px-2 py-1 rounded border text-[11px] font-bold bg-white ring-2 ring-teal-500/30 cursor-pointer ${
                              statusStyles[(editDraft.status ?? r.status) as RiskStatus]
                            }`}
                          >
                            <option value="open">{t(lang, 'مفتوح (Open)', 'Open')}</option>
                            <option value="in_progress">{t(lang, 'قيد التنفيذ (In Progress)', 'In Progress')}</option>
                            <option value="mitigated">{t(lang, 'تمت المعالجة (Mitigated)', 'Mitigated')}</option>
                          </select>
                          <input
                            type="date"
                            value={editDraft.dueDate ?? r.dueDate}
                            onChange={(e) => setEditDraft((d) => ({ ...d, dueDate: e.target.value }))}
                            className="block w-full px-2 py-1 rounded border border-slate-300 bg-white text-[11px] font-mono-num"
                            dir="ltr"
                          />
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {renderStatusBadge(r.status)}
                          <div className="flex items-center gap-1.5" dir="ltr">
                            <div className="h-1.5 w-16 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                              <div
                                className={`h-full transition-all duration-200 ${statusProgressColor(r.status)}`}
                                style={{ width: `${statusProgressPct(r.status)}%` }}
                              />
                            </div>
                            <span className="text-[10px] font-mono-num text-slate-500">
                              {r.status === 'mitigated' ? '100%' : r.status === 'in_progress' ? '50%' : '0%'}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 font-mono-num" dir="ltr">
                            {r.dueDate}
                          </div>
                        </div>
                      )}
                    </td>

                    {/* Inline History / Edit / Save / Cancel / Delete Row Actions */}
                    {!readOnlyPrint && (
                      <td className="py-3 px-3 whitespace-nowrap text-center">
                        {isEditing ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleSaveEdit(r.id)}
                              disabled={isSaving}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-[11px] font-semibold whitespace-nowrap cursor-pointer"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>{isSaving ? t(lang, 'حفظ...', 'Saving...') : t(lang, 'حفظ', 'Save')}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingId(null);
                                setEditDraft({});
                                setEditAuditNote('');
                              }}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 text-[11px] font-medium whitespace-nowrap cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                              <span>{t(lang, 'إلغاء', 'Cancel')}</span>
                            </button>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => toggleHistory(r.id)}
                              className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-medium whitespace-nowrap cursor-pointer transition-colors ${
                                isHistoryOpen
                                  ? 'border-teal-600 bg-teal-50 dark:bg-teal-950/50 text-teal-800 dark:text-teal-300'
                                  : 'border-slate-200 bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                              }`}
                              title={t(lang, 'عرض السجل التاريخي للجهود وتغييرات الحالة', 'View Historical Audit Log')}
                            >
                              <History className="w-3.5 h-3.5" />
                              <span>{t(lang, `السجل (${historyEntries.length})`, `History (${historyEntries.length})`)}</span>
                              {isHistoryOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                            </button>
                            {onUpdateRisk && (
                              <button
                                type="button"
                                onClick={() => handleStartEdit(r)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 bg-white text-slate-700 hover:text-slate-900 hover:bg-slate-100 text-[11px] font-semibold whitespace-nowrap cursor-pointer transition-colors"
                                title={t(
                                  lang,
                                  'مراجعة السجل وتعديل حالة التقدم ودرجة التأثير والمكلف',
                                  'Review history & edit mitigation status, impact & owner'
                                )}
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                                <span>{t(lang, 'تعديل', 'Edit')}</span>
                              </button>
                            )}
                            {onDeleteRisk && (
                              <button
                                type="button"
                                onClick={() => onDeleteRisk(r.id)}
                                disabled={isSaving}
                                className="p-1.5 rounded-md border border-slate-200 bg-white text-slate-500 hover:text-red-700 hover:border-red-200 hover:bg-red-50 cursor-pointer transition-colors"
                                title={t(lang, 'حذف', 'Delete')}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    )}
                  </tr>

                  {/* Expandable Historical Audit Log Drawer Row */}
                  {isHistoryOpen && !readOnlyPrint && (
                    <tr className="bg-slate-50/70 dark:bg-slate-900/60">
                      <td colSpan={8} className="px-5 py-4 border-t border-slate-200">
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                          <div className="flex items-center gap-2">
                            <History className="w-4 h-4 text-teal-700 shrink-0" />
                            <span className="text-xs font-bold text-slate-900">
                              {t(
                                lang,
                                `السجل التاريخي للتدقيق — ${r.code} (${historyEntries.length} سجل)`,
                                `Historical Audit Log — ${r.code} (${historyEntries.length} entries)`
                              )}
                            </span>
                            {isEditing && (
                              <span className="text-[11px] font-medium px-2 py-0.5 rounded border border-teal-200 dark:border-teal-800/60 bg-teal-50 dark:bg-teal-950/50 text-teal-800 dark:text-teal-300">
                                {t(
                                  lang,
                                  'راجع الجهود السابقة وتغييرات الحالة أعلاه قبل حفظ التقدم الحالي',
                                  'Review prior mitigation efforts & status changes before saving progress'
                                )}
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleHistory(r.id)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 bg-white text-[11px] text-slate-600 hover:text-slate-900 cursor-pointer"
                          >
                            <ChevronUp className="w-3.5 h-3.5" />
                            <span>{t(lang, 'إخفاء السجل', 'Hide History')}</span>
                          </button>
                        </div>

                        <div className="border-s-2 border-slate-200 dark:border-slate-700 ps-4 space-y-3">
                          {historyEntries.map((entry) => (
                            <div
                              key={entry.id}
                              className="p-3 rounded-lg border border-slate-200 bg-white space-y-1.5"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="px-2 py-0.5 rounded border border-slate-200 bg-slate-50 text-[10px] font-bold text-slate-700">
                                    {actionTypeLabel(entry.actionType)}
                                  </span>
                                  <span className="text-xs font-semibold text-slate-900">
                                    {lang === 'ar' ? entry.summaryAr : entry.summaryEn}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 text-[11px] text-slate-500 font-mono-num" dir="ltr">
                                  <span>{entry.actor}</span>
                                  <span className="text-slate-300 dark:text-slate-600">·</span>
                                  <span>{entry.timestamp}</span>
                                </div>
                              </div>

                              {(entry.previousStatus || entry.newStatus || entry.previousImpact || entry.newImpact) && (
                                <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
                                  {entry.previousStatus && entry.newStatus && (
                                    <div className="inline-flex items-center gap-1.5">
                                      <span className="text-slate-500">{t(lang, 'الحالة:', 'Status:')}</span>
                                      {renderStatusBadge(entry.previousStatus)}
                                      <span className="text-slate-400">→</span>
                                      {renderStatusBadge(entry.newStatus)}
                                    </div>
                                  )}
                                  {entry.previousImpact && entry.newImpact && (
                                    <div className="inline-flex items-center gap-1.5">
                                      <span className="text-slate-500">{t(lang, 'التأثير:', 'Impact:')}</span>
                                      {renderImpactBadge(entry.previousImpact)}
                                      <span className="text-slate-400">→</span>
                                      {renderImpactBadge(entry.newImpact)}
                                    </div>
                                  )}
                                </div>
                              )}

                              {entry.previousMitigation && entry.newMitigation && entry.previousMitigation !== entry.newMitigation && (
                                <div className="text-[11px] text-slate-600 pt-1 space-y-0.5">
                                  <div>
                                    <span className="font-semibold text-slate-500">
                                      {t(lang, 'الخطة السابقة:', 'Prior plan:')}{' '}
                                    </span>
                                    <span className="line-through text-slate-400">{entry.previousMitigation}</span>
                                  </div>
                                  <div>
                                    <span className="font-semibold text-teal-800">
                                      {t(lang, 'الخطة المحدثة:', 'Updated plan:')}{' '}
                                    </span>
                                    <span className="text-slate-800">{entry.newMitigation}</span>
                                  </div>
                                </div>
                              )}

                              {entry.previousOwner && entry.newOwner && entry.previousOwner !== entry.newOwner && (
                                <div className="text-[11px] text-slate-600 pt-0.5">
                                  <span className="font-semibold text-slate-500">
                                    {t(lang, 'تغيير المكلف:', 'Owner:')}{' '}
                                  </span>
                                  <span>{entry.previousOwner}</span>
                                  <span className="mx-1 text-slate-400">→</span>
                                  <span className="font-semibold text-slate-800">{entry.newOwner}</span>
                                </div>
                              )}

                              {entry.note && (
                                <div className="text-[11px] text-slate-600 bg-slate-50 px-2.5 py-1.5 rounded border border-slate-100 mt-1">
                                  <span className="font-semibold text-slate-700">
                                    {t(lang, 'ملاحظة التدقيق:', 'Audit Note:')}{' '}
                                  </span>
                                  <span>{entry.note}</span>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}

            {filteredRisks.length === 0 && (
              <tr>
                <td colSpan={readOnlyPrint ? 7 : 8} className="py-8 text-center text-slate-500 text-xs">
                  {t(lang, 'لا توجد مخاطر مطابقة لمعايير التصفية الحالية.', 'No risk items match the selected filters.')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
};
