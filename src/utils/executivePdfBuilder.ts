import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { ErpState } from '../types/erp.ts';
import {
  computeAccountBalances,
  computeFoodCostVarianceAnalysis,
  computeStocktakeVarianceAlerts,
  round2,
} from './erpEngine.ts';

export interface MonthlyTrendPoint {
  month: string;
  monthLabelEn: string;
  monthLabelAr: string;
  quarter: 'Q1' | 'Q2' | 'Q3' | 'Q4';
  grossRevenue: number;
  netRevenue: number;
  cogs: number;
  grossProfit: number;
  gpMarginPct: number;
  payroll: number;
  usufructRent: number;
  otherOpex: number;
  bankFees: number;
  ebitdaExUsufruct: number;
  ebitdaInclUsufruct: number;
  netProfit: number;
  revMomPct: number | null;
  gpMomPct: number | null;
  ebitdaMomPct: number | null;
}

export interface ExecutiveKpiSnapshot {
  generatedAt: string;
  periodLabel: string;
  grossRevenue: number;
  netRevenue: number;
  vatOutput: number;
  cogs: number;
  cogsPct: number;
  grossProfit: number;
  gpMarginPct: number;
  payroll: number;
  payrollPct: number;
  usufructRent: number;
  otherOpex: number;
  bankFees: number;
  ebitdaOperating: number;
  ebitdaAccounting: number;
  netProfit: number;
  netMarginPct: number;
  breakEvenMonthlyNet: number;
  cibBankBalance: number;
  clearing1103Balance: number;
  inventoryValue: number;
  livePosCount: number;
  livePosNetSales: number;
  foodCostVariancePct: number;
  pendingStocktakeAlerts: number;
  revMomPct: number | null;
  gpMomPct: number | null;
  ebitdaMomPct: number | null;
}

export interface ExecutiveRiskSummaryItem {
  id: string;
  code: string;
  titleAr: string;
  titleEn: string;
  impact: 'high' | 'medium' | 'low';
  status: 'open' | 'in_progress' | 'mitigated';
  ownerAr: string;
  ownerEn: string;
  mitigationAr: string;
  mitigationEn: string;
  financialExposureEgp: number;
  dueDate: string;
  updatedAt: string;
  latestAuditSummaryEn: string;
  latestAuditSummaryAr: string;
}

export interface ExecutiveDigestBundleData {
  kpi: ExecutiveKpiSnapshot;
  monthlySeries: MonthlyTrendPoint[];
  risks: ExecutiveRiskSummaryItem[];
  riskCounts: {
    total: number;
    open: number;
    inProgress: number;
    mitigated: number;
    highUnmitigated: number;
    totalExposureEgp: number;
  };
}

