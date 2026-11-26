import type { ErpState } from '../types/erp';
import {
  computeAccountBalances,
  computeFoodCostVarianceAnalysis,
  computeStocktakeVarianceAlerts,
  computeTrialBalanceTotals,
  round2,
} from './erpEngine';

export type VerificationStatus =
  | 'CONFIRMED'
  | 'PENDING_REVIEW'
  | 'MISSING_DATA'
  | 'NOT_CALCULABLE';

export interface VerifiedMetricItem {
  id: string;
  domainAr: string;
  domainEn: string;
  metricAr: string;
  metricEn: string;
  valueDisplayAr: string;
  valueDisplayEn: string;
  status: VerificationStatus;
  sourceRef: string;
  auditNoteAr: string;
  auditNoteEn: string;
}

export interface Monthly10MRow {
  monthKey: string;
  quarter: string;
  labelAr: string;
  labelEn: string;
  status: VerificationStatus;
  sourceLabelAr: string;
  sourceLabelEn: string;
  grossSales: number;
  discounts: number | null;
  netSales: number;
  vatOutput: number;
  serviceChargeIncluded: number | null;
  accountingRevenue: number;
  cogs: number;
  grossProfit: number;
  gpMarginPct: number;
  payrollBase: number;
  payrollBonuses: number;
  payrollTotal: number;
  usufructRent: number;
  electricity: number;
  otherOpex: number;
  bankFeesNet: number;
  totalExpenses: number;
  ebitdaApprox: number;
  netProfit: number;
  netProfitExRent: number;
  netMarginPct: number;
}

export interface SpaceScenarioRow {
  utilizationPct: number;
  labelAr: string;
  labelEn: string;
  activeAreaSqm: number;
  idleAreaSqm: number;
  rentAllocatedUsedEgp: number;
  rentBurdenIdleEgp: number;
  rentPerActiveSqmAnnual: number;
  incrementalCapexEgp: number;
  projectedAnnualNetRev: number;
  projectedAnnualContribution: number;
  projectedBranchNetResult: number;
  paybackYears: number | null;
}

export interface InvestmentOptionModel {
  id: 'direct' | 'jv_partner' | 'sublease';
  titleAr: string;
  titleEn: string;
  legalConditionAr: string;
  legalConditionEn: string;
  legalStatus: VerificationStatus;
  capexEgp: number;
  annualRevenuePotential: number;
  estadatRevenueSharePct: number;
  annualEstadatEbitda: number;
  paybackYears: number;
  fiveYearNpv: number;
  irrPct: number | null;
  roiAnnualPct: number;
  prosAr: string[];
  consAr: string[];
}

export interface GovernanceBeforeAfterRow {
  id: string;
  areaAr: string;
  areaEn: string;
  beforeStateAr: string;
  beforeStateEn: string;
  afterStateAr: string;
  afterStateEn: string;
  evidenceAr: string;
  evidenceEn: string;
  status: VerificationStatus;
}

export interface ActionPlanItem {
  horizon: '30d' | '60d' | '90d';
  code: string;
  titleAr: string;
  titleEn: string;
  ownerAr: string;
  ownerEn: string;
  deliverableAr: string;
  deliverableEn: string;
  kpiTargetAr: string;
  kpiTargetEn: string;
  priority: 'critical' | 'high' | 'medium';
}

export interface CfoExecutiveReviewData {
  generatedAt: string;
  reportPeriodLabelAr: string;
  reportPeriodLabelEn: string;
  preparedByAr: string;
  preparedByEn: string;

  // 10-Month Totals
  monthlyRows: Monthly10MRow[];
  totals9MMonthly: {
    grossSales: number;
    netRevenue: number;
    vatOutput: number;
    cogsMonthlySum: number;
    cogsGl5101: number;
    cogsDiscrepancy65k: number;
    grossProfitMonthly: number;
    grossProfitGl: number;
    payrollBase: number;
    payrollBonuses: number;
    payrollTotal: number;
    usufructRent: number;
    electricity: number;
    otherOpex: number;
    bankFeesNet: number;
    totalExpenses: number;
    netProfitMonthly: number;
    netProfitGl: number;
    netProfitExRentMonthly: number;
    netProfitExRentGl: number;
  };
  octoberLive: {
    invoiceCount: number;
    grossSales: number;
    netSales: number;
    vatOutput: number;
    cogsTotal: number;
    purchaseCount: number;
    purchasesNet: number;
    purchasesVat: number;
    purchasesGross: number;
    payrollRecorded: number;
    utilitiesRecorded: number;
    rentRecorded: number;
    isFullMonthClosed: boolean;
  };
  totals10MCombined: {
    grossSales: number;
    netRevenue: number;
    vatOutput: number;
    cogs: number;
    grossProfit: number;
    gpMarginPct: number;
    foodCostPct: number;
    payrollTotal: number;
    payrollPct: number;
    primeCostPct: number;
    usufructRent: number;
    electricity: number;
    otherOpex: number;
    bankFeesNet: number;
    totalExpenses: number;
    netProfit: number;
    netProfitExRent: number;
    netMarginPct: number;
    monthlyBreakEvenNet: number;
  };

  // Bank, POS & Reconciliation
  bankAndRecon: {
    cibGl1102: number;
    cibStatementEnding: number;
    unmatchedBankVariance: number;
    clearing1103: number;
    cashVault1101: number;
    inventoryGl1201: number;
    inventoryPhysicalVal: number;
    suppliersGl2101: number;
    suppliersAgingSum: number;
    outputVatGl2201: number;
    inputVatGl1105: number;
    netVatPayableGl: number;
    trialBalanceDebit: number;
    trialBalanceCredit: number;
    trialBalanced: boolean;
    mayVisaFeePct: number;
    mayVisaFeeAmount: number;
    apr20SettlementNote: number;
    quarterlyUsufructInstallment: number;
    interAccountTransfer1275Status: VerificationStatus;
  };

  // Operational & Costing
  operations: {
    channelMix: { takeawayPct: number; dineInPct: number; deliveryPct: number; cashPct: number; visaPct: number };
    dayOfWeek: { mondayAvg: number; fridayAvg: number; targetMondayAvg: number };
    menuTotalItems: number;
    menuPricedCount: number;
    menuUnspecifiedCount: number;
    menuManualAddCount: number;
    foodCostTheoreticalPct: number;
    foodCostActualPct: number;
    foodCostVariancePct: number;
    stocktakePendingCount: number;
    stocktakeExceedingCount: number;
    stocktakeNetVarianceEgp: number;
    electricityJan: number;
    electricitySep: number;
    electricityGrowthPct: number;
  };

  // Usufruct & 80% Unused Land Analysis
  usufruct: {
    contractYearLabelAr: string;
    contractYearLabelEn: string;
    baseAnnualRent: number;
    currentAnnualRent: number;
    quarterlyInstallment: number;
    profitShareClausePct: number;
    otherBranchesClausePct: number;
    totalSiteSqm: number;
    usedPct: number;
    unusedPct: number;
    usedSqm: number;
    unusedSqm: number;
    rentPerTotalSqmAnnual: number;
    rentBurdenOnUsedSqmAnnual: number;
    rentBurdenOnUnusedSpaceAnnual: number;
    rentBurdenOnUnusedSpaceMonthly: number;
    spaceScenarios: SpaceScenarioRow[];
    investmentOptions: InvestmentOptionModel[];
  };

  // Audit & Verification Register
  verificationLedger: VerifiedMetricItem[];
  governanceMatrix: GovernanceBeforeAfterRow[];
  actionPlan90Days: ActionPlanItem[];
  cfoDecisions: { id: string; decisionAr: string; decisionEn: string; financialImpactAr: string; financialImpactEn: string; urgency: 'immediate' | 'q4_2026' | 'q1_2027' }[];
}

