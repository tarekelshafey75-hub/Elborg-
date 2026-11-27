import React, { useMemo } from 'react';
import { CheckSquare, FileDown, Printer, Square, X } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis } from 'recharts';
import type { ErpState, Language } from '../types/erp';
import {
  computeAccountBalances,
  computeCfoVatSummary,
  computeFoodCostVarianceAnalysis,
  computeStocktakeVarianceAlerts,
  round2,
} from '../utils/erpEngine';
import { buildMonthlyTrendSeries } from '../utils/executivePdfBuilder';
import { fmtMoney, fmtPct, t } from '../utils/formatters';
import {
  loadSavedRoiInputs,
  ROI_PRESETS,
  runRoiSimulation,
  SUNK_IDLE_RENT_ANNUAL,
  TOTAL_SITE_SQM,
  TOTAL_UNUSED_SQM,
} from '../utils/roiSimulatorEngine';
import { normalizeRisk } from './RiskRegisterPanel';

export type CfoPrintSectionId =
  | 'exec_pnl'
  | 'cost_variance'
  | 'roi_strategy'
  | 'risk_signoff';

export const ALL_CFO_PRINT_SECTIONS: CfoPrintSectionId[] = [
  'exec_pnl',
  'cost_variance',
  'roi_strategy',
  'risk_signoff',
];

export interface CfoPrintableBriefProps {
  state: ErpState;
  lang: Language;
  period?: '9m_ytd' | 'Q1' | 'Q2' | 'Q3' | '9m_plus_live';
  excludeUsufructRent?: boolean;
  costCenterBudgets?: Record<'CC-HR' | 'CC-KITCHEN' | 'CC-ADMIN' | 'CC-FACILITY' | 'CC-TREASURY', number>;
  warningThresholdPct?: number;
  sections?: CfoPrintSectionId[];
  currentViewMode?: boolean;
}

const DEFAULT_CC_BUDGETS = {
  'CC-HR': 550000,
  'CC-KITCHEN': 465000,
  'CC-ADMIN': 70000,
  'CC-FACILITY': 430000,
  'CC-TREASURY': 10000,
} as const;