function fmtNum(val: number, decimals = 0): string {
  return val.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtSignedPct(val: number | null): string {
  if (val === null || !Number.isFinite(val)) return '--';
  const sign = val > 0 ? '+' : '';
  return `${sign}${val.toFixed(1)}%`;
}

export function buildMonthlyTrendSeries(
  state: ErpState,
  excludeUsufructRent = false,
  includeLiveOctober = false
): MonthlyTrendPoint[] {
  type BaseMonthlyRow = Omit<MonthlyTrendPoint, 'revMomPct' | 'gpMomPct' | 'ebitdaMomPct'>;
  const baseRows: BaseMonthlyRow[] = state.monthlyActuals2026.map((m) => {
    const otherOpex = round2(m.electricity + m.otherOpex);
    const ebitdaExUsufruct = round2(m.grossProfit - m.payroll - otherOpex - m.bankFeesNet);
    const ebitdaInclUsufruct = round2(ebitdaExUsufruct - m.usufructRent);
    return {
      month: m.monthKey,
      monthLabelEn: m.labelEn,
      monthLabelAr: m.labelAr,
      quarter: m.quarter,
      grossRevenue: m.grossRevenue,
      netRevenue: m.netRevenue,
      cogs: m.cogs,
      grossProfit: m.grossProfit,
      gpMarginPct: m.netRevenue > 0 ? round2((m.grossProfit / m.netRevenue) * 100) : 0,
      payroll: m.payroll,
      usufructRent: m.usufructRent,
      otherOpex,
      bankFees: m.bankFeesNet,
      ebitdaExUsufruct,
      ebitdaInclUsufruct,
      netProfit: excludeUsufructRent ? ebitdaExUsufruct : m.netProfit,
    };
  });

  if (includeLiveOctober) {
    const newSales = state.salesInvoices.filter((s) => !s.id.startsWith('INV-SEED-'));
    const newExpenses = state.expenses.filter((e) => !e.id.startsWith('EXP-SEED-'));
    if (newSales.length > 0 || newExpenses.length > 0) {
      const grossRevenue = round2(newSales.reduce((a, s) => a + s.grossTotal, 0));
      const netRevenue = round2(newSales.reduce((a, s) => a + s.netSales, 0));
      const cogs = round2(newSales.reduce((a, s) => a + s.cogsTotal, 0));
      const grossProfit = round2(netRevenue - cogs);
      const otherOpex = round2(newExpenses.reduce((a, e) => a + e.amountNet, 0));
      const ebitdaExUsufruct = round2(grossProfit - otherOpex);
      baseRows.push({
        month: '2026-10',
        monthLabelEn: 'Oct (Live)',
        monthLabelAr: 'أكتوبر (مباشر)',
        quarter: 'Q4',
        grossRevenue,
        netRevenue,
        cogs,
        grossProfit,
        gpMarginPct: netRevenue > 0 ? round2((grossProfit / netRevenue) * 100) : 0,
        payroll: 0,
        usufructRent: 0,
        otherOpex,
        bankFees: 0,
        ebitdaExUsufruct,
        ebitdaInclUsufruct: ebitdaExUsufruct,
        netProfit: ebitdaExUsufruct,
      });
    }
  }

  return baseRows.map((row, idx) => {
    if (idx === 0) {
      return {
        ...row,
        revMomPct: null,
        gpMomPct: null,
        ebitdaMomPct: null,
      };
    }
    const prev = baseRows[idx - 1];
    const revMomPct =
      prev.netRevenue !== 0 ? round2(((row.netRevenue - prev.netRevenue) / Math.abs(prev.netRevenue)) * 100) : null;
    const gpMomPct =
      prev.grossProfit !== 0
        ? round2(((row.grossProfit - prev.grossProfit) / Math.abs(prev.grossProfit)) * 100)
        : null;
    const curEbitda = excludeUsufructRent ? row.ebitdaExUsufruct : row.ebitdaInclUsufruct;
    const prevEbitda = excludeUsufructRent ? prev.ebitdaExUsufruct : prev.ebitdaInclUsufruct;
    const ebitdaMomPct =
      prevEbitda !== 0 ? round2(((curEbitda - prevEbitda) / Math.abs(prevEbitda)) * 100) : null;

    return {
      ...row,
      revMomPct,
      gpMomPct,
      ebitdaMomPct,
    };
  });
}

export function buildExecutiveBundleData(state: ErpState): ExecutiveDigestBundleData {
  const balances = computeAccountBalances(state);
  const newSales = state.salesInvoices.filter((s) => !s.id.startsWith('INV-SEED-'));
  const newExpenses = state.expenses.filter((e) => !e.id.startsWith('EXP-SEED-'));
  const livePosNetSales = round2(newSales.reduce((a, s) => a + s.netSales, 0));
  const livePosGross = round2(newSales.reduce((a, s) => a + s.grossTotal, 0));
  const liveVat = round2(newSales.reduce((a, s) => a + s.vatAmount, 0));
  const liveCogs = round2(newSales.reduce((a, s) => a + s.cogsTotal, 0));
  const liveExpNet = round2(newExpenses.reduce((a, e) => a + e.amountNet, 0));

  const series = buildMonthlyTrendSeries(state, false, newSales.length > 0);
  const auditedRows = state.monthlyActuals2026;
  const grossRevenue = round2(auditedRows.reduce((a, m) => a + m.grossRevenue, 0) + livePosGross);
  const netRevenue = round2(auditedRows.reduce((a, m) => a + m.netRevenue, 0) + livePosNetSales);
  const vatOutput = round2(auditedRows.reduce((a, m) => a + m.vatOutput, 0) + liveVat);
  const cogs = round2(auditedRows.reduce((a, m) => a + m.cogs, 0) + liveCogs);
  const payroll = round2(auditedRows.reduce((a, m) => a + m.payroll, 0));
  const usufructRent = round2(auditedRows.reduce((a, m) => a + m.usufructRent, 0));
  const otherOpex = round2(auditedRows.reduce((a, m) => a + m.electricity + m.otherOpex, 0) + liveExpNet);
  const bankFees = round2(auditedRows.reduce((a, m) => a + m.bankFeesNet, 0));
  const grossProfit = round2(netRevenue - cogs);
  const ebitdaOperating = round2(grossProfit - payroll - otherOpex - bankFees);
  const ebitdaAccounting = round2(ebitdaOperating - usufructRent);
  const totalExpenses = round2(payroll + usufructRent + otherOpex + bankFees);
  const gpMarginPct = netRevenue > 0 ? round2((grossProfit / netRevenue) * 100) : 0;
  const cogsPct = netRevenue > 0 ? round2((cogs / netRevenue) * 100) : 0;
  const payrollPct = netRevenue > 0 ? round2((payroll / netRevenue) * 100) : 0;
  const netMarginPct = netRevenue > 0 ? round2((ebitdaAccounting / netRevenue) * 100) : 0;
  const cmRatio = gpMarginPct / 100;
  const monthsCount = Math.max(1, auditedRows.length);
  const breakEvenMonthlyNet = cmRatio > 0 ? round2(totalExpenses / monthsCount / cmRatio) : 0;

  const inventoryValue = round2(
    state.ingredients.reduce((acc, item) => acc + item.currentQty * item.weightedAvgCost, 0)
  );
  const fcSummary = computeFoodCostVarianceAnalysis(state, '9m_plus_live', 5);
  const stkSummary = computeStocktakeVarianceAlerts(state, 2);

  // Latest audited MoM delta (Sep vs Aug for stable comparison)
  const auditedSeries = series.filter((p) => p.quarter !== 'Q4');
  const lastAudited = auditedSeries[auditedSeries.length - 1];

  const kpi: ExecutiveKpiSnapshot = {
    generatedAt: new Date().toISOString(),
    periodLabel: newSales.length > 0 ? '9M 2026 Audited + Live Oct Operations' : '9M 2026 Audited (Jan-Sep)',
    grossRevenue,
    netRevenue,
    vatOutput,
    cogs,
    cogsPct,
    grossProfit,
    gpMarginPct,
    payroll,
    payrollPct,
    usufructRent,
    otherOpex,
    bankFees,
    ebitdaOperating,
    ebitdaAccounting,
    netProfit: ebitdaAccounting,
    netMarginPct,
    breakEvenMonthlyNet,
    cibBankBalance: round2(balances['1102'] ?? 0),
    clearing1103Balance: round2(balances['1103'] ?? 0),
    inventoryValue,
    livePosCount: newSales.length,
    livePosNetSales,
    foodCostVariancePct: fcSummary.periodVariancePct,
    pendingStocktakeAlerts: stkSummary.pendingExceedingCount,
    revMomPct: lastAudited?.revMomPct ?? null,
    gpMomPct: lastAudited?.gpMomPct ?? null,
    ebitdaMomPct: lastAudited?.ebitdaMomPct ?? null,
  };

  const risks: ExecutiveRiskSummaryItem[] = (state.strategy2027.risks ?? []).map((r, idx) => {
    const latestAudit = r.auditHistory?.[0];
    return {
      id: r.id,
      code: r.code || `RSK-${String(idx + 1).padStart(2, '0')}`,
      titleAr: r.riskAr,
      titleEn: r.riskEn || r.riskAr,
      impact: r.impact,
      status: r.status ?? 'open',
      ownerAr: r.ownerAr || 'المدير المالي CFO',
      ownerEn: r.ownerEn || 'Chief Financial Officer (CFO)',
      mitigationAr: r.mitigationAr || '',
      mitigationEn: r.mitigationEn || r.mitigationAr || '',
      financialExposureEgp: Number(r.financialExposureEgp) || 0,
      dueDate: r.dueDate || '2026-12-31',
      updatedAt: r.updatedAt || state.reportDate,
      latestAuditSummaryEn: latestAudit?.summaryEn || 'Initial Risk Register Entry',
      latestAuditSummaryAr: latestAudit?.summaryAr || 'تسجيل أولي في سجل المخاطر',
    };
  });

  const riskCounts = {
    total: risks.length,
    open: risks.filter((r) => r.status === 'open').length,
    inProgress: risks.filter((r) => r.status === 'in_progress').length,
    mitigated: risks.filter((r) => r.status === 'mitigated').length,
    highUnmitigated: risks.filter((r) => r.impact === 'high' && r.status !== 'mitigated').length,
    totalExposureEgp: round2(risks.reduce((a, r) => a + r.financialExposureEgp, 0)),
  };

  return { kpi, monthlySeries: series, risks, riskCounts };
}

function asciiSafe(text: string | undefined | null, fallback = '-'): string {
  if (!text) return fallback;
  const cleaned = text.replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned : fallback;
}

export interface GeneratedPdfResult {
  filename: string;
  buffer: Buffer;
  bundleData: ExecutiveDigestBundleData;
}

export function generateFinancialPerformanceSummaryPdf(
  state: ErpState,
  options?: {
    periodTag?: string;
    reportHeading?: string;
    includeWeeklyDigestNote?: boolean;
  }
): GeneratedPdfResult {
  const bundleData = buildExecutiveBundleData(state);
  const { kpi, monthlySeries, risks, riskCounts } = bundleData;
  const periodTag = options?.periodTag || new Date().toISOString().slice(0, 7);
  const heading = options?.reportHeading || 'Financial Performance Summary';

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  // Top Executive Banner
  doc.setFillColor(15, 23, 42);
  doc.rect(12, 12, 186, 22, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(`ESTADAT AL-BORG ERP - ${heading.toUpperCase()}`, 16, 20.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(203, 213, 225);
  doc.text(
    `Menoufia Tower Branch | Tax ID: ${asciiSafe(state.taxId)} | Scope: ${kpi.periodLabel}`,
    16,
    26.5
  );
  doc.text(`Period Archive: ${periodTag} | Generated: ${kpi.generatedAt.slice(0, 16).replace('T', ' ')} UTC`, 16, 31);

  if (options?.includeWeeklyDigestNote) {
    doc.setFillColor(240, 253, 250);
    doc.setDrawColor(15, 118, 110);
    doc.rect(12, 37, 186, 8, 'FD');
    doc.setTextColor(15, 118, 110);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text(
      `WEEKLY EXECUTIVE DIGEST ATTACHMENT — KPI SNAPSHOT + ${riskCounts.total} TRACKED RISKS (${riskCounts.highUnmitigated} HIGH OPEN)`,
      15,
      42.2
    );
  }

  // Section 1: KPI Summary Table
  const startY = options?.includeWeeklyDigestNote ? 49 : 39;
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('1. Executive KPI & Treasury Position (EGP)', 12, startY);

  autoTable(doc, {
    startY: startY + 2.5,
    margin: { left: 12, right: 12 },
    theme: 'grid',
    headStyles: {
      fillColor: [15, 118, 110],
      textColor: [255, 255, 255],
      fontSize: 8,
      fontStyle: 'bold',
    },
    styles: {
      fontSize: 8,
      cellPadding: 2.2,
      textColor: [30, 41, 59],
    },
    head: [['Metric', 'Period Total / Balance', 'Margin / Benchmark', 'MoM Trend']],
    body: [
      [
        'Gross Revenue (Incl. 14% VAT)',
        `${fmtNum(kpi.grossRevenue)} EGP`,
        `Net Ex-VAT: ${fmtNum(kpi.netRevenue)} EGP`,
        fmtSignedPct(kpi.revMomPct),
      ],
      [
        'Gross Profit (GP)',
        `${fmtNum(kpi.grossProfit)} EGP`,
        `GP Margin: ${kpi.gpMarginPct.toFixed(1)}% (COGS ${kpi.cogsPct.toFixed(1)}%)`,
        fmtSignedPct(kpi.gpMomPct),
      ],
      [
        'Operating EBITDA (Ex-Usufruct)',
        `${fmtNum(kpi.ebitdaOperating)} EGP`,
        `Payroll: ${kpi.payrollPct.toFixed(1)}% (${fmtNum(kpi.payroll)} EGP)`,
        fmtSignedPct(kpi.ebitdaMomPct),
      ],
      [
        'Accounting EBITDA / Net Result (Incl. Usufruct)',
        `${fmtNum(kpi.ebitdaAccounting)} EGP`,
        `Net Margin: ${kpi.netMarginPct.toFixed(1)}% | Usufruct: ${fmtNum(kpi.usufructRent)}`,
        fmtSignedPct(kpi.ebitdaMomPct),
      ],
      [
        'Monthly Break-Even Target',
        `${fmtNum(kpi.breakEvenMonthlyNet)} EGP/mo`,
        `2027 Recovery Target: 1,700,000 EGP/mo`,
        'Target <= 35% COGS',
      ],
      [
        'Treasury & Inventory WAC (1102 / 1103 / 1201)',
        `CIB: ${fmtNum(kpi.cibBankBalance)} EGP`,
        `Visa 1103: ${fmtNum(kpi.clearing1103Balance)} | Inv: ${fmtNum(kpi.inventoryValue)}`,
        `POS Live: ${kpi.livePosCount} orders`,
      ],
    ],
  });

  // Section 2: Monthly Financial Performance Table
  const afterKpiY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 112;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('2. Month-over-Month Performance Trend (Revenue, GP & EBITDA)', 12, afterKpiY + 7);

  autoTable(doc, {
    startY: afterKpiY + 9.5,
    margin: { left: 12, right: 12 },
    theme: 'striped',
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: [255, 255, 255],
      fontSize: 7.5,
      fontStyle: 'bold',
    },
    styles: {
      fontSize: 7.5,
      cellPadding: 1.9,
      halign: 'right',
    },
    columnStyles: {
      0: { halign: 'left', fontStyle: 'bold' },
      1: { halign: 'center' },
    },
    head: [['Month', 'Qtr', 'Net Revenue', 'Rev MoM', 'Gross Profit', 'GP %', 'EBITDA (Op)', 'Net Result']],
    body: monthlySeries.map((m) => [
      asciiSafe(m.monthLabelEn, m.month),
      m.quarter,
      fmtNum(m.netRevenue),
      fmtSignedPct(m.revMomPct),
      fmtNum(m.grossProfit),
      `${m.gpMarginPct.toFixed(1)}%`,
      fmtNum(m.ebitdaExUsufruct),
      fmtNum(m.ebitdaInclUsufruct),
    ]),
  });

  // Section 3: Risk Register & Mitigation Updates
  const afterMonthlyY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 195;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(
    `3. CFO Risk Register Status (${riskCounts.total} Risks | Open: ${riskCounts.open} | In Progress: ${riskCounts.inProgress} | Mitigated: ${riskCounts.mitigated})`,
    12,
    afterMonthlyY + 7
  );

  autoTable(doc, {
    startY: afterMonthlyY + 9.5,
    margin: { left: 12, right: 12 },
    theme: 'grid',
    headStyles: {
      fillColor: [180, 83, 9],
      textColor: [255, 255, 255],
      fontSize: 7.5,
      fontStyle: 'bold',
    },
    styles: {
      fontSize: 7.2,
      cellPadding: 1.9,
      overflow: 'linebreak',
    },
    columnStyles: {
      0: { cellWidth: 16, fontStyle: 'bold' },
      1: { cellWidth: 44 },
      2: { cellWidth: 15, halign: 'center' },
      3: { cellWidth: 20, halign: 'center' },
      4: { cellWidth: 24, halign: 'right' },
      5: { cellWidth: 67 },
    },
    head: [['Code', 'Risk Title', 'Impact', 'Status', 'Exposure (EGP)', 'Mitigation & Latest Audit Update']],
    body: risks.map((r) => [
      r.code,
      asciiSafe(r.titleEn, r.code),
      r.impact.toUpperCase(),
      r.status.replace('_', ' ').toUpperCase(),
      fmtNum(r.financialExposureEgp),
      `${asciiSafe(r.mitigationEn, 'Active control')} [Log: ${asciiSafe(r.latestAuditSummaryEn, 'Tracked')}]`,
    ]),
  });

  // Footer page stamp
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p += 1) {
    doc.setPage(p);
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `Estadat Al-Borg Financial ERP | Automated Executive Report | Confidential — Page ${p} of ${pageCount}`,
      12,
      288
    );
  }

  const arrayBuffer = doc.output('arraybuffer');
  const buffer = Buffer.from(arrayBuffer);
  const safePeriod = periodTag.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `Financial_Performance_Summary_${safePeriod}.pdf`;

  return { filename, buffer, bundleData };
}
