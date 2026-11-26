import { computeIrr } from './cfoReviewEngine';
import { round2 } from './erpEngine';

export type RoiPresetId = 'jv_partner' | 'direct' | 'sublease' | 'full_complex' | 'custom';

export interface RoiSimulatorInputs {
  presetId: RoiPresetId;
  scenarioNameAr: string;
  scenarioNameEn: string;
  capexEgp: number;
  expectedMonthlyRevenueEgp: number;
  estadatSharePct: number;
  operatingMarginPct: number;
  incrementalFixedOpexMonthlyEgp: number;
  annualGrowthPct: number;
  discountRatePct: number;
  horizonYears: 3 | 5 | 7 | 10;
  activatedUnusedSharePct: number;
  applyGovProfitShare20Pct: boolean;
}

export interface RoiYearRow {
  year: number;
  activatedSqm: number;
  monthlyRevenueAvg: number;
  annualGrossRevenue: number;
  estadatAttributedRevenue: number;
  operatingCashFlowBeforeGov: number;
  govProfitShareDeduction: number;
  annualNetCashFlow: number;
  discountFactor: number;
  presentValue: number;
  cumulativeNominal: number;
  cumulativeDiscounted: number;
}

export interface RoiSimulationResult {
  inputs: RoiSimulatorInputs;
  totalSiteSqm: number;
  totalUnusedSqm: number;
  activatedSqm: number;
  remainingIdleSqm: number;
  siteUtilizationAfterPct: number;
  capexPerSqm: number;
  monthlyRevenuePerSqm: number;
  annualRentReclaimedEgp: number;
  year1MonthlyNetCashFlow: number;
  year1AnnualNetCashFlow: number;
  totalNominalInflows: number;
  totalPvInflows: number;
  npvEgp: number;
  irrPct: number | null;
  irrSpreadPct: number | null;
  profitabilityIndex: number;
  simplePaybackYears: number | null;
  simplePaybackMonths: number | null;
  discountedPaybackYears: number | null;
  discountedPaybackMonths: number | null;
  year1RoiPct: number;
  totalHorizonNetRoiPct: number;
  breakEvenMonthlyRevenueForNpvZero: number | null;
  decisionSignal: 'approve' | 'conditional' | 'reject';
  yearlySchedule: RoiYearRow[];
}

export interface PinnedRoiScenario {
  id: string;
  pinnedAt: string;
  inputs: RoiSimulatorInputs;
  result: RoiSimulationResult;
}

export const TOTAL_SITE_SQM = 29781.8;
export const BASE_USED_PCT = 20;
export const BASE_UNUSED_PCT = 80;
export const TOTAL_UNUSED_SQM = round2(TOTAL_SITE_SQM * (BASE_UNUSED_PCT / 100)); // 23,825.44 m²
export const ANNUAL_USUFRUCT_RENT_2027 = 5100000;
export const SUNK_IDLE_RENT_ANNUAL = round2(ANNUAL_USUFRUCT_RENT_2027 * (BASE_UNUSED_PCT / 100)); // 4,080,000 EGP/yr

export const ROI_STORAGE_KEY = 'estadat_roi_simulator_inputs_v1';
export const ROI_PINNED_STORAGE_KEY = 'estadat_roi_simulator_pinned_v1';

