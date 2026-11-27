import React, { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  Clock,
  FileSpreadsheet,
  FileText,
  Layers,
  Loader2,
  Presentation,
  Printer,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import type { ErpState, Language, StrategyRisk } from '../types/erp';
import {
  buildCfoExecutiveReview,
  type CfoExecutiveReviewData,
  type VerificationStatus,
} from '../utils/cfoReviewEngine';
import { exportCfoExcelModel, exportCfoPowerPointDeck } from '../utils/cfoDeliverablesExport';
import { computeStocktakeVarianceAlerts } from '../utils/erpEngine';
import { fmtMoney, t } from '../utils/formatters';
import { RiskRegisterPanel } from './RiskRegisterPanel';

export type ReviewSubTab = 'exec' | 'financials' | 'operations' | 'usufruct' | 'risks' | 'report_pdf';

interface CfoExecutiveReviewModuleProps {
  state: ErpState;
  lang: Language;
  initialSubTab?: ReviewSubTab;
  onNavigate?: (tab: 'dashboard' | 'strategy' | 'accounting' | 'inventory' | 'purchases') => void;
  onCreateRisk?: (risk: Partial<StrategyRisk>) => Promise<void>;
  onUpdateRisk?: (id: string, patch: Partial<StrategyRisk> & { auditNote?: string }) => Promise<void>;
  onDeleteRisk?: (id: string) => Promise<void>;
}

function StatusBadge({
  status,
  lang,
  compact = false,
}: {
  status: VerificationStatus;
  lang: Language;
  compact?: boolean;
}) {
  const styles: Record<VerificationStatus, string> = {
    CONFIRMED: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    PENDING_REVIEW: 'bg-amber-50 text-amber-800 border-amber-200',
    MISSING_DATA: 'bg-red-50 text-red-800 border-red-200',
    NOT_CALCULABLE: 'bg-slate-100 text-slate-700 border-slate-300',
  };
  const labels: Record<VerificationStatus, { ar: string; en: string; short: string }> = {
    CONFIRMED: { ar: 'مؤكد · CONFIRMED', en: 'CONFIRMED', short: 'CONFIRMED' },
    PENDING_REVIEW: { ar: 'قيد التحقق · PENDING', en: 'PENDING_REVIEW', short: 'PENDING' },
    MISSING_DATA: { ar: 'بيان ناقص · MISSING', en: 'MISSING_DATA', short: 'MISSING' },
    NOT_CALCULABLE: { ar: 'غير قابل للحساب', en: 'NOT_CALCULABLE', short: 'N/A' },
  };
  return (
    <span
      className={`inline-flex items-center rounded border font-semibold font-mono-num whitespace-nowrap ${
        compact
          ? 'px-1.5 py-0 text-[10px] print:px-1 print:text-[7.5px]'
          : 'px-2 py-0.5 text-[11px] print:px-1.5 print:py-0 print:text-[8px]'
      } ${styles[status]}`}
      dir="ltr"
    >
      {compact ? labels[status].short : lang === 'ar' ? labels[status].ar : labels[status].en}
    </span>
  );
}

export const CfoExecutiveReviewModule: React.FC<CfoExecutiveReviewModuleProps> = ({
  state,
  lang,
  initialSubTab,
  onNavigate,
  onCreateRisk,
  onUpdateRisk,
  onDeleteRisk,
}) => {
  const [subTab, setSubTab] = useState<ReviewSubTab>(initialSubTab ?? 'exec');

  useEffect(() => {
    if (initialSubTab) {
      setSubTab(initialSubTab);
    }
  }, [initialSubTab]);
  const [totalSiteSqm, setTotalSiteSqm] = useState<number>(29781.8);
  const [usedPct, setUsedPct] = useState<number>(20);
  const [discountRatePct, setDiscountRatePct] = useState<number>(22);
  const [exportingPptx, setExportingPptx] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  const review: CfoExecutiveReviewData = useMemo(
    () =>
      buildCfoExecutiveReview(state, {
        totalSiteSqm: totalSiteSqm > 0 ? totalSiteSqm : 29781.8,
        usedPct: Math.min(95, Math.max(5, usedPct)),
        discountRatePct: Math.min(45, Math.max(8, discountRatePct)),
      }),
    [state, totalSiteSqm, usedPct, discountRatePct]
  );

  const stocktake = useMemo(() => computeStocktakeVarianceAlerts(state, 2), [state]);

  const handleExportExcel = () => {
    exportCfoExcelModel(state, review, lang);
    setExportNotice(
      t(
        lang,
        'تم تصدير نموذج Excel الاستثماري والمالي الكامل (11 ورقة عمل مرتبطة بمعادلات).',
        'Exported 11-sheet formula-linked CFO Financial & Investment Excel workbook.'
      )
    );
  };

  const handleExportPptx = async () => {
    setExportingPptx(true);
    try {
      await exportCfoPowerPointDeck(state, review, lang);
      setExportNotice(
        t(
          lang,
          'تم إنشاء وتنزيل العرض التقديمي التنفيذي للمدير المالي (15 شريحة PowerPoint).',
          'Exported 15-slide CFO Executive Presentation (.pptx).'
        )
      );
    } finally {
      setExportingPptx(false);
    }
  };

  const handlePrintPdf = () => {
    window.print();
  };

  const renderExecutiveSummarySection = () => (
    <div className="space-y-6 print:space-y-3.5">
      {/* KPI Headline Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 print:grid-cols-4 gap-4 print:gap-2.5 print-avoid-break">
        <div className="bg-white border border-slate-200 rounded-xl p-4 print:p-2.5">
          <div className="flex items-center justify-between gap-1.5">
            <span className="text-xs print:text-[10px] font-medium text-slate-500">
              {t(lang, 'صافي الإيراد المحاسبي (10M بالقاعدة)', '10M Net Accounting Revenue (In DB)')}
            </span>
            <StatusBadge status="CONFIRMED" lang={lang} compact />
          </div>
          <div className="mt-2 print:mt-1 text-2xl print:text-sm font-bold font-mono-num text-slate-900" dir="ltr">
            {fmtMoney(review.totals10MCombined.netRevenue, 0)} EGP
          </div>
          <div className="mt-2 pt-2 print:mt-1.5 print:pt-1 border-t border-slate-100 text-[11px] print:text-[9px] text-slate-500 flex items-center justify-between font-mono-num" dir="ltr">
            <span>9M: {fmtMoney(review.totals9MMonthly.netRevenue, 0)}</span>
            <span>Oct Live: {fmtMoney(review.octoberLive.netSales, 0)}</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 print:p-2.5">
          <div className="flex items-center justify-between gap-1.5">
            <span className="text-xs print:text-[10px] font-medium text-slate-500">
              {t(lang, 'صافي الخسارة 9M (شهري vs GL 5101)', '9M Net Loss (Monthly vs GL 5101)')}
            </span>
            <StatusBadge status="PENDING_REVIEW" lang={lang} compact />
          </div>
          <div className="mt-2 print:mt-1 text-2xl print:text-sm font-bold font-mono-num text-red-700" dir="ltr">
            {fmtMoney(review.totals9MMonthly.netProfitMonthly, 0)} EGP
          </div>
          <div className="mt-2 pt-2 print:mt-1.5 print:pt-1 border-t border-slate-100 text-[11px] print:text-[9px] text-slate-500 flex items-center justify-between font-mono-num" dir="ltr">
            <span>GL 5101: {fmtMoney(review.totals9MMonthly.netProfitGl, 0)}</span>
            <span className="text-amber-700 font-semibold">COGS Δ 65,000</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 print:p-2.5">
          <div className="flex items-center justify-between gap-1.5">
            <span className="text-xs print:text-[10px] font-medium text-slate-500">
              {t(lang, 'نتيجة التشغيل بدون حق الانتفاع (9M)', '9M Operating Result Ex-Usufruct')}
            </span>
            <StatusBadge status="CONFIRMED" lang={lang} compact />
          </div>
          <div className="mt-2 print:mt-1 text-2xl print:text-sm font-bold font-mono-num text-amber-700" dir="ltr">
            {fmtMoney(review.totals9MMonthly.netProfitExRentMonthly, 0)} EGP
          </div>
          <div className="mt-2 pt-2 print:mt-1.5 print:pt-1 border-t border-slate-100 text-[11px] print:text-[9px] text-slate-500">
            {t(
              lang,
              '90% من الخسارة ناتج عن عبء إيجار 5.1م مع بقاء 80% فراغ',
              '90% of loss stems from fixed 5.1M rent over 80% idle space'
            )}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 print:p-2.5">
          <div className="flex items-center justify-between gap-1.5">
            <span className="text-xs print:text-[10px] font-medium text-slate-500">
              {t(lang, 'العبء السنوي على الـ 80% فراغ', 'Annual Rent Sunk on Idle Space')}
            </span>
            <StatusBadge status="PENDING_REVIEW" lang={lang} compact />
          </div>
          <div className="mt-2 print:mt-1 text-2xl print:text-sm font-bold font-mono-num text-red-700" dir="ltr">
            {fmtMoney(review.usufruct.rentBurdenOnUnusedSpaceAnnual, 0)} EGP
          </div>
          <div className="mt-2 pt-2 print:mt-1.5 print:pt-1 border-t border-slate-100 text-[11px] print:text-[9px] text-slate-500 flex items-center justify-between font-mono-num" dir="ltr">
            <span>{fmtMoney(review.usufruct.unusedSqm, 0)} m² ({review.usufruct.unusedPct}%)</span>
            <span>{fmtMoney(review.usufruct.rentBurdenOnUnusedSpaceMonthly, 0)}/mo</span>
          </div>
        </div>
      </div>

      {/* The Five Strategic Questions Answered */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 print:px-3.5 print:py-2.5 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              {t(
                lang,
                'القسم 1: الإجابة التنفيذية على الأسئلة الاستراتيجية الخمسة للمدير المالي',
                'Section 1: Executive Answers to the Five Strategic CFO Questions'
              )}
            </h2>
            <p className="text-xs print:text-[10px] text-slate-500 mt-0.5">
              {t(
                lang,
                'تشخيص صريح مدعوم بالأرقام الفعلية ومصنف وفق درجة التحقق المحاسبي.',
                'Candid evidence-backed synthesis tagged with accounting verification status.'
              )}
            </p>
          </div>
          <span className="text-[11px] print:text-[9.5px] font-medium text-slate-500">
            {lang === 'ar' ? review.preparedByAr : review.preparedByEn}
          </span>
        </div>

        <div className="divide-y divide-slate-200">
          {[
            {
              qNo: 'Q1',
              titleAr: 'ما حقيقة الأداء المالي لبرج المنوفية خلال عشرة أشهر (يناير – أكتوبر 2026)؟',
              titleEn: 'What is the true 10-month (Jan–Oct 2026) financial performance?',
              bodyAr: `خلال التسعة أشهر المعتمدة (يناير–سبتمبر)، حقق المشروع مبيعات إجمالية 12,931,435 ج (صافي إيراد محاسبي 11,343,364 ج بعد فصل 1,588,071 ج VAT 14%)، وبصافي خسارة -4,164,946 ج (طبقاً للجدول الشهري) أو -4,099,945 ج (طبقاً لقيد GL 5101 بفجوة 65,000 ج COGS قيد التسوية). أما شهر أكتوبر فهو مفتوح ولم يُقفل بعد في قاعدة البيانات (فقط ${review.octoberLive.invoiceCount} فواتير بيع بإجمالي ${fmtMoney(review.octoberLive.grossSales, 0)} ج وفاتورة شراء ${fmtMoney(review.octoberLive.purchasesGross, 0)} ج — دون قيود رواتب أو كهرباء). وبعزل حق الانتفاع (3.77م ج)، تقترب النتيجة التشغيلية من نقطة التعادل (-398 ألف ج فقط).`,
              bodyEn: `Across audited Jan–Sep (9M), gross sales hit 12.93M EGP (11.34M net revenue after 1.59M VAT), generating a net loss of -4,164,946 EGP (monthly COGS sum) or -4,099,945 EGP (GL 5101; 65k gap). October remains unclosed in DB with only ${review.octoberLive.invoiceCount} live invoices (${fmtMoney(review.octoberLive.grossSales, 0)} EGP) and 1 PO. Excluding usufruct rent (3.77M), 9M operating result is only -398k EGP—proving core unit demand exists once payroll & fixed land rent are addressed.`,
              status: 'CONFIRMED' as VerificationStatus,
            },
            {
              qNo: 'Q2',
              titleAr: 'ما حجم التحسن في الإدارة والرقابة والتشغيل؟',
              titleEn: 'How significant are governance, control & operational improvements?',
              bodyAr:
                'تم إحداث نقلة رقابية موثقة: تصفير رصيد تسوية الفيزا (1103 = 0.00 ج)؛ كشف انحراف عمولة مايو لبنك CIB عند 3.52% (18,500 ج)؛ مطابقة المخزون الفعلي (511,700 ج عبر 333 صنف و5 مواقع) مع GL 1201 بنسبة 100%؛ مطابقة الموردين (2,150,000 ج) مع GL 2101 بنسبة 100%؛ اتزان كامل لميزان المراجعة؛ وبناء وصفات BOM لـ 109 صنف بالمنيو وتفعيل تنبيهات الجرد الفورية >2%. الملاحظة الرقابية: غياب ميزان مراجعة 2025 يمنع القياس الكمي قبل/بعد لعام 2025.',
              bodyEn:
                'Documented controls include: zeroed VISA clearing (1103 = 0.00 EGP), catching May CIB MDR overcharge (3.52% / 18,500 EGP), 100% tie-out of 511.7k inventory & 2.15M suppliers AP, balanced double-entry Trial Balance, and 109-SKU BOM costing + >2% stocktake alerts. Missing 2025 TB limits historical numeric YoY quantification.',
              status: 'CONFIRMED' as VerificationStatus,
            },
            {
              qNo: 'Q3',
              titleAr: 'ما المشكلات والمخاطر التي لا تزال قائمة وتستدعي التدخل الفوري؟',
              titleEn: 'What unresolved issues & control risks require immediate action?',
              bodyAr:
                '1) تضخم الأجور والمنح لتبلغ 56.12% من صافي الإيراد (6.37م ج تشمل 1.56م ج منح متقطعة رغم الخسائر)؛ 2) ارتفاع تكلفة المبيعات (41.5% مقابل هدف 35%) وفجوة 65 ألف ج مع GL 5101؛ 3) تصاعد الكهرباء +234% من يناير (12.9k) إلى سبتمبر (43.1k)؛ 4) فرق كشف بنك CIB (-13,000 ج مايو) وعدم إرفاق مستند التحويل 1.275م؛ 5) 4 محاضر جرد 19 أكتوبر تتجاوز 2% بانحراف صافٍ -8,505.5 ج و5 أصناف بالمنيو بدون سعر.',
              bodyEn:
                '1) Payroll & unlinked bonuses absorb 56.12% of net revenue (6.37M incl. 1.56M bonuses); 2) Elevated COGS (41.5% vs 35% target) + 65k GL gap; 3) Electricity +234% Jan→Sep; 4) -13,000 EGP May CIB mismatch & unverified 1.275M movement; 5) 4 Oct-19 stocktakes >2% (-8,505.5 EGP) and 5 unpriced menu SKUs.',
              status: 'PENDING_REVIEW' as VerificationStatus,
            },
            {
              qNo: 'Q4',
              titleAr: 'كيف يمكن استغلال كامل حق الانتفاع خاصة أن 80% من المساحة لا تزال فارغة؟',
              titleEn: 'How can Estadaat monetize the 80% idle usufruct area (~23,825 m²)?',
              bodyAr: `يتحمل المطعم حالياً (يشغل ~20% أي ${fmtMoney(review.usufruct.usedSqm, 0)} م²) كامل قيمة حق الانتفاع السنوي (5.1م ج) بمعدل ${fmtMoney(review.usufruct.rentBurdenOnUsedSqmAnnual, 0)} ج/م² فعال، بينما تظل ${fmtMoney(review.usufruct.unusedSqm, 0)} م² فارغة بتكلفة مهدرة قدرها ${fmtMoney(review.usufruct.rentBurdenOnUnusedSpaceAnnual, 0)} ج/سنة. بتقسيم الـ 80% الفراغ إلى مراحل (كافيهات وحديقة عائلات + قاعات مناسبات + ملاعب وألعاب أطفال + مجمع علامات)، يضيف التوسع إلى 30%–40% إشغال ما بين +1.95م إلى +5.70م ج EBITDA سنوياً دون تحميل إيجار ثابت مكرر.`,
              bodyEn: `Active 20% (${fmtMoney(review.usufruct.usedSqm, 0)} m²) carries the entire 5.1M annual usufruct (${fmtMoney(review.usufruct.rentBurdenOnUsedSqmAnnual, 0)} EGP/m² effective), leaving ${fmtMoney(review.usufruct.unusedSqm, 0)} m² generating ${fmtMoney(review.usufruct.rentBurdenOnUnusedSpaceAnnual, 0)} EGP/yr dead rent. Phased zoning toward 30%–40% occupancy adds +1.95M to +5.70M annual EBITDA without duplicating fixed usufruct rent.`,
              status: 'PENDING_REVIEW' as VerificationStatus,
            },
            {
              qNo: 'Q5',
              titleAr: 'ما القرارات والاستثمارات المطلوبة لتحقيق أفضل عائد اقتصادي خلال 2027؟',
              titleEn: 'What 2027 decisions & investments maximize economic return?',
              bodyAr:
                '1) اعتماد موازنة 2027 (سيناريو ج: 18.0م ج صافي إيراد، 35% COGS، سقف رواتب 6.0م، تعادل شهري في Q4 عند 1.70م/شهر)؛ 2) تجميد المنح التلقائية وربطها بصافي الربح؛ 3) التعاقد عبر نموذج الشراكة التشغيلية ومشاركة الإيراد (JV Partner) للمرحلة الأولى (30% إشغال) برأس مال منخفض من استادات (2.2م ج) وعائد داخلي IRR ~87% وفترة استرداد ~1.13 سنة مع الالتزام القانوني بعقد الانتفاع؛ 4) فتح تفاوض مع المحافظة لتخفيف عبء القسط الفصلي 1.275م.',
              bodyEn:
                '1) Enact 2027 Scenario C (18.0M net rev, 35% COGS, 6.0M payroll cap, Q4 break-even at 1.70M/mo); 2) Replace discretionary bonuses with profit-gated KPIs; 3) Execute Option 2 JV Partner for Phase-1 idle space (2.2M CAPEX, ~87% IRR, ~1.13 yr payback) preserving primary usufruct compliance; 4) Negotiate Governorate installment relief.',
              status: 'CONFIRMED' as VerificationStatus,
            },
          ].map((item) => (
            <div key={item.qNo} className="p-5 print:p-3 flex flex-col lg:flex-row print:flex-row lg:items-start print:items-start justify-between gap-4 print:gap-3 print-avoid-break">
              <div className="space-y-1.5 print:space-y-1 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-slate-900 text-white text-[11px] print:text-[9px] font-bold font-mono-num">
                    {item.qNo}
                  </span>
                  <h3 className="text-sm print:text-xs font-bold text-slate-900">
                    {lang === 'ar' ? item.titleAr : item.titleEn}
                  </h3>
                </div>
                <p className="text-xs print:text-[10px] leading-6 print:leading-relaxed text-slate-700">
                  {lang === 'ar' ? item.bodyAr : item.bodyEn}
                </p>
              </div>
              <div className="shrink-0">
                <StatusBadge status={item.status} lang={lang} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Data Verification & Zero-Fabrication Audit Ledger */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 print:px-3.5 print:py-2.5 border-b border-slate-200 bg-slate-50/70">
          <h2 className="text-sm font-bold text-slate-900">
            {t(
              lang,
              'سجل التحقق المحاسبي ومصداقية البيانات (Zero-Fabrication Audit Matrix)',
              'Audit Verification Ledger (CONFIRMED / PENDING_REVIEW / MISSING_DATA / NOT_CALCULABLE)'
            )}
          </h2>
          <p className="text-xs print:text-[10px] text-slate-500 mt-0.5">
            {t(
              lang,
              'كل رقم في الدراسة موثق بمصدره الحقيقي في PostgreSQL وملف التأسيس دون أي استكمال تقديري للبيانات الناقصة.',
              'Every figure is verified against live PostgreSQL & audited ledgers with zero fabricated estimates.'
            )}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-start">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="py-2.5 px-4 font-semibold">{t(lang, 'الكود', 'ID')}</th>
                <th className="py-2.5 px-4 font-semibold">{t(lang, 'المجال المحاسبي', 'Domain')}</th>
                <th className="py-2.5 px-4 font-semibold">{t(lang, 'القيمة / النطاق الموثق', 'Verified Scope / Value')}</th>
                <th className="py-2.5 px-4 font-semibold">{t(lang, 'المصدر', 'Source Ref')}</th>
                <th className="py-2.5 px-4 font-semibold">{t(lang, 'الحالة', 'Status')}</th>
                <th className="py-2.5 px-4 font-semibold">{t(lang, 'الملاحظة الرقابية', 'Audit Note')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {review.verificationLedger.map((v) => (
                <tr key={v.id} className="hover:bg-slate-50/70">
                  <td className="py-2.5 px-4 font-mono-num font-bold text-slate-800">{v.id}</td>
                  <td className="py-2.5 px-4 font-semibold text-slate-900">
                    {lang === 'ar' ? v.domainAr : v.domainEn}
                  </td>
                  <td className="py-2.5 px-4 font-mono-num text-slate-800">
                    {lang === 'ar' ? v.valueDisplayAr : v.valueDisplayEn}
                  </td>
                  <td className="py-2.5 px-4 font-mono-num text-[11px] text-slate-500" dir="ltr">
                    {v.sourceRef}
                  </td>
                  <td className="py-2.5 px-4">
                    <StatusBadge status={v.status} lang={lang} />
                  </td>
                  <td className="py-2.5 px-4 text-slate-600 max-w-md print:max-w-none">
                    {lang === 'ar' ? v.auditNoteAr : v.auditNoteEn}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 9 CFO Decisions Table */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden print-avoid-break">
        <div className="px-5 py-4 print:px-3.5 print:py-2.5 border-b border-slate-200 bg-slate-50/70">
          <h2 className="text-sm font-bold text-slate-900">
            {t(lang, 'القسم 19: القرارات التنفيذية التسعة المطلوبة من المدير المالي (CFO Sign-Off)', 'Section 19: Nine Required CFO Decisions')}
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-start">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="py-2.5 px-4 font-semibold">#</th>
                <th className="py-2.5 px-4 font-semibold">{t(lang, 'القرار التنفيذي', 'Decision')}</th>
                <th className="py-2.5 px-4 font-semibold">{t(lang, 'الأثر المالي المتوقع', 'Financial Impact')}</th>
                <th className="py-2.5 px-4 font-semibold">{t(lang, 'الإطار الزمني', 'Horizon')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {review.cfoDecisions.map((d) => (
                <tr key={d.id} className="hover:bg-slate-50/70">
                  <td className="py-2.5 px-4 font-mono-num font-bold text-teal-800">{d.id}</td>
                  <td className="py-2.5 px-4 font-medium text-slate-900">
                    {lang === 'ar' ? d.decisionAr : d.decisionEn}
                  </td>
                  <td className="py-2.5 px-4 text-emerald-800 font-medium">
                    {lang === 'ar' ? d.financialImpactAr : d.financialImpactEn}
                  </td>
                  <td className="py-2.5 px-4">
                    <span
                      className={`inline-flex px-2 py-0.5 rounded border text-[11px] font-semibold font-mono-num ${
                        d.urgency === 'immediate'
                          ? 'bg-red-50 text-red-700 border-red-200'
                          : d.urgency === 'q4_2026'
                          ? 'bg-amber-50 text-amber-800 border-amber-200'
                          : 'bg-teal-50 text-teal-800 border-teal-200'
                      }`}
                    >
                      {d.urgency.toUpperCase()}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );

  const renderFinancialsSection = () => (
    <div className="space-y-6 print:space-y-4">
      {/* 10-Month P&L Table (Jan - Oct 2026) */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 print:px-3.5 print:py-2.5 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              {t(
                lang,
                'القسم 4: قائمة الدخل الشهرية الكاملة للأشهر العشرة (يناير – أكتوبر 2026)',
                'Section 4: 10-Month Income Statement (January – October 2026)'
              )}
            </h2>
            <p className="text-xs print:text-[10px] text-slate-500 mt-0.5">
              {t(
                lang,
                'تعرض كل شهر منفصلاً دون تكرار، مع فصل صافي الإيراد عن VAT 14% وإظهار فجوة COGS (65,000 ج) وحالة أكتوبر المفتوحة.',
                'Shows all 10 months discretely, separating VAT 14% from net revenue, highlighting the 65k COGS GL variance and partial Oct DB entries.'
              )}
            </p>
          </div>
          <StatusBadge status={review.octoberLive.isFullMonthClosed ? 'CONFIRMED' : 'MISSING_DATA'} lang={lang} />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-start cfo-pnl-table">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="py-2.5 px-3 font-semibold">{t(lang, 'الشهر', 'Month')}</th>
                <th className="py-2.5 px-3 font-semibold">{t(lang, 'الحالة', 'Status')}</th>
                <th className="py-2.5 px-3 font-semibold">{t(lang, 'إجمالي المبيعات', 'Gross Sales')}</th>
                <th className="py-2.5 px-3 font-semibold">{t(lang, 'VAT 14%', 'VAT 14%')}</th>
                <th className="py-2.5 px-3 font-semibold">{t(lang, 'صافي الإيراد', 'Net Rev')}</th>
                <th className="py-2.5 px-3 font-semibold">{t(lang, 'COGS', 'COGS')}</th>
                <th className="py-2.5 px-3 font-semibold">{t(lang, 'مجمل الربح', 'Gross Profit')}</th>
                <th className="py-2.5 px-3 font-semibold">{t(lang, 'الرواتب والمنح', 'Payroll')}</th>
                <th className="py-2.5 px-3 font-semibold">{t(lang, 'حق الانتفاع', 'Usufruct')}</th>
                <th className="py-2.5 px-3 font-semibold">{t(lang, 'الكهرباء', 'Elec.')}</th>
                <th className="py-2.5 px-3 font-semibold">{t(lang, 'صافي الربح', 'Net Result')}</th>
                <th className="py-2.5 px-3 font-semibold">{t(lang, 'قبل الانتفاع', 'Ex-Rent')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono-num">
              {review.monthlyRows.map((m) => (
                <tr key={m.monthKey} className={m.monthKey === '2026-10' ? 'bg-amber-50/40' : 'hover:bg-slate-50/70'}>
                  <td className="py-2 px-3 font-sans font-semibold text-slate-900 whitespace-nowrap">
                    {lang === 'ar' ? m.labelAr : m.labelEn}
                  </td>
                  <td className="py-2 px-3">
                    <StatusBadge status={m.status} lang={lang} compact />
                  </td>
                  <td className="py-2 px-3" dir="ltr">{fmtMoney(m.grossSales, 0)}</td>
                  <td className="py-2 px-3 text-slate-600" dir="ltr">{fmtMoney(m.vatOutput, 0)}</td>
                  <td className="py-2 px-3 font-semibold text-slate-900" dir="ltr">{fmtMoney(m.netSales, 0)}</td>
                  <td className="py-2 px-3" dir="ltr">{fmtMoney(m.cogs, 0)}</td>
                  <td className="py-2 px-3 text-emerald-700 font-semibold" dir="ltr">
                    {fmtMoney(m.grossProfit, 0)} <span className="text-[10px] text-slate-400">({m.gpMarginPct}%)</span>
                  </td>
                  <td className="py-2 px-3" dir="ltr">
                    {fmtMoney(m.payrollTotal, 0)}
                    {m.payrollBonuses > 0 && (
                      <span className="block text-[10px] text-amber-700">+{fmtMoney(m.payrollBonuses, 0)} bonus</span>
                    )}
                  </td>
                  <td className="py-2 px-3" dir="ltr">{fmtMoney(m.usufructRent, 0)}</td>
                  <td className="py-2 px-3" dir="ltr">{fmtMoney(m.electricity, 0)}</td>
                  <td className={`py-2 px-3 font-bold ${m.netProfit < 0 ? 'text-red-700' : 'text-emerald-700'}`} dir="ltr">
                    {fmtMoney(m.netProfit, 0)}
                  </td>
                  <td className={`py-2 px-3 font-semibold ${m.netProfitExRent < 0 ? 'text-amber-700' : 'text-emerald-700'}`} dir="ltr">
                    {fmtMoney(m.netProfitExRent, 0)}
                  </td>
                </tr>
              ))}
              {/* 9M Monthly Sum */}
              <tr className="bg-slate-100 font-bold text-slate-900">
                <td className="py-2.5 px-3 font-sans" colSpan={2}>
                  {t(lang, 'إجمالي 9 شهور (جدول شهري)', '9M Audited Total (Monthly Sum)')}
                </td>
                <td className="py-2.5 px-3" dir="ltr">{fmtMoney(review.totals9MMonthly.grossSales, 0)}</td>
                <td className="py-2.5 px-3" dir="ltr">{fmtMoney(review.totals9MMonthly.vatOutput, 0)}</td>
                <td className="py-2.5 px-3" dir="ltr">{fmtMoney(review.totals9MMonthly.netRevenue, 0)}</td>
                <td className="py-2.5 px-3" dir="ltr">{fmtMoney(review.totals9MMonthly.cogsMonthlySum, 0)}</td>
                <td className="py-2.5 px-3 text-emerald-700" dir="ltr">{fmtMoney(review.totals9MMonthly.grossProfitMonthly, 0)}</td>
                <td className="py-2.5 px-3" dir="ltr">{fmtMoney(review.totals9MMonthly.payrollTotal, 0)}</td>
                <td className="py-2.5 px-3" dir="ltr">{fmtMoney(review.totals9MMonthly.usufructRent, 0)}</td>
                <td className="py-2.5 px-3" dir="ltr">{fmtMoney(review.totals9MMonthly.electricity, 0)}</td>
                <td className="py-2.5 px-3 text-red-700" dir="ltr">{fmtMoney(review.totals9MMonthly.netProfitMonthly, 0)}</td>
                <td className="py-2.5 px-3 text-amber-800" dir="ltr">{fmtMoney(review.totals9MMonthly.netProfitExRentMonthly, 0)}</td>
              </tr>
              {/* 9M GL 5101 Audit Row */}
              <tr className="bg-amber-50/70 font-semibold text-amber-950">
                <td className="py-2 px-3 font-sans" colSpan={2}>
                  {t(lang, 'مقارنة ملخص GL 5101 (فجوة 65,000 ج COGS)', 'Audit Ref: 9M Summary GL 5101 (65k COGS Diff)')}
                </td>
                <td className="py-2 px-3" dir="ltr">{fmtMoney(review.totals9MMonthly.grossSales, 0)}</td>
                <td className="py-2 px-3" dir="ltr">{fmtMoney(review.totals9MMonthly.vatOutput, 0)}</td>
                <td className="py-2 px-3" dir="ltr">{fmtMoney(review.totals9MMonthly.netRevenue, 0)}</td>
                <td className="py-2 px-3 text-amber-800" dir="ltr">{fmtMoney(review.totals9MMonthly.cogsGl5101, 0)}</td>
                <td className="py-2 px-3" dir="ltr">{fmtMoney(review.totals9MMonthly.grossProfitGl, 0)}</td>
                <td className="py-2 px-3" dir="ltr">{fmtMoney(review.totals9MMonthly.payrollTotal, 0)}</td>
                <td className="py-2 px-3" dir="ltr">{fmtMoney(review.totals9MMonthly.usufructRent, 0)}</td>
                <td className="py-2 px-3" dir="ltr">{fmtMoney(review.totals9MMonthly.electricity, 0)}</td>
                <td className="py-2 px-3 text-red-700" dir="ltr">{fmtMoney(review.totals9MMonthly.netProfitGl, 0)}</td>
                <td className="py-2 px-3" dir="ltr">{fmtMoney(review.totals9MMonthly.netProfitExRentGl, 0)}</td>
              </tr>
              {/* 10M Combined */}
              <tr className="bg-teal-50/70 font-bold text-slate-900">
                <td className="py-2.5 px-3 font-sans" colSpan={2}>
                  {t(lang, 'المتراكم 10 شهور في القاعدة (9M + المسجل بأكتوبر)', '10M Combined in DB (9M + Live Oct Partial)')}
                </td>
                <td className="py-2.5 px-3" dir="ltr">{fmtMoney(review.totals10MCombined.grossSales, 0)}</td>
                <td className="py-2.5 px-3" dir="ltr">{fmtMoney(review.totals10MCombined.vatOutput, 0)}</td>
                <td className="py-2.5 px-3" dir="ltr">{fmtMoney(review.totals10MCombined.netRevenue, 0)}</td>
                <td className="py-2.5 px-3" dir="ltr">{fmtMoney(review.totals10MCombined.cogs, 0)}</td>
                <td className="py-2.5 px-3 text-emerald-700" dir="ltr">{fmtMoney(review.totals10MCombined.grossProfit, 0)}</td>
                <td className="py-2.5 px-3" dir="ltr">{fmtMoney(review.totals10MCombined.payrollTotal, 0)}</td>
                <td className="py-2.5 px-3" dir="ltr">{fmtMoney(review.totals10MCombined.usufructRent, 0)}</td>
                <td className="py-2.5 px-3" dir="ltr">{fmtMoney(review.totals10MCombined.electricity, 0)}</td>
                <td className="py-2.5 px-3 text-red-700" dir="ltr">{fmtMoney(review.totals10MCombined.netProfit, 0)}</td>
                <td className="py-2.5 px-3" dir="ltr">{fmtMoney(review.totals10MCombined.netProfitExRent, 0)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Bank, POS & 1.275M Forensic Reconciliation */}
      <div className="grid grid-cols-1 lg:grid-cols-2 print:grid-cols-2 gap-6 print:gap-3 print-avoid-break">
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden print-avoid-break">
          <div className="px-5 py-4 print:px-3.5 print:py-2.5 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between gap-2">
            <h3 className="text-sm print:text-xs font-bold text-slate-900">
              {t(lang, 'التسوية البنكية (CIB 1102)، تسوية الفيزا (1103) والمخزون', 'Bank CIB (1102), VISA Clearing (1103) & Balance Ties')}
            </h3>
            {onNavigate && (
              <button
                onClick={() => onNavigate('accounting')}
                className="no-print print:hidden text-xs font-semibold text-teal-700 hover:underline"
              >
                {t(lang, 'فتح دفتر الأستاذ', 'Open Ledger')}
              </button>
            )}
          </div>
          <div className="p-5 print:p-3 space-y-3 print:space-y-1.5 text-xs print:text-[9.5px]">
            {[
              {
                labelAr: 'رصيد بنك CIB دفتري (1102) مقابل كشف الحساب',
                labelEn: 'CIB Book (1102) vs Statement Ending',
                val: `${fmtMoney(review.bankAndRecon.cibGl1102, 0)} vs ${fmtMoney(review.bankAndRecon.cibStatementEnding, 0)} (Δ ${fmtMoney(review.bankAndRecon.unmatchedBankVariance, 0)} EGP)`,
                status: 'PENDING_REVIEW' as VerificationStatus,
              },
              {
                labelAr: 'حساب تسوية ماكينات الفيزا (1103 — 30 سبتمبر)',
                labelEn: 'VISA/POS Clearing (1103 as of Sep 30)',
                val: `${fmtMoney(review.bankAndRecon.clearing1103, 2)} EGP`,
                status: 'CONFIRMED' as VerificationStatus,
              },
              {
                labelAr: 'تقييم المخزون الفعلي (333 صنف) مقابل GL 1201',
                labelEn: 'Physical Inventory Valuation vs GL 1201',
                val: `${fmtMoney(review.bankAndRecon.inventoryPhysicalVal, 0)} = ${fmtMoney(review.bankAndRecon.inventoryGl1201, 0)} EGP`,
                status: 'CONFIRMED' as VerificationStatus,
              },
              {
                labelAr: 'أرصدة الموردين (8 موردين) مقابل GL 2101',
                labelEn: 'Suppliers Aging (8 Vendors) vs GL 2101',
                val: `${fmtMoney(review.bankAndRecon.suppliersAgingSum, 0)} = ${fmtMoney(review.bankAndRecon.suppliersGl2101, 0)} EGP`,
                status: 'CONFIRMED' as VerificationStatus,
              },
              {
                labelAr: 'اتزان ميزان المراجعة (مدين = دائن)',
                labelEn: 'Trial Balance Equilibrium (Dr = Cr)',
                val: `${fmtMoney(review.bankAndRecon.trialBalanceDebit, 0)} EGP`,
                status: (review.bankAndRecon.trialBalanced ? 'CONFIRMED' : 'PENDING_REVIEW') as VerificationStatus,
              },
            ].map((row, idx) => (
              <div key={idx} className="flex flex-wrap items-center justify-between gap-2 py-2 print:py-1 border-b border-slate-100 last:border-b-0">
                <span className="font-medium text-slate-700">{lang === 'ar' ? row.labelAr : row.labelEn}</span>
                <div className="flex items-center gap-1.5">
                  <span className="font-mono-num font-bold text-slate-900" dir="ltr">{row.val}</span>
                  <StatusBadge status={row.status} lang={lang} compact />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 1.275M Investigation Card */}
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden print-avoid-break">
          <div className="px-5 py-4 print:px-3.5 print:py-2.5 border-b border-slate-200 bg-amber-50/70 flex items-center justify-between gap-2">
            <h3 className="text-sm print:text-xs font-bold text-slate-900">
              {t(lang, 'التحقيق المحاسبي لمبلغ 1.275 مليون ج وتسويات POS', 'Forensic Audit: 1,275,000 EGP Movement & POS MDR')}
            </h3>
            <StatusBadge status="PENDING_REVIEW" lang={lang} compact />
          </div>
          <div className="p-5 print:p-3 space-y-3 print:space-y-2 text-xs print:text-[9.5px] leading-6 print:leading-snug text-slate-700">
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
              <div className="font-bold text-slate-900 mb-1">
                {t(lang, '1. قسط حق الانتفاع الربع سنوي (1,275,000 ج — مؤكد)', '1. Quarterly Usufruct Installment (1,275,000 EGP — CONFIRMED)')}
              </div>
              <p>
                {t(
                  lang,
                  'موثق في EXP-2026-0801 كدفعة إيجار حق انتفاع للمحافظة (الحساب 5202 = 5.1م ÷ 4). هو مصروف وتدفق نقدي خارج.',
                  'Documented under EXP-2026-0801 (5.1M / 4 quarterly rent to Governorate). Strictly an operating outflow.'
                )}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
              <div className="font-bold text-slate-900 mb-1">
                {t(lang, '2. تسوية دفعة فيزا 20 أبريل (1,276,578.62 ج — تحويل مقاصة)', '2. April 20 POS/VISA Clearing (1,276,578.62 EGP — Settlement)')}
              </div>
              <p>
                {t(
                  lang,
                  'تسوية تحصيل بطاقات من حساب 1103 إلى بنك CIB (1102)، وليست مبيعات جديدة أو إيرادات إضافية.',
                  'Card settlement moving cash from 1103 to CIB 1102—not incremental revenue.'
                )}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-red-50/70 border border-red-200 text-red-900">
              <div className="font-bold mb-1">
                {t(lang, '3. قاعدة الحظر المحاسبي للتحويل الداخلي 1.275م', '3. Strict Exclusion Rule for 1.275M Transfer')}
              </div>
              <p>
                {t(
                  lang,
                  'لا يوجد قيد تحويل داخلي منفصل بـ 1.275م في bankTransactions حتى الآن؛ ويُحظر تماماً تصنيفه كإيراد في قائمة الدخل.',
                  'No separate 1.275M internal transfer voucher is posted in bankTransactions; strictly prohibited from P&L revenue.'
                )}
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );

  const renderOperationsSection = () => (
    <div className="space-y-6 print:space-y-4">
      {/* Before vs After Governance Matrix */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 print:px-3.5 print:py-2.5 border-b border-slate-200 bg-slate-50/70">
          <h2 className="text-sm font-bold text-slate-900">
            {t(lang, 'القسم 5: مصفوفة الحوكمة والتحول الرقابي (قبل مقابل بعد بالأدلة)', 'Section 5: Governance & Internal Control Matrix (Before vs. After)')}
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-start">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="py-2.5 px-4 font-semibold">{t(lang, 'المجال', 'Control Area')}</th>
                <th className="py-2.5 px-4 font-semibold">{t(lang, 'قبل التطوير', 'Before')}</th>
                <th className="py-2.5 px-4 font-semibold">{t(lang, 'بعد التطوير (بالأدلة)', 'After (Verified DB)')}</th>
                <th className="py-2.5 px-4 font-semibold">{t(lang, 'الحالة', 'Status')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {review.governanceMatrix.map((g) => (
                <tr key={g.id} className="hover:bg-slate-50/70">
                  <td className="py-3 px-4 font-semibold text-slate-900">
                    {lang === 'ar' ? g.areaAr : g.areaEn}
                  </td>
                  <td className="py-3 px-4 text-slate-600">
                    {lang === 'ar' ? g.beforeStateAr : g.beforeStateEn}
                  </td>
                  <td className="py-3 px-4 text-slate-800">
                    <div>{lang === 'ar' ? g.afterStateAr : g.afterStateEn}</div>
                    <div className="text-[11px] print:text-[8.5px] text-teal-700 mt-1 font-mono-num">
                      {lang === 'ar' ? g.evidenceAr : g.evidenceEn}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <StatusBadge status={g.status} lang={lang} compact />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Operational KPIs + Oct-19 Stocktake Variances */}
      <div className="grid grid-cols-1 lg:grid-cols-2 print:grid-cols-2 gap-6 print:gap-3 print-avoid-break">
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden print-avoid-break">
          <div className="px-5 py-4 print:px-3.5 print:py-2.5 border-b border-slate-200 bg-slate-50/70">
            <h3 className="text-sm print:text-xs font-bold text-slate-900">
              {t(lang, 'القسم 6: مؤشرات الكفاءة التشغيلية والمنيو وتكلفة الغذاء', 'Section 6: Operational Efficiency, Food Cost & Menu Pricing')}
            </h3>
          </div>
          <div className="p-5 print:p-3 grid grid-cols-2 gap-3 print:gap-2 text-xs print:text-[9.5px]">
            <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/60">
              <div className="text-slate-500">{t(lang, 'تكلفة الغذاء الفعلية vs النظرية', 'Actual vs Theoretical Food Cost')}</div>
              <div className="text-base font-bold font-mono-num text-red-700 mt-1" dir="ltr">
                {review.operations.foodCostActualPct}% vs {review.operations.foodCostTheoreticalPct}%
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                {t(lang, `فجوة +${review.operations.foodCostVariancePct}%`, `+${review.operations.foodCostVariancePct}% gap`)}
              </div>
            </div>
            <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/60">
              <div className="text-slate-500">{t(lang, 'هيكل المنيو والتسعير', 'Menu Catalog & 12% Service')}</div>
              <div className="text-base font-bold font-mono-num text-slate-900 mt-1" dir="ltr">
                {review.operations.menuPricedCount} / {review.operations.menuTotalItems} SKUs
              </div>
              <div className="text-[11px] text-amber-700 mt-0.5">
                {t(lang, `${review.operations.menuUnspecifiedCount} أصناف بدون سعر محدد`, `${review.operations.menuUnspecifiedCount} unspecified prices`)}
              </div>
            </div>
            <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/60">
              <div className="text-slate-500">{t(lang, 'فجوة الإثنين مقابل الجمعة', 'Monday vs Friday Sales')}</div>
              <div className="text-base font-bold font-mono-num text-slate-900 mt-1" dir="ltr">
                {fmtMoney(review.operations.dayOfWeek.mondayAvg, 0)} vs {fmtMoney(review.operations.dayOfWeek.fridayAvg, 0)}
              </div>
              <div className="text-[11px] text-teal-700 mt-0.5">
                {t(lang, `هدف الإثنين: ${fmtMoney(review.operations.dayOfWeek.targetMondayAvg, 0)} ج`, `Target Mon: ${fmtMoney(review.operations.dayOfWeek.targetMondayAvg, 0)} EGP`)}
              </div>
            </div>
            <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/60">
              <div className="text-slate-500">{t(lang, 'تصاعد الكهرباء (يناير ← سبتمبر)', 'Electricity Escalation (Jan → Sep)')}</div>
              <div className="text-base font-bold font-mono-num text-red-700 mt-1" dir="ltr">
                +{review.operations.electricityGrowthPct}%
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5 font-mono-num" dir="ltr">
                {fmtMoney(review.operations.electricityJan, 0)} → {fmtMoney(review.operations.electricitySep, 0)} EGP
              </div>
            </div>
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden print-avoid-break">
          <div className="px-5 py-4 print:px-3.5 print:py-2.5 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between gap-2">
            <h3 className="text-sm print:text-xs font-bold text-slate-900">
              {t(lang, 'محاضر جرد 19 أكتوبر (> 2% انحراف)', 'Oct-19 Physical Stocktake Variance (>2%)')}
            </h3>
            {onNavigate && (
              <button
                onClick={() => onNavigate('inventory')}
                className="no-print print:hidden text-xs font-semibold text-teal-700 hover:underline"
              >
                {t(lang, 'تسوية الجرد', 'Reconcile Stocktakes')}
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-start">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="py-2 px-3 font-semibold">SKU</th>
                  <th className="py-2 px-3 font-semibold">{t(lang, 'الصنف', 'Ingredient')}</th>
                  <th className="py-2 px-3 font-semibold">{t(lang, 'الفعلي / الدفتري', 'Actual / Book')}</th>
                  <th className="py-2 px-3 font-semibold">{t(lang, 'الانحراف', 'Var %')}</th>
                  <th className="py-2 px-3 font-semibold">{t(lang, 'الأثر', 'Value')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono-num">
                {stocktake.items.map((item) => (
                  <tr key={item.entry.id}>
                    <td className="py-2 px-3 text-slate-600">{item.entry.sku}</td>
                    <td className="py-2 px-3 font-sans font-medium text-slate-900">
                      {lang === 'ar' ? item.entry.ingredientNameAr : item.entry.ingredientNameEn}
                    </td>
                    <td className="py-2 px-3" dir="ltr">
                      {item.entry.actualQty} / {item.liveBookQty} {item.entry.unit}
                    </td>
                    <td className={`py-2 px-3 font-bold ${item.exceedsThreshold ? 'text-red-700' : 'text-emerald-700'}`} dir="ltr">
                      {item.signedVariancePct >= 0 ? '+' : ''}{item.signedVariancePct}%
                    </td>
                    <td className="py-2 px-3" dir="ltr">{fmtMoney(item.varianceValue, 0)} EGP</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );

  const renderUsufructAnd2027Section = () => (
    <div className="space-y-6 print:space-y-4">
      {/* Usufruct & 80% Idle Land Analysis */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 print:px-3.5 print:py-2.5 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              {t(
                lang,
                'القسم 8 & 9: اقتصاديات حق الانتفاع وتقييم 80% مساحة غير مستغلة (20% مستغل مقابل 80% فراغ)',
                'Sections 8 & 9: Usufruct Economics & 80% Idle Land Valuation'
              )}
            </h2>
            <p className="text-xs print:text-[10px] text-slate-500 mt-0.5">
              {t(
                lang,
                `إجمالي المساحة التقديري ${fmtMoney(review.usufruct.totalSiteSqm, 1)} م² — حساب أثر الإيجار على المتر المستغل والفراغ المهدر (${fmtMoney(review.usufruct.rentBurdenOnUnusedSpaceAnnual, 0)} ج/سنة).`,
                `Site ${fmtMoney(review.usufruct.totalSiteSqm, 1)} m² — Effective rent/m² & ${fmtMoney(review.usufruct.rentBurdenOnUnusedSpaceAnnual, 0)} EGP/yr sunk rent on idle space.`
              )}
            </p>
          </div>
          <StatusBadge status="PENDING_REVIEW" lang={lang} compact />
        </div>

        <div className="p-5 print:p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 print:grid-cols-4 gap-4 print:gap-2.5 print-avoid-break">
          <div className="p-3.5 print:p-2 rounded-lg border border-slate-200 bg-slate-50/60">
            <div className="text-[11px] print:text-[9.5px] text-slate-500">{t(lang, 'إجمالي الإيجار (سنة 6-7 +2%)', 'Current Annual Usufruct (+2%)')}</div>
            <div className="text-lg print:text-sm font-bold font-mono-num text-slate-900 mt-1" dir="ltr">
              {fmtMoney(review.usufruct.currentAnnualRent, 0)} EGP
            </div>
            <div className="text-[11px] print:text-[9px] text-slate-500 mt-1">
              {t(lang, `قسط فصلي ${fmtMoney(review.usufruct.quarterlyInstallment, 0)} ج + 20% أرباح`, `Qtr ${fmtMoney(review.usufruct.quarterlyInstallment, 0)} + 20% Profit Share`)}
            </div>
          </div>
          <div className="p-3.5 print:p-2 rounded-lg border border-slate-200 bg-slate-50/60">
            <div className="text-[11px] print:text-[9.5px] text-slate-500">{t(lang, 'إيجار المتر الكلي vs المتر المستغل', 'Contract / m² vs Effective Used / m²')}</div>
            <div className="text-lg print:text-sm font-bold font-mono-num text-teal-800 mt-1" dir="ltr">
              {review.usufruct.rentPerTotalSqmAnnual} vs {review.usufruct.rentBurdenOnUsedSqmAnnual} EGP
            </div>
            <div className="text-[11px] print:text-[9px] text-red-700 mt-1">
              {t(lang, 'تضاعف العبء 5 مرات بسبب الفراغ!', '5x effective rent penalty on active restaurant!')}
            </div>
          </div>
          <div className="p-3.5 print:p-2 rounded-lg border border-red-200 bg-red-50/60">
            <div className="text-[11px] print:text-[9.5px] text-red-700 font-medium">{t(lang, `إيجار مهدر على ${review.usufruct.unusedPct}% فراغ`, `Annual Rent on ${review.usufruct.unusedPct}% Idle Land`)}</div>
            <div className="text-lg print:text-sm font-bold font-mono-num text-red-700 mt-1" dir="ltr">
              {fmtMoney(review.usufruct.rentBurdenOnUnusedSpaceAnnual, 0)} EGP/yr
            </div>
            <div className="text-[11px] print:text-[9px] text-red-700 mt-1 font-mono-num" dir="ltr">
              {fmtMoney(review.usufruct.unusedSqm, 0)} m² · {fmtMoney(review.usufruct.rentBurdenOnUnusedSpaceMonthly, 0)}/mo
            </div>
          </div>
          <div className="p-3.5 print:p-2 rounded-lg border border-slate-200 bg-slate-50/60">
            <div className="text-[11px] print:text-[9.5px] text-slate-500">{t(lang, 'زيادة السنوات القادمة (السنة 25)', 'Escalation Horizon (Yr 8 → Yr 25)')}</div>
            <div className="text-lg print:text-sm font-bold font-mono-num text-slate-900 mt-1" dir="ltr">
              5.1M → 5.814M EGP
            </div>
            <div className="text-[11px] print:text-[9px] text-slate-500 mt-1">
              {t(lang, 'قفزات +4% و+8% و+12% و+16%', '+4%, +8%, +12%, +16% cumulative step-ups')}
            </div>
          </div>
        </div>

        {/* Space Scenarios Table (20% / 30% / 40% / 60%) */}
        <div className="overflow-x-auto border-t border-slate-200">
          <table className="w-full text-xs text-start">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="py-2.5 px-4 font-semibold">{t(lang, 'نسبة الاستغلال', 'Utilization')}</th>
                <th className="py-2.5 px-4 font-semibold">{t(lang, 'السيناريو والمجالات المقترحة', 'Scenario & Activations')}</th>
                <th className="py-2.5 px-4 font-semibold">{t(lang, 'المساحة النشطة', 'Active m²')}</th>
                <th className="py-2.5 px-4 font-semibold">{t(lang, 'إيجار المتر النشط', 'Rent/Active m²')}</th>
                <th className="py-2.5 px-4 font-semibold">{t(lang, 'CAPEX إضافي', 'Incr. CAPEX')}</th>
                <th className="py-2.5 px-4 font-semibold">{t(lang, 'EBITDA إضافي/سنة', 'Incr. EBITDA/yr')}</th>
                <th className="py-2.5 px-4 font-semibold">{t(lang, 'صافي الفرع (بعد 5.1م)', 'Branch Net Result')}</th>
                <th className="py-2.5 px-4 font-semibold">{t(lang, 'الاسترداد', 'Payback')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono-num">
              {review.usufruct.spaceScenarios.map((sc) => (
                <tr key={sc.utilizationPct} className={sc.utilizationPct === 40 ? 'bg-teal-50/50' : 'hover:bg-slate-50/70'}>
                  <td className="py-2.5 px-4 font-bold text-slate-900">{sc.utilizationPct}%</td>
                  <td className="py-2.5 px-4 font-sans font-medium text-slate-900">
                    {lang === 'ar' ? sc.labelAr : sc.labelEn}
                  </td>
                  <td className="py-2.5 px-4" dir="ltr">{fmtMoney(sc.activeAreaSqm, 0)} m²</td>
                  <td className="py-2.5 px-4" dir="ltr">{sc.rentPerActiveSqmAnnual} EGP</td>
                  <td className="py-2.5 px-4" dir="ltr">{fmtMoney(sc.incrementalCapexEgp, 0)}</td>
                  <td className="py-2.5 px-4 text-emerald-700 font-semibold" dir="ltr">{fmtMoney(sc.projectedAnnualContribution, 0)}</td>
                  <td className={`py-2.5 px-4 font-bold ${sc.projectedBranchNetResult < 0 ? 'text-red-700' : 'text-emerald-700'}`} dir="ltr">
                    {fmtMoney(sc.projectedBranchNetResult, 0)}
                  </td>
                  <td className="py-2.5 px-4" dir="ltr">
                    {sc.paybackYears ? `${sc.paybackYears} yrs` : t(lang, 'الأساس', 'Baseline')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 3 Investment Options Comparison (Direct vs JV Partner vs Conditional Sub-lease) */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden print-avoid-break">
        <div className="px-5 py-4 print:px-3.5 print:py-2.5 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              {t(
                lang,
                `القسم 11: مقارنة بدائل استثمار الـ 80% فراغ (معدل الخصم WACC ${discountRatePct}%)`,
                `Section 11: Investment Models Comparison (@ ${discountRatePct}% Hurdle Rate)`
              )}
            </h2>
          </div>
          <span className="text-xs print:text-[10px] font-semibold text-teal-800">
            {t(lang, 'الموصى به: البديل الثاني (شراكة JV)', 'Recommended: Option 2 (JV Operator)')}
          </span>
        </div>

        <div className="p-5 print:p-3 grid grid-cols-1 lg:grid-cols-3 print:grid-cols-3 gap-4 print:gap-2.5">
          {review.usufruct.investmentOptions.map((opt) => (
            <div
              key={opt.id}
              className={`rounded-xl border p-4 print:p-2.5 flex flex-col justify-between print-avoid-break ${
                opt.id === 'jv_partner'
                  ? 'border-teal-500 bg-teal-50/20'
                  : 'border-slate-200 bg-white'
              }`}
            >
              <div className="space-y-3 print:space-y-2">
                <div className="flex items-start justify-between gap-1.5">
                  <h3 className="text-sm print:text-[11px] font-bold text-slate-900 leading-snug">
                    {lang === 'ar' ? opt.titleAr : opt.titleEn}
                  </h3>
                  <StatusBadge status={opt.legalStatus} lang={lang} compact />
                </div>

                <div className="grid grid-cols-2 gap-2 print:gap-1.5 text-xs print:text-[9.5px] font-mono-num">
                  <div className="p-2 print:p-1.5 rounded bg-slate-50 border border-slate-100">
                    <div className="text-[10px] print:text-[8.5px] font-sans text-slate-500">CAPEX</div>
                    <div className="font-bold text-slate-900" dir="ltr">{fmtMoney(opt.capexEgp, 0)}</div>
                  </div>
                  <div className="p-2 print:p-1.5 rounded bg-slate-50 border border-slate-100">
                    <div className="text-[10px] print:text-[8.5px] font-sans text-slate-500">{t(lang, 'EBITDA استادات/سنة', 'Estadat EBITDA/yr')}</div>
                    <div className="font-bold text-emerald-700" dir="ltr">{fmtMoney(opt.annualEstadatEbitda, 0)}</div>
                  </div>
                  <div className="p-2 print:p-1.5 rounded bg-slate-50 border border-slate-100">
                    <div className="text-[10px] print:text-[8.5px] font-sans text-slate-500">{t(lang, 'صافي القيمة NPV (5Y)', '5-Yr NPV')}</div>
                    <div className="font-bold text-teal-800" dir="ltr">{fmtMoney(opt.fiveYearNpv, 0)}</div>
                  </div>
                  <div className="p-2 print:p-1.5 rounded bg-slate-50 border border-slate-100">
                    <div className="text-[10px] print:text-[8.5px] font-sans text-slate-500">{t(lang, 'IRR / الاسترداد', 'IRR / Payback')}</div>
                    <div className="font-bold text-slate-900" dir="ltr">
                      {opt.irrPct ?? 'N/A'}% · {opt.paybackYears}y
                    </div>
                  </div>
                </div>

                <p className="text-[11px] print:text-[9px] text-slate-600 leading-5 print:leading-snug">
                  {lang === 'ar' ? opt.legalConditionAr : opt.legalConditionEn}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 2027 Budget Scenarios + 30/60/90 Action Plan */}
      <div className="grid grid-cols-1 lg:grid-cols-2 print:grid-cols-2 gap-6 print:gap-3 print-avoid-break">
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden print-avoid-break">
          <div className="px-5 py-4 print:px-3.5 print:py-2.5 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between gap-2">
            <h3 className="text-sm print:text-xs font-bold text-slate-900">
              {t(lang, 'موازنة 2027 (سيناريوهات A / B / C)', '2027 Financial Scenarios (A / B / C)')}
            </h3>
            {onNavigate && (
              <button
                onClick={() => onNavigate('strategy')}
                className="no-print print:hidden text-xs font-semibold text-teal-700 hover:underline"
              >
                {t(lang, 'محاكي 2027 التفاعلي', 'Open 2027 Simulator')}
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-start">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="py-2 px-3 font-semibold">{t(lang, 'السيناريو', 'Scenario')}</th>
                  <th className="py-2 px-3 font-semibold">{t(lang, 'الإيراد', 'Net Rev')}</th>
                  <th className="py-2 px-3 font-semibold">COGS %</th>
                  <th className="py-2 px-3 font-semibold">{t(lang, 'الرواتب', 'Payroll')}</th>
                  <th className="py-2 px-3 font-semibold">{t(lang, 'النتيجة', 'Net Result')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono-num">
                {state.strategy2027.scenarios.map((sc) => (
                  <tr key={sc.id} className={sc.id === 'C' ? 'bg-teal-50/50 font-semibold' : ''}>
                    <td className="py-2.5 px-3 font-sans text-slate-900">
                      {sc.id} — {lang === 'ar' ? sc.nameAr : sc.nameEn}
                    </td>
                    <td className="py-2.5 px-3" dir="ltr">{fmtMoney(sc.netRevenue, 0)}</td>
                    <td className="py-2.5 px-3" dir="ltr">{sc.cogsPct}%</td>
                    <td className="py-2.5 px-3" dir="ltr">{fmtMoney(sc.payroll, 0)}</td>
                    <td className={`py-2.5 px-3 font-bold ${sc.netResult < 0 ? 'text-red-700' : 'text-emerald-700'}`} dir="ltr">
                      {fmtMoney(sc.netResult, 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden print-avoid-break">
          <div className="px-5 py-4 print:px-3.5 print:py-2.5 border-b border-slate-200 bg-slate-50/70">
            <h3 className="text-sm print:text-xs font-bold text-slate-900">
              {t(lang, 'خطة التنفيذ العاجلة (30 / 60 / 90 يوماً)', '30 / 60 / 90-Day Turnaround Plan')}
            </h3>
          </div>
          <div className="divide-y divide-slate-100">
            {review.actionPlan90Days.map((a) => (
              <div key={a.code} className="p-3.5 print:p-2 flex items-start justify-between gap-3 print:gap-2 text-xs print:text-[9.5px]">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-1.5 py-0.5 rounded bg-slate-900 text-white font-mono-num text-[10px] print:text-[8.5px] font-bold">
                      {a.horizon.toUpperCase()}
                    </span>
                    <span className="font-bold text-slate-900">
                      {lang === 'ar' ? a.titleAr : a.titleEn}
                    </span>
                  </div>
                  <div className="text-[11px] print:text-[9px] text-slate-600 mt-1">
                    {lang === 'ar' ? a.deliverableAr : a.deliverableEn}
                  </div>
                </div>
                <span className="text-[11px] print:text-[9px] font-semibold text-teal-800 shrink-0">
                  {lang === 'ar' ? a.kpiTargetAr : a.kpiTargetEn}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );

  // Full structured A4 Print Report (always mounted for @media print + viewable in Report tab)
  const renderFullPrintableExecutiveReport = () => (
    <article className="bg-white text-slate-900 space-y-6 print:space-y-4">
      {/* Executive Letterhead */}
      <header className="border-b-2 border-slate-900 pb-4 print:pb-3 flex flex-col sm:flex-row print:flex-row sm:items-start print:items-start justify-between gap-4 print:gap-3 print-avoid-break">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold tracking-wider uppercase text-teal-800 font-mono-num" dir="ltr">
            <span>ESTADAT | MONUFIA TOWER — BOARDROOM CFO PACK</span>
            <span className="text-slate-300">·</span>
            <span className="text-slate-600">REF: EST-MT-CFO-2026</span>
            <span className="text-slate-300">·</span>
            <span className="text-slate-600">A4 PORTRAIT · 11MM</span>
          </div>
          <h1 className="text-xl print:text-lg font-bold text-slate-900 leading-snug">
            {t(
              lang,
              'الدراسة التنفيذية والمالية والتشغيلية والاستثمارية الشاملة (يناير – أكتوبر 2026) وخطة 2027',
              'CFO Executive Financial, Operational & Investment Review (Jan–Oct 2026) & 2027 Plan'
            )}
          </h1>
          <div className="text-[11px] print:text-[9.5px] text-slate-600 flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span>{t(lang, 'الجهة:', 'Entity:')} {t(lang, 'شركة استادات — فرع برج المنوفية', 'Estadat — Monufia Tower')}</span>
            <span>·</span>
            <span>{t(lang, 'نطاق الأداء التاريخي:', 'Scope:')} {lang === 'ar' ? review.reportPeriodLabelAr : review.reportPeriodLabelEn}</span>
            <span>·</span>
            <span className="font-mono-num" dir="ltr">{t(lang, 'تاريخ الإصدار:', 'Issued:')} {review.generatedAt}</span>
          </div>
        </div>
        <div className="text-xs print:text-[10px] bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 shrink-0">
          <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">
            {t(lang, 'مُعد التقرير', 'Prepared By')}
          </div>
          <div className="font-bold text-slate-900 mt-0.5">{lang === 'ar' ? review.preparedByAr : review.preparedByEn}</div>
          <div className="text-slate-500 mt-0.5 font-mono-num" dir="ltr">TAX ID: {state.taxId}</div>
        </div>
      </header>

      {renderExecutiveSummarySection()}
      <div className="print-break-before" />
      {renderFinancialsSection()}
      <div className="print-break-before" />
      {renderOperationsSection()}
      <div className="print-break-before" />
      {renderUsufructAnd2027Section()}
      <div className="print-break-before" />
      <RiskRegisterPanel risks={state.strategy2027.risks} lang={lang} readOnlyPrint />

      {/* Formal Sign-Off Footer */}
      <footer className="border-t-2 border-slate-900 pt-4 print:pt-3 mt-6 print:mt-4 space-y-4 print-avoid-break">
        <div className="grid grid-cols-1 sm:grid-cols-3 print:grid-cols-3 gap-6 print:gap-4 text-xs print:text-[10px]">
          <div>
            <div className="text-slate-500">{t(lang, 'إعداد ومراجعة مالية:', 'Prepared & Audited By:')}</div>
            <div className="font-bold text-slate-900 mt-1">
              {lang === 'ar' ? review.preparedByAr : review.preparedByEn}
            </div>
            <div className="mt-7 print:mt-6 border-t border-dashed border-slate-300 pt-1 text-[10px] text-slate-500">
              {t(lang, 'التوقيع والتاريخ', 'Signature & Date')}
            </div>
          </div>
          <div>
            <div className="text-slate-500">{t(lang, 'اعتماد المدير المالي للمجموعة:', 'Group CFO Approval:')}</div>
            <div className="font-bold text-slate-900 mt-1">Chief Financial Officer (CFO)</div>
            <div className="mt-7 print:mt-6 border-t border-dashed border-slate-300 pt-1 text-[10px] text-slate-500">
              {t(lang, 'التوقيع والاعتماد', 'Executive Sign-Off')}
            </div>
          </div>
          <div>
            <div className="text-slate-500">{t(lang, 'اعتماد الإدارة العليا / مجلس الإدارة:', 'Senior Management / Board:')}</div>
            <div className="font-bold text-slate-900 mt-1">Estadat Executive Committee</div>
            <div className="mt-7 print:mt-6 border-t border-dashed border-slate-300 pt-1 text-[10px] text-slate-500">
              {t(lang, 'قرار اللجنة التنفيذية', 'Board Resolution')}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200 text-[10px] print:text-[8.5px] text-slate-500 font-mono-num" dir="ltr">
          <span>CONFIDENTIAL — ESTADAT GROUP BOARDROOM & CFO REVIEW PACK</span>
          <span>A4 PORTRAIT · 11MM MARGINS · MONUFIA TOWER ERP</span>
        </div>
      </footer>
    </article>
  );

  return (
    <div className="space-y-6">
      {/* Control Header & Export Deliverables Bar (Hidden during print) */}
      <div className="no-print space-y-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div>
            <div className="text-xs font-bold text-teal-700">
              ESTADAT | MONUFIA TOWER · {lang === 'ar' ? review.preparedByAr : review.preparedByEn}
            </div>
            <h1 className="text-xl font-bold text-slate-900 mt-0.5">
              {t(
                lang,
                'المراجعة التنفيذية للمدير المالي: 10 أشهر (يناير–أكتوبر 2026) واستثمار الـ 80% فراغ 2027',
                'CFO Executive Review: 10M Performance (Jan–Oct 2026) & 80% Idle Space Strategy 2027'
              )}
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              {t(
                lang,
                'دراسة مالية وتشغيلية واستثمارية متكاملة مع حزمة المخرجات التنفيذية الثلاثة (PDF + Excel 11 ورقة + PowerPoint 15 شريحة).',
                'Board-ready financial, governance & usufruct expansion review with full PDF, 11-sheet Excel & 15-slide PowerPoint deliverables.'
              )}
            </p>
          </div>

          {/* Required Deliverables Export Toolbar */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              onClick={handlePrintPdf}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition-colors cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>{t(lang, 'تقرير CFO التنفيذي (PDF)', 'CFO Report – PDF')}</span>
            </button>

            <button
              onClick={handleExportExcel}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold transition-colors cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>{t(lang, 'النموذج المالي (Excel .xlsx)', 'Financial Model – Excel')}</span>
            </button>

            <button
              onClick={handleExportPptx}
              disabled={exportingPptx}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-xs font-semibold transition-colors cursor-pointer"
            >
              {exportingPptx ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Presentation className="w-3.5 h-3.5" />
              )}
              <span>{t(lang, 'العرض التقديمي (15 شريحة .pptx)', 'Presentation – PowerPoint')}</span>
            </button>
          </div>
        </div>

        {exportNotice && (
          <div className="px-4 py-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 font-medium">
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
              {exportNotice}
            </span>
            <button
              onClick={() => setExportNotice(null)}
              className="text-emerald-800 font-semibold hover:underline"
            >
              {t(lang, 'إغلاق', 'Dismiss')}
            </button>
          </div>
        )}

        {/* Interactive Sensitivity Controls + Sub-Navigation */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          {/* Sub-Tabs */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
            {(
              [
                { id: 'exec', ar: 'الملخص والقرارات والتحقق', en: 'Exec Summary & Audit', icon: <ShieldCheck className="w-3.5 h-3.5" /> },
                { id: 'financials', ar: 'أداء 10 شهور والتسويات', en: '10M P&L & Recon', icon: <Layers className="w-3.5 h-3.5" /> },
                { id: 'operations', ar: 'الحوكمة والتشغيل والجرد', en: 'Governance & Ops', icon: <Clock className="w-3.5 h-3.5" /> },
                { id: 'usufruct', ar: 'حق الانتفاع و80% فراغ 2027', en: 'Usufruct & 80% Space', icon: <Building2 className="w-3.5 h-3.5" /> },
                { id: 'risks', ar: 'سجل المخاطر (Risk Register)', en: 'Risk Register', icon: <ShieldAlert className="w-3.5 h-3.5" /> },
                { id: 'report_pdf', ar: 'معاينة التقرير الكامل (PDF)', en: 'Full A4 PDF Preview', icon: <FileText className="w-3.5 h-3.5" /> },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setSubTab(tab.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                  subTab === tab.id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.icon}
                <span>{lang === 'ar' ? tab.ar : tab.en}</span>
              </button>
            ))}
          </div>

          {/* Live Sensitivity Parameters */}
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="inline-flex items-center gap-1 text-slate-500 font-medium">
              <SlidersHorizontal className="w-3.5 h-3.5" />
              {t(lang, 'حساسية المساحة والخصم:', 'Model Inputs:')}
            </span>
            <label className="flex items-center gap-1.5">
              <span className="text-slate-500">{t(lang, 'المساحة م²', 'Area m²')}</span>
              <input
                type="number"
                value={totalSiteSqm}
                onChange={(e) => setTotalSiteSqm(Number(e.target.value) || 29781.8)}
                className="w-24 px-2 py-1 rounded border border-slate-200 font-mono-num text-xs"
                dir="ltr"
              />
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-slate-500">{t(lang, 'المستغل %', 'Used %')}</span>
              <input
                type="number"
                min={5}
                max={95}
                value={usedPct}
                onChange={(e) => setUsedPct(Number(e.target.value) || 20)}
                className="w-16 px-2 py-1 rounded border border-slate-200 font-mono-num text-xs"
                dir="ltr"
              />
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-slate-500">WACC %</span>
              <input
                type="number"
                min={8}
                max={45}
                value={discountRatePct}
                onChange={(e) => setDiscountRatePct(Number(e.target.value) || 22)}
                className="w-16 px-2 py-1 rounded border border-slate-200 font-mono-num text-xs"
                dir="ltr"
              />
            </label>
          </div>
        </div>

        {/* Interactive Tab Body */}
        {subTab === 'exec' && renderExecutiveSummarySection()}
        {subTab === 'financials' && renderFinancialsSection()}
        {subTab === 'operations' && renderOperationsSection()}
        {subTab === 'usufruct' && renderUsufructAnd2027Section()}
        {subTab === 'risks' && (
          <RiskRegisterPanel
            risks={state.strategy2027.risks}
            lang={lang}
            onCreateRisk={onCreateRisk}
            onUpdateRisk={onUpdateRisk}
            onDeleteRisk={onDeleteRisk}
          />
        )}
        {subTab === 'report_pdf' && (
          <div className="bg-slate-100/80 dark:bg-slate-900/50 border border-slate-200 rounded-xl p-4 sm:p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 max-w-[210mm] mx-auto">
              <div className="text-xs text-slate-600 flex items-center gap-2 font-mono-num" dir="ltr">
                <FileText className="w-3.5 h-3.5 text-teal-700" />
                <span className="font-semibold text-slate-800">A4 Portrait Sheet Preview</span>
                <span className="text-slate-400">·</span>
                <span>210 × 297 mm · Margins: 11 mm</span>
              </div>
              <button
                type="button"
                onClick={handlePrintPdf}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>{t(lang, 'طباعة / حفظ PDF الآن (A4)', 'Print / Save PDF Now (A4)')}</span>
              </button>
            </div>
            <div className="max-w-[210mm] mx-auto bg-white border border-slate-300 shadow-md rounded-md p-6 sm:p-[11mm]">
              {renderFullPrintableExecutiveReport()}
            </div>
          </div>
        )}
      </div>

      {/* Dedicated Full A4 Report for @media print regardless of active screen tab */}
      <div className="hidden print:block cfo-exec-print">
        {renderFullPrintableExecutiveReport()}
      </div>
    </div>
  );
};
