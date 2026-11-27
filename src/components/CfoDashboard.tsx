import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  ArrowUpRight,
  BarChart3,
  BellRing,
  Calculator,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Download,
  FileDown,
  LandPlot,
  OctagonAlert,
  Printer,
  ReceiptText,
  RotateCcw,
  Send,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  TrendingDown,
  X,
  Zap,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from 'recharts';
import { ErpState, Language, StrategyRisk } from '../types/erp';
import {
  computeAccountBalances,
  computeCfoVatSummary,
  computeFoodCostVarianceAnalysis,
  computeStockOpportunityAlerts,
  computeStocktakeVarianceAlerts,
  round2,
} from '../utils/erpEngine';
import { buildMonthlyTrendSeries } from '../utils/executivePdfBuilder';
import {
  loadSavedRoiInputs,
  ROI_PRESETS,
  ROI_STORAGE_KEY,
  RoiSimulatorInputs,
  runRoiSimulation,
} from '../utils/roiSimulatorEngine';
import { fmtMoney, fmtPct, t } from '../utils/formatters';
import {
  ALL_CFO_PRINT_SECTIONS,
  CfoPrintableBrief,
  CfoPrintPreviewModal,
  CfoPrintSectionId,
} from './CfoPrintableBrief';
import { RiskRegisterPanel } from './RiskRegisterPanel';

interface CfoDashboardProps {
  state: ErpState;
  lang: Language;
  onNavigate: (tab: 'accounting' | 'inventory' | 'pos' | 'strategy' | 'purchases' | 'cfo_review' | 'roi_simulator') => void;
  onOpenPerformanceReview?: () => void;
  onQuickReorder?: (payload: { ingredientId: string; supplierId: string; qty: number }) => void;
  onNavigateToStocktakeReconcile?: (payload: { stocktakeId?: string; ingredientId?: string }) => void;
  onReconcileStocktake?: (stocktakeId: string) => Promise<void>;
  onCreateRisk?: (risk: Partial<StrategyRisk>) => Promise<void>;
  onUpdateRisk?: (id: string, patch: Partial<StrategyRisk> & { auditNote?: string }) => Promise<void>;
  onDeleteRisk?: (id: string) => Promise<void>;
}

type PeriodFilter = '9m_ytd' | 'Q1' | 'Q2' | 'Q3' | '9m_plus_live';
type AlertSeverityFilter = 'all' | 'critical' | 'approaching';
type CostCenterId = 'CC-HR' | 'CC-KITCHEN' | 'CC-ADMIN' | 'CC-FACILITY' | 'CC-TREASURY';
type CostCenterAlertFilter = 'all' | 'exceeded' | 'approaching' | 'safe';
type FoodCostFilter = 'all' | 'exceeded' | 'within';
type StocktakeFilter = 'all' | 'exceeded' | 'within' | 'reconciled';
type VatViewMode = 'chart' | 'schedule' | 'audit' | 'sources';

interface FoodCostNotification {
  id: string;
  signature: string;
  createdAt: string;
  recipientAr: string;
  recipientEn: string;
  variancePct: number;
  varianceAmount: number;
  thresholdPct: number;
  titleAr: string;
  titleEn: string;
  messageAr: string;
  messageEn: string;
  channel: 'auto_monitor' | 'manual_dispatch';
  acknowledged: boolean;
}

interface StocktakeVarianceNotification {
  id: string;
  signature: string;
  createdAt: string;
  stocktakeId: string;
  ingredientId: string;
  countNo: string;
  exceedingCount: number;
  maxAbsVariancePct: number;
  netVarianceValue: number;
  thresholdPct: number;
  titleAr: string;
  titleEn: string;
  messageAr: string;
  messageEn: string;
  channel: 'auto_monitor' | 'manual_dispatch';
  acknowledged: boolean;
}

interface RevenueGrowthAlertNotification {
  id: string;
  signature: string;
  createdAt: string;
  thresholdPct: number;
  consecutiveRequired: number;
  streakLength: number;
  streakRangeAr: string;
  streakRangeEn: string;
  latestPairAr: string;
  latestPairEn: string;
  titleAr: string;
  titleEn: string;
  messageAr: string;
  messageEn: string;
  channel: 'auto_monitor' | 'manual_dispatch';
  acknowledged: boolean;
}

const BUDGET_STORAGE_KEY = 'estadat_cost_center_budgets_v1';
const FC_NOTIF_STORAGE_KEY = 'estadat_food_cost_notifications_v1';
const STK_NOTIF_STORAGE_KEY = 'estadat_stocktake_notifications_v1';
const REV_GROWTH_NOTIF_STORAGE_KEY = 'estadat_rev_growth_notifications_v1';

const DEFAULT_COST_CENTER_BUDGETS: Record<CostCenterId, number> = {
  'CC-HR': 550000,
  'CC-KITCHEN': 465000,
  'CC-ADMIN': 70000,
  'CC-FACILITY': 430000,
  'CC-TREASURY': 10000,
};

function loadSavedBudgets(): Record<CostCenterId, number> {
  try {
    const raw = localStorage.getItem(BUDGET_STORAGE_KEY);
    if (!raw) return DEFAULT_COST_CENTER_BUDGETS;
    const parsed = JSON.parse(raw);
    return {
      'CC-HR': Number(parsed['CC-HR']) > 0 ? Number(parsed['CC-HR']) : DEFAULT_COST_CENTER_BUDGETS['CC-HR'],
      'CC-KITCHEN': Number(parsed['CC-KITCHEN']) > 0 ? Number(parsed['CC-KITCHEN']) : DEFAULT_COST_CENTER_BUDGETS['CC-KITCHEN'],
      'CC-ADMIN': Number(parsed['CC-ADMIN']) > 0 ? Number(parsed['CC-ADMIN']) : DEFAULT_COST_CENTER_BUDGETS['CC-ADMIN'],
      'CC-FACILITY': Number(parsed['CC-FACILITY']) > 0 ? Number(parsed['CC-FACILITY']) : DEFAULT_COST_CENTER_BUDGETS['CC-FACILITY'],
      'CC-TREASURY': Number(parsed['CC-TREASURY']) > 0 ? Number(parsed['CC-TREASURY']) : DEFAULT_COST_CENTER_BUDGETS['CC-TREASURY'],
    };
  } catch {
    return DEFAULT_COST_CENTER_BUDGETS;
  }
}

function loadSavedFoodCostNotifications(): FoodCostNotification[] {
  try {
    const raw = localStorage.getItem(FC_NOTIF_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, 20) : [];
  } catch {
    return [];
  }
}

function loadSavedStocktakeNotifications(): StocktakeVarianceNotification[] {
  try {
    const raw = localStorage.getItem(STK_NOTIF_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, 20) : [];
  } catch {
    return [];
  }
}

function loadSavedRevenueGrowthNotifications(): RevenueGrowthAlertNotification[] {
  try {
    const raw = localStorage.getItem(REV_GROWTH_NOTIF_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, 20) : [];
  } catch {
    return [];
  }
}