export const ROI_PRESETS: Record<Exclude<RoiPresetId, 'custom'>, RoiSimulatorInputs> = {
  jv_partner: {
    presetId: 'jv_partner',
    scenarioNameAr: 'شراكة تشغيلية / مشاركة إيراد (JV Operator)',
    scenarioNameEn: 'JV Operator / Revenue Share (Recommended)',
    capexEgp: 2200000,
    expectedMonthlyRevenueEgp: 765000,
    estadatSharePct: 35,
    operatingMarginPct: 82,
    incrementalFixedOpexMonthlyEgp: 22000,
    annualGrowthPct: 6,
    discountRatePct: 22,
    horizonYears: 5,
    activatedUnusedSharePct: 50, // 50% of the 80% idle land = +40% of total site
    applyGovProfitShare20Pct: false,
  },
  direct: {
    presetId: 'direct',
    scenarioNameAr: 'تشغيل واستثمار مباشر من استادات (Direct F&B / Events)',
    scenarioNameEn: 'Direct Estadaat Operation (F&B & Events)',
    capexEgp: 6200000,
    expectedMonthlyRevenueEgp: 850000,
    estadatSharePct: 100,
    operatingMarginPct: 38,
    incrementalFixedOpexMonthlyEgp: 45000,
    annualGrowthPct: 6,
    discountRatePct: 22,
    horizonYears: 5,
    activatedUnusedSharePct: 50,
    applyGovProfitShare20Pct: false,
  },
  sublease: {
    presetId: 'sublease',
    scenarioNameAr: 'أكشاك ومناطق تجارية مشروطة (Commercial Concessions)',
    scenarioNameEn: 'Commercial Kiosks & Concessions (Conditional)',
    capexEgp: 1100000,
    expectedMonthlyRevenueEgp: 260000,
    estadatSharePct: 100,
    operatingMarginPct: 78,
    incrementalFixedOpexMonthlyEgp: 18000,
    annualGrowthPct: 7,
    discountRatePct: 22,
    horizonYears: 5,
    activatedUnusedSharePct: 30,
    applyGovProfitShare20Pct: false,
  },
  full_complex: {
    presetId: 'full_complex',
    scenarioNameAr: 'تطوير كامل الـ 80% (ملاعب + لاونج + قاعات مناسبات)',
    scenarioNameEn: 'Full 80% Complex Expansion (Sports + Lounge + Events)',
    capexEgp: 9500000,
    expectedMonthlyRevenueEgp: 1450000,
    estadatSharePct: 100,
    operatingMarginPct: 40,
    incrementalFixedOpexMonthlyEgp: 85000,
    annualGrowthPct: 7,
    discountRatePct: 22,
    horizonYears: 7,
    activatedUnusedSharePct: 90,
    applyGovProfitShare20Pct: true,
  },
};

export function loadSavedRoiInputs(): RoiSimulatorInputs {
  try {
    const raw = localStorage.getItem(ROI_STORAGE_KEY);
    if (!raw) return ROI_PRESETS.jv_partner;
    const parsed = JSON.parse(raw);
    return {
      ...ROI_PRESETS.jv_partner,
      ...parsed,
      capexEgp: Math.max(0, Number(parsed.capexEgp) || ROI_PRESETS.jv_partner.capexEgp),
      expectedMonthlyRevenueEgp: Math.max(
        0,
        Number(parsed.expectedMonthlyRevenueEgp) || ROI_PRESETS.jv_partner.expectedMonthlyRevenueEgp
      ),
    };
  } catch {
    return ROI_PRESETS.jv_partner;
  }
}

export function loadPinnedRoiScenarios(): PinnedRoiScenario[] {
  try {
    const raw = localStorage.getItem(ROI_PINNED_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, 4) : [];
  } catch {
    return [];
  }
}

