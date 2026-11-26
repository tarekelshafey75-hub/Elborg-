import * as XLSX from 'xlsx';
import PptxGenJS from 'pptxgenjs';
import type { ErpState, Language } from '../types/erp';
import type { CfoExecutiveReviewData, VerificationStatus } from './cfoReviewEngine';
import { computeStocktakeVarianceAlerts, round2 } from './erpEngine';

function statusText(status: VerificationStatus, lang: Language): string {
  switch (status) {
    case 'CONFIRMED':
      return lang === 'ar' ? 'CONFIRMED (مؤكد)' : 'CONFIRMED';
    case 'PENDING_REVIEW':
      return lang === 'ar' ? 'PENDING_REVIEW (قيد التحقق)' : 'PENDING_REVIEW';
    case 'MISSING_DATA':
      return lang === 'ar' ? 'MISSING_DATA (بيان ناقص)' : 'MISSING_DATA';
    case 'NOT_CALCULABLE':
      return lang === 'ar' ? 'NOT_CALCULABLE (غير قابل للحساب)' : 'NOT_CALCULABLE';
  }
}

function n(val: number): number {
  return round2(val);
}

function autoFitCols(ws: XLSX.WorkSheet, rows: (string | number | { f: string } | null)[][], minW = 14, maxW = 48) {
  const colWidths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, idx) => {
      const len = cell === null || cell === undefined
        ? 4
        : typeof cell === 'object' && 'f' in cell
        ? 16
        : String(cell).length + 3;
      colWidths[idx] = Math.min(maxW, Math.max(minW, colWidths[idx] || 0, len));
    });
  }
  ws['!cols'] = colWidths.map((wch) => ({ wch }));
}

function setFormulaCell(ws: XLSX.WorkSheet, addr: string, formula: string, numFmt = '#,##0.00') {
  ws[addr] = { t: 'n', f: formula, z: numFmt };
}

/**
 * Builds the 11-sheet CFO Financial & Investment Excel Workbook (2026 10M + 2027 Plan).
 */