export const CfoDashboard: React.FC<CfoDashboardProps> = ({
  state,
  lang,
  onNavigate,
  onOpenPerformanceReview,
  onQuickReorder,
  onNavigateToStocktakeReconcile,
  onReconcileStocktake,
  onCreateRisk,
  onUpdateRisk,
  onDeleteRisk,
}) => {
  const [period, setPeriod] = useState<PeriodFilter>('9m_ytd');
  const [excludeUsufructRent, setExcludeUsufructRent] = useState(false);
  const [alertFilter, setAlertFilter] = useState<AlertSeverityFilter>('all');
  const [vatViewMode, setVatViewMode] = useState<VatViewMode>('chart');
  const [selectedVatMonthKey, setSelectedVatMonthKey] = useState<string | null>(null);
  const [logoLoadError, setLogoLoadError] = useState(false);

  // Cost Center Operating Expense Budget & Proactive Alert Controls
  const [warningThresholdPct, setWarningThresholdPct] = useState<number>(85);
  const [costCenterFilter, setCostCenterFilter] = useState<CostCenterAlertFilter>('all');
  const [costCenterBudgets, setCostCenterBudgets] = useState<Record<CostCenterId, number>>(loadSavedBudgets);
  const [isEditingBudgets, setIsEditingBudgets] = useState(false);
  const [acknowledgedCcIds, setAcknowledgedCcIds] = useState<string[]>([]);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [selectedCcId, setSelectedCcId] = useState<CostCenterId | null>(null);

  // Smart Food Cost Variance (Actual vs Theoretical Recipe Cost > 5%) State & Notifications
  const [foodCostThresholdPct, setFoodCostThresholdPct] = useState<number>(5);
  const [foodCostFilter, setFoodCostFilter] = useState<FoodCostFilter>('all');
  const [foodCostBannerDismissed, setFoodCostBannerDismissed] = useState(false);
  const [showFoodCostNotifLog, setShowFoodCostNotifLog] = useState(false);
  const [foodCostNotifications, setFoodCostNotifications] = useState<FoodCostNotification[]>(
    loadSavedFoodCostNotifications
  );
  const [activeToastNotif, setActiveToastNotif] = useState<FoodCostNotification | null>(null);
  const lastAutoNotifSignatureRef = useRef<string>('');

  // Stocktake Variance (Actual Count vs Book Inventory > 2%) State & Instant Notifications
  const [stocktakeThresholdPct, setStocktakeThresholdPct] = useState<number>(2);
  const [stocktakeFilter, setStocktakeFilter] = useState<StocktakeFilter>('all');
  const [stocktakeBannerDismissed, setStocktakeBannerDismissed] = useState(false);
  const [showStocktakeNotifLog, setShowStocktakeNotifLog] = useState(false);
  const [reconcilingStocktakeId, setReconcilingStocktakeId] = useState<string | null>(null);
  const [stocktakeNotifications, setStocktakeNotifications] = useState<StocktakeVarianceNotification[]>(
    loadSavedStocktakeNotifications
  );
  const [activeStocktakeToast, setActiveStocktakeToast] = useState<StocktakeVarianceNotification | null>(null);
  const lastStocktakeNotifSigRef = useRef<string>('');

  // Automated Consecutive MoM Revenue Growth (< 5% for 2+ months) Alerts
  const [revGrowthThresholdPct, setRevGrowthThresholdPct] = useState<number>(5);
  const [revConsecutiveTarget, setRevConsecutiveTarget] = useState<number>(2);
  const [revGrowthBannerDismissed, setRevGrowthBannerDismissed] = useState(false);
  const [showRevGrowthNotifLog, setShowRevGrowthNotifLog] = useState(false);
  const [revGrowthNotifications, setRevGrowthNotifications] = useState<RevenueGrowthAlertNotification[]>(
    loadSavedRevenueGrowthNotifications
  );
  const [activeRevGrowthToast, setActiveRevGrowthToast] = useState<RevenueGrowthAlertNotification | null>(null);
  const lastRevGrowthNotifSigRef = useRef<string>('');

  const openPerformanceReviewDrilldown = () => {
    setActiveRevGrowthToast(null);
    if (onOpenPerformanceReview) {
      onOpenPerformanceReview();
    } else {
      onNavigate('cfo_review');
    }
  };

  // Quick Investment ROI Simulator (80% Unused Land) synced with InvestmentRoiSimulatorModule
  const [quickRoiInputs, setQuickRoiInputs] = useState<RoiSimulatorInputs>(loadSavedRoiInputs);
  const quickRoiSim = useMemo(() => runRoiSimulation(quickRoiInputs), [quickRoiInputs]);

  // Board-Ready CFO A4 Print Preview & Sections
  const [cfoPrintPreviewOpen, setCfoPrintPreviewOpen] = useState(false);
  const [cfoPrintSections, setCfoPrintSections] = useState<CfoPrintSectionId[]>(ALL_CFO_PRINT_SECTIONS);
  const [cfoPrintCurrentViewMode, setCfoPrintCurrentViewMode] = useState(false);

  const updateQuickRoi = (patch: Partial<RoiSimulatorInputs>) => {
    setQuickRoiInputs((prev) => {
      const next: RoiSimulatorInputs = {
        ...prev,
        presetId: patch.presetId ?? 'custom',
        ...patch,
      };
      try {
        localStorage.setItem(ROI_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore storage quota errors
      }
      return next;
    });
  };

  const balances = useMemo(() => computeAccountBalances(state), [state]);
  const strat = state.strategy2027;

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

  const inventoryValue = useMemo(
    () => round2(state.ingredients.reduce((acc, i) => acc + i.currentQty * i.weightedAvgCost, 0)),
    [state.ingredients]
  );

  const metrics = useMemo(() => {
    const rows =
      period === 'Q1' || period === 'Q2' || period === 'Q3'
        ? state.monthlyActuals2026.filter((m) => m.quarter === period)
        : state.monthlyActuals2026;

    let gross = rows.reduce((a, m) => a + m.grossRevenue, 0);
    let net = rows.reduce((a, m) => a + m.netRevenue, 0);
    let vat = rows.reduce((a, m) => a + m.vatOutput, 0);
    let cogs = rows.reduce((a, m) => a + m.cogs, 0);
    let payroll = rows.reduce((a, m) => a + m.payroll, 0);
    let rent = rows.reduce((a, m) => a + m.usufructRent, 0);
    let otherOpex = rows.reduce((a, m) => a + m.electricity + m.otherOpex, 0);
    let bankFees = rows.reduce((a, m) => a + m.bankFeesNet, 0);

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
    const monthsCount = rows.length;
    const breakEvenMonthlyNet = cmRatio > 0 ? round2((totalExpenses / monthsCount) / cmRatio) : 0;

    return {
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

  const monthlyTrendSeries = useMemo(() => {
    const raw = buildMonthlyTrendSeries(state, excludeUsufructRent, period === '9m_plus_live');
    return raw.map((pt) => ({
      ...pt,
      shortMonth: lang === 'ar' ? pt.monthLabelAr.split(' ')[0] : pt.monthLabelEn.slice(0, 3),
      ebitdaActive: excludeUsufructRent ? pt.ebitdaExUsufruct : pt.ebitdaInclUsufruct,
    }));
  }, [state, excludeUsufructRent, period, lang]);

  const latestTrendStats = useMemo(() => {
    const audited = monthlyTrendSeries.filter((p) => p.quarter !== 'Q4');
    return audited[audited.length - 1] ?? monthlyTrendSeries[monthlyTrendSeries.length - 1];
  }, [monthlyTrendSeries]);

  // Automated Monitor: Detect when MoM Revenue Growth falls below threshold (default 5%) for 2+ consecutive months
  const revenueGrowthMonitor = useMemo(() => {
    const audited = monthlyTrendSeries.filter((p) => p.quarter !== 'Q4');
    let runningStreak = 0;

    const evaluatedMonths = audited.map((pt, idx) => {
      const prev = idx > 0 ? audited[idx - 1] : null;
      const momPct = pt.revMomPct;
      const deltaNetEgp = prev ? round2(pt.netRevenue - prev.netRevenue) : null;
      const isBelowThreshold = momPct !== null && momPct < revGrowthThresholdPct;
      runningStreak = isBelowThreshold ? runningStreak + 1 : 0;
      const gapToThresholdPct = momPct !== null ? round2(revGrowthThresholdPct - momPct) : null;

      return {
        ...pt,
        prevNetRevenue: prev?.netRevenue ?? null,
        deltaNetEgp,
        isBelowThreshold,
        consecutiveBelowCount: runningStreak,
        isConsecutiveTriggerMonth: runningStreak >= revConsecutiveTarget,
        gapToThresholdPct,
      };
    });

    type EvaluatedMonth = (typeof evaluatedMonths)[number];
    interface GrowthStreak {
      id: string;
      months: EvaluatedMonth[];
      length: number;
      startMonthKey: string;
      endMonthKey: string;
      rangeLabelAr: string;
      rangeLabelEn: string;
      avgMomPct: number;
      minMomPct: number;
    }

    const streaks: GrowthStreak[] = [];
    let currentRun: EvaluatedMonth[] = [];
    const flushRun = () => {
      if (currentRun.length >= revConsecutiveTarget) {
        const first = currentRun[0];
        const last = currentRun[currentRun.length - 1];
        const avgMomPct = round2(
          currentRun.reduce((acc, m) => acc + (m.revMomPct ?? 0), 0) / currentRun.length
        );
        const minMomPct = round2(Math.min(...currentRun.map((m) => m.revMomPct ?? 0)));
        streaks.push({
          id: `${first.month}_${last.month}`,
          months: [...currentRun],
          length: currentRun.length,
          startMonthKey: first.month,
          endMonthKey: last.month,
          rangeLabelAr: `${first.monthLabelAr} ← ${last.monthLabelAr}`,
          rangeLabelEn: `${first.monthLabelEn} → ${last.monthLabelEn}`,
          avgMomPct,
          minMomPct,
        });
      }
      currentRun = [];
    };

    evaluatedMonths.forEach((m) => {
      if (m.isBelowThreshold) {
        currentRun.push(m);
      } else {
        flushRun();
      }
    });
    flushRun();

    const latestStreak = streaks.length > 0 ? streaks[streaks.length - 1] : null;
    const latestPair =
      latestStreak && latestStreak.months.length >= 2
        ? latestStreak.months.slice(-2)
        : null;
    const belowMonthsCount = evaluatedMonths.filter((m) => m.isBelowThreshold).length;
    const maxConsecutiveStreak = evaluatedMonths.reduce(
      (mx, m) => Math.max(mx, m.consecutiveBelowCount),
      0
    );

    return {
      evaluatedMonths,
      streaks,
      latestStreak,
      latestPair,
      belowMonthsCount,
      maxConsecutiveStreak,
      triggered: streaks.length > 0,
    };
  }, [monthlyTrendSeries, revGrowthThresholdPct, revConsecutiveTarget]);

  const saveRevGrowthNotificationsToStorage = (items: RevenueGrowthAlertNotification[]) => {
    try {
      localStorage.setItem(REV_GROWTH_NOTIF_STORAGE_KEY, JSON.stringify(items.slice(0, 20)));
    } catch {
      // ignore storage errors
    }
  };

  const dispatchRevenueGrowthNotification = (channel: 'auto_monitor' | 'manual_dispatch') => {
    const latestStreak = revenueGrowthMonitor.latestStreak;
    const latestPair = revenueGrowthMonitor.latestPair;
    if (!latestStreak || !latestPair) return;

    const [mA, mB] = latestPair;
    const fmtSignedPct = (v: number | null) =>
      v === null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
    const nowLabel = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const sig = `REVMOM:${revGrowthThresholdPct}:${revConsecutiveTarget}:${latestStreak.endMonthKey}:${latestStreak.length}:${Math.round((mB.revMomPct ?? 0) * 10)}`;

    const pairAr = `${mA.shortMonth} (${fmtSignedPct(mA.revMomPct)}) و${mB.shortMonth} (${fmtSignedPct(mB.revMomPct)})`;
    const pairEn = `${mA.shortMonth} (${fmtSignedPct(mA.revMomPct)}) & ${mB.shortMonth} (${fmtSignedPct(mB.revMomPct)})`;

    const notif: RevenueGrowthAlertNotification = {
      id: `RGN-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      signature: sig,
      createdAt: `${nowLabel} UTC`,
      thresholdPct: revGrowthThresholdPct,
      consecutiveRequired: revConsecutiveTarget,
      streakLength: latestStreak.length,
      streakRangeAr: latestStreak.rangeLabelAr,
      streakRangeEn: latestStreak.rangeLabelEn,
      latestPairAr: pairAr,
      latestPairEn: pairEn,
      titleAr: `تنبيه تباطؤ نمو الإيرادات: ${latestStreak.length} شهور متتالية < ${revGrowthThresholdPct}% MoM`,
      titleEn: `MoM Revenue Slowdown Alert: ${latestStreak.length} Consecutive Months < ${revGrowthThresholdPct}%`,
      messageAr: `سجل صافي الإيراد نمواً شهرياً أقل من ${revGrowthThresholdPct}% لمدة ${latestStreak.length} شهور متتالية (${latestStreak.rangeLabelAr}) — آخر شهرين: ${pairAr}. يُنصح بمراجعة وحدة تقييم الأداء المالي فوراً.`,
      messageEn: `MoM net revenue growth fell below ${revGrowthThresholdPct}% for ${latestStreak.length} consecutive months (${latestStreak.rangeLabelEn}) — latest pair: ${pairEn}. Drill down into Performance Review.`,
      channel,
      acknowledged: false,
    };

    setRevGrowthNotifications((prev) => {
      const next = [notif, ...prev].slice(0, 20);
      saveRevGrowthNotificationsToStorage(next);
      return next;
    });
    setActiveRevGrowthToast(notif);

    if (typeof window !== 'undefined' && 'Notification' in window) {
      try {
        if (Notification.permission === 'granted') {
          new Notification(lang === 'ar' ? notif.titleAr : notif.titleEn, {
            body: lang === 'ar' ? notif.messageAr : notif.messageEn,
          });
        } else if (channel === 'manual_dispatch' && Notification.permission === 'default') {
          Notification.requestPermission()
            .then((perm) => {
              if (perm === 'granted') {
                new Notification(lang === 'ar' ? notif.titleAr : notif.titleEn, {
                  body: lang === 'ar' ? notif.messageAr : notif.messageEn,
                });
              }
            })
            .catch(() => {});
        }
      } catch {
        // ignore browser notification restrictions
      }
    }
  };

  useEffect(() => {
    if (!revenueGrowthMonitor.triggered || !revenueGrowthMonitor.latestStreak || !revenueGrowthMonitor.latestPair) {
      return;
    }
    const latestStreak = revenueGrowthMonitor.latestStreak;
    const latestMonth = revenueGrowthMonitor.latestPair[1];
    const sig = `REVMOM:${revGrowthThresholdPct}:${revConsecutiveTarget}:${latestStreak.endMonthKey}:${latestStreak.length}:${Math.round((latestMonth.revMomPct ?? 0) * 10)}`;
    if (lastRevGrowthNotifSigRef.current === sig) return;
    lastRevGrowthNotifSigRef.current = sig;

    const existing = revGrowthNotifications.find((n) => n.signature === sig && !n.acknowledged);
    if (!existing) {
      dispatchRevenueGrowthNotification('auto_monitor');
    } else {
      setActiveRevGrowthToast(existing);
    }
    setRevGrowthBannerDismissed(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    revGrowthThresholdPct,
    revConsecutiveTarget,
    revenueGrowthMonitor.triggered,
    revenueGrowthMonitor.latestStreak?.id,
    revenueGrowthMonitor.latestStreak?.length,
  ]);

  const unreadRevGrowthNotifCount = useMemo(
    () => revGrowthNotifications.filter((n) => !n.acknowledged).length,
    [revGrowthNotifications]
  );

  const waterfallSteps = useMemo(() => {
    return [
      { labelAr: 'إجمالي المبيعات', labelEn: 'Gross Sales', val: metrics.gross, running: metrics.gross, type: 'total' as const },
      { labelAr: 'ضريبة 14%', labelEn: 'VAT 14%', val: -metrics.vat, running: metrics.net, type: 'neg' as const },
      { labelAr: 'صافي الإيراد', labelEn: 'Net Revenue', val: metrics.net, running: metrics.net, type: 'subtotal' as const },
      { labelAr: 'COGS', labelEn: 'COGS', val: -metrics.cogs, running: metrics.gp, type: 'neg' as const },
      { labelAr: 'مجمل الربح', labelEn: 'Gross Profit', val: metrics.gp, running: metrics.gp, type: 'subtotal' as const },
      { labelAr: 'الرواتب والمنح', labelEn: 'Payroll', val: -metrics.payroll, running: metrics.gp - metrics.payroll, type: 'neg' as const },
      { labelAr: 'مرافق وبنك', labelEn: 'OpEx & Bank', val: -(metrics.otherOpex + metrics.bankFees), running: metrics.gp - metrics.payroll - metrics.otherOpex - metrics.bankFees, type: 'neg' as const },
      ...(excludeUsufructRent
        ? []
        : [{ labelAr: 'حق الانتفاع', labelEn: 'Usufruct', val: -metrics.rent, running: metrics.netProfit, type: 'neg' as const }]),
      { labelAr: excludeUsufructRent ? 'التشغيلي' : 'صافي النتيجة', labelEn: 'Net Result', val: metrics.netProfit, running: metrics.netProfit, type: 'final' as const },
    ];
  }, [metrics, excludeUsufructRent]);

  const maxChartVal = Math.max(metrics.gross, 13500000);
  const minChartVal = Math.min(metrics.netProfit, -4500000);
  const chartRange = maxChartVal - minChartVal;

  const cibBalance = balances['1102'] ?? 0;
  const clearing1103 = balances['1103'] ?? 0;

  const stockAlerts = useMemo(() => computeStockOpportunityAlerts(state), [state]);

  const alertSummary = useMemo(() => {
    const criticalCount = stockAlerts.filter((a) => a.severity === 'critical').length;
    const approachingCount = stockAlerts.filter((a) => a.severity === 'approaching').length;
    const totalDailyRevenueAtRisk = round2(stockAlerts.reduce((acc, a) => acc + a.dailyNetRevenueAtRisk, 0));
    const totalDailyOppCost = round2(stockAlerts.reduce((acc, a) => acc + a.dailyOpportunityCost, 0));
    const totalSevenDayOppCost = round2(stockAlerts.reduce((acc, a) => acc + a.sevenDayOpportunityCost, 0));
    return {
      criticalCount,
      approachingCount,
      totalDailyRevenueAtRisk,
      totalDailyOppCost,
      totalSevenDayOppCost,
    };
  }, [stockAlerts]);

  const filteredStockAlerts = useMemo(() => {
    if (alertFilter === 'all') return stockAlerts;
    return stockAlerts.filter((a) => a.severity === alertFilter);
  }, [stockAlerts, alertFilter]);

  const vatSummary = useMemo(
    () => computeCfoVatSummary(state, period, metrics.net, balances),
    [state, period, metrics.net, balances]
  );

  const activeVatMonth = useMemo(() => {
    if (vatSummary.monthlyBreakdown.length === 0) return null;
    return (
      vatSummary.monthlyBreakdown.find((m) => m.key === selectedVatMonthKey) ??
      vatSummary.monthlyBreakdown[vatSummary.monthlyBreakdown.length - 1]
    );
  }, [vatSummary.monthlyBreakdown, selectedVatMonthKey]);

  const handleExportVatCsv = () => {
    const headers = [
      'Period',
      'Net Taxable Sales (EGP)',
      'Output VAT 14% Acc 2201 (EGP)',
      'Deductible Purchases Base (EGP)',
      'Deductible Input VAT 14% Acc 1105 (EGP)',
      'Non-Deductible COGS Input VAT (EGP)',
      'Non-Deductible OpEx 5301 Input VAT (EGP)',
      'Total Non-Deductible Input VAT (EGP)',
      'Total Gross Input VAT Incurred (EGP)',
      'Deductibility Share (%)',
      'Input Offset vs Output (%)',
      'Net VAT Payable to ETA (EGP)',
      'MoM Change (%)',
    ];
    const rows = vatSummary.monthlyBreakdown.map((r) => [
      `"${lang === 'ar' ? r.labelAr : r.labelEn}"`,
      r.netSales.toFixed(2),
      r.outputVat.toFixed(2),
      r.purchasesNet.toFixed(2),
      r.deductibleInputVat.toFixed(2),
      r.nonDeductibleCogsVat.toFixed(2),
      r.nonDeductibleOpexVat.toFixed(2),
      r.nonDeductibleInputVat.toFixed(2),
      r.totalInputVatIncurred.toFixed(2),
      r.deductibilityPct.toFixed(2),
      r.offsetPct.toFixed(2),
      r.netPayable.toFixed(2),
      r.momDeltaPct !== null ? r.momDeltaPct.toFixed(2) : '',
    ]);
    rows.push([
      '"TOTAL"',
      metrics.net.toFixed(2),
      vatSummary.outputVat.toFixed(2),
      vatSummary.taxablePurchasesBase.toFixed(2),
      vatSummary.deductibleInputVat.toFixed(2),
      vatSummary.nonDeductibleCogsVat.toFixed(2),
      vatSummary.nonDeductibleOpexVat.toFixed(2),
      vatSummary.nonDeductibleInputVat.toFixed(2),
      vatSummary.totalInputVatIncurred.toFixed(2),
      vatSummary.deductibilityRatioPct.toFixed(2),
      vatSummary.recoveryRatioPct.toFixed(2),
      vatSummary.netVatPayable.toFixed(2),
      '',
    ]);
    const csv = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `estadat_vat_eta_audit_${period}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleUpdateCostCenterBudget = (ccId: CostCenterId, monthlyAmount: number) => {
    const safeVal = Math.max(1000, Math.round(monthlyAmount || 0));
    setCostCenterBudgets((prev) => {
      const next = { ...prev, [ccId]: safeVal };
      try {
        localStorage.setItem(BUDGET_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore storage quota errors
      }
      return next;
    });
    setBannerDismissed(false);
  };

  const handleResetBudgets = () => {
    setCostCenterBudgets(DEFAULT_COST_CENTER_BUDGETS);
    try {
      localStorage.setItem(BUDGET_STORAGE_KEY, JSON.stringify(DEFAULT_COST_CENTER_BUDGETS));
    } catch {
      // ignore storage errors
    }
    setAcknowledgedCcIds([]);
    setBannerDismissed(false);
  };

  const costCenterMonitor = useMemo(() => {
    const includeLive = period === '9m_plus_live';
    const liveWasteTotal = round2(
      state.wasteEntries
        .filter((w) => !w.id.startsWith('WST-SEED-'))
        .reduce((a, w) => a + w.totalValue, 0)
    );
    const liveExpensesByAcc = (accCodes: string[]) =>
      round2(
        state.expenses
          .filter((e) => !e.id.startsWith('EXP-SEED-') && accCodes.includes(e.categoryAccountCode))
          .reduce((a, e) => a + e.amountNet, 0)
      );

    const liveAdminExp = liveExpensesByAcc(['5301', '5305']);
    const liveHrExp = liveExpensesByAcc(['5201']);
    const liveFacilityExp = liveExpensesByAcc(['5202']);
    const liveTreasuryExp = liveExpensesByAcc(['5308']);

    const extraLiveMonth =
      includeLive && (livePosDelta.count > 0 || liveAdminExp > 0 || liveHrExp > 0 || liveWasteTotal > 0) ? 1 : 0;
    const budgetMonths = metrics.monthsCount + extraLiveMonth;

    const defs: {
      id: CostCenterId;
      nameAr: string;
      nameEn: string;
      accountsLabel: string;
      actual: number;
      actionAr: string;
      actionEn: string;
    }[] = [
      {
        id: 'CC-HR',
        nameAr: 'الموارد البشرية والرواتب والمنح',
        nameEn: 'HR, Payroll & Bonus Batches',
        accountsLabel: '5201',
        actual: round2(metrics.payroll + (includeLive ? liveHrExp : 0)),
        actionAr: 'ربط المنح الدورية بمؤشرات الربحية ومراجعة جدول الورديات',
        actionEn: 'Tie bonus batches to monthly profitability & audit shift rosters',
      },
      {
        id: 'CC-KITCHEN',
        nameAr: 'تكلفة المبيعات والخامات والهالك (COGS)',
        nameEn: 'COGS, Raw Materials & Waste',
        accountsLabel: '5101 / 5305',
        actual: round2(metrics.cogs + (includeLive ? liveWasteTotal : 0)),
        actionAr: 'مراجعة تكلفة الوصفات BOM وخفض نسبة الهدر إلى ≤ 1.5%',
        actionEn: 'Audit Recipe BOM costing & reduce raw spoilage to ≤ 1.5%',
      },
      {
        id: 'CC-ADMIN',
        nameAr: 'الإدارة والمرافق والكهرباء والصيانة',
        nameEn: 'Admin, Electricity & Utilities',
        accountsLabel: '5301',
        actual: round2(metrics.otherOpex + (includeLive ? liveAdminExp : 0)),
        actionAr: 'جدولة أحمال التكييف والأفران لوقف تصاعد فاتورة الكهرباء (43.1k)',
        actionEn: 'Schedule HVAC & oven loads to curb the 43.1k electricity spike',
      },
      {
        id: 'CC-FACILITY',
        nameAr: 'حق الانتفاع التعاقدي (محافظة المنوفية)',
        nameEn: 'Facility Usufruct Rent',
        accountsLabel: '5202',
        actual: round2(metrics.rent + (includeLive ? liveFacilityExp : 0)),
        actionAr: 'التجهيز المبكر للقسط الفصلي (1.275م) لتفادي غرامة التأخير',
        actionEn: 'Pre-fund quarterly 1.275M installment to avoid CBE delay penalty',
      },
      {
        id: 'CC-TREASURY',
        nameAr: 'الخزينة والعمولات البنكية (VISA / POS)',
        nameEn: 'Treasury & Bank / MDR Fees',
        accountsLabel: '5308',
        actual: round2(metrics.bankFees + (includeLive ? liveTreasuryExp : 0)),
        actionAr: 'مراجعة عمولة الفيزا مع بنك CIB بعد رصد انحراف مايو (3.52%)',
        actionEn: 'Reconcile CIB VISA MDR fees following May 3.52% anomaly',
      },
    ];

    const items = defs.map((def) => {
      const monthlyBudget = costCenterBudgets[def.id];
      const periodBudget = round2(monthlyBudget * budgetMonths);
      const utilizationPct = periodBudget > 0 ? round2((def.actual / periodBudget) * 100) : 0;
      const monthlyBurn = budgetMonths > 0 ? round2(def.actual / budgetMonths) : 0;
      const variance = round2(periodBudget - def.actual);
      const status: 'exceeded' | 'approaching' | 'safe' =
        utilizationPct >= 100 ? 'exceeded' : utilizationPct >= warningThresholdPct ? 'approaching' : 'safe';

      return {
        ...def,
        monthlyBudget,
        periodBudget,
        utilizationPct,
        monthlyBurn,
        variance,
        status,
        isAcknowledged: acknowledgedCcIds.includes(def.id),
      };
    });

    const totalBudget = round2(items.reduce((a, c) => a + c.periodBudget, 0));
    const totalActual = round2(items.reduce((a, c) => a + c.actual, 0));
    const overallUtilizationPct = totalBudget > 0 ? round2((totalActual / totalBudget) * 100) : 0;
    const exceededCount = items.filter((i) => i.status === 'exceeded').length;
    const approachingCount = items.filter((i) => i.status === 'approaching').length;
    const safeCount = items.filter((i) => i.status === 'safe').length;
    const activeWarnings = items
      .filter((i) => i.status !== 'safe' && !i.isAcknowledged)
      .sort((a, b) => b.utilizationPct - a.utilizationPct);

    return {
      items,
      budgetMonths,
      totalBudget,
      totalActual,
      overallUtilizationPct,
      exceededCount,
      approachingCount,
      safeCount,
      activeWarnings,
    };
  }, [
    period,
    metrics.payroll,
    metrics.cogs,
    metrics.otherOpex,
    metrics.rent,
    metrics.bankFees,
    metrics.monthsCount,
    state.wasteEntries,
    state.expenses,
    livePosDelta.count,
    costCenterBudgets,
    warningThresholdPct,
    acknowledgedCcIds,
  ]);

  const filteredCostCenters = useMemo(() => {
    const list =
      costCenterFilter === 'all'
        ? costCenterMonitor.items
        : costCenterMonitor.items.filter((i) => i.status === costCenterFilter);
    return [...list].sort((a, b) => b.utilizationPct - a.utilizationPct);
  }, [costCenterMonitor.items, costCenterFilter]);

  const foodCostVariance = useMemo(
    () => computeFoodCostVarianceAnalysis(state, period, foodCostThresholdPct),
    [state, period, foodCostThresholdPct]
  );

  const filteredRecipeVariances = useMemo(() => {
    if (foodCostFilter === 'exceeded') {
      return foodCostVariance.recipeVariances.filter((r) => r.exceedsThreshold);
    }
    if (foodCostFilter === 'within') {
      return foodCostVariance.recipeVariances.filter((r) => !r.exceedsThreshold);
    }
    return foodCostVariance.recipeVariances;
  }, [foodCostVariance.recipeVariances, foodCostFilter]);

  const saveNotificationsToStorage = (items: FoodCostNotification[]) => {
    try {
      localStorage.setItem(FC_NOTIF_STORAGE_KEY, JSON.stringify(items.slice(0, 20)));
    } catch {
      // ignore storage errors
    }
  };

  const dispatchFoodCostNotification = (opts: {
    channel: 'auto_monitor' | 'manual_dispatch';
    itemCode?: string;
    itemNameAr?: string;
    itemNameEn?: string;
    variancePct: number;
    varianceAmount: number;
  }) => {
    const nowLabel = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const sig = `${period}:${foodCostThresholdPct}:${opts.itemCode || 'PERIOD'}:${Math.round(opts.variancePct * 10)}`;
    const notif: FoodCostNotification = {
      id: `FCN-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      signature: sig,
      createdAt: `${nowLabel} UTC`,
      recipientAr: 'المراقب المالي + مدير المشتريات + CFO',
      recipientEn: 'Financial Controller + Purchasing + CFO',
      variancePct: opts.variancePct,
      varianceAmount: opts.varianceAmount,
      thresholdPct: foodCostThresholdPct,
      titleAr: opts.itemCode
        ? `تنبيه انحراف تكلفة الصنف ${opts.itemCode} (+${fmtPct(opts.variancePct, 1)} > ${foodCostThresholdPct}%)`
        : `تحذير انحراف تكلفة الغذاء للفترة (+${fmtPct(opts.variancePct, 1)} > ${foodCostThresholdPct}%)`,
      titleEn: opts.itemCode
        ? `Recipe Variance Alert: ${opts.itemCode} (+${fmtPct(opts.variancePct, 1)} > ${foodCostThresholdPct}%)`
        : `Period Food Cost Variance Alert (+${fmtPct(opts.variancePct, 1)} > ${foodCostThresholdPct}%)`,
      messageAr: opts.itemCode
        ? `تجاوزت التكلفة الفعلية لصنف "${opts.itemNameAr}" التكلفة النظرية للوصفة بنسبة +${fmtPct(opts.variancePct, 1)} (فجوة ${fmtMoney(opts.varianceAmount, 0)} ج.م).`
        : `التكلفة الفعلية للغذاء (${fmtPct(foodCostVariance.periodActualPct, 1)}) تجاوزت التكلفة النظرية للوصفات (${fmtPct(foodCostVariance.periodTheoreticalPct, 1)}) بانحراف +${fmtPct(opts.variancePct, 1)} (${fmtMoney(opts.varianceAmount, 0)} ج.م).`,
      messageEn: opts.itemCode
        ? `Actual cost for "${opts.itemNameEn}" exceeded Theoretical Recipe Cost by +${fmtPct(opts.variancePct, 1)} (${fmtMoney(opts.varianceAmount, 0)} EGP gap).`
        : `Actual food cost (${fmtPct(foodCostVariance.periodActualPct, 1)}) exceeded Theoretical Recipe Cost (${fmtPct(foodCostVariance.periodTheoreticalPct, 1)}) by +${fmtPct(opts.variancePct, 1)} (${fmtMoney(opts.varianceAmount, 0)} EGP).`,
      channel: opts.channel,
      acknowledged: false,
    };

    setFoodCostNotifications((prev) => {
      const next = [notif, ...prev].slice(0, 20);
      saveNotificationsToStorage(next);
      return next;
    });
    setActiveToastNotif(notif);

    // Trigger Web Notification if permission already granted, or request on manual click
    if (typeof window !== 'undefined' && 'Notification' in window) {
      try {
        if (Notification.permission === 'granted') {
          new Notification(lang === 'ar' ? notif.titleAr : notif.titleEn, {
            body: lang === 'ar' ? notif.messageAr : notif.messageEn,
          });
        } else if (opts.channel === 'manual_dispatch' && Notification.permission === 'default') {
          Notification.requestPermission().then((perm) => {
            if (perm === 'granted') {
              new Notification(lang === 'ar' ? notif.titleAr : notif.titleEn, {
                body: lang === 'ar' ? notif.messageAr : notif.messageEn,
              });
            }
          }).catch(() => {});
        }
      } catch {
        // ignore browser notification restrictions in embedded frames
      }
    }
  };

  // Auto-dispatch smart alert notification when variance exceeds > 5% threshold
  useEffect(() => {
    const signature = `${period}:${foodCostThresholdPct}:${Math.round(foodCostVariance.periodVariancePct * 10)}`;
    if (!foodCostVariance.exceedsThreshold) return;
    if (lastAutoNotifSignatureRef.current === signature) return;
    lastAutoNotifSignatureRef.current = signature;

    const alreadyRecorded = foodCostNotifications.some((n) => n.signature === signature && !n.acknowledged);
    if (!alreadyRecorded) {
      dispatchFoodCostNotification({
        channel: 'auto_monitor',
        variancePct: foodCostVariance.periodVariancePct,
        varianceAmount: foodCostVariance.periodVarianceAmount,
      });
    } else {
      const existing = foodCostNotifications.find((n) => n.signature === signature && !n.acknowledged);
      if (existing) setActiveToastNotif(existing);
    }
    setFoodCostBannerDismissed(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    period,
    foodCostThresholdPct,
    foodCostVariance.exceedsThreshold,
    foodCostVariance.periodVariancePct,
    foodCostVariance.periodVarianceAmount,
  ]);

  const unreadFoodCostNotifCount = useMemo(
    () => foodCostNotifications.filter((n) => !n.acknowledged).length,
    [foodCostNotifications]
  );

  // Stocktake vs Book Inventory (> 2% variance) Alerts
  const stocktakeVariance = useMemo(
    () => computeStocktakeVarianceAlerts(state, stocktakeThresholdPct),
    [state, stocktakeThresholdPct]
  );

  const filteredStocktakeItems = useMemo(() => {
    if (stocktakeFilter === 'exceeded') {
      return stocktakeVariance.items.filter(
        (i) => i.entry.status === 'pending_reconciliation' && i.exceedsThreshold
      );
    }
    if (stocktakeFilter === 'within') {
      return stocktakeVariance.items.filter((i) => !i.exceedsThreshold);
    }
    if (stocktakeFilter === 'reconciled') {
      return stocktakeVariance.items.filter((i) => i.entry.status === 'reconciled');
    }
    return stocktakeVariance.items;
  }, [stocktakeVariance.items, stocktakeFilter]);

  const topPendingStocktake = useMemo(
    () =>
      stocktakeVariance.items.find(
        (i) => i.entry.status === 'pending_reconciliation' && i.exceedsThreshold
      ) ?? null,
    [stocktakeVariance.items]
  );

  const saveStocktakeNotificationsToStorage = (items: StocktakeVarianceNotification[]) => {
    try {
      localStorage.setItem(STK_NOTIF_STORAGE_KEY, JSON.stringify(items.slice(0, 20)));
    } catch {
      // ignore storage errors
    }
  };

  const dispatchStocktakeNotification = (opts: {
    channel: 'auto_monitor' | 'manual_dispatch';
    stocktakeId?: string;
    ingredientId?: string;
    countNo?: string;
    ingredientNameAr?: string;
    ingredientNameEn?: string;
    variancePct?: number;
    varianceValue?: number;
  }) => {
    const targetItem =
      (opts.stocktakeId
        ? stocktakeVariance.items.find((i) => i.entry.id === opts.stocktakeId)
        : topPendingStocktake) ?? stocktakeVariance.items[0];
    if (!targetItem) return;

    const nowLabel = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const usedPct = opts.variancePct ?? targetItem.signedVariancePct;
    const usedVal = opts.varianceValue ?? targetItem.varianceValue;
    const usedCountNo = opts.countNo ?? targetItem.entry.countNo;
    const usedNameAr = opts.ingredientNameAr ?? targetItem.entry.ingredientNameAr;
    const usedNameEn = opts.ingredientNameEn ?? targetItem.entry.ingredientNameEn;
    const sig = `STK:${stocktakeThresholdPct}:${stocktakeVariance.pendingExceedingCount}:${targetItem.entry.id}:${Math.round(usedPct * 100)}`;

    const notif: StocktakeVarianceNotification = {
      id: `STKN-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      signature: sig,
      createdAt: `${nowLabel} UTC`,
      stocktakeId: targetItem.entry.id,
      ingredientId: targetItem.entry.ingredientId,
      countNo: usedCountNo,
      exceedingCount: stocktakeVariance.pendingExceedingCount,
      maxAbsVariancePct: stocktakeVariance.maxAbsVariancePct,
      netVarianceValue: stocktakeVariance.netVarianceValue,
      thresholdPct: stocktakeThresholdPct,
      titleAr:
        opts.stocktakeId
          ? `فارق جرد فوري: ${usedNameAr} (${usedPct > 0 ? '+' : ''}${fmtPct(usedPct, 2)})`
          : `تنبيه جرد المخزون: ${stocktakeVariance.pendingExceedingCount} أصناف بانحراف > ${stocktakeThresholdPct}%`,
      titleEn:
        opts.stocktakeId
          ? `Stocktake Variance Alert: ${usedNameEn} (${usedPct > 0 ? '+' : ''}${fmtPct(usedPct, 2)})`
          : `Inventory Count Variance Alert: ${stocktakeVariance.pendingExceedingCount} SKUs > ${stocktakeThresholdPct}%`,
      messageAr: `محضر ${usedCountNo} (${usedNameAr}): الفعلي ${fmtMoney(targetItem.entry.actualQty, 1)} مقابل الدفتري ${fmtMoney(targetItem.liveBookQty, 1)} ${targetItem.entry.unit} (انحراف ${usedPct > 0 ? '+' : ''}${fmtPct(usedPct, 2)} / ${usedVal > 0 ? '+' : ''}${fmtMoney(usedVal, 0)} ج.م).`,
      messageEn: `Count ${usedCountNo} (${usedNameEn}): Actual ${fmtMoney(targetItem.entry.actualQty, 1)} vs Book ${fmtMoney(targetItem.liveBookQty, 1)} ${targetItem.entry.unit} (Variance ${usedPct > 0 ? '+' : ''}${fmtPct(usedPct, 2)} / ${usedVal > 0 ? '+' : ''}${fmtMoney(usedVal, 0)} EGP).`,
      channel: opts.channel,
      acknowledged: false,
    };

    setStocktakeNotifications((prev) => {
      const next = [notif, ...prev].slice(0, 20);
      saveStocktakeNotificationsToStorage(next);
      return next;
    });
    setActiveStocktakeToast(notif);

    if (typeof window !== 'undefined' && 'Notification' in window) {
      try {
        if (Notification.permission === 'granted') {
          new Notification(lang === 'ar' ? notif.titleAr : notif.titleEn, {
            body: lang === 'ar' ? notif.messageAr : notif.messageEn,
          });
        } else if (opts.channel === 'manual_dispatch' && Notification.permission === 'default') {
          Notification.requestPermission()
            .then((perm) => {
              if (perm === 'granted') {
                new Notification(lang === 'ar' ? notif.titleAr : notif.titleEn, {
                  body: lang === 'ar' ? notif.messageAr : notif.messageEn,
                });
              }
            })
            .catch(() => {});
        }
      } catch {
        // ignore browser notification restrictions
      }
    }
  };

  useEffect(() => {
    if (stocktakeVariance.pendingExceedingCount === 0 || !topPendingStocktake) return;
    const sig = `STK:${stocktakeThresholdPct}:${stocktakeVariance.pendingExceedingCount}:${topPendingStocktake.entry.id}:${Math.round(topPendingStocktake.signedVariancePct * 100)}`;
    if (lastStocktakeNotifSigRef.current === sig) return;
    lastStocktakeNotifSigRef.current = sig;

    const existing = stocktakeNotifications.find((n) => n.signature === sig && !n.acknowledged);
    if (!existing) {
      dispatchStocktakeNotification({
        channel: 'auto_monitor',
        stocktakeId: topPendingStocktake.entry.id,
      });
    } else {
      setActiveStocktakeToast(existing);
    }
    setStocktakeBannerDismissed(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    stocktakeThresholdPct,
    stocktakeVariance.pendingExceedingCount,
    topPendingStocktake?.entry.id,
    topPendingStocktake?.signedVariancePct,
  ]);

  const unreadStocktakeNotifCount = useMemo(
    () => stocktakeNotifications.filter((n) => !n.acknowledged).length,
    [stocktakeNotifications]
  );

  const openReconcileTarget = (stocktakeId?: string, ingredientId?: string) => {
    setActiveStocktakeToast(null);
    if (onNavigateToStocktakeReconcile) {
      onNavigateToStocktakeReconcile({ stocktakeId, ingredientId });
    } else {
      onNavigate('inventory');
    }
  };

  const handleInlineReconcile = async (stocktakeId: string) => {
    if (!onReconcileStocktake) {
      openReconcileTarget(stocktakeId);
      return;
    }
    setReconcilingStocktakeId(stocktakeId);
    try {
      await onReconcileStocktake(stocktakeId);
      setStocktakeNotifications((prev) => {
        const updated = prev.map((n) =>
          n.stocktakeId === stocktakeId ? { ...n, acknowledged: true } : n
        );
        saveStocktakeNotificationsToStorage(updated);
        return updated;
      });
      if (activeStocktakeToast?.stocktakeId === stocktakeId) {
        setActiveStocktakeToast(null);
      }
    } finally {
      setReconcilingStocktakeId(null);
    }
  };

  return (
    <>
    <div className="space-y-6 no-print">
      {/* Executive Header & Filter Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex items-start sm:items-center gap-3.5">
          {!logoLoadError && (
            <div className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 h-12 shrink-0 flex items-center justify-center">
              <img
                src="/assets/aistudio/estadat_8cd1ae06.jpeg"
                alt="Estadat Sports Investment"
                referrerPolicy="no-referrer"
                onError={() => setLogoLoadError(true)}
                className="h-8 w-auto object-contain"
              />
            </div>
          )}
          <div>
            <h1 className="text-xl font-bold text-slate-900">
              {t(lang, 'برج المنوفية — لوحة التحكم المالية التنفيذية (يناير – سبتمبر 2026)', 'Menoufia Tower — Executive CFO Dashboard (Jan–Sep 2026)')}
            </h1>
            <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-slate-500">
              <span>{t(lang, 'شركة استادات لإدارة المنشآت الرياضية', 'Estadat Sports Facilities Management')}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono-num" dir="ltr">ق.م: {state.taxId}</span>
              <span aria-hidden="true">·</span>
              <span>{t(lang, 'تحديث أكتوبر 2026 (9M فعلي + استراتيجية 2027)', 'Oct 2026 Update (9M Actuals + 2027 Plan)')}</span>
              {livePosDelta.count > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-teal-700 font-medium">
                    {t(lang, `${livePosDelta.count} فاتورة POS مباشرة`, `${livePosDelta.count} live POS invoices`)}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
            {(
              [
                { id: '9m_ytd', ar: '9 شهور (يناير–سبتمبر)', en: '9M YTD' },
                { id: 'Q1', ar: 'Q1', en: 'Q1' },
                { id: 'Q2', ar: 'Q2', en: 'Q2' },
                { id: 'Q3', ar: 'Q3', en: 'Q3' },
                { id: '9m_plus_live', ar: '9M + المباشر', en: '9M + Live' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                onClick={() => setPeriod(opt.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  period === opt.id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {lang === 'ar' ? opt.ar : opt.en}
              </button>
            ))}
          </div>

          <button
            onClick={() => setExcludeUsufructRent(!excludeUsufructRent)}
            className={`px-3 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
              excludeUsufructRent
                ? 'bg-teal-700 border-teal-700 text-white'
                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            {excludeUsufructRent
              ? t(lang, 'عرض: بدون حق الانتفاع', 'View: Ex-Usufruct')
              : t(lang, 'شامل حق الانتفاع (5.1م/2027)', 'Incl. Usufruct (5.1M/27)')}
          </button>

          <a
            href="#cfo-risk-register"
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 hover:bg-red-100/70 dark:hover:bg-red-950/60 transition-colors whitespace-nowrap shrink-0 no-print"
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>
              {t(
                lang,
                `سجل المخاطر (${(strat.risks ?? []).filter((r) => r.impact === 'high' && r.status !== 'mitigated').length} High)`,
                `Risk Status (${(strat.risks ?? []).filter((r) => r.impact === 'high' && r.status !== 'mitigated').length} High)`
              )}
            </span>
          </a>

          <button
            onClick={() => onNavigate('roi_simulator')}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-teal-700 text-white hover:bg-teal-800 transition-colors whitespace-nowrap shrink-0 no-print cursor-pointer"
          >
            <LandPlot className="w-3.5 h-3.5" />
            <span>{t(lang, 'محاكي العائد ROI (80% فراغ)', 'Investment ROI Simulator')}</span>
          </button>

          <button
            onClick={() => onNavigate('cfo_review')}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 no-print cursor-pointer"
          >
            <span>{t(lang, 'دراسة 10M وحق الانتفاع (PDF / PPTX)', '10M CFO Review (PDF / PPTX)')}</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => {
              setCfoPrintCurrentViewMode(true);
              setCfoPrintSections(['exec_pnl']);
              setCfoPrintPreviewOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 no-print cursor-pointer"
            title={t(
              lang,
              'فتح نافذة الطباعة بإعداد مسبق لالتقاط بطاقات KPI الحالية والرسوم البيانية في تقرير PDF',
              'Open print modal pre-configured to capture active KPI cards and MoM trend charts as PDF'
            )}
          >
            <FileDown className="w-3.5 h-3.5" />
            <span>{t(lang, 'تصدير العرض الحالي كـ PDF', 'Export Current View as PDF')}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setCfoPrintCurrentViewMode(false);
              setCfoPrintSections(ALL_CFO_PRINT_SECTIONS);
              setCfoPrintPreviewOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 no-print cursor-pointer"
            title={t(lang, 'معاينة وتنسيق الطباعة الجاهزة للمدير المالي (A4)', 'Preview & configure CFO board-ready A4 print')}
          >
            <Printer className="w-3.5 h-3.5 text-teal-700" />
            <span>{t(lang, 'معاينة طباعة CFO (A4)', 'CFO Print Preview')}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setCfoPrintCurrentViewMode(false);
              window.print();
            }}
            className="p-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-50 no-print cursor-pointer"
            title={t(lang, 'طباعة حزمة CFO الجاهزة مباشرة (A4)', 'Print CFO A4 Pack Now')}
          >
            <Printer className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Top Automated Revenue Growth Alert Banner (< 5% MoM for 2+ Consecutive Months) */}
      {!revGrowthBannerDismissed &&
        revenueGrowthMonitor.triggered &&
        revenueGrowthMonitor.latestStreak &&
        revenueGrowthMonitor.latestPair && (
          <div
            role="alert"
            className="rounded-xl border border-red-200 dark:border-red-800/80 bg-red-50/90 dark:bg-red-950/45 text-red-950 dark:text-red-100 px-4 py-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3"
          >
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg border border-red-200 dark:border-red-700 bg-red-100 dark:bg-red-900/60 text-red-700 dark:text-red-300 shrink-0">
                <TrendingDown className="w-4 h-4" />
              </div>
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
                  <span>
                    {t(
                      lang,
                      `تنبيه تلقائي لتباطؤ نمو الإيرادات (نمو شهري < ${revGrowthThresholdPct}% لـ ${revConsecutiveTarget}+ شهور متتالية):`,
                      `Automated Revenue Growth Alert (MoM Growth < ${revGrowthThresholdPct}% for ${revConsecutiveTarget}+ Consecutive Months):`
                    )}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-white/90 dark:bg-slate-900 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300 font-mono-num text-[11px]" dir="ltr">
                    {revenueGrowthMonitor.latestStreak.length} {t(lang, 'شهور متتالية', 'Consecutive Mos')} ·{' '}
                    {lang === 'ar'
                      ? revenueGrowthMonitor.latestStreak.rangeLabelAr
                      : revenueGrowthMonitor.latestStreak.rangeLabelEn}
                  </span>
                </div>
                <p className="text-xs text-red-900/85 dark:text-red-200/85">
                  {(() => {
                    const [mA, mB] = revenueGrowthMonitor.latestPair!;
                    const pA = mA.revMomPct ?? 0;
                    const pB = mB.revMomPct ?? 0;
                    return t(
                      lang,
                      `تم رصد ${revenueGrowthMonitor.streaks.length} موجات تباطؤ متتالية في 2026، أحدثها في ${mA.monthLabelAr} (${pA >= 0 ? '+' : ''}${pA.toFixed(1)}%) و${mB.monthLabelAr} (${pB >= 0 ? '+' : ''}${pB.toFixed(1)}%) — أقل من المستهدف (+${revGrowthThresholdPct}.0%).`,
                      `Detected ${revenueGrowthMonitor.streaks.length} consecutive slowdown streak(s) in 2026. Most recent consecutive pair: ${mA.monthLabelEn} (${pA >= 0 ? '+' : ''}${pA.toFixed(1)}%) & ${mB.monthLabelEn} (${pB >= 0 ? '+' : ''}${pB.toFixed(1)}%) vs +${revGrowthThresholdPct}.0% threshold.`
                    );
                  })()}
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {revenueGrowthMonitor.streaks.map((st) => (
                    <a
                      key={st.id}
                      href="#revenue-growth-alerts"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-red-200 dark:border-red-700 bg-white dark:bg-slate-900 text-red-800 dark:text-red-200 text-[11px] font-semibold hover:bg-red-50 dark:hover:bg-red-950/60 transition-colors"
                    >
                      <span className="font-mono-num" dir="ltr">
                        {lang === 'ar' ? st.rangeLabelAr : st.rangeLabelEn}
                      </span>
                      <span className="text-slate-400">·</span>
                      <span className="font-mono-num font-bold text-red-700 dark:text-red-300" dir="ltr">
                        Avg {st.avgMomPct >= 0 ? '+' : ''}{st.avgMomPct.toFixed(1)}% MoM
                      </span>
                    </a>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={openPerformanceReviewDrilldown}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-700 hover:bg-red-800 text-white text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors"
              >
                <span>{t(lang, 'فحص التفاصيل: وحدة مراجعة الأداء', 'Drill-Down: Performance Review')}</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
              <a
                href="#revenue-growth-alerts"
                className="px-3 py-1.5 rounded-lg border border-red-300 dark:border-red-700 bg-white dark:bg-slate-900 text-red-800 dark:text-red-200 text-xs font-semibold whitespace-nowrap hover:bg-red-50 dark:hover:bg-red-950/60 transition-colors"
              >
                {t(lang, 'السجل الشهري MoM', 'Monthly MoM Table')}
              </a>
              <button
                type="button"
                onClick={() => setRevGrowthBannerDismissed(true)}
                aria-label={t(lang, 'إخفاء تنبيه نمو الإيرادات', 'Dismiss revenue growth alert')}
                className="p-1.5 rounded-lg border border-red-300/70 dark:border-red-700 bg-white/70 dark:bg-slate-900/70 text-red-700 dark:text-red-300 hover:text-red-950 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

      {/* Top Proactive Cost-Center Visual Warning Banner */}
      {!bannerDismissed && costCenterMonitor.activeWarnings.length > 0 && (
        <div
          role="alert"
          className={`rounded-xl border px-4 py-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3 ${
            costCenterMonitor.exceededCount > 0
              ? 'bg-red-50/80 dark:bg-red-950/40 border-red-200 dark:border-red-800/80 text-red-950 dark:text-red-100'
              : 'bg-amber-50/80 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/80 text-amber-950 dark:text-amber-100'
          }`}
        >
          <div className="flex items-start gap-3">
            <div
              className={`p-2 rounded-lg border shrink-0 ${
                costCenterMonitor.exceededCount > 0
                  ? 'bg-red-100 dark:bg-red-900/60 border-red-200 dark:border-red-700 text-red-700 dark:text-red-300'
                  : 'bg-amber-100 dark:bg-amber-900/60 border-amber-200 dark:border-amber-700 text-amber-700 dark:text-amber-300'
              }`}
            >
              <BellRing className="w-4 h-4" />
            </div>
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
                <span>
                  {t(
                    lang,
                    'تنبيه استباقي لميزانية مراكز التكلفة:',
                    'Proactive Cost Center Budget Warning:'
                  )}
                </span>
                <span>
                  {t(
                    lang,
                    `${costCenterMonitor.exceededCount} تجاوز السقف (≥100%) و ${costCenterMonitor.approachingCount} اقترب من الحد (≥${warningThresholdPct}%)`,
                    `${costCenterMonitor.exceededCount} Exceeded (≥100%) · ${costCenterMonitor.approachingCount} Approaching (≥${warningThresholdPct}%)`
                  )}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {costCenterMonitor.activeWarnings.map((warn) => (
                  <a
                    key={warn.id}
                    href="#cost-center-alerts"
                    onClick={() => setSelectedCcId(warn.id)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-semibold transition-colors ${
                      warn.status === 'exceeded'
                        ? 'bg-white dark:bg-slate-900 border-red-200 dark:border-red-700 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/60'
                        : 'bg-white dark:bg-slate-900 border-amber-200 dark:border-amber-700 text-amber-800 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/60'
                    }`}
                  >
                    <span className="font-mono-num" dir="ltr">{warn.id}</span>
                    <span>·</span>
                    <span>{lang === 'ar' ? warn.nameAr.split(' ')[0] : warn.nameEn.split(',')[0]}</span>
                    <span className="font-mono-num font-bold" dir="ltr">({fmtPct(warn.utilizationPct, 1)})</span>
                  </a>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <a
              href="#cost-center-alerts"
              className="px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold whitespace-nowrap hover:opacity-90 transition-opacity"
            >
              {t(lang, 'فحص مراكز التكلفة', 'Inspect Cost Centers')}
            </a>
            <button
              type="button"
              onClick={() => setBannerDismissed(true)}
              aria-label={t(lang, 'إخفاء التنبيه مؤقتاً', 'Dismiss warning banner')}
              className="p-1.5 rounded-lg border border-slate-300/70 dark:border-slate-700 bg-white/70 dark:bg-slate-900/70 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Top Smart Food Cost Variance (>5%) Notification Banner */}
      {!foodCostBannerDismissed &&
        (foodCostVariance.exceedsThreshold || foodCostVariance.exceedingRecipesCount > 0) && (
          <div
            role="alert"
            className="rounded-xl border border-red-200 dark:border-red-800/80 bg-red-50/85 dark:bg-red-950/45 text-red-950 dark:text-red-100 px-4 py-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3"
          >
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg border border-red-200 dark:border-red-700 bg-red-100 dark:bg-red-900/60 text-red-700 dark:text-red-300 shrink-0">
                <Calculator className="w-4 h-4" />
              </div>
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
                  <span>
                    {t(
                      lang,
                      `إشعار انحراف تكلفة الغذاء (تجاوز حد ${foodCostThresholdPct}%):`,
                      `Smart Food Cost Variance Alert (>${foodCostThresholdPct}% Threshold):`
                    )}
                  </span>
                  <span className="font-mono-num text-red-700 dark:text-red-300" dir="ltr">
                    {foodCostVariance.periodVariancePct >= 0 ? '+' : ''}
                    {fmtPct(foodCostVariance.periodVariancePct, 1)} (
                    {fmtMoney(foodCostVariance.periodVarianceAmount, 0)} {t(lang, 'ج.م', 'EGP')})
                  </span>
                </div>
                <p className="text-xs text-red-900/85 dark:text-red-200/85">
                  {t(
                    lang,
                    `التكلفة الفعلية (${fmtPct(foodCostVariance.periodActualPct, 1)}) مقابل النظرية للوصفات (${fmtPct(foodCostVariance.periodTheoreticalPct, 1)}) — ${foodCostVariance.exceedingRecipesCount} أصناف و${foodCostVariance.exceedingMonthsCount} شهور تجاوزت الانحراف المسموح (${foodCostThresholdPct}%).`,
                    `Actual Food Cost (${fmtPct(foodCostVariance.periodActualPct, 1)}) vs Theoretical Recipe (${fmtPct(foodCostVariance.periodTheoreticalPct, 1)}) — ${foodCostVariance.exceedingRecipesCount} dishes & ${foodCostVariance.exceedingMonthsCount} months exceeded the ${foodCostThresholdPct}% limit.`
                  )}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() =>
                  dispatchFoodCostNotification({
                    channel: 'manual_dispatch',
                    variancePct: foodCostVariance.periodVariancePct,
                    varianceAmount: foodCostVariance.periodVarianceAmount,
                  })
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-700 hover:bg-red-800 text-white text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{t(lang, 'إرسال إشعار للرقابة المالية والمشتريات', 'Send Alert to Finance & Purchasing')}</span>
              </button>
              <a
                href="#food-cost-variance-alerts"
                className="px-3 py-1.5 rounded-lg border border-red-300 dark:border-red-700 bg-white dark:bg-slate-900 text-red-800 dark:text-red-200 text-xs font-semibold whitespace-nowrap hover:bg-red-50 dark:hover:bg-red-950/60 transition-colors"
              >
                {t(lang, 'تحليل الوصفات', 'Inspect Recipes')}
              </a>
              <button
                type="button"
                onClick={() => setFoodCostBannerDismissed(true)}
                aria-label={t(lang, 'إخفاء إشعار تكلفة الغذاء', 'Dismiss food cost alert')}
                className="p-1.5 rounded-lg border border-red-300/70 dark:border-red-700 bg-white/70 dark:bg-slate-900/70 text-red-700 dark:text-red-300 hover:text-red-950 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

      {/* Top Instant Stocktake Variance (>2%) Alert Banner with Direct Reconciliation Link */}
      {!stocktakeBannerDismissed && stocktakeVariance.pendingExceedingCount > 0 && (
        <div
          role="alert"
          className="rounded-xl border border-amber-300 dark:border-amber-700/80 bg-amber-50/90 dark:bg-amber-950/45 text-amber-950 dark:text-amber-100 px-4 py-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3"
        >
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-300 shrink-0">
              <ClipboardCheck className="w-4 h-4" />
            </div>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
                <span>
                  {t(
                    lang,
                    `إشعار انحراف الجرد الفعلي عن المخزون الدفتري (> ${stocktakeThresholdPct}%):`,
                    `Physical vs. Book Inventory Variance Alert (> ${stocktakeThresholdPct}%):`
                  )}
                </span>
                <span className="font-mono-num text-red-700 dark:text-red-300" dir="ltr">
                  {stocktakeVariance.pendingExceedingCount} {t(lang, 'محاضر معلقة', 'Pending SKUs')} ·{' '}
                  {t(lang, 'أقصى انحراف', 'Max')} {fmtPct(stocktakeVariance.maxAbsVariancePct, 2)} ·{' '}
                  {stocktakeVariance.netVarianceValue >= 0 ? '+' : ''}
                  {fmtMoney(stocktakeVariance.netVarianceValue, 0)} EGP
                </span>
              </div>
              <p className="text-xs text-amber-900/85 dark:text-amber-200/85">
                {topPendingStocktake
                  ? t(
                      lang,
                      `أعلى فارق مرصود في ${topPendingStocktake.entry.ingredientNameAr} (${topPendingStocktake.entry.countNo}): الفعلي ${fmtMoney(topPendingStocktake.entry.actualQty, 1)} مقابل الدفتري ${fmtMoney(topPendingStocktake.liveBookQty, 1)} ${topPendingStocktake.entry.unit}.`,
                      `Top variance in ${topPendingStocktake.entry.ingredientNameEn} (${topPendingStocktake.entry.countNo}): Actual ${fmtMoney(topPendingStocktake.entry.actualQty, 1)} vs Book ${fmtMoney(topPendingStocktake.liveBookQty, 1)} ${topPendingStocktake.entry.unit}.`
                    )
                  : null}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() =>
                openReconcileTarget(
                  topPendingStocktake?.entry.id,
                  topPendingStocktake?.entry.ingredientId
                )
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-700 hover:bg-red-800 text-white text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors"
            >
              <span>{t(lang, 'تسوية الفارق مباشرة', 'Reconcile Discrepancy')}</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
            <a
              href="#stocktake-variance-alerts"
              className="px-3 py-1.5 rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-900 text-amber-900 dark:text-amber-200 text-xs font-semibold whitespace-nowrap hover:bg-amber-50 dark:hover:bg-amber-950/60 transition-colors"
            >
              {t(lang, 'جدول محاضر الجرد', 'Inspect Counts')}
            </a>
            <button
              type="button"
              onClick={() => setStocktakeBannerDismissed(true)}
              aria-label={t(lang, 'إخفاء إشعار جرد المخزون', 'Dismiss stocktake variance alert')}
              className="p-1.5 rounded-lg border border-amber-300/70 dark:border-amber-700 bg-white/70 dark:bg-slate-900/70 text-amber-800 dark:text-amber-300 hover:text-amber-950 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Proactive Inventory Stock-Out & Opportunity Cost Alert Center */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-slate-50/60">
          <div className="flex items-start gap-3">
            <div className={`p-2 rounded-lg border shrink-0 ${
              alertSummary.criticalCount > 0
                ? 'bg-red-50 border-red-200 text-red-700'
                : stockAlerts.length > 0
                ? 'bg-amber-50 border-amber-200 text-amber-700'
                : 'bg-emerald-50 border-emerald-200 text-emerald-700'
            }`}>
              {alertSummary.criticalCount > 0 ? (
                <OctagonAlert className="w-5 h-5" />
              ) : stockAlerts.length > 0 ? (
                <AlertTriangle className="w-5 h-5" />
              ) : (
                <CheckCircle2 className="w-5 h-5" />
              )}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-bold text-slate-900">
                  {t(
                    lang,
                    'مركز التنبيهات الاستباقي لنفاذ الخامات وتكلفة الفرصة الضائعة',
                    'Proactive Raw Material Depletion & Opportunity Cost Alert Center'
                  )}
                </h2>
                {alertSummary.criticalCount > 0 && (
                  <span className="px-2 py-0.5 text-[11px] font-bold rounded border border-red-200 bg-red-50 text-red-700 font-mono-num">
                    {t(lang, `${alertSummary.criticalCount} حرج تحت حد الطلب`, `${alertSummary.criticalCount} Critical`)}
                  </span>
                )}
                {alertSummary.approachingCount > 0 && (
                  <span className="px-2 py-0.5 text-[11px] font-bold rounded border border-amber-200 bg-amber-50 text-amber-700 font-mono-num">
                    {t(lang, `${alertSummary.approachingCount} يقترب من النفاذ`, `${alertSummary.approachingCount} Approaching`)}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {t(
                  lang,
                  'يربط أرصدة المخزون ومعدل السحب اليومي بوصفات المنيو (BOM) لاحتساب هامش المساهمة المفقود عند تأخر التوريد.',
                  'Links live inventory & daily burn rates to Menu BOM recipes to quantify lost gross contribution if procurement is delayed.'
                )}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(
                [
                  { id: 'all', ar: `الكل (${stockAlerts.length})`, en: `All (${stockAlerts.length})` },
                  { id: 'critical', ar: `حرج (${alertSummary.criticalCount})`, en: `Critical (${alertSummary.criticalCount})` },
                  { id: 'approaching', ar: `اقتراب نفاذ (${alertSummary.approachingCount})`, en: `Approaching (${alertSummary.approachingCount})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setAlertFilter(tab.id)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    alertFilter === tab.id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {lang === 'ar' ? tab.ar : tab.en}
                </button>
              ))}
            </div>
            <button
              onClick={() => onNavigate('inventory')}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            >
              {t(lang, 'سجل المخزون', 'Inventory')}
            </button>
          </div>
        </div>

        {stockAlerts.length === 0 ? (
          <div className="p-6 flex items-center justify-between gap-4 text-xs text-emerald-800 bg-emerald-50/40">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0" />
              <div>
                <div className="font-bold">
                  {t(lang, 'جميع الخامات أعلى من حد إعادة الطلب (Reorder Level)', 'All Raw Ingredients Above Reorder Level')}
                </div>
                <div className="text-slate-600 mt-0.5">
                  {t(lang, 'لا توجد مخاطر انقطاع توريد حالياً — تكلفة الفرصة الضائعة = 0 ج.م.', 'No stock-out exposure detected — Current Opportunity Cost = 0 EGP.')}
                </div>
              </div>
            </div>
            <span className="font-mono-num font-bold text-emerald-700" dir="ltr">0.00 EGP</span>
          </div>
        ) : (
          <>
            {/* Financial Exposure Summary Strip */}
            <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x sm:rtl:divide-x-reverse divide-slate-200 border-b border-slate-200 bg-white">
              <div className="px-5 py-3 flex items-center justify-between gap-2">
                <span className="text-xs text-slate-600">
                  {t(lang, 'صافي الإيراد اليومي المعرّض للتوقف', 'Daily Net Revenue at Risk')}
                </span>
                <span className="text-sm font-bold font-mono-num text-slate-900" dir="ltr">
                  {fmtMoney(alertSummary.totalDailyRevenueAtRisk)} {t(lang, 'ج/يوم', 'EGP/d')}
                </span>
              </div>
              <div className="px-5 py-3 flex items-center justify-between gap-2">
                <span className="text-xs text-slate-600">
                  {t(lang, 'تكلفة الفرصة الضائعة اليومية (هامش مفقود)', 'Daily Opportunity Cost (Lost Margin)')}
                </span>
                <span className="text-sm font-bold font-mono-num text-amber-700" dir="ltr">
                  {fmtMoney(alertSummary.totalDailyOppCost)} {t(lang, 'ج/يوم', 'EGP/d')}
                </span>
              </div>
              <div className="px-5 py-3 flex items-center justify-between gap-2 bg-red-50/40">
                <span className="text-xs font-semibold text-red-900">
                  {t(lang, 'إجمالي تكلفة الفرصة الضائعة (تأخير 7 أيام)', '7-Day Delay Opportunity Cost')}
                </span>
                <span className="text-base font-bold font-mono-num text-red-700" dir="ltr">
                  {fmtMoney(alertSummary.totalSevenDayOppCost)} {t(lang, 'ج.م', 'EGP')}
                </span>
              </div>
            </div>

            {/* Alert Rows Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'الخام / SKU', 'Ingredient / SKU')}</th>
                    <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'الحالة', 'Alert Status')}</th>
                    <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'الرصيد / حد الطلب', 'Stock / Reorder')}</th>
                    <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'التغطية المتبقية', 'Days Cover')}</th>
                    <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'أصناف المنيو المتأثرة', 'Impacted Menu Items')}</th>
                    <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'فرصة ضائعة / يوم', 'Opp. Cost / Day')}</th>
                    <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'خسارة تأخير 7 أيام', '7-Day Exposure')}</th>
                    <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'التوريد المقترح', 'Suggested PO')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredStockAlerts.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-5 px-4 text-center text-slate-500">
                        {t(lang, 'لا توجد تنبيهات مطابقة لهذا التصنيف.', 'No alerts match this severity filter.')}
                      </td>
                    </tr>
                  ) : (
                    filteredStockAlerts.map((alert) => {
                      const isCritical = alert.severity === 'critical';
                      const visibleItems = alert.affectedMenuItems.slice(0, 2);
                      const remainingItems = alert.affectedMenuItems.length - visibleItems.length;
                      return (
                        <tr key={alert.ingredientId} className={isCritical ? 'bg-red-50/25 hover:bg-red-50/40' : 'hover:bg-slate-50'}>
                          <td className="py-3 px-4">
                            <div className="font-bold text-slate-900">
                              {lang === 'ar' ? alert.nameAr : alert.nameEn}
                            </div>
                            <div className="text-[11px] text-slate-500 font-mono-num" dir="ltr">
                              {alert.sku} · {t(lang, `سحب ${fmtMoney(alert.dailyBurnRate, 1)} ${alert.unit}/يوم`, `Burn ${fmtMoney(alert.dailyBurnRate, 1)} ${alert.unit}/d`)}
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-bold rounded border whitespace-nowrap ${
                                isCritical
                                  ? 'bg-red-50 border-red-200 text-red-700'
                                  : 'bg-amber-50 border-amber-200 text-amber-800'
                              }`}
                            >
                              {isCritical ? (
                                <>
                                  <OctagonAlert className="w-3 h-3" />
                                  {t(lang, 'حرج · تحت حد الطلب', 'Critical · Below Reorder')}
                                </>
                              ) : (
                                <>
                                  <Clock className="w-3 h-3" />
                                  {t(lang, 'تحذير · اقتراب نفاذ', 'Approaching Depletion')}
                                </>
                              )}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-end font-mono-num" dir="ltr">
                            <span className={`font-bold ${isCritical ? 'text-red-700' : 'text-amber-700'}`}>
                              {fmtMoney(alert.currentQty, 1)}
                            </span>
                            <span className="text-slate-400"> / </span>
                            <span className="text-slate-700">{fmtMoney(alert.reorderLevel, 0)}</span>
                            <span className="text-slate-500 ms-1">{alert.unit}</span>
                          </td>
                          <td className="py-3 px-4 text-end font-mono-num font-semibold" dir="ltr">
                            <span className={alert.daysRemaining <= 4 ? 'text-red-700' : 'text-amber-700'}>
                              {fmtMoney(alert.daysRemaining, 1)} {t(lang, 'يوم', 'd')}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            {alert.affectedMenuItems.length === 0 ? (
                              <span className="text-slate-400">—</span>
                            ) : (
                              <div className="text-slate-700">
                                {visibleItems.map((m) => (lang === 'ar' ? m.nameAr : m.nameEn)).join('، ')}
                                {remainingItems > 0 && (
                                  <span className="text-slate-500 font-medium ms-1">
                                    {t(lang, `+${remainingItems} أخرى`, `+${remainingItems} more`)}
                                  </span>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4 text-end font-mono-num" dir="ltr">
                            <div className="font-bold text-amber-800">{fmtMoney(alert.dailyOpportunityCost)}</div>
                            <div className="text-[11px] text-slate-500">
                              {t(lang, 'إيراد:', 'Rev:')} {fmtMoney(alert.dailyNetRevenueAtRisk, 0)}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-end font-mono-num font-bold text-red-700" dir="ltr">
                            {fmtMoney(alert.sevenDayOpportunityCost)} {t(lang, 'ج', 'EGP')}
                          </td>
                          <td className="py-3 px-4 text-end">
                            <div className="flex items-center justify-end gap-2">
                              <div className="text-end font-mono-num" dir="ltr">
                                <div className="font-semibold text-slate-900">
                                  +{fmtMoney(alert.suggestedOrderQty, 0)} {alert.unit}
                                </div>
                                <div className="text-[11px] text-slate-500">
                                  ~{fmtMoney(alert.estimatedOrderCostNet, 0)} {t(lang, 'ج', 'EGP')}
                                </div>
                              </div>
                              <button
                                onClick={() => {
                                  if (onQuickReorder) {
                                    onQuickReorder({
                                      ingredientId: alert.ingredientId,
                                      supplierId: alert.preferredSupplierId,
                                      qty: alert.suggestedOrderQty,
                                    });
                                  } else {
                                    onNavigate('purchases');
                                  }
                                }}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white font-semibold text-[11px] whitespace-nowrap transition-colors"
                              >
                                <ShoppingCart className="w-3.5 h-3.5" />
                                {t(lang, 'توريد عاجل', 'Order PO')}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* Primary KPI Grid (4 + 4) with MoM Recharts Trend Line Charts on Revenue, Gross Profit & EBITDA */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* Card 1: Revenue + Recharts MoM Trend */}
        <div
          className={`bg-white rounded-xl p-4 flex flex-col justify-between border ${
            revenueGrowthMonitor.triggered ? 'border-red-300' : 'border-slate-200'
          }`}
        >
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-medium text-slate-500">
                {t(lang, 'إجمالي الإيرادات (شامل VAT 14%)', 'Gross Revenue (Incl. VAT)')}
              </div>
              <div className="flex items-center gap-1">
                {revenueGrowthMonitor.triggered && (
                  <button
                    type="button"
                    onClick={openPerformanceReviewDrilldown}
                    title={t(
                      lang,
                      'نمو الإيراد أقل من 5% لشهرين متتاليين — اضغط للانتقال لوحدة مراجعة الأداء',
                      'MoM revenue growth < 5% for 2+ consecutive months — click to open Performance Review'
                    )}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-600 text-white hover:bg-red-700 cursor-pointer transition-colors whitespace-nowrap"
                  >
                    <TrendingDown className="w-2.5 h-2.5" />
                    <span className="font-mono-num" dir="ltr">
                      {revenueGrowthMonitor.latestStreak?.length ?? 2}m &lt;{revGrowthThresholdPct}%
                    </span>
                  </button>
                )}
                {latestTrendStats?.revMomPct !== null && latestTrendStats?.revMomPct !== undefined && (
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold font-mono-num ${
                      latestTrendStats.revMomPct >= revGrowthThresholdPct
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : latestTrendStats.revMomPct >= 0
                        ? 'bg-amber-50 text-amber-800 border border-amber-200'
                        : 'bg-red-50 text-red-700 border border-red-200'
                    }`}
                    dir="ltr"
                  >
                    {latestTrendStats.revMomPct >= 0 ? '+' : ''}
                    {latestTrendStats.revMomPct.toFixed(1)}% MoM
                  </span>
                )}
              </div>
            </div>
            <div className="mt-2 flex items-baseline justify-between gap-2">
              <span className="text-2xl font-bold text-slate-900 font-mono-num" dir="ltr">{fmtMoney(metrics.gross)}</span>
              <span className="text-xs text-slate-500">{t(lang, 'ج.م', 'EGP')}</span>
            </div>
          </div>

          <div className="mt-2 h-[74px] w-full" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={monthlyTrendSeries} margin={{ top: 6, right: 4, left: 4, bottom: 0 }}>
                <defs>
                  <linearGradient id="revTrendGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0f766e" stopOpacity={0.22} />
                    <stop offset="95%" stopColor="#0f766e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="shortMonth" tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} axisLine={false} />
                <Tooltip
                  formatter={(value) => [`${fmtMoney(Number(value ?? 0), 0)} EGP`, t(lang, 'صافي الإيراد', 'Net Revenue')]}
                  contentStyle={{ fontSize: '11px', borderRadius: '8px', borderColor: '#cbd5e1' }}
                />
                <Area
                  type="monotone"
                  dataKey="netRevenue"
                  stroke="#0f766e"
                  strokeWidth={2}
                  fill="url(#revTrendGrad)"
                  dot={{ r: 2, fill: '#0f766e' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between gap-2 text-xs text-slate-500">
            <span>
              {t(lang, 'صافي بعد VAT:', 'Net Ex-VAT:')}{' '}
              <span className="font-mono-num font-semibold text-slate-800" dir="ltr">{fmtMoney(metrics.net)}</span>
            </span>
            {revenueGrowthMonitor.triggered && (
              <button
                type="button"
                onClick={openPerformanceReviewDrilldown}
                className="text-[11px] font-bold text-red-700 hover:underline inline-flex items-center gap-0.5 cursor-pointer shrink-0"
              >
                <span>{t(lang, 'مراجعة الأداء', 'Perf. Review')}</span>
                <ArrowUpRight className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Card 2: Gross Profit + Recharts MoM Trend */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-medium text-slate-500">
                {t(lang, 'مجمل الربح (GP) والهامش', 'Gross Profit & GP Margin')}
              </div>
              {latestTrendStats?.gpMomPct !== null && latestTrendStats?.gpMomPct !== undefined && (
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold font-mono-num ${
                    latestTrendStats.gpMomPct >= 0
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : 'bg-red-50 text-red-700 border border-red-200'
                  }`}
                  dir="ltr"
                >
                  {latestTrendStats.gpMomPct >= 0 ? '+' : ''}
                  {latestTrendStats.gpMomPct.toFixed(1)}% MoM
                </span>
              )}
            </div>
            <div className="mt-2 flex items-baseline justify-between gap-2">
              <span className="text-2xl font-bold text-slate-900 font-mono-num" dir="ltr">{fmtMoney(metrics.gp)}</span>
              <span className="text-sm font-bold text-emerald-700 font-mono-num" dir="ltr">{fmtPct(metrics.gpMarginPct)}</span>
            </div>
          </div>

          <div className="mt-2 h-[74px] w-full" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={monthlyTrendSeries} margin={{ top: 6, right: 4, left: 4, bottom: 0 }}>
                <defs>
                  <linearGradient id="gpTrendGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#059669" stopOpacity={0.22} />
                    <stop offset="95%" stopColor="#059669" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="shortMonth" tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} axisLine={false} />
                <Tooltip
                  formatter={(value) => [`${fmtMoney(Number(value ?? 0), 0)} EGP`, t(lang, 'مجمل الربح', 'Gross Profit')]}
                  contentStyle={{ fontSize: '11px', borderRadius: '8px', borderColor: '#cbd5e1' }}
                />
                <Area
                  type="monotone"
                  dataKey="grossProfit"
                  stroke="#059669"
                  strokeWidth={2}
                  fill="url(#gpTrendGrad)"
                  dot={{ r: 2, fill: '#059669' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
            <span className="text-slate-500">{t(lang, 'المتوسط الشهري', 'Monthly Avg Net')}</span>
            <span className="font-mono-num text-slate-700 font-medium" dir="ltr">{fmtMoney(round2(metrics.net / metrics.monthsCount))}</span>
          </div>
        </div>

        {/* Card 3: COGS % */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col justify-between">
          <div>
            <div className="text-xs font-medium text-slate-500">
              {t(lang, 'تكلفة المبيعات COGS %', 'COGS % (Target 28–35%)')}
            </div>
            <div className="mt-2 flex items-baseline justify-between gap-2">
              <span className="text-2xl font-bold text-amber-700 font-mono-num" dir="ltr">{fmtPct(metrics.foodCostPct)}</span>
              <span className="text-xs text-slate-600 font-mono-num" dir="ltr">{fmtMoney(metrics.cogs)} {t(lang, 'ج.م', 'EGP')}</span>
            </div>
            <div className="mt-4 space-y-1.5">
              <div className="flex justify-between text-[11px] text-slate-500 font-mono-num" dir="ltr">
                <span>0%</span>
                <span className="font-semibold text-teal-700">Target 35%</span>
                <span>50%+</span>
              </div>
              <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className={`h-full rounded-full ${metrics.foodCostPct <= 35 ? 'bg-emerald-600' : 'bg-amber-600'}`}
                  style={{ width: `${Math.min(100, Math.max(8, metrics.foodCostPct * 1.8))}%` }}
                />
              </div>
            </div>
          </div>

          <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
            <span className="text-slate-500">{t(lang, 'المستهدف 2027: ≤ 35%', '2027 Target: ≤ 35%')}</span>
            <button onClick={() => onNavigate('inventory')} className="text-teal-700 hover:underline font-medium">
              {t(lang, 'تكلفة الوصفات', 'Recipe BOM')}
            </button>
          </div>
        </div>

        {/* Card 4: EBITDA / Operating Result + Recharts MoM Trend */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-medium text-slate-500">
                {excludeUsufructRent
                  ? t(lang, 'EBITDA / النتيجة التشغيلية (بدون الانتفاع)', 'EBITDA / Operating Result (Ex-Usufruct)')
                  : t(lang, 'EBITDA / صافي النتيجة المحاسبية', 'EBITDA / Net Operating Result')}
              </div>
              {latestTrendStats?.ebitdaMomPct !== null && latestTrendStats?.ebitdaMomPct !== undefined && (
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold font-mono-num ${
                    latestTrendStats.ebitdaMomPct >= 0
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : 'bg-red-50 text-red-700 border border-red-200'
                  }`}
                  dir="ltr"
                >
                  {latestTrendStats.ebitdaMomPct >= 0 ? '+' : ''}
                  {latestTrendStats.ebitdaMomPct.toFixed(1)}% MoM
                </span>
              )}
            </div>
            <div className="mt-2 flex items-baseline justify-between gap-2">
              <span className={`text-2xl font-bold font-mono-num ${metrics.netProfit >= 0 ? 'text-emerald-700' : 'text-red-600'}`} dir="ltr">
                {fmtMoney(metrics.netProfit)}
              </span>
              <span className={`text-sm font-bold font-mono-num ${metrics.netMarginPct >= 0 ? 'text-emerald-700' : 'text-red-600'}`} dir="ltr">
                {fmtPct(metrics.netMarginPct)}
              </span>
            </div>
          </div>

          <div className="mt-2 h-[74px] w-full" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={monthlyTrendSeries} margin={{ top: 6, right: 4, left: 4, bottom: 0 }}>
                <defs>
                  <linearGradient id="ebitdaTrendGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={metrics.netProfit >= 0 ? '#059669' : '#dc2626'} stopOpacity={0.22} />
                    <stop offset="95%" stopColor={metrics.netProfit >= 0 ? '#059669' : '#dc2626'} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="shortMonth" tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} axisLine={false} />
                <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="2 2" />
                <Tooltip
                  formatter={(value) => [`${fmtMoney(Number(value ?? 0), 0)} EGP`, 'EBITDA']}
                  contentStyle={{ fontSize: '11px', borderRadius: '8px', borderColor: '#cbd5e1' }}
                />
                <Area
                  type="monotone"
                  dataKey="ebitdaActive"
                  stroke={metrics.netProfit >= 0 ? '#059669' : '#dc2626'}
                  strokeWidth={2}
                  fill="url(#ebitdaTrendGrad)"
                  dot={{ r: 2, fill: metrics.netProfit >= 0 ? '#059669' : '#dc2626' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
            <span className="text-slate-500">{t(lang, 'وتيرة خسارة 2026: -5.5م/سنة', 'Annualized 2026: -5.5M')}</span>
            <button onClick={() => onNavigate('strategy')} className="text-teal-700 hover:underline font-medium">
              {t(lang, 'خطة 2027', '2027 Plan')}
            </button>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">
            {t(lang, 'الرواتب والمنح % (الهدف 25–30%)', 'Payroll & Bonuses % (Target ≤33%)')}
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="text-2xl font-bold text-red-600 font-mono-num" dir="ltr">{fmtPct(metrics.payrollPct)}</span>
            <span className="text-xs text-slate-600 font-mono-num" dir="ltr">{fmtMoney(metrics.payroll)}</span>
          </div>
          <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>{t(lang, 'أساسي ~530k/ش + منح 1.39م', 'Base ~530k/m + 1.39M Bonuses')}</span>
            <span className="font-mono-num text-red-600" dir="ltr">Prime {fmtPct(metrics.primeCostPct)}</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">
            {t(lang, 'نقطة التعادل الشهرية الحالية', 'Current Monthly Break-Even Needed')}
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="text-2xl font-bold text-slate-900 font-mono-num" dir="ltr">{fmtMoney(metrics.breakEvenMonthlyNet)}</span>
            <span className="text-xs text-slate-500">{t(lang, 'ج/شهر', 'EGP/mo')}</span>
          </div>
          <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
            <span className="text-slate-500">{t(lang, 'فوق الواقع الحالي بـ ~60%', '~60% above current 1.26M')}</span>
            <span className="text-teal-700 font-mono-num font-semibold" dir="ltr">2027: 1.70M</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">
            {t(lang, 'رصيد بنك CIB (1102) وحساب 1103', 'CIB Bank (1102) & 1103 Clearing')}
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="text-2xl font-bold text-slate-900 font-mono-num" dir="ltr">{fmtMoney(cibBalance, 0)}</span>
            <span className="text-xs text-emerald-700 font-mono-num font-bold" dir="ltr">1103 = {fmtMoney(clearing1103, 0)}</span>
          </div>
          <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
            <span className="text-slate-500">{t(lang, 'قسط الانتفاع الفصلي: 1,275,000 ج', 'Quarterly Rent: 1,275,000')}</span>
            <button onClick={() => onNavigate('accounting')} className="text-teal-700 hover:underline font-medium">
              {t(lang, 'تسوية CIB', 'Recon')}
            </button>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">
            {t(lang, 'مخزون سبتمبر (333 صنف) والأصول', 'Sep Inventory & Fixed Assets NBV')}
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="text-2xl font-bold text-slate-900 font-mono-num" dir="ltr">{fmtMoney(inventoryValue, 0)}</span>
            <span className="text-xs text-slate-500">{t(lang, '5 مواقع', '5 Sites')}</span>
          </div>
          <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>{t(lang, 'أصول ثابتة تكلفة 545.9k', 'Assets Cost 545.9k')}</span>
            <span className="font-mono-num text-slate-700" dir="ltr">NBV ~222k</span>
          </div>
        </div>
      </div>

      {/* CFO Risk Register Status-Tracking Dashboard (Usufruct & 80% Unused Land Governance) */}
      <RiskRegisterPanel
        risks={state.strategy2027.risks}
        globalAuditLogs={state.auditLogs}
        lang={lang}
        onCreateRisk={onCreateRisk}
        onUpdateRisk={onUpdateRisk}
        onDeleteRisk={onDeleteRisk}
      />

      {/* 80% Unused Land Investment ROI Simulator Quick Launcher */}
      <section
        id="cfo-investment-roi-simulator"
        className="bg-white border border-slate-200 rounded-xl overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-slate-50/70">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg border border-teal-200 bg-teal-50 text-teal-700 shrink-0">
              <LandPlot className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                {t(
                  lang,
                  'محاكي العائد الاستثماري السريع لمساحة الـ 80% فراغ (CAPEX / Payback / NPV)',
                  '80% Unused Land — Investment ROI Simulator (CAPEX, Payback & NPV)'
                )}
              </h2>
              <div className="flex flex-wrap items-center gap-2 mt-0.5 text-xs text-slate-500">
                <span>{t(lang, 'إجمالي المساحة غير المستغلة 23,825 م²', 'Idle Space 23,825 m²')}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono-num" dir="ltr">WACC {quickRoiInputs.discountRatePct}%</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono-num" dir="ltr">{quickRoiInputs.horizonYears}Y DCF</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 no-print">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(
                [
                  { id: 'jv_partner', ar: 'شراكة JV', en: 'JV Share' },
                  { id: 'direct', ar: 'تشغيل مباشر', en: 'Direct Op' },
                  { id: 'sublease', ar: 'أكشاك تجارية', en: 'Concessions' },
                ] as const
              ).map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => updateQuickRoi(ROI_PRESETS[preset.id])}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap cursor-pointer transition-colors ${
                    quickRoiInputs.presetId === preset.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {lang === 'ar' ? preset.ar : preset.en}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => onNavigate('roi_simulator')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors"
            >
              <span>{t(lang, 'فتح المحاكي الكامل (DCF والحساسية)', 'Open Full ROI Simulator & DCF')}</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="p-5 grid grid-cols-1 lg:grid-cols-12 gap-5 items-center">
          <div className="lg:col-span-5 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div>
              <label htmlFor="dash-roi-capex" className="block font-semibold text-slate-700 mb-1">
                {t(lang, 'الاستثمار الرأسمالي CAPEX (ج.م)', 'CAPEX Investment (EGP)')}
              </label>
              <input
                id="dash-roi-capex"
                type="number"
                min={0}
                step={50000}
                value={quickRoiInputs.capexEgp}
                onChange={(e) =>
                  updateQuickRoi({ capexEgp: Math.max(0, Number(e.target.value) || 0) })
                }
                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white font-mono-num text-sm font-bold text-slate-900 focus:outline-none focus:border-teal-600"
                dir="ltr"
              />
            </div>

            <div>
              <label htmlFor="dash-roi-rev" className="block font-semibold text-slate-700 mb-1">
                {t(lang, 'الإيراد الشهري المتوقع (ج.م)', 'Expected Monthly Rev (EGP)')}
              </label>
              <input
                id="dash-roi-rev"
                type="number"
                min={0}
                step={25000}
                value={quickRoiInputs.expectedMonthlyRevenueEgp}
                onChange={(e) =>
                  updateQuickRoi({
                    expectedMonthlyRevenueEgp: Math.max(0, Number(e.target.value) || 0),
                  })
                }
                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white font-mono-num text-sm font-bold text-slate-900 focus:outline-none focus:border-teal-600"
                dir="ltr"
              />
            </div>
          </div>

          <div className="lg:col-span-7 grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x sm:rtl:divide-x-reverse divide-slate-200 border border-slate-200 rounded-lg bg-slate-50/50">
            <div className="px-4 py-3">
              <div className="text-[11px] text-slate-500">{t(lang, 'فترة الاسترداد', 'Payback Period')}</div>
              <div
                className={`mt-1 text-base font-bold font-mono-num ${
                  quickRoiSim.simplePaybackMonths !== null ? 'text-slate-900' : 'text-red-600'
                }`}
                dir="ltr"
              >
                {quickRoiSim.simplePaybackMonths !== null
                  ? `${quickRoiSim.simplePaybackMonths} ${t(lang, 'شهر', 'mo')}`
                  : t(lang, 'غير مسترد', 'N/A')}
              </div>
              <div className="text-[10px] text-slate-500 font-mono-num" dir="ltr">
                {quickRoiSim.discountedPaybackMonths !== null
                  ? `Disc: ${quickRoiSim.discountedPaybackMonths}m`
                  : `>${quickRoiInputs.horizonYears}Y`}
              </div>
            </div>

            <div className="px-4 py-3">
              <div className="text-[11px] text-slate-500">
                {t(lang, `صافي القيمة الحالية NPV`, `NPV @ ${quickRoiInputs.discountRatePct}%`)}
              </div>
              <div
                className={`mt-1 text-base font-bold font-mono-num ${
                  quickRoiSim.npvEgp >= 0 ? 'text-emerald-700' : 'text-red-600'
                }`}
                dir="ltr"
              >
                {quickRoiSim.npvEgp >= 0 ? '+' : ''}
                {fmtMoney(quickRoiSim.npvEgp, 0)}
              </div>
              <div className="text-[10px] text-slate-500 font-mono-num" dir="ltr">
                PI: {quickRoiSim.profitabilityIndex.toFixed(2)}x
              </div>
            </div>

            <div className="px-4 py-3">
              <div className="text-[11px] text-slate-500">{t(lang, 'العائد الداخلي IRR', 'Projected IRR')}</div>
              <div
                className={`mt-1 text-base font-bold font-mono-num ${
                  quickRoiSim.irrPct !== null && quickRoiSim.irrPct >= quickRoiInputs.discountRatePct
                    ? 'text-emerald-700'
                    : 'text-amber-700'
                }`}
                dir="ltr"
              >
                {quickRoiSim.irrPct !== null ? fmtPct(quickRoiSim.irrPct, 1) : 'N/A'}
              </div>
              <div className="text-[10px] text-slate-500 font-mono-num" dir="ltr">
                Share {quickRoiInputs.estadatSharePct}% · Mgn {quickRoiInputs.operatingMarginPct}%
              </div>
            </div>

            <div className="px-4 py-3">
              <div className="text-[11px] text-slate-500">{t(lang, 'تدفق شهري متوقع', 'Est. Monthly Net CF')}</div>
              <div className="mt-1 text-base font-bold font-mono-num text-teal-800" dir="ltr">
                {fmtMoney(quickRoiSim.year1MonthlyNetCashFlow, 0)}
              </div>
              <div className="text-[10px] text-slate-500 font-mono-num" dir="ltr">
                {quickRoiSim.activatedSqm.toLocaleString('en-US')} m²
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* VAT Summary Comparative Analysis & Egyptian Tax Authority (ETA) Compliance Widget */}
      <section
        id="vat-summary-widget"
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-col xl:flex-row xl:items-center justify-between gap-3 bg-slate-50/70 dark:bg-slate-800/40">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 shrink-0">
              <ReceiptText className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {t(
                    lang,
                    'ملخص ضريبة القيمة المضافة (VAT Summary 14%) — المخرجات والمدخلات المخصومة وغير المخصومة',
                    'VAT Summary (14%) — Output vs. Deductible & Non-Deductible Input Audit'
                  )}
                </h2>
                <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span>
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  {lang === 'ar' ? vatSummary.periodLabelAr : vatSummary.periodLabelEn}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-slate-500 dark:text-slate-400">
                <span className="font-mono-num" dir="ltr">
                  {t(lang, 'رقم التسجيل الضريبي:', 'ETA Tax ID:')} {state.taxId}
                </span>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  {t(
                    lang,
                    `${vatSummary.etaSubmittedCount} فاتورة مرسلة لمنظومة ETA`,
                    `${vatSummary.etaSubmittedCount} Invoices Submitted to ETA`
                  )}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono-num font-medium text-amber-700 dark:text-amber-400" dir="ltr">
                  {t(lang, 'مدخلات غير مخصومة:', 'Non-Deductible Input:')}{' '}
                  {fmtMoney(vatSummary.nonDeductibleInputVat, 0)} {t(lang, 'ج.م', 'EGP')} (
                  {fmtPct(vatSummary.nonDeductibleSharePct, 1)})
                </span>
                {vatSummary.etaQueuedCount > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-amber-700 dark:text-amber-400 font-semibold">
                      {t(
                        lang,
                        `${vatSummary.etaQueuedCount} بانتظار المزامنة`,
                        `${vatSummary.etaQueuedCount} Queued Offline`
                      )}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
              {(
                [
                  { id: 'chart', ar: 'المقارنة البيانية', en: 'Comparative Chart' },
                  { id: 'schedule', ar: 'جدول نموذج 10', en: 'Form 10 Schedule' },
                  { id: 'audit', ar: 'المخصوم وغير المخصوم', en: 'Deductibility Audit' },
                  { id: 'sources', ar: 'مصادر الفواتير', en: 'Sources & GL' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setVatViewMode(tab.id)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                    vatViewMode === tab.id
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {lang === 'ar' ? tab.ar : tab.en}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={handleExportVatCsv}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{t(lang, 'تصدير CSV', 'Export CSV')}</span>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('accounting')}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-teal-700 dark:text-teal-300 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {t(lang, 'حساب 2201 / 1105', 'GL 2201 / 1105')}
            </button>

            <button
              type="button"
              onClick={() => onNavigate('purchases')}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-teal-700 hover:bg-teal-800 text-white whitespace-nowrap shrink-0 cursor-pointer"
            >
              {t(lang, 'فواتير المشتريات', 'Purchase VAT')}
            </button>
          </div>
        </div>

        {/* 3-Column Output vs Deductible/Non-Deductible Input vs Net VAT Payable */}
        <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x md:rtl:divide-x-reverse divide-slate-200 dark:divide-slate-800">
          {/* Column 1: Output VAT */}
          <div className="p-5 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>{t(lang, 'ضريبة المخرجات (من المبيعات 14%)', 'Output VAT Collected (Sales 14%)')}</span>
              <span className="font-mono-num text-[11px] font-semibold text-teal-700 dark:text-teal-400" dir="ltr">
                Acc 2201
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-2xl font-bold text-slate-900 dark:text-slate-100 font-mono-num" dir="ltr">
                {fmtMoney(vatSummary.outputVat, 2)}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">{t(lang, 'ج.م', 'EGP')}</span>
            </div>
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1 text-xs text-slate-500 dark:text-slate-400">
              <div className="flex items-center justify-between">
                <span>{t(lang, 'وعاء المبيعات الصافي الخاضع', 'Taxable Net Sales Base')}</span>
                <span className="font-mono-num font-semibold text-slate-700 dark:text-slate-200" dir="ltr">
                  {fmtMoney(metrics.net, 0)} ({fmtPct(vatSummary.effectiveOutputRatePct, 1)})
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>{t(lang, 'صافي الإقرار الافتراضي لو خُصم الكل', 'Pro-Forma Net if 100% Deductible')}</span>
                <span className="font-mono-num font-medium text-slate-600 dark:text-slate-300" dir="ltr">
                  {fmtMoney(vatSummary.hypotheticalNetPayableIfAllDeductible, 0)} {t(lang, 'ج.م', 'EGP')}
                </span>
              </div>
            </div>
          </div>

          {/* Column 2: Input VAT Breakdown (Deductible Acc 1105 vs Non-Deductible Cost/OpEx) */}
          <div className="p-5 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>{t(lang, 'ضريبة المدخلات المخصومة (ETA نموذج 10)', 'Deductible Input VAT (ETA Creditable)')}</span>
              <span className="font-mono-num text-[11px] font-semibold text-emerald-700 dark:text-emerald-400" dir="ltr">
                Acc 1105
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-2xl font-bold text-emerald-700 dark:text-emerald-400 font-mono-num" dir="ltr">
                -{fmtMoney(vatSummary.deductibleInputVat, 2)}
              </span>
              <span className="text-xs font-mono-num font-semibold text-emerald-700 dark:text-emerald-400" dir="ltr">
                {fmtPct(vatSummary.deductibilityRatioPct, 1)} {t(lang, 'قابل للخصم', 'deductible')}
              </span>
            </div>
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1 text-xs">
              <div className="flex items-center justify-between text-amber-800 dark:text-amber-300">
                <span>{t(lang, 'مدخلات غير قابلة للخصم (محملة بالتكلفة)', 'Non-Deductible Input VAT (Absorbed)')}</span>
                <span className="font-mono-num font-bold" dir="ltr">
                  {fmtMoney(vatSummary.nonDeductibleInputVat, 2)} ({fmtPct(vatSummary.nonDeductibleSharePct, 1)})
                </span>
              </div>
              <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                <span>{t(lang, 'إجمالي ضريبة المدخلات المتكبدة فعلياً', 'Total Gross Input VAT Incurred')}</span>
                <span className="font-mono-num font-semibold text-slate-700 dark:text-slate-200" dir="ltr">
                  {fmtMoney(vatSummary.totalInputVatIncurred, 2)} {t(lang, 'ج.م', 'EGP')}
                </span>
              </div>
            </div>
          </div>

          {/* Column 3: Net VAT Payable to ETA */}
          <div className="p-5 space-y-2 bg-slate-50/50 dark:bg-slate-800/30">
            <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300 font-medium">
              <span>
                {vatSummary.netVatPayable >= 0
                  ? t(lang, 'صافي الضريبة المستحقة لمصلحة الضرائب (ETA)', 'Net VAT Payable to ETA')
                  : t(lang, 'رصيد ضريبي دائن مرحل (فائض مدخلات)', 'Net Input VAT Credit Carryforward')}
              </span>
              <span className="font-mono-num text-[11px]" dir="ltr">2201 - 1105</span>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span
                className={`text-2xl font-bold font-mono-num ${
                  vatSummary.netVatPayable >= 0
                    ? 'text-teal-800 dark:text-teal-300'
                    : 'text-emerald-700 dark:text-emerald-400'
                }`}
                dir="ltr"
              >
                {fmtMoney(vatSummary.netVatPayable, 2)}
              </span>
              <span className="text-xs font-mono-num font-semibold text-slate-600 dark:text-slate-300" dir="ltr">
                {vatSummary.outputToInputRatio.toFixed(2)}x
              </span>
            </div>
            <div className="pt-2 border-t border-slate-200/80 dark:border-slate-700 space-y-1 text-xs text-slate-500 dark:text-slate-400">
              <div className="flex items-center justify-between">
                <span>{t(lang, 'صافي العبء الضريبي من المبيعات', 'Net VAT % of Sales')}</span>
                <span className="font-mono-num font-semibold text-slate-800 dark:text-slate-200" dir="ltr">
                  {fmtPct(vatSummary.netVatBurdenPct, 2)} · GL {fmtMoney(vatSummary.ledgerNetPayable, 0)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>{t(lang, 'عبء ضريبة غير مخصوم (تكلفة 5101/5301)', 'Disallowed VAT Leakage (5101/5301)')}</span>
                <span className="font-mono-num font-semibold text-amber-700 dark:text-amber-400" dir="ltr">
                  +{fmtMoney(vatSummary.nonDeductibleInputVat, 0)} {t(lang, 'ج.م', 'EGP')}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Comparative Metrics Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 divide-x rtl:divide-x-reverse divide-slate-200 dark:divide-slate-800 border-t border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/20 text-xs">
          <div className="px-5 py-2.5 flex items-center justify-between gap-2">
            <span className="text-slate-500 dark:text-slate-400">
              {t(lang, 'المخصوم / غير المخصوم', 'Deductible / Non-Deductible')}
            </span>
            <span className="font-mono-num font-bold text-slate-900 dark:text-slate-100" dir="ltr">
              <span className="text-emerald-700 dark:text-emerald-400">{fmtPct(vatSummary.deductibilityRatioPct, 1)}</span>
              {' / '}
              <span className="text-amber-700 dark:text-amber-400">{fmtPct(vatSummary.nonDeductibleSharePct, 1)}</span>
            </span>
          </div>
          <div className="px-5 py-2.5 flex items-center justify-between gap-2">
            <span className="text-slate-500 dark:text-slate-400">{t(lang, 'درع خصم المخرجات (1105/2201)', 'Output Tax Shield')}</span>
            <span className="font-mono-num font-bold text-emerald-700 dark:text-emerald-400" dir="ltr">
              {fmtPct(vatSummary.recoveryRatioPct, 1)} ({vatSummary.outputToInputRatio.toFixed(2)}:1)
            </span>
          </div>
          <div className="px-5 py-2.5 flex items-center justify-between gap-2">
            <span className="text-slate-500 dark:text-slate-400">
              {t(lang, 'غير مخصوم: COGS / OpEx 5301', 'Non-Deduct: COGS / OpEx')}
            </span>
            <span className="font-mono-num font-bold text-amber-700 dark:text-amber-400" dir="ltr">
              {fmtMoney(vatSummary.nonDeductibleCogsVat, 0)} / {fmtMoney(vatSummary.nonDeductibleOpexVat, 0)}
            </span>
          </div>
          <div className="px-5 py-2.5 flex items-center justify-between gap-2">
            <span className="text-slate-500 dark:text-slate-400">{t(lang, 'رصيد الأستاذ 2201 / 1105', 'GL 2201 vs 1105')}</span>
            <span className="font-mono-num font-semibold text-slate-700 dark:text-slate-200" dir="ltr">
              {fmtMoney(vatSummary.ledgerOutput2201, 0)} / {fmtMoney(vatSummary.ledgerInput1105, 0)}
            </span>
          </div>
        </div>

        {/* View 1: Comparative Chart & Deductible vs Non-Deductible Tax Shield */}
        {vatViewMode === 'chart' && (
          <div className="p-5 border-t border-slate-200 dark:border-slate-800 space-y-5">
            {/* Grouped Monthly Output vs Deductible Input vs Non-Deductible Input Comparative Chart */}
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" />
                  <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                    {t(
                      lang,
                      'التحليل الشهري المقارن: ضريبة المخرجات مقابل المدخلات المخصومة (1105) وغير المخصومة',
                      'Monthly Comparative Analysis: Output VAT vs. Deductible (1105) & Non-Deductible Input VAT'
                    )}
                  </h3>
                </div>
                <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-600 dark:text-slate-400">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-xs bg-teal-700 dark:bg-teal-500 inline-block" />
                    <span>{t(lang, 'مخرجات المبيعات (2201)', 'Output VAT (2201)')}</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-xs bg-emerald-600 dark:bg-emerald-500 inline-block" />
                    <span>{t(lang, 'مدخلات مخصومة (1105)', 'Deductible Input (1105)')}</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-xs bg-amber-500 dark:bg-amber-400 inline-block" />
                    <span>{t(lang, 'مدخلات غير مخصومة', 'Non-Deductible Input')}</span>
                  </span>
                </div>
              </div>

              {/* Interactive Month Focus Readout */}
              {activeVatMonth && (
                <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-xs">
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {t(lang, 'الشهر المحدد للفحص', 'Focused Month')}
                    </div>
                    <div className="font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                      {lang === 'ar' ? activeVatMonth.labelAr : activeVatMonth.labelEn}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {t(lang, 'مخرجات المبيعات (2201)', 'Output VAT')}
                    </div>
                    <div className="font-mono-num font-bold text-teal-700 dark:text-teal-300 mt-0.5" dir="ltr">
                      {fmtMoney(activeVatMonth.outputVat, 0)} {t(lang, 'ج.م', 'EGP')}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {t(lang, 'مدخلات مخصومة (1105)', 'Deductible Input')}
                    </div>
                    <div className="font-mono-num font-bold text-emerald-700 dark:text-emerald-400 mt-0.5" dir="ltr">
                      -{fmtMoney(activeVatMonth.deductibleInputVat, 0)} {t(lang, 'ج.م', 'EGP')}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {t(lang, 'مدخلات غير مخصومة', 'Non-Deductible Input')}
                    </div>
                    <div className="font-mono-num font-bold text-amber-700 dark:text-amber-400 mt-0.5" dir="ltr">
                      {fmtMoney(activeVatMonth.nonDeductibleInputVat, 0)} {t(lang, 'ج.م', 'EGP')}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {t(lang, 'نسبة القابلية للخصم', 'Deductibility %')}
                    </div>
                    <div className="font-mono-num font-bold text-slate-800 dark:text-slate-200 mt-0.5" dir="ltr">
                      {fmtPct(activeVatMonth.deductibilityPct, 1)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {t(lang, 'صافي المستحق للـ ETA', 'Net Payable (ETA)')}
                    </div>
                    <div className="font-mono-num font-bold text-slate-900 dark:text-slate-100 mt-0.5" dir="ltr">
                      {fmtMoney(activeVatMonth.netPayable, 0)}
                      {activeVatMonth.momDeltaPct !== null && (
                        <span
                          className={`ms-1.5 text-[11px] ${
                            activeVatMonth.momDeltaPct > 0
                              ? 'text-amber-700 dark:text-amber-400'
                              : 'text-emerald-700 dark:text-emerald-400'
                          }`}
                        >
                          ({activeVatMonth.momDeltaPct > 0 ? '+' : ''}
                          {fmtPct(activeVatMonth.momDeltaPct, 1)})
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Grouped Vertical Bar Columns (3 Bars per Month: Output / Deductible / Non-Deductible) */}
              <div className="overflow-x-auto pb-1">
                <div className="min-w-[600px] grid gap-2 pt-2" style={{ gridTemplateColumns: `repeat(${vatSummary.monthlyBreakdown.length}, minmax(0, 1fr))` }}>
                  {vatSummary.monthlyBreakdown.map((m) => {
                    const outH = Math.max(8, Math.round((m.outputVat / vatSummary.maxMonthlyVatBar) * 140));
                    const inH = Math.max(6, Math.round((m.deductibleInputVat / vatSummary.maxMonthlyVatBar) * 140));
                    const nonDedH = Math.max(4, Math.round((m.nonDeductibleInputVat / vatSummary.maxMonthlyVatBar) * 140));
                    const isSelected = activeVatMonth?.key === m.key;

                    return (
                      <button
                        key={m.key}
                        type="button"
                        onClick={() => setSelectedVatMonthKey(m.key)}
                        className={`flex flex-col items-center p-2 rounded-lg border text-center transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-teal-50/60 dark:bg-teal-950/40 border-teal-300 dark:border-teal-700'
                            : 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                        }`}
                        title={`${lang === 'ar' ? m.labelAr : m.labelEn} — Output: ${fmtMoney(m.outputVat, 0)} | Deductible: ${fmtMoney(m.deductibleInputVat, 0)} | Non-Deductible: ${fmtMoney(m.nonDeductibleInputVat, 0)}`}
                      >
                        <div className="h-[156px] w-full flex items-end justify-center gap-1 pb-1 border-b border-slate-200 dark:border-slate-700">
                          <div className="flex flex-col items-center gap-1 flex-1 max-w-[18px]">
                            <span className="text-[9px] font-mono-num text-slate-600 dark:text-slate-300" dir="ltr">
                              {Math.round(m.outputVat / 1000)}k
                            </span>
                            <div
                              className="w-full rounded-t bg-teal-700 dark:bg-teal-500 transition-all"
                              style={{ height: `${outH}px` }}
                            />
                          </div>
                          <div className="flex flex-col items-center gap-1 flex-1 max-w-[18px]">
                            <span className="text-[9px] font-mono-num text-emerald-700 dark:text-emerald-400" dir="ltr">
                              {Math.round(m.deductibleInputVat / 1000)}k
                            </span>
                            <div
                              className="w-full rounded-t bg-emerald-600 dark:bg-emerald-500 transition-all"
                              style={{ height: `${inH}px` }}
                            />
                          </div>
                          <div className="flex flex-col items-center gap-1 flex-1 max-w-[18px]">
                            <span className="text-[9px] font-mono-num text-amber-700 dark:text-amber-400" dir="ltr">
                              {Math.round(m.nonDeductibleInputVat / 1000)}k
                            </span>
                            <div
                              className="w-full rounded-t bg-amber-500 dark:bg-amber-400 transition-all"
                              style={{ height: `${nonDedH}px` }}
                            />
                          </div>
                        </div>
                        <span className="mt-1.5 text-[11px] font-semibold text-slate-800 dark:text-slate-200 truncate w-full">
                          {lang === 'ar' ? m.labelAr : m.labelEn}
                        </span>
                        <span className="text-[10px] font-mono-num text-slate-500 dark:text-slate-400" dir="ltr">
                          {t(lang, 'خصم', 'Ded')}: {fmtPct(m.deductibilityPct, 0)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Dual Stacked Bars: Output Offset Shield + Input VAT Deductibility Split */}
            <div className="pt-4 border-t border-slate-200 dark:border-slate-800 grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Bar A: Output VAT Tax Shield */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {t(lang, 'تغطية المخرجات بالمدخلات المخصومة (ETA نموذج 10)', 'Output VAT Offset vs. Net ETA Remittance')}
                  </span>
                  <span className="font-mono-num text-[11px] text-slate-600 dark:text-slate-400" dir="ltr">
                    {fmtPct(Math.min(100, vatSummary.recoveryRatioPct), 1)} {t(lang, 'خصم', 'offset')}
                  </span>
                </div>
                <div
                  className="w-full h-3 rounded-md bg-slate-100 dark:bg-slate-800 overflow-hidden flex"
                  role="img"
                  aria-label="Output VAT offset by Deductible Input VAT"
                >
                  <div
                    className="h-full bg-emerald-600 dark:bg-emerald-500 transition-transform duration-150"
                    style={{ width: `${Math.min(100, Math.max(0, vatSummary.recoveryRatioPct))}%` }}
                    title={`${t(lang, 'مدخلات مخصومة 1105', 'Deductible Input VAT')}: ${fmtMoney(vatSummary.deductibleInputVat, 0)} EGP`}
                  />
                  <div
                    className="h-full bg-teal-700 dark:bg-teal-500 transition-transform duration-150"
                    style={{ width: `${Math.max(0, 100 - Math.min(100, vatSummary.recoveryRatioPct))}%` }}
                    title={`${t(lang, 'صافي المستحق لـ ETA', 'Net ETA Payable')}: ${fmtMoney(vatSummary.netVatPayable, 0)} EGP`}
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-xs bg-emerald-600 inline-block" />
                    <span className="font-mono-num" dir="ltr">
                      1105: {fmtMoney(vatSummary.deductibleInputVat, 0)} EGP
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-xs bg-teal-700 inline-block" />
                    <span className="font-mono-num" dir="ltr">
                      ETA Net: {fmtMoney(vatSummary.netVatPayable, 0)} EGP
                    </span>
                  </span>
                </div>
              </div>

              {/* Bar B: Input VAT Deductibility Split (Deductible 1105 vs Non-Deductible COGS vs Non-Deductible OpEx) */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {t(lang, 'هيكل ضريبة المدخلات المتكبدة (مخصوم مقابل غير مخصوم)', 'Total Input VAT Composition (Deductible vs. Non-Deductible)')}
                  </span>
                  <button
                    type="button"
                    onClick={() => setVatViewMode('audit')}
                    className="text-[11px] font-semibold text-teal-700 dark:text-teal-300 hover:underline cursor-pointer"
                  >
                    {t(lang, 'عرض تدقيق ETA الكامل ←', 'Full ETA Audit Breakdown →')}
                  </button>
                </div>
                {(() => {
                  const totalIn = Math.max(1, vatSummary.totalInputVatIncurred);
                  const dedW = round2((vatSummary.deductibleInputVat / totalIn) * 100);
                  const nonDedCogsW = round2((vatSummary.nonDeductibleCogsVat / totalIn) * 100);
                  const nonDedOpexW = Math.max(0, round2(100 - dedW - nonDedCogsW));
                  return (
                    <div
                      className="w-full h-3 rounded-md bg-slate-100 dark:bg-slate-800 overflow-hidden flex"
                      role="img"
                      aria-label="Deductible vs Non-Deductible Input VAT Split"
                    >
                      <div
                        className="h-full bg-emerald-600 dark:bg-emerald-500"
                        style={{ width: `${dedW}%` }}
                        title={`${t(lang, 'مخصوم 1105', 'Deductible Acc 1105')}: ${fmtMoney(vatSummary.deductibleInputVat, 0)} EGP`}
                      />
                      <div
                        className="h-full bg-amber-500 dark:bg-amber-400"
                        style={{ width: `${nonDedCogsW}%` }}
                        title={`${t(lang, 'غير مخصوم — خامات بدون فاتورة إلكترونية', 'Non-Deductible COGS')}: ${fmtMoney(vatSummary.nonDeductibleCogsVat, 0)} EGP`}
                      />
                      <div
                        className="h-full bg-rose-500 dark:bg-rose-400"
                        style={{ width: `${nonDedOpexW}%` }}
                        title={`${t(lang, 'غير مخصوم — مصروفات 5301', 'Non-Deductible OpEx 5301')}: ${fmtMoney(vatSummary.nonDeductibleOpexVat, 0)} EGP`}
                      />
                    </div>
                  );
                })()}
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-xs bg-emerald-600 inline-block" />
                    <span className="font-mono-num" dir="ltr">
                      {t(lang, 'مخصوم 1105:', 'Deductible:')} {fmtMoney(vatSummary.deductibleInputVat, 0)}
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-xs bg-amber-500 inline-block" />
                    <span className="font-mono-num" dir="ltr">
                      {t(lang, 'خامات غير مفوترة:', 'COGS Disallowed:')} {fmtMoney(vatSummary.nonDeductibleCogsVat, 0)}
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-xs bg-rose-500 inline-block" />
                    <span className="font-mono-num" dir="ltr">
                      {t(lang, 'مصروفات 5301:', 'OpEx Disallowed:')} {fmtMoney(vatSummary.nonDeductibleOpexVat, 0)}
                    </span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* View 2: Monthly Filing Breakdown Table (ETA Form 10 with Deductible vs Non-Deductible) */}
        {vatViewMode === 'schedule' && (
          <div className="border-t border-slate-200 dark:border-slate-800 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300">
                  <th className="py-2.5 px-3.5 text-start font-semibold">{t(lang, 'الفترة الضريبية', 'Tax Period')}</th>
                  <th className="py-2.5 px-3.5 text-end font-semibold">{t(lang, 'وعاء المبيعات الصافي', 'Net Sales')}</th>
                  <th className="py-2.5 px-3.5 text-end font-semibold">{t(lang, 'المخرجات (2201)', 'Output (2201)')}</th>
                  <th className="py-2.5 px-3.5 text-end font-semibold">{t(lang, 'مدخلات مخصومة (1105)', 'Deductible (1105)')}</th>
                  <th className="py-2.5 px-3.5 text-end font-semibold">{t(lang, 'مدخلات غير مخصومة', 'Non-Deductible')}</th>
                  <th className="py-2.5 px-3.5 text-end font-semibold">{t(lang, 'إجمالي المدخلات', 'Total Incurred')}</th>
                  <th className="py-2.5 px-3.5 text-end font-semibold">{t(lang, 'نسبة الخصم %', 'Deduct %')}</th>
                  <th className="py-2.5 px-3.5 text-end font-semibold">{t(lang, 'صافي المستحق (ETA)', 'Net Payable (ETA)')}</th>
                  <th className="py-2.5 px-3.5 text-end font-semibold">{t(lang, 'التغير %', 'MoM %')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {vatSummary.monthlyBreakdown.map((row) => (
                  <tr key={row.key} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-2.5 px-3.5 font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                      {lang === 'ar' ? row.labelAr : row.labelEn}
                    </td>
                    <td className="py-2.5 px-3.5 text-end font-mono-num text-slate-600 dark:text-slate-300" dir="ltr">
                      {fmtMoney(row.netSales, 0)}
                    </td>
                    <td className="py-2.5 px-3.5 text-end font-mono-num font-semibold text-slate-900 dark:text-slate-100" dir="ltr">
                      {fmtMoney(row.outputVat, 2)}
                    </td>
                    <td className="py-2.5 px-3.5 text-end font-mono-num font-semibold text-emerald-700 dark:text-emerald-400" dir="ltr">
                      -{fmtMoney(row.deductibleInputVat, 2)}
                    </td>
                    <td className="py-2.5 px-3.5 text-end font-mono-num font-semibold text-amber-700 dark:text-amber-400" dir="ltr">
                      {fmtMoney(row.nonDeductibleInputVat, 2)}
                    </td>
                    <td className="py-2.5 px-3.5 text-end font-mono-num text-slate-700 dark:text-slate-300" dir="ltr">
                      {fmtMoney(row.totalInputVatIncurred, 2)}
                    </td>
                    <td className="py-2.5 px-3.5 text-end font-mono-num text-slate-700 dark:text-slate-300" dir="ltr">
                      {fmtPct(row.deductibilityPct, 1)}
                    </td>
                    <td className="py-2.5 px-3.5 text-end font-mono-num font-bold text-teal-800 dark:text-teal-300" dir="ltr">
                      {fmtMoney(row.netPayable, 2)}
                    </td>
                    <td className="py-2.5 px-3.5 text-end font-mono-num" dir="ltr">
                      {row.momDeltaPct === null ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        <span
                          className={
                            row.momDeltaPct > 0
                              ? 'text-amber-700 dark:text-amber-400 font-semibold'
                              : 'text-emerald-700 dark:text-emerald-400 font-semibold'
                          }
                        >
                          {row.momDeltaPct > 0 ? '+' : ''}
                          {fmtPct(row.momDeltaPct, 1)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                <tr className="bg-slate-50/90 dark:bg-slate-800/70 font-bold border-t border-slate-200 dark:border-slate-700">
                  <td className="py-2.5 px-3.5 text-slate-900 dark:text-slate-100">
                    {t(lang, 'إجمالي الفترة المحددة', 'Selected Period Total')}
                  </td>
                  <td className="py-2.5 px-3.5 text-end font-mono-num text-slate-800 dark:text-slate-200" dir="ltr">
                    {fmtMoney(metrics.net, 0)}
                  </td>
                  <td className="py-2.5 px-3.5 text-end font-mono-num text-slate-900 dark:text-slate-100" dir="ltr">
                    {fmtMoney(vatSummary.outputVat, 2)}
                  </td>
                  <td className="py-2.5 px-3.5 text-end font-mono-num text-emerald-700 dark:text-emerald-400" dir="ltr">
                    -{fmtMoney(vatSummary.deductibleInputVat, 2)}
                  </td>
                  <td className="py-2.5 px-3.5 text-end font-mono-num text-amber-700 dark:text-amber-400" dir="ltr">
                    {fmtMoney(vatSummary.nonDeductibleInputVat, 2)}
                  </td>
                  <td className="py-2.5 px-3.5 text-end font-mono-num text-slate-800 dark:text-slate-200" dir="ltr">
                    {fmtMoney(vatSummary.totalInputVatIncurred, 2)}
                  </td>
                  <td className="py-2.5 px-3.5 text-end font-mono-num text-slate-800 dark:text-slate-200" dir="ltr">
                    {fmtPct(vatSummary.deductibilityRatioPct, 1)}
                  </td>
                  <td className="py-2.5 px-3.5 text-end font-mono-num text-teal-800 dark:text-teal-300" dir="ltr">
                    {fmtMoney(vatSummary.netVatPayable, 2)} {t(lang, 'ج.م', 'EGP')}
                  </td>
                  <td className="py-2.5 px-3.5 text-end text-slate-400">—</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* View 3: ETA Compliance & Input VAT Deductibility Audit View */}
        {vatViewMode === 'audit' && (
          <div className="border-t border-slate-200 dark:border-slate-800">
            <div className="px-5 py-3.5 bg-slate-50/60 dark:bg-slate-800/30 border-b border-slate-200 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100">
                  {t(
                    lang,
                    'مصفوفة الفحص الضريبي لمدخلات القيمة المضافة — التوافق مع قانون 67 لسنة 2016 ومنظومة الفاتورة الإلكترونية (ETA)',
                    'ETA Input VAT Deductibility Audit Matrix — Law No. 67/2016 & e-Invoicing Compliance'
                  )}
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  {t(
                    lang,
                    'تصنيف كل تدفقات المشتريات والمصروفات بين الضريبة القابلة للخصم في نموذج 10 (حساب 1105) والضريبة المحملة على التكلفة (5101 / 5301) والتدفقات المعفاة.',
                    'Classifies all procurement & operating outflows into ETA Form 10 creditable Input VAT (Acc 1105), disallowed/absorbed P&L VAT (5101/5301), and exempt schedules.'
                  )}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs font-mono-num shrink-0" dir="ltr">
                <span className="text-emerald-700 dark:text-emerald-400 font-bold">
                  {t(lang, 'مخصوم:', 'Deductible:')} {fmtMoney(vatSummary.deductibleInputVat, 2)}
                </span>
                <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span>
                <span className="text-amber-700 dark:text-amber-400 font-bold">
                  {t(lang, 'غير مخصوم:', 'Non-Deductible:')} {fmtMoney(vatSummary.nonDeductibleInputVat, 2)}
                </span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300">
                    <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'البند الضريبي والمعالجة المحاسبية', 'Tax Bucket & Treatment')}</th>
                    <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'السند القانوني ETA', 'ETA Statutory Basis')}</th>
                    <th className="py-2.5 px-4 text-center font-semibold">{t(lang, 'حساب الأستاذ', 'GL Account')}</th>
                    <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'الوعاء الصافي (ج.م)', 'Base Amount')}</th>
                    <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'ضريبة مخصومة (1105)', 'Deductible VAT')}</th>
                    <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'ضريبة غير مخصومة', 'Non-Deductible VAT')}</th>
                    <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'حالة الفحص', 'Audit Classification')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {vatSummary.etaAuditBuckets.map((bucket) => (
                    <tr key={bucket.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 align-top">
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {lang === 'ar' ? bucket.titleAr : bucket.titleEn}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                          {lang === 'ar' ? bucket.auditNoteAr : bucket.auditNoteEn}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-[11px] text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {lang === 'ar' ? bucket.etaRefAr : bucket.etaRefEn}
                      </td>
                      <td className="py-3 px-4 text-center font-mono-num font-semibold text-slate-700 dark:text-slate-200" dir="ltr">
                        {bucket.glAccount}
                      </td>
                      <td className="py-3 px-4 text-end font-mono-num text-slate-800 dark:text-slate-200" dir="ltr">
                        {fmtMoney(bucket.baseAmount, 0)}
                      </td>
                      <td className="py-3 px-4 text-end font-mono-num font-bold text-emerald-700 dark:text-emerald-400" dir="ltr">
                        {bucket.deductibleVat > 0 ? `-${fmtMoney(bucket.deductibleVat, 2)}` : '—'}
                      </td>
                      <td className="py-3 px-4 text-end font-mono-num font-bold text-amber-700 dark:text-amber-400" dir="ltr">
                        {bucket.nonDeductibleVat > 0 ? fmtMoney(bucket.nonDeductibleVat, 2) : '—'}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-[11px] font-semibold">
                        {bucket.treatment === 'deductible' && (
                          <span className="text-emerald-700 dark:text-emerald-400">
                            {t(lang, 'مقبول بالخصم — نموذج 10', 'Creditable (Form 10)')}
                          </span>
                        )}
                        {bucket.treatment === 'non_deductible' && (
                          <span className="text-amber-700 dark:text-amber-400">
                            {t(lang, 'مرفوض الخصم — محمل P&L', 'Disallowed (P&L Cost)')}
                          </span>
                        )}
                        {bucket.treatment === 'exempt_out_of_scope' && (
                          <span className="text-slate-600 dark:text-slate-300">
                            {t(lang, 'معفى / خارج نطاق VAT', 'Exempt / Out-of-Scope')}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-slate-50/90 dark:bg-slate-800/70 font-bold border-t border-slate-200 dark:border-slate-700">
                    <td colSpan={3} className="py-3 px-4 text-slate-900 dark:text-slate-100">
                      {t(lang, 'إجمالي مطابقة ضريبة المدخلات والوعاء الكلي للفترة', 'Total Input VAT Audit Reconciliation')}
                    </td>
                    <td className="py-3 px-4 text-end font-mono-num text-slate-900 dark:text-slate-100" dir="ltr">
                      {fmtMoney(
                        round2(
                          vatSummary.taxablePurchasesBase +
                            vatSummary.nonDeductiblePurchasesBase +
                            vatSummary.exemptOutOfScopeBase
                        ),
                        0
                      )}
                    </td>
                    <td className="py-3 px-4 text-end font-mono-num text-emerald-700 dark:text-emerald-400" dir="ltr">
                      -{fmtMoney(vatSummary.deductibleInputVat, 2)}
                    </td>
                    <td className="py-3 px-4 text-end font-mono-num text-amber-700 dark:text-amber-400" dir="ltr">
                      {fmtMoney(vatSummary.nonDeductibleInputVat, 2)}
                    </td>
                    <td className="py-3 px-4 font-mono-num text-slate-800 dark:text-slate-200" dir="ltr">
                      {fmtPct(vatSummary.deductibilityRatioPct, 1)} {t(lang, 'استرداد', 'recov.')}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Tax Shield Optimization & Exempt Base Footnote */}
            <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20 grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
              <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 space-y-1.5">
                <div className="font-bold text-slate-900 dark:text-slate-100">
                  {t(lang, 'توصية التحسين الضريبي للمدير المالي (CFO Tax Shield Action)', 'CFO Tax-Shield Recovery Opportunity')}
                </div>
                <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                  {t(
                    lang,
                    `تتكبد الشركة حالياً ${fmtMoney(vatSummary.nonDeductibleInputVat, 2)} ج.م كضريبة مدخلات غير قابلة للخصم (${fmtMoney(vatSummary.nonDeductibleCogsVat, 0)} ج.م خامات بدون فاتورة إلكترونية + ${fmtMoney(vatSummary.nonDeductibleOpexVat, 0)} ج.م مصروفات 5301). تحويل موردي الخضروات والصيانة لإصدار فواتير ETA B2B يخفض صافي السداد الضريبي من ${fmtMoney(vatSummary.netVatPayable, 0)} ج.م إلى ${fmtMoney(vatSummary.hypotheticalNetPayableIfAllDeductible, 0)} ج.م.`,
                    `Estadat currently absorbs ${fmtMoney(vatSummary.nonDeductibleInputVat, 2)} EGP in non-deductible input VAT (${fmtMoney(vatSummary.nonDeductibleCogsVat, 0)} EGP uninvoiced COGS + ${fmtMoney(vatSummary.nonDeductibleOpexVat, 0)} EGP gross 5301 OpEx). Migrating produce & maintenance vendors to ETA B2B e-invoices could lower net ETA payable from ${fmtMoney(vatSummary.netVatPayable, 0)} to ${fmtMoney(vatSummary.hypotheticalNetPayableIfAllDeductible, 0)} EGP.`
                  )}
                </p>
              </div>
              <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 space-y-1.5">
                <div className="font-bold text-slate-900 dark:text-slate-100">
                  {t(lang, 'تفصيل البنود المعفاة وخارج نطاق VAT (للإقرار)', 'Exempt & Out-of-Scope Outflow Breakdown')}
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-slate-600 dark:text-slate-300">
                  <div className="flex justify-between">
                    <span>{t(lang, 'رواتب ومنح (5201)', 'Payroll (5201)')}</span>
                    <span className="font-mono-num font-semibold" dir="ltr">{fmtMoney(vatSummary.exemptPayrollBase, 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{t(lang, 'حق الانتفاع (5202)', 'Usufruct (5202)')}</span>
                    <span className="font-mono-num font-semibold" dir="ltr">{fmtMoney(vatSummary.exemptUsufructBase, 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{t(lang, 'كهرباء ومرافق (0% مخصوم)', 'Electricity (0% Credit)')}</span>
                    <span className="font-mono-num font-semibold" dir="ltr">{fmtMoney(vatSummary.exemptUtilitiesBase, 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{t(lang, 'عمولات بنكية معفاة (5308)', 'Bank Fees Exempt (5308)')}</span>
                    <span className="font-mono-num font-semibold" dir="ltr">{fmtMoney(vatSummary.exemptBankFeesBase, 0)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* View 4: Output vs Input Invoice Sources & GL Reconciliation */}
        {vatViewMode === 'sources' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x lg:rtl:divide-x-reverse divide-slate-200 dark:divide-slate-800 border-t border-slate-200 dark:border-slate-800">
            {/* Sales Output VAT Sources */}
            <div className="p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <ArrowLeftRight className="w-4 h-4 text-teal-700 dark:text-teal-400" />
                  <span>{t(lang, 'مصادر ضريبة المخرجات (المبيعات — Acc 2201)', 'Output VAT Sources (Sales — Acc 2201)')}</span>
                </h3>
                <span className="font-mono-num text-xs font-bold text-teal-700 dark:text-teal-300" dir="ltr">
                  {fmtMoney(vatSummary.outputVat, 2)} EGP
                </span>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg text-xs">
                <div className="px-3.5 py-2.5 flex items-center justify-between">
                  <span className="text-slate-600 dark:text-slate-300">
                    {t(lang, 'مخرجات الفترة الأساسية المراجعة', 'Audited Base Period Output VAT')}
                  </span>
                  <span className="font-mono-num font-semibold text-slate-900 dark:text-slate-100" dir="ltr">
                    {fmtMoney(round2(vatSummary.outputVat - (period === '9m_plus_live' ? livePosDelta.vat : 0)), 2)}
                  </span>
                </div>
                <div className="px-3.5 py-2.5 flex items-center justify-between">
                  <span className="text-slate-600 dark:text-slate-300">
                    {t(lang, `فواتير كاشير POS المسجلة (${vatSummary.salesPosCount})`, `Recorded POS Invoices (${vatSummary.salesPosCount})`)}
                  </span>
                  <span className="font-mono-num font-semibold text-slate-900 dark:text-slate-100" dir="ltr">
                    {fmtMoney(vatSummary.salesPosVat, 2)}
                  </span>
                </div>
                <div className="px-3.5 py-2.5 flex items-center justify-between">
                  <span className="text-slate-600 dark:text-slate-300">
                    {t(lang, `طلبات فودكس والتوصيل (${vatSummary.salesFoodicsCount})`, `Foodics / Delivery Invoices (${vatSummary.salesFoodicsCount})`)}
                  </span>
                  <span className="font-mono-num font-semibold text-slate-900 dark:text-slate-100" dir="ltr">
                    {fmtMoney(vatSummary.salesFoodicsVat, 2)}
                  </span>
                </div>
                <div className="px-3.5 py-2.5 flex items-center justify-between bg-slate-50/70 dark:bg-slate-800/40">
                  <span className="font-medium text-slate-700 dark:text-slate-200">
                    {t(lang, 'رصيد حساب 2201 بدفتر الأستاذ التراكمي', 'Cumulative GL Account 2201 Balance')}
                  </span>
                  <span className="font-mono-num font-bold text-teal-800 dark:text-teal-300" dir="ltr">
                    {fmtMoney(vatSummary.ledgerOutput2201, 2)}
                  </span>
                </div>
              </div>
            </div>

            {/* Purchases Input VAT Sources (Deductible 1105 + Non-Deductible Disallowed) */}
            <div className="p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <ArrowLeftRight className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
                  <span>{t(lang, 'مصادر ضريبة المدخلات (المخصومة 1105 وغير المخصومة)', 'Input VAT Sources (Deductible 1105 & Non-Deductible)')}</span>
                </h3>
                <span className="font-mono-num text-xs font-bold text-emerald-700 dark:text-emerald-400" dir="ltr">
                  -{fmtMoney(vatSummary.deductibleInputVat, 2)} / +{fmtMoney(vatSummary.nonDeductibleInputVat, 2)}
                </span>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg text-xs">
                <div className="px-3.5 py-2.5 flex items-center justify-between">
                  <span className="text-slate-600 dark:text-slate-300">
                    {t(lang, 'مدخلات مخصومة — فواتير موردين أساسية (Acc 1105)', 'Deductible Base Purchase Input VAT (Acc 1105)')}
                  </span>
                  <span className="font-mono-num font-semibold text-emerald-700 dark:text-emerald-400" dir="ltr">
                    -{fmtMoney(round2(vatSummary.deductibleInputVat - (period === '9m_plus_live' ? vatSummary.livePurchaseVat + vatSummary.liveExpenseVat : 0)), 2)}
                  </span>
                </div>
                <div className="px-3.5 py-2.5 flex items-center justify-between">
                  <span className="text-slate-600 dark:text-slate-300">
                    {t(lang, `مدخلات مخصومة — مشتريات ومصروفات مباشرة (${vatSummary.livePurchasesCount + vatSummary.liveTaxableExpensesCount})`, `Live Deductible PO & OpEx VAT (${vatSummary.livePurchasesCount + vatSummary.liveTaxableExpensesCount})`)}
                    {vatSummary.seededPurchaseVat > 0 && (
                      <span className="text-[11px] text-slate-400 ms-1" dir="ltr">
                        (+{fmtMoney(vatSummary.seededPurchaseVat, 0)} PO-SEED)
                      </span>
                    )}
                  </span>
                  <span className="font-mono-num font-semibold text-emerald-700 dark:text-emerald-400" dir="ltr">
                    -{fmtMoney(round2(vatSummary.livePurchaseVat + vatSummary.liveExpenseVat), 2)}
                  </span>
                </div>
                <div className="px-3.5 py-2.5 flex items-center justify-between">
                  <span className="text-amber-800 dark:text-amber-300">
                    {t(lang, 'غير مخصوم — مشتريات خامات بدون فاتورة إلكترونية (5101)', 'Non-Deductible — Uninvoiced COGS Purchases (5101)')}
                  </span>
                  <span className="font-mono-num font-semibold text-amber-700 dark:text-amber-400" dir="ltr">
                    {fmtMoney(vatSummary.nonDeductibleCogsVat, 2)}
                  </span>
                </div>
                <div className="px-3.5 py-2.5 flex items-center justify-between">
                  <span className="text-amber-800 dark:text-amber-300">
                    {t(lang, 'غير مخصوم — ضريبة ضمنية بمصروفات 5301 (Art. 22)', 'Non-Deductible — Gross 5301 OpEx Embedded VAT')}
                  </span>
                  <span className="font-mono-num font-semibold text-amber-700 dark:text-amber-400" dir="ltr">
                    {fmtMoney(vatSummary.nonDeductibleOpexVat, 2)}
                  </span>
                </div>
                <div className="px-3.5 py-2.5 flex items-center justify-between bg-slate-50/70 dark:bg-slate-800/40">
                  <span className="font-medium text-slate-700 dark:text-slate-200">
                    {t(lang, 'رصيد حساب 1105 المخصوم بدفتر الأستاذ التراكمي', 'Cumulative GL Account 1105 (Deductible Balance)')}
                  </span>
                  <span className="font-mono-num font-bold text-emerald-700 dark:text-emerald-400" dir="ltr">
                    {fmtMoney(vatSummary.ledgerInput1105, 2)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Automated MoM Revenue Growth Monitor (< 5% for 2+ Consecutive Months) */}
      <section
        id="revenue-growth-alerts"
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-col xl:flex-row xl:items-center justify-between gap-4 bg-slate-50/70 dark:bg-slate-800/40">
          <div className="flex items-start gap-3">
            <div
              className={`p-2 rounded-lg border shrink-0 ${
                revenueGrowthMonitor.triggered
                  ? 'bg-red-50 dark:bg-red-950/60 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
                  : 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
              }`}
            >
              <TrendingDown className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {t(
                    lang,
                    'المراقب التلقائي لنمو الإيرادات الشهري (تنبيه < 5% لشهرين متتاليين)',
                    'Automated MoM Revenue Growth Alert Monitor (< 5% Consecutive Check)'
                  )}
                </h2>
                <span
                  className={`px-2 py-0.5 rounded border text-[11px] font-bold font-mono-num ${
                    revenueGrowthMonitor.triggered
                      ? 'bg-red-50 dark:bg-red-950/60 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
                      : 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                  }`}
                  dir="ltr"
                >
                  {revenueGrowthMonitor.triggered
                    ? `${revenueGrowthMonitor.streaks.length} Streak(s) · Max ${revenueGrowthMonitor.maxConsecutiveStreak}m`
                    : 'Healthy ≥ 5% MoM'}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {t(
                  lang,
                  `يفحص معدل نمو صافي الإيراد شهراً بشهر عبر البيانات المراجعة ويُطلق إشعاراً تلقائياً عند انخفاض النمو عن +${revGrowthThresholdPct}% لمدة ${revConsecutiveTarget} شهور متتالية أو أكثر مع رابط مباشر لوحدة مراجعة الأداء.`,
                  `Continuously evaluates audited month-over-month net revenue growth and triggers an automated alert whenever growth stays below +${revGrowthThresholdPct}% for ${revConsecutiveTarget}+ consecutive months, linking directly to Performance Review.`
                )}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5">
              <span className="text-slate-500 dark:text-slate-400">{t(lang, 'الحد الأدنى MoM', 'Min MoM')}</span>
              <select
                value={revGrowthThresholdPct}
                onChange={(e) => setRevGrowthThresholdPct(Number(e.target.value))}
                className="font-mono-num font-bold text-slate-900 dark:text-slate-100 bg-transparent outline-none cursor-pointer"
                dir="ltr"
              >
                <option value={3}>+3%</option>
                <option value={5}>+5%</option>
                <option value={8}>+8%</option>
                <option value={10}>+10%</option>
              </select>
            </label>

            <label className="flex items-center gap-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5">
              <span className="text-slate-500 dark:text-slate-400">{t(lang, 'شهور متتالية', 'Streak')}</span>
              <select
                value={revConsecutiveTarget}
                onChange={(e) => setRevConsecutiveTarget(Number(e.target.value))}
                className="font-mono-num font-bold text-slate-900 dark:text-slate-100 bg-transparent outline-none cursor-pointer"
                dir="ltr"
              >
                <option value={2}>2+ mo</option>
                <option value={3}>3+ mo</option>
                <option value={4}>4+ mo</option>
              </select>
            </label>

            <button
              type="button"
              onClick={() => setShowRevGrowthNotifLog(!showRevGrowthNotifLog)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              <BellRing className="w-3.5 h-3.5 text-red-600" />
              <span>{t(lang, 'سجل الإشعارات', 'Alert Log')}</span>
              {unreadRevGrowthNotifCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-red-600 text-white text-[10px] font-mono-num">
                  {unreadRevGrowthNotifCount}
                </span>
              )}
            </button>

            {revenueGrowthMonitor.triggered && (
              <button
                type="button"
                onClick={() => dispatchRevenueGrowthNotification('manual_dispatch')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 hover:bg-red-100 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{t(lang, 'إعادة إرسال التنبيه', 'Dispatch Alert')}</span>
              </button>
            )}

            <button
              type="button"
              onClick={openPerformanceReviewDrilldown}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:opacity-90 cursor-pointer"
            >
              <span>{t(lang, 'الانتقال لوحدة مراجعة الأداء', 'Open Performance Review')}</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Summary KPI Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x lg:rtl:divide-x-reverse divide-slate-200 dark:divide-slate-800 border-b border-slate-200 dark:border-slate-800">
          <div className="px-5 py-3">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {t(lang, 'موجات التباطؤ المرصودة (≥ شهرين)', 'Triggered Streaks (2+ Consecutive Mos)')}
            </div>
            <div className={`text-lg font-bold font-mono-num mt-0.5 ${revenueGrowthMonitor.triggered ? 'text-red-700 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}`} dir="ltr">
              {revenueGrowthMonitor.streaks.length} {t(lang, 'موجات', 'Streak(s)')}
            </div>
          </div>
          <div className="px-5 py-3">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {t(lang, 'أحدث موجة تباطؤ متتالية', 'Latest Consecutive Slowdown')}
            </div>
            <div className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-1">
              {revenueGrowthMonitor.latestStreak
                ? `${lang === 'ar' ? revenueGrowthMonitor.latestStreak.rangeLabelAr : revenueGrowthMonitor.latestStreak.rangeLabelEn} (${revenueGrowthMonitor.latestStreak.length}m)`
                : t(lang, 'لا يوجد تباطؤ متتالي', 'None Detected')}
            </div>
          </div>
          <div className="px-5 py-3">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {t(lang, `إجمالي الشهور < +${revGrowthThresholdPct}%`, `Total Months < +${revGrowthThresholdPct}% MoM`)}
            </div>
            <div className="text-lg font-bold font-mono-num text-amber-700 dark:text-amber-400 mt-0.5" dir="ltr">
              {revenueGrowthMonitor.belowMonthsCount} / {Math.max(0, revenueGrowthMonitor.evaluatedMonths.length - 1)}
            </div>
          </div>
          <div className="px-5 py-3 flex items-center justify-between gap-2">
            <div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                {t(lang, 'أقصى سلسلة انخفاض متتالية', 'Longest Streak Below Target')}
              </div>
              <div className="text-lg font-bold font-mono-num text-slate-900 dark:text-slate-100 mt-0.5" dir="ltr">
                {revenueGrowthMonitor.maxConsecutiveStreak} {t(lang, 'شهور', 'Months')}
              </div>
            </div>
            <button
              type="button"
              onClick={openPerformanceReviewDrilldown}
              className="text-xs font-bold text-teal-700 dark:text-teal-400 hover:underline inline-flex items-center gap-1 cursor-pointer shrink-0"
            >
              <span>{t(lang, 'التفاصيل', 'Drill Down')}</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Collapsible Revenue Growth Alert Dispatch Log */}
        {showRevGrowthNotifLog && (
          <div className="px-5 py-4 bg-slate-50/80 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                {t(lang, 'سجل تنبيهات تباطؤ نمو الإيرادات التلقائية', 'Automated Revenue Slowdown Alert Dispatch Log')}
              </div>
              {unreadRevGrowthNotifCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const updated = revGrowthNotifications.map((n) => ({ ...n, acknowledged: true }));
                    setRevGrowthNotifications(updated);
                    saveRevGrowthNotificationsToStorage(updated);
                    setActiveRevGrowthToast(null);
                  }}
                  className="text-[11px] font-semibold text-teal-700 dark:text-teal-400 hover:underline cursor-pointer"
                >
                  {t(lang, 'تحديد الكل كمقروء', 'Mark All Acknowledged')}
                </button>
              )}
            </div>
            {revGrowthNotifications.length === 0 ? (
              <div className="text-xs text-slate-500 py-2">
                {t(lang, 'لا توجد تنبيهات مسجلة حتى الآن.', 'No alerts dispatched yet.')}
              </div>
            ) : (
              <div className="space-y-2 max-h-52 overflow-y-auto">
                {revGrowthNotifications.map((n) => (
                  <div
                    key={n.id}
                    className={`p-3 rounded-lg border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                      n.acknowledged
                        ? 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                        : 'bg-red-50/70 dark:bg-red-950/35 border-red-200 dark:border-red-800 text-slate-900 dark:text-slate-100'
                    }`}
                  >
                    <div className="space-y-0.5">
                      <div className="font-bold flex flex-wrap items-center gap-2">
                        <span>{lang === 'ar' ? n.titleAr : n.titleEn}</span>
                        <span className="font-mono-num text-[10px] text-slate-500" dir="ltr">{n.createdAt}</span>
                      </div>
                      <div className="text-[11px] opacity-90">{lang === 'ar' ? n.messageAr : n.messageEn}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={openPerformanceReviewDrilldown}
                        className="px-2.5 py-1 rounded bg-red-700 text-white text-[11px] font-semibold hover:bg-red-800 cursor-pointer"
                      >
                        {t(lang, 'مراجعة الأداء', 'Performance Review')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Monthly MoM Revenue Growth Audit Strip */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300">
                <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'الشهر', 'Month')}</th>
                <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'صافي الإيراد (Ex-VAT)', 'Net Revenue')}</th>
                <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'التغير الشهري (ج.م)', 'MoM Delta (EGP)')}</th>
                <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'نسبة النمو MoM %', 'MoM Growth %')}</th>
                <th className="py-2.5 px-4 text-center font-semibold">{t(lang, 'التسلسل < الحد', 'Consecutive Streak')}</th>
                <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'حالة التنبيه', 'Alert Status')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {revenueGrowthMonitor.evaluatedMonths.map((row) => {
                const isTriggered = row.isConsecutiveTriggerMonth;
                const isSingleBelow = row.isBelowThreshold && !isTriggered;
                return (
                  <tr
                    key={row.month}
                    className={
                      isTriggered
                        ? 'bg-red-50/45 dark:bg-red-950/20 hover:bg-red-50/70'
                        : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/30'
                    }
                  >
                    <td className="py-2.5 px-4 font-semibold text-slate-900 dark:text-slate-100">
                      {lang === 'ar' ? row.monthLabelAr : row.monthLabelEn}
                    </td>
                    <td className="py-2.5 px-4 text-end font-mono-num text-slate-800 dark:text-slate-200" dir="ltr">
                      {fmtMoney(row.netRevenue, 0)} EGP
                    </td>
                    <td
                      className={`py-2.5 px-4 text-end font-mono-num font-medium ${
                        row.deltaNetEgp === null
                          ? 'text-slate-400'
                          : row.deltaNetEgp >= 0
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-red-700 dark:text-red-400'
                      }`}
                      dir="ltr"
                    >
                      {row.deltaNetEgp === null
                        ? '—'
                        : `${row.deltaNetEgp >= 0 ? '+' : ''}${fmtMoney(row.deltaNetEgp, 0)}`}
                    </td>
                    <td
                      className={`py-2.5 px-4 text-end font-mono-num font-bold ${
                        row.revMomPct === null
                          ? 'text-slate-400'
                          : row.isBelowThreshold
                          ? 'text-red-700 dark:text-red-400'
                          : 'text-emerald-700 dark:text-emerald-400'
                      }`}
                      dir="ltr"
                    >
                      {row.revMomPct === null
                        ? 'Base'
                        : `${row.revMomPct >= 0 ? '+' : ''}${row.revMomPct.toFixed(1)}%`}
                    </td>
                    <td className="py-2.5 px-4 text-center font-mono-num" dir="ltr">
                      {row.revMomPct === null ? (
                        <span className="text-slate-400">—</span>
                      ) : row.consecutiveBelowCount > 0 ? (
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold border ${
                            isTriggered
                              ? 'bg-red-100 dark:bg-red-900/50 border-red-300 dark:border-red-700 text-red-800 dark:text-red-200'
                              : 'bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-700 text-amber-800 dark:text-amber-300'
                          }`}
                        >
                          #{row.consecutiveBelowCount} {t(lang, 'شهر', 'mo')}
                        </span>
                      ) : (
                        <span className="text-emerald-700 dark:text-emerald-400 font-semibold">0</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-end">
                      {row.revMomPct === null ? (
                        <span className="text-[11px] text-slate-400">{t(lang, 'شهر الأساس', 'Baseline')}</span>
                      ) : isTriggered ? (
                        <button
                          type="button"
                          onClick={openPerformanceReviewDrilldown}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-600 hover:bg-red-700 text-white text-[11px] font-semibold cursor-pointer transition-colors"
                        >
                          <span>{t(lang, 'تنبيه متتالي · مراجعة الأداء', 'Consecutive Alert · Review')}</span>
                          <ArrowUpRight className="w-3 h-3" />
                        </button>
                      ) : isSingleBelow ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-800 text-[11px] font-semibold">
                          {t(lang, 'شهر أول < الحد (مراقبة)', '1st Mo < Limit (Watch)')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>{t(lang, `≥ +${revGrowthThresholdPct}% مستهدف`, `≥ +${revGrowthThresholdPct}% OK`)}</span>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Proactive Operating Expense Budget Alert System by Cost Center */}
      <section
        id="cost-center-alerts"
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-col xl:flex-row xl:items-center justify-between gap-4 bg-slate-50/70 dark:bg-slate-800/40">
          <div className="flex items-start gap-3">
            <div
              className={`p-2 rounded-lg border shrink-0 ${
                costCenterMonitor.exceededCount > 0
                  ? 'bg-red-50 dark:bg-red-950/60 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
                  : costCenterMonitor.approachingCount > 0
                  ? 'bg-amber-50 dark:bg-amber-950/60 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300'
                  : 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
              }`}
            >
              <BellRing className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {t(
                    lang,
                    'نظام التنبيهات الاستباقي لتجاوز الميزانية حسب مركز التكلفة',
                    'Proactive Operating Expense Budget Alert System by Cost Center'
                  )}
                </h2>
                <span className="text-xs text-slate-500 dark:text-slate-400 font-mono-num" dir="ltr">
                  {costCenterMonitor.budgetMonths}M · {fmtPct(costCenterMonitor.overallUtilizationPct, 1)}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {t(
                  lang,
                  `مؤشر استهلاك الميزانية التفاعلي: يعرض نسبة المصروفات الفعلية مقابل الميزانية ويتحول للون الأحمر تلقائياً عند تجاوز 90% (أو تحذير مسبق عند ${warningThresholdPct}%).`,
                  `Interactive Budget Consumption Indicator: tracks actual expenses vs. allocated budget, turning red above 90% (with early warning at ${warningThresholdPct}%).`
                )}
              </p>
              <div className="flex flex-wrap items-center gap-3 mt-1.5 text-[11px] text-slate-600 dark:text-slate-400">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-xs bg-emerald-600 inline-block" />
                  <span>{t(lang, `آمن (<${warningThresholdPct}%)`, `Safe (<${warningThresholdPct}%)`)}</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-xs bg-amber-500 inline-block" />
                  <span>{t(lang, `اقترب (${warningThresholdPct}%–90%)`, `Approaching (${warningThresholdPct}%–90%)`)}</span>
                </span>
                <span className="inline-flex items-center gap-1.5 font-semibold text-red-700 dark:text-red-400">
                  <span className="w-2.5 h-2.5 rounded-xs bg-red-600 inline-block" />
                  <span>{t(lang, 'حرج (>90% من الميزانية)', 'Critical Red (>90% Budget)')}</span>
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Warning Threshold Selector */}
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg text-xs">
              <span className="px-2 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                {t(lang, 'عتبة التحذير:', 'Warn at:')}
              </span>
              {[75, 80, 85, 90].map((th) => (
                <button
                  key={th}
                  type="button"
                  onClick={() => setWarningThresholdPct(th)}
                  className={`px-2 py-1 rounded-md font-mono-num font-semibold cursor-pointer ${
                    warningThresholdPct === th
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                  dir="ltr"
                >
                  {th}%
                </button>
              ))}
            </div>

            {/* Severity Filter */}
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
              {(
                [
                  { id: 'all', ar: `الكل (${costCenterMonitor.items.length})`, en: `All (${costCenterMonitor.items.length})` },
                  { id: 'exceeded', ar: `تجاوز (${costCenterMonitor.exceededCount})`, en: `Exceeded (${costCenterMonitor.exceededCount})` },
                  { id: 'approaching', ar: `اقترب (${costCenterMonitor.approachingCount})`, en: `Approaching (${costCenterMonitor.approachingCount})` },
                  { id: 'safe', ar: `آمن (${costCenterMonitor.safeCount})`, en: `Safe (${costCenterMonitor.safeCount})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setCostCenterFilter(tab.id)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap transition-colors cursor-pointer ${
                    costCenterFilter === tab.id
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {lang === 'ar' ? tab.ar : tab.en}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setIsEditingBudgets(!isEditingBudgets)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                isEditingBudgets
                  ? 'bg-teal-700 border-teal-700 text-white'
                  : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>{isEditingBudgets ? t(lang, 'إنهاء تعديل الميزانيات', 'Done Editing') : t(lang, 'تعديل الميزانيات', 'Edit Budgets')}</span>
            </button>

            {isEditingBudgets && (
              <button
                type="button"
                onClick={handleResetBudgets}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{t(lang, 'افتراضي', 'Reset')}</span>
              </button>
            )}
          </div>
        </div>

        {/* Summary Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x sm:rtl:divide-x-reverse divide-slate-200 dark:divide-slate-800 border-b border-slate-200 dark:border-slate-800">
          <div className="px-5 py-3 flex items-center justify-between gap-2 text-xs">
            <span className="text-slate-600 dark:text-slate-400">
              {t(lang, `الميزانية المعتمدة (${costCenterMonitor.budgetMonths} شهور)`, `Approved Budget (${costCenterMonitor.budgetMonths}M)`)}
            </span>
            <span className="text-sm font-bold font-mono-num text-slate-900 dark:text-slate-100" dir="ltr">
              {fmtMoney(costCenterMonitor.totalBudget, 0)} {t(lang, 'ج.م', 'EGP')}
            </span>
          </div>
          <div className="px-5 py-3 flex items-center justify-between gap-2 text-xs">
            <span className="text-slate-600 dark:text-slate-400">
              {t(lang, 'المنصرف الفعلي عبر المراكز', 'Actual Cost-Center Spend')}
            </span>
            <span className="text-sm font-bold font-mono-num text-slate-900 dark:text-slate-100" dir="ltr">
              {fmtMoney(costCenterMonitor.totalActual, 0)} {t(lang, 'ج.م', 'EGP')}
            </span>
          </div>
          <div
            className={`px-5 py-3 flex items-center justify-between gap-2 text-xs ${
              costCenterMonitor.totalActual > costCenterMonitor.totalBudget
                ? 'bg-red-50/50 dark:bg-red-950/30'
                : 'bg-emerald-50/40 dark:bg-emerald-950/20'
            }`}
          >
            <span className="font-semibold text-slate-700 dark:text-slate-200">
              {costCenterMonitor.totalActual > costCenterMonitor.totalBudget
                ? t(lang, 'صافي تجاوز الميزانية الكلية', 'Total Budget Overrun')
                : t(lang, 'الوفر المتاح في الميزانية', 'Remaining Budget Headroom')}
            </span>
            <span
              className={`text-sm font-bold font-mono-num ${
                costCenterMonitor.totalActual > costCenterMonitor.totalBudget
                  ? 'text-red-700 dark:text-red-400'
                  : 'text-emerald-700 dark:text-emerald-400'
              }`}
              dir="ltr"
            >
              {fmtMoney(Math.abs(costCenterMonitor.totalBudget - costCenterMonitor.totalActual), 0)} {t(lang, 'ج.م', 'EGP')}
            </span>
          </div>
        </div>

        {/* Cost Center Budget Cards / Visual Alert Rows */}
        <div className="divide-y divide-slate-200 dark:divide-slate-800">
          {filteredCostCenters.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
              {t(lang, 'لا توجد مراكز تكلفة مطابقة لهذا التصنيف.', 'No cost centers match this filter.')}
            </div>
          ) : (
            filteredCostCenters.map((cc) => {
              const isExceeded = cc.status === 'exceeded';
              const isRedZone = cc.utilizationPct > 90;
              const isAmberWarning = !isRedZone && cc.utilizationPct >= warningThresholdPct;
              const isFocused = selectedCcId === cc.id;
              const barFillColor = isRedZone
                ? 'bg-red-600 dark:bg-red-500'
                : isAmberWarning
                ? 'bg-amber-500 dark:bg-amber-400'
                : 'bg-emerald-600 dark:bg-emerald-500';
              const barPct = Math.min(100, Math.max(2, cc.utilizationPct));
              const ninetyPctMark = round2(cc.periodBudget * 0.9);
              const headroomTo90 = round2(ninetyPctMark - cc.actual);

              return (
                <div
                  key={cc.id}
                  className={`p-5 transition-colors ${
                    isFocused
                      ? 'bg-teal-50/40 dark:bg-teal-950/20'
                      : isRedZone
                      ? 'bg-red-50/25 dark:bg-red-950/15 hover:bg-red-50/40 dark:hover:bg-red-950/25'
                      : isAmberWarning
                      ? 'bg-amber-50/25 dark:bg-amber-950/15 hover:bg-amber-50/40 dark:hover:bg-amber-950/25'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    {/* Left: Identity + Interactive Budget Consumption Progress Bar + Action Guidance */}
                    <div className="space-y-2 flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono-num text-xs font-bold text-slate-500 dark:text-slate-400" dir="ltr">
                          {cc.id}
                        </span>
                        <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span>
                        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                          {lang === 'ar' ? cc.nameAr : cc.nameEn}
                        </h3>
                        <span className="font-mono-num text-[11px] text-slate-400 dark:text-slate-500" dir="ltr">
                          Acc {cc.accountsLabel}
                        </span>

                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-bold whitespace-nowrap ${
                            isRedZone
                              ? 'bg-red-50 dark:bg-red-950/60 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
                              : isAmberWarning
                              ? 'bg-amber-50 dark:bg-amber-950/60 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300'
                              : 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                          }`}
                        >
                          {isExceeded ? (
                            <>
                              <OctagonAlert className="w-3 h-3" />
                              {t(lang, 'تجاوز الميزانية (≥100%)', 'Budget Exceeded (≥100%)')}
                            </>
                          ) : isRedZone ? (
                            <>
                              <OctagonAlert className="w-3 h-3" />
                              {t(lang, 'منطقة الخطر (>90%)', 'Red Zone (>90%)')}
                            </>
                          ) : isAmberWarning ? (
                            <>
                              <AlertTriangle className="w-3 h-3" />
                              {t(lang, `اقترب من السقف (≥${warningThresholdPct}%)`, `Approaching Cap (≥${warningThresholdPct}%)`)}
                            </>
                          ) : (
                            <>
                              <CheckCircle2 className="w-3 h-3" />
                              {t(lang, 'ضمن الميزانية', 'Within Budget')}
                            </>
                          )}
                        </span>
                      </div>

                      {/* Interactive Budget Consumption Indicator & Progress Bar */}
                      <div className="space-y-1.5 pt-1">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                          <span className="font-semibold text-slate-700 dark:text-slate-300">
                            {t(lang, 'مؤشر استهلاك الميزانية (اضغط للتفاصيل والمحاكاة)', 'Budget Consumption Indicator (Click to Inspect / Adjust)')}
                          </span>
                          <span
                            className={`font-mono-num font-bold ${
                              isRedZone
                                ? 'text-red-600 dark:text-red-400'
                                : isAmberWarning
                                ? 'text-amber-700 dark:text-amber-400'
                                : 'text-emerald-700 dark:text-emerald-400'
                            }`}
                            dir="ltr"
                          >
                            {fmtPct(cc.utilizationPct, 1)}{' '}
                            {isRedZone
                              ? t(lang, '(تجاوز 90% — أحمر)', '(>90% Red)')
                              : t(lang, '(آمن)', '(OK)')}
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={() => setSelectedCcId(isFocused ? null : cc.id)}
                          aria-expanded={isFocused}
                          aria-label={`${lang === 'ar' ? cc.nameAr : cc.nameEn} ${fmtPct(cc.utilizationPct, 1)}`}
                          title={`${t(lang, 'استهلاك الميزانية:', 'Budget Consumption:')} ${fmtPct(cc.utilizationPct, 1)} (${fmtMoney(cc.actual, 0)} / ${fmtMoney(cc.periodBudget, 0)} EGP) — ${t(lang, 'اضغط لفتح المحاكي التفاعلي', 'Click to inspect & adjust budget')}`}
                          className="group relative w-full h-4 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 overflow-hidden block cursor-pointer focus:outline-none focus:ring-2 focus:ring-teal-600"
                        >
                          <div
                            className={`h-full transition-all duration-200 flex items-center justify-end px-1.5 ${barFillColor}`}
                            style={{ width: `${barPct}%` }}
                          >
                            {barPct >= 18 && (
                              <span className="text-[10px] font-mono-num font-bold text-white leading-none" dir="ltr">
                                {fmtPct(cc.utilizationPct, 1)}
                              </span>
                            )}
                          </div>
                          {/* Warning threshold marker line (if < 90%) */}
                          {warningThresholdPct < 90 && (
                            <div
                              className="absolute inset-y-0 w-0.5 bg-amber-700/70 dark:bg-amber-300/70 z-10 pointer-events-none"
                              style={{ insetInlineStart: `${warningThresholdPct}%` }}
                              title={`${t(lang, 'عتبة التحذير', 'Warning Threshold')}: ${warningThresholdPct}%`}
                            />
                          )}
                          {/* Mandatory 90% Red Zone threshold marker line */}
                          <div
                            className="absolute inset-y-0 w-0.5 bg-red-700 dark:bg-red-300 z-10 pointer-events-none"
                            style={{ insetInlineStart: '90%' }}
                            title={t(lang, 'حد التحول للأحمر: 90% من الميزانية', 'Red Alert Threshold: 90% of Budget')}
                          />
                        </button>

                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-300">
                          <div className="flex flex-wrap items-center gap-3 font-mono-num" dir="ltr">
                            <span>
                              <span className="text-slate-500 dark:text-slate-400">{t(lang, 'الفعلي:', 'Actual:')}</span>{' '}
                              <strong className="text-slate-900 dark:text-slate-100">{fmtMoney(cc.actual, 0)}</strong>
                            </span>
                            <span>/</span>
                            <span>
                              <span className="text-slate-500 dark:text-slate-400">{t(lang, 'الميزانية:', 'Budget:')}</span>{' '}
                              <strong className="text-slate-800 dark:text-slate-200">{fmtMoney(cc.periodBudget, 0)}</strong>
                            </span>
                            <span>·</span>
                            <span
                              className={`font-bold ${
                                isRedZone
                                  ? 'text-red-600 dark:text-red-400'
                                  : isAmberWarning
                                  ? 'text-amber-700 dark:text-amber-400'
                                  : 'text-emerald-700 dark:text-emerald-400'
                              }`}
                            >
                              {fmtPct(cc.utilizationPct, 1)}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono-num" dir="ltr">
                            <span className="text-slate-500 dark:text-slate-400">
                              {t(lang, 'معدل شهري:', 'Burn:')} {fmtMoney(cc.monthlyBurn, 0)} / {fmtMoney(cc.monthlyBudget, 0)}
                            </span>
                            <span
                              className={`font-bold ${
                                cc.variance < 0
                                  ? 'text-red-600 dark:text-red-400'
                                  : isRedZone
                                  ? 'text-red-700 dark:text-red-400'
                                  : 'text-emerald-700 dark:text-emerald-400'
                              }`}
                            >
                              {cc.variance < 0
                                ? `${t(lang, 'تجاوز:', 'Overrun:')} +${fmtMoney(Math.abs(cc.variance), 0)}`
                                : `${t(lang, 'متبقي:', 'Left:')} ${fmtMoney(cc.variance, 0)}`}{' '}
                              {t(lang, 'ج.م', 'EGP')}
                            </span>
                          </div>
                        </div>

                        {/* Interactive Budget Consumption Drilldown & Real-Time Allocation Slider */}
                        {isFocused && (
                          <div className="mt-2 p-3.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 space-y-3">
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                              <div>
                                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                  {t(lang, 'المصروفات الفعلية', 'Actual Spend')}
                                </div>
                                <div className="font-mono-num font-bold text-slate-900 dark:text-slate-100 mt-0.5" dir="ltr">
                                  {fmtMoney(cc.actual, 0)} EGP
                                </div>
                              </div>
                              <div>
                                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                  {t(lang, 'الميزانية المخصصة', 'Allocated Budget')}
                                </div>
                                <div className="font-mono-num font-bold text-slate-900 dark:text-slate-100 mt-0.5" dir="ltr">
                                  {fmtMoney(cc.periodBudget, 0)} EGP
                                </div>
                              </div>
                              <div>
                                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                  {t(lang, 'سقف الـ 90% الآمن', '90% Red Threshold')}
                                </div>
                                <div className="font-mono-num font-bold text-slate-800 dark:text-slate-200 mt-0.5" dir="ltr">
                                  {fmtMoney(ninetyPctMark, 0)} EGP
                                </div>
                              </div>
                              <div>
                                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                  {headroomTo90 < 0
                                    ? t(lang, 'تجاوز حد الـ 90%', 'Above 90% Red Line')
                                    : t(lang, 'متاح قبل حد 90%', 'Buffer Before 90%')}
                                </div>
                                <div
                                  className={`font-mono-num font-bold mt-0.5 ${
                                    headroomTo90 < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'
                                  }`}
                                  dir="ltr"
                                >
                                  {headroomTo90 < 0 ? '+' : ''}
                                  {fmtMoney(Math.abs(headroomTo90), 0)} EGP
                                </div>
                              </div>
                            </div>

                            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                              <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                                {t(lang, 'ضبط الميزانية الشهرية تفاعلياً:', 'Interactive Monthly Budget Adjuster:')}
                              </label>
                              <div className="flex items-center gap-3 flex-1 max-w-md">
                                <input
                                  type="range"
                                  min={5000}
                                  max={Math.max(850000, Math.ceil((cc.monthlyBurn * 1.5) / 5000) * 5000)}
                                  step={5000}
                                  value={cc.monthlyBudget}
                                  onChange={(e) => handleUpdateCostCenterBudget(cc.id, Number(e.target.value))}
                                  className="w-full accent-teal-700 cursor-pointer"
                                />
                                <span className="font-mono-num text-xs font-bold text-slate-900 dark:text-slate-100 w-28 text-end shrink-0" dir="ltr">
                                  {fmtMoney(cc.monthlyBudget, 0)} / mo
                                </span>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      <p className="text-xs text-slate-600 dark:text-slate-400">
                        {lang === 'ar' ? cc.actionAr : cc.actionEn}
                      </p>
                    </div>

                    {/* Right: Inline Budget Editor & Alert Controls */}
                    <div className="flex flex-wrap lg:flex-col items-center lg:items-end justify-between gap-2 shrink-0">
                      {isEditingBudgets && (
                        <div className="flex items-center gap-1.5">
                          <label className="text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                            {t(lang, 'الشهري (ج.م):', 'Monthly:')}
                          </label>
                          <input
                            type="number"
                            min={1000}
                            step={5000}
                            value={cc.monthlyBudget}
                            onChange={(e) => handleUpdateCostCenterBudget(cc.id, Number(e.target.value))}
                            className="w-28 px-2.5 py-1 text-xs font-mono-num font-semibold border border-slate-300 dark:border-slate-700 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-600"
                            dir="ltr"
                          />
                        </div>
                      )}

                      <div className="flex items-center gap-2">
                        {cc.status !== 'safe' && (
                          <button
                            type="button"
                            onClick={() =>
                              setAcknowledgedCcIds((prev) =>
                                prev.includes(cc.id) ? prev.filter((id) => id !== cc.id) : [...prev, cc.id]
                              )
                            }
                            className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-medium whitespace-nowrap cursor-pointer transition-colors ${
                              cc.isAcknowledged
                                ? 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400'
                                : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
                            }`}
                          >
                            {cc.isAcknowledged
                              ? t(lang, 'تم الإقرار ✓', 'Acknowledged ✓')
                              : t(lang, 'إقرار التنبيه', 'Acknowledge')}
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => onNavigate('accounting')}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-[11px] font-semibold whitespace-nowrap cursor-pointer transition-colors"
                        >
                          <span>{t(lang, 'دفتر المصروفات', 'Review Ledger')}</span>
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* Smart Food Cost Variance Alert System (Actual vs Theoretical Recipe Cost > 5%) */}
      <section
        id="food-cost-variance-alerts"
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-col xl:flex-row xl:items-center justify-between gap-4 bg-slate-50/70 dark:bg-slate-800/40">
          <div className="flex items-start gap-3">
            <div
              className={`p-2 rounded-lg border shrink-0 ${
                foodCostVariance.exceedsThreshold
                  ? 'bg-red-50 dark:bg-red-950/60 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
                  : 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
              }`}
            >
              <Calculator className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {t(
                    lang,
                    'نظام التنبيهات الذكي لانحراف تكلفة الغذاء (الفعلي مقابل تكلفة الوصفة النظرية Recipe Cost)',
                    'Smart Food Cost Variance Alert System (Actual vs. Theoretical Recipe Cost)'
                  )}
                </h2>
                <span
                  className={`text-xs font-mono-num font-bold ${
                    foodCostVariance.exceedsThreshold
                      ? 'text-red-700 dark:text-red-400'
                      : 'text-emerald-700 dark:text-emerald-400'
                  }`}
                  dir="ltr"
                >
                  {foodCostVariance.periodVariancePct >= 0 ? '+' : ''}
                  {fmtPct(foodCostVariance.periodVariancePct, 1)} vs {foodCostThresholdPct}% limit
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {t(
                  lang,
                  `يقارن تكلفة المبيعات الفعلية (COGS + الهالك وتضخم الشراء) بالتكلفة النظرية المعيارية BOM ويرسل إشعاراً تلقائياً عند تجاوز الانحراف ${foodCostThresholdPct}%.`,
                  `Compares actual COGS (incl. waste & PO inflation) against theoretical BOM standard cost and dispatches smart notifications when variance exceeds ${foodCostThresholdPct}%.`
                )}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Variance Threshold Selector */}
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg text-xs">
              <span className="px-2 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                {t(lang, 'عتبة الانحراف:', 'Alert >')}
              </span>
              {[3, 5, 8, 10].map((th) => (
                <button
                  key={th}
                  type="button"
                  onClick={() => setFoodCostThresholdPct(th)}
                  className={`px-2 py-1 rounded-md font-mono-num font-semibold cursor-pointer ${
                    foodCostThresholdPct === th
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                  dir="ltr"
                >
                  {th}%
                </button>
              ))}
            </div>

            {/* Recipe Filter */}
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
              {(
                [
                  { id: 'all', ar: `الكل (${foodCostVariance.recipeVariances.length})`, en: `All (${foodCostVariance.recipeVariances.length})` },
                  { id: 'exceeded', ar: `تجاوز >${foodCostThresholdPct}% (${foodCostVariance.exceedingRecipesCount})`, en: `>${foodCostThresholdPct}% Alert (${foodCostVariance.exceedingRecipesCount})` },
                  { id: 'within', ar: `آمن (${foodCostVariance.recipeVariances.length - foodCostVariance.exceedingRecipesCount})`, en: `Safe (${foodCostVariance.recipeVariances.length - foodCostVariance.exceedingRecipesCount})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFoodCostFilter(tab.id)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap transition-colors cursor-pointer ${
                    foodCostFilter === tab.id
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {lang === 'ar' ? tab.ar : tab.en}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setShowFoodCostNotifLog(!showFoodCostNotifLog)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <BellRing className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
              <span>
                {t(lang, `سجل الإشعارات (${unreadFoodCostNotifCount})`, `Alert Log (${unreadFoodCostNotifCount})`)}
              </span>
            </button>

            <button
              type="button"
              onClick={() =>
                dispatchFoodCostNotification({
                  channel: 'manual_dispatch',
                  variancePct: foodCostVariance.periodVariancePct,
                  varianceAmount: foodCostVariance.periodVarianceAmount,
                })
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-teal-700 hover:bg-teal-800 text-white whitespace-nowrap shrink-0 cursor-pointer transition-colors"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{t(lang, 'إرسال إشعار فوري', 'Dispatch Alert')}</span>
            </button>
          </div>
        </div>

        {/* 4-Column Actual vs Theoretical Recipe Cost Summary */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x sm:rtl:divide-x-reverse divide-slate-200 dark:divide-slate-800 border-b border-slate-200 dark:border-slate-800">
          <div className="p-4 space-y-1">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {t(lang, 'تكلفة الغذاء الفعلية (Actual Food Cost)', 'Actual Food Cost (Period COGS)')}
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xl font-bold font-mono-num text-slate-900 dark:text-slate-100" dir="ltr">
                {fmtMoney(foodCostVariance.periodActualFoodCost, 0)}
              </span>
              <span className="text-xs font-mono-num font-bold text-amber-700 dark:text-amber-400" dir="ltr">
                {fmtPct(foodCostVariance.periodActualPct, 1)}
              </span>
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {t(lang, `هالك مسجل بالمخزون: ${fmtMoney(foodCostVariance.liveWasteCostTotal, 0)} ج`, `Logged waste: ${fmtMoney(foodCostVariance.liveWasteCostTotal, 0)} EGP`)}
            </div>
          </div>

          <div className="p-4 space-y-1">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {t(lang, 'التكلفة النظرية للوصفات (Theoretical Recipe)', 'Theoretical Recipe Cost (Standard)')}
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xl font-bold font-mono-num text-teal-800 dark:text-teal-300" dir="ltr">
                {fmtMoney(foodCostVariance.periodTheoreticalRecipeCost, 0)}
              </span>
              <span className="text-xs font-mono-num font-bold text-teal-700 dark:text-teal-400" dir="ltr">
                {fmtPct(foodCostVariance.periodTheoreticalPct, 1)}
              </span>
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono-num" dir="ltr">
              {t(lang, `تكلفة BOM المباشرة: ${fmtPct(foodCostVariance.periodBomBaselinePct, 1)}`, `Live BOM baseline: ${fmtPct(foodCostVariance.periodBomBaselinePct, 1)}`)}
            </div>
          </div>

          <div
            className={`p-4 space-y-1 ${
              foodCostVariance.exceedsThreshold
                ? 'bg-red-50/50 dark:bg-red-950/30'
                : 'bg-emerald-50/40 dark:bg-emerald-950/20'
            }`}
          >
            <div className="text-xs font-medium text-slate-600 dark:text-slate-300">
              {t(lang, `فجوة الانحراف (حد الأمان ≤ ${foodCostThresholdPct}%)`, `Cost Variance (Limit ≤ ${foodCostThresholdPct}%)`)}
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span
                className={`text-xl font-bold font-mono-num ${
                  foodCostVariance.exceedsThreshold
                    ? 'text-red-700 dark:text-red-400'
                    : 'text-emerald-700 dark:text-emerald-400'
                }`}
                dir="ltr"
              >
                {foodCostVariance.periodVariancePct >= 0 ? '+' : ''}
                {fmtPct(foodCostVariance.periodVariancePct, 1)}
              </span>
              <span
                className={`text-xs font-mono-num font-bold ${
                  foodCostVariance.exceedsThreshold
                    ? 'text-red-700 dark:text-red-300'
                    : 'text-emerald-700 dark:text-emerald-300'
                }`}
                dir="ltr"
              >
                {foodCostVariance.periodVarianceAmount >= 0 ? '+' : ''}
                {fmtMoney(foodCostVariance.periodVarianceAmount, 0)} EGP
              </span>
            </div>
            <div className="text-[11px] font-semibold">
              {foodCostVariance.exceedsThreshold ? (
                <span className="text-red-700 dark:text-red-400">
                  {t(lang, `تجاوز عتبة ${foodCostThresholdPct}% — تنبيه نشط`, `Threshold >${foodCostThresholdPct}% Breached — Alert Active`)}
                </span>
              ) : (
                <span className="text-emerald-700 dark:text-emerald-400">
                  {t(lang, 'ضمن الحد المسموح للوصفة', 'Within Theoretical Allowance')}
                </span>
              )}
            </div>
          </div>

          <div className="p-4 space-y-1">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {t(lang, 'نطاق التنبيهات المرصودة', 'Breach Scope (Dishes & Months)')}
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xl font-bold font-mono-num text-slate-900 dark:text-slate-100" dir="ltr">
                {foodCostVariance.exceedingRecipesCount} / {foodCostVariance.recipeVariances.length}
              </span>
              <span className="text-xs font-mono-num text-red-600 dark:text-red-400 font-semibold" dir="ltr">
                {foodCostVariance.exceedingMonthsCount} {t(lang, 'شهور >5%', 'mo >5%')}
              </span>
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              <button
                type="button"
                onClick={() => onNavigate('inventory')}
                className="text-teal-700 dark:text-teal-400 hover:underline font-medium cursor-pointer"
              >
                {t(lang, 'تعديل وصفات BOM والهالك ←', 'Adjust BOM Recipes & Waste →')}
              </button>
            </div>
          </div>
        </div>

        {/* Collapsible Dispatched Notifications Audit Log */}
        {showFoodCostNotifLog && (
          <div className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                <BellRing className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400" />
                {t(lang, 'سجل الإشعارات الذكية المرسلة لتجاوز تكلفة الغذاء', 'Dispatched Food Cost Variance Notification Log')}
              </h3>
              {foodCostNotifications.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const updated = foodCostNotifications.map((n) => ({ ...n, acknowledged: true }));
                    setFoodCostNotifications(updated);
                    saveNotificationsToStorage(updated);
                    setActiveToastNotif(null);
                  }}
                  className="text-[11px] font-semibold text-teal-700 dark:text-teal-400 hover:underline cursor-pointer"
                >
                  {t(lang, 'تعليم الكل كمقروء', 'Mark All Acknowledged')}
                </button>
              )}
            </div>

            {foodCostNotifications.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t(lang, 'لم يتم إرسال إشعارات بعد.', 'No notifications dispatched yet.')}
              </p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {foodCostNotifications.map((n) => (
                  <div
                    key={n.id}
                    className={`p-3 rounded-lg border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                      n.acknowledged
                        ? 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 opacity-80'
                        : 'bg-red-50/70 dark:bg-red-950/35 border-red-200 dark:border-red-800'
                    }`}
                  >
                    <div className="space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2 font-bold text-slate-900 dark:text-slate-100">
                        <span>{lang === 'ar' ? n.titleAr : n.titleEn}</span>
                        <span className="font-mono-num text-[11px] text-slate-500 dark:text-slate-400 font-normal" dir="ltr">
                          {n.createdAt}
                        </span>
                      </div>
                      <p className="text-slate-600 dark:text-slate-300">
                        {lang === 'ar' ? n.messageAr : n.messageEn}
                      </p>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {t(lang, 'المستلمون:', 'Recipients:')} {lang === 'ar' ? n.recipientAr : n.recipientEn} ·{' '}
                        {n.channel === 'auto_monitor'
                          ? t(lang, 'رصد آلي ذكي', 'Auto Monitor')
                          : t(lang, 'إرسال يدوي فوري', 'Manual Dispatch')}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const updated = foodCostNotifications.map((item) =>
                          item.id === n.id ? { ...item, acknowledged: !item.acknowledged } : item
                        );
                        setFoodCostNotifications(updated);
                        saveNotificationsToStorage(updated);
                      }}
                      className="px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[11px] font-semibold text-slate-700 dark:text-slate-200 shrink-0 cursor-pointer"
                    >
                      {n.acknowledged ? t(lang, 'مقروء ✓', 'Acknowledged ✓') : t(lang, 'إقرار الإشعار', 'Acknowledge')}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Monthly Actual vs Theoretical Recipe Cost Bar Comparison */}
        <div className="p-5 border-b border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100">
                {t(
                  lang,
                  'المقارنة الشهرية: نسبة تكلفة الغذاء الفعلية مقابل التكلفة النظرية للوصفة (%)',
                  'Monthly Trajectory: Actual Food Cost % vs. Theoretical Recipe Standard %'
                )}
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {t(
                  lang,
                  `الخط المتقطع يمثل الحد الأقصى المسموح للانحراف (+${foodCostThresholdPct}% فوق التكلفة النظرية ${fmtPct(foodCostVariance.periodTheoreticalPct, 1)})`,
                  `Dashed threshold line marks +${foodCostThresholdPct}% deviation ceiling above ${fmtPct(foodCostVariance.periodTheoreticalPct, 1)} theoretical recipe standard.`
                )}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-600 dark:text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-teal-600 inline-block" />
                {t(lang, 'ضمن الحد', 'Within Threshold')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-red-600 inline-block" />
                {t(lang, `تجاوز +${foodCostThresholdPct}%`, `Variance >+${foodCostThresholdPct}%`)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-slate-400 dark:bg-slate-500 inline-block" />
                {t(lang, 'النظري (Recipe)', 'Theoretical Recipe')}
              </span>
            </div>
          </div>

          <div className="w-full overflow-x-auto">
            <div className="min-w-[640px] grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.max(1, foodCostVariance.monthlySeries.length)}, minmax(0, 1fr))` }}>
              {foodCostVariance.monthlySeries.map((m) => {
                const maxScale = 65;
                const actualH = Math.min(100, Math.max(6, (m.actualFoodCostPct / maxScale) * 100));
                const theoH = Math.min(100, Math.max(6, (m.theoreticalRecipePct / maxScale) * 100));
                return (
                  <div
                    key={m.monthKey}
                    className={`p-2.5 rounded-lg border text-center space-y-2 ${
                      m.exceedsThreshold
                        ? 'border-red-200 dark:border-red-800/80 bg-red-50/40 dark:bg-red-950/25'
                        : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40'
                    }`}
                  >
                    <div className="h-24 flex items-end justify-center gap-1.5 px-1">
                      <div className="w-4 h-full flex flex-col justify-end" title={`${t(lang, 'النظري', 'Theoretical')}: ${fmtPct(m.theoreticalRecipePct, 1)}`}>
                        <div
                          className="w-full rounded-t bg-slate-400 dark:bg-slate-500"
                          style={{ height: `${theoH}%` }}
                        />
                      </div>
                      <div className="w-4 h-full flex flex-col justify-end" title={`${t(lang, 'الفعلي', 'Actual')}: ${fmtPct(m.actualFoodCostPct, 1)}`}>
                        <div
                          className={`w-full rounded-t ${m.exceedsThreshold ? 'bg-red-600 dark:bg-red-500' : 'bg-teal-600 dark:bg-teal-500'}`}
                          style={{ height: `${actualH}%` }}
                        />
                      </div>
                    </div>
                    <div className="text-[11px] font-bold text-slate-800 dark:text-slate-200 truncate">
                      {lang === 'ar' ? m.labelAr.split(' ')[0] : m.labelEn.split(' ')[0]}
                    </div>
                    <div
                      className={`text-[11px] font-mono-num font-bold ${
                        m.exceedsThreshold ? 'text-red-700 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'
                      }`}
                      dir="ltr"
                    >
                      {m.variancePct >= 0 ? '+' : ''}
                      {fmtPct(m.variancePct, 1)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Dish / Recipe-by-Recipe Variance Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300">
                <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'الصنف / الكود', 'Menu Item / Code')}</th>
                <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'الهدف النظري للوصفة', 'Target Recipe Cost')}</th>
                <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'تكلفة BOM المعيارية', 'BOM Recipe Cost')}</th>
                <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'التكلفة الفعلية المقدرة', 'Actual Food Cost')}</th>
                <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'نسبة الانحراف', 'Variance %')}</th>
                <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'تحليل السبب الجذري', 'Root Cause Diagnosis')}</th>
                <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'إشعار / إجراء', 'Notify')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredRecipeVariances.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-slate-500 dark:text-slate-400">
                    {t(lang, 'لا توجد أصناف مطابقة لهذا التصنيف.', 'No recipes match this filter.')}
                  </td>
                </tr>
              ) : (
                filteredRecipeVariances.map((rec) => (
                  <tr
                    key={rec.menuItemId}
                    className={
                      rec.exceedsThreshold
                        ? 'bg-red-50/25 dark:bg-red-950/15 hover:bg-red-50/45 dark:hover:bg-red-950/25'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                    }
                  >
                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-900 dark:text-slate-100">
                        {lang === 'ar' ? rec.nameAr : rec.nameEn}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono-num" dir="ltr">
                        {rec.code} · {fmtMoney(rec.netSellingPrice, 0)} EGP net · {rec.unitsSold.toLocaleString()} u
                      </div>
                    </td>
                    <td className="py-3 px-4 text-end font-mono-num" dir="ltr">
                      <div className="font-semibold text-teal-800 dark:text-teal-300">
                        {fmtMoney(rec.targetRecipeCost, 2)} EGP
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {fmtPct(rec.targetFoodCostPct, 1)}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-end font-mono-num text-slate-700 dark:text-slate-300" dir="ltr">
                      <div>{fmtMoney(rec.theoreticalRecipeCost, 2)} EGP</div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {fmtPct(rec.theoreticalRecipePct, 1)}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-end font-mono-num" dir="ltr">
                      <div className="font-bold text-slate-900 dark:text-slate-100">
                        {fmtMoney(rec.actualUnitFoodCost, 2)} EGP
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {fmtPct(rec.actualFoodCostPct, 1)} ({rec.wasteAndPriceDriftPct >= 0 ? '+' : ''}
                        {fmtPct(rec.wasteAndPriceDriftPct, 1)} BOM)
                      </div>
                    </td>
                    <td className="py-3 px-4 text-end font-mono-num" dir="ltr">
                      <div
                        className={`font-bold ${
                          rec.exceedsThreshold
                            ? 'text-red-700 dark:text-red-400'
                            : 'text-emerald-700 dark:text-emerald-400'
                        }`}
                      >
                        {rec.variancePct >= 0 ? '+' : ''}
                        {fmtPct(rec.variancePct, 1)}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {rec.varianceAmountPerUnit >= 0 ? '+' : ''}
                        {fmtMoney(rec.varianceAmountPerUnit, 1)} / u
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-300 max-w-[240px]">
                      {lang === 'ar' ? rec.driverAr : rec.driverEn}
                    </td>
                    <td className="py-3 px-4 text-end">
                      {rec.exceedsThreshold ? (
                        <button
                          type="button"
                          onClick={() =>
                            dispatchFoodCostNotification({
                              channel: 'manual_dispatch',
                              itemCode: rec.code,
                              itemNameAr: rec.nameAr,
                              itemNameEn: rec.nameEn,
                              variancePct: rec.variancePct,
                              varianceAmount: rec.varianceTotalPeriod,
                            })
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-700 hover:bg-red-800 text-white text-[11px] font-semibold whitespace-nowrap cursor-pointer transition-colors"
                        >
                          <Send className="w-3 h-3" />
                          <span>{t(lang, 'إرسال إشعار', 'Notify')}</span>
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {t(lang, 'آمن', 'OK')}
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Automatic Inventory Stocktake Variance Alert System (Actual Count vs Book > 2%) */}
      <section
        id="stocktake-variance-alerts"
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-col xl:flex-row xl:items-center justify-between gap-4 bg-slate-50/70 dark:bg-slate-800/40">
          <div className="flex items-start gap-3">
            <div
              className={`p-2 rounded-lg border shrink-0 ${
                stocktakeVariance.pendingExceedingCount > 0
                  ? 'bg-red-50 dark:bg-red-950/60 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
                  : 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
              }`}
            >
              <ClipboardCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {t(
                    lang,
                    'نظام التنبيهات التلقائي لفروقات الجرد الفعلي مقابل المخزون الدفتري (> 2%)',
                    'Automatic Physical vs. Book Inventory Variance Alert System (> 2%)'
                  )}
                </h2>
                <span
                  className={`text-xs font-mono-num font-bold ${
                    stocktakeVariance.pendingExceedingCount > 0
                      ? 'text-red-700 dark:text-red-400'
                      : 'text-emerald-700 dark:text-emerald-400'
                  }`}
                  dir="ltr"
                >
                  {stocktakeVariance.pendingExceedingCount > 0
                    ? `${stocktakeVariance.pendingExceedingCount} > ${stocktakeThresholdPct}%`
                    : t(lang, 'متطابق', 'Matched')}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {t(
                  lang,
                  `يقارن الكميات الفعلية من محاضر الجرد الدوري بالأرصدة الدفترية اللحظية ويرسل إشعاراً فورياً عند تجاوز الانحراف ±${stocktakeThresholdPct}% مع رابط مباشر لتسوية الفارق.`,
                  `Automatically compares actual stocktake counts against live book inventory, dispatches instant alerts above ±${stocktakeThresholdPct}% variance, and links directly to discrepancy reconciliation.`
                )}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Tolerance Threshold Toggle */}
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg text-xs">
              <span className="px-2 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                {t(lang, 'سقف الانحراف:', 'Limit ±')}
              </span>
              {[1, 2, 3, 5].map((th) => (
                <button
                  key={th}
                  type="button"
                  onClick={() => setStocktakeThresholdPct(th)}
                  className={`px-2 py-1 rounded-md font-mono-num font-semibold cursor-pointer ${
                    stocktakeThresholdPct === th
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                  dir="ltr"
                >
                  {th}%
                </button>
              ))}
            </div>

            {/* Filter Tabs */}
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
              {(
                [
                  { id: 'all', ar: `الكل (${stocktakeVariance.totalCountedItems})`, en: `All (${stocktakeVariance.totalCountedItems})` },
                  { id: 'exceeded', ar: `تجاوز >${stocktakeThresholdPct}% (${stocktakeVariance.pendingExceedingCount})`, en: `>${stocktakeThresholdPct}% (${stocktakeVariance.pendingExceedingCount})` },
                  { id: 'within', ar: `مقبول (${stocktakeVariance.withinToleranceCount})`, en: `Within ±${stocktakeThresholdPct}% (${stocktakeVariance.withinToleranceCount})` },
                  { id: 'reconciled', ar: `تمت تسويته (${stocktakeVariance.reconciledCount})`, en: `Reconciled (${stocktakeVariance.reconciledCount})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStocktakeFilter(tab.id)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap transition-colors cursor-pointer ${
                    stocktakeFilter === tab.id
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {lang === 'ar' ? tab.ar : tab.en}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setShowStocktakeNotifLog(!showStocktakeNotifLog)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <BellRing className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
              <span>
                {t(lang, `إشعارات الجرد (${unreadStocktakeNotifCount})`, `Count Alerts (${unreadStocktakeNotifCount})`)}
              </span>
            </button>

            <button
              type="button"
              onClick={() => openReconcileTarget(topPendingStocktake?.entry.id, topPendingStocktake?.entry.ingredientId)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-teal-700 hover:bg-teal-800 text-white whitespace-nowrap shrink-0 cursor-pointer transition-colors"
            >
              <span>{t(lang, 'فتح شاشة الجرد والتسوية', 'Open Stocktake & Recon')}</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* 4-Column Quantitative Summary */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x sm:rtl:divide-x-reverse divide-slate-200 dark:divide-slate-800 border-b border-slate-200 dark:border-slate-800">
          <div className="p-4 space-y-1">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {t(lang, `انحرافات معلقة (> ±${stocktakeThresholdPct}%)`, `Pending Variances (> ±${stocktakeThresholdPct}%)`)}
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span
                className={`text-xl font-bold font-mono-num ${
                  stocktakeVariance.pendingExceedingCount > 0
                    ? 'text-red-700 dark:text-red-400'
                    : 'text-emerald-700 dark:text-emerald-400'
                }`}
                dir="ltr"
              >
                {stocktakeVariance.pendingExceedingCount} / {stocktakeVariance.totalCountedItems}
              </span>
              <span className="text-xs font-mono-num font-semibold text-slate-500 dark:text-slate-400" dir="ltr">
                Max {fmtPct(stocktakeVariance.maxAbsVariancePct, 2)}
              </span>
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {t(lang, `${stocktakeVariance.reconciledCount} محاضر تمت تسويتها محاسبياً`, `${stocktakeVariance.reconciledCount} counts already reconciled`)}
            </div>
          </div>

          <div className="p-4 space-y-1">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {t(lang, 'إجمالي العجز غير المسوّى (Shortage)', 'Unreconciled Shortage Value')}
            </div>
            <div className="text-xl font-bold font-mono-num text-red-700 dark:text-red-400" dir="ltr">
              -{fmtMoney(stocktakeVariance.totalShortageValue, 2)}{' '}
              <span className="text-xs font-normal text-slate-500">EGP</span>
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {t(lang, 'يُحمّل عند التسوية على حـ/ 5305', 'Posts to Acc 5305 upon reconciliation')}
            </div>
          </div>

          <div className="p-4 space-y-1">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {t(lang, 'إجمالي الفائض غير المسوّى (Surplus)', 'Unreconciled Surplus Value')}
            </div>
            <div className="text-xl font-bold font-mono-num text-teal-700 dark:text-teal-400" dir="ltr">
              +{fmtMoney(stocktakeVariance.totalSurplusValue, 2)}{' '}
              <span className="text-xs font-normal text-slate-500">EGP</span>
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {t(lang, 'يعزز الرصيد الدفتري حـ/ 1201', 'Restores Inventory Acc 1201')}
            </div>
          </div>

          <div
            className={`p-4 space-y-1 ${
              stocktakeVariance.pendingExceedingCount > 0
                ? 'bg-red-50/45 dark:bg-red-950/25'
                : 'bg-emerald-50/40 dark:bg-emerald-950/20'
            }`}
          >
            <div className="text-xs font-medium text-slate-600 dark:text-slate-300">
              {t(lang, 'صافي أثر فروقات الجرد المعلقة', 'Net Pending Discrepancy Impact')}
            </div>
            <div
              className={`text-xl font-bold font-mono-num ${
                stocktakeVariance.netVarianceValue < 0
                  ? 'text-red-700 dark:text-red-400'
                  : 'text-emerald-700 dark:text-emerald-400'
              }`}
              dir="ltr"
            >
              {stocktakeVariance.netVarianceValue >= 0 ? '+' : ''}
              {fmtMoney(stocktakeVariance.netVarianceValue, 2)}{' '}
              <span className="text-xs font-normal">EGP</span>
            </div>
            <div className="text-[11px]">
              <button
                type="button"
                onClick={() => openReconcileTarget(topPendingStocktake?.entry.id, topPendingStocktake?.entry.ingredientId)}
                className="font-semibold text-teal-700 dark:text-teal-400 hover:underline cursor-pointer"
              >
                {t(lang, 'رابط تسوية الفارق الآن ←', 'Go to Reconcile Discrepancies →')}
              </button>
            </div>
          </div>
        </div>

        {/* Collapsible Stocktake Alert Notification Log */}
        {showStocktakeNotifLog && (
          <div className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                <BellRing className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                {t(lang, 'سجل الإشعارات الفورية لانحراف الجرد (>2%)', 'Dispatched Stocktake Variance Notification Log')}
              </h3>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => dispatchStocktakeNotification({ channel: 'manual_dispatch' })}
                  className="text-[11px] font-semibold text-red-700 dark:text-red-400 hover:underline cursor-pointer"
                >
                  {t(lang, 'إرسال إشعار تجريبي الآن', 'Dispatch Alert Now')}
                </button>
                {stocktakeNotifications.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const updated = stocktakeNotifications.map((n) => ({ ...n, acknowledged: true }));
                      setStocktakeNotifications(updated);
                      saveStocktakeNotificationsToStorage(updated);
                      setActiveStocktakeToast(null);
                    }}
                    className="text-[11px] font-semibold text-teal-700 dark:text-teal-400 hover:underline cursor-pointer"
                  >
                    {t(lang, 'تعليم الكل كمقروء', 'Mark All Acknowledged')}
                  </button>
                )}
              </div>
            </div>

            {stocktakeNotifications.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t(lang, 'لا توجد إشعارات جرد مسجلة بعد.', 'No stocktake variance notifications recorded yet.')}
              </p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {stocktakeNotifications.map((n) => (
                  <div
                    key={n.id}
                    className={`p-3 rounded-lg border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                      n.acknowledged
                        ? 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 opacity-80'
                        : 'bg-amber-50/70 dark:bg-amber-950/35 border-amber-200 dark:border-amber-800'
                    }`}
                  >
                    <div className="space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2 font-bold text-slate-900 dark:text-slate-100">
                        <span>{lang === 'ar' ? n.titleAr : n.titleEn}</span>
                        <span className="font-mono-num text-[11px] text-slate-500 dark:text-slate-400 font-normal" dir="ltr">
                          {n.createdAt}
                        </span>
                      </div>
                      <p className="text-slate-600 dark:text-slate-300">
                        {lang === 'ar' ? n.messageAr : n.messageEn}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => openReconcileTarget(n.stocktakeId, n.ingredientId)}
                        className="px-2.5 py-1 rounded bg-teal-700 hover:bg-teal-800 text-white text-[11px] font-semibold cursor-pointer"
                      >
                        {t(lang, 'رابط تسوية الفارق', 'Reconcile Link')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const updated = stocktakeNotifications.map((item) =>
                            item.id === n.id ? { ...item, acknowledged: !item.acknowledged } : item
                          );
                          setStocktakeNotifications(updated);
                          saveStocktakeNotificationsToStorage(updated);
                        }}
                        className="px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[11px] font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
                      >
                        {n.acknowledged ? t(lang, 'مقروء ✓', 'Read ✓') : t(lang, 'إقرار', 'Acknowledge')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Stocktake vs Book Variance Comparison Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300">
                <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'رقم الجرد / الموقع', 'Count # / Location')}</th>
                <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'الصنف الخام', 'Ingredient')}</th>
                <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'الرصيد الدفتري', 'Book Qty')}</th>
                <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'الجرد الفعلي', 'Actual Count')}</th>
                <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'الانحراف (كمية / %)', 'Variance (Qty / %)')}</th>
                <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'القيمة المالية', 'Impact EGP')}</th>
                <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'رابط تسوية الفارق', 'Reconcile Action')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredStocktakeItems.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-slate-500 dark:text-slate-400">
                    {t(lang, 'لا توجد سجلات جرد مطابقة لهذا الفلتر.', 'No stocktake records match this filter.')}
                  </td>
                </tr>
              ) : (
                filteredStocktakeItems.map((item) => {
                  const isFlagged =
                    item.entry.status === 'pending_reconciliation' && item.exceedsThreshold;
                  return (
                    <tr
                      key={item.entry.id}
                      className={
                        isFlagged
                          ? 'bg-red-50/25 dark:bg-red-950/15 hover:bg-red-50/45 dark:hover:bg-red-950/25'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                      }
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
                          {item.entry.sku} · {item.entry.countedBy}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-end font-mono-num text-slate-700 dark:text-slate-300" dir="ltr">
                        {fmtMoney(item.liveBookQty, 2)} {item.entry.unit}
                      </td>
                      <td className="py-3 px-4 text-end font-mono-num font-bold text-slate-900 dark:text-slate-100" dir="ltr">
                        {fmtMoney(item.entry.actualQty, 2)} {item.entry.unit}
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
                        {fmtMoney(item.varianceValue, 2)} EGP
                      </td>
                      <td className="py-3 px-4 text-end">
                        {item.entry.status === 'reconciled' ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            {t(lang, 'تمت التسوية', 'Reconciled')}
                          </span>
                        ) : (
                          <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => openReconcileTarget(item.entry.id, item.entry.ingredientId)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-[11px] font-semibold whitespace-nowrap cursor-pointer transition-colors"
                            >
                              <span>{t(lang, 'رابط تسوية الفارق', 'Reconcile Link')}</span>
                              <ArrowUpRight className="w-3 h-3" />
                            </button>
                            {onReconcileStocktake && (
                              <button
                                type="button"
                                disabled={reconcilingStocktakeId === item.entry.id}
                                onClick={() => handleInlineReconcile(item.entry.id)}
                                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-white text-[11px] font-semibold whitespace-nowrap cursor-pointer transition-colors disabled:opacity-60 ${
                                  item.exceedsThreshold
                                    ? 'bg-red-700 hover:bg-red-800'
                                    : 'bg-teal-700 hover:bg-teal-800'
                                }`}
                              >
                                {reconcilingStocktakeId === item.entry.id
                                  ? t(lang, 'جاري...', 'Settling...')
                                  : t(lang, 'تسوية فورية', 'Settle Now')}
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Non-Blocking Instant Notification Stack (Revenue Growth + Stocktake > 2% + Food Cost > 5%) */}
      {(activeRevGrowthToast || activeStocktakeToast || activeToastNotif) && (
        <div className="fixed bottom-5 end-5 z-40 max-w-sm w-full flex flex-col gap-3 pointer-events-none">
          {activeRevGrowthToast && (
            <div
              role="status"
              aria-live="polite"
              className="pointer-events-auto bg-white dark:bg-slate-900 border border-red-400 dark:border-red-600 rounded-xl p-4 shadow-md"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <div className="p-1.5 rounded-lg bg-red-100 dark:bg-red-900/60 text-red-700 dark:text-red-300 shrink-0">
                    <TrendingDown className="w-4 h-4" />
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                      {lang === 'ar' ? activeRevGrowthToast.titleAr : activeRevGrowthToast.titleEn}
                    </div>
                    <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                      {lang === 'ar' ? activeRevGrowthToast.messageAr : activeRevGrowthToast.messageEn}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveRevGrowthToast(null)}
                  aria-label={t(lang, 'إغلاق تنبيه نمو الإيرادات', 'Close revenue growth alert')}
                  className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={openPerformanceReviewDrilldown}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-red-700 hover:bg-red-800 text-white text-[11px] font-semibold cursor-pointer"
                >
                  <span>{t(lang, 'وحدة مراجعة الأداء', 'Performance Review')}</span>
                  <ArrowUpRight className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const updated = revGrowthNotifications.map((n) =>
                      n.id === activeRevGrowthToast.id ? { ...n, acknowledged: true } : n
                    );
                    setRevGrowthNotifications(updated);
                    saveRevGrowthNotificationsToStorage(updated);
                    setActiveRevGrowthToast(null);
                  }}
                  className="px-2.5 py-1 rounded-md bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-[11px] font-semibold cursor-pointer"
                >
                  {t(lang, 'إقرار', 'Acknowledge')}
                </button>
              </div>
            </div>
          )}

          {activeStocktakeToast && (
            <div
              role="status"
              aria-live="polite"
              className="pointer-events-auto bg-white dark:bg-slate-900 border border-amber-400 dark:border-amber-600 rounded-xl p-4 shadow-md"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <div className="p-1.5 rounded-lg bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-300 shrink-0">
                    <ClipboardCheck className="w-4 h-4" />
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                      {lang === 'ar' ? activeStocktakeToast.titleAr : activeStocktakeToast.titleEn}
                    </div>
                    <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                      {lang === 'ar' ? activeStocktakeToast.messageAr : activeStocktakeToast.messageEn}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveStocktakeToast(null)}
                  aria-label={t(lang, 'إغلاق تنبيه الجرد', 'Close stocktake alert')}
                  className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() =>
                    openReconcileTarget(
                      activeStocktakeToast.stocktakeId,
                      activeStocktakeToast.ingredientId
                    )
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-red-700 hover:bg-red-800 text-white text-[11px] font-semibold cursor-pointer"
                >
                  <span>{t(lang, 'تسوية الفارق الآن', 'Reconcile Now')}</span>
                  <ArrowUpRight className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const updated = stocktakeNotifications.map((n) =>
                      n.id === activeStocktakeToast.id ? { ...n, acknowledged: true } : n
                    );
                    setStocktakeNotifications(updated);
                    saveStocktakeNotificationsToStorage(updated);
                    setActiveStocktakeToast(null);
                  }}
                  className="px-2.5 py-1 rounded-md bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-[11px] font-semibold cursor-pointer"
                >
                  {t(lang, 'إقرار', 'Acknowledge')}
                </button>
              </div>
            </div>
          )}

          {activeToastNotif && (
            <div
              role="status"
              aria-live="polite"
              className="pointer-events-auto bg-white dark:bg-slate-900 border border-red-300 dark:border-red-700 rounded-xl p-4 shadow-md"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <div className="p-1.5 rounded-lg bg-red-100 dark:bg-red-900/60 text-red-700 dark:text-red-300 shrink-0">
                    <BellRing className="w-4 h-4" />
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                      {lang === 'ar' ? activeToastNotif.titleAr : activeToastNotif.titleEn}
                    </div>
                    <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                      {lang === 'ar' ? activeToastNotif.messageAr : activeToastNotif.messageEn}
                    </p>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">
                      {t(lang, 'تم الإشعار لـ:', 'Dispatched to:')}{' '}
                      {lang === 'ar' ? activeToastNotif.recipientAr : activeToastNotif.recipientEn}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveToastNotif(null)}
                  aria-label={t(lang, 'إغلاق الإشعار', 'Close notification')}
                  className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2">
                <a
                  href="#food-cost-variance-alerts"
                  onClick={() => setActiveToastNotif(null)}
                  className="text-[11px] font-semibold text-teal-700 dark:text-teal-400 hover:underline"
                >
                  {t(lang, 'عرض التفاصيل', 'View Breakdown')}
                </a>
                <button
                  type="button"
                  onClick={() => {
                    const updated = foodCostNotifications.map((n) =>
                      n.id === activeToastNotif.id ? { ...n, acknowledged: true } : n
                    );
                    setFoodCostNotifications(updated);
                    saveNotificationsToStorage(updated);
                    setActiveToastNotif(null);
                  }}
                  className="px-2.5 py-1 rounded-md bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-[11px] font-semibold cursor-pointer"
                >
                  {t(lang, 'تم الاستلام', 'Acknowledge')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Operational Diagnostics Strip: Channels, Day-of-Week, Electricity & Rent Alert */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2.5">
          <div className="text-xs font-bold text-slate-900">
            {t(lang, 'توزيع قنوات المبيعات والدفع (أغسطس POS)', 'Sales Channels & Payment Mix (Aug POS)')}
          </div>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-600">{t(lang, 'تيك أواي (Takeaway)', 'Takeaway')}</span>
              <span className="font-mono-num font-bold text-slate-900" dir="ltr">{strat.channelMixAug.takeawayPct}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">{t(lang, 'فواتير مباشرة داخلية (Direct)', 'Direct On-Premise')}</span>
              <span className="font-mono-num font-semibold text-slate-800" dir="ltr">{strat.channelMixAug.dineInPct}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-red-600 font-medium">{t(lang, 'الدليفري (مستهدف 8% في 2027)', 'Delivery (2027 Target 8%)')}</span>
              <span className="font-mono-num font-bold text-red-600" dir="ltr">{strat.channelMixAug.deliveryPct}%</span>
            </div>
            <div className="pt-2 border-t border-slate-100 flex justify-between text-[11px] text-slate-500">
              <span>{t(lang, 'كاش 63.7% · فيزا 35.8%', 'Cash 63.7% · VISA 35.8%')}</span>
              <span className="text-amber-700 font-medium">{t(lang, 'انحراف مايو 3.52%', 'May Fee 3.52%')}</span>
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2.5">
          <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
            <Zap className="w-4 h-4 text-amber-600" />
            {t(lang, 'أيام الأسبوع والطاقة (الكهرباء)', 'Day-of-Week Pattern & Energy Spike')}
          </div>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-600">{t(lang, 'أضعف يوم (الإثنين — الهدف 40k)', 'Weakest (Monday — Target 40k)')}</span>
              <span className="font-mono-num font-bold text-amber-700" dir="ltr">31,000 {t(lang, 'ج/يوم', 'EGP/d')}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">{t(lang, 'أقوى يوم (الجمعة)', 'Strongest (Friday)')}</span>
              <span className="font-mono-num font-bold text-emerald-700" dir="ltr">61,000 {t(lang, 'ج/يوم', 'EGP/d')}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">{t(lang, 'فاتورة الكهرباء (يناير ← سبتمبر)', 'Electricity (Jan → Sep)')}</span>
              <span className="font-mono-num font-bold text-red-600" dir="ltr">12.9k → 43.1k</span>
            </div>
            <div className="pt-2 border-t border-slate-100 text-[11px] text-slate-500">
              {t(lang, 'ارتفاع +234% يستدعي صيانة التكييف وجدولة المعدات', '+234% rise requires AC & equipment load scheduling')}
            </div>
          </div>
        </div>

        <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-4 flex flex-col justify-between gap-2 text-xs">
          <div>
            <div className="font-bold text-amber-900 flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-amber-700" />
              {t(lang, 'تنبيه حق الانتفاع والسيولة (زيادة 2% أغسطس)', 'Usufruct +2% Escalation & Liquidity Alert')}
            </div>
            <p className="text-slate-700 mt-1.5 leading-relaxed">
              {t(
                lang,
                'بدأت الزيادة التعاقدية 2% من أغسطس 2026 ليصبح القسط الفصلي 1,275,000 ج.م (5.1م في 2027)، بينما يتراوح رصيد الخزنة بين 142k و520k. التأخر >10 أيام يفرض غرامة بسعر خصم البنك المركزي.',
                '2% contractual hike started Aug 2026 (1,275,000 EGP/quarter; 5.1M in 2027), while cash vault ranged 142k–520k. Delay >10d triggers CBE discount-rate penalty.'
              )}
            </p>
          </div>
          <button
            onClick={() => onNavigate('strategy')}
            className="text-xs font-bold text-teal-800 hover:underline text-start flex items-center gap-1"
          >
            <span>{t(lang, 'استعراض استراتيجية 2027 ومحاكاة التعادل', 'Open 2027 Strategy & Break-Even Simulator')}</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Charts Row: P&L Waterfall + 9-Month Trend (Jan–Sep 2026) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <div className="xl:col-span-6 bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                {t(lang, 'مخطط الشلال المالي (9M 2026 P&L Waterfall)', 'P&L Financial Bridge Waterfall')}
              </h2>
              <p className="text-xs text-slate-500">
                {t(lang, 'من إجمالي المبيعات (12.93م) حتى صافي النتيجة (-4.10م)', 'From Gross Revenue to Net Result')}
              </p>
            </div>
            <span className="text-xs font-mono-num text-slate-500" dir="ltr">EGP</span>
          </div>

          <div className="w-full overflow-x-auto">
            <svg viewBox="0 0 720 260" className="w-full h-64 min-w-[560px]" role="img" aria-label="9M P&L Waterfall">
              {(() => {
                const padTop = 24;
                const padBottom = 42;
                const chartH = 260 - padTop - padBottom;
                const yFor = (v: number) => padTop + ((maxChartVal - v) / (chartRange || 1)) * chartH;
                const zeroY = yFor(0);
                const colW = 720 / waterfallSteps.length;

                return (
                  <>
                    <line x1={16} x2={704} y1={zeroY} y2={zeroY} stroke="#94a3b8" strokeWidth="1" strokeDasharray="3 3" />
                    <text x={8} y={zeroY + 3} fontSize="9" fill="#64748b" className="font-mono-num">0</text>
                    {waterfallSteps.map((st, idx) => {
                      const prevRunning = idx === 0 ? 0 : waterfallSteps[idx - 1].running;
                      const topVal = st.type === 'neg' ? Math.max(prevRunning, st.running) : Math.max(0, st.val);
                      const botVal = st.type === 'neg' ? Math.min(prevRunning, st.running) : Math.min(0, st.val);
                      const yTop = yFor(topVal);
                      const yBot = yFor(botVal);
                      const barH = Math.max(3, yBot - yTop);
                      const x = idx * colW + colW * 0.18;
                      const w = colW * 0.64;
                      const fill =
                        st.type === 'total' ? '#0f172a' : st.type === 'subtotal' ? '#0f766e' : st.type === 'final' ? (st.val >= 0 ? '#16a34a' : '#dc2626') : '#f59e0b';
                      const shortVal =
                        Math.abs(st.val) >= 1_000_000
                          ? `${(st.val / 1_000_000).toFixed(2)}M`
                          : `${(st.val / 1000).toFixed(0)}k`;

                      return (
                        <g key={idx}>
                          <rect x={x} y={yTop} width={w} height={barH} rx={3} fill={fill} />
                          <text x={x + w / 2} y={st.val >= 0 ? yTop - 6 : yBot + 11} textAnchor="middle" fontSize="10" fontWeight="600" fill="#0f172a" className="font-mono-num">
                            {shortVal}
                          </text>
                          <text x={x + w / 2} y={246} textAnchor="middle" fontSize="9.5" fill="#475569">
                            {lang === 'ar' ? st.labelAr : st.labelEn}
                          </text>
                        </g>
                      );
                    })}
                  </>
                );
              })()}
            </svg>
          </div>
        </div>

        {/* 9-Month Monthly Revenue vs Payroll & Net Result */}
        <div className="xl:col-span-6 bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              {t(lang, 'الأداء الشهري (يناير – سبتمبر 2026): الإيراد مقابل الرواتب والمصروفات', '9-Month Trajectory (Jan–Sep 2026): Net Revenue vs Total Cost')}
            </h2>
            <p className="text-xs text-slate-500 mb-3">
              {t(lang, 'ذروة الإيراد في أبريل (1.41م) وأقرب نقطة تعادل في يونيو (-22k) وطفرات المنح في فبراير ومايو وأغسطس', 'Peak revenue Apr (1.41M), near-breakeven Jun (-22k), bonus spikes Feb/May/Aug')}
            </p>

            <svg viewBox="0 0 600 210" className="w-full h-52" role="img" aria-label="9 Month Trend">
              {(() => {
                const maxM = 1600000;
                const chartH = 155;
                const yBase = 175;
                const hFor = (v: number) => (Math.max(0, v) / maxM) * chartH;

                return state.monthlyActuals2026.map((m, idx) => {
                  const gx = 16 + idx * 64;
                  const netH = hFor(m.netRevenue);
                  const payH = hFor(m.payroll);
                  const gpH = hFor(m.grossProfit);
                  return (
                    <g key={m.monthKey}>
                      <rect x={gx} y={yBase - netH} width={14} height={netH} rx={2} fill="#0f766e" />
                      <rect x={gx + 16} y={yBase - gpH} width={14} height={gpH} rx={2} fill="#14b8a6" />
                      <rect x={gx + 32} y={yBase - payH} width={14} height={payH} rx={2} fill={m.payrollBonuses > 100000 ? '#dc2626' : '#f59e0b'} />
                      <text x={gx + 23} y={194} textAnchor="middle" fontSize="10" fill="#334155" fontWeight="600">
                        {lang === 'ar' ? m.labelAr.split(' ')[0] : m.labelEn.split(' ')[0]}
                      </text>
                    </g>
                  );
                });
              })()}
            </svg>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-600 pt-2 border-t border-slate-100">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-xs bg-teal-700 inline-block" /> {t(lang, 'صافي الإيراد', 'Net Sales')}</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-xs bg-teal-500 inline-block" /> {t(lang, 'مجمل الربح', 'Gross Profit')}</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-xs bg-amber-500 inline-block" /> {t(lang, 'الرواتب الأساسية', 'Base Payroll')}</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-xs bg-red-600 inline-block" /> {t(lang, 'شهور صرف المنح', 'Bonus Batch Months')}</span>
          </div>
        </div>
      </div>

      {/* Audited 9-Month Ledger Summary Table (Jan–Sep 2026) */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              {t(lang, 'قائمة الأداء المالي المراجع (يناير – سبتمبر 2026) — مطابق لكشف الحساب المعتمد', 'Audited 9-Month P&L Statement (Jan–Sep 2026)')}
            </h2>
            <p className="text-xs text-slate-500">
              {t(lang, 'المصادر: كشف حساب 2026 المراجع ومنظومة ERP حتى 30 سبتمبر 2026', 'Sources: Audited 2026 Statement & Executive ERP through Sep 30, 2026')}
            </p>
          </div>
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
            <CheckCircle2 className="w-4 h-4" />
            {t(lang, 'مراجع ومطابق', 'Audited')}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'البند', 'Line Item')}</th>
                <th className="py-2.5 px-4 text-end font-semibold">Q1 (Jan–Mar)</th>
                <th className="py-2.5 px-4 text-end font-semibold">Q2 (Apr–Jun)</th>
                <th className="py-2.5 px-4 text-end font-semibold">Q3 (Jul–Sep)</th>
                <th className="py-2.5 px-4 text-end font-semibold bg-slate-100/70">{t(lang, 'إجمالي 9M فعلي', '9M YTD Actual')}</th>
                <th className="py-2.5 px-4 text-end font-semibold">{t(lang, '% من صافي الإيراد', '% of Net Rev')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(() => {
                const qSum = (q: 'Q1' | 'Q2' | 'Q3', fn: (m: any) => number) =>
                  state.monthlyActuals2026.filter((m) => m.quarter === q).reduce((a, m) => a + fn(m), 0);
                const s = strat.actual9MSummary;
                const rows = [
                  { ar: 'إجمالي الإيرادات شامل VAT', en: 'Gross Revenue Incl. VAT', fn: (m: any) => m.grossRevenue, tot: s.grossRevenue, pct: '—' },
                  { ar: 'صافي الإيراد بعد VAT (14%)', en: 'Net Revenue After VAT', fn: (m: any) => m.netRevenue, tot: s.netRevenue, pct: '100.0%', bold: true },
                  { ar: 'تكلفة المبيعات (COGS)', en: 'Cost of Goods Sold (COGS)', fn: (m: any) => m.cogs, tot: s.cogs, pct: '41.0%' },
                  { ar: 'مجمل الربح (Gross Profit)', en: 'Gross Profit', fn: (m: any) => m.grossProfit, tot: s.grossProfit, pct: '59.0%', bold: true },
                  { ar: 'الرواتب والمنح', en: 'Payroll & Bonuses', fn: (m: any) => m.payroll, tot: s.payrollAndBonuses, pct: '56.1%' },
                  { ar: 'المصروفات التشغيلية (تشمل حق الانتفاع)', en: 'Operating Expenses (Incl. Usufruct)', fn: (m: any) => m.totalOpexInclRent, tot: s.opexInclUsufruct, pct: '38.5%' },
                  { ar: 'مصروفات بنكية (صافي الفوائد -31,955)', en: 'Bank Fees (Net Interest -31,955)', fn: (m: any) => m.bankFeesNet, tot: s.bankFeesNet, pct: '0.6%' },
                  { ar: 'صافي النتيجة (9 شهور)', en: 'Net Result (9M YTD)', fn: (m: any) => m.netProfit, tot: s.netResult, pct: '-36.1%', bold: true, red: true },
                ];
                return rows.map((r, idx) => (
                  <tr key={idx} className={r.red ? 'bg-red-50/40' : 'hover:bg-slate-50'}>
                    <td className={`py-2.5 px-4 ${r.bold ? 'font-bold text-slate-900' : 'text-slate-700'}`}>
                      {lang === 'ar' ? r.ar : r.en}
                    </td>
                    <td className="py-2.5 px-4 text-end font-mono-num" dir="ltr">{fmtMoney(qSum('Q1', r.fn))}</td>
                    <td className="py-2.5 px-4 text-end font-mono-num" dir="ltr">{fmtMoney(qSum('Q2', r.fn))}</td>
                    <td className="py-2.5 px-4 text-end font-mono-num" dir="ltr">{fmtMoney(qSum('Q3', r.fn))}</td>
                    <td className={`py-2.5 px-4 text-end font-mono-num font-bold bg-slate-50/80 ${r.red ? 'text-red-600' : 'text-slate-900'}`} dir="ltr">
                      {fmtMoney(r.tot)}
                    </td>
                    <td className={`py-2.5 px-4 text-end font-mono-num ${r.red ? 'font-bold text-red-600' : 'text-slate-600'}`} dir="ltr">
                      {r.pct}
                    </td>
                  </tr>
                ));
              })()}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    {/* Print-Ready A4 CFO Executive Board Pack (Active automatically on window.print()) */}
    <div className="hidden print:block bg-white text-slate-900">
      <CfoPrintableBrief
        state={state}
        lang={lang}
        period={period}
        excludeUsufructRent={excludeUsufructRent}
        costCenterBudgets={costCenterBudgets}
        warningThresholdPct={warningThresholdPct}
        sections={cfoPrintSections}
        currentViewMode={cfoPrintCurrentViewMode}
      />
    </div>

    {/* Interactive On-Screen A4 Print Preview Modal */}
    <CfoPrintPreviewModal
      open={cfoPrintPreviewOpen}
      onClose={() => setCfoPrintPreviewOpen(false)}
      state={state}
      lang={lang}
      period={period}
      excludeUsufructRent={excludeUsufructRent}
      costCenterBudgets={costCenterBudgets}
      warningThresholdPct={warningThresholdPct}
      selectedSections={cfoPrintSections}
      onChangeSections={setCfoPrintSections}
      currentViewMode={cfoPrintCurrentViewMode}
      onExecutePrint={() => {
        setCfoPrintPreviewOpen(false);
        requestAnimationFrame(() => window.print());
      }}
    />
    </>
  );
};
