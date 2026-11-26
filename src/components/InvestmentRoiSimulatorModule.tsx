import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookmarkPlus,
  Calculator,
  CheckCircle2,
  Download,
  LandPlot,
  OctagonAlert,
  Printer,
  RotateCcw,
  ShieldAlert,
  SlidersHorizontal,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import type { ErpState, Language } from '../types/erp';
import { round2 } from '../utils/erpEngine';
import { fmtMoney, fmtPct, t } from '../utils/formatters';
import {
  ANNUAL_USUFRUCT_RENT_2027,
  loadPinnedRoiScenarios,
  loadSavedRoiInputs,
  PinnedRoiScenario,
  ROI_PINNED_STORAGE_KEY,
  ROI_PRESETS,
  ROI_STORAGE_KEY,
  RoiPresetId,
  RoiSimulatorInputs,
  runRoiSimulation,
  SUNK_IDLE_RENT_ANNUAL,
  TOTAL_SITE_SQM,
  TOTAL_UNUSED_SQM,
} from '../utils/roiSimulatorEngine';

interface InvestmentRoiSimulatorModuleProps {
  state: ErpState;
  lang: Language;
  onBackToDashboard?: () => void;
}

export const InvestmentRoiSimulatorModule: React.FC<InvestmentRoiSimulatorModuleProps> = ({
  state,
  lang,
  onBackToDashboard,
}) => {
  const [inputs, setInputs] = useState<RoiSimulatorInputs>(loadSavedRoiInputs);
  const [pinnedScenarios, setPinnedScenarios] = useState<PinnedRoiScenario[]>(loadPinnedRoiScenarios);

  useEffect(() => {
    try {
      localStorage.setItem(ROI_STORAGE_KEY, JSON.stringify(inputs));
    } catch {
      // ignore storage quota errors
    }
  }, [inputs]);

  useEffect(() => {
    try {
      localStorage.setItem(ROI_PINNED_STORAGE_KEY, JSON.stringify(pinnedScenarios));
    } catch {
      // ignore storage quota errors
    }
  }, [pinnedScenarios]);

  const sim = useMemo(() => runRoiSimulation(inputs), [inputs]);

  const currentAnnualizedLoss = useMemo(() => {
    const nineMNet = state.strategy2027.actual9MSummary.netResult; // -4,098,494
    return Math.abs(round2((nineMNet / 9) * 12)); // ~5,464,659
  }, [state.strategy2027.actual9MSummary.netResult]);

  const lossOffsetPct = useMemo(() => {
    if (currentAnnualizedLoss <= 0) return 0;
    return round2(Math.min(200, Math.max(0, (sim.year1AnnualNetCashFlow / currentAnnualizedLoss) * 100)));
  }, [sim.year1AnnualNetCashFlow, currentAnnualizedLoss]);

  const updateField = <K extends keyof RoiSimulatorInputs>(key: K, value: RoiSimulatorInputs[K]) => {
    setInputs((prev) => ({
      ...prev,
      presetId: 'custom',
      scenarioNameAr: 'سيناريو مخصص (CFO)',
      scenarioNameEn: 'Custom CFO Scenario',
      [key]: value,
    }));
  };

  const applyPreset = (presetKey: Exclude<RoiPresetId, 'custom'>) => {
    setInputs(ROI_PRESETS[presetKey]);
  };

  const handleReset = () => {
    setInputs(ROI_PRESETS.jv_partner);
  };

  const handlePinScenario = () => {
    const newEntry: PinnedRoiScenario = {
      id: `ROI-${Date.now()}`,
      pinnedAt: new Date().toISOString().slice(11, 16),
      inputs: { ...inputs },
      result: sim,
    };
    setPinnedScenarios((prev) => [newEntry, ...prev].slice(0, 4));
  };

  const handleRemovePinned = (id: string) => {
    setPinnedScenarios((prev) => prev.filter((s) => s.id !== id));
  };

  // Sensitivity Matrix (CAPEX -20%..+20% vs Monthly Revenue -20%..+20%)
  const sensitivityMatrix = useMemo(() => {
    const capexSteps = [-0.2, -0.1, 0, 0.1, 0.2];
    const revSteps = [0.2, 0.1, 0, -0.1, -0.2]; // higher revenue at top
    return {
      capexSteps,
      revSteps,
      rows: revSteps.map((revDelta) => {
        const testedRev = Math.max(0, round2(inputs.expectedMonthlyRevenueEgp * (1 + revDelta)));
        return {
          revDelta,
          testedRev,
          cells: capexSteps.map((capDelta) => {
            const testedCapex = Math.max(0, round2(inputs.capexEgp * (1 + capDelta)));
            const res = runRoiSimulation({
              ...inputs,
              capexEgp: testedCapex,
              expectedMonthlyRevenueEgp: testedRev,
            });
            return {
              capDelta,
              testedCapex,
              npvEgp: res.npvEgp,
              paybackMonths: res.simplePaybackMonths,
              isBase: capDelta === 0 && revDelta === 0,
            };
          }),
        };
      }),
    };
  }, [inputs]);

  const handleExportCsv = () => {
    const headers = [
      'Year',
      'Activated Area (m2)',
      'Avg Monthly Revenue (EGP)',
      'Annual Gross Revenue (EGP)',
      'Estadaat Attributed Revenue (EGP)',
      'Operating Cash Flow Before Gov (EGP)',
      '20% Gov Profit Share (EGP)',
      'Net Annual Cash Flow (EGP)',
      'Discount Factor',
      'Present Value PV (EGP)',
      'Cumulative Nominal CF (EGP)',
      'Cumulative Discounted PV (EGP)',
    ];
    const rows: (string | number)[][] = [
      [
        0,
        sim.activatedSqm,
        0,
        0,
        0,
        0,
        0,
        -inputs.capexEgp,
        '1.0000',
        -inputs.capexEgp,
        -inputs.capexEgp,
        -inputs.capexEgp,
      ],
      ...sim.yearlySchedule.map((r) => [
        r.year,
        r.activatedSqm,
        r.monthlyRevenueAvg,
        r.annualGrossRevenue,
        r.estadatAttributedRevenue,
        r.operatingCashFlowBeforeGov,
        -r.govProfitShareDeduction,
        r.annualNetCashFlow,
        r.discountFactor,
        r.presentValue,
        r.cumulativeNominal,
        r.cumulativeDiscounted,
      ]),
    ];
    rows.push([]);
    rows.push(['NPV (EGP)', sim.npvEgp]);
    rows.push(['IRR (%)', sim.irrPct ?? 'N/A']);
    rows.push(['Simple Payback (Months)', sim.simplePaybackMonths ?? 'Unrecovered']);
    rows.push(['Discounted Payback (Months)', sim.discountedPaybackMonths ?? 'Unrecovered']);
    rows.push(['Profitability Index (PI)', sim.profitabilityIndex]);

    const csv = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `estadat_80pct_land_roi_simulation_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Cash flow curve geometry for SVG chart
  const chartModel = useMemo(() => {
    const points = [
      { year: 0, nominal: -inputs.capexEgp, discounted: -inputs.capexEgp },
      ...sim.yearlySchedule.map((r) => ({
        year: r.year,
        nominal: r.cumulativeNominal,
        discounted: r.cumulativeDiscounted,
      })),
    ];
    const allVals = points.flatMap((p) => [p.nominal, p.discounted, 0]);
    const rawMin = Math.min(...allVals);
    const rawMax = Math.max(...allVals);
    const pad = Math.max(500000, (rawMax - rawMin) * 0.12);
    const minVal = rawMin - pad * 0.4;
    const maxVal = rawMax + pad * 0.4;
    const range = Math.max(1, maxVal - minVal);

    const w = 680;
    const h = 230;
    const padL = 64;
    const padR = 24;
    const padT = 20;
    const padB = 34;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    const xFor = (yr: number) => padL + (yr / Math.max(1, inputs.horizonYears)) * plotW;
    const yFor = (val: number) => padT + ((maxVal - val) / range) * plotH;
    const zeroY = yFor(0);

    const nominalPath = points
      .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${xFor(p.year).toFixed(1)} ${yFor(p.nominal).toFixed(1)}`)
      .join(' ');
    const discountedPath = points
      .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${xFor(p.year).toFixed(1)} ${yFor(p.discounted).toFixed(1)}`)
      .join(' ');

    return { points, w, h, padL, padR, padT, padB, xFor, yFor, zeroY, nominalPath, discountedPath };
  }, [inputs.capexEgp, inputs.horizonYears, sim.yearlySchedule]);

  return (
    <div className="space-y-6">
      {/* Executive A4 Print Letterhead */}
      <div className="hidden print:flex items-start justify-between border-b-2 border-slate-900 pb-3 mb-2">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-teal-800">
            {t(lang, 'شركة استادات للاستثمار الرياضي — دراسة جدوى استثمارية (CFO)', 'ESTADAT SPORTS INVESTMENT — CFO INVESTMENT FEASIBILITY BRIEF')}
          </div>
          <div className="text-base font-bold text-slate-900 mt-0.5">
            {t(lang, 'محاكي عائد الـ 80% فراغ ببرج المنوفية (CAPEX · Payback · NPV · IRR)', 'Menoufia Tower 80% Unused Land ROI Simulation')}
          </div>
        </div>
        <div className="text-end text-[10px] font-mono-num text-slate-600" dir="ltr">
          <div>TAX ID: {state.taxId}</div>
          <div>Printed: {new Date().toISOString().slice(0, 10)}</div>
        </div>
      </div>

      {/* Header Banner */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 print-avoid-break">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="font-semibold text-teal-700">
              {t(lang, 'استغلال الأصول غير المستغلة', 'Idle Land Asset Monetization')}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-num" dir="ltr">
              {TOTAL_SITE_SQM.toLocaleString('en-US')} m² {t(lang, 'إجمالي الموقع', 'Total Site')}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-num text-amber-700 font-semibold" dir="ltr">
              80% {t(lang, 'شاغر', 'Idle')} ({TOTAL_UNUSED_SQM.toLocaleString('en-US')} m²)
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-num" dir="ltr">
              {t(lang, 'عبء انتفاع غير مستغل:', 'Sunk Idle Rent:')} {fmtMoney(SUNK_IDLE_RENT_ANNUAL, 0)} EGP/yr
            </span>
          </div>

          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <LandPlot className="w-5 h-5 text-teal-700 shrink-0" />
            <span>
              {t(
                lang,
                'محاكي العائد الاستثماري للـ 80% فراغ (Investment ROI Simulator)',
                'Investment ROI Simulator — 80% Unused Land (Payback & NPV)'
              )}
            </span>
          </h1>

          <p className="text-xs text-slate-500 max-w-3xl">
            {t(
              lang,
              'أدخل مبالغ الاستثمار الرأسمالي (CAPEX) والإيرادات الشهرية المتوقعة لتقييم فترة الاسترداد، صافي القيمة الحالية (NPV)، ومعدل العائد الداخلي (IRR) لمساحة برج المنوفية غير المستغلة.',
              'Test custom CAPEX budgets and expected monthly revenue streams on Menoufia Tower’s 80% unused land to evaluate Payback Period, Discounted Payback, NPV, and IRR.'
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0 no-print">
          {onBackToDashboard && (
            <button
              type="button"
              onClick={onBackToDashboard}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer"
            >
              {lang === 'ar' ? <ArrowRight className="w-3.5 h-3.5" /> : <ArrowLeft className="w-3.5 h-3.5" />}
              <span>{t(lang, 'العودة للوحة CFO', 'Back to CFO Dashboard')}</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-teal-700" />
            <span>{t(lang, 'تصدير التدفقات CSV', 'Export DCF CSV')}</span>
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>{t(lang, 'طباعة الدراسة', 'Print Study')}</span>
          </button>
        </div>
      </div>

      {/* Preset Strategy Selector Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 no-print">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
          <SlidersHorizontal className="w-4 h-4 text-teal-700" />
          <span>{t(lang, 'نماذج استثمارية جاهزة (Presets):', 'Investment Model Presets:')}</span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-100 rounded-lg">
          {(
            [
              { id: 'jv_partner', ar: 'شراكة JV (2.2م CAPEX)', en: 'JV Partner (2.2M CAPEX)' },
              { id: 'direct', ar: 'استثمار مباشر (6.2م)', en: 'Direct Op (6.2M CAPEX)' },
              { id: 'sublease', ar: 'أكشاك ومناطق تجارية (1.1م)', en: 'Concessions (1.1M CAPEX)' },
              { id: 'full_complex', ar: 'التوسع الشامل 80% (9.5م)', en: 'Full 80% Expansion (9.5M)' },
            ] as const
          ).map((preset) => {
            const active = inputs.presetId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPreset(preset.id)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                  active ? 'bg-teal-700 text-white shadow-xs' : 'text-slate-700 hover:text-slate-900'
                }`}
              >
                {lang === 'ar' ? preset.ar : preset.en}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Simulator Grid: Inputs (4 cols) + Outputs & Chart (8 cols) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left/Start Panel: Interactive Financial Parameters */}
        <section className="xl:col-span-4 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Calculator className="w-4 h-4 text-teal-700" />
                <span>{t(lang, 'مدخلات الاستثمار والتشغيل', 'CAPEX & Revenue Assumptions')}</span>
              </h2>
            </div>
            <button
              type="button"
              onClick={handleReset}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-[11px] font-medium text-slate-600 cursor-pointer no-print"
            >
              <RotateCcw className="w-3 h-3" />
              <span>{t(lang, 'إعادة ضبط', 'Reset')}</span>
            </button>
          </div>

          <div className="p-5 space-y-5 text-xs">
            {/* 1. CAPEX Input */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="roi-capex-input" className="font-bold text-slate-800">
                  {t(lang, 'إجمالي الإنفاق الرأسمالي (CAPEX)', 'Initial Investment (CAPEX)')}
                </label>
                <span className="font-mono-num text-teal-700 font-bold" dir="ltr">
                  {fmtMoney(inputs.capexEgp, 0)} EGP
                </span>
              </div>
              <input
                id="roi-capex-input"
                type="number"
                min={0}
                step={50000}
                value={inputs.capexEgp}
                onChange={(e) => updateField('capexEgp', Math.max(0, Number(e.target.value) || 0))}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white font-mono-num text-sm font-bold text-slate-900 focus:outline-none focus:border-teal-600"
                dir="ltr"
              />
              <input
                type="range"
                min={250000}
                max={20000000}
                step={100000}
                value={Math.min(20000000, inputs.capexEgp)}
                onChange={(e) => updateField('capexEgp', Number(e.target.value))}
                className="w-full accent-teal-700 cursor-pointer"
                aria-label={t(lang, 'شريط تحديد CAPEX', 'CAPEX Slider')}
              />
              <div className="flex flex-wrap items-center gap-1.5">
                {[1000000, 2200000, 4500000, 6200000, 9500000].map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => updateField('capexEgp', amt)}
                    className={`px-2 py-1 rounded border text-[11px] font-mono-num cursor-pointer transition-colors ${
                      inputs.capexEgp === amt
                        ? 'bg-teal-700 border-teal-700 text-white font-semibold'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                    dir="ltr"
                  >
                    {(amt / 1000000).toFixed(1)}M
                  </button>
                ))}
              </div>
            </div>

            {/* 2. Expected Monthly Revenue */}
            <div className="pt-4 border-t border-slate-100 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="roi-rev-input" className="font-bold text-slate-800">
                  {t(lang, 'الإيراد الشهري المتوقع (صافي بدون VAT)', 'Expected Monthly Revenue (Net Ex-VAT)')}
                </label>
                <span className="font-mono-num text-slate-900 font-bold" dir="ltr">
                  {fmtMoney(inputs.expectedMonthlyRevenueEgp, 0)} /mo
                </span>
              </div>
              <input
                id="roi-rev-input"
                type="number"
                min={0}
                step={25000}
                value={inputs.expectedMonthlyRevenueEgp}
                onChange={(e) =>
                  updateField('expectedMonthlyRevenueEgp', Math.max(0, Number(e.target.value) || 0))
                }
                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white font-mono-num text-sm font-bold text-slate-900 focus:outline-none focus:border-teal-600"
                dir="ltr"
              />
              <input
                type="range"
                min={50000}
                max={3000000}
                step={25000}
                value={Math.min(3000000, inputs.expectedMonthlyRevenueEgp)}
                onChange={(e) => updateField('expectedMonthlyRevenueEgp', Number(e.target.value))}
                className="w-full accent-teal-700 cursor-pointer"
                aria-label={t(lang, 'شريط تحديد الإيراد الشهري', 'Expected Monthly Revenue Slider')}
              />
              <div className="flex flex-wrap items-center justify-between text-[11px] text-slate-500 font-mono-num" dir="ltr">
                <span>Gross Incl. 14% VAT: {fmtMoney(inputs.expectedMonthlyRevenueEgp * 1.14, 0)}</span>
                <span>Annual: {fmtMoney(inputs.expectedMonthlyRevenueEgp * 12, 0)}</span>
              </div>
            </div>

            {/* 3. % of 80% Unused Land Activated */}
            <div className="pt-4 border-t border-slate-100 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="roi-area-slider" className="font-semibold text-slate-700">
                  {t(lang, 'نسبة التطوير من الـ 80% الفارغة', '% of Idle Space Activated')}
                </label>
                <span className="font-mono-num font-bold text-slate-900" dir="ltr">
                  {inputs.activatedUnusedSharePct}% ({sim.activatedSqm.toLocaleString('en-US')} m²)
                </span>
              </div>
              <input
                id="roi-area-slider"
                type="range"
                min={10}
                max={100}
                step={5}
                value={inputs.activatedUnusedSharePct}
                onChange={(e) => updateField('activatedUnusedSharePct', Number(e.target.value))}
                className="w-full accent-teal-700 cursor-pointer"
              />
              <div className="flex items-center justify-between text-[11px] text-slate-500">
                <span>
                  {t(lang, 'إشغال الموقع بعد التطوير:', 'Total Site Utilization:')}
                </span>
                <span className="font-mono-num font-semibold text-teal-700" dir="ltr">
                  20% → {sim.siteUtilizationAfterPct}%
                </span>
              </div>
            </div>

            {/* 4. Financial Structure Grid */}
            <div className="pt-4 border-t border-slate-100 grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">
                  {t(lang, 'حصة استادات من الإيراد %', 'Estadaat Revenue Share %')}
                </label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  step={1}
                  value={inputs.estadatSharePct}
                  onChange={(e) =>
                    updateField('estadatSharePct', Math.min(100, Math.max(1, Number(e.target.value) || 1)))
                  }
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-mono-num text-xs font-semibold"
                  dir="ltr"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">
                  {t(lang, 'هامش التشغيل EBITDA %', 'Operating EBITDA Margin %')}
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={inputs.operatingMarginPct}
                  onChange={(e) =>
                    updateField('operatingMarginPct', Math.min(100, Math.max(0, Number(e.target.value) || 0)))
                  }
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-mono-num text-xs font-semibold"
                  dir="ltr"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">
                  {t(lang, 'مصروف ثابت إضافي/شهر', 'Added Fixed OPEX/mo')}
                </label>
                <input
                  type="number"
                  min={0}
                  step={5000}
                  value={inputs.incrementalFixedOpexMonthlyEgp}
                  onChange={(e) =>
                    updateField('incrementalFixedOpexMonthlyEgp', Math.max(0, Number(e.target.value) || 0))
                  }
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-mono-num text-xs font-semibold"
                  dir="ltr"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">
                  {t(lang, 'نمو الإيراد السنوي %', 'Annual Rev Growth %')}
                </label>
                <input
                  type="number"
                  min={-15}
                  max={40}
                  step={1}
                  value={inputs.annualGrowthPct}
                  onChange={(e) =>
                    updateField('annualGrowthPct', Math.min(40, Math.max(-15, Number(e.target.value) || 0)))
                  }
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-mono-num text-xs font-semibold"
                  dir="ltr"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">
                  {t(lang, 'معدل الخصم WACC %', 'Discount Rate (WACC %)')}
                </label>
                <input
                  type="number"
                  min={1}
                  max={60}
                  step={0.5}
                  value={inputs.discountRatePct}
                  onChange={(e) =>
                    updateField('discountRatePct', Math.min(60, Math.max(1, Number(e.target.value) || 22)))
                  }
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-mono-num text-xs font-semibold"
                  dir="ltr"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">
                  {t(lang, 'أفق التقييم (سنوات)', 'Horizon (Years)')}
                </label>
                <div className="grid grid-cols-4 gap-1 p-0.5 bg-slate-100 rounded-lg">
                  {([3, 5, 7, 10] as const).map((yr) => (
                    <button
                      key={yr}
                      type="button"
                      onClick={() => updateField('horizonYears', yr)}
                      className={`py-1 rounded text-[11px] font-mono-num font-semibold cursor-pointer transition-colors ${
                        inputs.horizonYears === yr
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {yr}Y
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 5. Usufruct 20% Profit Share Clause Toggle */}
            <div className="pt-3 border-t border-slate-100 space-y-3">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={inputs.applyGovProfitShare20Pct}
                  onChange={(e) => updateField('applyGovProfitShare20Pct', e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                />
                <span className="text-xs text-slate-700 leading-relaxed">
                  {t(
                    lang,
                    'تطبيق بند مشاركة محافظة المنوفية (20% من صافي أرباح التشغيل) كاختبار تحوط تعاقدي.',
                    'Apply contractual 20% Menoufia Governorate net operating profit share as conservative stress test.'
                  )}
                </span>
              </label>

              <button
                type="button"
                onClick={handlePinScenario}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold transition-colors cursor-pointer no-print"
              >
                <BookmarkPlus className="w-4 h-4" />
                <span>{t(lang, 'تثبيت هذا السيناريو في جدول المقارنة', 'Pin Scenario to Comparison Table')}</span>
              </button>
            </div>
          </div>
        </section>

        {/* Right/End Panel: Projected Payback, NPV, IRR & Cumulative J-Curve */}
        <div className="xl:col-span-8 space-y-6">
          {/* 4 Headline CFO Outputs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs font-medium text-slate-500">
                {t(lang, 'فترة الاسترداد (Payback Period)', 'Projected Payback Period')}
              </div>
              <div className="mt-2 flex items-baseline justify-between gap-2">
                <span
                  className={`text-2xl font-bold font-mono-num ${
                    sim.simplePaybackMonths !== null ? 'text-slate-900' : 'text-red-600'
                  }`}
                  dir="ltr"
                >
                  {sim.simplePaybackMonths !== null
                    ? `${sim.simplePaybackMonths} ${t(lang, 'ش', 'mo')}`
                    : t(lang, 'غير مسترد', 'Unrecovered')}
                </span>
                {sim.simplePaybackYears !== null && (
                  <span className="text-xs font-semibold text-teal-700 font-mono-num" dir="ltr">
                    {sim.simplePaybackYears} {t(lang, 'سنة', 'yrs')}
                  </span>
                )}
              </div>
              <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                <span>{t(lang, 'الاسترداد المخصوم:', 'Discounted:')}</span>
                <span className="font-mono-num font-semibold text-slate-800" dir="ltr">
                  {sim.discountedPaybackMonths !== null
                    ? `${sim.discountedPaybackMonths} ${t(lang, 'ش', 'mo')} (${sim.discountedPaybackYears}y)`
                    : `>${inputs.horizonYears}Y`}
                </span>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs font-medium text-slate-500">
                {t(lang, `صافي القيمة الحالية (NPV @ ${inputs.discountRatePct}%)`, `Net Present Value (NPV @ ${inputs.discountRatePct}%)`)}
              </div>
              <div className="mt-2 flex items-baseline justify-between gap-2">
                <span
                  className={`text-2xl font-bold font-mono-num ${
                    sim.npvEgp >= 0 ? 'text-emerald-700' : 'text-red-600'
                  }`}
                  dir="ltr"
                >
                  {sim.npvEgp >= 0 ? '+' : ''}
                  {fmtMoney(sim.npvEgp, 0)}
                </span>
                <span className="text-xs text-slate-500">{t(lang, 'ج.م', 'EGP')}</span>
              </div>
              <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                <span>{t(lang, 'مؤشر الربحية PI:', 'Profitability Index:')}</span>
                <span className="font-mono-num font-bold text-slate-800" dir="ltr">
                  {sim.profitabilityIndex.toFixed(2)}x
                </span>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs font-medium text-slate-500">
                {t(lang, 'معدل العائد الداخلي (IRR vs WACC)', 'Internal Rate of Return (IRR)')}
              </div>
              <div className="mt-2 flex items-baseline justify-between gap-2">
                <span
                  className={`text-2xl font-bold font-mono-num ${
                    sim.irrPct !== null && sim.irrPct >= inputs.discountRatePct
                      ? 'text-emerald-700'
                      : 'text-amber-700'
                  }`}
                  dir="ltr"
                >
                  {sim.irrPct !== null ? fmtPct(sim.irrPct, 1) : 'N/A'}
                </span>
                {sim.irrSpreadPct !== null && (
                  <span
                    className={`text-xs font-bold font-mono-num ${
                      sim.irrSpreadPct >= 0 ? 'text-emerald-700' : 'text-red-600'
                    }`}
                    dir="ltr"
                  >
                    {sim.irrSpreadPct >= 0 ? '+' : ''}
                    {fmtPct(sim.irrSpreadPct, 1)}
                  </span>
                )}
              </div>
              <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                <span>{t(lang, 'العائد السنوي (سنة 1):', 'Year-1 Cash ROI:')}</span>
                <span className="font-mono-num font-semibold text-slate-800" dir="ltr">
                  {fmtPct(sim.year1RoiPct, 1)}
                </span>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs font-medium text-slate-500">
                {t(lang, 'صافي التدفق الشهري وتعويض الخسارة', 'Monthly Net CF & Loss Offset')}
              </div>
              <div className="mt-2 flex items-baseline justify-between gap-2">
                <span
                  className={`text-2xl font-bold font-mono-num ${
                    sim.year1MonthlyNetCashFlow >= 0 ? 'text-slate-900' : 'text-red-600'
                  }`}
                  dir="ltr"
                >
                  {fmtMoney(sim.year1MonthlyNetCashFlow, 0)}
                </span>
                <span className="text-xs text-slate-500">{t(lang, 'ج/شهر', 'EGP/mo')}</span>
              </div>
              <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                <span>{t(lang, 'تغطية خسارة 2026 (-5.5م):', '2026 Loss Offset:')}</span>
                <span className="font-mono-num font-bold text-teal-700" dir="ltr">
                  {fmtPct(lossOffsetPct, 0)}
                </span>
              </div>
            </div>
          </div>

          {/* Executive Investment Verdict Banner */}
          <div
            className={`rounded-xl border px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
              sim.decisionSignal === 'approve'
                ? 'bg-emerald-50/80 border-emerald-200 text-emerald-950'
                : sim.decisionSignal === 'conditional'
                ? 'bg-amber-50/80 border-amber-200 text-amber-950'
                : 'bg-red-50/80 border-red-200 text-red-950'
            }`}
          >
            <div className="flex items-start gap-3">
              {sim.decisionSignal === 'approve' ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
              ) : sim.decisionSignal === 'conditional' ? (
                <ShieldAlert className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
              ) : (
                <OctagonAlert className="w-5 h-5 text-red-700 shrink-0 mt-0.5" />
              )}
              <div className="text-xs space-y-1">
                <div className="font-bold">
                  {sim.decisionSignal === 'approve'
                    ? t(
                        lang,
                        'توصية CFO: مقترح مجدٍ اقتصادياً (NPV موجب + استرداد أسرع من الأفق المحدد)',
                        'CFO Decision: Financially Viable — Positive NPV & Fast Capital Recovery'
                      )
                    : sim.decisionSignal === 'conditional'
                    ? t(
                        lang,
                        'توصية CFO: عائد حدي / مشروط — يتطلب ضغط CAPEX أو تعظيم حصة المشاركة',
                        'CFO Decision: Conditional — Marginal Spread over WACC; Optimize CAPEX or Share'
                      )
                    : t(
                        lang,
                        'تحذير CFO: قيمة حالية سالبة (Negative NPV) — الاستثمار يدمر قيمة عند معدل الخصم الحالي',
                        'CFO Warning: Negative NPV — Project Fails 22% WACC Hurdle Rate'
                      )}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px] opacity-90">
                  <span>
                    {t(lang, 'إجمالي الإيجار المستغل سنوياً:', 'Idle Usufruct Reclaimed:')}
                  </span>
                  <span className="font-mono-num font-bold" dir="ltr">
                    {fmtMoney(sim.annualRentReclaimedEgp, 0)} EGP/yr
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {t(lang, 'أدنى إيراد شهري للتعادل (NPV = 0):', 'Break-Even Monthly Rev (NPV = 0):')}
                  </span>
                  <span className="font-mono-num font-bold" dir="ltr">
                    {sim.breakEvenMonthlyRevenueForNpvZero !== null
                      ? `${fmtMoney(sim.breakEvenMonthlyRevenueForNpvZero, 0)} EGP/mo`
                      : 'N/A'}
                  </span>
                </div>
              </div>
            </div>

            <div className="text-end shrink-0 text-[11px] font-mono-num" dir="ltr">
              <div>CAPEX/m²: {fmtMoney(sim.capexPerSqm, 0)} EGP</div>
              <div>Rev/m²/mo: {fmtMoney(sim.monthlyRevenuePerSqm, 1)} EGP</div>
            </div>
          </div>

          {/* Cumulative Cash Flow & Payback Curve (Nominal vs Discounted PV) */}
          <section className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-teal-700" />
                  <span>
                    {t(
                      lang,
                      'منحنى التدفق النقدي التراكمي ونقطة الاسترداد (Nominal vs. Discounted PV)',
                      'Cumulative Cash Flow J-Curve & Payback Horizon (Nominal vs. Discounted PV)'
                    )}
                  </span>
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {t(
                    lang,
                    `التدفق التراكمي بدءاً من -${fmtMoney(inputs.capexEgp, 0)} ج.م عبر ${inputs.horizonYears} سنوات بمعدل خصم ${inputs.discountRatePct}%`,
                    `Cumulative cash recovery from -${fmtMoney(inputs.capexEgp, 0)} EGP over ${inputs.horizonYears} years @ ${inputs.discountRatePct}% WACC`
                  )}
                </p>
              </div>
              <div className="flex items-center gap-4 text-[11px] text-slate-600">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-0.5 bg-teal-700 inline-block" />
                  {t(lang, 'تراكمي اسمي', 'Cumulative Nominal')}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-0.5 border-t-2 border-dashed border-slate-600 inline-block" />
                  {t(lang, 'تراكمي مخصوم PV', 'Cumulative Discounted PV')}
                </span>
              </div>
            </div>

            <div className="w-full overflow-x-auto">
              <svg
                viewBox={`0 0 ${chartModel.w} ${chartModel.h}`}
                className="w-full h-56 min-w-[520px]"
                role="img"
                aria-label="Investment Cumulative Cash Flow Chart"
              >
                {/* Zero Break-Even Axis */}
                <line
                  x1={chartModel.padL}
                  x2={chartModel.w - chartModel.padR}
                  y1={chartModel.zeroY}
                  y2={chartModel.zeroY}
                  stroke="#dc2626"
                  strokeWidth="1.25"
                  strokeDasharray="4 4"
                />
                <text
                  x={chartModel.padL - 8}
                  y={chartModel.zeroY + 3}
                  textAnchor="end"
                  fontSize="10"
                  fill="#dc2626"
                  fontWeight="700"
                  className="font-mono-num"
                >
                  0
                </text>

                {/* Discounted Cumulative Curve */}
                <path
                  d={chartModel.discountedPath}
                  fill="none"
                  stroke="#475569"
                  strokeWidth="2"
                  strokeDasharray="5 4"
                />

                {/* Nominal Cumulative Curve */}
                <path
                  d={chartModel.nominalPath}
                  fill="none"
                  stroke="#0f766e"
                  strokeWidth="2.75"
                />

                {/* Data Points & Year Labels */}
                {chartModel.points.map((pt) => {
                  const cx = chartModel.xFor(pt.year);
                  const cyNom = chartModel.yFor(pt.nominal);
                  const cyDisc = chartModel.yFor(pt.discounted);
                  return (
                    <g key={pt.year}>
                      <line
                        x1={cx}
                        x2={cx}
                        y1={chartModel.padT}
                        y2={chartModel.h - chartModel.padB}
                        stroke="#e2e8f0"
                        strokeWidth="1"
                      />
                      <circle cx={cx} cy={cyDisc} r={3.5} fill="#475569" />
                      <circle
                        cx={cx}
                        cy={cyNom}
                        r={4.5}
                        fill={pt.nominal >= 0 ? '#0f766e' : '#f59e0b'}
                        stroke="#ffffff"
                        strokeWidth="1.5"
                      />
                      <text
                        x={cx}
                        y={pt.nominal >= 0 ? cyNom - 9 : cyNom + 14}
                        textAnchor="middle"
                        fontSize="9.5"
                        fontWeight="600"
                        fill="#0f172a"
                        className="font-mono-num"
                      >
                        {Math.abs(pt.nominal) >= 1_000_000
                          ? `${(pt.nominal / 1_000_000).toFixed(1)}M`
                          : `${(pt.nominal / 1000).toFixed(0)}k`}
                      </text>
                      <text
                        x={cx}
                        y={chartModel.h - 12}
                        textAnchor="middle"
                        fontSize="10"
                        fontWeight="600"
                        fill="#475569"
                        className="font-mono-num"
                      >
                        {pt.year === 0 ? 'Y0' : `Y${pt.year}`}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          </section>
        </div>
      </div>

      {/* 5x5 CAPEX vs Expected Monthly Revenue Sensitivity Matrix */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 bg-slate-50/70">
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              {t(
                lang,
                'مصفوفة تحليل الحساسية: صافي القيمة الحالية NPV (CAPEX مقابل الإيراد الشهري)',
                'NPV Sensitivity Matrix: CAPEX Cost Slippage vs. Monthly Revenue Realization'
              )}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {t(
                lang,
                `تُظهر صافي القيمة الحالية (بالجنيه) عند تغير كلٍ من CAPEX والإيراد الشهري بنسبة -20% إلى +20% (الخلية المظللة هي السيناريو الحالي)`,
                `Projected NPV (EGP) across ±20% CAPEX and ±20% monthly revenue shifts (highlighted cell = active assumption)`
              )}
            </p>
          </div>
          <span className="text-xs font-mono-num text-slate-500" dir="ltr">
            WACC {inputs.discountRatePct}% · {inputs.horizonYears}Y
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-700">
                <th className="py-2.5 px-4 text-start font-semibold">
                  {t(lang, 'الإيراد الشهري ↓ / CAPEX →', 'Monthly Rev ↓ / CAPEX →')}
                </th>
                {sensitivityMatrix.capexSteps.map((step) => {
                  const val = round2(inputs.capexEgp * (1 + step));
                  return (
                    <th key={step} className="py-2.5 px-3 text-center font-semibold font-mono-num" dir="ltr">
                      <div>{(val / 1_000_000).toFixed(2)}M</div>
                      <div className="text-[10px] font-normal text-slate-500">
                        {step === 0 ? 'Base' : `${step > 0 ? '+' : ''}${Math.round(step * 100)}%`}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sensitivityMatrix.rows.map((row) => (
                <tr key={row.revDelta}>
                  <td className="py-2.5 px-4 font-mono-num font-semibold text-slate-800 bg-slate-50/50" dir="ltr">
                    <div>{fmtMoney(row.testedRev, 0)}</div>
                    <div className="text-[10px] font-normal text-slate-500">
                      {row.revDelta === 0
                        ? 'Base Rev'
                        : `${row.revDelta > 0 ? '+' : ''}${Math.round(row.revDelta * 100)}%`}
                    </div>
                  </td>
                  {row.cells.map((cell) => {
                    const pos = cell.npvEgp >= 0;
                    return (
                      <td
                        key={cell.capDelta}
                        onClick={() => {
                          updateField('capexEgp', cell.testedCapex);
                          updateField('expectedMonthlyRevenueEgp', row.testedRev);
                        }}
                        title={t(lang, 'اضغط لتطبيق هذا السيناريو', 'Click to apply this CAPEX/Revenue pair')}
                        className={`py-2.5 px-3 text-center font-mono-num cursor-pointer transition-colors ${
                          cell.isBase
                            ? 'bg-teal-700 text-white font-bold ring-2 ring-inset ring-teal-900'
                            : pos
                            ? 'bg-emerald-50/50 text-emerald-800 hover:bg-emerald-100/70 font-semibold'
                            : 'bg-red-50/50 text-red-700 hover:bg-red-100/70'
                        }`}
                        dir="ltr"
                      >
                        <div>
                          {cell.npvEgp >= 0 ? '+' : ''}
                          {(cell.npvEgp / 1_000_000).toFixed(2)}M
                        </div>
                        <div className={`text-[10px] ${cell.isBase ? 'text-teal-100' : 'text-slate-500'}`}>
                          {cell.paybackMonths !== null ? `${cell.paybackMonths}m PB` : 'No PB'}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Annual Discounted Cash Flow Schedule (Year 0 .. Horizon) */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-2 bg-slate-50/70">
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              {t(lang, 'جدول التدفقات النقدية المخصومة السنوي (DCF Schedule)', 'Annual Discounted Cash Flow (DCF) Schedule')}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {t(
                lang,
                `تفصيل الإيراد، حصة استادات (${inputs.estadatSharePct}%)، التدفق التشغيلي، والقيمة الحالية المخصومة بمعدل ${inputs.discountRatePct}%`,
                `Annual breakdown of revenue, ${inputs.estadatSharePct}% Estadaat share, net cash flow, and ${inputs.discountRatePct}% discounted present value`
              )}
            </p>
          </div>
          <span className="font-mono-num text-xs font-bold text-teal-800" dir="ltr">
            NPV: {sim.npvEgp >= 0 ? '+' : ''}
            {fmtMoney(sim.npvEgp, 0)} EGP
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <th className="py-2.5 px-3 text-start font-semibold">{t(lang, 'السنة', 'Year')}</th>
                <th className="py-2.5 px-3 text-end font-semibold">{t(lang, 'متوسط الإيراد/شهر', 'Avg Rev/mo')}</th>
                <th className="py-2.5 px-3 text-end font-semibold">{t(lang, 'حصة استادات/سنة', 'Estadaat Rev/yr')}</th>
                <th className="py-2.5 px-3 text-end font-semibold">{t(lang, 'صافي التدفق السنوي', 'Net Cash Flow')}</th>
                <th className="py-2.5 px-3 text-end font-semibold">{t(lang, 'معامل الخصم', 'DF')}</th>
                <th className="py-2.5 px-3 text-end font-semibold">{t(lang, 'القيمة الحالية PV', 'Present Value')}</th>
                <th className="py-2.5 px-3 text-end font-semibold">{t(lang, 'تراكمي اسمي', 'Cum. Nominal')}</th>
                <th className="py-2.5 px-3 text-end font-semibold">{t(lang, 'تراكمي مخصوم PV', 'Cum. PV')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr className="bg-amber-50/40 font-semibold">
                <td className="py-2.5 px-3 font-mono-num" dir="ltr">Year 0 (CAPEX)</td>
                <td className="py-2.5 px-3 text-end text-slate-400">—</td>
                <td className="py-2.5 px-3 text-end text-slate-400">—</td>
                <td className="py-2.5 px-3 text-end font-mono-num text-red-700" dir="ltr">
                  -{fmtMoney(inputs.capexEgp, 0)}
                </td>
                <td className="py-2.5 px-3 text-end font-mono-num" dir="ltr">1.00</td>
                <td className="py-2.5 px-3 text-end font-mono-num text-red-700" dir="ltr">
                  -{fmtMoney(inputs.capexEgp, 0)}
                </td>
                <td className="py-2.5 px-3 text-end font-mono-num text-red-700" dir="ltr">
                  -{fmtMoney(inputs.capexEgp, 0)}
                </td>
                <td className="py-2.5 px-3 text-end font-mono-num text-red-700" dir="ltr">
                  -{fmtMoney(inputs.capexEgp, 0)}
                </td>
              </tr>

              {sim.yearlySchedule.map((row) => (
                <tr key={row.year} className="hover:bg-slate-50">
                  <td className="py-2.5 px-3 font-mono-num font-semibold text-slate-900" dir="ltr">
                    Year {row.year}
                  </td>
                  <td className="py-2.5 px-3 text-end font-mono-num text-slate-600" dir="ltr">
                    {fmtMoney(row.monthlyRevenueAvg, 0)}
                  </td>
                  <td className="py-2.5 px-3 text-end font-mono-num text-slate-800" dir="ltr">
                    {fmtMoney(row.estadatAttributedRevenue, 0)}
                  </td>
                  <td
                    className={`py-2.5 px-3 text-end font-mono-num font-bold ${
                      row.annualNetCashFlow >= 0 ? 'text-emerald-700' : 'text-red-600'
                    }`}
                    dir="ltr"
                  >
                    {fmtMoney(row.annualNetCashFlow, 0)}
                  </td>
                  <td className="py-2.5 px-3 text-end font-mono-num text-slate-500" dir="ltr">
                    {row.discountFactor.toFixed(2)}
                  </td>
                  <td className="py-2.5 px-3 text-end font-mono-num font-semibold text-teal-800" dir="ltr">
                    {fmtMoney(row.presentValue, 0)}
                  </td>
                  <td
                    className={`py-2.5 px-3 text-end font-mono-num font-semibold ${
                      row.cumulativeNominal >= 0 ? 'text-emerald-700' : 'text-amber-700'
                    }`}
                    dir="ltr"
                  >
                    {fmtMoney(row.cumulativeNominal, 0)}
                  </td>
                  <td
                    className={`py-2.5 px-3 text-end font-mono-num font-bold ${
                      row.cumulativeDiscounted >= 0 ? 'text-emerald-700' : 'text-red-600'
                    }`}
                    dir="ltr"
                  >
                    {fmtMoney(row.cumulativeDiscounted, 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Pinned Scenarios Side-by-Side Comparison */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-2 bg-slate-50/70">
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              {t(lang, 'مقارنة السيناريوهات المثبتة (Pinned Comparison)', 'Pinned Scenarios Comparison')}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {t(
                lang,
                'ثبّت عدة بدائل للـ CAPEX والإيراد الشهري لمقارنتها جنباً إلى جنب أمام المدير المالي',
                'Pin multiple CAPEX & Monthly Revenue scenarios to compare Payback & NPV side-by-side'
              )}
            </p>
          </div>
          <span className="text-xs font-mono-num text-slate-500" dir="ltr">
            {pinnedScenarios.length} / 4
          </span>
        </div>

        {pinnedScenarios.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500 space-y-3">
            <p>
              {t(
                lang,
                'لم تقم بتثبيت أي سيناريوهات للمقارنة بعد. اضغط على "تثبيت هذا السيناريو" لإضافته هنا.',
                'No scenarios pinned yet. Click "Pin Scenario to Comparison Table" to benchmark alternatives side-by-side.'
              )}
            </p>
            <button
              type="button"
              onClick={handlePinScenario}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold cursor-pointer no-print"
            >
              <BookmarkPlus className="w-3.5 h-3.5" />
              <span>{t(lang, 'تثبيت السيناريو الحالي الآن', 'Pin Current Scenario Now')}</span>
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'السيناريو', 'Scenario')}</th>
                  <th className="py-2.5 px-4 text-end font-semibold">CAPEX</th>
                  <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'إيراد/شهر', 'Monthly Rev')}</th>
                  <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'المساحة م²', 'Area m²')}</th>
                  <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'الاسترداد', 'Payback')}</th>
                  <th className="py-2.5 px-4 text-end font-semibold">NPV</th>
                  <th className="py-2.5 px-4 text-end font-semibold">IRR</th>
                  <th className="py-2.5 px-4 text-end font-semibold no-print">{t(lang, 'إجراء', 'Actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pinnedScenarios.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4">
                      <div className="font-semibold text-slate-900">
                        {lang === 'ar' ? item.inputs.scenarioNameAr : item.inputs.scenarioNameEn}
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono-num" dir="ltr">
                        Share {item.inputs.estadatSharePct}% · Margin {item.inputs.operatingMarginPct}% · WACC {item.inputs.discountRatePct}%
                      </div>
                    </td>
                    <td className="py-2.5 px-4 text-end font-mono-num font-semibold" dir="ltr">
                      {fmtMoney(item.inputs.capexEgp, 0)}
                    </td>
                    <td className="py-2.5 px-4 text-end font-mono-num" dir="ltr">
                      {fmtMoney(item.inputs.expectedMonthlyRevenueEgp, 0)}
                    </td>
                    <td className="py-2.5 px-4 text-end font-mono-num" dir="ltr">
                      {item.result.activatedSqm.toLocaleString('en-US')}
                    </td>
                    <td className="py-2.5 px-4 text-end font-mono-num font-semibold" dir="ltr">
                      {item.result.simplePaybackMonths !== null
                        ? `${item.result.simplePaybackMonths}m`
                        : 'N/A'}
                    </td>
                    <td
                      className={`py-2.5 px-4 text-end font-mono-num font-bold ${
                        item.result.npvEgp >= 0 ? 'text-emerald-700' : 'text-red-600'
                      }`}
                      dir="ltr"
                    >
                      {item.result.npvEgp >= 0 ? '+' : ''}
                      {fmtMoney(item.result.npvEgp, 0)}
                    </td>
                    <td className="py-2.5 px-4 text-end font-mono-num font-semibold" dir="ltr">
                      {item.result.irrPct !== null ? fmtPct(item.result.irrPct, 1) : 'N/A'}
                    </td>
                    <td className="py-2.5 px-4 text-end no-print">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setInputs(item.inputs)}
                          className="text-teal-700 hover:underline font-semibold cursor-pointer"
                        >
                          {t(lang, 'تحميل', 'Load')}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemovePinned(item.id)}
                          aria-label={t(lang, 'حذف', 'Remove')}
                          className="text-slate-400 hover:text-red-600 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Print-Only Formal CFO Sign-Off Footer */}
      <footer className="hidden print:grid grid-cols-3 gap-6 pt-5 mt-6 border-t-2 border-slate-900 text-center text-[10.5px] text-slate-700 print-avoid-break">
        <div>
          <div className="font-bold text-slate-900 mb-6">{t(lang, 'إعداد / التخطيط المالي (FP&A)', 'Prepared By / FP&A Director')}</div>
          <div className="border-t border-slate-400 pt-1 text-[9.5px] text-slate-500">{t(lang, 'التوقيع والتاريخ', 'Signature & Date')}</div>
        </div>
        <div>
          <div className="font-bold text-slate-900 mb-6">{t(lang, 'مراجعة / لجنة الاستثمار والتشغيل', 'Reviewed By / Investment Committee')}</div>
          <div className="border-t border-slate-400 pt-1 text-[9.5px] text-slate-500">{t(lang, 'التوقيع والتاريخ', 'Signature & Date')}</div>
        </div>
        <div>
          <div className="font-bold text-slate-900 mb-6">{t(lang, 'اعتماد / المدير المالي CFO', 'Approved By / Group CFO')}</div>
          <div className="border-t border-slate-400 pt-1 text-[9.5px] text-slate-500">{t(lang, 'الختم والاعتماد التنفيذي', 'Stamp & Approval')}</div>
        </div>
      </footer>
    </div>
  );
};