export function buildCfoExcelWorkbook(
  state: ErpState,
  review: CfoExecutiveReviewData,
  lang: Language = 'ar'
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const stocktake = computeStocktakeVarianceAlerts(state, 2);

  // 1. 01_Executive_Summary
  const s1Rows: (string | number | null)[][] = [
    ['ESTADAT | MONUFIA TOWER — CFO EXECUTIVE FINANCIAL, OPERATIONAL & INVESTMENT MODEL'],
    [lang === 'ar' ? 'دراسة الأداء المالي والتشغيلي (يناير – أكتوبر 2026) والخطة الاستراتيجية والاستثمارية 2027' : '10-Month Financial Review (Jan–Oct 2026) & 2027 Strategic Plan'],
    ['Prepared By / إعداد:', review.preparedByEn, 'Period / الفترة:', review.reportPeriodLabelEn, 'Report Date:', review.generatedAt],
    [],
    ['1. FIVE STRATEGIC QUESTIONS SUMMARY / ملخص الأسئلة الاستراتيجية الخمسة'],
    ['#', 'Strategic Question (AR/EN)', 'Executive Evidence-Based Answer', 'Audit Status'],
    [
      'Q1',
      'حقيقة الأداء المالي خلال 10 أشهر (Jan–Oct 2026)',
      `9M Net Revenue 11,343,364 EGP (Gross 12,931,435). 9M Net Loss -4,164,946 EGP (monthly COGS sum) / -4,099,945 EGP (GL 5101; 65k gap). Oct open in DB with ${review.octoberLive.invoiceCount} live invoices (${review.octoberLive.grossSales.toFixed(0)} EGP) + 1 PO (${review.octoberLive.purchasesGross.toFixed(0)} EGP). Profit Ex-Usufruct = -398k EGP (near operating breakeven before 5.1M rent).`,
      'CONFIRMED / OCT OPEN',
    ],
    [
      'Q2',
      'حجم التحسن في الإدارة والرقابة والتشغيل',
      `1103 VISA Clearing zeroed (0.00 EGP); May 3.52% MDR anomaly caught (18,500 EGP); 511,700 EGP inventory tied 100% to GL 1201; 2.15M AP tied to GL 2101; Trial Balance balanced; 109 menu SKUs + BOM standardized; pre-2026 baseline missing for numeric YoY delta.`,
      'CONFIRMED / PRE-2026 MISSING',
    ],
    [
      'Q3',
      'المشكلات والمخاطر التي لا تزال قائمة',
      `65,000 EGP 9M COGS GL discrepancy; Oct monthly close incomplete; -13,000 EGP CIB May variance; 1.275M movement pending verification; Payroll & bonuses 56.12% of net rev (1.56M bonuses); Electricity +234% Jan→Sep; 4 Oct-19 stocktakes >2% (-8,505.5 EGP).`,
      'PENDING_REVIEW',
    ],
    [
      'Q4',
      'استغلال حق الانتفاع والفراغ البالغ 80% (~23,825 م²)',
      `Active area ~20% (${review.usufruct.usedSqm} m²) absorbs full 5.1M rent (${review.usufruct.rentBurdenOnUsedSqmAnnual} EGP/m²). Unused 80% (${review.usufruct.unusedSqm} m²) carries 4,080,000 EGP/yr idle rent burden. Expanding to 30%–40% via JV adds +1.95M to +5.7M EBITDA.`,
      'PENDING_REVIEW (SURVEY NEEDED)',
    ],
    [
      'Q5',
      'قرارات واستثمارات 2027 لتحقيق أفضل عائد اقتصادي',
      `Approve 2027 Scenario C (18.0M net rev, 35% COGS, 6.0M payroll, -0.5M net result, Q4 break-even at 1.70M/mo) + Launch Option 2 JV Partner (2.2M CAPEX, ~1.13 yr payback, high IRR) for 80% idle zone + Governorate addendum talks.`,
      'RECOMMENDED ROADMAP',
    ],
    [],
    ['2. HEADLINE KPI SNAPSHOT (LINKED TO WORKSHEETS)'],
    ['Metric / المؤشر', '9M Confirmed (Monthly)', '9M Confirmed (GL 5101)', 'Oct Live DB (Partial)', '10M Combined (In DB)', 'Audit Status'],
    ['Gross Revenue (incl. 14% VAT)', review.totals9MMonthly.grossSales, review.totals9MMonthly.grossSales, review.octoberLive.grossSales, 0, 'CONFIRMED (9M) / PARTIAL (OCT)'],
    ['Output VAT (14%)', review.totals9MMonthly.vatOutput, review.totals9MMonthly.vatOutput, review.octoberLive.vatOutput, 0, 'CONFIRMED (9M) / PARTIAL (OCT)'],
    ['Net Accounting Revenue', review.totals9MMonthly.netRevenue, review.totals9MMonthly.netRevenue, review.octoberLive.netSales, 0, 'CONFIRMED (9M) / PARTIAL (OCT)'],
    ['COGS (Cost of Sales)', review.totals9MMonthly.cogsMonthlySum, review.totals9MMonthly.cogsGl5101, review.octoberLive.cogsTotal, 0, 'PENDING_REVIEW (65k GAP)'],
    ['Gross Profit', 0, 0, 0, 0, 'FORMULA_LINKED'],
    ['Payroll & Bonuses (5201)', review.totals9MMonthly.payrollTotal, review.totals9MMonthly.payrollTotal, review.octoberLive.payrollRecorded, 0, 'CONFIRMED (9M)'],
    ['Usufruct Rent (5202)', review.totals9MMonthly.usufructRent, review.totals9MMonthly.usufructRent, review.octoberLive.rentRecorded, 0, 'CONFIRMED (9M)'],
    ['Electricity + OpEx + Bank Fees', n(review.totals9MMonthly.electricity + review.totals9MMonthly.otherOpex + review.totals9MMonthly.bankFeesNet), n(review.totals9MMonthly.electricity + review.totals9MMonthly.otherOpex + review.totals9MMonthly.bankFeesNet), n(review.octoberLive.utilitiesRecorded), 0, 'CONFIRMED (9M)'],
    ['Net Profit / (Loss)', 0, 0, 0, 0, 'FORMULA_LINKED'],
    ['Net Result Ex-Usufruct Rent', 0, 0, 0, 0, 'FORMULA_LINKED'],
    [],
    ['3. TOP 9 CFO EXECUTIVE DECISIONS'],
    ['ID', 'Decision (AR)', 'Decision (EN)', 'Financial Impact', 'Urgency'],
    ...review.cfoDecisions.map((d) => [d.id, d.decisionAr, d.decisionEn, d.financialImpactEn, d.urgency.toUpperCase()]),
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(s1Rows);
  // Link Executive Summary cells dynamically with formulas to 02_10M_Monthly_PL and internal rows
  setFormulaCell(ws1, 'E15', 'B15+D15');
  setFormulaCell(ws1, 'E16', 'B16+D16');
  setFormulaCell(ws1, 'E17', 'B17+D17');
  setFormulaCell(ws1, 'E18', 'B18+D18');
  setFormulaCell(ws1, 'B19', 'B17-B18');
  setFormulaCell(ws1, 'C19', 'C17-C18');
  setFormulaCell(ws1, 'D19', 'D17-D18');
  setFormulaCell(ws1, 'E19', 'E17-E18');
  setFormulaCell(ws1, 'E20', 'B20+D20');
  setFormulaCell(ws1, 'E21', 'B21+D21');
  setFormulaCell(ws1, 'E22', 'B22+D22');
  setFormulaCell(ws1, 'B23', 'B19-B20-B21-B22');
  setFormulaCell(ws1, 'C23', 'C19-C20-C21-C22');
  setFormulaCell(ws1, 'D23', 'D19-D20-D21-D22');
  setFormulaCell(ws1, 'E23', 'E19-E20-E21-E22');
  setFormulaCell(ws1, 'B24', 'B23+B21');
  setFormulaCell(ws1, 'C24', 'C23+C21');
  setFormulaCell(ws1, 'D24', 'D23+D21');
  setFormulaCell(ws1, 'E24', 'E23+E21');
  autoFitCols(ws1, s1Rows);
  XLSX.utils.book_append_sheet(wb, ws1, '01_Executive_Summary');

  // 2. 02_10M_Monthly_PL
  const plHeaders = [
    'MonthKey',
    'Quarter',
    'Month (AR)',
    'Month (EN)',
    'Status',
    'Gross Sales',
    'VAT Output (14%)',
    'Net Revenue',
    'COGS',
    'Gross Profit',
    'GP %',
    'Payroll Base',
    'Bonuses',
    'Payroll Total',
    'Usufruct Rent',
    'Electricity',
    'Other OpEx',
    'Bank Fees Net',
    'Total Expenses',
    'Net Profit',
    'Net Profit Ex-Rent',
    'Source / Notes',
  ];
  const plRows: (string | number | null)[][] = [
    ['10-MONTH PERFORMANCE STATEMENT (JANUARY – OCTOBER 2026) — ESTADAT MONUFIA TOWER'],
    ['Notice: Jan–Sep are Confirmed Audited Actuals. Oct 2026 contains ONLY live DB entries (incomplete close; zero estimated figures).'],
    plHeaders,
    ...review.monthlyRows.map((m) => [
      m.monthKey,
      m.quarter,
      m.labelAr,
      m.labelEn,
      m.status,
      m.grossSales,
      m.vatOutput,
      m.netSales,
      m.cogs,
      m.grossProfit,
      round2(m.gpMarginPct),
      m.payrollBase,
      m.payrollBonuses,
      m.payrollTotal,
      m.usufructRent,
      m.electricity,
      m.otherOpex,
      m.bankFeesNet,
      m.totalExpenses,
      m.netProfit,
      m.netProfitExRent,
      m.sourceLabelEn,
    ]),
    // Row 14: 9M Monthly Sum (Rows 4..12)
    ['9M-MONTHLY', '9M', 'إجمالي 9 شهور (جدول شهري)', '9M Sum (Monthly Table)', 'CONFIRMED', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 'Exact SUM(Jan..Sep)'],
    // Row 15: 9M GL 5101 Summary Comparison
    [
      '9M-GL5101',
      '9M',
      'إجمالي 9 شهور (ملخص GL 5101)',
      '9M Audit Summary (GL 5101)',
      'PENDING_REVIEW',
      review.totals9MMonthly.grossSales,
      review.totals9MMonthly.vatOutput,
      review.totals9MMonthly.netRevenue,
      review.totals9MMonthly.cogsGl5101,
      review.totals9MMonthly.grossProfitGl,
      round2((review.totals9MMonthly.grossProfitGl / review.totals9MMonthly.netRevenue) * 100),
      review.totals9MMonthly.payrollBase,
      review.totals9MMonthly.payrollBonuses,
      review.totals9MMonthly.payrollTotal,
      review.totals9MMonthly.usufructRent,
      review.totals9MMonthly.electricity,
      review.totals9MMonthly.otherOpex,
      review.totals9MMonthly.bankFeesNet,
      review.totals9MMonthly.totalExpenses,
      review.totals9MMonthly.netProfitGl,
      review.totals9MMonthly.netProfitExRentGl,
      'GL 5101 COGS = 4,645,514 (65,000 EGP variance vs Monthly COGS sum)',
    ],
    // Row 16: Discrepancy Row
    ['DIFF-65K', 'AUDIT', 'فرق المراجعة (الشهري - GL)', 'Audit Discrepancy (Monthly - GL)', 'PENDING_REVIEW', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 'Requires Controller Reconciliation Journal'],
    // Row 17: 10M Combined (Jan..Oct in DB)
    ['10M-TOTAL', '10M', 'الإجمالي التراكمي 10 أشهر (حتى أكتوبر)', '10M Combined (Jan–Sep + Live Oct)', 'PARTIAL_OCT', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 'Includes verified Oct DB invoices only'],
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(plRows);
  // Row-level dynamic Gross Profit / Total Expenses / Net Profit formulas for Jan-Oct (rows 4..13)
  for (let r = 4; r <= 13; r++) {
    setFormulaCell(ws2, `J${r}`, `H${r}-I${r}`);
    setFormulaCell(ws2, `K${r}`, `IF(H${r}>0,(J${r}/H${r})*100,0)`, '0.00');
    setFormulaCell(ws2, `N${r}`, `L${r}+M${r}`);
    setFormulaCell(ws2, `S${r}`, `N${r}+O${r}+P${r}+Q${r}+R${r}`);
    setFormulaCell(ws2, `T${r}`, `J${r}-S${r}`);
    setFormulaCell(ws2, `U${r}`, `T${r}+O${r}`);
  }
  for (const col of ['F', 'G', 'H', 'I', 'J', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U']) {
    setFormulaCell(ws2, `${col}14`, `SUM(${col}4:${col}12)`);
    setFormulaCell(ws2, `${col}16`, `${col}14-${col}15`);
    setFormulaCell(ws2, `${col}17`, `SUM(${col}4:${col}13)`);
  }
  setFormulaCell(ws2, 'K14', 'IF(H14>0,(J14/H14)*100,0)', '0.00');
  setFormulaCell(ws2, 'K17', 'IF(H17>0,(J17/H17)*100,0)', '0.00');
  autoFitCols(ws2, plRows);
  XLSX.utils.book_append_sheet(wb, ws2, '02_10M_Monthly_PL');

  // 3. 03_Revenue_Cost_KPIs
  const kpiRows: (string | number | null)[][] = [
    ['REVENUE BREAKDOWN, COST RATIOS, CHANNEL MIX & MENU ENGINEERING KPIs'],
    [],
    ['A. 10M Revenue vs Collections vs Tax Separation'],
    ['Component', '9M Actual (EGP)', 'Oct Live DB (EGP)', '10M Combined (EGP)', 'Share of Net %', 'Audit Status'],
    ['Gross Sales (Incl. VAT)', review.totals9MMonthly.grossSales, review.octoberLive.grossSales, review.totals10MCombined.grossSales, '114.00%', 'CONFIRMED / OCT OPEN'],
    ['Output VAT (14% - GL 2201)', review.totals9MMonthly.vatOutput, review.octoberLive.vatOutput, review.totals10MCombined.vatOutput, '14.00% on Net', 'CONFIRMED / OCT OPEN'],
    ['Net Accounting Revenue (GL 4101)', review.totals9MMonthly.netRevenue, review.octoberLive.netSales, review.totals10MCombined.netRevenue, '100.00%', 'CONFIRMED / OCT OPEN'],
    ['9M Discounts Before Net', 'NOT_CALCULABLE', review.monthlyRows[9].discounts ?? 0, 'NOT_CALCULABLE', '-', '9M summaries are net of discounts; no discount split'],
    ['9M 12% Service Charge Collected', 'NOT_CALCULABLE', 'NOT_CALCULABLE', 'NOT_CALCULABLE', '-', 'Menu includes 12% service rate; historic POS split absent'],
    ['9M Ticket Count & Average Check', 'NOT_CALCULABLE', `${review.octoberLive.invoiceCount} tickets / ${review.octoberLive.invoiceCount > 0 ? round2(review.octoberLive.grossSales / review.octoberLive.invoiceCount) : 0} EGP`, 'PARTIAL', '-', 'Available for live DB invoices only'],
    [],
    ['B. Cost Structure & Efficiency KPIs'],
    ['KPI', 'Actual Value', 'Benchmark / Target', 'Variance / Status'],
    ['Food Cost % (10M Monthly COGS)', `${review.totals10MCombined.foodCostPct}%`, '35.0% Target', 'Exceeds by +6.5 pts'],
    ['Theoretical BOM Mix Cost %', `${review.operations.foodCostTheoreticalPct}%`, '34.0%–35.0%', 'Recipe baseline validated'],
    ['Payroll + Bonus % of Net Revenue', `${review.totals10MCombined.payrollPct}%`, '30.0%–33.0% Target', 'CRITICAL (+23 pts over target; 1.56M bonuses)'],
    ['Prime Cost (Food + Payroll) %', `${review.totals10MCombined.primeCostPct}%`, '≤ 68.0% Industry', 'CRITICAL (>97% leaves zero margin for 5.1M rent)'],
    ['Electricity Cost Growth (Jan → Sep)', `${review.operations.electricityJan} → ${review.operations.electricitySep} EGP`, '+15% seasonal max', `+${review.operations.electricityGrowthPct}% Escalation`],
    ['Monthly Break-Even Net Revenue (9M Cost Base)', `${review.totals10MCombined.monthlyBreakEvenNet} EGP/mo`, '1.70M EGP/mo (2027 Target)', 'Current 9M avg 1.26M/mo falls short'],
    [],
    ['C. Channel & Payment Mix (August 2026 Verified Benchmark) & Day-of-Week Pattern'],
    ['Metric', 'Value', 'Benchmark / Target', 'Notes'],
    ['Takeaway Channel %', `${review.operations.channelMix.takeawayPct}%`, '45%', 'Dominant cash-flow engine'],
    ['Dine-In Channel %', `${review.operations.channelMix.dineInPct}%`, '47%', 'Requires evening & family activation'],
    ['Delivery Channel %', `${review.operations.channelMix.deliveryPct}%`, '8.0% Target', 'Severely under-penetrated (+5.6 pts upside)'],
    ['Cash Payment %', `${review.operations.channelMix.cashPct}%`, '55%', 'High liquidity'],
    ['Visa / Card Payment %', `${review.operations.channelMix.visaPct}%`, '45%', 'Subject to CIB MDR monitoring'],
    ['Weakest Day (Monday Avg)', review.operations.dayOfWeek.mondayAvg, review.operations.dayOfWeek.targetMondayAvg, 'Monday promo opportunity'],
    ['Peak Day (Friday Avg)', review.operations.dayOfWeek.fridayAvg, '60,000+', 'Weekend peak capacity'],
    [],
    ['D. Menu Engineering & Stocktake Variance Summary (>2% Alert)'],
    ['Menu Total SKUs', review.operations.menuTotalItems, '109 Verified', `${review.operations.menuPricedCount} priced / ${review.operations.menuUnspecifiedCount} unspecified`],
    ['Oct-19 Stocktakes Pending (>2%)', stocktake.pendingExceedingCount, '0 Exceeding Target', `Net variance ${stocktake.netVarianceValue} EGP`],
  ];
  const ws3 = XLSX.utils.aoa_to_sheet(kpiRows);
  autoFitCols(ws3, kpiRows);
  XLSX.utils.book_append_sheet(wb, ws3, '03_Revenue_Cost_KPIs');

  // 4. 04_Bank_POS_Recon
  const bankRows: (string | number | null)[][] = [
    ['BANK, POS CLEARING, VAT, TRIAL BALANCE & 1.275M TRANSFER VERIFICATION'],
    [],
    ['A. Core Balance Sheet & Ledger Tie-Outs'],
    ['Control Account / Item', 'Book / GL Balance (EGP)', 'Sub-Ledger / External Statement (EGP)', 'Variance (EGP)', 'Audit Status', 'Audit Finding'],
    ['1101 Main Cash Vault', review.bankAndRecon.cashVault1101, review.bankAndRecon.cashVault1101, 0, 'CONFIRMED', 'Vault band 142k–520k maintained'],
    ['1102 CIB Bank Account', review.bankAndRecon.cibGl1102, review.bankAndRecon.cibStatementEnding, review.bankAndRecon.unmatchedBankVariance, 'PENDING_REVIEW', 'Unmatched BNK-04 May MDR anomaly (-13,000 EGP)'],
    ['1103 VISA/POS Clearing', review.bankAndRecon.clearing1103, 0, 0, 'CONFIRMED', 'Zeroed as of Sep 30 via JV-2026-0005 (incl. 1,276,578.62 Apr 20 note)'],
    ['1201 Raw Material Inventory', review.bankAndRecon.inventoryGl1201, review.bankAndRecon.inventoryPhysicalVal, round2(review.bankAndRecon.inventoryPhysicalVal - review.bankAndRecon.inventoryGl1201), 'CONFIRMED', '14 BOM groups / 333 SKUs / 5 sites tied 100%'],
    ['2101 Suppliers AP', review.bankAndRecon.suppliersGl2101, review.bankAndRecon.suppliersAgingSum, round2(review.bankAndRecon.suppliersAgingSum - review.bankAndRecon.suppliersGl2101), 'CONFIRMED', '8 suppliers aging schedule tied 100%'],
    ['VAT Net Position (2201 Out - 1105 In)', review.bankAndRecon.outputVatGl2201, review.bankAndRecon.inputVatGl1105, review.bankAndRecon.netVatPayableGl, 'CONFIRMED', 'Output VAT minus Input VAT'],
    ['Trial Balance (Total Dr vs Cr)', review.bankAndRecon.trialBalanceDebit, review.bankAndRecon.trialBalanceCredit, round2(review.bankAndRecon.trialBalanceDebit - review.bankAndRecon.trialBalanceCredit), review.bankAndRecon.trialBalanced ? 'CONFIRMED' : 'PENDING_REVIEW', 'Double-entry equilibrium check'],
    [],
    ['B. 1,275,000 EGP Movement & Quarterly Usufruct Verification'],
    ['Item', 'Amount (EGP)', 'Reference', 'Classification Rule', 'Status'],
    ['Quarterly Usufruct Installment Paid', review.bankAndRecon.quarterlyUsufructInstallment, 'EXP-2026-0801 / JE-9M-EXPENSES', 'Usufruct Rent Expense (5202) — Operating Outflow', 'CONFIRMED'],
    ['20 Apr 2026 POS/VISA Settlement Note', review.bankAndRecon.apr20SettlementNote, 'AccountingBankModule Reference', 'Card Clearing Settlement (1103 → 1102) — NOT New Revenue', 'CONFIRMED'],
    ['Inter-Account / Unclassified 1.275M Transfer', 1275000, 'Master Audit Item #11', 'PROHIBITED from Income Statement Revenue until treasury slip verified', 'PENDING_REVIEW'],
    [],
    ['C. Monthly VISA MDR Anomaly Log'],
    ['Month', 'VISA Sales', 'Bank Settled', 'MDR Fee (EGP)', 'MDR %', 'Anomaly Flag', 'Note'],
    ...state.strategy2027.visaMonthlyFees.map((v) => [
      v.labelEn,
      v.visaSales,
      v.bankSettled,
      v.feeAmount,
      v.feePct,
      v.anomaly ? 'ANOMALY (>1.5%)' : 'NORMAL',
      v.noteEn,
    ]),
  ];
  const ws4 = XLSX.utils.aoa_to_sheet(bankRows);
  autoFitCols(ws4, bankRows);
  XLSX.utils.book_append_sheet(wb, ws4, '04_Bank_POS_Recon');

  // 5. 05_Governance_BeforeAfter
  const govRows: (string | number | null)[][] = [
    ['GOVERNANCE, INTERNAL CONTROLS & AUDIT MATRIX (BEFORE VS. AFTER)'],
    [],
    ['ID', 'Control Area (AR)', 'Control Area (EN)', 'Before State', 'After State', 'Verified DB Evidence', 'Audit Status'],
    ...review.governanceMatrix.map((g) => [
      g.id,
      g.areaAr,
      g.areaEn,
      g.beforeStateEn,
      g.afterStateEn,
      g.evidenceEn,
      g.status,
    ]),
  ];
  const ws5 = XLSX.utils.aoa_to_sheet(govRows);
  autoFitCols(ws5, govRows);
  XLSX.utils.book_append_sheet(wb, ws5, '05_Governance_BeforeAfter');

  // 6. 06_Usufruct_Analysis
  const usufructRows: (string | number | null)[][] = [
    ['USUFRUCT CONTRACT ECONOMICS & 80% UNUSED LAND BURDEN ANALYSIS'],
    [],
    ['A. Space Utilization Parameters (Editable Model Inputs)'],
    ['Total Contract Site Area (m²)', review.usufruct.totalSiteSqm, 'Subject to cadastral survey sign-off (PENDING_REVIEW)'],
    ['Current Active Area %', review.usufruct.usedPct / 100, '20% Restaurant & active terrace'],
    ['Current Active Area (m²)', 0, 'Formula: B4*B5'],
    ['Unused Idle Area (m²)', 0, 'Formula: B4-B6'],
    ['Base Annual Usufruct (Yrs 1–5)', review.usufruct.baseAnnualRent, 'EGP/year'],
    ['Current Annual Usufruct (Yrs 6–7, +2%)', review.usufruct.currentAnnualRent, 'EGP/year (Aug 2026 step-up)'],
    ['Quarterly Installment', 0, 'Formula: B9/4'],
    ['Rent Burden per Total m² (Annual)', 0, 'Formula: B9/B4'],
    ['Effective Rent per Active m² (Annual)', 0, 'Formula: B9/B6 (5x penalty from 80% idle area!)'],
    ['Annual Rent Sunk on 80% Idle Area', 0, 'Formula: B9*(1-B5)'],
    ['Monthly Cash Burn on Idle 80% Space', 0, 'Formula: B13/12'],
    ['Contractual Profit Share Clause', '20%', 'Net profit sharing clause once cumulative profits emerge'],
    ['Other Branches Expansion Clause', '+5%', 'Additional contractual uplift clause — verify exact trigger in signed PDF'],
    [],
    ['B. 25-Year Contractual Escalation Schedule'],
    ['Period', 'Escalation %', 'Annual Rent (EGP)', 'Monthly Rent (EGP)', 'Quarterly Installment (EGP)', 'Cumulative Period Cost'],
    ...state.strategy2027.contractEscalation.map((c) => [
      c.years,
      `${c.increasePct}%`,
      c.annualAmountEgp,
      round2(c.annualAmountEgp / 12),
      c.quarterlyInstallmentEgp,
      c.annualAmountEgp,
    ]),
  ];
  const ws6 = XLSX.utils.aoa_to_sheet(usufructRows);
  setFormulaCell(ws6, 'B6', 'B4*B5', '#,##0.00');
  setFormulaCell(ws6, 'B7', 'B4-B6', '#,##0.00');
  setFormulaCell(ws6, 'B10', 'B9/4', '#,##0.00');
  setFormulaCell(ws6, 'B11', 'B9/B4', '#,##0.00');
  setFormulaCell(ws6, 'B12', 'B9/B6', '#,##0.00');
  setFormulaCell(ws6, 'B13', 'B9*(1-B5)', '#,##0.00');
  setFormulaCell(ws6, 'B14', 'B13/12', '#,##0.00');
  ws6['B5'] = { t: 'n', v: review.usufruct.usedPct / 100, z: '0.0%' };
  autoFitCols(ws6, usufructRows);
  XLSX.utils.book_append_sheet(wb, ws6, '06_Usufruct_Analysis');

  // 7. 07_Space_Scenarios_20_60
  const spaceRows: (string | number | null)[][] = [
    ['SPACE EXPANSION SCENARIOS (20% / 30% / 40% / 60% ACTIVE LAND UTILIZATION)'],
    ['Note: Fixed 5.1M Usufruct Rent is already sunk. Incremental space projects are evaluated on Incremental Contribution vs Incremental CAPEX/OPEX (no double-charging rent).'],
    [],
    [
      'Utilization %',
      'Scenario Label (AR)',
      'Scenario Label (EN)',
      'Active Area (m²)',
      'Idle Area (m²)',
      'Allocated Fixed Rent (Used)',
      'Idle Rent Burden Remaining',
      'Rent / Active m² (Annual)',
      'Incremental CAPEX (EGP)',
      'Projected Branch Net Rev (EGP)',
      'Incremental EBITDA (EGP/yr)',
      'Total Branch Net Result (after 5.1M Rent)',
      'Incremental Payback (Yrs)',
    ],
    ...review.usufruct.spaceScenarios.map((sc) => [
      `${sc.utilizationPct}%`,
      sc.labelAr,
      sc.labelEn,
      sc.activeAreaSqm,
      sc.idleAreaSqm,
      sc.rentAllocatedUsedEgp,
      sc.rentBurdenIdleEgp,
      sc.rentPerActiveSqmAnnual,
      sc.incrementalCapexEgp,
      sc.projectedAnnualNetRev,
      sc.projectedAnnualContribution,
      sc.projectedBranchNetResult,
      sc.paybackYears ?? 'N/A',
    ]),
  ];
  const ws7 = XLSX.utils.aoa_to_sheet(spaceRows);
  autoFitCols(ws7, spaceRows);
  XLSX.utils.book_append_sheet(wb, ws7, '07_Space_Scenarios_20_60');

  // 8. 08_Investment_Models
  const invRows: (string | number | null)[][] = [
    ['INVESTMENT OPERATING MODELS EVALUATION (TARGETING 40% UTILIZATION / ~11,912 m² ZONE)'],
    ['Discount Rate (WACC / Hurdle): 22.0% (Egypt CBE corporate capital cost benchmark)'],
    [],
    [
      'Option ID',
      'Model Name (EN)',
      'Model Name (AR)',
      'Legal Condition & Status',
      'Estadat CAPEX (EGP)',
      'Total Zone Revenue Potential',
      'Estadat Share %',
      'Annual Estadat EBITDA (EGP)',
      'Payback (Years)',
      '5-Year NPV @22% (EGP)',
      'IRR %',
      'Annual ROI %',
    ],
    ...review.usufruct.investmentOptions.map((o) => [
      o.id.toUpperCase(),
      o.titleEn,
      o.titleAr,
      `${o.legalStatus} — ${o.legalConditionEn}`,
      o.capexEgp,
      o.annualRevenuePotential,
      `${o.estadatRevenueSharePct}%`,
      o.annualEstadatEbitda,
      o.paybackYears,
      o.fiveYearNpv,
      o.irrPct ?? 'N/A',
      o.roiAnnualPct,
    ]),
  ];
  const ws8 = XLSX.utils.aoa_to_sheet(invRows);
  autoFitCols(ws8, invRows);
  XLSX.utils.book_append_sheet(wb, ws8, '08_Investment_Models');

  // 9. 09_2027_Budget_3_Scen
  const budgetRows: (string | number | null)[][] = [
    ['2027 STRATEGIC BUDGET SCENARIOS & TURNAROUND INITIATIVES'],
    [],
    ['A. 2027 P&L Scenarios Comparison'],
    ['Scenario', 'Net Revenue (EGP)', 'Growth %', 'COGS %', 'COGS (EGP)', 'Payroll (EGP)', 'Usufruct Rent (EGP)', 'Other OpEx + Bank', 'Net Result (EGP)', 'Monthly Break-Even'],
    ...state.strategy2027.scenarios.map((sc) => [
      `${sc.id} — ${sc.nameEn}`,
      sc.netRevenue,
      `${sc.growthPct}%`,
      `${sc.cogsPct}%`,
      round2(sc.netRevenue * (sc.cogsPct / 100)),
      sc.payroll,
      sc.usufructRent,
      sc.otherOpex + sc.bankFees,
      sc.netResult,
      sc.monthlyBreakEven,
    ]),
    [],
    ['B. Scenario C Quarterly Ramp (2027 Target Path toward Q4 Break-Even)'],
    ['Quarter', 'Target Net Revenue', 'Avg Monthly Net Rev', 'COGS (35%)', 'Payroll', 'Usufruct Rent', 'Other OpEx & Bank', 'Projected Net Result'],
    ['Q1 2027 (Winter Ramp)', 3900000, 1300000, 1365000, 1550000, 1275000, 275000, -565000],
    ['Q2 2027 (Spring + Eid)', 4350000, 1450000, 1522500, 1500000, 1275000, 275000, -222500],
    ['Q3 2027 (Summer Peak)', 4450000, 1483333, 1557500, 1475000, 1275000, 275000, -132500],
    ['Q4 2027 (Break-Even Gate)', 5300000, 1766667, 1855000, 1475000, 1275000, 275000, 420000],
    ['Total FY 2027 (Scenario C)', 0, 0, 0, 0, 0, 0, 0],
    [],
    ['C. Strategic Initiatives Budget (700k Total)'],
    ['Code', 'Initiative', 'Target Impact', 'Budget (EGP)', 'Owner', 'Timeline', 'Status'],
    ...state.strategy2027.initiatives.map((i) => [
      i.id,
      i.titleEn,
      i.targetImpactEn,
      i.budgetEgp,
      i.ownerEn,
      i.timeline,
      i.status.toUpperCase(),
    ]),
    ['TOTAL INITIATIVES CAPEX/OPEX', '', '', 0, '', '', ''],
  ];
  const ws9 = XLSX.utils.aoa_to_sheet(budgetRows);
  for (const col of ['B', 'D', 'E', 'F', 'G', 'H']) {
    setFormulaCell(ws9, `${col}13`, `SUM(${col}9:${col}12)`);
  }
  setFormulaCell(ws9, 'C13', 'B13/12');
  setFormulaCell(ws9, 'D24', `SUM(D17:D${16 + state.strategy2027.initiatives.length})`);
  autoFitCols(ws9, budgetRows);
  XLSX.utils.book_append_sheet(wb, ws9, '09_2027_Budget_3_Scen');

  // 10. 10_Risk_Action_90D
  const riskActionRows: (string | number | null)[][] = [
    ['ENTERPRISE RISK REGISTER & 30 / 60 / 90-DAY TURNAROUND PLAN'],
    [],
    ['A. Risk Register (Usufruct & 80% Unused Land Governance)'],
    [
      'Risk ID',
      'Category',
      'Scope / Asset',
      'Risk Description (EN)',
      'Risk Description (AR)',
      'Likelihood',
      'Impact',
      'Corrective Action (EN)',
      'Assigned Owner',
      'Due Date',
      'Status',
      'Financial Exposure (EGP)',
    ],
    ...state.strategy2027.risks.map((r) => [
      r.code || r.id,
      (r.category || 'financial').toUpperCase(),
      r.focusArea === 'unused_space' ? '80% UNUSED LAND' : r.focusArea === 'usufruct' ? 'USUFRUCT CONTRACT' : 'GENERAL OPS',
      r.riskEn,
      r.riskAr,
      r.likelihood.toUpperCase(),
      r.impact.toUpperCase(),
      r.mitigationEn,
      r.ownerEn || r.ownerAr || 'CFO',
      r.dueDate || '2026-12-31',
      (r.status || 'open').toUpperCase(),
      r.financialExposureEgp ?? 0,
    ]),
    [],
    ['B. 30 / 60 / 90-Day Executive Execution Roadmap'],
    ['Horizon', 'Action Code', 'Title (EN)', 'Owner', 'Deliverable', 'KPI Target', 'Priority'],
    ...review.actionPlan90Days.map((a) => [
      a.horizon.toUpperCase(),
      a.code,
      a.titleEn,
      a.ownerEn,
      a.deliverableEn,
      a.kpiTargetEn,
      a.priority.toUpperCase(),
    ]),
  ];
  const ws10 = XLSX.utils.aoa_to_sheet(riskActionRows);
  autoFitCols(ws10, riskActionRows);
  XLSX.utils.book_append_sheet(wb, ws10, '10_Risk_Action_90D');

  // 11. 11_Data_Verification
  const verRows: (string | number | null)[][] = [
    ['AUDIT DATA VERIFICATION LEDGER (ZERO FABRICATION COMPLIANCE)'],
    ['Rule: Every figure in this executive review is tagged CONFIRMED, PENDING_REVIEW, MISSING_DATA, or NOT_CALCULABLE.'],
    [],
    ['Audit ID', 'Domain (EN)', 'Domain (AR)', 'Metric / Scope', 'Reported Value', 'Status Flag', 'Source Reference', 'Audit Note'],
    ...review.verificationLedger.map((v) => [
      v.id,
      v.domainEn,
      v.domainAr,
      v.metricEn,
      v.valueDisplayEn,
      statusText(v.status, 'en'),
      v.sourceRef,
      v.auditNoteEn,
    ]),
  ];
  const ws11 = XLSX.utils.aoa_to_sheet(verRows);
  autoFitCols(ws11, verRows);
  XLSX.utils.book_append_sheet(wb, ws11, '11_Data_Verification');

  return wb;
}

export function exportCfoExcelModel(
  state: ErpState,
  review: CfoExecutiveReviewData,
  lang: Language = 'ar'
): void {
  const wb = buildCfoExcelWorkbook(state, review, lang);
  XLSX.writeFile(wb, 'ESTADAT_Monufia_Tower_CFO_Financial_Investment_Model_2026_2027.xlsx');
}

/**
 * Builds the 15-Slide Widescreen Executive PowerPoint Deck (pptxgenjs).
 */
export function buildCfoPowerPoint(
  state: ErpState,
  review: CfoExecutiveReviewData,
  lang: Language = 'ar'
): PptxGenJS {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.333 x 7.5 in
  pptx.author = 'Tarek Elshafey — Financial Administration';
  pptx.company = 'Estadat Sports Facilities Management';
  pptx.title = 'ESTADAT | MONUFIA TOWER — CFO Executive Review (Jan–Oct 2026) & 2027 Plan';
  pptx.rtlMode = lang === 'ar';

  const C = {
    navy: '0F172A',
    teal: '0F766E',
    tealLight: 'CCFBF1',
    slate: '334155',
    muted: '64748B',
    border: 'CBD5E1',
    bg: 'F8FAFC',
    white: 'FFFFFF',
    red: 'B91C1C',
    redBg: 'FEE2E2',
    amber: 'B45309',
    amberBg: 'FEF3C7',
    green: '15803D',
    greenBg: 'DCFCE7',
  };

  const FONT = lang === 'ar' ? 'Arial' : 'Calibri';

  const addSlideChrome = (slide: PptxGenJS.Slide, slideNum: number, titleAr: string, titleEn: string, tag = 'ESTADAT | MONUFIA TOWER') => {
    slide.background = { color: C.bg };
    // Top bar
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 0.78, fill: { color: C.navy } });
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0.78, w: 13.333, h: 0.05, fill: { color: C.teal } });
    slide.addText(lang === 'ar' ? titleAr : titleEn, {
      x: 0.5,
      y: 0.14,
      w: 9.2,
      h: 0.5,
      fontFace: FONT,
      fontSize: 18,
      bold: true,
      color: C.white,
      align: lang === 'ar' ? 'right' : 'left',
    });
    slide.addText(tag, {
      x: 9.8,
      y: 0.2,
      w: 3.0,
      h: 0.35,
      fontFace: FONT,
      fontSize: 10,
      bold: true,
      color: C.tealLight,
      align: 'right',
    });
    // Footer
    slide.addShape(pptx.ShapeType.line, { x: 0.5, y: 7.08, w: 12.333, h: 0, line: { color: C.border, width: 0.75 } });
    slide.addText(lang === 'ar' ? review.preparedByAr : review.preparedByEn, {
      x: 0.5,
      y: 7.13,
      w: 7.5,
      h: 0.28,
      fontFace: FONT,
      fontSize: 9,
      color: C.muted,
      align: lang === 'ar' ? 'right' : 'left',
    });
    slide.addText(`${slideNum} / 15`, {
      x: 11.4,
      y: 7.13,
      w: 1.4,
      h: 0.28,
      fontFace: FONT,
      fontSize: 9,
      bold: true,
      color: C.slate,
      align: 'right',
    });
  };

  const addKpiBox = (
    slide: PptxGenJS.Slide,
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    value: string,
    sub: string,
    accentHex = C.teal
  ) => {
    slide.addShape(pptx.ShapeType.roundRect, {
      x,
      y,
      w,
      h,
      rectRadius: 0.06,
      fill: { color: C.white },
      line: { color: C.border, width: 1 },
    });
    slide.addShape(pptx.ShapeType.rect, { x, y, w, h: 0.06, fill: { color: accentHex } });
    slide.addText(label, { x: x + 0.14, y: y + 0.12, w: w - 0.28, h: 0.28, fontFace: FONT, fontSize: 9.5, color: C.muted, bold: true });
    slide.addText(value, { x: x + 0.14, y: y + 0.4, w: w - 0.28, h: 0.42, fontFace: FONT, fontSize: 16, bold: true, color: C.navy });
    slide.addText(sub, { x: x + 0.14, y: y + 0.86, w: w - 0.28, h: 0.34, fontFace: FONT, fontSize: 8.5, color: C.slate });
  };

  const fmtN = (v: number) => Math.round(v).toLocaleString('en-US');
  const toRow = (...cells: (string | number)[]): PptxGenJS.TableRow =>
    cells.map((v) => ({ text: String(v ?? '') }));

  // SLIDE 1: Cover
  {
    const s = pptx.addSlide();
    s.background = { color: C.navy };
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.35, h: 7.5, fill: { color: C.teal } });
    s.addText('ESTADAT | MONUFIA TOWER', {
      x: 0.9,
      y: 1.0,
      w: 11.4,
      h: 0.45,
      fontFace: FONT,
      fontSize: 15,
      bold: true,
      color: C.tealLight,
    });
    s.addText(
      lang === 'ar'
        ? 'استراتيجية تعظيم العائد لبرج المنوفية 2027\nالمراجعة التنفيذية للمدير المالي (CFO) والإدارة العليا'
        : 'MONUFIA TOWER 2027 VALUE MAXIMIZATION STRATEGY\nCFO EXECUTIVE REVIEW & INVESTMENT PLAN',
      {
        x: 0.9,
        y: 1.65,
        w: 11.4,
        h: 1.5,
        fontFace: FONT,
        fontSize: 28,
        bold: true,
        color: C.white,
      }
    );
    s.addText(
      lang === 'ar'
        ? 'تحليل الأداء المالي (10 أشهر: يناير – أكتوبر 2026)  |  خطة استغلال الـ 80% فراغ  |  قرارات CFO الفورية'
        : '10M Performance Analysis (Jan – Oct 2026)  |  80% Idle Land Monetization  |  Immediate CFO Decisions',
      {
        x: 0.9,
        y: 3.45,
        w: 11.4,
        h: 0.55,
        fontFace: FONT,
        fontSize: 14,
        color: 'CBD5E1',
      }
    );
    s.addShape(pptx.ShapeType.roundRect, {
      x: 0.9,
      y: 4.55,
      w: 11.4,
      h: 1.7,
      rectRadius: 0.08,
      fill: { color: '1E293B' },
      line: { color: C.teal, width: 1.2 },
    });
    s.addText(
      lang === 'ar'
        ? `إعداد: ${review.preparedByAr}\nالتصنيف المحاسبي: تدقيق قائم على الأدلة (CONFIRMED / PENDING_REVIEW / MISSING_DATA)\nتاريخ الإصدار: ${review.generatedAt}`
        : `Prepared by: ${review.preparedByEn}\nMethodology: Evidence-Grounded Audit (CONFIRMED / PENDING_REVIEW / MISSING_DATA)\nIssue Date: ${review.generatedAt}`,
      {
        x: 1.2,
        y: 4.75,
        w: 10.8,
        h: 1.3,
        fontFace: FONT,
        fontSize: 12,
        color: C.white,
      }
    );
  }

  // SLIDE 2: Executive Summary & 5 Strategic Questions
  {
    const s = pptx.addSlide();
    addSlideChrome(s, 2, 'الملخص التنفيذي والإجابة على الأسئلة الاستراتيجية الخمسة', 'Executive Summary & The 5 Strategic Questions');
    const qRows: PptxGenJS.TableRow[] = [
      [
        { text: lang === 'ar' ? 'السؤال الاستراتيجي' : 'Strategic Question', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: lang === 'ar' ? 'الخلاصة التنفيذية المدعومة بالأدلة' : 'Evidence-Based Executive Answer', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: lang === 'ar' ? 'الحالة' : 'Status', options: { bold: true, fill: { color: C.navy }, color: C.white } },
      ],
      toRow(
        lang === 'ar' ? '1. حقيقة الأداء المالي (10 أشهر)' : '1. True 10M Financial Performance',
        lang === 'ar'
          ? `صافي إيراد 9M: 11.34م ج (خسارة -4.16م ج شهري / -4.10م GL؛ فرق 65 ألف COGS). صافي الربح قبل حق الانتفاع = -398 ألف ج فقط. أكتوبر غير مغلق (${review.octoberLive.invoiceCount} فواتير مباشرة).`
          : `9M Net Rev 11.34M EGP (-4.16M monthly / -4.10M GL; 65k COGS gap). Ex-Usufruct loss is only -398k EGP! Oct open (${review.octoberLive.invoiceCount} live DB invoices).`,
        'CONFIRMED / OCT OPEN'
      ),
      toRow(
        lang === 'ar' ? '2. حجم التحسن الرقابي' : '2. Governance & Control Gains',
        lang === 'ar'
          ? 'تصفير تسوية فيزا 1103 (0.00 ج)؛ رصد عمولة مايو 3.52%؛ مطابقة مخزون 511.7 ألف وموردين 2.15م 100%؛ اتزان ميزان المراجعة ووصفات 109 صنف. أرقام 2025 غير مرفقة.'
          : 'Zeroed 1103 VISA clearing; caught May 3.52% MDR fee; 511.7k inventory & 2.15M AP 100% tied; balanced TB & 109 BOM recipes. 2025 baseline missing.',
        'CONFIRMED / 2025 MISSING'
      ),
      toRow(
        lang === 'ar' ? '3. المخاطر والفجوات القائمة' : '3. Remaining Risks & Gaps',
        lang === 'ar'
          ? 'تضخم الرواتب والمنح (56.1% / 1.56م منح)؛ قفزة الكهرباء +234%؛ فرق بنكي 13 ألف؛ التحويل 1.275م قيد التدقيق؛ 4 أصناف جرد >2% (-8,505 ج).'
          : 'Payroll 56.1% (1.56M bonuses); Electricity +234%; -13k CIB gap; 1.275M movement pending audit; 4 Oct-19 stocktakes >2% (-8,505 EGP).',
        'PENDING_REVIEW'
      ),
      toRow(
        lang === 'ar' ? '4. استغلال 80% فراغ حق الانتفاع' : '4. Monetizing 80% Idle Space',
        lang === 'ar'
          ? `المطعم يشغل 20% (${fmtN(review.usufruct.usedSqm)} م²) ويتحمل إيجار 5.1م كاملاً (4.08م/سنة عبء مهدر). التوسع إلى 30–40% يولد +1.95م إلى +5.7م EBITDA.`
          : `Active 20% (${fmtN(review.usufruct.usedSqm)} m²) absorbs full 5.1M rent (4.08M/yr idle burden). Phased JV expansion adds +1.95M–5.7M EBITDA.`,
        'SURVEY NEEDED'
      ),
      toRow(
        lang === 'ar' ? '5. قرارات واستثمارات 2027' : '5. Key 2027 Decisions & ROI',
        lang === 'ar'
          ? 'اعتماد سيناريو ج (18.0م إيراد / تعادل Q4 عند 1.70م/شهر) + تجميد المنح + طرح المرحلة 1 بنظام JV (2.2م CAPEX / استرداد ~1.13 سنة).'
          : 'Approve Scenario C (18.0M rev / Q4 break-even at 1.70M/mo) + freeze unlinked bonuses + award Phase-1 JV (2.2M CAPEX, ~1.13 yr payback).',
        'STRATEGIC PLAN'
      ),
    ];
    s.addTable(qRows, {
      x: 0.5,
      y: 1.05,
      w: 12.33,
      colW: [3.2, 7.13, 2.0],
      fontSize: 10,
      fontFace: FONT,
      border: { type: 'solid', color: C.border, pt: 0.75 },
      valign: 'middle',
      rowH: 1.05,
    });
  }

  // SLIDE 3: Financial Performance Overview (Jan–Oct 2026)
  {
    const s = pptx.addSlide();
    addSlideChrome(s, 3, 'نظرة شاملة على الأداء المالي (يناير – أكتوبر 2026)', 'Financial Performance Overview (Jan–Oct 2026)');
    addKpiBox(s, 0.5, 1.05, 2.9, 1.25, lang === 'ar' ? 'صافي الإيراد (10M في القاعدة)' : '10M Net Revenue (In DB)', `${fmtN(review.totals10MCombined.netRevenue)} EGP`, `9M: ${fmtN(review.totals9MMonthly.netRevenue)} | Oct Live: ${fmtN(review.octoberLive.netSales)}`, C.teal);
    addKpiBox(s, 3.6, 1.05, 2.9, 1.25, lang === 'ar' ? 'مجمل الربح والهامش' : 'Gross Profit & Margin', `${fmtN(review.totals10MCombined.grossProfit)} EGP`, `GP Margin: ${review.totals10MCombined.gpMarginPct}% (Food Cost: ${review.totals10MCombined.foodCostPct}%)`, C.green);
    addKpiBox(s, 6.7, 1.05, 2.9, 1.25, lang === 'ar' ? 'النتيجة قبل حق الانتفاع' : 'Operating Result Ex-Rent', `${fmtN(review.totals10MCombined.netProfitExRent)} EGP`, lang === 'ar' ? 'أقرب للتعادل التشغيلي بدون الإيجار' : 'Near breakeven ex-usufruct rent', C.amber);
    addKpiBox(s, 9.8, 1.05, 3.03, 1.25, lang === 'ar' ? 'صافي خسارة الفترة (10M)' : '10M Combined Net Loss', `${fmtN(review.totals10MCombined.netProfit)} EGP`, `9M GL: ${fmtN(review.totals9MMonthly.netProfitGl)} | 65k COGS diff`, C.red);

    const chartLabels = review.monthlyRows.slice(0, 9).map((m) => m.monthKey.replace('2026-', 'M'));
    s.addChart(
      pptx.ChartType.bar,
      [
        { name: lang === 'ar' ? 'صافي الإيراد' : 'Net Revenue', labels: chartLabels, values: review.monthlyRows.slice(0, 9).map((m) => Math.round(m.netSales / 1000)) },
        { name: lang === 'ar' ? 'صافي الخسارة' : 'Net Loss', labels: chartLabels, values: review.monthlyRows.slice(0, 9).map((m) => Math.round(m.netProfit / 1000)) },
      ],
      {
        x: 0.5,
        y: 2.5,
        w: 7.4,
        h: 4.3,
        barGrouping: 'clustered',
        chartColors: [C.teal, C.red],
        showTitle: true,
        title: lang === 'ar' ? 'تطور صافي الإيراد مقابل صافي الربح (بالألف ج.م — يناير إلى سبتمبر)' : 'Jan–Sep Net Revenue vs Net Profit (k EGP)',
        showLegend: true,
        legendPos: 'b',
      }
    );

    const octBoxRows: PptxGenJS.TableRow[] = [
      [{ text: lang === 'ar' ? 'حالة أكتوبر 2026 (بيان ناقص)' : 'October 2026 Live Status (MISSING_DATA)', options: { bold: true, fill: { color: C.amber }, color: C.white, colspan: 2 } }],
      toRow(lang === 'ar' ? 'فواتير البيع المباشرة' : 'Live Sales Invoices', `${review.octoberLive.invoiceCount} (${fmtN(review.octoberLive.grossSales)} EGP Gross)`),
      toRow(lang === 'ar' ? 'فواتير المشتريات' : 'Live Purchase POs', `${review.octoberLive.purchaseCount} (${fmtN(review.octoberLive.purchasesGross)} EGP)`),
      toRow(lang === 'ar' ? 'قيود الرواتب / الكهرباء' : 'Oct Payroll / Utilities', lang === 'ar' ? 'غير مسجلة بعد (MISSING_DATA)' : '0.00 (Not Posted Yet)'),
      toRow(lang === 'ar' ? 'سياسة التقرير' : 'Reporting Rule', lang === 'ar' ? 'ممنوع التكرار أو التقدير' : 'Zero extrapolation or duplication'),
    ];
    s.addTable(octBoxRows, {
      x: 8.1,
      y: 2.5,
      w: 4.73,
      colW: [2.2, 2.53],
      fontSize: 9.5,
      fontFace: FONT,
      border: { type: 'solid', color: C.border, pt: 0.75 },
      rowH: 0.72,
    });
  }

  // SLIDE 4: Revenue vs VAT vs Collections & Channel Mix
  {
    const s = pptx.addSlide();
    addSlideChrome(s, 4, 'الإيرادات مقابل الضريبة والتحصيل ومزيج القنوات', 'Revenue vs VAT vs Collections & Channel Mix');
    const tbl: PptxGenJS.TableRow[] = [
      [
        { text: lang === 'ar' ? 'البند المحاسبي' : 'Revenue Component', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: '9M Actual (EGP)', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: 'Oct Live DB', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: 'Status', options: { bold: true, fill: { color: C.navy }, color: C.white } },
      ],
      toRow(lang === 'ar' ? 'إجمالي المبيعات (شامل 14%)' : 'Gross Sales (incl. 14% VAT)', fmtN(review.totals9MMonthly.grossSales), fmtN(review.octoberLive.grossSales), 'CONFIRMED / OCT OPEN'),
      toRow(lang === 'ar' ? 'ضريبة القيمة المضافة 14% (2201)' : 'Output VAT 14% (GL 2201)', fmtN(review.totals9MMonthly.vatOutput), fmtN(review.octoberLive.vatOutput), 'CONFIRMED / OCT OPEN'),
      toRow(lang === 'ar' ? 'الإيراد المحاسبي الصافي (4101)' : 'Net Accounting Revenue (4101)', fmtN(review.totals9MMonthly.netRevenue), fmtN(review.octoberLive.netSales), 'CONFIRMED / OCT OPEN'),
      toRow(lang === 'ar' ? 'الخصومات ورسوم 12% خدمة وعدد الشيكات' : '9M Discounts, 12% Service & Tickets', 'NOT_CALCULABLE', `${review.octoberLive.invoiceCount} live tickets`, 'NOT_CALCULABLE (9M)'),
    ];
    s.addTable(tbl, { x: 0.5, y: 1.05, w: 12.33, colW: [4.2, 2.7, 2.7, 2.73], fontSize: 10.5, fontFace: FONT, border: { type: 'solid', color: C.border, pt: 0.75 }, rowH: 0.52 });

    s.addChart(
      pptx.ChartType.pie,
      [
        {
          name: 'Channels',
          labels: ['Takeaway', 'Dine-In', 'Delivery'],
          values: [review.operations.channelMix.takeawayPct, review.operations.channelMix.dineInPct, review.operations.channelMix.deliveryPct],
        },
      ],
      {
        x: 0.5,
        y: 3.9,
        w: 5.8,
        h: 2.95,
        showTitle: true,
        title: lang === 'ar' ? 'مزيج القنوات (أغسطس %)' : 'Channel Mix (% Revenue)',
        chartColors: [C.teal, C.navy, C.amber],
        showLegend: true,
        legendPos: 'r',
      }
    );

    addKpiBox(s, 6.6, 3.95, 2.95, 1.35, lang === 'ar' ? 'تحصيل الكاش مقابل الفيزا' : 'Cash vs VISA Split', `${review.operations.channelMix.cashPct}% / ${review.operations.channelMix.visaPct}%`, lang === 'ar' ? 'تفوق السيولة النقدية الفورية' : 'Healthy immediate cash mix', C.teal);
    addKpiBox(s, 9.75, 3.95, 3.08, 1.35, lang === 'ar' ? 'فرصة التوصيل الضائعة' : 'Delivery Upside', `${review.operations.channelMix.deliveryPct}% → 8.0%`, lang === 'ar' ? 'نمو ضعيف جداً يتطلب تفعيل Foodics/طلبات' : 'Severely under-penetrated channel', C.amber);
    addKpiBox(s, 6.6, 5.45, 6.23, 1.35, lang === 'ar' ? 'معدل التعادل الشهري الحالي مقابل المستهدف' : 'Current vs Target Monthly Break-Even', `${fmtN(review.totals10MCombined.monthlyBreakEvenNet)} → 1,700,000 EGP/mo`, lang === 'ar' ? 'المتوسط الشهري 9M = 1.26م ج (فجوة تعادل واضحة)' : '9M avg = 1.26M EGP/mo (requires Payroll & COGS fix)', C.red);
  }

  // SLIDE 5: Cost Structure Analysis
  {
    const s = pptx.addSlide();
    addSlideChrome(s, 5, 'تحليل هيكل التكاليف: فجوة 65 ألف، الرواتب والمنح، والكهرباء', 'Cost Structure: 65k COGS Gap, Payroll & Electricity');
    const costTbl: PptxGenJS.TableRow[] = [
      [
        { text: lang === 'ar' ? 'عنصر التكلفة' : 'Cost Item', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: '9M Actual (EGP)', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: '% of 9M Net Rev', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: 'Audit Diagnosis', options: { bold: true, fill: { color: C.navy }, color: C.white } },
      ],
      toRow(lang === 'ar' ? 'تكلفة المبيعات COGS (شهري / GL)' : 'COGS (Monthly / GL 5101)', `${fmtN(review.totals9MMonthly.cogsMonthlySum)} / ${fmtN(review.totals9MMonthly.cogsGl5101)}`, '41.5% / 41.0%', lang === 'ar' ? 'فارق 65,000 ج PENDING_REVIEW + أعلى من هدف 35%' : '65k gap PENDING_REVIEW; 6 pts above 35% target'),
      toRow(lang === 'ar' ? 'الأجور الأساسية (5201)' : 'Base Payroll (5201)', fmtN(review.totals9MMonthly.payrollBase), '42.3%', lang === 'ar' ? 'تضخم هيكلي مقارنة بحجم المبيعات الحالي' : 'High fixed staffing vs current sales'),
      toRow(lang === 'ar' ? 'المنح والحوافز (دفعات متقطعة)' : 'Bonus & Grant Batches', fmtN(review.totals9MMonthly.payrollBonuses), '13.8%', lang === 'ar' ? 'صرفت رغم الخسائر (أغسطس 561k + فبراير/مايو)' : 'Paid despite net losses (Aug 561k peak)'),
      toRow(lang === 'ar' ? 'حق الانتفاع (5202)' : 'Usufruct Rent (5202)', fmtN(review.totals9MMonthly.usufructRent), '33.2%', lang === 'ar' ? 'قفز +2% في أغسطس من 416.7k إلى 425k/شهر' : '+2% escalation Aug 2026 (5.0M → 5.1M/yr)'),
      toRow(lang === 'ar' ? 'الكهرباء والمرافق' : 'Electricity & Utilities', fmtN(review.totals9MMonthly.electricity), '2.1%', lang === 'ar' ? `تصاعد حاد +${review.operations.electricityGrowthPct}% (12.9k يناير → 43.1k سبتمبر)` : `+${review.operations.electricityGrowthPct}% spike (Jan 12.9k → Sep 43.1k)`),
      toRow(lang === 'ar' ? 'مصروفات إدارية + عمولات بنكية صافية' : 'Other OpEx + Net Bank Fees', fmtN(review.totals9MMonthly.otherOpex + review.totals9MMonthly.bankFeesNet), '3.7%', lang === 'ar' ? 'يشمل قفزة MDR مايو 3.52% (18.5k)' : 'Includes May 3.52% VISA MDR anomaly'),
    ];
    s.addTable(costTbl, { x: 0.5, y: 1.05, w: 12.33, colW: [3.2, 2.7, 1.5, 4.93], fontSize: 10, fontFace: FONT, border: { type: 'solid', color: C.border, pt: 0.75 }, rowH: 0.75 });
  }

  // SLIDE 6: Bank, POS & 1.275M Verification
  {
    const s = pptx.addSlide();
    addSlideChrome(s, 6, 'التسويات البنكية ونقاط البيع والتحقق من 1.275 مليون', 'Bank, POS Clearing & 1.275M Transfer Verification');
    addKpiBox(s, 0.5, 1.05, 2.9, 1.2, 'GL 1103 (VISA Clearing)', `${fmtN(review.bankAndRecon.clearing1103)} EGP`, 'CONFIRMED (Zeroed Sep 30)', C.green);
    addKpiBox(s, 3.6, 1.05, 2.9, 1.2, 'CIB GL vs Statement', `${fmtN(review.bankAndRecon.unmatchedBankVariance)} EGP`, 'BNK-04 May MDR Anomaly (PENDING)', C.red);
    addKpiBox(s, 6.7, 1.05, 2.9, 1.2, 'GL 1201 vs Physical', `${fmtN(review.bankAndRecon.inventoryPhysicalVal)} EGP`, '100% Tied (0 Variance)', C.green);
    addKpiBox(s, 9.8, 1.05, 3.03, 1.2, 'Trial Balance Equilibrium', 'BALANCED', `Dr=Cr=${fmtN(review.bankAndRecon.trialBalanceDebit)} EGP`, C.green);

    const reconTbl: PptxGenJS.TableRow[] = [
      [
        { text: lang === 'ar' ? 'بند التدقيق' : 'Audit Subject', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: lang === 'ar' ? 'النتيجة الدفترية / المستندية' : 'Verified Finding', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: lang === 'ar' ? 'القرار المحاسبي' : 'Control Rule', options: { bold: true, fill: { color: C.navy }, color: C.white } },
      ],
      toRow(
        lang === 'ar' ? 'قسط حق الانتفاع الربع سنوي' : 'Usufruct Quarterly Installment',
        '1,275,000 EGP (EXP-2026-0801)',
        lang === 'ar' ? 'مؤكد كمصروف انتفاع (5202) — تدفق خارج' : 'CONFIRMED Expense (5202) — Cash Outflow'
      ),
      toRow(
        lang === 'ar' ? 'تسوية فيزا 20 أبريل (1.276م)' : '20 Apr POS/VISA Settlement',
        '1,276,578.62 EGP (1103 → 1102)',
        lang === 'ar' ? 'تسوية تحصيل بطاقات مسجلة مسبقاً (ليس إيراداً جديداً)' : 'Clearing settlement (1103 → 1102), NOT new revenue'
      ),
      toRow(
        lang === 'ar' ? 'التحويل المالي 1.275م غير المصنف' : '1.275M Inter-Account Movement',
        'PENDING_REVIEW (No separate transfer doc)',
        lang === 'ar' ? 'محظور نهائياً إدراجه كإيراد حتى إرفاق مستند التحويل' : 'Strictly excluded from P&L Revenue pending treasury voucher'
      ),
      toRow(
        lang === 'ar' ? 'عمولة مايو البنكية 3.52%' : 'May VISA MDR 3.52% Overcharge',
        '18,500 EGP vs ~1.06% baseline (-13,000 EGP BNK-04)',
        lang === 'ar' ? 'إصدار مطالبة استرداد لبنك CIB خلال 15 يوماً' : 'File CIB refund claim within 15 days'
      ),
    ];
    s.addTable(reconTbl, { x: 0.5, y: 2.5, w: 12.33, colW: [3.4, 4.4, 4.53], fontSize: 10.5, fontFace: FONT, border: { type: 'solid', color: C.border, pt: 0.75 }, rowH: 0.92 });
  }

  // SLIDE 7: Governance & Operational Controls (Before vs After)
  {
    const s = pptx.addSlide();
    addSlideChrome(s, 7, 'تقييم الحوكمة والرقابة التشغيلية (قبل مقابل بعد)', 'Governance & Internal Controls (Before vs. After)');
    const gTbl: PptxGenJS.TableRow[] = [
      [
        { text: lang === 'ar' ? 'مجال الرقابة' : 'Control Area', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: lang === 'ar' ? 'الوضع قبل التطوير' : 'Before State', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: lang === 'ar' ? 'الوضع بعد التطوير (الأدلة الحالية)' : 'After State (Verified Evidence)', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: 'Status', options: { bold: true, fill: { color: C.navy }, color: C.white } },
      ],
      ...review.governanceMatrix.map((g) =>
        toRow(
          lang === 'ar' ? g.areaAr : g.areaEn,
          lang === 'ar' ? g.beforeStateAr : g.beforeStateEn,
          lang === 'ar' ? g.afterStateAr : g.afterStateEn,
          g.status
        )
      ),
    ];
    s.addTable(gTbl, { x: 0.5, y: 1.05, w: 12.33, colW: [2.7, 3.2, 4.73, 1.7], fontSize: 9.5, fontFace: FONT, border: { type: 'solid', color: C.border, pt: 0.75 }, rowH: 1.02 });
  }

  // SLIDE 8: Operational Performance & KPIs
  {
    const s = pptx.addSlide();
    addSlideChrome(s, 8, 'الأداء التشغيلي ومؤشرات التكاليف والجرد الفعلي', 'Operational Performance, Menu BOM & Stocktake Variance');
    addKpiBox(s, 0.5, 1.05, 2.9, 1.25, lang === 'ar' ? 'تكلفة الغذاء الفعلية مقابل النظرية' : 'Actual vs Theoretical Food Cost', `${review.operations.foodCostActualPct}% vs ${review.operations.foodCostTheoreticalPct}%`, `+${review.operations.foodCostVariancePct}% gap (>5% threshold)`, C.red);
    addKpiBox(s, 3.6, 1.05, 2.9, 1.25, lang === 'ar' ? 'فجوة الجرد الفعلي (>2%)' : 'Oct-19 Stocktakes >2%', `${review.operations.stocktakeExceedingCount} SKUs Pending`, `Net impact: ${fmtN(review.operations.stocktakeNetVarianceEgp)} EGP`, C.amber);
    addKpiBox(s, 6.7, 1.05, 2.9, 1.25, lang === 'ar' ? 'تغطية المنيو والأسعار' : 'Menu Pricing Governance', `${review.operations.menuPricedCount} / ${review.operations.menuTotalItems} SKUs`, `${review.operations.menuUnspecifiedCount} unspecified SKUs require pricing`, C.teal);
    addKpiBox(s, 9.8, 1.05, 3.03, 1.25, lang === 'ar' ? 'تذبذب الإثنين مقابل الجمعة' : 'Mon vs Fri Revenue Gap', `${fmtN(review.operations.dayOfWeek.mondayAvg)} vs ${fmtN(review.operations.dayOfWeek.fridayAvg)}`, `Monday target: ${fmtN(review.operations.dayOfWeek.targetMondayAvg)} EGP/day`, C.navy);

    const stocktake = computeStocktakeVarianceAlerts(state, 2);
    const stTbl: PptxGenJS.TableRow[] = [
      [
        { text: 'SKU', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: lang === 'ar' ? 'الصنف المخزني' : 'Ingredient', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: lang === 'ar' ? 'الدفتري' : 'Book Qty', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: lang === 'ar' ? 'الفعلي' : 'Actual Qty', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: lang === 'ar' ? 'الانحراف %' : 'Var %', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: lang === 'ar' ? 'الأثر المالي' : 'Value Impact', options: { bold: true, fill: { color: C.navy }, color: C.white } },
      ],
      ...stocktake.items.slice(0, 6).map((item) =>
        toRow(
          item.entry.sku,
          lang === 'ar' ? item.entry.ingredientNameAr : item.entry.ingredientNameEn,
          `${item.liveBookQty} ${item.entry.unit}`,
          `${item.entry.actualQty} ${item.entry.unit}`,
          `${item.signedVariancePct >= 0 ? '+' : ''}${item.signedVariancePct}%`,
          `${fmtN(item.varianceValue)} EGP`
        )
      ),
    ];
    s.addTable(stTbl, { x: 0.5, y: 2.55, w: 12.33, colW: [1.5, 3.83, 1.7, 1.7, 1.6, 2.0], fontSize: 10, fontFace: FONT, border: { type: 'solid', color: C.border, pt: 0.75 }, rowH: 0.56 });
  }

  // SLIDE 9: Usufruct Contract Economic Analysis
  {
    const s = pptx.addSlide();
    addSlideChrome(s, 9, 'التحليل الاقتصادي لعقد حق الانتفاع (25 عاماً)', 'Usufruct Contract Economic Analysis (25-Year Term)');
    addKpiBox(s, 0.5, 1.05, 2.9, 1.2, lang === 'ar' ? 'المقابل السنوي الحالي' : 'Active Annual Usufruct', `${fmtN(review.usufruct.currentAnnualRent)} EGP`, 'Up +2% from 5.0M in Aug 2026', C.navy);
    addKpiBox(s, 3.6, 1.05, 2.9, 1.2, lang === 'ar' ? 'القسط الربع سنوي' : 'Quarterly Installment', `${fmtN(review.usufruct.quarterlyInstallment)} EGP`, 'Cash liquidity crunch trigger', C.red);
    addKpiBox(s, 6.7, 1.05, 2.9, 1.2, lang === 'ar' ? 'حصة المحافظة بالأرباح' : 'Profit-Share Clause', '20% Net Profit', '+5% Other Branches trigger', C.amber);
    addKpiBox(s, 9.8, 1.05, 3.03, 1.2, lang === 'ar' ? 'إيجار المتر المربع الكلي' : 'Contract Rent / Total m²', `${review.usufruct.rentPerTotalSqmAnnual} EGP/m²/yr`, `Effective on 20% used: ${review.usufruct.rentBurdenOnUsedSqmAnnual} EGP/m²`, C.red);

    const escTbl: PptxGenJS.TableRow[] = [
      [
        { text: lang === 'ar' ? 'المرحلة التعاقدية' : 'Contract Period', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: 'Escalation', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: 'Annual Rent (EGP)', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: 'Monthly Burden', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: 'Quarterly Cash', options: { bold: true, fill: { color: C.navy }, color: C.white } },
      ],
      ...state.strategy2027.contractEscalation.map((c) =>
        toRow(
          c.years,
          `+${c.increasePct}%`,
          fmtN(c.annualAmountEgp),
          fmtN(c.annualAmountEgp / 12),
          fmtN(c.quarterlyInstallmentEgp)
        )
      ),
    ];
    s.addTable(escTbl, { x: 0.5, y: 2.5, w: 12.33, colW: [3.8, 1.5, 2.4, 2.3, 2.33], fontSize: 10.5, fontFace: FONT, border: { type: 'solid', color: C.border, pt: 0.75 }, rowH: 0.65 });
  }

  // SLIDE 10: Space Utilization Diagnosis (20% vs 80%)
  {
    const s = pptx.addSlide();
    addSlideChrome(s, 10, 'تشخيص كفاءة استغلال المساحات: 20% مستغل مقابل 80% فراغ', 'Space Utilization Diagnosis: 20% Active vs 80% Idle Land');
    addKpiBox(s, 0.5, 1.05, 3.85, 1.3, lang === 'ar' ? 'إجمالي المساحة الكلية' : 'Total Site Area', `${fmtN(review.usufruct.totalSiteSqm)} m²`, 'PENDING_REVIEW (Survey confirmation)', C.navy);
    addKpiBox(s, 4.55, 1.05, 3.85, 1.3, lang === 'ar' ? 'المساحة المستغلة حالياً (20%)' : 'Active Restaurant Space (20%)', `${fmtN(review.usufruct.usedSqm)} m²`, `Carries ${review.usufruct.rentBurdenOnUsedSqmAnnual} EGP/m² effective rent`, C.teal);
    addKpiBox(s, 8.6, 1.05, 4.23, 1.3, lang === 'ar' ? 'المساحة الفارغة (80%) وعبئها' : '80% Unused Land & Dead Rent', `${fmtN(review.usufruct.unusedSqm)} m²`, `${fmtN(review.usufruct.rentBurdenOnUnusedSpaceAnnual)} EGP/yr (${fmtN(review.usufruct.rentBurdenOnUnusedSpaceMonthly)}/mo) wasted`, C.red);

    s.addChart(
      pptx.ChartType.doughnut,
      [
        {
          name: 'Land Rent Burden',
          labels: [lang === 'ar' ? '20% مستغل (1.02م ج)' : '20% Active (1.02M)', lang === 'ar' ? '80% فراغ مهدر (4.08م ج)' : '80% Idle Burden (4.08M)'],
          values: [review.usufruct.usedPct, review.usufruct.unusedPct],
        },
      ],
      {
        x: 0.5,
        y: 2.6,
        w: 5.2,
        h: 4.1,
        showTitle: true,
        title: lang === 'ar' ? 'توزيع عبء إيجار 5.1 مليون ج سنوياً' : '5.1M Annual Rent Allocation',
        chartColors: [C.teal, C.red],
        showLegend: true,
        legendPos: 'b',
      }
    );

    const zoningTbl: PptxGenJS.TableRow[] = [
      [{ text: lang === 'ar' ? 'مقترح التطوير التدريجي للـ 80% فراغ (~23,825 م²)' : 'Phased Activation Roadmap for 80% Idle Space', options: { bold: true, fill: { color: C.navy }, color: C.white, colspan: 2 } }],
      toRow(lang === 'ar' ? 'منطقة 1 (+10% = 2,978 م²)' : 'Zone 1 (+10% / 2,978 m²)', lang === 'ar' ? 'كافيهات وحديقة عائلات + قاعات مناسبات مفتوحة (قليلة الكابكس)' : 'Family Garden Terrace & Open Events Pavilion (Low CAPEX)'),
      toRow(lang === 'ar' ? 'منطقة 2 (+10% = 2,978 م²)' : 'Zone 2 (+10% / 2,978 m²)', lang === 'ar' ? 'ملاعب بادل/أكاديمية رياضية ومنطقة ألعاب أطفال + أكشاك' : 'Padel Courts / Sports Academy + Kids Zone & Retail Kiosks'),
      toRow(lang === 'ar' ? 'منطقة 3 (+20% = 5,956 م²)' : 'Zone 3 (+20% / 5,956 m²)', lang === 'ar' ? 'مجمع علامات تجارية / مطاعم وكافيهات شريكة ومواقف سيارات' : 'Commercial F&B Brand Hub + Dedicated Parking Concession'),
      toRow(lang === 'ar' ? 'الأثر الاقتصادي الاستراتيجي' : 'Strategic Impact', lang === 'ar' ? 'تحويل الأرض الفارغة من خسارة 4.08م/سنة إلى مصدر تغطية كامل للإيجار' : 'Converts 4.08M/yr dead rent into self-funding commercial yield'),
    ];
    s.addTable(zoningTbl, { x: 6.0, y: 2.6, w: 6.83, colW: [2.5, 4.33], fontSize: 10, fontFace: FONT, border: { type: 'solid', color: C.border, pt: 0.75 }, rowH: 0.78 });
  }

  // SLIDE 11: Expansion Scenarios (20% / 30% / 40% / 60%)
  {
    const s = pptx.addSlide();
    addSlideChrome(s, 11, 'سيناريوهات التوسع في المساحة (20% / 30% / 40% / 60%)', 'Expansion Scenarios (20% / 30% / 40% / 60% Utilization)');
    const scTbl: PptxGenJS.TableRow[] = [
      [
        { text: 'Utilization', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: 'Active m²', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: 'Rent / Active m²', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: 'Incr. CAPEX', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: 'Incr. EBITDA/yr', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: 'Branch Net Result', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: 'Payback', options: { bold: true, fill: { color: C.navy }, color: C.white } },
      ],
      ...review.usufruct.spaceScenarios.map((sc) =>
        toRow(
          `${sc.utilizationPct}%`,
          `${fmtN(sc.activeAreaSqm)} m²`,
          `${sc.rentPerActiveSqmAnnual} EGP`,
          `${fmtN(sc.incrementalCapexEgp)} EGP`,
          `${fmtN(sc.projectedAnnualContribution)} EGP`,
          `${fmtN(sc.projectedBranchNetResult)} EGP`,
          sc.paybackYears ? `${sc.paybackYears} yrs` : 'Baseline'
        )
      ),
    ];
    s.addTable(scTbl, { x: 0.5, y: 1.05, w: 12.33, colW: [1.3, 1.5, 1.8, 1.9, 2.0, 2.33, 1.5], fontSize: 10, fontFace: FONT, border: { type: 'solid', color: C.border, pt: 0.75 }, rowH: 0.65 });

    s.addChart(
      pptx.ChartType.bar,
      [
        {
          name: lang === 'ar' ? 'صافي نتيجة الفرع السنوية (بعد 5.1م)' : 'Branch Net Result After 5.1M Rent (EGP)',
          labels: review.usufruct.spaceScenarios.map((x) => `${x.utilizationPct}% (${fmtN(x.activeAreaSqm)} m²)`),
          values: review.usufruct.spaceScenarios.map((x) => Math.round(x.projectedBranchNetResult / 1000)),
        },
      ],
      {
        x: 0.5,
        y: 3.9,
        w: 12.33,
        h: 2.95,
        chartColors: [C.teal],
        showTitle: true,
        title: lang === 'ar' ? 'تحول صافي نتيجة المشروع من الخسارة إلى الربحية مع زيادة الإشغال (بالألف ج)' : 'Branch Net Turnaround Across Space Utilization Tiers (k EGP)',
      }
    );
  }

  // SLIDE 12: Investment Options (Direct vs JV vs Sub-lease)
  {
    const s = pptx.addSlide();
    addSlideChrome(s, 12, 'مقارنة بدائل الاستثمار (مباشر vs شراكة JV vs تأجير من الباطن)', 'Investment Options Evaluation: NPV, IRR & Payback (@22% Hurdle)');
    const invTbl: PptxGenJS.TableRow[] = [
      [
        { text: lang === 'ar' ? 'البديل الاستثماري' : 'Investment Option', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: 'CAPEX (EGP)', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: 'Estadat EBITDA/yr', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: 'Payback', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: '5-Yr NPV (22%)', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: 'IRR %', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: 'Legal Status', options: { bold: true, fill: { color: C.navy }, color: C.white } },
      ],
      ...review.usufruct.investmentOptions.map((o) =>
        toRow(
          lang === 'ar' ? o.titleAr : o.titleEn,
          fmtN(o.capexEgp),
          fmtN(o.annualEstadatEbitda),
          `${o.paybackYears} yrs`,
          fmtN(o.fiveYearNpv),
          o.irrPct !== null ? `${o.irrPct}%` : 'N/A',
          o.legalStatus
        )
      ),
    ];
    s.addTable(invTbl, { x: 0.5, y: 1.05, w: 12.33, colW: [3.73, 1.5, 1.7, 1.1, 1.7, 1.0, 1.6], fontSize: 10, fontFace: FONT, border: { type: 'solid', color: C.border, pt: 0.75 }, rowH: 1.15 });

    addKpiBox(
      s,
      0.5,
      5.15,
      12.33,
      1.55,
      lang === 'ar' ? 'التوصية الاستثمارية للمدير المالي (CFO Recommendation)' : 'CFO Investment Recommendation',
      lang === 'ar' ? 'البديل الثاني: شراكة تشغيلية ومشاركة إيراد (JV Operator)' : 'Select Option 2: Specialist JV Revenue-Share Partnership',
      lang === 'ar'
        ? 'يتجنب ضغط الكابكس (2.2م بدلاً من 6.2م)، يحقق أعلى عائد على رأس المال (IRR ~87%) وأسرع استرداد (~1.13 سنة)، مع تفادي حظر التأجير من الباطن.'
        : 'Minimizes cash outlay (2.2M vs 6.2M CAPEX), yields highest IRR (~87%) & ~1.13 yr payback, while structuring clean JV governance under the protocol.',
      C.teal
    );
  }

  // SLIDE 13: 2027 Strategic & Financial Plan
  {
    const s = pptx.addSlide();
    addSlideChrome(s, 13, 'الخطة المالية والاستراتيجية لعام 2027 (سيناريوهات A / B / C)', '2027 Strategic Financial Plan & Turnaround Roadmap');
    const sc27: PptxGenJS.TableRow[] = [
      [
        { text: 'Scenario', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: 'Net Revenue', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: 'COGS %', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: 'Payroll (5201)', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: 'Usufruct Rent', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: 'Net Result 2027', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: 'Monthly Break-Even', options: { bold: true, fill: { color: C.navy }, color: C.white } },
      ],
      ...state.strategy2027.scenarios.map((sc) =>
        toRow(
          `${sc.id}: ${lang === 'ar' ? sc.nameAr : sc.nameEn}`,
          fmtN(sc.netRevenue),
          `${sc.cogsPct}%`,
          fmtN(sc.payroll),
          fmtN(sc.usufructRent),
          fmtN(sc.netResult),
          `${fmtN(sc.monthlyBreakEven)}/mo`
        )
      ),
    ];
    s.addTable(sc27, { x: 0.5, y: 1.05, w: 12.33, colW: [3.23, 1.6, 1.0, 1.6, 1.5, 1.7, 1.7], fontSize: 10, fontFace: FONT, border: { type: 'solid', color: C.border, pt: 0.75 }, rowH: 0.72 });

    const initTbl: PptxGenJS.TableRow[] = [
      [
        { text: 'Initiative', options: { bold: true, fill: { color: C.teal }, color: C.white } },
        { text: 'Target Impact', options: { bold: true, fill: { color: C.teal }, color: C.white } },
        { text: 'Budget (EGP)', options: { bold: true, fill: { color: C.teal }, color: C.white } },
        { text: 'Timeline', options: { bold: true, fill: { color: C.teal }, color: C.white } },
      ],
      ...state.strategy2027.initiatives.map((i) =>
        toRow(
          lang === 'ar' ? i.titleAr : i.titleEn,
          lang === 'ar' ? i.targetImpactAr : i.targetImpactEn,
          fmtN(i.budgetEgp),
          i.timeline
        )
      ),
    ];
    s.addTable(initTbl, { x: 0.5, y: 4.1, w: 12.33, colW: [4.5, 4.73, 1.6, 1.5], fontSize: 9.5, fontFace: FONT, border: { type: 'solid', color: C.border, pt: 0.75 }, rowH: 0.52 });
  }

  // SLIDE 14: Risk Register & 30/60/90-Day Action Plan
  {
    const s = pptx.addSlide();
    addSlideChrome(s, 14, 'مصفوفة المخاطر وخطة التنفيذ (30 / 60 / 90 يوماً)', 'Risk Register & 30 / 60 / 90-Day Action Plan');
    const actTbl: PptxGenJS.TableRow[] = [
      [
        { text: 'Horizon', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: lang === 'ar' ? 'الإجراء التنفيذي' : 'Execution Action', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: lang === 'ar' ? 'المسؤول' : 'Owner', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: lang === 'ar' ? 'المؤشر المستهدف (KPI)' : 'KPI Target', options: { bold: true, fill: { color: C.navy }, color: C.white } },
      ],
      ...review.actionPlan90Days.map((a) =>
        toRow(
          a.horizon.toUpperCase(),
          lang === 'ar' ? a.titleAr : a.titleEn,
          lang === 'ar' ? a.ownerAr : a.ownerEn,
          lang === 'ar' ? a.kpiTargetAr : a.kpiTargetEn
        )
      ),
    ];
    s.addTable(actTbl, { x: 0.5, y: 1.05, w: 12.33, colW: [1.1, 5.5, 2.7, 3.03], fontSize: 9.5, fontFace: FONT, border: { type: 'solid', color: C.border, pt: 0.75 }, rowH: 0.85 });
  }

  // SLIDE 15: 9 Key CFO Decisions & Sign-Off
  {
    const s = pptx.addSlide();
    addSlideChrome(s, 15, 'القرارات التسعة المطلوبة من المدير المالي والاعتماد التنفيذي', '9 Key CFO Decisions Required & Executive Sign-Off');
    const decTbl: PptxGenJS.TableRow[] = [
      [
        { text: 'ID', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: lang === 'ar' ? 'القرار المطلوب اعتماده' : 'Decision Required', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: lang === 'ar' ? 'الأثر المالي المباشر' : 'Financial Impact', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: 'Horizon', options: { bold: true, fill: { color: C.navy }, color: C.white } },
      ],
      ...review.cfoDecisions.map((d) =>
        toRow(
          d.id,
          lang === 'ar' ? d.decisionAr : d.decisionEn,
          lang === 'ar' ? d.financialImpactAr : d.financialImpactEn,
          d.urgency.toUpperCase()
        )
      ),
    ];
    s.addTable(decTbl, { x: 0.5, y: 1.0, w: 12.33, colW: [0.85, 6.75, 3.43, 1.3], fontSize: 9, fontFace: FONT, border: { type: 'solid', color: C.border, pt: 0.75 }, rowH: 0.52 });
  }

  return pptx;
}

export async function exportCfoPowerPointDeck(
  state: ErpState,
  review: CfoExecutiveReviewData,
  lang: Language = 'ar'
): Promise<void> {
  const pptx = buildCfoPowerPoint(state, review, lang);
  await pptx.writeFile({
    fileName: 'ESTADAT_Monufia_Tower_CFO_Executive_Presentation_2026_2027.pptx',
  });
}
