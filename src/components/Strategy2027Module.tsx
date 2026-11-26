import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Calendar,
  CheckCircle2,
  FileText,
  Printer,
  Scale,
  Sliders,
  Target,
  TrendingUp,
} from 'lucide-react';
import { ErpState, Language } from '../types/erp';
import { round2 } from '../utils/erpEngine';
import { fmtMoney, fmtPct, t } from '../utils/formatters';

interface Strategy2027ModuleProps {
  state: ErpState;
  lang: Language;
  onOpenExecReview?: () => void;
}

export const Strategy2027Module: React.FC<Strategy2027ModuleProps> = ({ state, lang, onOpenExecReview }) => {
  const strat = state.strategy2027;
  const [selectedScenarioId, setSelectedScenarioId] = useState<'A' | 'B' | 'C'>('C');

  // Interactive 2027 P&L Simulator initialized to Scenario C (Target)
  const [simRevenueM, setSimRevenueM] = useState<number>(18.0);
  const [simCogsPct, setSimCogsPct] = useState<number>(35);
  const [simPayrollM, setSimPayrollM] = useState<number>(6.0);
  const [simRentM, setSimRentM] = useState<number>(5.1);

  const simMetrics = useMemo(() => {
    const netRev = simRevenueM * 1_000_000;
    const cogs = round2(netRev * (simCogsPct / 100));
    const gp = round2(netRev - cogs);
    const gpPct = netRev > 0 ? round2((gp / netRev) * 100) : 0;
    const payroll = simPayrollM * 1_000_000;
    const payrollPct = netRev > 0 ? round2((payroll / netRev) * 100) : 0;
    const rent = simRentM * 1_000_000;
    const otherOpex = 1_000_000;
    const bankFees = 100_000;
    const netResult = round2(gp - payroll - rent - otherOpex - bankFees);
    const netMarginPct = netRev > 0 ? round2((netResult / netRev) * 100) : 0;
    const monthlyBreakEven = gpPct > 0 ? round2(((payroll + rent + otherOpex + bankFees) / 12) / (gpPct / 100)) : 0;
    const profitShare20Pct = netResult > 0 ? round2(netResult * 0.2) : 0;
    return {
      netRev,
      cogs,
      gp,
      gpPct,
      payroll,
      payrollPct,
      rent,
      otherOpex,
      bankFees,
      netResult,
      netMarginPct,
      monthlyBreakEven,
      profitShare20Pct,
    };
  }, [simRevenueM, simCogsPct, simPayrollM, simRentM]);

  const applyScenarioToSim = (id: 'A' | 'B' | 'C') => {
    setSelectedScenarioId(id);
    const sc = strat.scenarios.find((s) => s.id === id)!;
    setSimRevenueM(round2(sc.netRevenue / 1_000_000));
    setSimCogsPct(sc.cogsPct);
    setSimPayrollM(round2(sc.payroll / 1_000_000));
    setSimRentM(round2(sc.usufructRent / 1_000_000));
  };

  const totalInitiativeBudget = strat.initiatives.reduce((s, i) => s + i.budgetEgp, 0);

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="text-xs font-semibold text-teal-700">
            {t(lang, 'استراتيجية العام 2027 — برج المنوفية · موعد التسليم 20/10/2026', '2027 Strategic Turnaround Plan — Menoufia Tower')}
          </div>
          <h1 className="text-xl font-bold text-slate-900 mt-0.5">
            {t(lang, '«من النمو بأي تكلفة إلى ربحية الوحدة» — خفض الخسارة من 5.5م إلى 0.5م', '"From Growth at Any Cost to Unit Profitability" — 2027 Budget & Scenarios')}
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            {t(
              lang,
              'مرتكزة على فعلي يناير–سبتمبر 2026 (11.34م صافي إيراد / -4.10م خسارة) واستهداف التعادل الشهري في الربع الرابع 2027 عند 1.70م ج/شهر',
              'Grounded in audited Jan–Sep 2026 actuals (11.34M net rev / -4.10M loss), targeting Q4 2027 monthly break-even at 1.70M EGP/mo'
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0 no-print">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 text-xs font-semibold transition-colors whitespace-nowrap"
          >
            <Printer className="w-3.5 h-3.5 text-slate-600" />
            <span>{t(lang, 'طباعة الخطة', 'Print Strategy')}</span>
          </button>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {strat.scenarios.map((sc) => (
              <button
                key={sc.id}
                onClick={() => applyScenarioToSim(sc.id)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                  selectedScenarioId === sc.id ? 'bg-teal-700 text-white' : 'text-slate-700 hover:text-slate-900'
                }`}
              >
                {lang === 'ar' ? `سيناريو ${sc.id}` : `Scenario ${sc.id}`}
              </button>
            ))}
          </div>
          {onOpenExecReview && (
            <button
              onClick={onOpenExecReview}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
            >
              <span>{t(lang, 'دراسة الـ 80% فراغ والملفات (PDF/Excel/PPTX)', '80% Space & CFO Pack (PDF/XLSX/PPTX)')}</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* 2026 Actual vs 2027 Targets Benchmark Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">{t(lang, 'صافي الإيراد السنوي (2026 ← 2027)', 'Annual Net Revenue Target')}</div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-xl font-bold font-mono-num text-slate-900" dir="ltr">15.1M → 18.0M</span>
            <span className="text-xs font-bold text-emerald-700 font-mono-num" dir="ltr">+19%</span>
          </div>
          <div className="mt-2 pt-2 border-t border-slate-100 text-[11px] text-slate-500">
            {t(lang, 'الربع الرابع 2027: 1.75م ج/شهر (إجمالي 5.3م)', 'Q4 2027 Target: 1.75M+/mo (5.3M Q4)')}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">{t(lang, 'تكلفة المبيعات COGS %', 'COGS % Reduction Target')}</div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-xl font-bold font-mono-num text-slate-900" dir="ltr">41.0% → 35.0%</span>
            <span className="text-xs font-bold text-emerald-700 font-mono-num" dir="ltr">-6.0 pts</span>
          </div>
          <div className="mt-2 pt-2 border-t border-slate-100 text-[11px] text-slate-500">
            {t(lang, 'وفر مستهدف ~1.1 مليون ج.م عبر الوصفات', 'Saves ~1.1M EGP via BOM recipe costing')}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">{t(lang, 'الرواتب والمنح % (إعادة هيكلة)', 'Payroll & Bonuses % Target')}</div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-xl font-bold font-mono-num text-slate-900" dir="ltr">56.1% → ≤33%</span>
            <span className="text-xs font-bold text-emerald-700 font-mono-num" dir="ltr">8.5M → 6.0M</span>
          </div>
          <div className="mt-2 pt-2 border-t border-slate-100 text-[11px] text-slate-500">
            {t(lang, 'ربط المنح (1.39م) بالربحية وجدولة الورديات', 'KPI-linked bonuses & Mon/Fri shift curve')}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">{t(lang, 'الدليفري ومبيعات الإثنين', 'Delivery Share & Monday Lift')}</div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-xl font-bold font-mono-num text-slate-900" dir="ltr">2.4% → 8.0%</span>
            <span className="text-xs font-bold text-teal-700 font-mono-num" dir="ltr">31k → 40k/d</span>
          </div>
          <div className="mt-2 pt-2 border-t border-slate-100 text-[11px] text-slate-500">
            {t(lang, 'تقليل الاعتماد على التيك أواي (76.5%)', 'Diversify beyond 76.5% Takeaway reliance')}
          </div>
        </div>
      </div>

      {/* Interactive Scenario Matrix + Live 2027 P&L Sensitivity Simulator */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Scenarios Comparison Table + Quarterly Ramp */}
        <div className="xl:col-span-7 space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Target className="w-4 h-4 text-teal-700" />
                {t(lang, 'مقارنة سيناريوهات 2027 (حق انتفاع 5.1م · تشغيل 1.0م · بنكية 0.1م)', '2027 Scenarios Comparison (Rent 5.1M · OpEx 1.0M · Bank 0.1M)')}
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'السيناريو', 'Scenario')}</th>
                    <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'صافي الإيراد', 'Net Rev')}</th>
                    <th className="py-2.5 px-4 text-end font-semibold">COGS %</th>
                    <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'الرواتب', 'Payroll')}</th>
                    <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'صافي النتيجة', 'Net Result')}</th>
                    <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'التعادل الشهري', 'Mo. Break-Even')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {strat.scenarios.map((sc) => (
                    <tr
                      key={sc.id}
                      onClick={() => applyScenarioToSim(sc.id)}
                      className={`cursor-pointer transition-colors ${
                        selectedScenarioId === sc.id ? 'bg-teal-50/70' : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="py-3 px-4 font-bold text-slate-900">{lang === 'ar' ? sc.nameAr : sc.nameEn}</td>
                      <td className="py-3 px-4 text-end font-mono-num" dir="ltr">
                        {(sc.netRevenue / 1_000_000).toFixed(1)}M {sc.growthPct > 0 ? `(+${sc.growthPct}%)` : ''}
                      </td>
                      <td className="py-3 px-4 text-end font-mono-num" dir="ltr">{sc.cogsPct}%</td>
                      <td className="py-3 px-4 text-end font-mono-num" dir="ltr">{(sc.payroll / 1_000_000).toFixed(1)}M</td>
                      <td className={`py-3 px-4 text-end font-mono-num font-bold ${sc.netResult >= -500000 ? 'text-teal-800' : 'text-red-600'}`} dir="ltr">
                        {(sc.netResult / 1_000_000).toFixed(1)}M
                      </td>
                      <td className="py-3 px-4 text-end font-mono-num text-slate-700" dir="ltr">
                        {(sc.monthlyBreakEven / 1_000_000).toFixed(2)}M
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 2027 Quarterly Target Revenue Ramp */}
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <h2 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-teal-700" />
              {t(lang, 'توزيع الإيراد المستهدف ربع سنوياً 2027 (إجمالي 18.0 مليون ج.م)', '2027 Target Quarterly Revenue Ramp (Total 18.0M EGP)')}
            </h2>
            <div className="grid grid-cols-4 gap-3">
              {strat.quarterly2027Target.map((q, idx) => {
                const pctOfMax = Math.round((q.netRevenue / 5_300_000) * 100);
                return (
                  <div key={q.quarter} className="border border-slate-200 rounded-lg p-3 bg-slate-50/50">
                    <div className="text-xs font-semibold text-slate-600 font-mono-num" dir="ltr">{q.quarter}</div>
                    <div className="text-lg font-bold text-slate-900 font-mono-num mt-1" dir="ltr">
                      {(q.netRevenue / 1_000_000).toFixed(1)}M
                    </div>
                    <div className="w-full h-1.5 bg-slate-200 rounded-full mt-2 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${idx === 3 ? 'bg-emerald-600' : 'bg-teal-700'}`}
                        style={{ width: `${pctOfMax}%` }}
                      />
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1.5">
                      {idx === 3 ? t(lang, 'تحقيق التعادل الشهري', 'Break-even Q4') : t(lang, 'مرحلة التحول', 'Ramp-up')}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Live Interactive Budget Simulator */}
        <div className="xl:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="border-b border-slate-200 pb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Sliders className="w-4 h-4 text-teal-700" />
              {t(lang, 'محاكي موازنة 2027 التفاعلي (What-If)', 'Interactive 2027 Budget Simulator')}
            </h2>
            <span className="text-xs font-mono-num text-teal-700 font-semibold" dir="ltr">
              BE: {(simMetrics.monthlyBreakEven / 1_000_000).toFixed(2)}M/mo
            </span>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-slate-600">{t(lang, 'صافي الإيراد السنوي (مليون ج.م)', 'Annual Net Revenue (M EGP)')}</span>
                <span className="font-mono-num font-bold text-slate-900" dir="ltr">{simRevenueM.toFixed(1)}M</span>
              </div>
              <input
                type="range"
                min={14.0}
                max={22.0}
                step={0.1}
                value={simRevenueM}
                onChange={(e) => setSimRevenueM(Number(e.target.value))}
                className="w-full accent-teal-700"
              />
            </div>

            <div>
              <div className="flex justify-between mb-1">
                <span className="text-slate-600">{t(lang, 'نسبة تكلفة المبيعات COGS %', 'COGS % of Net Revenue')}</span>
                <span className="font-mono-num font-bold text-slate-900" dir="ltr">{simCogsPct}%</span>
              </div>
              <input
                type="range"
                min={28}
                max={43}
                step={0.5}
                value={simCogsPct}
                onChange={(e) => setSimCogsPct(Number(e.target.value))}
                className="w-full accent-teal-700"
              />
            </div>

            <div>
              <div className="flex justify-between mb-1">
                <span className="text-slate-600">{t(lang, 'الرواتب والمنح السنوية (مليون ج.م)', 'Annual Payroll & Bonuses (M EGP)')}</span>
                <span className="font-mono-num font-bold text-slate-900" dir="ltr">{simPayrollM.toFixed(1)}M ({simMetrics.payrollPct}%)</span>
              </div>
              <input
                type="range"
                min={4.5}
                max={9.0}
                step={0.1}
                value={simPayrollM}
                onChange={(e) => setSimPayrollM(Number(e.target.value))}
                className="w-full accent-teal-700"
              />
            </div>

            <div>
              <div className="flex justify-between mb-1">
                <span className="text-slate-600">{t(lang, 'إيجار حق الانتفاع السنوي (مفاوضة/ثابت)', 'Annual Usufruct Rent (M EGP)')}</span>
                <span className="font-mono-num font-bold text-slate-900" dir="ltr">{simRentM.toFixed(2)}M</span>
              </div>
              <input
                type="range"
                min={3.5}
                max={5.5}
                step={0.05}
                value={simRentM}
                onChange={(e) => setSimRentM(Number(e.target.value))}
                className="w-full accent-teal-700"
              />
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-600">{t(lang, 'مجمل الربح (GP)', 'Gross Profit')}</span>
              <span className="font-mono-num font-semibold" dir="ltr">{fmtMoney(simMetrics.gp)} ({simMetrics.gpPct}%)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">{t(lang, 'الرواتب + حق الانتفاع + تشغيل وبنكية', 'Payroll + Rent + OpEx & Bank')}</span>
              <span className="font-mono-num text-slate-700" dir="ltr">
                {fmtMoney(simMetrics.payroll + simMetrics.rent + simMetrics.otherOpex + simMetrics.bankFees)}
              </span>
            </div>
            <div className="pt-2 border-t border-slate-200 flex justify-between font-bold text-sm">
              <span>{t(lang, 'صافي نتيجة 2027 المتوقعة', 'Projected 2027 Net Result')}</span>
              <span className={`font-mono-num ${simMetrics.netResult >= 0 ? 'text-emerald-700' : 'text-red-600'}`} dir="ltr">
                {fmtMoney(simMetrics.netResult)} ({fmtPct(simMetrics.netMarginPct)})
              </span>
            </div>
            {simMetrics.netResult > 0 && (
              <div className="flex justify-between text-amber-800 font-medium pt-1">
                <span>{t(lang, 'بند 20% حصة المحافظة عند الربحية', '20% Governorate Profit-Share Clause')}</span>
                <span className="font-mono-num" dir="ltr">{fmtMoney(simMetrics.profitShare20Pct)}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Initiatives & 700k Budget + Usufruct Contract Schedule */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <div className="xl:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900">
              {t(lang, 'المبادرات الرئيسية وميزانية التنفيذ (700 ألف ج.م + احتياطي)', 'Core Initiatives & Implementation Budget (700k EGP)')}
            </h2>
            <span className="font-mono-num text-xs font-bold text-teal-800" dir="ltr">
              {fmtMoney(totalInitiativeBudget)} {t(lang, 'ج.م', 'EGP')}
            </span>
          </div>
          <div className="divide-y divide-slate-100">
            {strat.initiatives.map((init) => (
              <div key={init.id} className="p-4 flex items-start justify-between gap-4 text-xs">
                <div>
                  <div className="font-bold text-slate-900">{lang === 'ar' ? init.titleAr : init.titleEn}</div>
                  <div className="text-slate-600 mt-0.5">{lang === 'ar' ? init.targetImpactAr : init.targetImpactEn}</div>
                  <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-2">
                    <span>{lang === 'ar' ? init.ownerAr : init.ownerEn}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-num" dir="ltr">{init.timeline}</span>
                  </div>
                </div>
                <div className="text-end shrink-0">
                  <div className="font-mono-num font-bold text-slate-900" dir="ltr">
                    {init.budgetEgp > 0 ? `${fmtMoney(init.budgetEgp)} ج` : t(lang, 'تفاوضي', 'Legal')}
                  </div>
                  <div className={`text-[11px] mt-1 font-medium ${init.status === 'needs_approval' ? 'text-amber-700' : 'text-teal-700'}`}>
                    {init.status === 'needs_approval' ? t(lang, 'يحتاج قرار إدارة', 'Needs Sign-off') : t(lang, 'قيد التنفيذ', 'In Progress')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Usufruct Contract Escalation Table (Protocol 24/8/2021) */}
        <div className="xl:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Scale className="w-4 h-4 text-teal-700" />
              {t(lang, 'جدول زيادات عقد حق الانتفاع (بروتوكول 24/8/2021)', 'Usufruct Contract Escalation (Non-Compounded)')}
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {t(lang, 'تُحسب الزيادات على المبلغ الأصلي (5 ملايين ج) وليست تراكمية · +20% من الأرباح عند التحول للربح', 'Calculated on 5M base (non-compounded) · +20% net profit clause & 5% branch royalty')}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <th className="py-2 px-3 text-start font-semibold">{t(lang, 'سنوات العقد', 'Contract Years')}</th>
                  <th className="py-2 px-3 text-end font-semibold">{t(lang, 'الزيادة', 'Escalation')}</th>
                  <th className="py-2 px-3 text-end font-semibold">{t(lang, 'السنوي', 'Annual')}</th>
                  <th className="py-2 px-3 text-end font-semibold">{t(lang, 'القسط الفصلي', 'Quarterly')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {strat.contractEscalation.map((row, i) => (
                  <tr key={i} className={i === 0 ? 'bg-amber-50/50 font-semibold' : ''}>
                    <td className="py-2 px-3 text-slate-800">{row.years}</td>
                    <td className="py-2 px-3 text-end font-mono-num text-amber-800" dir="ltr">+{row.increasePct}%</td>
                    <td className="py-2 px-3 text-end font-mono-num" dir="ltr">{fmtMoney(row.annualAmountEgp)}</td>
                    <td className="py-2 px-3 text-end font-mono-num" dir="ltr">{fmtMoney(row.quarterlyInstallmentEgp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* SWOT & Risk Register */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* SWOT 2x2 */}
        <div className="xl:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <FileText className="w-4 h-4 text-teal-700" />
            {t(lang, 'تحليل SWOT المختصر — برج المنوفية', 'Executive SWOT Analysis')}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="p-3 rounded-lg border border-emerald-200 bg-emerald-50/40">
              <div className="font-bold text-emerald-900 mb-1.5">{t(lang, 'نقاط القوة', 'Strengths')}</div>
              <ul className="space-y-1 text-slate-700 list-disc list-inside">
                {strat.swot.strengthsAr.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
            <div className="p-3 rounded-lg border border-amber-200 bg-amber-50/40">
              <div className="font-bold text-amber-900 mb-1.5">{t(lang, 'نقاط الضعف', 'Weaknesses')}</div>
              <ul className="space-y-1 text-slate-700 list-disc list-inside">
                {strat.swot.weaknessesAr.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
            <div className="p-3 rounded-lg border border-sky-200 bg-sky-50/40">
              <div className="font-bold text-sky-900 mb-1.5">{t(lang, 'الفرص', 'Opportunities')}</div>
              <ul className="space-y-1 text-slate-700 list-disc list-inside">
                {strat.swot.opportunitiesAr.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
            <div className="p-3 rounded-lg border border-red-200 bg-red-50/40">
              <div className="font-bold text-red-900 mb-1.5">{t(lang, 'التهديدات', 'Threats')}</div>
              <ul className="space-y-1 text-slate-700 list-disc list-inside">
                {strat.swot.threatsAr.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          </div>
        </div>

        {/* Risk Register */}
        <div className="xl:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              {t(lang, 'سجل المخاطر الاستراتيجية وخطة المعالجة', 'Strategic Risk Register & Mitigation Plan')}
            </h2>
            {onOpenExecReview && (
              <button
                type="button"
                onClick={onOpenExecReview}
                className="text-[11px] font-semibold text-teal-700 hover:underline cursor-pointer"
              >
                {t(lang, 'إدارة التكليفات والتصنيف ←', 'Manage Owners & Impact →')}
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'الخطر والتصنيف', 'Risk & Category')}</th>
                  <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'الاحتمال / التأثير', 'Likelihood / Impact')}</th>
                  <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'الإجراء التصحيحي والمكلف', 'Mitigation & Owner')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {strat.risks.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4">
                      <div className="font-semibold text-slate-900">{lang === 'ar' ? r.riskAr : r.riskEn}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        {r.category === 'operational' ? t(lang, 'تشغيلية', 'Operational') : t(lang, 'مالية', 'Financial')}
                        {' · '}
                        {r.focusArea === 'unused_space'
                          ? t(lang, '80% مساحات غير مستغلة', '80% Unused Space')
                          : r.focusArea === 'usufruct'
                          ? t(lang, 'حق الانتفاع', 'Usufruct')
                          : t(lang, 'التشغيل العام', 'Core Ops')}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 text-slate-700 whitespace-nowrap">
                      {r.likelihood} ·{' '}
                      <span
                        className={
                          r.impact === 'high'
                            ? 'text-red-600 font-semibold'
                            : r.impact === 'medium'
                            ? 'text-amber-700 font-semibold'
                            : 'text-teal-700 font-semibold'
                        }
                      >
                        {r.impact}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-slate-600">
                      <div>{lang === 'ar' ? r.mitigationAr : r.mitigationEn}</div>
                      {r.ownerAr && (
                        <div className="text-[10px] text-teal-800 font-medium mt-0.5">
                          {t(lang, 'المكلف:', 'Owner:')} {lang === 'ar' ? r.ownerAr : r.ownerEn || r.ownerAr}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Decision Checklist */}
      <div className="bg-slate-900 text-slate-100 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs">
        <div className="space-y-1">
          <div className="font-bold text-sm flex items-center gap-2">
            <Calendar className="w-4 h-4 text-teal-400" />
            {t(lang, 'بنود تحتاج قراراً وفروض يلزم تأكيدها (موعد التسليم 20/10/2026)', 'Executive Decisions Required for 2027 Budget Sign-Off')}
          </div>
          <div className="text-slate-300">
            {t(
              lang,
              '1) اعتماد السيناريو ج كمستهدف (-0.5م) · 2) تأكيد مصدر تمويل العجز التشغيلي 2027 · 3) اعتماد ميزانية المبادرات (700 ألف ج) بعد عروض الأسعار · 4) إغالق Q4 أكتوبر–ديسمبر 2026.',
              '1) Approve Scenario C (-0.5M) · 2) Confirm 2027 cash deficit funding source · 3) Approve 700k EGP initiative budget · 4) Close Q4 Oct–Dec 2026 actuals.'
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 text-teal-300 font-semibold">
          <CheckCircle2 className="w-4 h-4" />
          <span>{t(lang, 'خطة الربع الرابع 2027: تعادل شهري', 'Q4 2027 Target: Monthly Break-Even')}</span>
          <ArrowUpRight className="w-4 h-4" />
        </div>
      </div>
    </div>
  );
};
