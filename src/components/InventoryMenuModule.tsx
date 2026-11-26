import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Download,
  FileSpreadsheet,
  Printer,
  Search,
  Trash2,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { ErpState, Ingredient, Language, WasteEntry } from '../types/erp';
import {
  calculateRecipeCost,
  computeAccountBalances,
  computeStocktakeVarianceAlerts,
  round2,
  runDataQualityChecks,
  suggestOptimalPriceGross,
} from '../utils/erpEngine';
import { fmtMoney, fmtPct, t } from '../utils/formatters';

interface InventoryMenuModuleProps {
  state: ErpState;
  lang: Language;
  onRecordWaste: (payload: { ingredientId: string; qty: number; reason: WasteEntry['reason'] }) => Promise<void>;
  onUpdateMenuPrice: (menuItemId: string, sellingPriceGross: number) => Promise<void>;
  onRecordStocktake?: (payload: {
    ingredientId: string;
    actualQty: number;
    locationAr?: string;
    notes?: string;
  }) => Promise<void>;
  onReconcileStocktake?: (stocktakeId: string) => Promise<void>;
  initialSubTab?: 'stock' | 'recipes' | 'waste' | 'stocktake';
  focusedStocktakeId?: string | null;
  onClearFocusStocktake?: () => void;
}

type WasteSortMode = 'wastePct' | 'monthlyCost' | 'monthlyWasteCost';

interface IngredientWasteMetric {
  ing: Ingredient;
  shortNameAr: string;
  shortNameEn: string;
  totalConsumedQty: number;
  wasteRatePct: number;
  monthlyAvgUsageCost: number;
  monthlyAvgWasteCost: number;
  totalWasteCost: number;
  potentialMonthlySaving: number;
  wasteSharePct: number;
  riskTier: 'critical' | 'watch' | 'optimal';
  recommendationAr: string;
  recommendationEn: string;
}

function getCategoryAction(category: string, wasteRatePct: number, targetPct: number, lang: Language): string {
  if (wasteRatePct <= targetPct) {
    return lang === 'ar'
      ? 'الأداء ضمن الحد المستهدف — حافظ على الجرد الدوري وضبط الحصص القياسية (BOM).'
      : 'Within target threshold — maintain scheduled counts and standard BOM portioning.';
  }
  switch (category) {
    case 'خضروات':
      return lang === 'ar'
        ? 'زيادة وتيرة التوريد اليومي لتقليل التخزين المفرط وتطبيق الفرز والتبريد الفوري (FIFO).'
        : 'Switch to higher-frequency fresh deliveries and enforce strict FIFO cold-room sorting.';
    case 'لحوم':
      return lang === 'ar'
        ? 'تغليف وتقسيم الحصص مسبقاً (Vacuum Portioning) ومراقبة حرارة الثلاجات 0–2°م.'
        : 'Enforce pre-shift vacuum portioning and continuous 0–2°C chiller monitoring.';
    case 'دهون وألبان':
      return lang === 'ar'
        ? 'تدوير المخزون وفق الأقدم انتهاءً (FEFO) وضبط معايرة السمن والجبن أثناء التحضير.'
        : 'Apply FEFO stock rotation and calibrate ghee/cheese scoops on prep stations.';
    case 'جافات':
      return lang === 'ar'
        ? 'تخزين محكم ضد الرطوبة لأصناف المكسرات عالية التكلفة ووزن الإضافات بالميزان الرقمي.'
        : 'Use airtight humidity-controlled bins for high-value nuts and digital scale dispensing.';
    case 'مشروبات':
      return lang === 'ar'
        ? 'تجهيز دفعات عصير أصغر حسب الذروة الزمنية ومعايرة أكواب البار لتقليل التبقي.'
        : 'Prep smaller peak-hour batches and standardize bar jiggers to curb end-of-shift loss.';
    default:
      return lang === 'ar'
        ? 'مراجعة معايير التحميل والتكلفة المعيارية لتقليل الفاقد التشغيلي.'
        : 'Review standard batch costing and operational yield calibration.';
  }
}

function abbreviateName(name: string, maxLen = 14): string {
  const clean = name.split('(')[0].trim();
  if (clean.length <= maxLen) return clean;
  const words = clean.split(/\s+/);
  if (words.length >= 2) {
    const two = `${words[0]} ${words[1]}`;
    if (two.length <= maxLen + 4) return two;
  }
  return `${clean.slice(0, maxLen)}…`;
}