export const CfoPrintableBrief: React.FC<CfoPrintableBriefProps> = ({
  state,
  lang,
  period = '9m_ytd',
  excludeUsufructRent = false,
  costCenterBudgets = DEFAULT_CC_BUDGETS,
  warningThresholdPct = 85,
  sections = ALL_CFO_PRINT_SECTIONS,
  currentViewMode = false,
}) => {
  const showSection = (id: CfoPrintSectionId) => sections.includes(id);

  const balances = useMemo(() => computeAccountBalances(state), [state]);
  const strat = state.strategy2027;
  const printStamp = useMemo(
    () => new Date().toISOString().slice(0, 16).replace('T', ' '),
    []
  );

  const activeBranch = useMemo(
    () => state.branches.find((b) => b.id === state.activeBranchId) ?? state.branches[0],
    [state.branches, state.activeBranchId]
  );

  const livePosDelta = useMemo(() => {
    const newSales = state.salesInvoices.filter((s) => !s.id.startsWith('INV-SEED-'));
    const gross = newSales.reduce((a, s) => a + s.grossTotal, 0);
    const net = newSales.reduce((a, s) => a + s.netSales, 0);
    const vat = newSales.reduce((a, s) => a + s.vatAmount, 0);
    const cogs = newSales.reduce((a, s) => a + s.cogsTotal, 0);
    const newExpenses = state.expenses.filter((e) => !e.id.startsWith('EXP-SEED-'));
    const expNet = newExpenses.reduce((a, e) => a + e.amountNet, 0);
    return { count: newSales.length, gross, net, vat, cogs, expNet };
  }, [state.salesInvoices, state.expenses]);

  const metrics = useMemo(() => {
    const rows =
      period === 'Q1' || period === 'Q2' || period === 'Q3'
        ? state.monthlyActuals2026.filter((m) => m.quarter === period)
        : state.monthlyActuals2026;

    let gross = rows.reduce((a, m) => a + m.grossRevenue, 0);
    let net = rows.reduce((a, m) => a + m.netRevenue, 0);
    let vat = rows.reduce((a, m) => a + m.vatOutput, 0);
    let cogs = rows.reduce((a, m) => a + m.cogs, 0);
    const payroll = rows.reduce((a, m) => a + m.payroll, 0);
    const rent = rows.reduce((a, m) => a + m.usufructRent, 0);
    let otherOpex = rows.reduce((a, m) => a + m.electricity + m.otherOpex, 0);
    const bankFees = rows.reduce((a, m) => a + m.bankFeesNet, 0);

    if (period === '9m_plus_live') {
      gross += livePosDelta.gross;
      net += livePosDelta.net;
      vat += livePosDelta.vat;
      cogs += livePosDelta.cogs;
      otherOpex += livePosDelta.expNet;
    }

    const gp = round2(net - cogs);
    const effectiveRent = excludeUsufructRent ? 0 : rent;
    const totalExpenses = round2(payroll + effectiveRent + otherOpex + bankFees);
    const netProfit = round2(gp - totalExpenses);
    const gpMarginPct = net > 0 ? round2((gp / net) * 100) : 0;
    const foodCostPct = net > 0 ? round2((cogs / net) * 100) : 0;
    const payrollPct = net > 0 ? round2((payroll / net) * 100) : 0;
    const primeCostPct = round2(foodCostPct + payrollPct);
    const netMarginPct = net > 0 ? round2((netProfit / net) * 100) : 0;
    const cmRatio = gpMarginPct / 100;
    const monthsCount = rows.length || 9;
    const breakEvenMonthlyNet = cmRatio > 0 ? round2((totalExpenses / monthsCount) / cmRatio) : 0;

    return {
      rows,
      gross,
      net,
      vat,
      cogs,
      gp,
      payroll,
      rent: effectiveRent,
      otherOpex,
      bankFees,
      totalExpenses,
      netProfit,
      gpMarginPct,
      foodCostPct,
      payrollPct,
      primeCostPct,
      netMarginPct,
      breakEvenMonthlyNet,
      monthsCount,
    };
  }, [state.monthlyActuals2026, period, excludeUsufructRent, livePosDelta]);

  const inventoryValue = useMemo(
    () => round2(state.ingredients.reduce((acc, i) => acc + i.currentQty * i.weightedAvgCost, 0)),
    [state.ingredients]
  );

  const vatSummary = useMemo(
    () => computeCfoVatSummary(state, period, metrics.net, balances),
    [state, period, metrics.net, balances]
  );

  const costCenterRows = useMemo(() => {
    const includeLive = period === '9m_plus_live';
    const liveWasteTotal = round2(
      state.wasteEntries.filter((w) => !w.id.startsWith('WST-SEED-')).reduce((a, w) => a + w.totalValue, 0)
    );
    const liveExp = (codes: string[]) =>
      round2(
        state.expenses
          .filter((e) => !e.id.startsWith('EXP-SEED-') && codes.includes(e.categoryAccountCode))
          .reduce((a, e) => a + e.amountNet, 0)
      );
    const months = metrics.monthsCount;

    const defs: {
      id: keyof typeof DEFAULT_CC_BUDGETS;
      ar: string;
      en: string;
      acct: string;
      actual: number;
    }[] = [
      {
        id: 'CC-HR',
        ar: 'الموارد البشرية والرواتب والمنح',
        en: 'HR, Payroll & Bonus Batches',
        acct: '5201',
        actual: round2(metrics.payroll + (includeLive ? liveExp(['5201']) : 0)),
      },
      {
        id: 'CC-KITCHEN',
        ar: 'تكلفة المبيعات والخامات والهالك (COGS)',
        en: 'COGS, Raw Materials & Waste',
        acct: '5101 / 5305',
        actual: round2(metrics.cogs + (includeLive ? liveWasteTotal : 0)),
      },
      {
        id: 'CC-ADMIN',
        ar: 'الإدارة والمرافق والكهرباء والصيانة',
        en: 'Admin, Electricity & Utilities',
        acct: '5301',
        actual: round2(metrics.otherOpex + (includeLive ? liveExp(['5301', '5305']) : 0)),
      },
      {
        id: 'CC-FACILITY',
        ar: 'حق الانتفاع التعاقدي (محافظة المنوفية)',
        en: 'Facility Usufruct Rent',
        acct: '5202',
        actual: round2(metrics.rent + (includeLive ? liveExp(['5202']) : 0)),
      },
      {
        id: 'CC-TREASURY',
        ar: 'الخزينة والعمولات البنكية (VISA / MDR)',
        en: 'Treasury & Bank / MDR Fees',
        acct: '5308',
        actual: round2(metrics.bankFees + (includeLive ? liveExp(['5308']) : 0)),
      },
    ];

    return defs.map((d) => {
      const budget = round2((costCenterBudgets[d.id] ?? DEFAULT_CC_BUDGETS[d.id]) * months);
      const utilPct = budget > 0 ? round2((d.actual / budget) * 100) : 0;
      const variance = round2(budget - d.actual);
      const status = utilPct >= 100 ? 'exceeded' : utilPct >= warningThresholdPct ? 'approaching' : 'safe';
      return { ...d, budget, utilPct, variance, status };
    });
  }, [period, state.wasteEntries, state.expenses, metrics, costCenterBudgets, warningThresholdPct]);

  const foodCostSummary = useMemo(
    () => computeFoodCostVarianceAnalysis(state, period, 5),
    [state, period]
  );

  const stocktakeSummary = useMemo(
    () => computeStocktakeVarianceAlerts(state, 2),
    [state]
  );

  const roiInputs = useMemo(() => loadSavedRoiInputs(), []);
  const roiSim = useMemo(() => runRoiSimulation(roiInputs), [roiInputs]);
  const activeRoiPreset =
    roiInputs.presetId !== 'custom' ? ROI_PRESETS[roiInputs.presetId] : undefined;

  const normalizedRisks = useMemo(
    () => (strat.risks ?? []).map((r, i) => normalizeRisk(r, i)),
    [strat.risks]
  );

  const trendSeries = useMemo(() => {
    const raw = buildMonthlyTrendSeries(state, excludeUsufructRent, period === '9m_plus_live');
    return raw.map((pt) => ({
      ...pt,
      shortMonth: pt.month.slice(5),
      ebitdaActive: excludeUsufructRent ? pt.ebitdaExUsufruct : pt.ebitdaInclUsufruct,
    }));
  }, [state, excludeUsufructRent, period]);

  const latestAuditedTrend = useMemo(() => {
    const audited = trendSeries.filter((p) => p.quarter !== 'Q4');
    return audited[audited.length - 1] ?? trendSeries[trendSeries.length - 1];
  }, [trendSeries]);

  const periodLabel = useMemo(() => {
    const map: Record<string, { ar: string; en: string }> = {
      '9m_ytd': { ar: '9 شهور فعلي (يناير – سبتمبر 2026)', en: '9M YTD Audited (Jan – Sep 2026)' },
      Q1: { ar: 'الربع الأول 2026 (Q1)', en: 'Q1 2026 (Jan – Mar)' },
      Q2: { ar: 'الربع الثاني 2026 (Q2)', en: 'Q2 2026 (Apr – Jun)' },
      Q3: { ar: 'الربع الثالث 2026 (Q3)', en: 'Q3 2026 (Jul – Sep)' },
      '9m_plus_live': { ar: '9 شهور + العمليات المباشرة (أكتوبر 2026)', en: '9M Audited + Live October 2026' },
    };
    return map[period] ?? map['9m_ytd'];
  }, [period]);

  const renderPageHeader = (sectionTitleAr: string, sectionTitleEn: string, docCode: string) => (
    <header className="border-b-2 border-slate-900 pb-3 mb-4 flex items-start justify-between gap-4 print-avoid-break">
      <div>
        <div className="text-[10px] font-bold tracking-wider uppercase text-teal-800">
          {t(
            lang,
            'شركة استادات للاستثمار الرياضي — الحزمة التنفيذية للمدير المالي (CFO)',
            'ESTADAT SPORTS INVESTMENT — EXECUTIVE CFO BOARD PACK'
          )}
        </div>
        <h2 className="text-base font-bold text-slate-900 mt-0.5">
          {t(lang, sectionTitleAr, sectionTitleEn)}
        </h2>
        <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-600 mt-1">
          <span>{lang === 'ar' ? activeBranch?.nameAr : activeBranch?.nameEn}</span>
          <span aria-hidden="true">·</span>
          <span>{lang === 'ar' ? periodLabel.ar : periodLabel.en}</span>
          {excludeUsufructRent && (
            <>
              <span aria-hidden="true">·</span>
              <span className="font-semibold text-teal-800">
                {t(lang, 'عرض تشغيلي بدون حق الانتفاع', 'Operational View Ex-Usufruct')}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="text-end text-[10px] text-slate-600 font-mono-num shrink-0" dir="ltr">
        <div className="font-bold text-slate-900">{docCode}</div>
        <div>TAX ID: {state.taxId}</div>
        <div>CONFIDENTIAL · {printStamp}</div>
      </div>
    </header>
  );

  const visibleSectionsOrder = ALL_CFO_PRINT_SECTIONS.filter(showSection);
  const needsPageBreakBefore = (id: CfoPrintSectionId) => visibleSectionsOrder.indexOf(id) > 0;

  return (
    <div
      className="bg-white text-slate-900 text-[11px] leading-snug space-y-6"
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
    >
      {/* SECTION 1: Executive Summary, 9M P&L & Treasury */}
      {showSection('exec_pnl') && (
        <section className="space-y-4">
          {renderPageHeader(
            '1. الملخص التنفيذي وقائمة الدخل والمركز النقدي',
            '1. Executive Summary, Audited P&L & Treasury Position',
            'CFO-PACK-01'
          )}

          {/* 8-Cell KPI Strip */}
          <div className="grid grid-cols-4 gap-2.5 print-avoid-break">
            <div className="border border-slate-300 rounded-lg p-2.5">
              <div className="text-[10px] text-slate-500">{t(lang, 'صافي الإيرادات (بعد VAT)', 'Net Revenue (Ex-VAT)')}</div>
              <div className="text-sm font-bold text-slate-900 font-mono-num mt-0.5" dir="ltr">
                {fmtMoney(metrics.net, 0)} <span className="text-[9px] font-normal text-slate-500">EGP</span>
              </div>
              <div className="text-[9.5px] text-slate-500 font-mono-num mt-0.5" dir="ltr">
                Gross: {fmtMoney(metrics.gross, 0)}
              </div>
            </div>

            <div className="border border-slate-300 rounded-lg p-2.5">
              <div className="text-[10px] text-slate-500">{t(lang, 'مجمل الربح والهامش', 'Gross Profit & Margin')}</div>
              <div className="text-sm font-bold text-teal-800 font-mono-num mt-0.5" dir="ltr">
                {fmtMoney(metrics.gp, 0)} <span className="text-[9px] font-normal">({fmtPct(metrics.gpMarginPct)})</span>
              </div>
              <div className="text-[9.5px] text-slate-500 font-mono-num mt-0.5" dir="ltr">
                COGS: {fmtPct(metrics.foodCostPct)}
              </div>
            </div>

            <div className="border border-slate-300 rounded-lg p-2.5">
              <div className="text-[10px] text-slate-500">{t(lang, 'الرواتب والتكلفة الأولية', 'Payroll & Prime Cost')}</div>
              <div className="text-sm font-bold text-slate-900 font-mono-num mt-0.5" dir="ltr">
                {fmtMoney(metrics.payroll, 0)} <span className="text-[9px] font-normal">({fmtPct(metrics.payrollPct)})</span>
              </div>
              <div className="text-[9.5px] text-slate-500 font-mono-num mt-0.5" dir="ltr">
                Prime Cost: {fmtPct(metrics.primeCostPct)}
              </div>
            </div>

            <div className="border border-slate-300 rounded-lg p-2.5">
              <div className="text-[10px] text-slate-500">{t(lang, 'صافي النتيجة والهامش', 'Net Result & Margin')}</div>
              <div
                className={`text-sm font-bold font-mono-num mt-0.5 ${
                  metrics.netProfit < 0 ? 'text-red-700' : 'text-emerald-700'
                }`}
                dir="ltr"
              >
                {fmtMoney(metrics.netProfit, 0)} <span className="text-[9px] font-normal">({fmtPct(metrics.netMarginPct)})</span>
              </div>
              <div className="text-[9.5px] text-slate-500 font-mono-num mt-0.5" dir="ltr">
                BEP/mo: {fmtMoney(metrics.breakEvenMonthlyNet, 0)}
              </div>
            </div>

            <div className="border border-slate-300 rounded-lg p-2.5">
              <div className="text-[10px] text-slate-500">{t(lang, 'بنك CIB (1102)', 'CIB Bank Balance (1102)')}</div>
              <div className="text-sm font-bold text-slate-900 font-mono-num mt-0.5" dir="ltr">
                {fmtMoney(balances['1102'] ?? 0, 0)} EGP
              </div>
              <div className="text-[9.5px] text-slate-500 font-mono-num mt-0.5" dir="ltr">
                Vault 1101: {fmtMoney(balances['1101'] ?? 0, 0)}
              </div>
            </div>

            <div className="border border-slate-300 rounded-lg p-2.5">
              <div className="text-[10px] text-slate-500">{t(lang, 'حساب مقاصة Visa (1103)', 'Visa Clearing (1103)')}</div>
              <div className="text-sm font-bold text-slate-900 font-mono-num mt-0.5" dir="ltr">
                {fmtMoney(balances['1103'] ?? 0, 0)} EGP
              </div>
              <div className="text-[9.5px] text-slate-500">
                {t(lang, 'تحت التسوية البنكية', 'Pending Bank Settlement')}
              </div>
            </div>

            <div className="border border-slate-300 rounded-lg p-2.5">
              <div className="text-[10px] text-slate-500">{t(lang, 'تقييم المخزون WAC (1201)', 'Inventory WAC (1201)')}</div>
              <div className="text-sm font-bold text-slate-900 font-mono-num mt-0.5" dir="ltr">
                {fmtMoney(inventoryValue, 0)} EGP
              </div>
              <div className="text-[9.5px] text-slate-500 font-mono-num" dir="ltr">
                {state.ingredients.length} SKUs
              </div>
            </div>

            <div className="border border-slate-300 rounded-lg p-2.5">
              <div className="text-[10px] text-slate-500">{t(lang, 'صافي ضريبة القيمة المضافة', 'Net VAT Payable (14%)')}</div>
              <div className="text-sm font-bold text-teal-800 font-mono-num mt-0.5" dir="ltr">
                {fmtMoney(vatSummary.netVatPayable, 0)} EGP
              </div>
              <div className="text-[9.5px] text-slate-500 font-mono-num" dir="ltr">
                Out {fmtMoney(vatSummary.outputVat, 0)} - Ded {fmtMoney(vatSummary.deductibleInputVat, 0)} · Non-Ded {fmtMoney(vatSummary.nonDeductibleInputVat, 0)}
              </div>
            </div>
          </div>

          {/* 3-Column MoM Historical Trend Line Charts (Recharts SVG, Print-Safe Fixed Dimensions) */}
          <div className="print-avoid-break border border-slate-300 rounded-lg p-3 bg-slate-50/50">
            <div className="flex items-center justify-between gap-2 mb-2">
              <h3 className="text-xs font-bold text-slate-900">
                {t(
                  lang,
                  'اتجاه الأداء الشهري (MoM) — الإيرادات ومجمل الربح والـ EBITDA',
                  'Month-over-Month Performance Trend — Revenue, Gross Profit & EBITDA'
                )}
              </h3>
              {currentViewMode && (
                <span className="px-2 py-0.5 rounded border border-teal-300 bg-teal-50 text-teal-800 text-[9.5px] font-bold">
                  {t(lang, 'لقطة العرض النشط حالياً', 'Active Dashboard View Snapshot')}
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3" dir="ltr">
              {/* Revenue Trend */}
              <div className="bg-white border border-slate-200 rounded-md p-2">
                <div className="flex items-center justify-between text-[10px] mb-1">
                  <span className="font-bold text-slate-800">Net Revenue (MoM)</span>
                  <span className="font-mono-num font-bold text-teal-700">
                    {latestAuditedTrend?.revMomPct !== null && latestAuditedTrend?.revMomPct !== undefined
                      ? `${latestAuditedTrend.revMomPct > 0 ? '+' : ''}${latestAuditedTrend.revMomPct.toFixed(1)}%`
                      : '—'}
                  </span>
                </div>
                <LineChart width={205} height={82} data={trendSeries} margin={{ top: 4, right: 6, left: 6, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="2 2" stroke="#e2e8f0" />
                  <XAxis dataKey="shortMonth" tick={{ fontSize: 8, fill: '#64748b' }} tickLine={false} axisLine={false} />
                  <Line
                    type="monotone"
                    dataKey="netRevenue"
                    stroke="#0f766e"
                    strokeWidth={2}
                    dot={{ r: 2, fill: '#0f766e' }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </div>

              {/* Gross Profit Trend */}
              <div className="bg-white border border-slate-200 rounded-md p-2">
                <div className="flex items-center justify-between text-[10px] mb-1">
                  <span className="font-bold text-slate-800">Gross Profit (MoM)</span>
                  <span className="font-mono-num font-bold text-emerald-700">
                    {latestAuditedTrend?.gpMomPct !== null && latestAuditedTrend?.gpMomPct !== undefined
                      ? `${latestAuditedTrend.gpMomPct > 0 ? '+' : ''}${latestAuditedTrend.gpMomPct.toFixed(1)}%`
                      : '—'}
                  </span>
                </div>
                <LineChart width={205} height={82} data={trendSeries} margin={{ top: 4, right: 6, left: 6, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="2 2" stroke="#e2e8f0" />
                  <XAxis dataKey="shortMonth" tick={{ fontSize: 8, fill: '#64748b' }} tickLine={false} axisLine={false} />
                  <Line
                    type="monotone"
                    dataKey="grossProfit"
                    stroke="#059669"
                    strokeWidth={2}
                    dot={{ r: 2, fill: '#059669' }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </div>

              {/* EBITDA Trend */}
              <div className="bg-white border border-slate-200 rounded-md p-2">
                <div className="flex items-center justify-between text-[10px] mb-1">
                  <span className="font-bold text-slate-800">
                    {excludeUsufructRent ? 'EBITDA (Ex-Usufruct)' : 'EBITDA / Net Result'}
                  </span>
                  <span
                    className={`font-mono-num font-bold ${
                      (latestAuditedTrend?.ebitdaActive ?? 0) >= 0 ? 'text-emerald-700' : 'text-red-700'
                    }`}
                  >
                    {latestAuditedTrend?.ebitdaMomPct !== null && latestAuditedTrend?.ebitdaMomPct !== undefined
                      ? `${latestAuditedTrend.ebitdaMomPct > 0 ? '+' : ''}${latestAuditedTrend.ebitdaMomPct.toFixed(1)}%`
                      : '—'}
                  </span>
                </div>
                <LineChart width={205} height={82} data={trendSeries} margin={{ top: 4, right: 6, left: 6, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="2 2" stroke="#e2e8f0" />
                  <XAxis dataKey="shortMonth" tick={{ fontSize: 8, fill: '#64748b' }} tickLine={false} axisLine={false} />
                  <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="2 2" />
                  <Line
                    type="monotone"
                    dataKey="ebitdaActive"
                    stroke="#dc2626"
                    strokeWidth={2}
                    dot={{ r: 2, fill: '#dc2626' }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </div>
            </div>
          </div>

          {/* Quarterly & 9M Audited P&L Table */}
          <div className="print-avoid-break">
            <h3 className="text-xs font-bold text-slate-900 mb-1.5">
              {t(
                lang,
                'أولاً: ملخص قائمة الأداء المالي الربع سنوية والمجمعة (2026)',
                '1A. Audited Quarterly & YTD Income Statement Summary (2026)'
              )}
            </h3>
            <table className="w-full text-[10.5px] border border-slate-300">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-300 text-slate-700">
                  <th className="py-1.5 px-2.5 text-start font-bold">{t(lang, 'البند المالي', 'Line Item')}</th>
                  <th className="py-1.5 px-2.5 text-end font-bold">Q1 (Jan–Mar)</th>
                  <th className="py-1.5 px-2.5 text-end font-bold">Q2 (Apr–Jun)</th>
                  <th className="py-1.5 px-2.5 text-end font-bold">Q3 (Jul–Sep)</th>
                  <th className="py-1.5 px-2.5 text-end font-bold bg-slate-200/70">{t(lang, 'إجمالي 9M فعلي', '9M YTD Actual')}</th>
                  <th className="py-1.5 px-2.5 text-end font-bold">{t(lang, '% من الصافي', '% Net Rev')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {(() => {
                  const qSum = (q: 'Q1' | 'Q2' | 'Q3', fn: (m: (typeof state.monthlyActuals2026)[number]) => number) =>
                    state.monthlyActuals2026.filter((m) => m.quarter === q).reduce((a, m) => a + fn(m), 0);
                  const s = strat.actual9MSummary;
                  const rows = [
                    { ar: 'إجمالي المبيعات شامل VAT', en: 'Gross Revenue Incl. VAT', fn: (m: (typeof state.monthlyActuals2026)[number]) => m.grossRevenue, tot: s.grossRevenue, pct: '—' },
                    { ar: 'صافي الإيرادات (بعد VAT 14%)', en: 'Net Revenue After VAT', fn: (m: (typeof state.monthlyActuals2026)[number]) => m.netRevenue, tot: s.netRevenue, pct: '100.0%', bold: true },
                    { ar: 'تكلفة المبيعات (COGS)', en: 'Cost of Goods Sold (COGS)', fn: (m: (typeof state.monthlyActuals2026)[number]) => m.cogs, tot: s.cogs, pct: '41.0%' },
                    { ar: 'مجمل الربح (Gross Profit)', en: 'Gross Profit', fn: (m: (typeof state.monthlyActuals2026)[number]) => m.grossProfit, tot: s.grossProfit, pct: '59.0%', bold: true },
                    { ar: 'الأجور والرواتب والمنح', en: 'Payroll & Bonuses', fn: (m: (typeof state.monthlyActuals2026)[number]) => m.payroll, tot: s.payrollAndBonuses, pct: '56.1%' },
                    { ar: 'المصروفات التشغيلية وحق الانتفاع', en: 'OPEX Incl. Usufruct Rent', fn: (m: (typeof state.monthlyActuals2026)[number]) => m.totalOpexInclRent, tot: s.opexInclUsufruct, pct: '38.5%' },
                    { ar: 'عمولات بنكية وصافي الفوائد', en: 'Bank Fees & Net Interest', fn: (m: (typeof state.monthlyActuals2026)[number]) => m.bankFeesNet, tot: s.bankFeesNet, pct: '0.6%' },
                    { ar: 'صافي النتيجة المحاسبية (9 شهور)', en: 'Net Result (9M YTD)', fn: (m: (typeof state.monthlyActuals2026)[number]) => m.netProfit, tot: s.netResult, pct: '-36.1%', bold: true, highlightRed: true },
                  ];
                  return rows.map((r, idx) => (
                    <tr key={idx} className={r.highlightRed ? 'bg-red-50/70' : ''}>
                      <td className={`py-1.5 px-2.5 ${r.bold ? 'font-bold text-slate-900' : 'text-slate-700'}`}>
                        {lang === 'ar' ? r.ar : r.en}
                      </td>
                      <td className="py-1.5 px-2.5 text-end font-mono-num" dir="ltr">{fmtMoney(qSum('Q1', r.fn), 0)}</td>
                      <td className="py-1.5 px-2.5 text-end font-mono-num" dir="ltr">{fmtMoney(qSum('Q2', r.fn), 0)}</td>
                      <td className="py-1.5 px-2.5 text-end font-mono-num" dir="ltr">{fmtMoney(qSum('Q3', r.fn), 0)}</td>
                      <td className={`py-1.5 px-2.5 text-end font-mono-num font-bold bg-slate-50 ${r.highlightRed ? 'text-red-700' : 'text-slate-900'}`} dir="ltr">
                        {fmtMoney(r.tot, 0)}
                      </td>
                      <td className={`py-1.5 px-2.5 text-end font-mono-num ${r.highlightRed ? 'font-bold text-red-700' : 'text-slate-600'}`} dir="ltr">
                        {r.pct}
                      </td>
                    </tr>
                  ));
                })()}
              </tbody>
            </table>
          </div>

          {/* Monthly Trajectory Table */}
          <div className="print-avoid-break">
            <h3 className="text-xs font-bold text-slate-900 mb-1.5">
              {t(
                lang,
                'ثانياً: التحليل الشهري التفصيلي (يناير – سبتمبر 2026)',
                '1B. Monthly Performance Breakdown (Jan – Sep 2026)'
              )}
            </h3>
            <table className="w-full text-[10px] border border-slate-300">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-300 text-slate-700">
                  <th className="py-1.5 px-2 text-start font-bold">{t(lang, 'الشهر', 'Month')}</th>
                  <th className="py-1.5 px-2 text-end font-bold">{t(lang, 'صافي الإيراد', 'Net Sales')}</th>
                  <th className="py-1.5 px-2 text-end font-bold">COGS</th>
                  <th className="py-1.5 px-2 text-end font-bold">{t(lang, 'مجمل الربح', 'Gross Profit')}</th>
                  <th className="py-1.5 px-2 text-end font-bold">GP %</th>
                  <th className="py-1.5 px-2 text-end font-bold">{t(lang, 'الرواتب', 'Payroll')}</th>
                  <th className="py-1.5 px-2 text-end font-bold">{t(lang, 'حق الانتفاع', 'Usufruct')}</th>
                  <th className="py-1.5 px-2 text-end font-bold">{t(lang, 'أخرى وبنوك', 'OpEx/Bank')}</th>
                  <th className="py-1.5 px-2 text-end font-bold">{t(lang, 'صافي النتيجة', 'Net Result')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {metrics.rows.map((m) => (
                  <tr key={m.monthKey}>
                    <td className="py-1 px-2 font-semibold">{lang === 'ar' ? m.labelAr : m.labelEn}</td>
                    <td className="py-1 px-2 text-end font-mono-num" dir="ltr">{fmtMoney(m.netRevenue, 0)}</td>
                    <td className="py-1 px-2 text-end font-mono-num" dir="ltr">{fmtMoney(m.cogs, 0)}</td>
                    <td className="py-1 px-2 text-end font-mono-num" dir="ltr">{fmtMoney(m.grossProfit, 0)}</td>
                    <td className="py-1 px-2 text-end font-mono-num" dir="ltr">{fmtPct(m.gpMarginPct)}</td>
                    <td className="py-1 px-2 text-end font-mono-num" dir="ltr">{fmtMoney(m.payroll, 0)}</td>
                    <td className="py-1 px-2 text-end font-mono-num" dir="ltr">{fmtMoney(m.usufructRent, 0)}</td>
                    <td className="py-1 px-2 text-end font-mono-num" dir="ltr">{fmtMoney(m.electricity + m.otherOpex + m.bankFeesNet, 0)}</td>
                    <td className={`py-1 px-2 text-end font-mono-num font-bold ${m.netProfit < 0 ? 'text-red-700' : 'text-emerald-700'}`} dir="ltr">
                      {fmtMoney(m.netProfit, 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Executive Key Observations Box */}
          <div className="border border-slate-300 rounded-lg p-3 bg-slate-50 print-avoid-break">
            <div className="text-[11px] font-bold text-slate-900 mb-1">
              {t(lang, 'ملاحظات المراقبة المالية الحرجة (Key CFO Takeaways):', 'Key CFO Financial Takeaways:')}
            </div>
            <ul className="list-disc ps-5 space-y-1 text-[10.5px] text-slate-700">
              <li>
                {t(
                  lang,
                  `يمتص حق الانتفاع السنوي (${fmtMoney(SUNK_IDLE_RENT_ANNUAL, 0)} ج.م للمساحة الشاغرة البالغة 80% / ${TOTAL_UNUSED_SQM.toLocaleString('en-US')} م²) معظم هامش مجمل الربح التشغيلي (59.0%).`,
                  `80% idle usufruct burden (${fmtMoney(SUNK_IDLE_RENT_ANNUAL, 0)} EGP/yr across ${TOTAL_UNUSED_SQM.toLocaleString('en-US')} m²) absorbs operational gross profit (59.0%).`
                )}
              </li>
              <li>
                {t(
                  lang,
                  `ارتفعت نسبة الرواتب والمنح إلى 56.1% من صافي الإيرادات مع قفزة الكهرباء بنسبة +234% (من 12.9k إلى 43.1k شهرياً) مما يفرض ربط الحوافز بنقطة التعادل.`,
                  `Payroll & bonus batches reached 56.1% of net revenue while electricity rose +234% (12.9k → 43.1k/mo), requiring break-even-linked incentives.`
                )}
              </li>
            </ul>
          </div>
        </section>
      )}

      {/* SECTION 2: Cost Centers, Food Cost Variance & Stocktake */}
      {showSection('cost_variance') && (
        <section className={`${needsPageBreakBefore('cost_variance') ? 'print-break-before' : ''} space-y-4`}>
          {renderPageHeader(
            '2. الرقابة على مراكز التكلفة وانحراف الغذاء والجرد المخزني',
            '2. Cost Center Budget Control, Food Cost Variance & Stocktake Audit',
            'CFO-PACK-02'
          )}

          {/* Cost Centers */}
          <div className="print-avoid-break">
            <h3 className="text-xs font-bold text-slate-900 mb-1.5">
              {t(lang, 'أولاً: موازنة مراكز التكلفة مقابل المنصرف الفعلي', '2A. Cost Center Budget vs. Actual Utilization')}
            </h3>
            <table className="w-full text-[10.5px] border border-slate-300">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-300 text-slate-700">
                  <th className="py-1.5 px-2 text-start font-bold">{t(lang, 'الكود', 'CC')}</th>
                  <th className="py-1.5 px-2 text-start font-bold">{t(lang, 'مركز التكلفة', 'Cost Center')}</th>
                  <th className="py-1.5 px-2 text-start font-bold">{t(lang, 'الحساب', 'GL')}</th>
                  <th className="py-1.5 px-2 text-end font-bold">{t(lang, 'الموازنة المعتمدة', 'Budget')}</th>
                  <th className="py-1.5 px-2 text-end font-bold">{t(lang, 'المنصرف الفعلي', 'Actual')}</th>
                  <th className="py-1.5 px-2 text-end font-bold">{t(lang, 'نسبة الاستهلاك', 'Util %')}</th>
                  <th className="py-1.5 px-2 text-end font-bold">{t(lang, 'الفارق', 'Variance')}</th>
                  <th className="py-1.5 px-2 text-start font-bold">{t(lang, 'الحالة', 'Status')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {costCenterRows.map((c) => (
                  <tr key={c.id}>
                    <td className="py-1.5 px-2 font-mono-num font-bold" dir="ltr">{c.id}</td>
                    <td className="py-1.5 px-2 font-medium">{lang === 'ar' ? c.ar : c.en}</td>
                    <td className="py-1.5 px-2 font-mono-num text-slate-600" dir="ltr">{c.acct}</td>
                    <td className="py-1.5 px-2 text-end font-mono-num" dir="ltr">{fmtMoney(c.budget, 0)}</td>
                    <td className="py-1.5 px-2 text-end font-mono-num font-semibold" dir="ltr">{fmtMoney(c.actual, 0)}</td>
                    <td className="py-1.5 px-2 text-end font-mono-num font-bold" dir="ltr">{fmtPct(c.utilPct, 1)}</td>
                    <td className={`py-1.5 px-2 text-end font-mono-num ${c.variance < 0 ? 'text-red-700 font-bold' : 'text-emerald-700'}`} dir="ltr">
                      {fmtMoney(c.variance, 0)}
                    </td>
                    <td className="py-1.5 px-2 font-bold">
                      {c.status === 'exceeded'
                        ? t(lang, 'تجاوز السقف', 'EXCEEDED')
                        : c.status === 'approaching'
                        ? t(lang, 'اقتراب من الحد', 'APPROACHING')
                        : t(lang, 'منضبط', 'SAFE')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Food Cost Variance */}
          <div className="print-avoid-break">
            <div className="flex items-center justify-between mb-1.5">
              <h3 className="text-xs font-bold text-slate-900">
                {t(
                  lang,
                  'ثانياً: تحليل انحراف تكلفة الطعام (الفعلية مقابل الوصفات المعيارية > 5%)',
                  '2B. Food Cost Variance Analysis (Actual vs. Theoretical BOM > 5%)'
                )}
              </h3>
              <span className="text-[10px] font-mono-num font-bold text-red-700" dir="ltr">
                Actual {fmtPct(foodCostSummary.periodActualPct, 1)} vs Theo {fmtPct(foodCostSummary.periodTheoreticalPct, 1)} ({foodCostSummary.periodVariancePct >= 0 ? '+' : ''}{fmtPct(foodCostSummary.periodVariancePct, 1)})
              </span>
            </div>
            <table className="w-full text-[10px] border border-slate-300">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-300 text-slate-700">
                  <th className="py-1.5 px-2 text-start font-bold">{t(lang, 'الكود', 'Code')}</th>
                  <th className="py-1.5 px-2 text-start font-bold">{t(lang, 'الصنف', 'Menu Item')}</th>
                  <th className="py-1.5 px-2 text-end font-bold">{t(lang, 'المعياري %', 'Theo %')}</th>
                  <th className="py-1.5 px-2 text-end font-bold">{t(lang, 'الفعلي %', 'Actual %')}</th>
                  <th className="py-1.5 px-2 text-end font-bold">{t(lang, 'الانحراف %', 'Var %')}</th>
                  <th className="py-1.5 px-2 text-end font-bold">{t(lang, 'أثر الانحراف ج.م', 'Period Impact')}</th>
                  <th className="py-1.5 px-2 text-start font-bold">{t(lang, 'السبب الرئيسي', 'Root Driver')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {foodCostSummary.recipeVariances.slice(0, 8).map((r) => (
                  <tr key={r.menuItemId}>
                    <td className="py-1 px-2 font-mono-num font-semibold" dir="ltr">{r.code}</td>
                    <td className="py-1 px-2 font-medium">{lang === 'ar' ? r.nameAr : r.nameEn}</td>
                    <td className="py-1 px-2 text-end font-mono-num" dir="ltr">{fmtPct(r.theoreticalRecipePct, 1)}</td>
                    <td className="py-1 px-2 text-end font-mono-num" dir="ltr">{fmtPct(r.actualFoodCostPct, 1)}</td>
                    <td className={`py-1 px-2 text-end font-mono-num font-bold ${r.exceedsThreshold ? 'text-red-700' : 'text-slate-700'}`} dir="ltr">
                      {r.variancePct >= 0 ? '+' : ''}{fmtPct(r.variancePct, 1)}
                    </td>
                    <td className="py-1 px-2 text-end font-mono-num" dir="ltr">{fmtMoney(r.varianceTotalPeriod, 0)}</td>
                    <td className="py-1 px-2 text-slate-600">{lang === 'ar' ? r.driverAr : r.driverEn}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Stocktake Variance */}
          <div className="print-avoid-break">
            <div className="flex items-center justify-between mb-1.5">
              <h3 className="text-xs font-bold text-slate-900">
                {t(
                  lang,
                  'ثالثاً: تقرير الجرد الفعلي مقابل الرصيد الدفتري (تنبيهات > 2%)',
                  '2C. Physical Stocktake vs. Book Inventory Discrepancies (> 2%)'
                )}
              </h3>
              <span className="text-[10px] font-mono-num font-semibold text-slate-700" dir="ltr">
                Pending &gt;2%: {stocktakeSummary.pendingExceedingCount} · Net Var: {fmtMoney(stocktakeSummary.netVarianceValue, 0)} EGP
              </span>
            </div>
            <table className="w-full text-[10px] border border-slate-300">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-300 text-slate-700">
                  <th className="py-1.5 px-2 text-start font-bold">{t(lang, 'رقم الجرد', 'Count #')}</th>
                  <th className="py-1.5 px-2 text-start font-bold">{t(lang, 'الصنف الخام', 'Ingredient')}</th>
                  <th className="py-1.5 px-2 text-end font-bold">{t(lang, 'دفتري', 'Book')}</th>
                  <th className="py-1.5 px-2 text-end font-bold">{t(lang, 'فعلي', 'Actual')}</th>
                  <th className="py-1.5 px-2 text-end font-bold">{t(lang, 'الفرق %', 'Var %')}</th>
                  <th className="py-1.5 px-2 text-end font-bold">{t(lang, 'القيمة ج.م', 'Value EGP')}</th>
                  <th className="py-1.5 px-2 text-start font-bold">{t(lang, 'الحالة', 'Status')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {stocktakeSummary.items.slice(0, 8).map((item) => (
                  <tr key={item.entry.id}>
                    <td className="py-1 px-2 font-mono-num font-semibold" dir="ltr">{item.entry.countNo}</td>
                    <td className="py-1 px-2">{lang === 'ar' ? item.entry.ingredientNameAr : item.entry.ingredientNameEn}</td>
                    <td className="py-1 px-2 text-end font-mono-num" dir="ltr">{fmtMoney(item.liveBookQty, 1)}</td>
                    <td className="py-1 px-2 text-end font-mono-num" dir="ltr">{fmtMoney(item.entry.actualQty, 1)}</td>
                    <td className={`py-1 px-2 text-end font-mono-num font-bold ${item.exceedsThreshold ? 'text-red-700' : 'text-slate-700'}`} dir="ltr">
                      {item.signedVariancePct >= 0 ? '+' : ''}{fmtPct(item.signedVariancePct, 2)}
                    </td>
                    <td className="py-1 px-2 text-end font-mono-num font-semibold" dir="ltr">{fmtMoney(item.varianceValue, 0)}</td>
                    <td className="py-1 px-2">
                      {item.entry.status === 'reconciled'
                        ? t(lang, 'تمت التسوية', 'Reconciled')
                        : t(lang, 'معلق للتسوية', 'Pending')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* SECTION 3: 80% Unused Land Investment ROI Simulator & 2027 Strategy */}
      {showSection('roi_strategy') && (
        <section className={`${needsPageBreakBefore('roi_strategy') ? 'print-break-before' : ''} space-y-4`}>
          {renderPageHeader(
            '3. محاكي العائد الاستثماري للـ 80% فراغ وسيناريوهات موازنة 2027',
            '3. 80% Unused Land ROI Simulation (Payback & NPV) & 2027 Scenarios',
            'CFO-PACK-03'
          )}

          {/* Synced ROI Simulator Parameters & Headline Outputs */}
          <div className="border border-slate-300 rounded-lg p-3.5 space-y-3 print-avoid-break">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
              <div>
                <div className="text-xs font-bold text-slate-900">
                  {t(
                    lang,
                    'نتائج محاكاة استغلال المساحة غير المستغلة (80% = 23,825.4 م² من 29,781.8 م²)',
                    '80% Unused Site Activation Simulation (23,825.4 m² of 29,781.8 m²)'
                  )}
                </div>
                <div className="text-[10px] text-slate-600 mt-0.5">
                  {t(lang, 'النموذج النشط:', 'Active Model:')}{' '}
                  <span className="font-bold text-teal-800">
                    {activeRoiPreset
                      ? lang === 'ar'
                        ? activeRoiPreset.scenarioNameAr
                        : activeRoiPreset.scenarioNameEn
                      : t(lang, 'إدخال مخصص للمدير المالي', 'Custom CFO Simulation')}
                  </span>{' '}
                  · {t(lang, 'المساحة المفعلة:', 'Area Activated:')}{' '}
                  <span className="font-mono-num font-semibold" dir="ltr">
                    {roiInputs.activatedUnusedSharePct}% ({roiSim.activatedSqm.toLocaleString('en-US')} m² / {fmtPct((roiSim.activatedSqm / TOTAL_SITE_SQM) * 100, 1)} total)
                  </span>
                </div>
              </div>
              <div className="text-[10px] font-mono-num font-bold text-slate-900" dir="ltr">
                WACC {roiInputs.discountRatePct}% · {roiInputs.horizonYears}Y Horizon
              </div>
            </div>

            <div className="grid grid-cols-4 gap-2.5">
              <div className="border border-slate-200 rounded p-2 bg-slate-50">
                <div className="text-[9.5px] text-slate-500">{t(lang, 'الاستثمار الرأسمالي CAPEX', 'Total CAPEX')}</div>
                <div className="text-sm font-bold font-mono-num text-slate-900 mt-0.5" dir="ltr">
                  {fmtMoney(roiInputs.capexEgp, 0)} EGP
                </div>
                <div className="text-[9px] text-slate-500 font-mono-num" dir="ltr">
                  Share: {roiInputs.estadatSharePct}% · Op Margin {roiInputs.operatingMarginPct}%
                </div>
              </div>

              <div className="border border-slate-200 rounded p-2 bg-slate-50">
                <div className="text-[9.5px] text-slate-500">{t(lang, 'الإيراد الشهري المتوقع', 'Expected Monthly Rev')}</div>
                <div className="text-sm font-bold font-mono-num text-slate-900 mt-0.5" dir="ltr">
                  {fmtMoney(roiInputs.expectedMonthlyRevenueEgp, 0)} EGP
                </div>
                <div className="text-[9px] text-slate-500 font-mono-num" dir="ltr">
                  BEP (NPV=0): {roiSim.breakEvenMonthlyRevenueForNpvZero !== null ? fmtMoney(roiSim.breakEvenMonthlyRevenueForNpvZero, 0) : '—'}/mo
                </div>
              </div>

              <div className="border border-slate-200 rounded p-2 bg-slate-50">
                <div className="text-[9.5px] text-slate-500">{t(lang, 'فترة الاسترداد (Payback)', 'Payback Period')}</div>
                <div className="text-sm font-bold font-mono-num text-teal-800 mt-0.5" dir="ltr">
                  {roiSim.simplePaybackMonths !== null ? `${roiSim.simplePaybackMonths} mo` : `>${roiInputs.horizonYears * 12} mo`}
                </div>
                <div className="text-[9px] text-slate-500 font-mono-num" dir="ltr">
                  Discounted: {roiSim.discountedPaybackMonths !== null ? `${roiSim.discountedPaybackMonths} mo` : 'N/A'}
                </div>
              </div>

              <div className="border border-slate-200 rounded p-2 bg-slate-50">
                <div className="text-[9.5px] text-slate-500">{t(lang, 'صافي القيمة الحالية NPV و IRR', 'Projected NPV & IRR')}</div>
                <div className={`text-sm font-bold font-mono-num mt-0.5 ${roiSim.npvEgp >= 0 ? 'text-emerald-700' : 'text-red-700'}`} dir="ltr">
                  {fmtMoney(roiSim.npvEgp, 0)} EGP
                </div>
                <div className="text-[9px] text-slate-600 font-mono-num font-semibold" dir="ltr">
                  IRR: {roiSim.irrPct !== null ? `${roiSim.irrPct}%` : 'N/A'} · PI: {roiSim.profitabilityIndex}x
                </div>
              </div>
            </div>

            {/* DCF Year 0..N Schedule */}
            <table className="w-full text-[10px] border border-slate-300">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-300 text-slate-700">
                  <th className="py-1 px-2 text-start font-bold">{t(lang, 'السنة', 'Year')}</th>
                  <th className="py-1 px-2 text-end font-bold">{t(lang, 'الإيراد السنوي', 'Annual Rev')}</th>
                  <th className="py-1 px-2 text-end font-bold">{t(lang, 'حصة استادات', 'Estadat Share')}</th>
                  <th className="py-1 px-2 text-end font-bold">{t(lang, 'التدفق التشغيلي', 'Op. Cash Flow')}</th>
                  <th className="py-1 px-2 text-end font-bold">{t(lang, 'صافي التدفق', 'Net Cash Flow')}</th>
                  <th className="py-1 px-2 text-end font-bold">{t(lang, 'التراكمي', 'Cumulative CF')}</th>
                  <th className="py-1 px-2 text-end font-bold">{t(lang, 'القيمة الحالية المخصومة', 'Discounted PV')}</th>
                  <th className="py-1 px-2 text-end font-bold">{t(lang, 'التراكمي المخصوم', 'Cumul. PV')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                <tr className="bg-slate-50 font-semibold">
                  <td className="py-1 px-2 font-mono-num" dir="ltr">Y0</td>
                  <td className="py-1 px-2 text-end font-mono-num" dir="ltr">0</td>
                  <td className="py-1 px-2 text-end font-mono-num" dir="ltr">0</td>
                  <td className="py-1 px-2 text-end font-mono-num" dir="ltr">0</td>
                  <td className="py-1 px-2 text-end font-mono-num font-bold text-red-700" dir="ltr">-{fmtMoney(roiInputs.capexEgp, 0)}</td>
                  <td className="py-1 px-2 text-end font-mono-num text-red-700" dir="ltr">-{fmtMoney(roiInputs.capexEgp, 0)}</td>
                  <td className="py-1 px-2 text-end font-mono-num text-red-700" dir="ltr">-{fmtMoney(roiInputs.capexEgp, 0)}</td>
                  <td className="py-1 px-2 text-end font-mono-num font-bold text-red-700" dir="ltr">-{fmtMoney(roiInputs.capexEgp, 0)}</td>
                </tr>
                {roiSim.yearlySchedule.map((row) => (
                  <tr key={row.year}>
                    <td className="py-1 px-2 font-mono-num" dir="ltr">Y{row.year}</td>
                    <td className="py-1 px-2 text-end font-mono-num" dir="ltr">{fmtMoney(row.annualGrossRevenue, 0)}</td>
                    <td className="py-1 px-2 text-end font-mono-num" dir="ltr">{fmtMoney(row.estadatAttributedRevenue, 0)}</td>
                    <td className="py-1 px-2 text-end font-mono-num" dir="ltr">{fmtMoney(row.operatingCashFlowBeforeGov, 0)}</td>
                    <td className={`py-1 px-2 text-end font-mono-num font-bold ${row.annualNetCashFlow < 0 ? 'text-red-700' : 'text-emerald-700'}`} dir="ltr">
                      {fmtMoney(row.annualNetCashFlow, 0)}
                    </td>
                    <td className={`py-1 px-2 text-end font-mono-num ${row.cumulativeNominal < 0 ? 'text-red-700' : 'text-slate-900'}`} dir="ltr">
                      {fmtMoney(row.cumulativeNominal, 0)}
                    </td>
                    <td className="py-1 px-2 text-end font-mono-num" dir="ltr">{fmtMoney(row.presentValue, 0)}</td>
                    <td className={`py-1 px-2 text-end font-mono-num font-bold ${row.cumulativeDiscounted < 0 ? 'text-red-700' : 'text-teal-800'}`} dir="ltr">
                      {fmtMoney(row.cumulativeDiscounted, 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 2027 Strategic Scenarios Comparison */}
          <div className="print-avoid-break">
            <h3 className="text-xs font-bold text-slate-900 mb-1.5">
              {t(lang, 'ثانياً: مقارنة سيناريوهات الموازنة الاستراتيجية 2027 (A / B / C)', '3B. 2027 Strategic Budget Scenarios Comparison')}
            </h3>
            <table className="w-full text-[10.5px] border border-slate-300">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-300 text-slate-700">
                  <th className="py-1.5 px-2.5 text-start font-bold">{t(lang, 'السيناريو', 'Scenario')}</th>
                  <th className="py-1.5 px-2.5 text-end font-bold">{t(lang, 'صافي الإيراد 2027', '2027 Net Rev')}</th>
                  <th className="py-1.5 px-2.5 text-end font-bold">COGS %</th>
                  <th className="py-1.5 px-2.5 text-end font-bold">{t(lang, 'الرواتب', 'Payroll')}</th>
                  <th className="py-1.5 px-2.5 text-end font-bold">{t(lang, 'حق الانتفاع', 'Usufruct')}</th>
                  <th className="py-1.5 px-2.5 text-end font-bold">{t(lang, 'صافي النتيجة 2027', '2027 Net Result')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {strat.scenarios.map((sc) => (
                  <tr key={sc.id}>
                    <td className="py-1.5 px-2.5 font-semibold">
                      {sc.id}. {lang === 'ar' ? sc.nameAr : sc.nameEn}
                    </td>
                    <td className="py-1.5 px-2.5 text-end font-mono-num" dir="ltr">{fmtMoney(sc.netRevenue, 0)}</td>
                    <td className="py-1.5 px-2.5 text-end font-mono-num" dir="ltr">{fmtPct(sc.cogsPct, 1)}</td>
                    <td className="py-1.5 px-2.5 text-end font-mono-num" dir="ltr">{fmtMoney(sc.payroll, 0)}</td>
                    <td className="py-1.5 px-2.5 text-end font-mono-num" dir="ltr">{fmtMoney(sc.usufructRent, 0)}</td>
                    <td className={`py-1.5 px-2.5 text-end font-mono-num font-bold ${sc.netResult < 0 ? 'text-red-700' : 'text-emerald-700'}`} dir="ltr">
                      {fmtMoney(sc.netResult, 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* SECTION 4: Risk Register & Formal CFO Sign-off */}
      {showSection('risk_signoff') && (
        <section className={`${needsPageBreakBefore('risk_signoff') ? 'print-break-before' : ''} space-y-4`}>
          {renderPageHeader(
            '4. سجل المخاطر الاستراتيجية ومتابعة المعالجة والاعتماد الرسمي',
            '4. CFO Risk Register, Mitigation Tracking & Executive Sign-Off',
            'CFO-PACK-04'
          )}

          <div className="print-avoid-break">
            <table className="w-full text-[10px] border border-slate-300">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-300 text-slate-700">
                  <th className="py-1.5 px-2 text-start font-bold">{t(lang, 'الكود', 'Code')}</th>
                  <th className="py-1.5 px-2 text-start font-bold">{t(lang, 'الخطر ومصدره', 'Identified Risk')}</th>
                  <th className="py-1.5 px-2 text-start font-bold">{t(lang, 'التأثير', 'Impact')}</th>
                  <th className="py-1.5 px-2 text-start font-bold">{t(lang, 'الإجراء التصحيحي', 'Mitigation Action')}</th>
                  <th className="py-1.5 px-2 text-start font-bold">{t(lang, 'المسؤول', 'Owner')}</th>
                  <th className="py-1.5 px-2 text-start font-bold">{t(lang, 'الحالة', 'Status')}</th>
                  <th className="py-1.5 px-2 text-end font-bold">{t(lang, 'سجل التدقيق', 'Audit')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {normalizedRisks.map((r) => (
                  <tr key={r.id}>
                    <td className="py-1.5 px-2 font-mono-num font-bold" dir="ltr">{r.code}</td>
                    <td className="py-1.5 px-2 font-semibold">{lang === 'ar' ? r.riskAr : r.riskEn}</td>
                    <td
                      className={`py-1.5 px-2 font-bold uppercase ${
                        r.impact === 'high'
                          ? 'text-red-700'
                          : r.impact === 'medium'
                          ? 'text-amber-700'
                          : 'text-emerald-700'
                      }`}
                    >
                      {r.impact === 'high'
                        ? t(lang, 'مرتفع (High)', 'HIGH')
                        : r.impact === 'medium'
                        ? t(lang, 'متوسط (Med)', 'MEDIUM')
                        : t(lang, 'منخفض (Low)', 'LOW')}
                    </td>
                    <td className="py-1.5 px-2 text-slate-700">{lang === 'ar' ? r.mitigationAr : r.mitigationEn}</td>
                    <td className="py-1.5 px-2">{lang === 'ar' ? r.ownerAr : r.ownerEn}</td>
                    <td className="py-1.5 px-2 font-semibold">
                      {r.status === 'mitigated'
                        ? t(lang, 'معالج', 'Mitigated')
                        : r.status === 'in_progress'
                        ? t(lang, 'قيد التنفيذ', 'In Progress')
                        : t(lang, 'مفتوح', 'Open')}
                    </td>
                    <td className="py-1.5 px-2 text-end font-mono-num" dir="ltr">{r.auditHistory.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Executive Authorization & Signature Block */}
          <footer className="mt-8 pt-4 border-t-2 border-slate-900 grid grid-cols-3 gap-6 text-center text-[10.5px] text-slate-700 print-avoid-break">
            <div>
              <div className="font-bold text-slate-900 mb-1">
                {t(lang, 'إعداد / المراقب المالي ومراقب التكاليف', 'Prepared By / Financial Controller')}
              </div>
              <div className="text-[9.5px] text-slate-500 mb-7">
                {t(lang, 'إدارة الرقابة المالية — برج المنوفية', 'Financial Control — Menoufia Tower')}
              </div>
              <div className="border-t border-slate-400 pt-1 text-[9.5px] text-slate-500">
                {t(lang, 'التوقيع والتاريخ', 'Signature & Date')}
              </div>
            </div>

            <div>
              <div className="font-bold text-slate-900 mb-1">
                {t(lang, 'مراجعة / المراجعة الداخلية وإدارة المخاطر', 'Reviewed By / Internal Audit & Risk')}
              </div>
              <div className="text-[9.5px] text-slate-500 mb-7">
                {t(lang, 'شركة استادات للاستثمار الرياضي', 'Estadat Sports Investment')}
              </div>
              <div className="border-t border-slate-400 pt-1 text-[9.5px] text-slate-500">
                {t(lang, 'التوقيع والتاريخ', 'Signature & Date')}
              </div>
            </div>

            <div>
              <div className="font-bold text-slate-900 mb-1">
                {t(lang, 'اعتماد / المدير المالي للمجموعة CFO', 'Approved By / Group CFO')}
              </div>
              <div className="text-[9.5px] text-slate-500 mb-7">
                {t(lang, 'القرار التنفيذي والتوجيه المالي', 'Executive Authorization & Stamp')}
              </div>
              <div className="border-t border-slate-400 pt-1 text-[9.5px] text-slate-500">
                {t(lang, 'التوقيع والختم المعتمد', 'CFO Sign-Off & Stamp')}
              </div>
            </div>
          </footer>
        </section>
      )}
    </div>
  );
};

interface CfoPrintPreviewModalProps {
  open: boolean;
  onClose: () => void;
  state: ErpState;
  lang: Language;
  period: '9m_ytd' | 'Q1' | 'Q2' | 'Q3' | '9m_plus_live';
  excludeUsufructRent: boolean;
  costCenterBudgets: Record<'CC-HR' | 'CC-KITCHEN' | 'CC-ADMIN' | 'CC-FACILITY' | 'CC-TREASURY', number>;
  warningThresholdPct: number;
  selectedSections: CfoPrintSectionId[];
  onChangeSections: (sections: CfoPrintSectionId[]) => void;
  onExecutePrint: () => void;
  currentViewMode?: boolean;
}

export const CfoPrintPreviewModal: React.FC<CfoPrintPreviewModalProps> = ({
  open,
  onClose,
  state,
  lang,
  period,
  excludeUsufructRent,
  costCenterBudgets,
  warningThresholdPct,
  selectedSections,
  onChangeSections,
  onExecutePrint,
  currentViewMode = false,
}) => {
  if (!open) return null;

  const sectionOptions: { id: CfoPrintSectionId; ar: string; en: string }[] = [
    { id: 'exec_pnl', ar: '1. الملخص ومؤشرات KPI والرسوم البيانية', en: '1. KPI Cards, Trend Charts & P&L' },
    { id: 'cost_variance', ar: '2. مراكز التكلفة وانحراف الغذاء والجرد', en: '2. Cost Centers, Food Cost & Stocktake' },
    { id: 'roi_strategy', ar: '3. محاكي عائد 80% فراغ وخطة 2027', en: '3. 80% Land ROI & 2027 Scenarios' },
    { id: 'risk_signoff', ar: '4. سجل المخاطر والتوقيعات الرسمية', en: '4. Risk Register & CFO Sign-Off' },
  ];

  const toggleSection = (id: CfoPrintSectionId) => {
    if (selectedSections.includes(id)) {
      if (selectedSections.length === 1) return;
      onChangeSections(selectedSections.filter((s) => s !== id));
    } else {
      onChangeSections(ALL_CFO_PRINT_SECTIONS.filter((s) => selectedSections.includes(s) || s === id));
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/65 flex items-center justify-center p-4 no-print"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cfo-print-preview-title"
    >
      <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl max-w-6xl w-full max-h-[92vh] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-slate-900 text-white shrink-0">
              {currentViewMode ? <FileDown className="w-5 h-5" /> : <Printer className="w-5 h-5" />}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="cfo-print-preview-title" className="text-base font-bold text-slate-900">
                  {currentViewMode
                    ? t(
                        lang,
                        'تصدير العرض الحالي كـ PDF — بطاقات KPI والاتجاهات الشهرية (A4)',
                        'Export Current View as PDF — KPI Cards & Trend Charts (A4)'
                      )
                    : t(
                        lang,
                        'معاينة حزمة تقارير CFO الجاهزة للطباعة (A4 / PDF)',
                        'CFO Board-Ready Print Preview (A4 / PDF)'
                      )}
                </h2>
                {currentViewMode && (
                  <span className="px-2 py-0.5 rounded border border-teal-300 bg-teal-50 text-teal-800 text-[10px] font-bold">
                    {t(lang, 'إعداد مسبق للعرض الحالي', 'Pre-Configured Current View')}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500">
                {currentViewMode
                  ? t(
                      lang,
                      'تم ضبط التقرير تلقائياً لالتقاط مؤشرات الأداء الحالية (KPIs) والرسوم البيانية الشهرية (الإيراد، مجمل الربح، EBITDA) حسب الفلتر النشط.',
                      'Pre-configured to capture active KPI cards, period/usufruct filters, and Revenue/GP/EBITDA MoM trend charts in board-ready PDF format.'
                    )
                  : t(
                      lang,
                      'تنسيق تنفيذي رسمي متعدد الصفحات يشمل قائمة الدخل، مراكز التكلفة، عائد الـ 80% فراغ، وسجل المخاطر مع خانات الاعتماد.',
                      'Multi-page executive A4 formatting covering P&L, cost centers, 80% land ROI simulation, risk status & sign-off blocks.'
                    )}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-200/70 cursor-pointer"
            aria-label={t(lang, 'إغلاق', 'Close')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Section Selector Bar */}
        <div className="px-6 py-3 border-b border-slate-200 bg-white flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onChangeSections(ALL_CFO_PRINT_SECTIONS)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-800 cursor-pointer"
            >
              <CheckSquare className="w-3.5 h-3.5 text-teal-700" />
              <span>{t(lang, 'كل الأقسام (4)', 'All Sections (4)')}</span>
            </button>

            {sectionOptions.map((sec) => {
              const active = selectedSections.includes(sec.id);
              return (
                <button
                  key={sec.id}
                  type="button"
                  onClick={() => toggleSection(sec.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                    active
                      ? 'border-teal-600 bg-teal-50 text-teal-900 font-semibold'
                      : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  {active ? <CheckSquare className="w-3.5 h-3.5 text-teal-700" /> : <Square className="w-3.5 h-3.5" />}
                  <span>{lang === 'ar' ? sec.ar : sec.en}</span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={onExecutePrint}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold whitespace-nowrap cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>{t(lang, 'طباعة / حفظ PDF الآن', 'Print / Save as PDF')}</span>
          </button>
        </div>

        {/* Simulated A4 Paper Viewport */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-200/70">
          <div className="max-w-[210mm] mx-auto bg-white border border-slate-300 rounded-md shadow-md p-8">
            <CfoPrintableBrief
              state={state}
              lang={lang}
              period={period}
              excludeUsufructRent={excludeUsufructRent}
              costCenterBudgets={costCenterBudgets}
              warningThresholdPct={warningThresholdPct}
              sections={selectedSections}
              currentViewMode={currentViewMode}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