export function runRoiSimulation(rawInputs: RoiSimulatorInputs): RoiSimulationResult {
  const capexEgp = Math.max(0, Number(rawInputs.capexEgp) || 0);
  const expectedMonthlyRevenueEgp = Math.max(0, Number(rawInputs.expectedMonthlyRevenueEgp) || 0);
  const estadatSharePct = Math.min(100, Math.max(1, Number(rawInputs.estadatSharePct) || 100));
  const operatingMarginPct = Math.min(100, Math.max(0, Number(rawInputs.operatingMarginPct) || 0));
  const incrementalFixedOpexMonthlyEgp = Math.max(0, Number(rawInputs.incrementalFixedOpexMonthlyEgp) || 0);
  const annualGrowthPct = Math.min(40, Math.max(-15, Number(rawInputs.annualGrowthPct) || 0));
  const discountRatePct = Math.min(60, Math.max(1, Number(rawInputs.discountRatePct) || 22));
  const horizonYears = ([3, 5, 7, 10].includes(Number(rawInputs.horizonYears))
    ? Number(rawInputs.horizonYears)
    : 5) as 3 | 5 | 7 | 10;
  const activatedUnusedSharePct = Math.min(100, Math.max(5, Number(rawInputs.activatedUnusedSharePct) || 50));

  const inputs: RoiSimulatorInputs = {
    ...rawInputs,
    capexEgp,
    expectedMonthlyRevenueEgp,
    estadatSharePct,
    operatingMarginPct,
    incrementalFixedOpexMonthlyEgp,
    annualGrowthPct,
    discountRatePct,
    horizonYears,
    activatedUnusedSharePct,
  };

  const activatedSqm = round2(TOTAL_UNUSED_SQM * (activatedUnusedSharePct / 100));
  const remainingIdleSqm = round2(TOTAL_UNUSED_SQM - activatedSqm);
  const siteUtilizationAfterPct = round2(BASE_USED_PCT + BASE_UNUSED_PCT * (activatedUnusedSharePct / 100));
  const capexPerSqm = activatedSqm > 0 ? round2(capexEgp / activatedSqm) : 0;
  const monthlyRevenuePerSqm = activatedSqm > 0 ? round2(expectedMonthlyRevenueEgp / activatedSqm) : 0;
  const annualRentReclaimedEgp = round2(SUNK_IDLE_RENT_ANNUAL * (activatedUnusedSharePct / 100));

  const r = discountRatePct / 100;
  const g = annualGrowthPct / 100;

  let cumulativeNominal = -capexEgp;
  let cumulativeDiscounted = -capexEgp;
  let simplePaybackYears: number | null = capexEgp === 0 ? 0 : null;
  let discountedPaybackYears: number | null = capexEgp === 0 ? 0 : null;

  const yearlySchedule: RoiYearRow[] = [];

  for (let y = 1; y <= horizonYears; y++) {
    const monthlyRevAvg = round2(expectedMonthlyRevenueEgp * Math.pow(1 + g, y - 1));
    const annualGrossRevenue = round2(monthlyRevAvg * 12);
    const estadatAttributedRevenue = round2(annualGrossRevenue * (estadatSharePct / 100));
    const operatingCashFlowBeforeGov = round2(
      estadatAttributedRevenue * (operatingMarginPct / 100) - incrementalFixedOpexMonthlyEgp * 12
    );
    const govProfitShareDeduction =
      inputs.applyGovProfitShare20Pct && operatingCashFlowBeforeGov > 0
        ? round2(operatingCashFlowBeforeGov * 0.2)
        : 0;
    const annualNetCashFlow = round2(operatingCashFlowBeforeGov - govProfitShareDeduction);
    const discountFactor = Math.pow(1 + r, y);
    const presentValue = round2(annualNetCashFlow / discountFactor);

    const prevNominal = cumulativeNominal;
    const prevDiscounted = cumulativeDiscounted;
    cumulativeNominal = round2(cumulativeNominal + annualNetCashFlow);
    cumulativeDiscounted = round2(cumulativeDiscounted + presentValue);

    if (simplePaybackYears === null && prevNominal < 0 && cumulativeNominal >= 0 && annualNetCashFlow > 0) {
      const fraction = Math.abs(prevNominal) / annualNetCashFlow;
      simplePaybackYears = round2((y - 1) + fraction);
    }

    if (discountedPaybackYears === null && prevDiscounted < 0 && cumulativeDiscounted >= 0 && presentValue > 0) {
      const fraction = Math.abs(prevDiscounted) / presentValue;
      discountedPaybackYears = round2((y - 1) + fraction);
    }

    yearlySchedule.push({
      year: y,
      activatedSqm,
      monthlyRevenueAvg: monthlyRevAvg,
      annualGrossRevenue,
      estadatAttributedRevenue,
      operatingCashFlowBeforeGov,
      govProfitShareDeduction,
      annualNetCashFlow,
      discountFactor: round2(discountFactor),
      presentValue,
      cumulativeNominal,
      cumulativeDiscounted,
    });
  }

  const totalNominalInflows = round2(yearlySchedule.reduce((acc, row) => acc + row.annualNetCashFlow, 0));
  const totalPvInflows = round2(yearlySchedule.reduce((acc, row) => acc + row.presentValue, 0));
  const npvEgp = round2(totalPvInflows - capexEgp);

  const irrPct = computeIrr([-capexEgp, ...yearlySchedule.map((row) => row.annualNetCashFlow)]);
  const irrSpreadPct = irrPct !== null ? round2(irrPct - discountRatePct) : null;
  const profitabilityIndex = capexEgp > 0 ? round2(totalPvInflows / capexEgp) : 0;

  const year1AnnualNetCashFlow = yearlySchedule[0]?.annualNetCashFlow ?? 0;
  const year1MonthlyNetCashFlow = round2(year1AnnualNetCashFlow / 12);
  const year1RoiPct = capexEgp > 0 ? round2((year1AnnualNetCashFlow / capexEgp) * 100) : 0;
  const totalHorizonNetRoiPct =
    capexEgp > 0 ? round2(((totalNominalInflows - capexEgp) / capexEgp) * 100) : 0;

  // Solve break-even monthly revenue for NPV = 0 over the selected horizon via binary search
  let breakEvenMonthlyRevenueForNpvZero: number | null = null;
  const effectiveMarginRatio = (estadatSharePct / 100) * (operatingMarginPct / 100);
  if (effectiveMarginRatio > 0) {
    let lo = 0;
    let hi = 25000000;
    const npvAtMonthlyRev = (mRev: number) => {
      let pvSum = 0;
      for (let y = 1; y <= horizonYears; y++) {
        const attrRev = mRev * 12 * Math.pow(1 + g, y - 1) * (estadatSharePct / 100);
        const cfBeforeGov = attrRev * (operatingMarginPct / 100) - incrementalFixedOpexMonthlyEgp * 12;
        const netCf =
          inputs.applyGovProfitShare20Pct && cfBeforeGov > 0 ? cfBeforeGov * 0.8 : cfBeforeGov;
        pvSum += netCf / Math.pow(1 + r, y);
      }
      return pvSum - capexEgp;
    };
    if (npvAtMonthlyRev(hi) >= 0) {
      for (let i = 0; i < 45; i++) {
        const mid = (lo + hi) / 2;
        if (npvAtMonthlyRev(mid) >= 0) hi = mid;
        else lo = mid;
      }
      breakEvenMonthlyRevenueForNpvZero = round2((lo + hi) / 2);
    }
  }

  const decisionSignal: 'approve' | 'conditional' | 'reject' =
    npvEgp > 0 && (simplePaybackYears !== null && simplePaybackYears <= horizonYears * 0.65)
      ? 'approve'
      : npvEgp >= 0
      ? 'conditional'
      : 'reject';

  return {
    inputs,
    totalSiteSqm: TOTAL_SITE_SQM,
    totalUnusedSqm: TOTAL_UNUSED_SQM,
    activatedSqm,
    remainingIdleSqm,
    siteUtilizationAfterPct,
    capexPerSqm,
    monthlyRevenuePerSqm,
    annualRentReclaimedEgp,
    year1MonthlyNetCashFlow,
    year1AnnualNetCashFlow,
    totalNominalInflows,
    totalPvInflows,
    npvEgp,
    irrPct,
    irrSpreadPct,
    profitabilityIndex,
    simplePaybackYears,
    simplePaybackMonths: simplePaybackYears !== null ? round2(simplePaybackYears * 12) : null,
    discountedPaybackYears,
    discountedPaybackMonths:
      discountedPaybackYears !== null ? round2(discountedPaybackYears * 12) : null,
    year1RoiPct,
    totalHorizonNetRoiPct,
    breakEvenMonthlyRevenueForNpvZero,
    decisionSignal,
    yearlySchedule,
  };
}