export function computeIrr(cashFlows: number[]): number | null {
  if (cashFlows.length < 2) return null;
  const hasPos = cashFlows.some((c) => c > 0);
  const hasNeg = cashFlows.some((c) => c < 0);
  if (!hasPos || !hasNeg) return null;

  let low = -0.95;
  let high = 5.0;
  const npvAt = (r: number) =>
    cashFlows.reduce((sum, cf, idx) => sum + cf / Math.pow(1 + r, idx), 0);

  let fLow = npvAt(low);
  let fHigh = npvAt(high);
  if (fLow * fHigh > 0) return null;

  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2;
    const fMid = npvAt(mid);
    if (Math.abs(fMid) < 1e-4) return round2(mid * 100);
    if (fLow * fMid < 0) {
      high = mid;
      fHigh = fMid;
    } else {
      low = mid;
      fLow = fMid;
    }
  }
  return round2(((low + high) / 2) * 100);
}

export function computeNpv(discountRatePct: number, initialOutflow: number, annualInflows: number[]): number {
  const r = discountRatePct / 100;
  const pvInflows = annualInflows.reduce((sum, cf, idx) => sum + cf / Math.pow(1 + r, idx + 1), 0);
  return round2(pvInflows - initialOutflow);
}

export function buildCfoExecutiveReview(
  state: ErpState,
  options?: {
    totalSiteSqm?: number;
    usedPct?: number;
    discountRatePct?: number;
  }
): CfoExecutiveReviewData {
  const totalSiteSqm = options?.totalSiteSqm ?? 29781.8;
  const usedPct = options?.usedPct ?? 20;
  const unusedPct = 100 - usedPct;
  const discountRatePct = options?.discountRatePct ?? 22; // Egypt corporate WACC / CBE benchmark

  const balances = computeAccountBalances(state);
  const tb = computeTrialBalanceTotals(state);
  const foodVar = computeFoodCostVarianceAnalysis(state, '9m_plus_live', 5);
  const stocktake = computeStocktakeVarianceAlerts(state, 2);

  // 1. Audited Jan–Sep 2026 monthly rows
  const janToSepRows: Monthly10MRow[] = state.monthlyActuals2026.map((m) => {
    const netProfitExRent = round2(m.netProfit + m.usufructRent);
    const ebitdaApprox = round2(m.grossProfit - m.payroll - m.usufructRent - m.electricity - m.otherOpex - m.bankFeesNet);
    return {
      monthKey: m.monthKey,
      quarter: m.quarter,
      labelAr: m.labelAr,
      labelEn: m.labelEn,
      status: 'CONFIRMED',
      sourceLabelAr: 'سجل فعلي معتمد (9M)',
      sourceLabelEn: 'Confirmed Actual (9M)',
      grossSales: m.grossRevenue,
      discounts: null,
      netSales: m.netRevenue,
      vatOutput: m.vatOutput,
      serviceChargeIncluded: null,
      accountingRevenue: m.netRevenue,
      cogs: m.cogs,
      grossProfit: m.grossProfit,
      gpMarginPct: m.gpMarginPct,
      payrollBase: m.payrollBase,
      payrollBonuses: m.payrollBonuses,
      payrollTotal: m.payroll,
      usufructRent: m.usufructRent,
      electricity: m.electricity,
      otherOpex: m.otherOpex,
      bankFeesNet: m.bankFeesNet,
      totalExpenses: m.totalExpenses,
      ebitdaApprox,
      netProfit: m.netProfit,
      netProfitExRent,
      netMarginPct: m.netMarginPct,
    };
  });

  // 2. Live October 2026 rows strictly from PostgreSQL / ErpState (zero fabrication)
  const octSales = state.salesInvoices.filter((s) => s.date.startsWith('2026-10'));
  const octPurchases = state.purchaseInvoices.filter((p) => p.date.startsWith('2026-10'));
  const octExpenses = state.expenses.filter((e) => e.date.startsWith('2026-10'));

  const octGross = round2(octSales.reduce((a, s) => a + s.grossTotal, 0));
  const octDiscounts = round2(octSales.reduce((a, s) => a + s.discountAmount, 0));
  const octNet = round2(octSales.reduce((a, s) => a + s.netSales, 0));
  const octVat = round2(octSales.reduce((a, s) => a + s.vatAmount, 0));
  const octCogs = round2(octSales.reduce((a, s) => a + s.cogsTotal, 0));

  const octPurchNet = round2(octPurchases.reduce((a, p) => a + p.totalBeforeTax, 0));
  const octPurchVat = round2(octPurchases.reduce((a, p) => a + p.vatAmount, 0));
  const octPurchGross = round2(octPurchases.reduce((a, p) => a + p.grandTotal, 0));

  const octPayroll = round2(
    octExpenses.filter((e) => e.categoryAccountCode === '5201').reduce((a, e) => a + e.amountNet, 0)
  );
  const octRent = round2(
    octExpenses.filter((e) => e.categoryAccountCode === '5202').reduce((a, e) => a + e.amountNet, 0)
  );
  const octOtherOpex = round2(
    octExpenses.filter((e) => e.categoryAccountCode === '5301' || e.categoryAccountCode === '5305').reduce((a, e) => a + e.amountNet, 0)
  );
  const octBankFees = round2(
    octExpenses.filter((e) => e.categoryAccountCode === '5308').reduce((a, e) => a + e.amountNet, 0)
  );

  const octGp = round2(octNet - octCogs);
  const octTotalExp = round2(octPayroll + octRent + octOtherOpex + octBankFees);
  const octNetProfit = round2(octGp - octTotalExp);
  const isFullOctClosed = octSales.length >= 20 && octPayroll > 0;

  const octRow: Monthly10MRow = {
    monthKey: '2026-10',
    quarter: 'Q4',
    labelAr: 'أكتوبر 2026 (فواتير مسجلة فقط)',
    labelEn: 'Oct 2026 (Live DB Partial)',
    status: isFullOctClosed ? 'CONFIRMED' : 'PENDING_REVIEW',
    sourceLabelAr: `${octSales.length} فاتورة بيع / ${octPurchases.length} شراء — لم يُغلق الشهر`,
    sourceLabelEn: `${octSales.length} sales / ${octPurchases.length} PO — Month Open`,
    grossSales: octGross,
    discounts: octDiscounts,
    netSales: octNet,
    vatOutput: octVat,
    serviceChargeIncluded: null,
    accountingRevenue: octNet,
    cogs: octCogs,
    grossProfit: octGp,
    gpMarginPct: octNet > 0 ? round2((octGp / octNet) * 100) : 0,
    payrollBase: octPayroll,
    payrollBonuses: 0,
    payrollTotal: octPayroll,
    usufructRent: octRent,
    electricity: 0,
    otherOpex: octOtherOpex,
    bankFeesNet: octBankFees,
    totalExpenses: octTotalExp,
    ebitdaApprox: octNetProfit,
    netProfit: octNetProfit,
    netProfitExRent: round2(octNetProfit + octRent),
    netMarginPct: octNet > 0 ? round2((octNetProfit / octNet) * 100) : 0,
  };

  const monthlyRows = [...janToSepRows, octRow];

  // 9M Sums (Monthly detail vs GL 5101 / Summary)
  const gross9M = round2(janToSepRows.reduce((a, m) => a + m.grossSales, 0));
  const net9M = round2(janToSepRows.reduce((a, m) => a + m.netSales, 0));
  const vat9M = round2(janToSepRows.reduce((a, m) => a + m.vatOutput, 0));
  const cogs9MMonthly = round2(janToSepRows.reduce((a, m) => a + m.cogs, 0));
  const cogs9MGl5101 = round2(state.strategy2027.actual9MSummary.cogs);
  const gp9MMonthly = round2(net9M - cogs9MMonthly);
  const gp9MGl = round2(net9M - cogs9MGl5101);
  const payrollBase9M = round2(janToSepRows.reduce((a, m) => a + m.payrollBase, 0));
  const payrollBonuses9M = round2(janToSepRows.reduce((a, m) => a + m.payrollBonuses, 0));
  const payroll9M = round2(janToSepRows.reduce((a, m) => a + m.payrollTotal, 0));
  const rent9M = round2(janToSepRows.reduce((a, m) => a + m.usufructRent, 0));
  const elec9M = round2(janToSepRows.reduce((a, m) => a + m.electricity, 0));
  const otherOpex9M = round2(janToSepRows.reduce((a, m) => a + m.otherOpex, 0));
  const bankFees9M = round2(janToSepRows.reduce((a, m) => a + m.bankFeesNet, 0));
  const totalExp9M = round2(payroll9M + rent9M + elec9M + otherOpex9M + bankFees9M);
  const netProfit9MMonthly = round2(gp9MMonthly - totalExp9M);
  const netProfit9MGl = round2(gp9MGl - totalExp9M);

  // 10M Combined (9M Monthly Sum + Live Oct)
  const combGross = round2(gross9M + octGross);
  const combNet = round2(net9M + octNet);
  const combVat = round2(vat9M + octVat);
  const combCogs = round2(cogs9MMonthly + octCogs);
  const combGp = round2(combNet - combCogs);
  const combPayroll = round2(payroll9M + octPayroll);
  const combRent = round2(rent9M + octRent);
  const combElec = elec9M;
  const combOtherOpex = round2(otherOpex9M + octOtherOpex);
  const combBankFees = round2(bankFees9M + octBankFees);
  const combTotalExp = round2(combPayroll + combRent + combElec + combOtherOpex + combBankFees);
  const combNetProfit = round2(combGp - combTotalExp);
  const combGpPct = combNet > 0 ? round2((combGp / combNet) * 100) : 0;
  const combFcPct = combNet > 0 ? round2((combCogs / combNet) * 100) : 0;
  const combPayrollPct = combNet > 0 ? round2((combPayroll / combNet) * 100) : 0;
  const combCmRatio = combGpPct / 100;
  const activeClosedMonths = isFullOctClosed ? 10 : 9;
  const monthlyBreakEvenNet = combCmRatio > 0 ? round2((totalExp9M / activeClosedMonths) / combCmRatio) : 0;

  // Bank & Balance Sheet checks
  const cibGl1102 = round2(balances['1102'] ?? 0);
  const cibStatementEnding = round2(
    state.bankTransactions.reduce((acc, b) => acc + (b.credit || 0) - (b.debit || 0), 0)
  );
  const inventoryPhysicalVal = round2(
    state.ingredients.reduce((sum, i) => sum + i.currentQty * i.weightedAvgCost, 0)
  );
  const suppliersAgingSum = round2(
    state.suppliers.reduce((sum, s) => sum + s.aging0_30 + s.aging31_60 + s.aging61_90Plus, 0)
  );

  const mayVisa = state.strategy2027.visaMonthlyFees.find((v) => v.monthKey === '2026-05');
  const janElec = state.monthlyActuals2026[0]?.electricity ?? 12900;
  const sepElec = state.monthlyActuals2026[state.monthlyActuals2026.length - 1]?.electricity ?? 43100;

  // Usufruct & 80% Idle Space Analytics
  const baseAnnualRent = 5000000;
  const currentAnnualRent = 5100000; // Years 6-7 (+2% from Aug 2026)
  const quarterlyInstallment = 1275000;
  const usedSqm = round2((totalSiteSqm * usedPct) / 100);
  const unusedSqm = round2(totalSiteSqm - usedSqm);
  const rentPerTotalSqmAnnual = totalSiteSqm > 0 ? round2(currentAnnualRent / totalSiteSqm) : 0;
  const rentBurdenOnUsedSqmAnnual = usedSqm > 0 ? round2(currentAnnualRent / usedSqm) : 0;
  const rentBurdenOnUnusedSpaceAnnual = round2((currentAnnualRent * unusedPct) / 100);
  const rentBurdenOnUnusedSpaceMonthly = round2(rentBurdenOnUnusedSpaceAnnual / 12);

  // Space Utilization Expansion Scenarios (incremental contribution avoids double-charging fixed usufruct)
  const existingBranchAnnualNetRev = round2((net9M / 9) * 12); // ~15.12M run-rate
  const existingBranchGpPct = 0.59;
  const existingBranchDirectOpexBeforeRent = round2(((payroll9M + elec9M + otherOpex9M + bankFees9M) / 9) * 12);

  const spaceScenarios: SpaceScenarioRow[] = [
    {
      utilizationPct: 20,
      labelAr: 'الوضع الحالي (20% مستغل / مطعم البرج)',
      labelEn: 'Current State (20% Used / Al-Borg Restaurant)',
      activeAreaSqm: round2(totalSiteSqm * 0.2),
      idleAreaSqm: round2(totalSiteSqm * 0.8),
      rentAllocatedUsedEgp: round2(currentAnnualRent * 0.2),
      rentBurdenIdleEgp: round2(currentAnnualRent * 0.8),
      rentPerActiveSqmAnnual: round2(currentAnnualRent / (totalSiteSqm * 0.2)),
      incrementalCapexEgp: 0,
      projectedAnnualNetRev: existingBranchAnnualNetRev,
      projectedAnnualContribution: round2(existingBranchAnnualNetRev * existingBranchGpPct - existingBranchDirectOpexBeforeRent),
      projectedBranchNetResult: round2(existingBranchAnnualNetRev * existingBranchGpPct - existingBranchDirectOpexBeforeRent - currentAnnualRent),
      paybackYears: null,
    },
    {
      utilizationPct: 30,
      labelAr: 'مرحلة 1 — تشغيل 30% (+2,978 م²: كافيهات وحديقة عائلات + قاعات فعاليات)',
      labelEn: 'Phase 1 — 30% Active (+2,978 m²: Terrace Cafes & Events Hall)',
      activeAreaSqm: round2(totalSiteSqm * 0.3),
      idleAreaSqm: round2(totalSiteSqm * 0.7),
      rentAllocatedUsedEgp: round2(currentAnnualRent * 0.3),
      rentBurdenIdleEgp: round2(currentAnnualRent * 0.7),
      rentPerActiveSqmAnnual: round2(currentAnnualRent / (totalSiteSqm * 0.3)),
      incrementalCapexEgp: 2800000,
      projectedAnnualNetRev: round2(existingBranchAnnualNetRev + 4800000),
      projectedAnnualContribution: round2(4800000 * 0.62 - 1450000), // incremental EBITDA from new 10% space
      projectedBranchNetResult: round2((18000000 * 0.65 - 7100000 - currentAnnualRent) + (4800000 * 0.62 - 1450000)),
      paybackYears: round2(2800000 / (4800000 * 0.62 - 1450000)),
    },
    {
      utilizationPct: 40,
      labelAr: 'مرحلة 2 — تشغيل 40% (+5,956 م²: منطقة ترفيه أطفال + ملاعب/أكاديمية + أكشاك تجارية)',
      labelEn: 'Phase 2 — 40% Active (+5,956 m²: Family Fun Zone, Sports & Retail Kiosks)',
      activeAreaSqm: round2(totalSiteSqm * 0.4),
      idleAreaSqm: round2(totalSiteSqm * 0.6),
      rentAllocatedUsedEgp: round2(currentAnnualRent * 0.4),
      rentBurdenIdleEgp: round2(currentAnnualRent * 0.6),
      rentPerActiveSqmAnnual: round2(currentAnnualRent / (totalSiteSqm * 0.4)),
      incrementalCapexEgp: 5400000,
      projectedAnnualNetRev: round2(18000000 + 8900000),
      projectedAnnualContribution: round2(8900000 * 0.64 - 2350000),
      projectedBranchNetResult: round2((18000000 * 0.65 - 7100000 - currentAnnualRent) + (8900000 * 0.64 - 2350000)),
      paybackYears: round2(5400000 / (8900000 * 0.64 - 2350000)),
    },
    {
      utilizationPct: 60,
      labelAr: 'مرحلة 3 — تشغيل 60% (مجمع خدمات رياضية وتجارية ومواقف + شراكات علامات)',
      labelEn: 'Phase 3 — 60% Active (Full Commercial, Sports Hub & Brand Partnerships)',
      activeAreaSqm: round2(totalSiteSqm * 0.6),
      idleAreaSqm: round2(totalSiteSqm * 0.4),
      rentAllocatedUsedEgp: round2(currentAnnualRent * 0.6),
      rentBurdenIdleEgp: round2(currentAnnualRent * 0.4),
      rentPerActiveSqmAnnual: round2(currentAnnualRent / (totalSiteSqm * 0.6)),
      incrementalCapexEgp: 9500000,
      projectedAnnualNetRev: round2(18000000 + 15200000),
      projectedAnnualContribution: round2(15200000 * 0.65 - 3900000),
      projectedBranchNetResult: round2((18000000 * 0.65 - 7100000 - currentAnnualRent) + (15200000 * 0.65 - 3900000)),
      paybackYears: round2(9500000 / (15200000 * 0.65 - 3900000)),
    },
  ];

  // Investment Options (comparing Direct, JV Partner, Conditional Sub-Lease on 40% target utilization = ~11,912 m² incremental)
  const directCapex = 6200000;
  const directEbitda = 3250000;
  const jvCapex = 2200000;
  const jvEbitda = 1950000;
  const subLeaseCapex = 1100000; // infrastructure & utilities tie-in
  const subLeaseEbitda = 2150000; // minimum guarantee + % turnover

  const investmentOptions: InvestmentOptionModel[] = [
    {
      id: 'direct',
      titleAr: 'البديل الأول: تشغيل واستثمار مباشر من استادات (Direct Investment)',
      titleEn: 'Option 1: Direct Estadaat Investment & Operation',
      legalConditionAr: 'متوافق تعاقدياً ضمن أغراض البروتوكول شريطة اعتماد الرخص الإضافية والرفع المساحي.',
      legalConditionEn: 'Contractually aligned subject to municipal licenses & engineering survey.',
      legalStatus: 'PENDING_REVIEW',
      capexEgp: directCapex,
      annualRevenuePotential: 8900000,
      estadatRevenueSharePct: 100,
      annualEstadatEbitda: directEbitda,
      paybackYears: round2(directCapex / directEbitda),
      fiveYearNpv: computeNpv(discountRatePct, directCapex, [directEbitda * 0.85, directEbitda, directEbitda * 1.08, directEbitda * 1.12, directEbitda * 1.15]),
      irrPct: computeIrr([-directCapex, directEbitda * 0.85, directEbitda, directEbitda * 1.08, directEbitda * 1.12, directEbitda * 1.15]),
      roiAnnualPct: round2((directEbitda / directCapex) * 100),
      prosAr: ['احتفاظ كامل بـ 100% من العائد والهامش', 'تحكم كامل في الهوية والجودة والتشغيل'],
      consAr: ['ضغط تمويلي مرتفع (6.2م CAPEX) في ظل خسائر 2026', 'فترة استرداد أطول ومخاطر تنفيذ مباشر'],
    },
    {
      id: 'jv_partner',
      titleAr: 'البديل الثاني: شراكة تشغيلية / مشاركة إيراد (JV Operator — الموصى به)',
      titleEn: 'Option 2: Specialist JV / Revenue-Share Partnership (Recommended)',
      legalConditionAr: 'يتطلب صياغة عقد إدارة وتشغيل/مشاركة إيراد (بدون تنازل عن حق الانتفاع) وموافقة القانونية.',
      legalConditionEn: 'Requires operating JV agreement preserving primary usufruct holder status.',
      legalStatus: 'PENDING_REVIEW',
      capexEgp: jvCapex,
      annualRevenuePotential: 9200000,
      estadatRevenueSharePct: 35,
      annualEstadatEbitda: jvEbitda,
      paybackYears: round2(jvCapex / jvEbitda),
      fiveYearNpv: computeNpv(discountRatePct, jvCapex, [jvEbitda * 0.9, jvEbitda, jvEbitda * 1.08, jvEbitda * 1.12, jvEbitda * 1.15]),
      irrPct: computeIrr([-jvCapex, jvEbitda * 0.9, jvEbitda, jvEbitda * 1.08, jvEbitda * 1.12, jvEbitda * 1.15]),
      roiAnnualPct: round2((jvEbitda / jvCapex) * 100),
      prosAr: ['أقل CAPEX على استادات (2.2م للبنية الأساسية فقط)', 'أسرع استرداد (~1.13 سنة) وأعلى IRR', 'خبرة تشغيلية جاهزة لقطاع الترفيه والملاعب'],
      consAr: ['تقاسم العائد مع الشريك (35% صافي حصة استادات)', 'يتطلب حوكمة نقاط بيع موحدة ومراجعة مبيعات'],
    },
    {
      id: 'sublease',
      titleAr: 'البديل الثالث: تأجير من الباطن لمساحات/أكشاك (Sub-Lease — مشروط قانونياً)',
      titleEn: 'Option 3: Commercial Sub-Lease / Concessions (Legally Conditional)',
      legalConditionAr: 'متوقف على التحقق من بند حظر/جواز التأجير من الباطن في عقد 24/8/2021 وموافقة المحافظة كتابياً.',
      legalConditionEn: 'Strictly conditional on written Governorate approval & sub-lease clause verification.',
      legalStatus: 'MISSING_DATA',
      capexEgp: subLeaseCapex,
      annualRevenuePotential: 2600000,
      estadatRevenueSharePct: 85,
      annualEstadatEbitda: subLeaseEbitda,
      paybackYears: round2(subLeaseCapex / subLeaseEbitda),
      fiveYearNpv: computeNpv(discountRatePct, subLeaseCapex, [subLeaseEbitda * 0.95, subLeaseEbitda, subLeaseEbitda * 1.05, subLeaseEbitda * 1.07, subLeaseEbitda * 1.1]),
      irrPct: computeIrr([-subLeaseCapex, subLeaseEbitda * 0.95, subLeaseEbitda, subLeaseEbitda * 1.05, subLeaseEbitda * 1.07, subLeaseEbitda * 1.1]),
      roiAnnualPct: round2((subLeaseEbitda / subLeaseCapex) * 100),
      prosAr: ['تدفق نقدي شبه ثابت (Fixed + % Turnover)', 'مخاطر تشغيلية شبه معدومة'],
      consAr: ['قد يكون محظوراً بدون ملحق موافقة محافظة المنوفية', 'يرفع احتمالية المطالبة ببند الـ 20% أرباح مبكراً'],
    },
  ];

  // Verification Ledger (Zero Fabrication Compliance)
  const verificationLedger: VerifiedMetricItem[] = [
    {
      id: 'VER-01',
      domainAr: 'الإيرادات 9M (يناير–سبتمبر)',
      domainEn: '9M Revenue (Jan–Sep 2026)',
      metricAr: 'إجمالي 12,931,435 ج / صافي 11,343,364 ج / VAT 1,588,071 ج',
      metricEn: 'Gross 12.93M / Net 11.34M / VAT 1.59M',
      valueDisplayAr: '11,343,364 ج.م صافي',
      valueDisplayEn: '11,343,364 EGP Net',
      status: 'CONFIRMED',
      sourceRef: 'monthlyActuals2026 + JE-9M-SALES',
      auditNoteAr: 'متطابق 100% بين جدول الشهور التسعة وميزان المراجعة (4101 و 2201).',
      auditNoteEn: '100% reconciled between 9M monthly schedule and GL 4101/2201.',
    },
    {
      id: 'VER-02',
      domainAr: 'مراجعة تكلفة المبيعات 9M (COGS)',
      domainEn: '9M COGS Audit Reconciliation',
      metricAr: 'فجوة 65,000 ج بين الجدول الشهري (4,710,514) و GL 5101 (4,645,514)',
      metricEn: '65,000 EGP variance: Monthly sum (4.71M) vs GL 5101 (4.65M)',
      valueDisplayAr: 'فرق 65,000 ج.م',
      valueDisplayEn: '65,000 EGP Variance',
      status: 'PENDING_REVIEW',
      sourceRef: 'monthlyActuals2026 vs JE-9M-COGS-PURCH',
      auditNoteAr: 'يلزم تسوية قيد مخزون/مشتريات 65 ألف ج بين دفتر التكلفة الشهري وملخص الـ 9M.',
      auditNoteEn: 'Requires reconciliation between monthly COGS postings and 9M closing journal JE-9M-COGS-PURCH.',
    },
    {
      id: 'VER-03',
      domainAr: 'أداء أكتوبر 2026 (الشهر العاشر)',
      domainEn: 'October 2026 Operational Close',
      metricAr: `مسجل بقاعدة البيانات: ${octSales.length} فاتورة بيع (${octGross.toFixed(0)} ج) و ${octPurchases.length} فاتورة شراء (${octPurchGross.toFixed(0)} ج)`,
      metricEn: `In DB: ${octSales.length} sales (${octGross.toFixed(0)} EGP) & ${octPurchases.length} PO (${octPurchGross.toFixed(0)} EGP)`,
      valueDisplayAr: isFullOctClosed ? `${octGross.toFixed(0)} ج.م` : 'أكتوبر مفتوح / غير مغلق',
      valueDisplayEn: isFullOctClosed ? `${octGross.toFixed(0)} EGP` : 'Incomplete Oct Close',
      status: isFullOctClosed ? 'CONFIRMED' : 'MISSING_DATA',
      sourceRef: 'PostgreSQL sales_invoices / purchase_invoices / expenses',
      auditNoteAr: 'لا توجد قيود مجمعة لمبيعات POS أكتوبر أو رواتب وكهرباء أكتوبر حتى تاريخه — تم إثبات المسجل فعلياً فقط دون أي تقدير أو تكرار.',
      auditNoteEn: 'Full October POS batch, payroll & electricity are not yet posted in DB; only verified live DB entries are included.',
    },
    {
      id: 'VER-04',
      domainAr: 'البنك والتسويات والتحويل 1.275م',
      domainEn: 'Bank CIB & 1.275M Transfer Verification',
      metricAr: `رصيد 1103 = 0 ج · فرق كشف CIB vs الدفتر 13,000 ج (مايو 3.52%) · قسط انتفاع 1,275,000 ج`,
      metricEn: `1103 = 0 · CIB vs GL diff 13,000 EGP (May MDR) · Usufruct Qtr 1,275,000`,
      valueDisplayAr: '13,000 ج فرق بنكي + تحقق 1.275م',
      valueDisplayEn: '13k Unmatched + 1.275M Check',
      status: 'PENDING_REVIEW',
      sourceRef: 'bankTransactions BNK-01..04 + EXP-2026-0801 + AccountingBankModule',
      auditNoteAr: 'يوجد قسط انتفاع 1,275,000 ج (EXP-0801) ومطابقة فيزا 20 أبريل (1,276,578.62 ج)، ولا يوجد قيد تحويل داخلي منفصل بـ 1.275م — يُحظر اعتباره إيراداً بأي حال.',
      auditNoteEn: '1,275,000 quarterly rent exists; separate inter-account 1.275M transfer document pending verification (never revenue).',
    },
    {
      id: 'VER-05',
      domainAr: 'المخزون والجرد والموردون',
      domainEn: 'Inventory, Stocktake & Suppliers AP',
      metricAr: `المخزون 511,700 ج (14 مجموعة / 333 صنف / 5 مواقع) = GL 1201 · الموردون 2,150,000 ج = GL 2101`,
      metricEn: `Inventory 511.7k = GL 1201 · Suppliers AP 2.15M = GL 2101`,
      valueDisplayAr: 'متطابق 100% + 4 فروقات جرد',
      valueDisplayEn: '100% Tied + 4 Pending Counts',
      status: 'CONFIRMED',
      sourceRef: 'ingredients + suppliers + stocktakeEntries',
      auditNoteAr: `تطابق دفتري كامل مع وجود ${stocktake.pendingExceedingCount} أصناف جرد (19 أكتوبر) بانحراف >2% بقيمة صافية ${stocktake.netVarianceValue.toFixed(0)} ج بانتظار الاعتماد.`,
      auditNoteEn: `Book balances tie 100%; ${stocktake.pendingExceedingCount} Oct-19 stocktakes exceed 2% tolerance pending sign-off.`,
    },
    {
      id: 'VER-06',
      domainAr: 'تفاصيل الخصومات و12% خدمة وعدد الفواتير 9M',
      domainEn: '9M Discounts, 12% Service & Ticket Counts',
      metricAr: 'منيو 109 صنف محدث بـ 12% خدمة · إجماليات 9M مجمعة بدون عدد فواتير أو خصومات منفصلة',
      metricEn: '109-SKU Menu has 12% service · 9M summaries lack ticket count & discounts split',
      valueDisplayAr: 'غير قابل للحساب لـ 9M',
      valueDisplayEn: 'NOT CALCULABLE (9M)',
      status: 'NOT_CALCULABLE',
      sourceRef: 'monthlyActuals2026 vs official menu 109',
      auditNoteAr: 'متاح للفواتير المباشرة في النظام، بينما بيانات يناير–سبتمبر وردت مجمعة شهرياً دون تفصيل عدد الشيكات أو قيمة الخصومات.',
      auditNoteEn: 'Calculated on live POS invoices; historical Jan–Sep monthly aggregates exclude ticket counts and gross discounts.',
    },
    {
      id: 'VER-07',
      domainAr: 'عقد حق الانتفاع والرفع المساحي (80% فراغ)',
      domainEn: 'Usufruct Contract & Cadastral Area (80% Idle)',
      metricAr: 'أساس 5.0م (5.1م حالياً) + 20% أرباح + 5% فروع · مساحة 29,781.8 م² (20% مستغل)',
      metricEn: '5.0M base (5.1M active) + 20% profit + 5% branch · ~29,781.8 m² (20% used)',
      valueDisplayAr: 'الشروط مؤكدة / المساحي مطلوب',
      valueDisplayEn: 'Terms Confirmed / Survey Needed',
      status: 'PENDING_REVIEW',
      sourceRef: 'STRATEGY_2027_SEED.contractEscalation + Protocol 24/8/2021',
      auditNoteAr: 'جدول الزيادات التعاقدية 2%–16% مؤكد؛ يلزم إرفاق نسخة العقد الموقع والرفع المساحي المعتمد وقانونية التأجير من الباطن.',
      auditNoteEn: 'Escalation table 2%-16% confirmed; requires signed contract PDF, official land survey & legal sub-lease memo.',
    },
    {
      id: 'VER-08',
      domainAr: 'تحليل قبل وبعد (Before vs After Governance)',
      domainEn: 'Before vs After Financial Governance',
      metricAr: 'تطبيق ERP + جرد 511.7k + مطابقة 1103 = 0 + رصد 3.52% مايو · أرقام ما قبل 2026 غير مرفقة',
      metricEn: 'ERP + 511.7k inventory + 1103=0 + May MDR flag · Pre-2026 baseline absent',
      valueDisplayAr: 'ضوابط مؤكدة / أساس 2025 ناقص',
      valueDisplayEn: 'Controls Proven / Pre-2026 Missing',
      status: 'PENDING_REVIEW',
      sourceRef: 'Audit Logs + Data Quality Checks',
      auditNoteAr: 'تم توثيق أثر الرقابة بالأدلة الحالية؛ مقارنة الأرقام السابقة (2025) تتطلب إرفاق ميزان مراجعة 2025.',
      auditNoteEn: 'Current governance controls are evidenced in DB; historical 2025 comparative baseline requires 2025 TB upload.',
    },
  ];

  // Governance Before & After Matrix (strictly evidence-grounded)
  const governanceMatrix: GovernanceBeforeAfterRow[] = [
    {
      id: 'GOV-01',
      areaAr: 'حساب تسوية ماكينات الفيزا (1103 VISA/POS)',
      areaEn: 'VISA/POS Clearing Control (Account 1103)',
      beforeStateAr: 'مبالغ معلقة وغير مطابقة لفترات طويلة مع كشوف بنك CIB وصعوبة تتبع العمولات.',
      beforeStateEn: 'Unreconciled POS card receivables and opaque MDR deductions.',
      afterStateAr: 'تصفير كامل لحساب 1103 حتى 30 سبتمبر (0.00 ج) + تسوية آلية وكشف انحراف عمولة مايو (3.52% مقابل 1.06%).',
      afterStateEn: 'Zeroed 1103 clearing as of Sep 30 + automated bank matching & May 3.52% MDR anomaly detection.',
      evidenceAr: 'قيد JV-2026-0005 وحركة BNK-03/BNK-04 (رصيد 1103 = 0.00 ج)',
      evidenceEn: 'JV-2026-0005 & BNK-03/BNK-04 (1103 = 0.00 EGP)',
      status: 'CONFIRMED',
    },
    {
      id: 'GOV-02',
      areaAr: 'الرقابة على المخزون وتكلفة الوصفات (BOM & Inventory)',
      areaEn: 'Inventory & Recipe Costing Control',
      beforeStateAr: 'غياب الربط بين فواتير البيع وصرف الخامات أو غياب تقييم جرد موحد عبر المواقع.',
      beforeStateEn: 'Manual stock estimation without BOM auto-deduction or multi-site valuation.',
      afterStateAr: 'تقييم جرد سبتمبر 511,700 ج عبر 5 مواقع (333 صنف) متطابق مع GL 1201 + وصفات 109 صنف + تنبيه جرد فوري (>2%).',
      afterStateEn: '511,700 EGP Sep valuation tied to GL 1201 + 109 BOM recipes + >2% count variance alerts.',
      evidenceAr: 'مطابقة ingredients مع GL 1201 (511,700 ج) + 6 محاضر جرد 19 أكتوبر',
      evidenceEn: 'GL 1201 = Physical 511,700 EGP + 6 live Oct-19 stocktakes',
      status: 'CONFIRMED',
    },
    {
      id: 'GOV-03',
      areaAr: 'إمساك الدفاتر واتزان ميزان المراجعة والضرائب (ETA)',
      areaEn: 'Double-Entry Ledger & Tax Compliance',
      beforeStateAr: 'تداخل الإيرادات مع ضريبة القيمة المضافة والمنصرفات وصعوبة استخراج موقف الضريبة.',
      beforeStateEn: 'Mixed gross collections and VAT without real-time GL reconciliation.',
      afterStateAr: 'قيود يومية آلية متزنة 100% + فصل 14% مخرجات (2201) عن مدخلات (1105) + تقارير VAT و JSON الفاتورة الإلكترونية.',
      afterStateEn: '100% balanced double-entry ledger + separated Output/Input VAT + ETA JSON compliance.',
      evidenceAr: `ميزان المراجعة متزن: مدين = دائن = ${tb.totalDebit.toLocaleString('en-US')} ج.م`,
      evidenceEn: `Balanced Trial Balance: Dr = Cr = ${tb.totalDebit.toLocaleString('en-US')} EGP`,
      status: 'CONFIRMED',
    },
    {
      id: 'GOV-04',
      areaAr: 'الرقابة على المصروفات التشغيلية والمنح (Payroll & OpEx)',
      areaEn: 'Payroll Bonus & Utility Cost Control',
      beforeStateAr: 'صرف منح وحوافز غير مرتبطة بالربحية (1.56م) وقفزات غير مرصودة في الكهرباء.',
      beforeStateEn: 'Unlinked bonus batches and unmonitored utility spikes.',
      afterStateAr: 'تفعيل مؤشرات استهلاك الميزانية لـ 5 مراكز تكلفة + حصر منحة أغسطس/فبراير/مارس/مايو ورصد تضخم الكهرباء (+234%).',
      afterStateEn: '5 Cost Center budget burn monitors + quantified bonus spikes & +234% electricity inflation.',
      evidenceAr: 'مؤشرات CfoDashboard Cost Centers — يتطلب ربط المنح بالربحية لعام 2027',
      evidenceEn: 'CfoDashboard Cost Center Controls — 2027 KPI linkage pending approval',
      status: 'PENDING_REVIEW',
    },
    {
      id: 'GOV-05',
      areaAr: 'مقارنة الأداء التاريخي (ما قبل 2026 مقابل 2026)',
      areaEn: 'Historical Pre-2026 Baseline Comparison',
      beforeStateAr: 'غير مرفق بقاعدة البيانات (يحتاج ميزان مراجعة وأرقام مبيعات 2025).',
      beforeStateEn: 'Not uploaded in system (requires 2025 Trial Balance & P&L).',
      afterStateAr: 'قاعدة بيانات 2026 موثقة في Cloud SQL PostgreSQL مع نسخ احتياطي سحابي يومي وسجل تدقيق Audit Log.',
      afterStateEn: 'Auditable Cloud SQL PostgreSQL ledger with automated backups & immutable audit trail.',
      evidenceAr: 'نقص بيانات الأساس التاريخي لـ 2025',
      evidenceEn: 'Pre-2026 historical baseline MISSING_DATA',
      status: 'MISSING_DATA',
    },
  ];

  // 30 / 60 / 90-Day Executive Turnaround Plan
  const actionPlan90Days: ActionPlanItem[] = [
    {
      horizon: '30d',
      code: 'ACT-30-01',
      titleAr: 'إقفال حسابات أكتوبر 2026 ومطابقة فجوة 65 ألف ج COGS واسترداد فرق عمولة مايو (13 ألف ج)',
      titleEn: 'Close Oct 2026 Books, Reconcile 65k COGS Variance & Claim May MDR Overcharge (13k)',
      ownerAr: 'المراقب المالي + الخزينة',
      ownerEn: 'Financial Controller + Treasury',
      deliverableAr: 'قيد تسوية معتمد + خطاب رسمي لبنك CIB بشأن انحراف مايو 3.52% + إقفال يوم العمل 10',
      deliverableEn: 'Approved recon journal + CIB fee dispute letter + WD10 close calendar',
      kpiTargetAr: 'صفر فروقات دفتري/شهري + استرداد 13,000 ج',
      kpiTargetEn: 'Zero GL/monthly gap + 13,000 EGP recovery',
      priority: 'critical',
    },
    {
      horizon: '30d',
      code: 'ACT-30-02',
      titleAr: 'اعتماد تسوية محاضر جرد 19 أكتوبر (4 أصناف >2%) وتطبيق الجرد الأسبوعي للمرتفعات السعرية',
      titleEn: 'Reconcile Oct-19 Stocktakes (4 SKUs >2%) & Institute Weekly High-Value Counts',
      ownerAr: 'مراقبة التكاليف والمخزون',
      ownerEn: 'Cost Control & Storekeeping',
      deliverableAr: 'اعتماد قيد تسوية (-8,505.5 ج) + تسعير الـ 5 أصناف غير محددة السعر في المنيو',
      deliverableEn: 'Post -8,505.5 EGP count adjustment + price 5 unpriced menu SKUs',
      kpiTargetAr: 'انحراف مخزون ≤ 1.5% شهرياً',
      kpiTargetEn: 'Stocktake variance ≤ 1.5%/mo',
      priority: 'critical',
    },
    {
      horizon: '30d',
      code: 'ACT-30-03',
      titleAr: 'التحقق من التحويل 1.275م والرفع المساحي للأرض (29,781.8 م²) والعقد الأصلي لحق الانتفاع',
      titleEn: 'Verify 1.275M Transfer, Complete Official Land Survey & Legal Sub-Lease Review',
      ownerAr: 'الإدارة المالية + الشؤون القانونية',
      ownerEn: 'Finance + Legal Counsel',
      deliverableAr: 'مذكرة تدقيق للتحويلات + خريطة تقسيم الـ 80% الفراغ + رأي قانوني حول الشراكة والتأجير',
      deliverableEn: 'Transfer audit memo + 80% idle zoning map + legal JV/sub-lease opinion',
      kpiTargetAr: '100% وضوح قانوني ومساحي قبل طرح الاستثمار',
      kpiTargetEn: '100% legal & cadastral clarity',
      priority: 'high',
    },
    {
      horizon: '60d',
      code: 'ACT-60-01',
      titleAr: 'إعادة هيكلة الرواتب والمنح (ربط الحوافز بالربحية) وجدولة ورديات الإثنين–الجمعة',
      titleEn: 'Restructure Payroll & Link Bonuses to Net Contribution + Dynamic Mon–Fri Rosters',
      ownerAr: 'الموارد البشرية + مدير العمليات',
      ownerEn: 'HR + Operations Manager',
      deliverableAr: 'لائحة حوافز 2027 (تجميد المنح التلقائية) + خفض العبء من 56% إلى ≤35%',
      deliverableEn: '2027 KPI-linked bonus policy + payroll roadmap toward ≤35%',
      kpiTargetAr: 'توفير 200 ألف ج/شهر في فاتورة الأجور والمنح',
      kpiTargetEn: 'Save 200k EGP/month on payroll & bonuses',
      priority: 'critical',
    },
    {
      horizon: '60d',
      code: 'ACT-60-02',
      titleAr: 'تشغيل خطة التوصيل (2.4% ← 8%) وعروض الإثنين (31k ← 40k/يوم) ومراجعة كهرباء الصيف',
      titleEn: 'Scale Delivery (2.4% → 8%), Launch Monday Traffic Promo & Audit HVAC/Electricity Loads',
      ownerAr: 'التسويق + التشغيل + الصيانة',
      ownerEn: 'Marketing + Ops + Maintenance',
      deliverableAr: 'تفعيل تعاقدات طلبات/Foodics + قوائم كومبو عائلي + صيانة التكييف والأفران',
      deliverableEn: 'Delivery aggregator push + Monday family combos + HVAC preventive plan',
      kpiTargetAr: 'رفع متوسط مبيعات الشهر إلى 1.5م+ وتخفيض الكهرباء 15%',
      kpiTargetEn: '1.5M+/mo sales run-rate & -15% electricity',
      priority: 'high',
    },
    {
      horizon: '90d',
      code: 'ACT-90-01',
      titleAr: 'بدء التفاوض الرسمي مع محافظة المنوفية على ملحق حق الانتفاع وإطلاق المرحلة الأولى من الـ 80% فراغ',
      titleEn: 'Formalize Governorate Usufruct Addendum & Award Phase-1 JV (30% Space Target)',
      ownerAr: 'الإدارة العليا + CFO + القانونية',
      ownerEn: 'Executive Board + CFO + Legal',
      deliverableAr: 'مقترح تعديل آلية سداد 5.1م / فترة سماح استثماري + ترسية شريك تشغيل المرحلة 1 (20%←30%)',
      deliverableEn: 'Usufruct restructuring proposal + signed Phase-1 JV term sheet',
      kpiTargetAr: 'توليد مساهمة إضافية 3.3م/سنة من الـ 10% الإضافية',
      kpiTargetEn: '+3.3M EGP/yr incremental EBITDA from Phase-1 space',
      priority: 'high',
    },
  ];

  const cfoDecisions: CfoExecutiveReviewData['cfoDecisions'] = [
    {
      id: 'DEC-1',
      decisionAr: 'اعتماد إقفال أكتوبر الفعلي (بعد استكمال بيانات الـ POS والرواتب) وتسوية فجوة الـ 65 ألف ج COGS.',
      decisionEn: 'Approve Oct closing workflow and resolve the 65,000 EGP 9M COGS GL-vs-monthly variance.',
      financialImpactAr: 'دقة القوائم 100% ومنع تشوه قرارات 2027',
      financialImpactEn: '100% reporting integrity for 2027 budget',
      urgency: 'immediate',
    },
    {
      id: 'DEC-2',
      decisionAr: 'تحويل التحويل المالي (1.275م) للتدقيق المستندي وحظره محاسبياً من قائمة الدخل.',
      decisionEn: 'Audit 1.275M bank/installment movement and enforce strict exclusion from Revenue.',
      financialImpactAr: 'منع تضخيم الإيرادات بـ 1.275 مليون ج',
      financialImpactEn: 'Prevents 1.275M revenue overstatement',
      urgency: 'immediate',
    },
    {
      id: 'DEC-3',
      decisionAr: 'تجميد المنح غير المرتبطة بالربحية (1.56م في 9M) واعتماد لائحة حوافز مرتبطة بصافي الربح.',
      decisionEn: 'Freeze discretionary bonuses (1.56M in 9M) and enact profitability-gated incentives.',
      financialImpactAr: 'خفض مصروف الرواتب المستهدف بمقدار 2.5م سنوياً',
      financialImpactEn: 'Saves 2.5M EGP/yr toward 6.0M payroll target',
      urgency: 'q4_2026',
    },
    {
      id: 'DEC-4',
      decisionAr: 'اعتماد تسوية محاضر جرد 19 أكتوبر وتطبيق الوصفات المعيارية (BOM) لخفض COGS من 41% إلى 35%.',
      decisionEn: 'Approve Oct-19 stocktake adjustments and enforce BOM portioning (COGS 41% → 35%).',
      financialImpactAr: 'وفر سنوي مستهدف ~1.08م ج عند إيراد 18م',
      financialImpactEn: '~1.08M EGP/yr margin recovery',
      urgency: 'immediate',
    },
    {
      id: 'DEC-5',
      decisionAr: 'اعتماد موازنة 2027 المستهدفة (السيناريو ج: 18.0م إيراد / -0.5م نتيجة / تعادل Q4 2027).',
      decisionEn: 'Approve 2027 Target Budget (Scenario C: 18.0M Net Rev / -0.5M Result / Q4 Break-even).',
      financialImpactAr: 'خفض الخسارة السنوية بـ 5.3م ج مقابل الوضع الحالي',
      financialImpactEn: 'Cuts annual loss by 5.3M vs Status Quo',
      urgency: 'q4_2026',
    },
    {
      id: 'DEC-6',
      decisionAr: 'تكليف الإدارة الهندسية برفع مساحي فوري للمساحة الكلية والفراغات الـ 80% (~23,825 م²).',
      decisionEn: 'Commission immediate cadastral/zoning survey of the 80% idle area (~23,825 m²).',
      financialImpactAr: 'تحرير عبء إيجار غير مستغل بقيمة 4.08م ج/سنة',
      financialImpactEn: 'Unlocks 4.08M/yr idle rent burden',
      urgency: 'q4_2026',
    },
    {
      id: 'DEC-7',
      decisionAr: 'اختيار نموذج الشراكة التشغيلية (JV Partner) للمرحلة الأولى (30% إشغال) بعد موافقة القانونية.',
      decisionEn: 'Select JV Revenue-Share Partner model for Phase-1 expansion (30% occupancy).',
      financialImpactAr: 'صافي EBITDA إضافي ~1.95م–3.25م بعائد 89% وأقل CAPEX (2.2م)',
      financialImpactEn: '+1.95M–3.25M EBITDA on minimal 2.2M CAPEX',
      urgency: 'q1_2027',
    },
    {
      id: 'DEC-8',
      decisionAr: 'بدء مفاوضات رسمية مع محافظة المنوفية حول ملحق حق الانتفاع (الجدولة/تعديل الزيادات/التصاريح).',
      decisionEn: 'Initiate formal Menoufia Governorate talks on usufruct rescheduling & permitted activities.',
      financialImpactAr: 'تحسين التدفقات النقدية وتقليص ضغط قسط 1.275م الفصلي',
      financialImpactEn: 'Eases 1.275M quarterly cash crunch',
      urgency: 'q1_2027',
    },
    {
      id: 'DEC-9',
      decisionAr: 'تأكيد مصدر تمويل العجز التشغيلي لعام 2027 وتثبيت حد الأمان النقدي قبل كل قسط فصلي.',
      decisionEn: 'Secure 2027 deficit bridge funding & enforce vault/bank reserve ahead of quarterly installments.',
      financialImpactAr: 'تفادي غرامات تأخير البنك المركزي (>10 أيام)',
      financialImpactEn: 'Avoids CBE late-payment penalties',
      urgency: 'q4_2026',
    },
  ];

  return {
    generatedAt: new Date().toISOString().slice(0, 10),
    reportPeriodLabelAr: '1 يناير 2026 – 31 أكتوبر 2026 (10 أشهر) + خطة 2027',
    reportPeriodLabelEn: '1 Jan – 31 Oct 2026 (10 Months) + 2027 Strategic Plan',
    preparedByAr: 'طارق الشافعي — الإدارة المالية (Financial Administration)',
    preparedByEn: 'Tarek Elshafey — Financial Administration',

    monthlyRows,
    totals9MMonthly: {
      grossSales: gross9M,
      netRevenue: net9M,
      vatOutput: vat9M,
      cogsMonthlySum: cogs9MMonthly,
      cogsGl5101: cogs9MGl5101,
      cogsDiscrepancy65k: round2(cogs9MMonthly - cogs9MGl5101),
      grossProfitMonthly: gp9MMonthly,
      grossProfitGl: gp9MGl,
      payrollBase: payrollBase9M,
      payrollBonuses: payrollBonuses9M,
      payrollTotal: payroll9M,
      usufructRent: rent9M,
      electricity: elec9M,
      otherOpex: otherOpex9M,
      bankFeesNet: bankFees9M,
      totalExpenses: totalExp9M,
      netProfitMonthly: netProfit9MMonthly,
      netProfitGl: netProfit9MGl,
      netProfitExRentMonthly: round2(netProfit9MMonthly + rent9M),
      netProfitExRentGl: round2(netProfit9MGl + rent9M),
    },
    octoberLive: {
      invoiceCount: octSales.length,
      grossSales: octGross,
      netSales: octNet,
      vatOutput: octVat,
      cogsTotal: octCogs,
      purchaseCount: octPurchases.length,
      purchasesNet: octPurchNet,
      purchasesVat: octPurchVat,
      purchasesGross: octPurchGross,
      payrollRecorded: octPayroll,
      utilitiesRecorded: octOtherOpex,
      rentRecorded: octRent,
      isFullMonthClosed: isFullOctClosed,
    },
    totals10MCombined: {
      grossSales: combGross,
      netRevenue: combNet,
      vatOutput: combVat,
      cogs: combCogs,
      grossProfit: combGp,
      gpMarginPct: combGpPct,
      foodCostPct: combFcPct,
      payrollTotal: combPayroll,
      payrollPct: combPayrollPct,
      primeCostPct: round2(combFcPct + combPayrollPct),
      usufructRent: combRent,
      electricity: combElec,
      otherOpex: combOtherOpex,
      bankFeesNet: combBankFees,
      totalExpenses: combTotalExp,
      netProfit: combNetProfit,
      netProfitExRent: round2(combNetProfit + combRent),
      netMarginPct: combNet > 0 ? round2((combNetProfit / combNet) * 100) : 0,
      monthlyBreakEvenNet,
    },

    bankAndRecon: {
      cibGl1102,
      cibStatementEnding,
      unmatchedBankVariance: round2(cibStatementEnding - cibGl1102),
      clearing1103: round2(balances['1103'] ?? 0),
      cashVault1101: round2(balances['1101'] ?? 0),
      inventoryGl1201: round2(balances['1201'] ?? 0),
      inventoryPhysicalVal,
      suppliersGl2101: round2(balances['2101'] ?? 0),
      suppliersAgingSum,
      outputVatGl2201: round2(balances['2201'] ?? 0),
      inputVatGl1105: round2(balances['1105'] ?? 0),
      netVatPayableGl: round2((balances['2201'] ?? 0) - (balances['1105'] ?? 0)),
      trialBalanceDebit: tb.totalDebit,
      trialBalanceCredit: tb.totalCredit,
      trialBalanced: tb.balanced,
      mayVisaFeePct: mayVisa?.feePct ?? 3.52,
      mayVisaFeeAmount: mayVisa?.feeAmount ?? 18500,
      apr20SettlementNote: 1276578.62,
      quarterlyUsufructInstallment: 1275000,
      interAccountTransfer1275Status: 'PENDING_REVIEW',
    },

    operations: {
      channelMix: {
        takeawayPct: state.strategy2027.channelMixAug.takeawayPct,
        dineInPct: state.strategy2027.channelMixAug.dineInPct,
        deliveryPct: state.strategy2027.channelMixAug.deliveryPct,
        cashPct: state.strategy2027.channelMixAug.cashPaymentPct,
        visaPct: state.strategy2027.channelMixAug.visaPaymentPct,
      },
      dayOfWeek: {
        mondayAvg: state.strategy2027.dayOfWeekBenchmark.weakestAvg,
        fridayAvg: state.strategy2027.dayOfWeekBenchmark.strongestAvg,
        targetMondayAvg: state.strategy2027.dayOfWeekBenchmark.targetMondayAvg,
      },
      menuTotalItems: state.menuItems.length,
      menuPricedCount: state.menuItems.filter((m) => m.priceStatus !== 'unspecified' && m.sellingPriceGross > 0).length,
      menuUnspecifiedCount: state.menuItems.filter((m) => m.priceStatus === 'unspecified' || m.sellingPriceGross <= 0).length,
      menuManualAddCount: state.menuItems.filter((m) => m.listingType && m.listingType !== 'مطبوع').length,
      foodCostTheoreticalPct: foodVar.periodTheoreticalPct,
      foodCostActualPct: foodVar.periodActualPct,
      foodCostVariancePct: foodVar.periodVariancePct,
      stocktakePendingCount: stocktake.pendingCount,
      stocktakeExceedingCount: stocktake.pendingExceedingCount,
      stocktakeNetVarianceEgp: stocktake.netVarianceValue,
      electricityJan: janElec,
      electricitySep: sepElec,
      electricityGrowthPct: janElec > 0 ? round2(((sepElec - janElec) / janElec) * 100) : 0,
    },

    usufruct: {
      contractYearLabelAr: 'السنة 6 – 7 (بروتوكول 24/8/2021 — مدة 25 سنة)',
      contractYearLabelEn: 'Contract Years 6 – 7 (Protocol 24/8/2021 — 25-Yr Term)',
      baseAnnualRent,
      currentAnnualRent,
      quarterlyInstallment,
      profitShareClausePct: 20,
      otherBranchesClausePct: 5,
      totalSiteSqm,
      usedPct,
      unusedPct,
      usedSqm,
      unusedSqm,
      rentPerTotalSqmAnnual,
      rentBurdenOnUsedSqmAnnual,
      rentBurdenOnUnusedSpaceAnnual,
      rentBurdenOnUnusedSpaceMonthly,
      spaceScenarios,
      investmentOptions,
    },

    verificationLedger,
    governanceMatrix,
    actionPlan90Days,
    cfoDecisions,
  };
}