export const InventoryMenuModule: React.FC<InventoryMenuModuleProps> = ({
  state,
  lang,
  onRecordWaste,
  onUpdateMenuPrice,
  onRecordStocktake,
  onReconcileStocktake,
  initialSubTab,
  focusedStocktakeId,
  onClearFocusStocktake,
}) => {
  const [subTab, setSubTab] = useState<'stock' | 'recipes' | 'waste' | 'stocktake'>(initialSubTab || 'stock');
  const [search, setSearch] = useState('');
  const [onlyLowStock, setOnlyLowStock] = useState(false);

  const [selectedMenuId, setSelectedMenuId] = useState<string>(state.menuItems[0]?.id || '');
  const [menuSearch, setMenuSearch] = useState<string>('');
  const [menuCatFilter, setMenuCatFilter] = useState<string>('all');
  const [menuListingFilter, setMenuListingFilter] = useState<'all' | 'manual' | 'unspecified'>('all');
  const [editingPrice, setEditingPrice] = useState<string>('');

  const [wasteIngId, setWasteIngId] = useState<string>(state.ingredients[0]?.id || '');
  const [wasteQty, setWasteQty] = useState<number>(2);
  const [wasteReason, setWasteReason] = useState<WasteEntry['reason']>('spoilage');

  // Stocktake physical count state
  const [stkIngId, setStkIngId] = useState<string>(state.ingredients[0]?.id || '');
  const [stkActualQty, setStkActualQty] = useState<string>(() =>
    String(state.ingredients[0]?.currentQty ?? 0)
  );
  const [stkLocationAr, setStkLocationAr] = useState<string>('ثلاجة اللحوم الرئيسية');
  const [stkNotes, setStkNotes] = useState<string>('');
  const [isSubmittingStocktake, setIsSubmittingStocktake] = useState(false);
  const [reconcilingId, setReconcilingId] = useState<string | null>(null);

  useEffect(() => {
    if (initialSubTab) {
      setSubTab(initialSubTab);
    }
  }, [initialSubTab]);

  useEffect(() => {
    if (focusedStocktakeId) {
      setSubTab('stocktake');
    }
  }, [focusedStocktakeId]);

  // Interactive Waste vs Monthly Cost Chart controls
  const [showChartPanel, setShowChartPanel] = useState(true);
  const [chartCategory, setChartCategory] = useState<string>('all');
  const [chartSort, setChartSort] = useState<WasteSortMode>('wastePct');
  const [targetWastePct, setTargetWastePct] = useState<number>(1.5);
  const [hoveredIngId, setHoveredIngId] = useState<string | null>(null);
  const [selectedChartIngId, setSelectedChartIngId] = useState<string>('ING-VEG');

  // Export states
  const [isExportingFull, setIsExportingFull] = useState(false);
  const [exportSuccessMsg, setExportSuccessMsg] = useState<string | null>(null);

  const operatingMonths = Math.max(1, state.monthlyActuals2026.length);

  const wasteAnalytics = useMemo<IngredientWasteMetric[]>(() => {
    const totalMonthlyWasteAll = state.ingredients.reduce(
      (sum, i) => sum + (i.wasteQty * i.weightedAvgCost) / operatingMonths,
      0
    );

    return state.ingredients.map((ing) => {
      const totalConsumedQty = round2(ing.issuedQty + ing.wasteQty);
      const wasteRatePct = totalConsumedQty > 0 ? round2((ing.wasteQty / totalConsumedQty) * 100) : 0;
      const monthlyAvgUsageCost = round2((totalConsumedQty * ing.weightedAvgCost) / operatingMonths);
      const totalWasteCost = round2(ing.wasteQty * ing.weightedAvgCost);
      const monthlyAvgWasteCost = round2(totalWasteCost / operatingMonths);
      const targetCapPct = Math.min(1.0, targetWastePct);
      const targetAllowedWasteCost = round2(monthlyAvgUsageCost * (targetCapPct / 100));
      const potentialMonthlySaving = round2(Math.max(0, monthlyAvgWasteCost - targetAllowedWasteCost));
      const wasteSharePct =
        totalMonthlyWasteAll > 0 ? round2((monthlyAvgWasteCost / totalMonthlyWasteAll) * 100) : 0;

      const riskTier: 'critical' | 'watch' | 'optimal' =
        wasteRatePct >= 2.0 ? 'critical' : wasteRatePct > targetWastePct ? 'watch' : 'optimal';

      return {
        ing,
        shortNameAr: abbreviateName(ing.nameAr, 14),
        shortNameEn: abbreviateName(ing.nameEn, 15),
        totalConsumedQty,
        wasteRatePct,
        monthlyAvgUsageCost,
        monthlyAvgWasteCost,
        totalWasteCost,
        potentialMonthlySaving,
        wasteSharePct,
        riskTier,
        recommendationAr: getCategoryAction(ing.category, wasteRatePct, targetWastePct, 'ar'),
        recommendationEn: getCategoryAction(ing.category, wasteRatePct, targetWastePct, 'en'),
      };
    });
  }, [state.ingredients, operatingMonths, targetWastePct]);

  const categories = useMemo(
    () => ['all', ...Array.from(new Set(state.ingredients.map((i) => i.category)))],
    [state.ingredients]
  );

  const chartItems = useMemo(() => {
    const filtered =
      chartCategory === 'all'
        ? wasteAnalytics
        : wasteAnalytics.filter((item) => item.ing.category === chartCategory);

    return [...filtered].sort((a, b) => {
      if (chartSort === 'monthlyCost') return b.monthlyAvgUsageCost - a.monthlyAvgUsageCost;
      if (chartSort === 'monthlyWasteCost') return b.monthlyAvgWasteCost - a.monthlyAvgWasteCost;
      return b.wasteRatePct - a.wasteRatePct;
    });
  }, [wasteAnalytics, chartCategory, chartSort]);

  const chartSummary = useMemo(() => {
    const totalMonthlyUsageCost = round2(
      chartItems.reduce((sum, item) => sum + item.monthlyAvgUsageCost, 0)
    );
    const totalMonthlyWasteCost = round2(
      chartItems.reduce((sum, item) => sum + item.monthlyAvgWasteCost, 0)
    );
    const totalPotentialSaving = round2(
      chartItems.reduce((sum, item) => sum + item.potentialMonthlySaving, 0)
    );
    const weightedWastePct =
      totalMonthlyUsageCost > 0 ? round2((totalMonthlyWasteCost / totalMonthlyUsageCost) * 100) : 0;
    const aboveTargetCount = chartItems.filter((item) => item.wasteRatePct > targetWastePct).length;

    const maxWastePct = Math.max(4, ...chartItems.map((i) => i.wasteRatePct * 1.15));
    const maxMonthlyCost = Math.max(1000, ...chartItems.map((i) => i.monthlyAvgUsageCost * 1.12));

    return {
      totalMonthlyUsageCost,
      totalMonthlyWasteCost,
      totalPotentialSaving,
      weightedWastePct,
      aboveTargetCount,
      maxWastePct,
      maxMonthlyCost,
    };
  }, [chartItems, targetWastePct]);

  const activeMetric = useMemo(() => {
    const targetId = hoveredIngId || selectedChartIngId;
    return chartItems.find((i) => i.ing.id === targetId) || chartItems[0] || wasteAnalytics[0];
  }, [chartItems, hoveredIngId, selectedChartIngId, wasteAnalytics]);

  const filteredIngredients = useMemo(() => {
    return state.ingredients.filter((i) => {
      if (onlyLowStock && i.currentQty > i.reorderLevel) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        i.nameAr.toLowerCase().includes(q) ||
        i.nameEn.toLowerCase().includes(q) ||
        i.sku.toLowerCase().includes(q)
      );
    });
  }, [state.ingredients, search, onlyLowStock]);

  const totalInventoryVal = useMemo(
    () => round2(state.ingredients.reduce((sum, i) => sum + i.currentQty * i.weightedAvgCost, 0)),
    [state.ingredients]
  );

  const menuCategories = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of state.menuItems) {
      const cat = lang === 'ar' ? m.categoryAr : m.categoryEn;
      map.set(cat, (map.get(cat) || 0) + 1);
    }
    return Array.from(map.entries());
  }, [state.menuItems, lang]);

  const filteredMenuItems = useMemo(() => {
    const q = menuSearch.trim().toLowerCase();
    return state.menuItems.filter((m) => {
      if (menuCatFilter !== 'all' && (lang === 'ar' ? m.categoryAr : m.categoryEn) !== menuCatFilter) {
        return false;
      }
      if (menuListingFilter === 'manual' && m.listingType !== 'إضافة يدوية' && m.listingType !== 'مطبوع / إضافة') {
        return false;
      }
      if (menuListingFilter === 'unspecified' && m.sellingPriceGross > 0 && m.priceStatus !== 'unspecified') {
        return false;
      }
      if (!q) return true;
      return (
        m.nameAr.toLowerCase().includes(q) ||
        m.nameEn.toLowerCase().includes(q) ||
        (m.descriptionAr || '').toLowerCase().includes(q) ||
        m.code.toLowerCase().includes(q) ||
        String(m.menuNo || '').includes(q)
      );
    });
  }, [state.menuItems, menuSearch, menuCatFilter, menuListingFilter, lang]);

  const selectedMenu = state.menuItems.find((m) => m.id === selectedMenuId) || filteredMenuItems[0] || state.menuItems[0];

  const stocktakeSummary = useMemo(() => computeStocktakeVarianceAlerts(state, 2), [state]);
  const selectedStkIng = useMemo(
    () => state.ingredients.find((i) => i.id === stkIngId) || state.ingredients[0],
    [state.ingredients, stkIngId]
  );

  const previewStocktakeVariance = useMemo(() => {
    if (!selectedStkIng) return { bookQty: 0, actualQty: 0, diffQty: 0, diffPct: 0, diffValue: 0 };
    const bookQty = round2(selectedStkIng.currentQty);
    const actualQty = round2(Math.max(0, Number(stkActualQty) || 0));
    const diffQty = round2(actualQty - bookQty);
    const diffPct = bookQty > 0 ? round2((diffQty / bookQty) * 100) : 0;
    const diffValue = round2(diffQty * selectedStkIng.weightedAvgCost);
    return { bookQty, actualQty, diffQty, diffPct, diffValue };
  }, [selectedStkIng, stkActualQty]);

  const handleStocktakeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onRecordStocktake || !stkIngId) return;
    const numericActual = Number(stkActualQty);
    if (!Number.isFinite(numericActual) || numericActual < 0) return;
    setIsSubmittingStocktake(true);
    try {
      await onRecordStocktake({
        ingredientId: stkIngId,
        actualQty: numericActual,
        locationAr: stkLocationAr,
        notes: stkNotes,
      });
      setStkNotes('');
      setExportSuccessMsg(
        t(lang, 'تم تسجيل محضر الجرد الفعلي ومطابقته مع الدفتر بنجاح', 'Physical stocktake count recorded')
      );
      setTimeout(() => setExportSuccessMsg(null), 4000);
    } finally {
      setIsSubmittingStocktake(false);
    }
  };

  const handleReconcileRow = async (stocktakeId: string) => {
    if (!onReconcileStocktake) return;
    setReconcilingId(stocktakeId);
    try {
      await onReconcileStocktake(stocktakeId);
      onClearFocusStocktake?.();
      setExportSuccessMsg(
        t(
          lang,
          'تم اعتماد تسوية فارق الجرد وتحديث الرصيد الدفتري وقيد اليومية (5305 ↔ 1201)',
          'Stocktake discrepancy reconciled and GL journal posted (5305 <-> 1201)'
        )
      );
      setTimeout(() => setExportSuccessMsg(null), 4500);
    } finally {
      setReconcilingId(null);
    }
  };

  const handleWasteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wasteIngId || wasteQty <= 0) return;
    await onRecordWaste({ ingredientId: wasteIngId, qty: wasteQty, reason: wasteReason });
    setWasteQty(1);
  };

  const handleJumpToLogWaste = (ingredientId: string) => {
    setWasteIngId(ingredientId);
    setSubTab('waste');
  };

  const handleExportWasteCsv = () => {
    const headers = [
      'SKU',
      'Ingredient_AR',
      'Ingredient_EN',
      'Category',
      'Unit',
      'Issued_Qty',
      'Waste_Qty',
      'Waste_Rate_Pct',
      'WAC_EGP',
      'Monthly_Avg_Cost_EGP',
      'Monthly_Waste_Cost_EGP',
      'Total_Waste_Cost_EGP',
      'Potential_Monthly_Saving_EGP',
      'Current_Qty',
      'Stock_Value_EGP',
    ];
    const lines = [
      headers.join(','),
      ...chartItems.map((m) =>
        [
          m.ing.sku,
          `"${m.ing.nameAr.replace(/"/g, '""')}"`,
          `"${m.ing.nameEn.replace(/"/g, '""')}"`,
          `"${m.ing.category}"`,
          m.ing.unit,
          m.ing.issuedQty,
          m.ing.wasteQty,
          m.wasteRatePct,
          m.ing.weightedAvgCost,
          m.monthlyAvgUsageCost,
          m.monthlyAvgWasteCost,
          m.totalWasteCost,
          m.potentialMonthlySaving,
          m.ing.currentQty,
          round2(m.ing.currentQty * m.ing.weightedAvgCost),
        ].join(',')
      ),
    ];

    const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Estadat_Waste_vs_MonthlyCost_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setExportSuccessMsg(t(lang, 'تم تصدير ملف تحليل الهالك (CSV)', 'Waste analysis CSV downloaded'));
    setTimeout(() => setExportSuccessMsg(null), 3500);
  };

  const handleExportAllData = async () => {
    setIsExportingFull(true);
    setExportSuccessMsg(null);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();
      const balances = computeAccountBalances(state);
      const dq = runDataQualityChecks(state);

      // 1. EXECUTIVE SUMMARY
      const summaryRows = [
        [state.companyNameAr, state.companyNameEn],
        [t(lang, 'الرقم الضريبي', 'Tax ID'), state.taxId],
        [t(lang, 'تاريخ التقرير', 'Report Date'), state.reportDate],
        [t(lang, 'نسبة الضريبة', 'VAT Rate'), `${(state.vatRate * 100).toFixed(0)}%`],
        [t(lang, 'إجمالي قيمة المخزون الحالي', 'Current Inventory Valuation'), totalInventoryVal],
        [t(lang, 'متوسط التكلفة الشهرية للخامات', 'Monthly Avg Ingredient Cost'), chartSummary.totalMonthlyUsageCost],
        [t(lang, 'متوسط خسارة الهالك الشهرية', 'Monthly Avg Waste Cost'), chartSummary.totalMonthlyWasteCost],
        [t(lang, 'الوفورات الشهرية المستهدفة (عند ≤1%)', 'Target Monthly Savings (≤1%)'), chartSummary.totalPotentialSaving],
        [t(lang, 'رصيد بنك CIB (1102)', 'CIB Balance (1102)'), balances['1102'] ?? 0],
        [t(lang, 'الخزينة الرئيسية (1101)', 'Main Vault (1101)'), balances['1101'] ?? 0],
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), '01_EXECUTIVE_SUMMARY');

      // 2. WASTE VS MONTHLY COST ANALYTICS
      const wasteAnalysisRows = wasteAnalytics.map((m) => ({
        'الكود SKU': m.ing.sku,
        'اسم الصنف': m.ing.nameAr,
        'Ingredient': m.ing.nameEn,
        'التصنيف': m.ing.category,
        'الوحدة': m.ing.unit,
        'إجمالي المنصرف والتالف': m.totalConsumedQty,
        'كمية الهالك': m.ing.wasteQty,
        'نسبة الهالك %': m.wasteRatePct,
        'متوسط التكلفة WAC': m.ing.weightedAvgCost,
        'متوسط التكلفة الشهرية (ج.م)': m.monthlyAvgUsageCost,
        'متوسط خسارة الهالك الشهرية (ج.م)': m.monthlyAvgWasteCost,
        'إجمالي تكلفة الهالك (ج.م)': m.totalWasteCost,
        'حصة الصنف من الهالك %': m.wasteSharePct,
        'وفورات شهرية مستهدفة (ج.م)': m.potentialMonthlySaving,
        'مستوى الخطورة': m.riskTier,
        'التوصية التشغيلية': lang === 'ar' ? m.recommendationAr : m.recommendationEn,
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(wasteAnalysisRows), '02_WASTE_VS_COST');

      // 3. RAW INVENTORY STOCK
      const ingRows = state.ingredients.map((i) => ({
        'كود الصنف': i.sku,
        'الصنف الخام': i.nameAr,
        'Name EN': i.nameEn,
        'التصنيف': i.category,
        'الوحدة': i.unit,
        'الافتتاحي': i.openingQty,
        'المشتريات': i.purchasedQty,
        'المنصرف BOM': i.issuedQty,
        'الهالك': i.wasteQty,
        'الرصيد الحالي': i.currentQty,
        'المتوسط المرجح WAC': i.weightedAvgCost,
        'القيمة الدفترية (ج.م)': round2(i.currentQty * i.weightedAvgCost),
        'حد إعادة الطلب': i.reorderLevel,
        'آخر سعر شراء': i.lastPurchasePrice,
        'الحالة': i.currentQty <= i.reorderLevel ? 'تحت حد الطلب' : 'آمن',
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ingRows), '03_RAW_INVENTORY');

      // 4. WASTE REGISTER
      const wasteLogRows = state.wasteEntries.map((w) => ({
        'رقم المستند': w.wasteNo,
        'التاريخ': w.date,
        'كود الصنف': w.ingredientId,
        'الصنف': w.ingredientNameAr,
        'السبب': w.reason,
        'الكمية': w.qty,
        'تكلفة الوحدة': w.unitCost,
        'الإجمالي (ج.م)': w.totalValue,
        'رقم القيد': w.journalId,
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(wasteLogRows), '04_WASTE_LOG');

      // 5. MENU ENGINEERING & BOM RECIPES
      const menuRows = state.menuItems.map((m) => {
        const cost = calculateRecipeCost(m, state.ingredients);
        const netPrice = m.sellingPriceGross > 0 ? round2(m.sellingPriceGross / (1 + state.vatRate)) : 0;
        const fcPct = netPrice > 0 ? round2((cost / netPrice) * 100) : 0;
        return {
          'م': m.menuNo ?? '',
          'كود': m.code,
          'الصنف': m.nameAr,
          'Item EN': m.nameEn,
          'الوصف / التفاصيل': m.descriptionAr || '',
          'القسم': m.categoryAr,
          'نوع الإدراج': m.listingType || 'مطبوع',
          'محطة التحضير': m.station,
          'السعر الأساسي (ج)': m.basePrice ?? 'غير محدد',
          'شامل 12% خدمة (ج)': m.priceInclService ?? 'غير محدد',
          'سعر البيع شامل الضريبة': m.sellingPriceGross,
          'السعر الصافي': netPrice,
          'تكلفة الوصفة BOM': cost,
          'Food Cost %': m.sellingPriceGross > 0 ? fcPct : 'غير محدد',
          'الهدف %': m.targetFoodCostPct,
          'الربح/وحدة': m.sellingPriceGross > 0 ? round2(netPrice - cost) : 0,
          'السعر المقترح': suggestOptimalPriceGross(cost, m.targetFoodCostPct, state.vatRate),
          'المبيعات (وحدة)': m.q1UnitsSold,
        };
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(menuRows), '05_MENU_ENGINEERING');

      const bomRows = state.menuItems.flatMap((m) =>
        m.recipe.map((line) => {
          const ing = state.ingredients.find((i) => i.id === line.ingredientId);
          const lineCost = ing ? round2(line.qty * (1 + line.wastePct / 100) * ing.weightedAvgCost) : 0;
          return {
            'كود الوجبة': m.code,
            'اسم الوجبة': m.nameAr,
            'كود الخامة': ing?.sku ?? line.ingredientId,
            'اسم الخامة': ing?.nameAr ?? line.ingredientId,
            'الكمية': line.qty,
            'الوحدة': ing?.unit ?? '',
            'نسبة الهالك %': line.wastePct,
            'تكلفة السطر (ج.م)': lineCost,
          };
        })
      );
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(bomRows), '06_BOM_RECIPES');

      // 7. SUPPLIERS & CUSTOMERS
      const supplierRows = state.suppliers.map((s) => ({
        'الكود': s.id,
        'المورد': s.nameAr,
        'الرقم الضريبي': s.taxNumber,
        'الهاتف': s.phone,
        'شروط السداد (يوم)': s.paymentTermsDays,
        '0-30 يوم': s.aging0_30,
        '31-60 يوم': s.aging31_60,
        '61-90+ يوم': s.aging61_90Plus,
        'التقييم': s.rating,
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(supplierRows), '07_SUPPLIERS');

      const customerRows = (state.customers ?? []).map((c) => ({
        'الكود': c.code,
        'العميل': c.nameAr,
        'الشريحة': c.segment,
        'المدينة': c.city,
        'الهاتف': c.phone,
        'الحد الائتماني': c.creditLimit,
        'الرصيد الحالي': c.currentBalance,
        'إجمالي الطلبات': c.totalOrders,
        'إجمالي المشتريات': c.totalSpent,
        'نقاط الولاء': c.loyaltyPoints,
      }));
      if (customerRows.length > 0) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(customerRows), '08_CUSTOMERS');
      }

      // 9. PURCHASES & SALES
      const purchaseRows = state.purchaseInvoices.map((p) => ({
        'رقم فاتورة الشراء': p.purchaseNo,
        'التاريخ': p.date,
        'المورد': p.supplierNameAr,
        'حالة الدفع': p.paymentStatus,
        'قبل الضريبة': p.totalBeforeTax,
        'ضريبة المدخلات': p.vatAmount,
        'الإجمالي': p.grandTotal,
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(purchaseRows), '09_PURCHASES');

      const salesRows = state.salesInvoices.map((s) => ({
        'رقم الفاتورة': s.invoiceNo,
        'التاريخ': s.date,
        'الوقت': s.time,
        'النوع': s.orderType,
        'الدفع': s.paymentMethod,
        'الإجمالي شامل الضريبة': s.grossTotal,
        'صافي المبيعات': s.netSales,
        'ضريبة 14%': s.vatAmount,
        'التكلفة COGS': s.cogsTotal,
        'حالة ETA': s.etaStatus,
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(salesRows), '10_SALES_INVOICES');

      // 11. CHART OF ACCOUNTS & JOURNALS
      const coaRows = state.accounts.map((a) => ({
        'كود الحساب': a.code,
        'اسم الحساب': a.nameAr,
        'Account EN': a.nameEn,
        'النوع': a.type,
        'الرصيد الحالي': balances[a.code] ?? 0,
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(coaRows), '11_ACCOUNTS');

      const journalRows = state.journalEntries.flatMap((j) =>
        j.lines.map((l) => ({
          'رقم القيد': j.journalNo,
          'التاريخ': j.date,
          'المصدر': j.source,
          'المرجع': j.referenceNo,
          'كود الحساب': l.accountCode,
          'الحساب': l.accountNameAr,
          'البيان': l.description,
          'مدين': l.debit,
          'دائن': l.credit,
        }))
      );
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(journalRows), '12_JOURNAL_LINES');

      // 13. 9M P&L & STRATEGY & DATA QUALITY
      const plRows = state.monthlyActuals2026.map((m) => ({
        'الشهر': m.labelAr,
        'الإيراد الإجمالي': m.grossRevenue,
        'صافي الإيراد': m.netRevenue,
        'COGS': m.cogs,
        'مجمل الربح': m.grossProfit,
        'الرواتب والمنح': m.payroll,
        'حق الانتفاع': m.usufructRent,
        'صافي النتيجة': m.netProfit,
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(plRows), '13_9M_PL_ACTUALS');

      const dqRows = dq.map((c) => ({
        'الكود': c.code,
        'الفحص': c.titleAr,
        'الحالة': c.status,
        'القيمة': c.metricValue,
        'التفاصيل': c.detailAr,
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dqRows), '14_DATA_QUALITY');

      XLSX.writeFile(
        wb,
        `Estadat_AlBorg_Full_ERP_Inventory_Export_${new Date().toISOString().slice(0, 10)}.xlsx`
      );
      setExportSuccessMsg(
        t(
          lang,
          'تم تصدير جميع بيانات النظام (14 ورقة عمل Excel) بنجاح',
          'Full ERP & Inventory data exported (14 Excel sheets)'
        )
      );
      setTimeout(() => setExportSuccessMsg(null), 4000);
    } finally {
      setIsExportingFull(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Module Header, Full Export CTA & Sub-Navigation */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">
            {t(lang, 'إدارة المخزون والوصفات وهندسة المنيو (BOM)', 'Inventory, BOM Recipes & Menu Engineering')}
          </h1>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 flex flex-wrap items-center gap-2">
            <span>{t(lang, 'تقييم المخزون: المتوسط المرجح (WAC)', 'Valuation: Weighted Average Cost (WAC)')}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-num font-semibold text-slate-800 dark:text-slate-200" dir="ltr">
              {t(lang, 'القيمة الإجمالية:', 'Total Stock Value:')} {fmtMoney(totalInventoryVal, 0)} {t(lang, 'ج.م', 'EGP')}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 no-print">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>{t(lang, 'طباعة التقرير', 'Print')}</span>
          </button>

          <button
            type="button"
            onClick={handleExportAllData}
            disabled={isExportingFull}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>
              {isExportingFull
                ? t(lang, 'جاري التصدير...', 'Exporting...')
                : t(lang, 'تصدير البيانات بالكامل (Excel)', 'Export Full Data (Excel)')}
            </span>
          </button>

          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg overflow-x-auto">
            {(
              [
                { id: 'stock', ar: 'رصيد الخامات والتنبيهات', en: 'Raw Stock & Alerts' },
                { id: 'stocktake', ar: `الجرد الفعلي والتسوية (${stocktakeSummary.pendingExceedingCount})`, en: `Stocktake & Recon (${stocktakeSummary.pendingExceedingCount})` },
                { id: 'recipes', ar: 'الوصفات وهندسة المنيو', en: 'Recipes & Menu Pricing' },
                { id: 'waste', ar: 'تسجيل الهالك والتالف', en: 'Waste & Spoilage' },
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

      {exportSuccessMsg && (
        <div className="bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 px-4 py-2.5 rounded-lg text-xs font-medium flex items-center justify-between">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            {exportSuccessMsg}
          </span>
          <span className="font-mono-num text-[11px]" dir="ltr">
            {new Date().toLocaleTimeString()}
          </span>
        </div>
      )}

      {/* INTERACTIVE BAR CHART: WASTE % VS MONTHLY AVERAGE COST */}
      {(subTab === 'stock' || subTab === 'waste') && (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-teal-700 dark:text-teal-400" />
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {t(
                    lang,
                    'مقارنة نسبة الهالك (%) بمتوسط التكلفة الشهرية للأصناف — لوحة تقليل الهدر',
                    'Waste Rate (%) vs. Monthly Average Cost — Waste Reduction Analytics'
                  )}
                </h2>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {t(
                  lang,
                  `متوسط تكلفة ${operatingMonths} أشهر فعلية (يناير–سبتمبر 2026) · مرر المؤشر أو انقر على أي عمود لتحليل الوفورات`,
                  `${operatingMonths}-month actual run-rate (Jan–Sep 2026) · Hover or click any bar to inspect savings`
                )}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleExportWasteCsv}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{t(lang, 'تصدير تحليل الهالك (.csv)', 'Export Waste CSV')}</span>
              </button>

              <button
                type="button"
                onClick={() => setShowChartPanel(!showChartPanel)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs whitespace-nowrap shrink-0 cursor-pointer"
                aria-expanded={showChartPanel}
              >
                {showChartPanel ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                <span>{showChartPanel ? t(lang, 'طي الرسم', 'Collapse') : t(lang, 'عرض الرسم', 'Expand')}</span>
              </button>
            </div>
          </div>

          {showChartPanel && (
            <div className="p-5 space-y-5">
              {/* Top 4 Quantitative Summary Metrics */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700/80">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    {t(lang, 'متوسط تكلفة الخامات شهرياً', 'Monthly Avg Ingredient Cost')}
                  </div>
                  <div className="text-base font-bold text-slate-900 dark:text-slate-100 font-mono-num mt-1" dir="ltr">
                    {fmtMoney(chartSummary.totalMonthlyUsageCost, 0)}{' '}
                    <span className="text-xs font-normal text-slate-500">{t(lang, 'ج.م/شهر', 'EGP/mo')}</span>
                  </div>
                </div>

                <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700/80">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    {t(lang, 'متوسط نسبة الهالك المرجحة', 'Weighted Waste Rate')}
                  </div>
                  <div className="text-base font-bold text-amber-600 dark:text-amber-400 font-mono-num mt-1" dir="ltr">
                    {fmtPct(chartSummary.weightedWastePct, 2)}
                    <span className="text-[11px] font-normal text-slate-500 ms-2">
                      ({chartSummary.aboveTargetCount} {t(lang, 'تجاوز الحد', 'above cap')})
                    </span>
                  </div>
                </div>

                <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700/80">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    {t(lang, 'خسارة الهالك الشهرية المقدرة', 'Monthly Avg Waste Loss')}
                  </div>
                  <div className="text-base font-bold text-red-600 dark:text-red-400 font-mono-num mt-1" dir="ltr">
                    {fmtMoney(chartSummary.totalMonthlyWasteCost, 0)}{' '}
                    <span className="text-xs font-normal text-slate-500">{t(lang, 'ج.م/شهر', 'EGP/mo')}</span>
                  </div>
                </div>

                <div className="p-3.5 rounded-lg bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/70">
                  <div className="text-[11px] text-emerald-800 dark:text-emerald-300">
                    {t(lang, 'وفورات شهرية متوقعة (هدف ≤1%)', 'Est. Monthly Savings (at ≤1%)')}
                  </div>
                  <div className="text-base font-bold text-emerald-700 dark:text-emerald-300 font-mono-num mt-1" dir="ltr">
                    +{fmtMoney(chartSummary.totalPotentialSaving, 0)}{' '}
                    <span className="text-xs font-normal">{t(lang, 'ج.م/شهر', 'EGP/mo')}</span>
                  </div>
                </div>
              </div>

              {/* Controls: Category Filter, Sort Mode & Target Benchmark */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setChartCategory(cat)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                        chartCategory === cat
                          ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                          : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      {cat === 'all' ? t(lang, 'كل التصنيفات', 'All Categories') : cat}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
                    {(
                      [
                        { id: 'wastePct', ar: 'ترتيب: نسبة الهالك %', en: 'Sort: Waste %' },
                        { id: 'monthlyCost', ar: 'ترتيب: التكلفة الشهرية', en: 'Sort: Monthly Cost' },
                        { id: 'monthlyWasteCost', ar: 'ترتيب: خسارة الهالك ج.م', en: 'Sort: Waste Loss EGP' },
                      ] as const
                    ).map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setChartSort(s.id)}
                        className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                          chartSort === s.id
                            ? 'bg-teal-700 text-white'
                            : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        {lang === 'ar' ? s.ar : s.en}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg text-xs">
                    <span className="px-2 text-slate-500 dark:text-slate-400">
                      {t(lang, 'سقف الهالك:', 'Cap:')}
                    </span>
                    {[1.0, 1.5, 2.0].map((cap) => (
                      <button
                        key={cap}
                        type="button"
                        onClick={() => setTargetWastePct(cap)}
                        className={`px-2 py-1 rounded-md font-mono-num font-semibold cursor-pointer ${
                          targetWastePct === cap
                            ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                            : 'text-slate-600 dark:text-slate-300'
                        }`}
                        dir="ltr"
                      >
                        {cap.toFixed(1)}%
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Dual-Bar Interactive Chart + Actionable Decision Panel */}
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-stretch">
                {/* Interactive Bar Chart Canvas */}
                <div className="xl:col-span-8 border border-slate-200 dark:border-slate-800 rounded-xl p-4 bg-slate-50/40 dark:bg-slate-950/40 flex flex-col justify-between">
                  {/* Legend */}
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-4 text-xs">
                    <div className="flex flex-wrap items-center gap-4">
                      <span className="inline-flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                        <span className="w-3 h-3 rounded-xs bg-red-600 dark:bg-red-500 inline-block" />
                        <span>{t(lang, 'نسبة هالك حرجة (≥ 2.0%)', 'Critical Waste (≥ 2.0%)')}</span>
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                        <span className="w-3 h-3 rounded-xs bg-amber-500 inline-block" />
                        <span>{t(lang, 'فوق الحد المستهدف', 'Above Cap')}</span>
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                        <span className="w-3 h-3 rounded-xs bg-emerald-600 dark:bg-emerald-500 inline-block" />
                        <span>{t(lang, 'هالك آمن', 'Optimal Waste')}</span>
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                        <span className="w-3 h-3 rounded-xs bg-teal-700 dark:bg-teal-500 inline-block" />
                        <span>{t(lang, 'متوسط التكلفة الشهرية (ج.م/شهر)', 'Monthly Avg Cost (EGP/mo)')}</span>
                      </span>
                    </div>

                    <div className="font-mono-num text-[11px] text-slate-500 dark:text-slate-400" dir="ltr">
                      {t(lang, 'الحد المستهدف:', 'Target Cap:')} {targetWastePct.toFixed(1)}%
                    </div>
                  </div>

                  {chartItems.length === 0 ? (
                    <div className="py-16 text-center text-xs text-slate-500 dark:text-slate-400">
                      {t(lang, 'لا توجد أصناف مطابقة لهذا التصنيف.', 'No ingredients match this category.')}
                    </div>
                  ) : (
                    <div className="overflow-x-auto pb-1">
                      <div
                        className="relative pt-7 pb-2 px-2"
                        style={{ minWidth: Math.max(640, chartItems.length * 64) }}
                      >
                        {/* Horizontal Background Reference Gridlines */}
                        <div className="relative h-64 border-b border-slate-300 dark:border-slate-700 flex items-end gap-2">
                          {[0.25, 0.5, 0.75, 1].map((step) => (
                            <div
                              key={step}
                              className="absolute inset-x-0 border-t border-dashed border-slate-200 dark:border-slate-800 pointer-events-none"
                              style={{ bottom: `${step * 100}%` }}
                            >
                              <span
                                className="absolute -top-2.5 start-0 text-[10px] font-mono-num text-slate-400 dark:text-slate-500 bg-white/80 dark:bg-slate-900/80 px-1"
                                dir="ltr"
                              >
                                {(chartSummary.maxWastePct * step).toFixed(1)}%
                              </span>
                              <span
                                className="absolute -top-2.5 end-0 text-[10px] font-mono-num text-teal-700/70 dark:text-teal-400/70 bg-white/80 dark:bg-slate-900/80 px-1"
                                dir="ltr"
                              >
                                {fmtMoney(Math.round((chartSummary.maxMonthlyCost * step) / 1000), 0)}k EGP
                              </span>
                            </div>
                          ))}

                          {/* Target Waste Cap Line */}
                          <div
                            className="absolute inset-x-0 border-t-2 border-dashed border-amber-500/80 dark:border-amber-400/70 pointer-events-none z-10"
                            style={{
                              bottom: `${Math.min(100, (targetWastePct / chartSummary.maxWastePct) * 100)}%`,
                            }}
                          >
                            <span
                              className="absolute -top-4 end-12 px-1.5 py-0.5 text-[10px] font-semibold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 rounded"
                              dir="ltr"
                            >
                              {t(lang, `سقف ${targetWastePct.toFixed(1)}%`, `Cap ${targetWastePct.toFixed(1)}%`)}
                            </span>
                          </div>

                          {/* Grouped Bars */}
                          {chartItems.map((item) => {
                            const wasteHeightPct = Math.max(
                              4,
                              Math.min(100, (item.wasteRatePct / chartSummary.maxWastePct) * 100)
                            );
                            const costHeightPct = Math.max(
                              4,
                              Math.min(100, (item.monthlyAvgUsageCost / chartSummary.maxMonthlyCost) * 100)
                            );
                            const isSelected = activeMetric?.ing.id === item.ing.id;
                            const isHovered = hoveredIngId === item.ing.id;

                            const wasteBarColor =
                              item.riskTier === 'critical'
                                ? 'bg-red-600 dark:bg-red-500'
                                : item.riskTier === 'watch'
                                ? 'bg-amber-500 dark:bg-amber-400'
                                : 'bg-emerald-600 dark:bg-emerald-500';

                            return (
                              <button
                                key={item.ing.id}
                                type="button"
                                onMouseEnter={() => setHoveredIngId(item.ing.id)}
                                onMouseLeave={() => setHoveredIngId(null)}
                                onFocus={() => setHoveredIngId(item.ing.id)}
                                onBlur={() => setHoveredIngId(null)}
                                onClick={() => setSelectedChartIngId(item.ing.id)}
                                aria-label={`${lang === 'ar' ? item.ing.nameAr : item.ing.nameEn} - ${item.wasteRatePct}%`}
                                className={`group relative flex-1 h-full flex flex-col justify-end items-center px-1 rounded-t-lg transition-colors cursor-pointer focus:outline-none ${
                                  isSelected
                                    ? 'bg-slate-200/70 dark:bg-slate-800/80 ring-1 ring-teal-600/50'
                                    : 'hover:bg-slate-100 dark:hover:bg-slate-800/50'
                                }`}
                              >
                                {/* Value Callouts on Hover / Active */}
                                <div
                                  className={`absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono-num text-[10px] font-bold transition-opacity z-20 px-1.5 py-0.5 rounded bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 ${
                                    isHovered || isSelected ? 'opacity-100' : 'opacity-0 pointer-events-none'
                                  }`}
                                  dir="ltr"
                                >
                                  {item.wasteRatePct.toFixed(2)}% · {fmtMoney(Math.round(item.monthlyAvgUsageCost / 1000), 1)}k
                                </div>

                                <div className="w-full h-full flex items-end justify-center gap-1 px-0.5">
                                  {/* Bar 1: Waste Rate % */}
                                  <div
                                    className={`w-3.5 sm:w-4 rounded-t transition-transform duration-150 ${wasteBarColor} ${
                                      isSelected || isHovered ? 'scale-y-[1.02] brightness-110' : ''
                                    }`}
                                    style={{ height: `${wasteHeightPct}%` }}
                                    title={`${t(lang, 'نسبة الهالك', 'Waste %')}: ${item.wasteRatePct}%`}
                                  />
                                  {/* Bar 2: Monthly Avg Cost EGP */}
                                  <div
                                    className={`w-3.5 sm:w-4 rounded-t bg-teal-700 dark:bg-teal-500 transition-transform duration-150 ${
                                      isSelected || isHovered ? 'scale-y-[1.02] brightness-110' : ''
                                    }`}
                                    style={{ height: `${costHeightPct}%` }}
                                    title={`${t(lang, 'متوسط التكلفة الشهرية', 'Monthly Cost')}: ${fmtMoney(item.monthlyAvgUsageCost, 0)}`}
                                  />
                                </div>
                              </button>
                            );
                          })}
                        </div>

                        {/* X-Axis Labels Row */}
                        <div className="flex items-start gap-2 mt-2">
                          {chartItems.map((item) => {
                            const isSelected = activeMetric?.ing.id === item.ing.id;
                            return (
                              <button
                                key={item.ing.id}
                                type="button"
                                onClick={() => setSelectedChartIngId(item.ing.id)}
                                className={`flex-1 text-center px-0.5 cursor-pointer ${
                                  isSelected
                                    ? 'text-teal-800 dark:text-teal-300 font-bold'
                                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                                }`}
                              >
                                <div className="text-[11px] leading-tight line-clamp-2">
                                  {lang === 'ar' ? item.shortNameAr : item.shortNameEn}
                                </div>
                                <div className="text-[10px] font-mono-num text-slate-400 dark:text-slate-500 mt-0.5" dir="ltr">
                                  {item.wasteRatePct.toFixed(1)}%
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Decision Support Panel for Selected / Hovered Ingredient */}
                {activeMetric && (
                  <div className="xl:col-span-4 border border-slate-200 dark:border-slate-800 rounded-xl p-4 bg-white dark:bg-slate-900 flex flex-col justify-between gap-4">
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-2 pb-3 border-b border-slate-200 dark:border-slate-800">
                        <div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                            <span className="font-mono-num" dir="ltr">{activeMetric.ing.sku}</span>
                            <span aria-hidden="true">·</span>
                            <span>{activeMetric.ing.category}</span>
                          </div>
                          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                            {lang === 'ar' ? activeMetric.ing.nameAr : activeMetric.ing.nameEn}
                          </h3>
                        </div>
                        <span
                          className={`text-xs font-bold font-mono-num whitespace-nowrap ${
                            activeMetric.riskTier === 'critical'
                              ? 'text-red-600 dark:text-red-400'
                              : activeMetric.riskTier === 'watch'
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-emerald-600 dark:text-emerald-400'
                          }`}
                          dir="ltr"
                        >
                          {fmtPct(activeMetric.wasteRatePct, 2)}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2.5 text-xs">
                        <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/70">
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {t(lang, 'متوسط التكلفة الشهرية', 'Monthly Avg Cost')}
                          </div>
                          <div className="font-mono-num font-bold text-slate-900 dark:text-slate-100 mt-0.5" dir="ltr">
                            {fmtMoney(activeMetric.monthlyAvgUsageCost, 0)} {t(lang, 'ج.م', 'EGP')}
                          </div>
                        </div>

                        <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/70">
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {t(lang, 'خسارة الهالك شهرياً', 'Monthly Waste Cost')}
                          </div>
                          <div className="font-mono-num font-bold text-red-600 dark:text-red-400 mt-0.5" dir="ltr">
                            {fmtMoney(activeMetric.monthlyAvgWasteCost, 0)} {t(lang, 'ج.م', 'EGP')}
                          </div>
                        </div>

                        <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/70">
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {t(lang, 'الكمية المهدرة / المنصرف', 'Waste / Total Usage')}
                          </div>
                          <div className="font-mono-num font-semibold text-slate-800 dark:text-slate-200 mt-0.5" dir="ltr">
                            {fmtMoney(activeMetric.ing.wasteQty, 1)} / {fmtMoney(activeMetric.totalConsumedQty, 0)} {activeMetric.ing.unit}
                          </div>
                        </div>

                        <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/70">
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {t(lang, 'حصة الصنف من الهالك', 'Share of Total Waste')}
                          </div>
                          <div className="font-mono-num font-semibold text-slate-800 dark:text-slate-200 mt-0.5" dir="ltr">
                            {fmtPct(activeMetric.wasteSharePct, 1)}
                          </div>
                        </div>
                      </div>

                      {/* Savings Opportunity & Actionable Recommendation */}
                      <div className="p-3 rounded-lg bg-teal-50/70 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800/70 space-y-1.5">
                        <div className="flex items-center justify-between text-xs font-bold text-teal-900 dark:text-teal-200">
                          <span className="flex items-center gap-1.5">
                            <TrendingDown className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400" />
                            {t(lang, 'توصية تقليل الهدر', 'Waste Reduction Action')}
                          </span>
                          {activeMetric.potentialMonthlySaving > 0 && (
                            <span className="font-mono-num text-emerald-700 dark:text-emerald-300" dir="ltr">
                              +{fmtMoney(activeMetric.potentialMonthlySaving, 0)} {t(lang, 'ج.م/شهر', 'EGP/mo')}
                            </span>
                          )}
                        </div>
                        <p className="text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                          {lang === 'ar' ? activeMetric.recommendationAr : activeMetric.recommendationEn}
                        </p>
                        {activeMetric.potentialMonthlySaving > 0 && (
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono-num" dir="ltr">
                            {t(lang, 'الوفر السنوي عند ضبط النسبة إلى 1.0%:', 'Annualized saving at 1.0%:')}{' '}
                            {fmtMoney(activeMetric.potentialMonthlySaving * 12, 0)} {t(lang, 'ج.م/سنة', 'EGP/yr')}
                          </div>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleJumpToLogWaste(activeMetric.ing.id)}
                      className="w-full py-2 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-xs font-semibold flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
                      <span>{t(lang, 'تسجيل حركة هالك لهذا الصنف', 'Log Waste for This Ingredient')}</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {/* TAB 1: RAW INGREDIENTS INVENTORY */}
      {subTab === 'stock' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="relative w-64">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute top-2.5 start-3" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t(lang, 'بحث باسم الخامة أو الكود...', 'Search SKU or ingredient...')}
                className="w-full ps-8 pe-3 py-1.5 text-xs border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg focus:outline-none focus:border-teal-600"
              />
            </div>

            <button
              type="button"
              onClick={() => setOnlyLowStock(!onlyLowStock)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                onlyLowStock
                  ? 'bg-amber-600 border-amber-600 text-white'
                  : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}
            >
              {t(lang, 'الأصناف تحت حد إعادة الطلب فقط', 'Show Low Stock Alerts Only')}
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300">
                  <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'الكود', 'SKU')}</th>
                  <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'الصنف الخام', 'Ingredient')}</th>
                  <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'الوحدة', 'Unit')}</th>
                  <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'افتتاحي', 'Open')}</th>
                  <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'مشتريات', 'In')}</th>
                  <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'منصرف BOM', 'Issued')}</th>
                  <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'هالك', 'Waste')}</th>
                  <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'نسبة الهالك', 'Waste %')}</th>
                  <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'الرصيد الحالي', 'On Hand')}</th>
                  <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'متوسط التكلفة WAC', 'WAC (EGP)')}</th>
                  <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'القيمة', 'Stock Value')}</th>
                  <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'حد الطلب / الحالة', 'Status')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredIngredients.map((ing) => {
                  const isLow = ing.currentQty <= ing.reorderLevel;
                  const val = round2(ing.currentQty * ing.weightedAvgCost);
                  const totalConsumed = ing.issuedQty + ing.wasteQty;
                  const wastePct = totalConsumed > 0 ? round2((ing.wasteQty / totalConsumed) * 100) : 0;
                  return (
                    <tr
                      key={ing.id}
                      className={
                        isLow
                          ? 'bg-amber-50/40 dark:bg-amber-950/20'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                      }
                    >
                      <td className="py-2.5 px-4 font-mono-num text-slate-500 dark:text-slate-400" dir="ltr">
                        {ing.sku}
                      </td>
                      <td className="py-2.5 px-4 font-semibold text-slate-900 dark:text-slate-100">
                        {lang === 'ar' ? ing.nameAr : ing.nameEn}
                      </td>
                      <td className="py-2.5 px-4 text-slate-600 dark:text-slate-300">{ing.unit}</td>
                      <td className="py-2.5 px-4 text-end font-mono-num text-slate-600 dark:text-slate-300" dir="ltr">
                        {fmtMoney(ing.openingQty, 1)}
                      </td>
                      <td className="py-2.5 px-4 text-end font-mono-num text-emerald-700 dark:text-emerald-400" dir="ltr">
                        +{fmtMoney(ing.purchasedQty, 1)}
                      </td>
                      <td className="py-2.5 px-4 text-end font-mono-num text-slate-600 dark:text-slate-300" dir="ltr">
                        -{fmtMoney(ing.issuedQty, 1)}
                      </td>
                      <td className="py-2.5 px-4 text-end font-mono-num text-red-600 dark:text-red-400" dir="ltr">
                        -{fmtMoney(ing.wasteQty, 1)}
                      </td>
                      <td
                        className={`py-2.5 px-4 text-end font-mono-num font-semibold ${
                          wastePct >= 2
                            ? 'text-red-600 dark:text-red-400'
                            : wastePct > targetWastePct
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-emerald-700 dark:text-emerald-400'
                        }`}
                        dir="ltr"
                      >
                        {fmtPct(wastePct, 2)}
                      </td>
                      <td className="py-2.5 px-4 text-end font-mono-num font-bold text-slate-900 dark:text-slate-100" dir="ltr">
                        {fmtMoney(ing.currentQty, 2)}
                      </td>
                      <td className="py-2.5 px-4 text-end font-mono-num text-slate-800 dark:text-slate-200" dir="ltr">
                        {fmtMoney(ing.weightedAvgCost, 2)}
                      </td>
                      <td className="py-2.5 px-4 text-end font-mono-num font-semibold text-slate-900 dark:text-slate-100" dir="ltr">
                        {fmtMoney(val, 0)}
                      </td>
                      <td className="py-2.5 px-4 text-end">
                        {isLow ? (
                          <span className="inline-flex items-center gap-1 text-amber-800 dark:text-amber-300 font-semibold">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            {t(lang, `نقص (حد ${ing.reorderLevel})`, `Low (Min ${ing.reorderLevel})`)}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            {t(lang, 'آمن', 'OK')}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: RECIPES & MENU ENGINEERING */}
      {subTab === 'recipes' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          <div className="xl:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-teal-700 dark:text-teal-400" />
                  {t(
                    lang,
                    `قائمة الطعام الرسمية (${state.menuItems.length} صنف) وتحليل الربحية`,
                    `Official Restaurant Menu (${state.menuItems.length} Items) & Engineering`
                  )}
                </h2>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setMenuListingFilter('all')}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-medium border cursor-pointer ${
                      menuListingFilter === 'all'
                        ? 'bg-teal-700 border-teal-700 text-white'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {t(lang, `الكل (${state.menuItems.length})`, `All (${state.menuItems.length})`)}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMenuListingFilter('manual')}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-medium border cursor-pointer ${
                      menuListingFilter === 'manual'
                        ? 'bg-teal-700 border-teal-700 text-white'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {t(lang, 'إضافة يدوية', 'Manual Additions')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMenuListingFilter('unspecified')}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-medium border cursor-pointer ${
                      menuListingFilter === 'unspecified'
                        ? 'bg-amber-600 border-amber-600 text-white'
                        : 'border-slate-200 dark:border-slate-700 text-amber-700 dark:text-amber-300'
                    }`}
                  >
                    {t(lang, 'غير محدد السعر', 'Price TBD')}
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute top-2.5 start-3" />
                  <input
                    type="text"
                    value={menuSearch}
                    onChange={(e) => setMenuSearch(e.target.value)}
                    placeholder={t(
                      lang,
                      'بحث برقم الصنف أو الاسم أو الوصف...',
                      'Search item #, name, or details...'
                    )}
                    className="w-full ps-8 pe-3 py-1.5 text-xs border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg focus:outline-none focus:border-teal-600"
                  />
                </div>
                <select
                  value={menuCatFilter}
                  onChange={(e) => setMenuCatFilter(e.target.value)}
                  className="px-3 py-1.5 text-xs border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-lg focus:outline-none focus:border-teal-600"
                >
                  <option value="all">{t(lang, 'كل الأقسام (9)', 'All Categories (9)')}</option>
                  {menuCategories.map(([cat, count]) => (
                    <option key={cat} value={cat}>
                      {cat} ({count})
                    </option>
                  ))}
                </select>
                <span className="text-[11px] text-slate-500 font-mono-num" dir="ltr">
                  {filteredMenuItems.length} {t(lang, 'صنف معروض', 'shown')}
                </span>
              </div>
            </div>

            <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300">
                    <th className="py-2.5 px-3 text-center font-semibold w-10">#</th>
                    <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'الصنف والتفاصيل', 'Menu Item & Details')}</th>
                    <th className="py-2.5 px-3 text-start font-semibold">{t(lang, 'القسم / الإدراج', 'Category / Type')}</th>
                    <th className="py-2.5 px-3 text-end font-semibold">{t(lang, 'الأساسي', 'Base')}</th>
                    <th className="py-2.5 px-3 text-end font-semibold">{t(lang, 'شامل 12% خدمة', 'Incl. 12%')}</th>
                    <th className="py-2.5 px-3 text-end font-semibold">{t(lang, 'تكلفة BOM', 'BOM Cost')}</th>
                    <th className="py-2.5 px-3 text-end font-semibold">Food Cost %</th>
                    <th className="py-2.5 px-3 text-end font-semibold">{t(lang, 'السعر المقترح', 'Optimal')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredMenuItems.map((m, idx) => {
                    const cost = calculateRecipeCost(m, state.ingredients);
                    const isUnspecified = m.sellingPriceGross <= 0 || m.priceStatus === 'unspecified';
                    const netPrice = !isUnspecified ? round2(m.sellingPriceGross / (1 + state.vatRate)) : 0;
                    const fcPct = netPrice > 0 ? round2((cost / netPrice) * 100) : 0;
                    const suggestedGross = suggestOptimalPriceGross(cost, m.targetFoodCostPct, state.vatRate);
                    const isOverTarget = !isUnspecified && fcPct > m.targetFoodCostPct;
                    const isSelected = m.id === selectedMenu?.id;

                    return (
                      <tr
                        key={m.id}
                        onClick={() => {
                          setSelectedMenuId(m.id);
                          setEditingPrice(String(m.sellingPriceGross || suggestedGross || ''));
                        }}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-teal-50/60 dark:bg-teal-950/30'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                        }`}
                      >
                        <td className="py-2.5 px-3 text-center font-mono-num text-slate-400" dir="ltr">
                          {m.menuNo ?? idx + 1}
                        </td>
                        <td className="py-2.5 px-4 font-semibold text-slate-900 dark:text-slate-100">
                          <div>{lang === 'ar' ? m.nameAr : m.nameEn}</div>
                          {m.descriptionAr && (
                            <div className="text-[11px] font-normal text-slate-500 dark:text-slate-400 line-clamp-1">
                              {m.descriptionAr}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">
                          <div className="text-[11px] font-medium">{lang === 'ar' ? m.categoryAr : m.categoryEn}</div>
                          <div className="text-[10px] text-slate-400">{m.listingType || 'مطبوع'}</div>
                        </td>
                        <td className="py-2.5 px-3 text-end font-mono-num text-slate-700 dark:text-slate-300" dir="ltr">
                          {isUnspecified
                            ? t(lang, 'غير محدد', 'TBD')
                            : fmtMoney(m.basePrice ?? round2(m.sellingPriceGross / 1.12), 0)}
                        </td>
                        <td className="py-2.5 px-3 text-end font-mono-num font-bold text-slate-900 dark:text-slate-100" dir="ltr">
                          {isUnspecified ? (
                            <span className="text-amber-700 dark:text-amber-400 font-semibold text-[11px]">
                              {t(lang, 'غير محدد', 'TBD')}
                            </span>
                          ) : (
                            fmtMoney(m.sellingPriceGross, 2)
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-end font-mono-num text-slate-800 dark:text-slate-200" dir="ltr">
                          {fmtMoney(cost, 2)}
                        </td>
                        <td
                          className={`py-2.5 px-3 text-end font-mono-num font-bold ${
                            isUnspecified
                              ? 'text-slate-400'
                              : isOverTarget
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-emerald-700 dark:text-emerald-400'
                          }`}
                          dir="ltr"
                        >
                          {isUnspecified ? '—' : fmtPct(fcPct)}
                        </td>
                        <td className="py-2.5 px-3 text-end font-mono-num font-semibold text-teal-800 dark:text-teal-300" dir="ltr">
                          {fmtMoney(suggestedGross)} {t(lang, 'ج.م', 'EGP')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Recipe BOM Detail Card */}
          {selectedMenu && (
            <div className="xl:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
              <div className="border-b border-slate-200 dark:border-slate-800 pb-3 space-y-1">
                <div className="text-[11px] font-medium text-teal-700 dark:text-teal-400 flex items-center justify-between gap-1">
                  <span className="flex items-center gap-1">
                    <Calculator className="w-3.5 h-3.5" />
                    {t(lang, 'مكونات التكلفة المعيارية (Standard BOM)', 'Standard Costing BOM')}
                  </span>
                  <span className="font-mono-num text-slate-400" dir="ltr">
                    #{selectedMenu.menuNo ?? '-'} · {selectedMenu.code}
                  </span>
                </div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {lang === 'ar' ? selectedMenu.nameAr : selectedMenu.nameEn}
                </h3>
                {selectedMenu.descriptionAr && (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">{selectedMenu.descriptionAr}</p>
                )}
                <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] text-slate-600 dark:text-slate-300">
                  <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800">
                    {lang === 'ar' ? selectedMenu.categoryAr : selectedMenu.categoryEn}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800">
                    {selectedMenu.listingType || 'مطبوع'}
                  </span>
                  {selectedMenu.sellingPriceGross > 0 && typeof selectedMenu.basePrice === 'number' && (
                    <span className="font-mono-num text-teal-700 dark:text-teal-300" dir="ltr">
                      {t(lang, 'أساسي', 'Base')}: {fmtMoney(selectedMenu.basePrice, 0)} → 12%: {fmtMoney(selectedMenu.sellingPriceGross, 2)}
                    </span>
                  )}
                </div>
              </div>

              <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                {selectedMenu.recipe.map((line) => {
                  const ing = state.ingredients.find((i) => i.id === line.ingredientId);
                  if (!ing) return null;
                  const lineCost = round2(line.qty * (1 + line.wastePct / 100) * ing.weightedAvgCost);
                  return (
                    <div key={line.ingredientId} className="py-2 flex items-center justify-between gap-2">
                      <div>
                        <div className="font-medium text-slate-800 dark:text-slate-200">
                          {lang === 'ar' ? ing.nameAr : ing.nameEn}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono-num" dir="ltr">
                          {line.qty} {ing.unit} (+{line.wastePct}% waste) × {ing.weightedAvgCost}
                        </div>
                      </div>
                      <span className="font-mono-num font-semibold text-slate-900 dark:text-slate-100" dir="ltr">
                        {fmtMoney(lineCost, 2)}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-3">
                <div className="flex justify-between text-xs font-bold text-slate-900 dark:text-slate-100">
                  <span>{t(lang, 'إجمالي تكلفة الوصفة (BOM)', 'Total BOM Cost')}</span>
                  <span className="font-mono-num" dir="ltr">
                    {fmtMoney(calculateRecipeCost(selectedMenu, state.ingredients), 2)} {t(lang, 'ج.م', 'EGP')}
                  </span>
                </div>

                <div>
                  <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                    {t(lang, 'تحديث السعر شامل 12% خدمة (ج.م)', 'Update Selling Price Incl. 12% (EGP)')}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      step="0.01"
                      value={editingPrice !== '' ? editingPrice : selectedMenu.sellingPriceGross || ''}
                      placeholder={t(lang, 'أدخل السعر...', 'Enter price...')}
                      onChange={(e) => setEditingPrice(e.target.value)}
                      className="flex-1 px-3 py-1.5 text-xs font-mono-num border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-md focus:outline-none focus:border-teal-600"
                      dir="ltr"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const val = Number(editingPrice);
                        if (val > 0) onUpdateMenuPrice(selectedMenu.id, val);
                      }}
                      className="px-3 py-1.5 rounded-md bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold cursor-pointer"
                    >
                      {t(lang, 'حفظ السعر', 'Save Price')}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: WASTE & SPOILAGE LOGGING */}
      {subTab === 'waste' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          <form
            onSubmit={handleWasteSubmit}
            className="xl:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4"
          >
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Trash2 className="w-4 h-4 text-red-600 dark:text-red-400" />
              {t(lang, 'تسجيل هالك وتالف مخزون (قيد آلي)', 'Log Inventory Waste (Auto Journal)')}
            </h2>

            <div>
              <label className="block text-xs text-slate-600 dark:text-slate-300 mb-1">
                {t(lang, 'الخامة', 'Ingredient')}
              </label>
              <select
                value={wasteIngId}
                onChange={(e) => setWasteIngId(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              >
                {state.ingredients.map((i) => (
                  <option key={i.id} value={i.id}>
                    {lang === 'ar' ? i.nameAr : i.nameEn} ({i.currentQty} {i.unit})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-600 dark:text-slate-300 mb-1">
                  {t(lang, 'الكمية التالفة', 'Waste Qty')}
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="0.1"
                  value={wasteQty}
                  onChange={(e) => setWasteQty(Number(e.target.value) || 0)}
                  className="w-full px-3 py-2 text-xs font-mono-num border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
                  dir="ltr"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-600 dark:text-slate-300 mb-1">
                  {t(lang, 'السبب', 'Reason')}
                </label>
                <select
                  value={wasteReason}
                  onChange={(e) => setWasteReason(e.target.value as WasteEntry['reason'])}
                  className="w-full px-3 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                >
                  <option value="spoilage">{t(lang, 'تلف تخزين', 'Spoilage')}</option>
                  <option value="expired">{t(lang, 'انتهاء صلاحية', 'Expired')}</option>
                  <option value="prep_error">{t(lang, 'خطأ تحضير', 'Prep Error')}</option>
                  <option value="overcooked">{t(lang, 'احتراق فرن', 'Overcooked')}</option>
                </select>
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-2.5 px-4 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold transition-colors cursor-pointer"
            >
              {t(lang, 'اعتماد الهالك وخصم المخزون (5305 / 1201)', 'Record Waste & Post Ledger (5305 / 1201)')}
            </button>
          </form>

          <div className="xl:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800">
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {t(lang, 'سجل الهالك والتالف', 'Waste & Spoilage Register')}
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300">
                    <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'رقم المستند', 'Ref #')}</th>
                    <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'التاريخ', 'Date')}</th>
                    <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'الصنف', 'Ingredient')}</th>
                    <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'السبب', 'Reason')}</th>
                    <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'الكمية', 'Qty')}</th>
                    <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'التكلفة', 'Cost Value')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {state.wasteEntries.map((w) => (
                    <tr key={w.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-2.5 px-4 font-mono-num font-semibold text-slate-900 dark:text-slate-100" dir="ltr">
                        {w.wasteNo}
                      </td>
                      <td className="py-2.5 px-4 font-mono-num text-slate-600 dark:text-slate-300" dir="ltr">
                        {w.date}
                      </td>
                      <td className="py-2.5 px-4 font-medium text-slate-900 dark:text-slate-100">
                        {w.ingredientNameAr}
                      </td>
                      <td className="py-2.5 px-4 text-slate-600 dark:text-slate-300">{w.reason}</td>
                      <td className="py-2.5 px-4 text-end font-mono-num text-slate-800 dark:text-slate-200" dir="ltr">
                        {w.qty}
                      </td>
                      <td className="py-2.5 px-4 text-end font-mono-num font-bold text-red-600 dark:text-red-400" dir="ltr">
                        {fmtMoney(w.totalValue, 2)} {t(lang, 'ج.م', 'EGP')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      {/* TAB 4: PHYSICAL STOCKTAKE & DISCREPANCY RECONCILIATION */}
      {subTab === 'stocktake' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* Physical Count Entry Form */}
          <form
            onSubmit={handleStocktakeSubmit}
            className="xl:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4"
          >
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <ClipboardCheck className="w-4 h-4 text-teal-700 dark:text-teal-400" />
                {t(lang, 'تسجيل جرد فعلي ومطابقته بالدفتري', 'Record Physical Stocktake Count')}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {t(
                  lang,
                  'يرسل إشعاراً فورياً إلى لوحة CFO عند تجاوز انحراف الجرد عن ±2%.',
                  'Triggers an automatic CFO alert whenever variance exceeds ±2%.'
                )}
              </p>
            </div>

            <div>
              <label className="block text-xs text-slate-600 dark:text-slate-300 mb-1">
                {t(lang, 'الصنف الخام', 'Ingredient')}
              </label>
              <select
                value={stkIngId}
                onChange={(e) => {
                  const nextId = e.target.value;
                  setStkIngId(nextId);
                  const found = state.ingredients.find((i) => i.id === nextId);
                  if (found) setStkActualQty(String(found.currentQty));
                }}
                className="w-full px-3 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              >
                {state.ingredients.map((i) => (
                  <option key={i.id} value={i.id}>
                    {lang === 'ar' ? i.nameAr : i.nameEn} ({i.currentQty} {i.unit})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-600 dark:text-slate-300 mb-1">
                  {t(lang, 'الكمية الدفترية الحالية', 'Book Qty (System)')}
                </label>
                <div
                  className="px-3 py-2 text-xs font-mono-num font-bold bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200"
                  dir="ltr"
                >
                  {fmtMoney(previewStocktakeVariance.bookQty, 2)} {selectedStkIng?.unit}
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-600 dark:text-slate-300 mb-1">
                  {t(lang, 'الكمية الفعلية بالجرد', 'Actual Counted Qty')}
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={stkActualQty}
                  onChange={(e) => setStkActualQty(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono-num font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg focus:outline-none focus:border-teal-600"
                  dir="ltr"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-600 dark:text-slate-300 mb-1">
                {t(lang, 'موقع التخزين / الفرع', 'Storage Location')}
              </label>
              <input
                type="text"
                value={stkLocationAr}
                onChange={(e) => setStkLocationAr(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-600 dark:text-slate-300 mb-1">
                {t(lang, 'ملاحظات الجرد', 'Audit Notes')}
              </label>
              <input
                type="text"
                value={stkNotes}
                onChange={(e) => setStkNotes(e.target.value)}
                placeholder={t(lang, 'مثال: عجز تشفية أو خطأ استلام...', 'e.g., trim loss or receiving variance...')}
                className="w-full px-3 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              />
            </div>

            {/* Live Variance Preview */}
            <div
              className={`p-3 rounded-lg border text-xs space-y-1 ${
                Math.abs(previewStocktakeVariance.diffPct) > 2
                  ? 'bg-red-50/70 dark:bg-red-950/35 border-red-200 dark:border-red-800 text-red-900 dark:text-red-100'
                  : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
              }`}
            >
              <div className="flex items-center justify-between font-bold">
                <span>{t(lang, 'نسبة الانحراف المتوقعة:', 'Calculated Variance %:')}</span>
                <span className="font-mono-num" dir="ltr">
                  {previewStocktakeVariance.diffPct > 0 ? '+' : ''}
                  {fmtPct(previewStocktakeVariance.diffPct, 2)} ({previewStocktakeVariance.diffQty > 0 ? '+' : ''}
                  {fmtMoney(previewStocktakeVariance.diffQty, 2)} {selectedStkIng?.unit})
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span>{t(lang, 'الأثر المالي المقدر:', 'Financial Impact:')}</span>
                <span className="font-mono-num font-semibold" dir="ltr">
                  {previewStocktakeVariance.diffValue > 0 ? '+' : ''}
                  {fmtMoney(previewStocktakeVariance.diffValue, 2)} {t(lang, 'ج.م', 'EGP')}
                </span>
              </div>
              {Math.abs(previewStocktakeVariance.diffPct) > 2 && (
                <div className="text-[11px] font-semibold text-red-700 dark:text-red-300 pt-1">
                  {t(
                    lang,
                    'تجاوز الحد المسموح (±2%) — سيتم إرسال تنبيه فوري للوحة CFO.',
                    'Exceeds ±2% tolerance — will trigger instant CFO variance alert.'
                  )}
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={isSubmittingStocktake || !onRecordStocktake}
              className="w-full py-2.5 px-4 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-xs font-semibold transition-colors cursor-pointer"
            >
              {isSubmittingStocktake
                ? t(lang, 'جاري حفظ الجرد...', 'Saving Stocktake...')
                : t(lang, 'اعتماد محضر الجرد الفعلي', 'Submit Physical Stocktake')}
            </button>
          </form>

          {/* Stocktake Discrepancy & Reconciliation Register */}
          <div className="xl:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {t(lang, 'سجل الجرد الفعلي وتسوية الفروقات (الفعلي مقابل الدفتري)', 'Stocktake Register & Discrepancy Reconciliation')}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t(
                    lang,
                    'تسوية الفارق تُعدّل الرصيد الدفتري للخامة وتُرحّل قيد تسوية متزن تلقائياً (5305 ↔ 1201).',
                    'Reconciliation aligns book inventory to physical count and posts an automated balanced GL entry (5305 <-> 1201).'
                  )}
                </p>
              </div>
              {focusedStocktakeId && (
                <button
                  type="button"
                  onClick={() => onClearFocusStocktake?.()}
                  className="text-xs font-semibold text-teal-700 dark:text-teal-400 hover:underline cursor-pointer"
                >
                  {t(lang, 'إلغاء التمييز', 'Clear Focus')}
                </button>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300">
                    <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'محضر / موقع', 'Count # / Location')}</th>
                    <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'الصنف', 'Ingredient')}</th>
                    <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'الدفتري', 'Book Qty')}</th>
                    <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'الفعلي', 'Actual Qty')}</th>
                    <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'الفارق / %', 'Variance')}</th>
                    <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'الأثر المالي', 'Impact EGP')}</th>
                    <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'الحالة / التسوية', 'Reconcile')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {stocktakeSummary.items.map((item) => {
                    const isFocused = focusedStocktakeId === item.entry.id;
                    const isPendingAlert =
                      item.entry.status === 'pending_reconciliation' && item.exceedsThreshold;
                    return (
                      <tr
                        key={item.entry.id}
                        className={`transition-colors ${
                          isFocused
                            ? 'bg-amber-50/90 dark:bg-amber-950/45 ring-1 ring-inset ring-amber-400 dark:ring-amber-600'
                            : isPendingAlert
                            ? 'bg-red-50/25 dark:bg-red-950/15 hover:bg-red-50/45 dark:hover:bg-red-950/25'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                        }`}
                      >
                        <td className="py-3 px-4">
                          <div className="font-mono-num font-bold text-slate-900 dark:text-slate-100" dir="ltr">
                            {item.entry.countNo}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {lang === 'ar' ? item.entry.locationAr : item.entry.locationEn} · {item.entry.date}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900 dark:text-slate-100">
                            {lang === 'ar' ? item.entry.ingredientNameAr : item.entry.ingredientNameEn}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono-num" dir="ltr">
                            {item.entry.sku} ({item.entry.unit})
                          </div>
                        </td>
                        <td className="py-3 px-4 text-end font-mono-num text-slate-700 dark:text-slate-300" dir="ltr">
                          {fmtMoney(item.liveBookQty, 2)}
                        </td>
                        <td className="py-3 px-4 text-end font-mono-num font-bold text-slate-900 dark:text-slate-100" dir="ltr">
                          {fmtMoney(item.entry.actualQty, 2)}
                        </td>
                        <td className="py-3 px-4 text-end font-mono-num" dir="ltr">
                          <div
                            className={`font-bold ${
                              item.exceedsThreshold
                                ? 'text-red-700 dark:text-red-400'
                                : 'text-emerald-700 dark:text-emerald-400'
                            }`}
                          >
                            {item.signedVariancePct > 0 ? '+' : ''}
                            {fmtPct(item.signedVariancePct, 2)}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {item.varianceQty > 0 ? '+' : ''}
                            {fmtMoney(item.varianceQty, 2)} {item.entry.unit}
                          </div>
                        </td>
                        <td
                          className={`py-3 px-4 text-end font-mono-num font-bold ${
                            item.varianceValue < 0
                              ? 'text-red-700 dark:text-red-400'
                              : item.varianceValue > 0
                              ? 'text-teal-700 dark:text-teal-400'
                              : 'text-slate-600 dark:text-slate-400'
                          }`}
                          dir="ltr"
                        >
                          {item.varianceValue > 0 ? '+' : ''}
                          {fmtMoney(item.varianceValue, 2)}
                        </td>
                        <td className="py-3 px-4 text-end">
                          {item.entry.status === 'reconciled' ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              {t(lang, 'تمت التسوية', 'Reconciled')}
                            </span>
                          ) : (
                            <button
                              type="button"
                              disabled={!onReconcileStocktake || reconcilingId === item.entry.id}
                              onClick={() => handleReconcileRow(item.entry.id)}
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold whitespace-nowrap cursor-pointer transition-colors disabled:opacity-60 ${
                                item.exceedsThreshold
                                  ? 'bg-red-700 hover:bg-red-800 text-white'
                                  : 'bg-teal-700 hover:bg-teal-800 text-white'
                              }`}
                            >
                              {reconcilingId === item.entry.id
                                ? t(lang, 'جاري التسوية...', 'Reconciling...')
                                : t(lang, 'اعتماد تسوية الفارق', 'Reconcile Discrepancy')}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
