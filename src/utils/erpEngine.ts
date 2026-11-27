import type {
  BankTransaction,
  DataQualityCheck,
  ErpState,
  ExpenseEntry,
  FoodCostMonthlyVariance,
  FoodCostRecipeVariance,
  FoodCostVarianceSummary,
  Ingredient,
  JournalEntry,
  KdsOrder,
  MenuItem,
  OrderType,
  PaymentMethod,
  PurchaseInvoice,
  SalesInvoice,
  SalesLineItem,
  StockOpportunityAlert,
  StocktakeEntry,
  StocktakeVarianceAlertItem,
  StocktakeVarianceSummary,
  WasteEntry,
} from '../types/erp.ts';

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function calculateRecipeCost(item: MenuItem, ingredients: Ingredient[]): number {
  const map = new Map(ingredients.map((i) => [i.id, i]));
  const total = item.recipe.reduce((sum, line) => {
    const ing = map.get(line.ingredientId);
    if (!ing) return sum;
    const effectiveQty = line.qty * (1 + line.wastePct / 100);
    return sum + effectiveQty * ing.weightedAvgCost;
  }, 0);
  return round2(total / (item.yieldPortions || 1));
}

export function suggestOptimalPriceGross(recipeCost: number, targetFoodCostPct = 35, vatRate = 0.14): number {
  if (recipeCost <= 0) return 0;
  const targetNet = recipeCost / (targetFoodCostPct / 100);
  return Math.ceil((targetNet * (1 + vatRate)) / 5) * 5; // round to nearest 5 EGP
}

export function computeAccountBalances(state: ErpState): Record<string, number> {
  const balances: Record<string, number> = {};
  state.accounts.forEach((a) => {
    balances[a.code] = 0;
  });

  state.journalEntries.forEach((je) => {
    je.lines.forEach((line) => {
      const acc = state.accounts.find((a) => a.code === line.accountCode);
      const current = balances[line.accountCode] ?? 0;
      if (acc?.normalBalance === 'credit') {
        balances[line.accountCode] = round2(current + line.credit - line.debit);
      } else {
        balances[line.accountCode] = round2(current + line.debit - line.credit);
      }
    });
  });

  return balances;
}

export function computeTrialBalanceTotals(state: ErpState): { totalDebit: number; totalCredit: number; balanced: boolean } {
  let totalDebit = 0;
  let totalCredit = 0;
  state.journalEntries.forEach((je) => {
    je.lines.forEach((l) => {
      totalDebit += l.debit;
      totalCredit += l.credit;
    });
  });
  totalDebit = round2(totalDebit);
  totalCredit = round2(totalCredit);
  return {
    totalDebit,
    totalCredit,
    balanced: Math.abs(totalDebit - totalCredit) < 0.05,
  };
}

export function computeBankRunningBalances(txns: BankTransaction[]): BankTransaction[] {
  const sorted = [...txns].sort((a, b) => {
    const dc = a.date.localeCompare(b.date);
    if (dc !== 0) return dc;
    if (a.id === 'BNK-01') return -1;
    if (b.id === 'BNK-01') return 1;
    return a.id.localeCompare(b.id);
  });
  let running = 0;
  return sorted.map((t) => {
    running = round2(running + (t.credit || 0) - (t.debit || 0));
    return { ...t, runningBalance: running };
  });
}

export interface SaleRequestPayload {
  items: { menuItemId: string; qty: number }[];
  orderType: OrderType;
  paymentMethod: PaymentMethod;
  tableId?: string;
  discountAmount?: number;
  splitCount?: number;
  cashier?: string;
  representativeId?: string;
  offlineQueued?: boolean;
  source?: 'pos' | 'foodics_api';
}

export function applySaleAutomation(state: ErpState, payload: SaleRequestPayload): { nextState: ErpState; invoice: SalesInvoice; journal: JournalEntry; kdsOrder: KdsOrder } {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toTimeString().slice(0, 5);
  const seq = state.salesInvoices.length + 1043;
  const invoiceNo = `${payload.source === 'foodics_api' ? 'FDX' : 'POS'}-2026-${seq}`;
  const invoiceId = `INV-${Date.now()}-${seq}`;
  const journalId = `JE-${Date.now()}-${seq}`;
  const journalNo = `JV-2026-${String(state.journalEntries.length + 1).padStart(4, '0')}`;

  const nextIngredients = state.ingredients.map((i) => ({ ...i }));
  const ingMap = new Map(nextIngredients.map((i) => [i.id, i]));
  const menuMap = new Map(state.menuItems.map((m) => [m.id, m]));

  let rawGrossSum = 0;
  const lines: SalesLineItem[] = [];
  let totalCogs = 0;

  for (const reqItem of payload.items) {
    const menu = menuMap.get(reqItem.menuItemId);
    if (!menu || reqItem.qty <= 0) continue;

    const lineGross = round2(menu.sellingPriceGross * reqItem.qty);
    rawGrossSum += lineGross;

    // Deduct BOM recipe ingredients using Weighted Average Cost
    let unitRecipeCost = 0;
    for (const rec of menu.recipe) {
      const ing = ingMap.get(rec.ingredientId);
      if (!ing) continue;
      const qtyNeeded = round2(rec.qty * (1 + rec.wastePct / 100) * reqItem.qty);
      ing.issuedQty = round2(ing.issuedQty + qtyNeeded);
      ing.currentQty = round2(Math.max(0, ing.currentQty - qtyNeeded));
      unitRecipeCost += (rec.qty * (1 + rec.wastePct / 100)) * ing.weightedAvgCost;
    }

    const lineCogs = round2(unitRecipeCost * reqItem.qty);
    totalCogs = round2(totalCogs + lineCogs);

    const lineNet = round2(lineGross / (1 + state.vatRate));
    const lineVat = round2(lineGross - lineNet);

    lines.push({
      menuItemId: menu.id,
      nameAr: menu.nameAr,
      nameEn: menu.nameEn,
      qty: reqItem.qty,
      unitPriceGross: menu.sellingPriceGross,
      lineTotalGross: lineGross,
      lineNet,
      lineVat,
      lineCogs,
      station: menu.station,
    });
  }

  const discount = Math.min(rawGrossSum, Math.max(0, payload.discountAmount || 0));
  const grossTotal = round2(rawGrossSum - discount);
  const netSales = round2(grossTotal / (1 + state.vatRate));
  const vatAmount = round2(grossTotal - netSales);

  const debitAccount =
    payload.paymentMethod === 'cash'
      ? { code: '1101', name: 'الخزينة الرئيسية' }
      : payload.paymentMethod === 'visa_cib'
      ? { code: '1102', name: 'بنك CIB — حساب استادات' }
      : { code: '1103', name: 'تحصيل VISA/POS تحت التسوية' };

  const table = state.tables.find((t) => t.id === payload.tableId);
  const rep = payload.representativeId
    ? (state.representatives ?? []).find((r) => r.id === payload.representativeId)
    : undefined;

  const invoice: SalesInvoice = {
    id: invoiceId,
    invoiceNo,
    date: dateStr,
    time: timeStr,
    branchId: state.activeBranchId,
    cashier: payload.cashier || 'أحمد سعيد',
    representativeId: rep?.id,
    representativeNameAr: rep?.nameAr,
    orderType: payload.orderType,
    tableId: table?.id,
    tableNumber: table?.number,
    paymentMethod: payload.paymentMethod,
    splitCount: payload.splitCount || 1,
    discountAmount: discount,
    grossTotal,
    netSales,
    vatAmount,
    cogsTotal: totalCogs,
    lines,
    journalId,
    etaStatus: payload.offlineQueued ? 'queued_offline' : 'submitted',
    source: payload.source || 'pos',
  };

  const journal: JournalEntry = {
    id: journalId,
    journalNo,
    date: dateStr,
    period: dateStr.slice(0, 7),
    source: 'pos_sale',
    referenceNo: invoiceNo,
    description: `قيد مبيعات آلي + خصم مخزون BOM (${invoiceNo})`,
    createdBy: invoice.cashier,
    lines: [
      {
        lineNo: 1,
        accountCode: debitAccount.code,
        accountNameAr: debitAccount.name,
        description: `تحصيل فاتورة ${invoiceNo}`,
        debit: grossTotal,
        credit: 0,
        branchId: state.activeBranchId,
        costCenter: 'CC-POS',
      },
      {
        lineNo: 2,
        accountCode: '4101',
        accountNameAr: 'إيرادات المبيعات الغذائية والمشروبات',
        description: `صافي مبيعات ${invoiceNo}`,
        debit: 0,
        credit: netSales,
        branchId: state.activeBranchId,
        costCenter: 'CC-POS',
      },
      {
        lineNo: 3,
        accountCode: '2201',
        accountNameAr: 'ضريبة القيمة المضافة (مخرجات 14%)',
        description: `ضريبة ق.م 14% على ${invoiceNo}`,
        debit: 0,
        credit: vatAmount,
        branchId: state.activeBranchId,
        costCenter: 'CC-TAX',
      },
      {
        lineNo: 4,
        accountCode: '5101',
        accountNameAr: 'تكلفة المبيعات (COGS)',
        description: `تكلفة وصفات BOM لفاتورة ${invoiceNo}`,
        debit: totalCogs,
        credit: 0,
        branchId: state.activeBranchId,
        costCenter: 'CC-KITCHEN',
      },
      {
        lineNo: 5,
        accountCode: '1201',
        accountNameAr: 'مخزون المواد الخام',
        description: `صرف مخزني آلي حسب الوصفة ${invoiceNo}`,
        debit: 0,
        credit: totalCogs,
        branchId: state.activeBranchId,
        costCenter: 'CC-KITCHEN',
      },
    ],
  };

  const kdsOrder: KdsOrder = {
    id: `KDS-${seq}`,
    orderNo: `#${seq}`,
    invoiceNo,
    createdAt: timeStr,
    timestampMs: Date.now(),
    orderType: payload.orderType,
    tableNumber: table?.number,
    status: 'new',
    priority: payload.orderType === 'delivery' ? 'rush' : 'normal',
    items: lines.map((l) => ({
      nameAr: l.nameAr,
      nameEn: l.nameEn,
      qty: l.qty,
      station: l.station,
    })),
  };

  const nextTables = state.tables.map((t) =>
    t.id === payload.tableId
      ? { ...t, status: 'occupied' as const, activeOrderId: invoiceId, activeTotal: grossTotal }
      : t
  );

  const nextRepresentatives = (state.representatives ?? []).map((r) =>
    rep && r.id === rep.id
      ? {
          ...r,
          achievedSales: round2(r.achievedSales + netSales),
          collectedAmount: round2(r.collectedAmount + (payload.paymentMethod !== 'foodics_credit' ? grossTotal : 0)),
        }
      : r
  );

  const nextBankTxns =
    payload.paymentMethod === 'visa_cib'
      ? computeBankRunningBalances([
          ...state.bankTransactions,
          {
            id: `BNK-${Date.now()}-${seq}`,
            bankRef: `CIB-${invoiceNo}`,
            date: dateStr,
            description: `إيداع مبيعات فيزا ${invoiceNo}`,
            debit: 0,
            credit: grossTotal,
            accountCode: '1102',
            matchedJournalId: journalId,
            matchStatus: 'matched',
          },
        ])
      : state.bankTransactions;

  const nextState: ErpState = {
    ...state,
    ingredients: nextIngredients,
    representatives: nextRepresentatives,
    bankTransactions: nextBankTxns,
    tables: nextTables,
    salesInvoices: [invoice, ...state.salesInvoices],
    journalEntries: [journal, ...state.journalEntries],
    kdsOrders: [kdsOrder, ...state.kdsOrders],
    auditLogs: [
      {
        id: `AUD-${Date.now()}-${seq}`,
        timestamp: `${dateStr} ${timeStr}`,
        user: invoice.cashier,
        role: 'cashier',
        action: 'إصدار فاتورة POS + قيد وخصم مخزون',
        entityType: 'SalesInvoice',
        entityId: invoiceNo,
        details: `إجمالي ${grossTotal.toFixed(2)} ج.م | COGS ${totalCogs.toFixed(2)} ج.م`,
      },
      ...state.auditLogs,
    ],
  };

  return { nextState, invoice, journal, kdsOrder };
}

export interface PurchaseRequestPayload {
  supplierId: string;
  paymentStatus: 'paid_cash' | 'paid_cib' | 'credit';
  representativeId?: string;
  date?: string;
  purchaseNo?: string;
  lines: { ingredientId: string; qty: number; unitCostNet: number }[];
}

export function applyPurchaseAutomation(state: ErpState, payload: PurchaseRequestPayload): { nextState: ErpState; purchase: PurchaseInvoice } {
  const now = new Date();
  const dateStr = payload.date && /^\d{4}-\d{2}-\d{2}$/.test(payload.date) ? payload.date : now.toISOString().slice(0, 10);
  const timeStr = now.toTimeString().slice(0, 5);
  const seq = state.purchaseInvoices.length + 302;
  const purchaseNo = payload.purchaseNo?.trim() || `PO-2026-${String(seq).padStart(4, '0')}`;
  const purchaseId = `PO-${Date.now()}`;
  const journalId = `JE-${Date.now()}-${seq}`;
  const journalNo = `JV-2026-${String(state.journalEntries.length + 1).padStart(4, '0')}`;

  const supplier = state.suppliers.find((s) => s.id === payload.supplierId) || state.suppliers[0];
  const rep = payload.representativeId
    ? (state.representatives ?? []).find((r) => r.id === payload.representativeId)
    : undefined;
  const nextIngredients = state.ingredients.map((i) => ({ ...i }));
  const ingMap = new Map(nextIngredients.map((i) => [i.id, i]));

  let totalBeforeTax = 0;
  const poLines = payload.lines
    .filter((l) => l.qty > 0 && l.unitCostNet > 0 && ingMap.has(l.ingredientId))
    .map((l) => {
      const ing = ingMap.get(l.ingredientId)!;
      const lineTotal = round2(l.qty * l.unitCostNet);
      totalBeforeTax = round2(totalBeforeTax + lineTotal);

      // Weighted Average Cost formula: (oldQty*oldCost + newQty*newCost)/(oldQty+newQty)
      const oldValue = ing.currentQty * ing.weightedAvgCost;
      const newQty = ing.currentQty + l.qty;
      ing.weightedAvgCost = newQty > 0 ? round2((oldValue + lineTotal) / newQty) : l.unitCostNet;
      ing.purchasedQty = round2(ing.purchasedQty + l.qty);
      ing.currentQty = round2(newQty);
      ing.lastPurchasePrice = l.unitCostNet;

      return {
        ingredientId: ing.id,
        nameAr: ing.nameAr,
        nameEn: ing.nameEn,
        qty: l.qty,
        unitCostNet: l.unitCostNet,
        lineTotalNet: lineTotal,
      };
    });

  if (poLines.length === 0) {
    throw new Error('Purchase invoice has no valid mapped ingredient lines.');
  }

  const vatAmount = round2(totalBeforeTax * state.vatRate);
  const grandTotal = round2(totalBeforeTax + vatAmount);

  const creditAcc =
    payload.paymentStatus === 'paid_cash'
      ? { code: '1101', name: 'الخزينة الرئيسية' }
      : payload.paymentStatus === 'paid_cib'
      ? { code: '1102', name: 'بنك CIB — حساب استادات' }
      : { code: '2101', name: 'الموردون (حسابات دائنة)' };

  const purchase: PurchaseInvoice = {
    id: purchaseId,
    purchaseNo,
    date: dateStr,
    branchId: state.activeBranchId,
    supplierId: supplier.id,
    supplierNameAr: supplier.nameAr,
    representativeId: rep?.id,
    representativeNameAr: rep?.nameAr,
    paymentStatus: payload.paymentStatus,
    totalBeforeTax,
    vatAmount,
    grandTotal,
    lines: poLines,
    journalId,
  };

  const journal: JournalEntry = {
    id: journalId,
    journalNo,
    date: dateStr,
    period: dateStr.slice(0, 7),
    source: 'purchase',
    referenceNo: purchaseNo,
    description: `فاتورة مشتريات وتحديث متوسط التكلفة المرجح (${supplier.nameAr})${rep ? ` — مندوب: ${rep.nameAr}` : ''}`,
    createdBy: rep?.nameAr || 'مدير المشتريات',
    lines: [
      { lineNo: 1, accountCode: '1201', accountNameAr: 'مخزون المواد الخام', description: `إضافة مخزون ${purchaseNo}`, debit: totalBeforeTax, credit: 0, branchId: state.activeBranchId, costCenter: 'CC-KITCHEN' },
      { lineNo: 2, accountCode: '1105', accountNameAr: 'ضريبة القيمة المضافة (مدخلات)', description: `ضريبة مدخلات 14% — ${purchaseNo}`, debit: vatAmount, credit: 0, branchId: state.activeBranchId, costCenter: 'CC-TAX' },
      { lineNo: 3, accountCode: creditAcc.code, accountNameAr: creditAcc.name, description: `استحقاق / سداد ${purchaseNo}`, debit: 0, credit: grandTotal, branchId: state.activeBranchId, costCenter: 'CC-PROC' },
    ],
  };

  const nextSuppliers = state.suppliers.map((s) =>
    s.id === supplier.id && payload.paymentStatus === 'credit'
      ? { ...s, aging0_30: round2(s.aging0_30 + grandTotal) }
      : s
  );

  const nextBankTxns =
    payload.paymentStatus === 'paid_cib'
      ? computeBankRunningBalances([
          ...state.bankTransactions,
          {
            id: `BNK-${Date.now()}-P${seq}`,
            bankRef: `CIB-${purchaseNo}`,
            date: dateStr,
            description: `سداد فاتورة مشتريات ${purchaseNo} (${supplier.nameAr})`,
            debit: grandTotal,
            credit: 0,
            accountCode: '1102',
            matchedJournalId: journalId,
            matchStatus: 'matched',
          },
        ])
      : state.bankTransactions;

  const nextState: ErpState = {
    ...state,
    ingredients: nextIngredients,
    suppliers: nextSuppliers,
    bankTransactions: nextBankTxns,
    purchaseInvoices: [purchase, ...state.purchaseInvoices],
    journalEntries: [journal, ...state.journalEntries],
    auditLogs: [
      {
        id: `AUD-${Date.now()}-P${seq}`,
        timestamp: `${dateStr} ${timeStr}`,
        user: rep?.nameAr || 'مدير المشتريات',
        role: 'manager',
        action: 'فاتورة شراء وتحديث WAC',
        entityType: 'PurchaseInvoice',
        entityId: purchaseNo,
        details: `صافي ${totalBeforeTax.toFixed(2)} ج.م | ضريبة ${vatAmount.toFixed(2)} ج.م`,
      },
      ...state.auditLogs,
    ],
  };

  return { nextState, purchase };
}

export interface SupplierPaymentPayload {
  supplierId: string;
  amount: number;
  paymentMethod: 'cash' | 'visa_cib';
  representativeId?: string;
  date?: string;
  notes?: string;
}

export function applySupplierPaymentAutomation(
  state: ErpState,
  payload: SupplierPaymentPayload
): { nextState: ErpState; journal: JournalEntry; paidAmount: number } {
  const supplier = state.suppliers.find((s) => s.id === payload.supplierId);
  if (!supplier) {
    throw new Error('Supplier not found.');
  }
  const totalOwed = round2(supplier.aging0_30 + supplier.aging31_60 + supplier.aging61_90Plus);
  const amount = round2(Math.min(totalOwed, Math.max(0, Number(payload.amount) || 0)));
  if (amount <= 0) {
    throw new Error('Payment amount must be greater than zero and within supplier AP balance.');
  }

  const now = new Date();
  const dateStr = payload.date && /^\d{4}-\d{2}-\d{2}$/.test(payload.date) ? payload.date : now.toISOString().slice(0, 10);
  const timeStr = now.toTimeString().slice(0, 5);
  const seq = state.journalEntries.length + 1;
  const journalId = `JE-PAY-${Date.now()}-${seq}`;
  const journalNo = `JV-2026-${String(seq).padStart(4, '0')}`;
  const payNo = `PAY-SUP-${Date.now().toString().slice(-6)}`;
  const rep = payload.representativeId
    ? (state.representatives ?? []).find((r) => r.id === payload.representativeId)
    : undefined;

  // Allocate payment oldest-first (61-90+ -> 31-60 -> 0-30)
  let rem = amount;
  const deduct90 = Math.min(supplier.aging61_90Plus, rem);
  rem = round2(rem - deduct90);
  const deduct60 = Math.min(supplier.aging31_60, rem);
  rem = round2(rem - deduct60);
  const deduct30 = Math.min(supplier.aging0_30, rem);

  const nextSuppliers = state.suppliers.map((s) =>
    s.id === supplier.id
      ? {
          ...s,
          aging61_90Plus: round2(s.aging61_90Plus - deduct90),
          aging31_60: round2(s.aging31_60 - deduct60),
          aging0_30: round2(s.aging0_30 - deduct30),
        }
      : s
  );

  const payAcc =
    payload.paymentMethod === 'cash'
      ? { code: '1101', name: 'الخزينة الرئيسية' }
      : { code: '1102', name: 'بنك CIB — حساب استادات' };

  const journal: JournalEntry = {
    id: journalId,
    journalNo,
    date: dateStr,
    period: dateStr.slice(0, 7),
    source: 'supplier_payment',
    referenceNo: payNo,
    description: `سداد دفعة للمورد (${supplier.nameAr})${rep ? ` عبر المندوب ${rep.nameAr}` : ''}${payload.notes ? ` — ${payload.notes}` : ''}`,
    createdBy: rep?.nameAr || 'الإدارة المالية',
    lines: [
      {
        lineNo: 1,
        accountCode: '2101',
        accountNameAr: 'الموردون (حسابات دائنة)',
        description: `سداد مستحقات ${supplier.nameAr} (${payNo})`,
        debit: amount,
        credit: 0,
        branchId: state.activeBranchId,
        costCenter: 'CC-PROC',
      },
      {
        lineNo: 2,
        accountCode: payAcc.code,
        accountNameAr: payAcc.name,
        description: `صرف دفعة مورد ${payNo}`,
        debit: 0,
        credit: amount,
        branchId: state.activeBranchId,
        costCenter: 'CC-TREASURY',
      },
    ],
  };

  const nextBankTxns =
    payload.paymentMethod === 'visa_cib'
      ? computeBankRunningBalances([
          ...state.bankTransactions,
          {
            id: `BNK-${Date.now()}-SP`,
            bankRef: `CIB-${payNo}`,
            date: dateStr,
            description: `تحويل بنكي سداد للمورد: ${supplier.nameAr}`,
            debit: amount,
            credit: 0,
            accountCode: '1102',
            matchedJournalId: journalId,
            matchStatus: 'matched',
          },
        ])
      : state.bankTransactions;

  const nextState: ErpState = {
    ...state,
    suppliers: nextSuppliers,
    bankTransactions: nextBankTxns,
    journalEntries: [journal, ...state.journalEntries],
    auditLogs: [
      {
        id: `AUD-${Date.now()}-SP`,
        timestamp: `${dateStr} ${timeStr}`,
        user: 'الإدارة المالية',
        role: 'accountant',
        action: 'سداد دفعة مورد (تخفيض حساب 2101)',
        entityType: 'SupplierPayment',
        entityId: payNo,
        details: `سداد ${amount.toFixed(2)} ج.م للمورد ${supplier.nameAr} عبر ${payAcc.name}`,
      },
      ...state.auditLogs,
    ],
  };

  return { nextState, journal, paidAmount: amount };
}

export function applyWasteAutomation(
  state: ErpState,
  payload: { ingredientId: string; qty: number; reason: WasteEntry['reason'] }
): ErpState {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toTimeString().slice(0, 5);
  const seq = state.wasteEntries.length + 15;
  const wasteNo = `WST-2026-${String(seq).padStart(4, '0')}`;
  const journalId = `JE-${Date.now()}-W${seq}`;
  const journalNo = `JV-2026-${String(state.journalEntries.length + 1).padStart(4, '0')}`;

  const nextIngredients = state.ingredients.map((i) => ({ ...i }));
  const ing = nextIngredients.find((i) => i.id === payload.ingredientId);
  if (!ing || payload.qty <= 0) return state;

  const actualQty = Math.min(ing.currentQty, payload.qty);
  const totalValue = round2(actualQty * ing.weightedAvgCost);
  ing.wasteQty = round2(ing.wasteQty + actualQty);
  ing.currentQty = round2(ing.currentQty - actualQty);

  const waste: WasteEntry = {
    id: `WST-${Date.now()}-${seq}`,
    wasteNo,
    date: dateStr,
    branchId: state.activeBranchId,
    ingredientId: ing.id,
    ingredientNameAr: ing.nameAr,
    qty: actualQty,
    unitCost: ing.weightedAvgCost,
    totalValue,
    reason: payload.reason,
    journalId,
  };

  const journal: JournalEntry = {
    id: journalId,
    journalNo,
    date: dateStr,
    period: dateStr.slice(0, 7),
    source: 'waste',
    referenceNo: wasteNo,
    description: `إثبات هالك مخزون (${ing.nameAr}) — ${wasteNo}`,
    createdBy: 'مسؤول المخزن',
    lines: [
      { lineNo: 1, accountCode: '5305', accountNameAr: 'مصروف هالك وتالف المخزون', description: `هالك ${actualQty} ${ing.unit} (${payload.reason})`, debit: totalValue, credit: 0, branchId: state.activeBranchId, costCenter: 'CC-KITCHEN' },
      { lineNo: 2, accountCode: '1201', accountNameAr: 'مخزون المواد الخام', description: `خصم تالف من المخزون ${wasteNo}`, debit: 0, credit: totalValue, branchId: state.activeBranchId, costCenter: 'CC-KITCHEN' },
    ],
  };

  return {
    ...state,
    ingredients: nextIngredients,
    wasteEntries: [waste, ...state.wasteEntries],
    journalEntries: [journal, ...state.journalEntries],
    auditLogs: [
      {
        id: `AUD-${Date.now()}-W${seq}`,
        timestamp: `${dateStr} ${timeStr}`,
        user: 'مسؤول المخزن',
        role: 'manager',
        action: 'تسجيل هالك مخزني',
        entityType: 'WasteEntry',
        entityId: wasteNo,
        details: `${ing.nameAr}: ${actualQty} ${ing.unit} بقيمة ${totalValue.toFixed(2)} ج.م`,
      },
      ...state.auditLogs,
    ],
  };
}

export function applyExpenseAutomation(
  state: ErpState,
  payload: { categoryAccountCode: string; beneficiary: string; amountNet: number; applyVat: boolean; paymentMethod: 'cash' | 'visa_cib' }
): ErpState {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toTimeString().slice(0, 5);
  const seq = state.expenses.length + 92;
  const expenseNo = `EXP-2026-${String(seq).padStart(4, '0')}`;
  const journalId = `JE-${Date.now()}-E${seq}`;
  const journalNo = `JV-2026-${String(state.journalEntries.length + 1).padStart(4, '0')}`;

  const acc = state.accounts.find((a) => a.code === payload.categoryAccountCode) || state.accounts.find((a) => a.code === '5301')!;
  const amountNet = round2(payload.amountNet);
  const vatAmount = payload.applyVat ? round2(amountNet * state.vatRate) : 0;
  const totalAmount = round2(amountNet + vatAmount);

  const payAcc = payload.paymentMethod === 'cash'
    ? { code: '1101', name: 'الخزينة الرئيسية' }
    : { code: '1102', name: 'بنك CIB — حساب استادات' };

  const expense: ExpenseEntry = {
    id: `EXP-${Date.now()}-${seq}`,
    expenseNo,
    date: dateStr,
    branchId: state.activeBranchId,
    categoryAccountCode: acc.code,
    categoryNameAr: acc.nameAr,
    beneficiary: payload.beneficiary,
    amountNet,
    vatAmount,
    totalAmount,
    paymentMethod: payload.paymentMethod,
    costCenter: 'CC-ADMIN',
    journalId,
  };

  const lines = [
    { lineNo: 1, accountCode: acc.code, accountNameAr: acc.nameAr, description: `${payload.beneficiary} (${expenseNo})`, debit: amountNet, credit: 0, branchId: state.activeBranchId, costCenter: 'CC-ADMIN' },
  ];
  if (vatAmount > 0) {
    lines.push({ lineNo: 2, accountCode: '1105', accountNameAr: 'ضريبة القيمة المضافة (مدخلات)', description: `ضريبة مدخلات ${expenseNo}`, debit: vatAmount, credit: 0, branchId: state.activeBranchId, costCenter: 'CC-TAX' });
  }
  lines.push({ lineNo: lines.length + 1, accountCode: payAcc.code, accountNameAr: payAcc.name, description: `سداد مصروف ${expenseNo}`, debit: 0, credit: totalAmount, branchId: state.activeBranchId, costCenter: 'CC-ADMIN' });

  const journal: JournalEntry = {
    id: journalId,
    journalNo,
    date: dateStr,
    period: dateStr.slice(0, 7),
    source: 'expense',
    referenceNo: expenseNo,
    description: `قيد مصروف: ${acc.nameAr} — ${payload.beneficiary}`,
    createdBy: 'المحاسب العام',
    lines,
  };

  const nextBankTxns =
    payload.paymentMethod === 'visa_cib'
      ? computeBankRunningBalances([
          ...state.bankTransactions,
          {
            id: `BNK-${Date.now()}-E${seq}`,
            bankRef: `CIB-${expenseNo}`,
            date: dateStr,
            description: `صرف مصروف ${expenseNo}: ${payload.beneficiary}`,
            debit: totalAmount,
            credit: 0,
            accountCode: '1102',
            matchedJournalId: journalId,
            matchStatus: 'matched',
          },
        ])
      : state.bankTransactions;

  return {
    ...state,
    expenses: [expense, ...state.expenses],
    bankTransactions: nextBankTxns,
    journalEntries: [journal, ...state.journalEntries],
    auditLogs: [
      {
        id: `AUD-${Date.now()}-E${seq}`,
        timestamp: `${dateStr} ${timeStr}`,
        user: 'المحاسب العام',
        role: 'accountant',
        action: 'تسجيل مصروف تشغيلي',
        entityType: 'ExpenseEntry',
        entityId: expenseNo,
        details: `${acc.nameAr}: ${totalAmount.toFixed(2)} ج.م`,
      },
      ...state.auditLogs,
    ],
  };
}

export function applyJournalReversal(state: ErpState, targetJournalId: string): ErpState {
  const target = state.journalEntries.find((j) => j.id === targetJournalId);
  if (!target || target.reversedByJournalId || target.isReversal) return state;

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const revId = `JE-REV-${Date.now()}`;
  const revNo = `JV-2026-${String(state.journalEntries.length + 1).padStart(4, '0')}`;

  const reversal: JournalEntry = {
    id: revId,
    journalNo: revNo,
    date: dateStr,
    period: dateStr.slice(0, 7),
    source: 'reversal',
    referenceNo: target.journalNo,
    description: `قيد عكسي لـ ${target.journalNo}: ${target.description}`,
    createdBy: 'المدير المالي',
    isReversal: true,
    lines: target.lines.map((l) => ({
      ...l,
      debit: l.credit,
      credit: l.debit,
      description: `عكس: ${l.description}`,
    })),
  };

  return {
    ...state,
    journalEntries: [
      reversal,
      ...state.journalEntries.map((j) => (j.id === targetJournalId ? { ...j, reversedByJournalId: revId } : j)),
    ],
    auditLogs: [
      {
        id: `AUD-${Date.now()}`,
        timestamp: `${dateStr} ${now.toTimeString().slice(0, 5)}`,
        user: 'المدير المالي',
        role: 'cfo',
        action: 'عكس قيد محاسبي (Reverse Entry)',
        entityType: 'JournalEntry',
        entityId: target.journalNo,
        details: `تم إنشاء القيد العكسي ${revNo} دون حذف القيد الأصلي`,
      },
      ...state.auditLogs,
    ],
  };
}

export function runDataQualityChecks(state: ErpState): DataQualityCheck[] {
  const tb = computeTrialBalanceTotals(state);
  const balances = computeAccountBalances(state);
  const clearing1103 = balances['1103'] ?? 0;

  const invErrors = state.ingredients.filter(
    (i) => Math.abs((i.openingQty + i.purchasedQty - i.issuedQty - i.wasteQty) - i.currentQty) > 0.5
  );
  const lowStock = state.ingredients.filter((i) => i.currentQty <= i.reorderLevel);

  const invoiceNumbers = state.salesInvoices.map((s) => s.invoiceNo);
  const duplicateInvoices = invoiceNumbers.length - new Set(invoiceNumbers).size;

  const vatMismatch = state.salesInvoices.filter((s) => {
    const expectedNet = round2(s.grossTotal / (1 + state.vatRate));
    return Math.abs(expectedNet - s.netSales) > 0.2;
  });

  const unmatchedBank = state.bankTransactions.filter((b) => b.matchStatus === 'unmatched');
  const suppliersApTotal = round2(
    state.suppliers.reduce((sum, s) => sum + s.aging0_30 + s.aging31_60 + s.aging61_90Plus, 0)
  );
  const glAp2101 = round2(balances['2101'] ?? 0);
  const apDiff = round2(Math.abs(suppliersApTotal - glAp2101));

  const inventoryBookVal = round2(
    state.ingredients.reduce((sum, i) => sum + i.currentQty * i.weightedAvgCost, 0)
  );
  const glInv1201 = round2(balances['1201'] ?? 0);
  const invValDiff = round2(Math.abs(inventoryBookVal - glInv1201));

  const matchedBankBalance = round2(
    state.bankTransactions
      .filter((b) => b.matchStatus === 'matched')
      .reduce((sum, b) => sum + (b.credit || 0) - (b.debit || 0), 0)
  );
  const glBank1102 = round2(balances['1102'] ?? 0);
  const bankDiff = round2(Math.abs(matchedBankBalance - glBank1102));

  return [
    {
      id: 'DQ-01',
      code: 'TB-BALANCE',
      titleAr: 'توازن ميزان المراجعة (Debit = Credit)',
      titleEn: 'Trial Balance Equilibrium',
      status: tb.balanced ? 'PASS' : 'ERROR',
      metricValue: `${tb.totalDebit.toLocaleString('en-US', { minimumFractionDigits: 2 })} ج.م`,
      detailAr: tb.balanced ? 'إجمالي المدين يطابق إجمالي الدائن بدقة 100% عبر جميع القيود.' : 'يوجد فرق في ميزان المراجعة يتطلب المراجعة.',
      detailEn: tb.balanced ? 'Total Debits strictly equal Total Credits across all ledger entries.' : 'Trial balance imbalance detected.',
    },
    {
      id: 'DQ-02',
      code: 'VISA-1103',
      titleAr: 'تسوية حساب تحصيل VISA/POS (كود 1103) حتى سبتمبر 2026',
      titleEn: 'VISA/POS Clearing Account (1103) through Sep 2026',
      status: Math.abs(clearing1103) < 0.05 ? 'PASS' : 'WARN',
      metricValue: `${clearing1103.toLocaleString('en-US', { minimumFractionDigits: 2 })} ج.م`,
      detailAr: Math.abs(clearing1103) < 0.05
        ? 'تم تصفير حساب 1103 بالكامل (4,629,455 ج.م) وتوريدها لبنك CIB مع استمرار متابعة عمولة مايو.'
        : 'توجد مبالغ تحت التسوية في حساب 1103 بانتظار الإيداع البنكي.',
      detailEn: Math.abs(clearing1103) < 0.05
        ? 'Account 1103 cleared to zero (4,629,455 EGP settled into CIB).'
        : 'Pending receivables remain in 1103.',
    },
    {
      id: 'DQ-03',
      code: 'INV-EQ',
      titleAr: 'معادلة المخزون وتطابق التقييم مع حساب 1201 (511,700 ج.م)',
      titleEn: 'Inventory Stock Equation & GL 1201 Valuation Sync',
      status: invErrors.length === 0 && invValDiff < 5 ? 'PASS' : 'ERROR',
      metricValue: `${inventoryBookVal.toLocaleString('en-US', { minimumFractionDigits: 2 })} ج.م`,
      detailAr:
        invErrors.length === 0 && invValDiff < 5
          ? `جميع أرصدة الخامات (${state.ingredients.length}) متطابقة كمياً وتقييمياً مع حساب الأستاذ 1201.`
          : `فروقات كمية (${invErrors.length}) أو فرق تقييم (${invValDiff} ج.م) مع حساب 1201.`,
      detailEn:
        invErrors.length === 0 && invValDiff < 5
          ? 'All ingredient quantities and valuation strictly match GL account 1201.'
          : `${invErrors.length} qty mismatches; GL 1201 diff=${invValDiff}.`,
    },
    {
      id: 'DQ-08',
      code: 'SUP-AP',
      titleAr: 'مطابقة أرصدة الموردين التفصيلية مع حساب الأستاذ 2101',
      titleEn: 'Suppliers Sub-Ledger vs GL AP (2101) Reconciliation',
      status: apDiff < 5 ? 'PASS' : 'WARN',
      metricValue: `${suppliersApTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })} ج.م`,
      detailAr:
        apDiff < 5
          ? `دفتر الموردين (${suppliersApTotal.toLocaleString('en-US')} ج.م) يطابق حساب 2101 بنسبة 100%.`
          : `يوجد فرق قدره ${apDiff.toLocaleString('en-US')} ج.م بين مجموع أعمار ديون الموردين ورصيد 2101 (${glAp2101.toLocaleString('en-US')}).`,
      detailEn:
        apDiff < 5
          ? 'Suppliers AP aging strictly matches GL 2101.'
          : `Sub-ledger vs GL 2101 difference of ${apDiff} EGP.`,
    },
    {
      id: 'DQ-04',
      code: 'VAT-14',
      titleAr: 'فصل ضريبة القيمة المضافة 14% والامتثال الضريبي (ETA & خصم 1%)',
      titleEn: '14% VAT Separation & ETA Compliance',
      status: vatMismatch.length === 0 ? 'PASS' : 'ERROR',
      metricValue: `${state.salesInvoices.length - vatMismatch.length}/${state.salesInvoices.length} فاتورة سليمة`,
      detailAr: 'جميع فواتير المبيعات تفصل 14% ضريبة مخرجات عن صافي الإيرادات تلقائياً (1,588,071 ج.م لـ 9M).',
      detailEn: 'All sales invoices cleanly separate 14% Output VAT from Net Revenue.',
    },
    {
      id: 'DQ-05',
      code: 'DUP-INV',
      titleAr: 'فحص تكرار أرقام الفواتير',
      titleEn: 'Duplicate Invoice Check',
      status: duplicateInvoices === 0 ? 'PASS' : 'ERROR',
      metricValue: `${duplicateInvoices} تكرار`,
      detailAr: 'لا توجد أرقام فواتير مكررة في سجلات المبيعات.',
      detailEn: 'Zero duplicate invoice numbers detected.',
    },
    {
      id: 'DQ-06',
      code: 'REORDER-ALERT',
      titleAr: 'تنبيهات حد إعادة الطلب للمخزون',
      titleEn: 'Low Stock Reorder Alerts',
      status: lowStock.length === 0 ? 'PASS' : 'WARN',
      metricValue: `${lowStock.length} أصناف تحت الحد`,
      detailAr: lowStock.length > 0 ? `الأصناف التي وصلت لحد الطلب: ${lowStock.map((i) => i.nameAr).join('، ')}` : 'جميع أرصدة الخامات أعلى من حد الطلب.',
      detailEn: lowStock.length > 0 ? `Below reorder threshold: ${lowStock.map((i) => i.nameEn).join(', ')}` : 'All stock above reorder level.',
    },
    {
      id: 'DQ-07',
      code: 'BANK-ANOMALY',
      titleAr: 'مطابقة كشف بنك CIB (حساب 1102) ورصد انحراف عمولة مايو',
      titleEn: 'CIB Bank (1102) Recon & May VISA Fee Anomaly',
      status: unmatchedBank.length === 0 && bankDiff < 5 ? 'PASS' : 'WARN',
      metricValue: `${unmatchedBank.length} حركة معلقة · ${matchedBankBalance.toLocaleString('en-US', { minimumFractionDigits: 0 })} ج`,
      detailAr:
        unmatchedBank.length > 0
          ? `رصيد الحركات المطابقة (${matchedBankBalance.toLocaleString('en-US')} ج.م) يطابق 1102 مع رصد ${unmatchedBank.length} حركة معلقة للمراجعة.`
          : bankDiff < 5
          ? 'كشف بنك CIB مطابق بنسبة 100% مع دفتر الأستاذ 1102.'
          : `يوجد فرق ${bankDiff.toLocaleString('en-US')} ج.م بين كشف البنك ورصيد 1102.`,
      detailEn:
        unmatchedBank.length > 0
          ? `${unmatchedBank.length} unmatched bank item(s) flagged; matched CIB matches GL 1102.`
          : '100% matched with CIB GL 1102.',
    },
  ];
}

export function computeStockOpportunityAlerts(state: ErpState): StockOpportunityAlert[] {
  const alerts: StockOpportunityAlert[] = [];

  for (const ing of state.ingredients) {
    const isCritical = ing.currentQty <= ing.reorderLevel;
    const isApproaching = !isCritical && ing.currentQty <= ing.reorderLevel * 1.25;
    if (!isCritical && !isApproaching) continue;

    const dailyBurnRate = round2(Math.max(0.2, ing.issuedQty / 270));
    const daysRemaining = round2(ing.currentQty / dailyBurnRate);

    const dependentMenus = state.menuItems.filter((m) =>
      m.recipe.some((r) => r.ingredientId === ing.id)
    );

    let dailyNetRev = 0;
    let dailyLostMargin = 0;
    for (const m of dependentMenus) {
      const dailyUnits = m.q1UnitsSold / 270;
      const netPrice = m.sellingPriceGross / (1 + state.vatRate);
      const bomCost = calculateRecipeCost(m, state.ingredients);
      const unitMargin = Math.max(0, netPrice - bomCost);
      dailyNetRev += dailyUnits * netPrice;
      dailyLostMargin += dailyUnits * unitMargin;
    }

    const dailyNetRevenueAtRisk = round2(dailyNetRev);
    const dailyOpportunityCost = round2(dailyLostMargin);
    const sevenDayOpportunityCost = round2(dailyOpportunityCost * 7);
    const suggestedOrderQty = Math.max(10, Math.ceil(dailyBurnRate * 21 + ing.reorderLevel - ing.currentQty));
    const estimatedOrderCostNet = round2(suggestedOrderQty * ing.lastPurchasePrice);

    alerts.push({
      ingredientId: ing.id,
      sku: ing.sku,
      nameAr: ing.nameAr,
      nameEn: ing.nameEn,
      unit: ing.unit,
      currentQty: ing.currentQty,
      reorderLevel: ing.reorderLevel,
      severity: isCritical ? 'critical' : 'approaching',
      dailyBurnRate,
      daysRemaining,
      affectedMenuItems: dependentMenus.map((m) => ({ id: m.id, nameAr: m.nameAr, nameEn: m.nameEn })),
      dailyNetRevenueAtRisk,
      dailyOpportunityCost,
      sevenDayOpportunityCost,
      suggestedOrderQty,
      estimatedOrderCostNet,
      preferredSupplierId: ing.preferredSupplierId,
    });
  }

  return alerts.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
    return b.sevenDayOpportunityCost - a.sevenDayOpportunityCost;
  });
}

export function computeFoodCostVarianceAnalysis(
  state: ErpState,
  period: '9m_ytd' | 'Q1' | 'Q2' | 'Q3' | '9m_plus_live',
  thresholdPct = 5
): FoodCostVarianceSummary {
  const ingMap = new Map(state.ingredients.map((i) => [i.id, i]));
  const liveWasteEntries = state.wasteEntries.filter((w) => !w.id.startsWith('WST-SEED-'));
  const liveWasteByIng = new Map<string, number>();
  for (const w of liveWasteEntries) {
    liveWasteByIng.set(w.ingredientId, (liveWasteByIng.get(w.ingredientId) || 0) + w.qty);
  }
  const liveWasteCostTotal = round2(
    state.wasteEntries.reduce((acc, w) => acc + w.totalValue, 0)
  );

  // Weighted theoretical recipe benchmark across menu mix
  let mixNetSales = 0;
  let mixBomCost = 0;
  let mixTargetCost = 0;

  for (const item of state.menuItems) {
    if (item.sellingPriceGross <= 0 || item.priceStatus === 'unspecified') continue;
    const netPrice = item.sellingPriceGross / (1 + state.vatRate);
    const bomUnitCost = calculateRecipeCost(item, state.ingredients);
    const targetUnitCost = netPrice * (item.targetFoodCostPct / 100);
    const units = Math.max(1, item.q1UnitsSold);
    mixNetSales += netPrice * units;
    mixBomCost += bomUnitCost * units;
    mixTargetCost += targetUnitCost * units;
  }

  const periodBomBaselinePct = mixNetSales > 0 ? round2((mixBomCost / mixNetSales) * 100) : 35;
  const periodTheoreticalPct = mixNetSales > 0 ? round2((mixTargetCost / mixNetSales) * 100) : 34;

  const rows =
    period === 'Q1' || period === 'Q2' || period === 'Q3'
      ? state.monthlyActuals2026.filter((m) => m.quarter === period)
      : state.monthlyActuals2026;

  const monthlySeries: FoodCostMonthlyVariance[] = rows.map((m) => {
    const theoreticalRecipeCost = round2(m.netRevenue * (periodTheoreticalPct / 100));
    const actualFoodCost = round2(m.cogs);
    const actualFoodCostPct = m.netRevenue > 0 ? round2((actualFoodCost / m.netRevenue) * 100) : 0;
    const varianceAmount = round2(actualFoodCost - theoreticalRecipeCost);
    const variancePct =
      theoreticalRecipeCost > 0 ? round2((varianceAmount / theoreticalRecipeCost) * 100) : 0;

    return {
      monthKey: m.monthKey,
      quarter: m.quarter,
      labelAr: m.labelAr,
      labelEn: m.labelEn,
      netRevenue: m.netRevenue,
      actualFoodCost,
      actualFoodCostPct,
      theoreticalRecipeCost,
      theoreticalRecipePct: periodTheoreticalPct,
      varianceAmount,
      variancePct,
      exceedsThreshold: variancePct > thresholdPct,
    };
  });

  if (period === '9m_plus_live') {
    const liveSales = state.salesInvoices.filter((s) => !s.id.startsWith('INV-SEED-'));
    const liveNet = round2(liveSales.reduce((a, s) => a + s.netSales, 0));
    const liveCogs = round2(liveSales.reduce((a, s) => a + s.cogsTotal, 0));
    const liveWasteAdded = round2(liveWasteEntries.reduce((a, w) => a + w.totalValue, 0));
    const actualLiveFoodCost = round2(liveCogs + liveWasteAdded);

    if (liveNet > 0 || actualLiveFoodCost > 0) {
      const theoreticalLive = round2(liveNet * (periodTheoreticalPct / 100));
      const varianceAmount = round2(actualLiveFoodCost - theoreticalLive);
      const variancePct =
        theoreticalLive > 0 ? round2((varianceAmount / theoreticalLive) * 100) : actualLiveFoodCost > 0 ? 100 : 0;
      monthlySeries.push({
        monthKey: '2026-10-live',
        quarter: 'Q4',
        labelAr: 'أكتوبر (مباشر + هالك)',
        labelEn: 'Oct (Live + Waste)',
        netRevenue: liveNet,
        actualFoodCost: actualLiveFoodCost,
        actualFoodCostPct: liveNet > 0 ? round2((actualLiveFoodCost / liveNet) * 100) : 0,
        theoreticalRecipeCost: theoreticalLive,
        theoreticalRecipePct: periodTheoreticalPct,
        varianceAmount,
        variancePct,
        exceedsThreshold: variancePct > thresholdPct,
      });
    }
  }

  const periodActualFoodCost = round2(monthlySeries.reduce((a, m) => a + m.actualFoodCost, 0));
  const periodTheoreticalRecipeCost = round2(
    monthlySeries.reduce((a, m) => a + m.theoreticalRecipeCost, 0)
  );
  const totalPeriodNet = round2(monthlySeries.reduce((a, m) => a + m.netRevenue, 0));
  const periodActualPct = totalPeriodNet > 0 ? round2((periodActualFoodCost / totalPeriodNet) * 100) : 0;
  const periodVarianceAmount = round2(periodActualFoodCost - periodTheoreticalRecipeCost);
  const periodVariancePct =
    periodTheoreticalRecipeCost > 0
      ? round2((periodVarianceAmount / periodTheoreticalRecipeCost) * 100)
      : 0;

  // Live invoice quantities per menu item
  const liveUnitsByMenu = new Map<string, number>();
  for (const inv of state.salesInvoices) {
    for (const line of inv.lines) {
      liveUnitsByMenu.set(line.menuItemId, (liveUnitsByMenu.get(line.menuItemId) || 0) + line.qty);
    }
  }

  // Kitchen execution multiplier reflects period variance beyond BOM
  const bomExecutionRatio =
    periodBomBaselinePct > 0 && periodActualPct > periodBomBaselinePct
      ? periodActualPct / periodBomBaselinePct
      : 1;

  const recipeVariances: FoodCostRecipeVariance[] = state.menuItems
    .map((item) => {
      const netSellingPrice = round2(item.sellingPriceGross / (1 + state.vatRate));
      const theoreticalRecipeCost = calculateRecipeCost(item, state.ingredients);
      const theoreticalRecipePct =
        netSellingPrice > 0 ? round2((theoreticalRecipeCost / netSellingPrice) * 100) : 0;
      const targetRecipeCost = round2(netSellingPrice * (item.targetFoodCostPct / 100));

      // Compute actual kitchen unit cost including live ingredient spoilage + supplier price drift + period over-portioning
      let actualBomPlusDrift = 0;
      let maxWasteGap = 0;
      let priceDriftEgp = 0;
      let worstIngredientNameAr = '';
      let worstIngredientNameEn = '';

      for (const rec of item.recipe) {
        const ing = ingMap.get(rec.ingredientId);
        if (!ing) continue;
        const yieldDiv = item.yieldPortions || 1;
        const liveExtraWasteQty = liveWasteByIng.get(ing.id) || 0;
        const actualWasteRatio =
          ing.issuedQty > 0
            ? ((ing.wasteQty + liveExtraWasteQty) / ing.issuedQty) * 100
            : rec.wastePct;
        const effectiveWastePct = Math.max(rec.wastePct, actualWasteRatio);
        const unitCostUsed = Math.max(ing.weightedAvgCost, ing.lastPurchasePrice);
        const lineBaseCost = (rec.qty * (1 + rec.wastePct / 100) * ing.weightedAvgCost) / yieldDiv;
        const lineActualCost = (rec.qty * (1 + effectiveWastePct / 100) * unitCostUsed) / yieldDiv;

        actualBomPlusDrift += lineActualCost;
        const lineDrift = lineActualCost - lineBaseCost;
        if (lineDrift > priceDriftEgp) {
          priceDriftEgp = lineDrift;
          worstIngredientNameAr = ing.nameAr;
          worstIngredientNameEn = ing.nameEn;
        }
        if (actualWasteRatio - rec.wastePct > maxWasteGap) {
          maxWasteGap = actualWasteRatio - rec.wastePct;
        }
      }

      const actualUnitFoodCost = round2(actualBomPlusDrift * bomExecutionRatio);
      const actualFoodCostPct =
        netSellingPrice > 0 ? round2((actualUnitFoodCost / netSellingPrice) * 100) : 0;
      const wasteAndPriceDriftPct =
        theoreticalRecipeCost > 0
          ? round2(((actualUnitFoodCost - theoreticalRecipeCost) / theoreticalRecipeCost) * 100)
          : 0;

      const varianceAmountPerUnit = round2(actualUnitFoodCost - targetRecipeCost);
      const variancePct =
        targetRecipeCost > 0 ? round2((varianceAmountPerUnit / targetRecipeCost) * 100) : 0;

      const unitsSold =
        Math.round((item.q1UnitsSold * rows.length) / 9) + (liveUnitsByMenu.get(item.id) || 0);
      const varianceTotalPeriod = round2(varianceAmountPerUnit * unitsSold);

      const isUnspecifiedPrice = item.sellingPriceGross <= 0 || item.priceStatus === 'unspecified';
      let driverAr = 'ضمن نطاق تكلفة الوصفة المستهدفة';
      let driverEn = 'Within theoretical recipe standard';
      if (isUnspecifiedPrice) {
        driverAr = 'غير محدد السعر في المنيو الأصلي — يتطلب تسعير من إدارة المنيو';
        driverEn = 'Price unspecified in original menu — awaiting pricing';
      } else if (variancePct > thresholdPct) {
        if (bomExecutionRatio > 1.03) {
          driverAr = `انحراف تشغيل المطبخ (+${round2((bomExecutionRatio - 1) * 100)}%) وتضخم ${worstIngredientNameAr || 'الخامات'}`;
          driverEn = `Kitchen portion/shrinkage (+${round2((bomExecutionRatio - 1) * 100)}%) & ${worstIngredientNameEn || 'input'} price drift`;
        } else if (maxWasteGap > 0.2 || priceDriftEgp > 0.3) {
          driverAr = `ارتفاع سعر التوريد والهدر في ${worstIngredientNameAr || 'المكونات'} مقابل الوصفة`;
          driverEn = `Supplier price & spoilage drift on ${worstIngredientNameEn || 'ingredients'} vs recipe`;
        } else {
          driverAr = `تكلفة الوصفة BOM (${theoreticalRecipePct}%) أعلى من سقف ${item.targetFoodCostPct}%`;
          driverEn = `BOM recipe cost (${theoreticalRecipePct}%) exceeds ${item.targetFoodCostPct}% target cap`;
        }
      }

      return {
        menuItemId: item.id,
        code: item.code,
        nameAr: item.nameAr,
        nameEn: item.nameEn,
        categoryAr: item.categoryAr,
        categoryEn: item.categoryEn,
        unitsSold,
        netSellingPrice,
        theoreticalRecipeCost,
        theoreticalRecipePct,
        targetRecipeCost,
        targetFoodCostPct: item.targetFoodCostPct,
        actualUnitFoodCost,
        actualFoodCostPct,
        wasteAndPriceDriftPct,
        varianceAmountPerUnit,
        varianceTotalPeriod,
        variancePct,
        exceedsThreshold: !isUnspecifiedPrice && variancePct > thresholdPct,
        driverAr,
        driverEn,
      };
    })
    .sort((a, b) => b.variancePct - a.variancePct);

  return {
    periodActualFoodCost,
    periodActualPct,
    periodTheoreticalRecipeCost,
    periodTheoreticalPct,
    periodBomBaselinePct,
    periodVarianceAmount,
    periodVariancePct,
    exceedsThreshold: periodVariancePct > thresholdPct,
    exceedingMonthsCount: monthlySeries.filter((m) => m.exceedsThreshold).length,
    exceedingRecipesCount: recipeVariances.filter((r) => r.exceedsThreshold).length,
    liveWasteCostTotal,
    monthlySeries,
    recipeVariances,
  };
}

export function applyStocktakeEntryAutomation(
  state: ErpState,
  payload: {
    ingredientId: string;
    actualQty: number;
    locationAr?: string;
    locationEn?: string;
    countedBy?: string;
    notes?: string;
  }
): { nextState: ErpState; entry: StocktakeEntry } {
  const ing = state.ingredients.find((i) => i.id === payload.ingredientId);
  if (!ing) {
    throw new Error('Ingredient not found for stocktake.');
  }

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toTimeString().slice(0, 5);
  const existing = state.stocktakeEntries ?? [];
  const seq = existing.length + 1;
  const countNo = `STK-2026-${dateStr.slice(5, 7)}${dateStr.slice(8, 10)}-${String(seq).padStart(2, '0')}`;

  const bookQty = round2(ing.currentQty);
  const actualQty = round2(Math.max(0, payload.actualQty));
  const varianceQty = round2(actualQty - bookQty);
  const variancePct = bookQty > 0 ? round2((varianceQty / bookQty) * 100) : actualQty > 0 ? 100 : 0;
  const unitCost = round2(ing.weightedAvgCost);
  const varianceValue = round2(varianceQty * unitCost);

  const entry: StocktakeEntry = {
    id: `STK-${Date.now()}-${seq}`,
    countNo,
    date: dateStr,
    branchId: state.activeBranchId,
    locationAr: payload.locationAr?.trim() || 'مخزن المطبخ الرئيسي',
    locationEn: payload.locationEn?.trim() || 'Main Kitchen Store',
    ingredientId: ing.id,
    sku: ing.sku,
    ingredientNameAr: ing.nameAr,
    ingredientNameEn: ing.nameEn,
    unit: ing.unit,
    bookQty,
    actualQty,
    varianceQty,
    variancePct,
    unitCost,
    varianceValue,
    status: Math.abs(varianceQty) < 0.01 ? 'reconciled' : 'pending_reconciliation',
    countedBy: payload.countedBy?.trim() || 'مراقب التكاليف — جرد مباشر',
    notes: payload.notes?.trim() || undefined,
    reconciledAt: Math.abs(varianceQty) < 0.01 ? `${dateStr} ${timeStr}` : undefined,
  };

  const nextState: ErpState = {
    ...state,
    stocktakeEntries: [entry, ...existing],
    auditLogs: [
      {
        id: `AUD-${Date.now()}-STK${seq}`,
        timestamp: `${dateStr} ${timeStr}`,
        user: entry.countedBy,
        role: 'manager',
        action: 'تسجيل سجل جرد فعلي للمخزون',
        entityType: 'StocktakeEntry',
        entityId: countNo,
        details: `${ing.nameAr}: دفتري ${bookQty} / فعلي ${actualQty} ${ing.unit} (انحراف ${variancePct.toFixed(2)}%)`,
      },
      ...state.auditLogs,
    ],
  };

  return { nextState, entry };
}

export function applyStocktakeReconciliationAutomation(
  state: ErpState,
  stocktakeId: string,
  actorName = 'المدير المالي / مراقب المخزون'
): ErpState {
  const existing = state.stocktakeEntries ?? [];
  const target = existing.find((e) => e.id === stocktakeId);
  if (!target || target.status === 'reconciled') return state;

  const nextIngredients = state.ingredients.map((i) => ({ ...i }));
  const ing = nextIngredients.find((i) => i.id === target.ingredientId);
  if (!ing) return state;

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toTimeString().slice(0, 5);
  const liveBookQty = round2(ing.currentQty);
  const diffQty = round2(target.actualQty - liveBookQty);
  const absDiffQty = round2(Math.abs(diffQty));
  const variancePct = liveBookQty > 0 ? round2((diffQty / liveBookQty) * 100) : 0;
  const unitCost = round2(ing.weightedAvgCost);
  const diffValue = round2(absDiffQty * unitCost);
  const signedDiffValue = round2(diffQty * unitCost);

  // Keep inventory equation (opening + purchased - issued - waste = currentQty) intact
  if (diffQty < 0) {
    ing.wasteQty = round2(ing.wasteQty + absDiffQty);
  } else if (diffQty > 0) {
    ing.purchasedQty = round2(ing.purchasedQty + absDiffQty);
  }
  ing.currentQty = round2(target.actualQty);

  const journalId = `JE-STK-${Date.now()}`;
  const journalNo = `JV-2026-${String(state.journalEntries.length + 1).padStart(4, '0')}`;
  const hasFinancialImpact = diffValue >= 0.01;

  const journal: JournalEntry | null = hasFinancialImpact
    ? {
        id: journalId,
        journalNo,
        date: dateStr,
        period: dateStr.slice(0, 7),
        source: 'stocktake_adjustment',
        referenceNo: target.countNo,
        description:
          diffQty < 0
            ? `تسوية عجز جرد فعلي (${ing.nameAr}: ${diffQty} ${ing.unit}) — ${target.countNo}`
            : `تسوية فائض جرد فعلي (${ing.nameAr}: +${diffQty} ${ing.unit}) — ${target.countNo}`,
        createdBy: actorName,
        lines:
          diffQty < 0
            ? [
                {
                  lineNo: 1,
                  accountCode: '5305',
                  accountNameAr: 'مصروف هالك وفروقات جرد المخزون',
                  description: `تسوية عجز جرد ${target.countNo} (${absDiffQty} ${ing.unit})`,
                  debit: diffValue,
                  credit: 0,
                  branchId: state.activeBranchId,
                  costCenter: 'CC-KITCHEN',
                },
                {
                  lineNo: 2,
                  accountCode: '1201',
                  accountNameAr: 'مخزون المواد الخام',
                  description: `تعديل الرصيد الدفتري للجرد الفعلي ${target.countNo}`,
                  debit: 0,
                  credit: diffValue,
                  branchId: state.activeBranchId,
                  costCenter: 'CC-KITCHEN',
                },
              ]
            : [
                {
                  lineNo: 1,
                  accountCode: '1201',
                  accountNameAr: 'مخزون المواد الخام',
                  description: `إثبات فائض جرد فعلي ${target.countNo} (+${absDiffQty} ${ing.unit})`,
                  debit: diffValue,
                  credit: 0,
                  branchId: state.activeBranchId,
                  costCenter: 'CC-KITCHEN',
                },
                {
                  lineNo: 2,
                  accountCode: '5305',
                  accountNameAr: 'مصروف هالك وفروقات جرد المخزون',
                  description: `تخفيض فروقات الجرد بفائض فعلي ${target.countNo}`,
                  debit: 0,
                  credit: diffValue,
                  branchId: state.activeBranchId,
                  costCenter: 'CC-KITCHEN',
                },
              ],
      }
    : null;

  const updatedEntries = existing.map((e) =>
    e.id === stocktakeId
      ? {
          ...e,
          bookQty: liveBookQty,
          varianceQty: diffQty,
          variancePct,
          unitCost,
          varianceValue: signedDiffValue,
          status: 'reconciled' as const,
          reconciledAt: `${dateStr} ${timeStr}`,
          reconciliationJournalId: journal ? journal.id : undefined,
        }
      : e
  );

  return {
    ...state,
    ingredients: nextIngredients,
    stocktakeEntries: updatedEntries,
    journalEntries: journal ? [journal, ...state.journalEntries] : state.journalEntries,
    auditLogs: [
      {
        id: `AUD-${Date.now()}-RECON`,
        timestamp: `${dateStr} ${timeStr}`,
        user: actorName,
        role: 'cfo',
        action: 'تسوية فارق الجرد الفعلي آلياً',
        entityType: 'StocktakeEntry',
        entityId: target.countNo,
        details: `${ing.nameAr}: تسوية ${diffQty >= 0 ? '+' : ''}${diffQty} ${ing.unit} (${signedDiffValue.toFixed(2)} ج.م)${journal ? ` — قيد ${journalNo}` : ''}`,
      },
      ...state.auditLogs,
    ],
  };
}

export function computeStocktakeVarianceAlerts(
  state: ErpState,
  thresholdPct = 2
): StocktakeVarianceSummary {
  const ingMap = new Map(state.ingredients.map((i) => [i.id, i]));
  const entries = state.stocktakeEntries ?? [];

  const items: StocktakeVarianceAlertItem[] = entries
    .map((entry) => {
      const ing = ingMap.get(entry.ingredientId);
      const liveBookQty =
        entry.status === 'pending_reconciliation' && ing ? round2(ing.currentQty) : round2(entry.bookQty);
      const varianceQty =
        entry.status === 'pending_reconciliation'
          ? round2(entry.actualQty - liveBookQty)
          : round2(entry.varianceQty);
      const signedVariancePct =
        entry.status === 'pending_reconciliation'
          ? liveBookQty > 0
            ? round2((varianceQty / liveBookQty) * 100)
            : entry.actualQty > 0
            ? 100
            : 0
          : round2(entry.variancePct);
      const absVariancePct = round2(Math.abs(signedVariancePct));
      const unitCost = ing ? ing.weightedAvgCost : entry.unitCost;
      const varianceValue =
        entry.status === 'pending_reconciliation'
          ? round2(varianceQty * unitCost)
          : round2(entry.varianceValue);
      const exceedsThreshold = absVariancePct > thresholdPct;
      const direction: 'shortage' | 'surplus' | 'exact' =
        varianceQty < -0.005 ? 'shortage' : varianceQty > 0.005 ? 'surplus' : 'exact';

      return {
        entry,
        liveBookQty,
        varianceQty,
        signedVariancePct,
        absVariancePct,
        varianceValue,
        exceedsThreshold,
        direction,
      };
    })
    .sort((a, b) => {
      if (a.entry.status !== b.entry.status) {
        return a.entry.status === 'pending_reconciliation' ? -1 : 1;
      }
      return b.absVariancePct - a.absVariancePct;
    });

  const pendingItems = items.filter((i) => i.entry.status === 'pending_reconciliation');
  const pendingExceeding = pendingItems.filter((i) => i.exceedsThreshold);
  const reconciledItems = items.filter((i) => i.entry.status === 'reconciled');
  const withinTolerance = items.filter((i) => !i.exceedsThreshold);

  const netVarianceValue = round2(pendingItems.reduce((acc, i) => acc + i.varianceValue, 0));
  const totalShortageValue = round2(
    pendingItems.filter((i) => i.varianceValue < 0).reduce((acc, i) => acc + Math.abs(i.varianceValue), 0)
  );
  const totalSurplusValue = round2(
    pendingItems.filter((i) => i.varianceValue > 0).reduce((acc, i) => acc + i.varianceValue, 0)
  );
  const maxAbsVariancePct = pendingItems.reduce((m, i) => Math.max(m, i.absVariancePct), 0);

  return {
    items,
    pendingExceedingCount: pendingExceeding.length,
    pendingCount: pendingItems.length,
    reconciledCount: reconciledItems.length,
    withinToleranceCount: withinTolerance.length,
    totalCountedItems: items.length,
    netVarianceValue,
    totalShortageValue,
    totalSurplusValue,
    maxAbsVariancePct: round2(maxAbsVariancePct),
  };
}

export async function exportErpWorkbook(state: ErpState): Promise<void> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const balances = computeAccountBalances(state);
  const dq = runDataQualityChecks(state);

  // 1. CONTROL_PANEL
  const controlRows = [
    ['شركة استادات لإدارة المنشآت الرياضية — برج المنوفية (تحديث أكتوبر 2026 واستراتيجية 2027)', ''],
    ['الرقم الضريبي (ق.م)', state.taxId],
    ['تاريخ التسليم / التقرير', state.reportDate],
    ['نسبة ضريبة القيمة المضافة', `${(state.vatRate * 100).toFixed(0)}%`],
    ['حساب 1103 (VISA/POS تحت التسوية)', balances['1103'] ?? 0],
    ['رصيد بنك CIB (1102)', balances['1102'] ?? 0],
    ['إجمالي إيرادات 9M 2026 (يناير–سبتمبر)', state.strategy2027.actual9MSummary.grossRevenue],
    ['صافي إيرادات 9M 2026 (بعد VAT)', state.strategy2027.actual9MSummary.netRevenue],
    ['صافي النتيجة 9M 2026', state.strategy2027.actual9MSummary.netResult],
    ['جرد سبتمبر 2026 (333 صنف / 5 مواقع)', state.strategy2027.actual9MSummary.endingSepInventoryValue],
    ['الأصول الثابتة (تكلفة / صافي دفتري)', `${state.strategy2027.actual9MSummary.fixedAssetsCost} / ${state.strategy2027.actual9MSummary.fixedAssetsNbvEnd2026}`],
    ['إيجار حق الانتفاع 2027 (+2% أغسطس)', 5100000],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(controlRows), 'CONTROL_PANEL');

  // 2. 9M_2026_PL
  const plRows = state.monthlyActuals2026.map((m) => ({
    الشهر: m.labelAr,
    الربع: m.quarter,
    'الإيرادات الإجمالية': m.grossRevenue,
    'صافي الإيرادات': m.netRevenue,
    'ضريبة ق.م 14%': m.vatOutput,
    'تكلفة البضاعة COGS': m.cogs,
    'مجمل الربح GP': m.grossProfit,
    'هامش GP %': `${m.gpMarginPct}%`,
    'الرواتب والمنح': m.payroll,
    'حق الانتفاع': m.usufructRent,
    'الكهرباء': m.electricity,
    'إجمالي المصروفات التشغيلية': m.totalOpexInclRent,
    'مصروفات بنكية صافية': m.bankFeesNet,
    'صافي النتيجة': m.netProfit,
    'بدون حق الانتفاع': round2(m.netProfit + m.usufructRent),
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(plRows), '9M_2026_ACTUALS');

  // 3. STRATEGY_2027
  const stratRows = state.strategy2027.scenarios.map((s) => ({
    السيناريو: s.nameAr,
    'صافي الإيراد المستهدف': s.netRevenue,
    'نسبة النمو %': `${s.growthPct}%`,
    'COGS %': `${s.cogsPct}%`,
    'الرواتب المستهدفة': s.payroll,
    'حق الانتفاع': s.usufructRent,
    'مصاريف تشغيل أخرى': s.otherOpex,
    'مصروفات بنكية': s.bankFees,
    'صافي النتيجة المتوقعة': s.netResult,
    'التعادل الشهري': s.monthlyBreakEven,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(stratRows), 'STRATEGY_2027');

  // 4. CHART_OF_ACCOUNTS
  const coaRows = state.accounts.map((a) => ({
    'كود الحساب': a.code,
    'اسم الحساب': a.nameAr,
    'Account Name': a.nameEn,
    'النوع': a.type,
    'الطبيعة': a.normalBalance,
    'الرصيد الحالي (ج.م)': balances[a.code] ?? 0,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(coaRows), 'CHART_OF_ACCOUNTS');

  // 5. INGREDIENTS
  const ingRows = state.ingredients.map((i) => ({
    'كود الصنف': i.sku,
    'اسم الخامة': i.nameAr,
    'الوحدة': i.unit,
    'افتتاحي': i.openingQty,
    'مشتريات': i.purchasedQty,
    'منصرف': i.issuedQty,
    'هالك': i.wasteQty,
    'الرصيد الحالي': i.currentQty,
    'المتوسط المرجح WAC': i.weightedAvgCost,
    'القيمة الإجمالية': round2(i.currentQty * i.weightedAvgCost),
    'حد إعادة الطلب': i.reorderLevel,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ingRows), 'INGREDIENTS');

  // 6. MENU_RECIPES
  const menuRows = state.menuItems.map((m) => {
    const cost = calculateRecipeCost(m, state.ingredients);
    const netPrice = m.sellingPriceGross > 0 ? round2(m.sellingPriceGross / (1 + state.vatRate)) : 0;
    const fcPct = netPrice > 0 ? round2((cost / netPrice) * 100) : 0;
    return {
      'م': m.menuNo ?? '',
      'كود': m.code,
      'الصنف': m.nameAr,
      'الوصف': m.descriptionAr || '',
      'القسم': m.categoryAr,
      'نوع الإدراج': m.listingType || 'مطبوع',
      'السعر الأساسي': m.basePrice ?? 'غير محدد',
      'السعر شامل 12% خدمة': m.priceInclService ?? 'غير محدد',
      'سعر البيع شامل الضريبة': m.sellingPriceGross,
      'سعر البيع صافي': netPrice,
      'تكلفة الوصفة BOM': cost,
      'Food Cost %': m.sellingPriceGross > 0 ? `${fcPct}%` : 'غير محدد',
      'السعر المقترح (<35%)': suggestOptimalPriceGross(cost, m.targetFoodCostPct, state.vatRate),
      'مبيعات الفترة (وحدة)': m.q1UnitsSold,
    };
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(menuRows), 'MENU_ENGINEERING');

  // 7. SALES
  const salesRows = state.salesInvoices.map((s) => ({
    'رقم الفاتورة': s.invoiceNo,
    'التاريخ': s.date,
    'الوقت': s.time,
    'النوع': s.orderType,
    'طريقة الدفع': s.paymentMethod,
    'الإجمالي شامل الضريبة': s.grossTotal,
    'صافي المبيعات': s.netSales,
    'ضريبة 14%': s.vatAmount,
    'التكلفة COGS': s.cogsTotal,
    'حالة ETA': s.etaStatus,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(salesRows), 'SALES_INVOICES');

  // 8. JOURNAL_LINES
  const journalRows = state.journalEntries.flatMap((j) =>
    j.lines.map((l) => ({
      'رقم القيد': j.journalNo,
      'التاريخ': j.date,
      'المصدر': j.source,
      'المرجع': j.referenceNo,
      'كود الحساب': l.accountCode,
      'اسم الحساب': l.accountNameAr,
      'البيان': l.description,
      'مدين': l.debit,
      'دائن': l.credit,
    }))
  );
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(journalRows), 'JOURNAL_LINES');

  // 9. BANK_RECON & VISA_FEES
  const bankRows = state.bankTransactions.map((b) => ({
    'المرجع البنكي': b.bankRef,
    'التاريخ': b.date,
    'البيان': b.description,
    'مدين (خارج)': b.debit,
    'دائن (داخل)': b.credit,
    'الحالة': b.matchStatus,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(bankRows), 'BANK_RECON');

  const visaRows = state.strategy2027.visaMonthlyFees.map((v) => ({
    الشهر: v.labelAr,
    'مبيعات الفيزا POS': v.visaSales,
    'المحصل بالبنك': v.bankSettled,
    'العمولة': v.feeAmount,
    'النسبة %': `${v.feePct}%`,
    'انحراف؟': v.anomaly ? 'نعم - مراجعة' : 'طبيعي',
    ملاحظة: v.noteAr,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(visaRows), 'VISA_FEE_ANALYSIS');

  // 10. DATA_QUALITY
  const dqRows = dq.map((c) => ({
    'الكود': c.code,
    'الفحص': c.titleAr,
    'الحالة': c.status,
    'القيمة': c.metricValue,
    'التفاصيل': c.detailAr,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dqRows), 'DATA_QUALITY');

  XLSX.writeFile(wb, 'Estadat_AlBorg_Restaurant_ERP_Oct2026_Strategy2027.xlsx');
}

export type VatReportPeriod =
  | 'all_incl_live'
  | '9m_ytd'
  | 'Q1'
  | 'Q2'
  | 'Q3'
  | 'live_oct'
  | '2026-01'
  | '2026-02'
  | '2026-03'
  | '2026-04'
  | '2026-05'
  | '2026-06'
  | '2026-07'
  | '2026-08'
  | '2026-09';

export interface VatReportMonthlyRow {
  key: string;
  labelAr: string;
  labelEn: string;
  quarter: string;
  grossSales: number;
  netSales: number;
  outputVat: number;
  taxablePurchasesNet: number;
  inputVat: number;
  netPayable: number;
  offsetPct: number;
  isLive?: boolean;
}

export interface VatTaxJournalRow {
  journalId: string;
  journalNo: string;
  date: string;
  period: string;
  accountCode: '2201' | '1105';
  accountNameAr: string;
  description: string;
  debit: number;
  credit: number;
  netEffect: number;
  source: string;
}

export interface VatReportSummary {
  period: VatReportPeriod;
  periodLabelAr: string;
  periodLabelEn: string;
  vatRate: number;
  grossSalesTotal: number;
  netSalesTotal: number;
  outputVatTotal: number;
  taxablePurchasesNet: number;
  taxableExpensesNet: number;
  inputVatPurchases: number;
  inputVatExpenses: number;
  inputVatTotal: number;
  netVatPayable: number;
  recoveryRatioPct: number;
  effectiveVatPct: number;
  glOutput2201: number;
  glInput1105: number;
  glNetPayable: number;
  glVariance: number;
  etaSubmittedCount: number;
  etaQueuedCount: number;
  monthlyRows: VatReportMonthlyRow[];
  salesInvoices: SalesInvoice[];
  purchaseInvoices: PurchaseInvoice[];
  taxableExpenses: ExpenseEntry[];
  taxJournalRows: VatTaxJournalRow[];
}

export function computeVatReportSummary(
  state: ErpState,
  period: VatReportPeriod
): VatReportSummary {
  const balances = computeAccountBalances(state);
  const vatRate = state.vatRate || 0.14;
  const audited9MCogs = state.monthlyActuals2026.reduce((a, m) => a + m.cogs, 0);
  const audited9MInputVat = 585000;

  const isSingleMonth = period.startsWith('2026-');
  const includeAuditedMonths = period !== 'live_oct';
  const includeLiveOps = period === 'all_incl_live' || period === 'live_oct';

  const selectedActualMonths = includeAuditedMonths
    ? state.monthlyActuals2026.filter((m) => {
        if (period === 'Q1' || period === 'Q2' || period === 'Q3') return m.quarter === period;
        if (isSingleMonth) return m.monthKey === period;
        return true;
      })
    : [];

  const monthlyRows: VatReportMonthlyRow[] = selectedActualMonths.map((m) => {
    const inputVat = round2(audited9MCogs > 0 ? (m.cogs / audited9MCogs) * audited9MInputVat : 0);
    const purchasesNet = round2(vatRate > 0 ? inputVat / vatRate : 0);
    const netPayable = round2(m.vatOutput - inputVat);
    const offsetPct = m.vatOutput > 0 ? round2((inputVat / m.vatOutput) * 100) : 0;
    return {
      key: m.monthKey,
      labelAr: m.labelAr,
      labelEn: m.labelEn,
      quarter: m.quarter,
      grossSales: round2(m.grossRevenue),
      netSales: round2(m.netRevenue),
      outputVat: round2(m.vatOutput),
      taxablePurchasesNet: purchasesNet,
      inputVat,
      netPayable,
      offsetPct,
    };
  });

  // Live operational transactions (beyond the 9M audited close)
  const liveSales = state.salesInvoices.filter((s) => !s.id.startsWith('INV-SEED-'));
  const liveSalesGross = round2(liveSales.reduce((a, s) => a + s.grossTotal, 0));
  const liveSalesNet = round2(liveSales.reduce((a, s) => a + s.netSales, 0));
  const liveSalesVat = round2(liveSales.reduce((a, s) => a + s.vatAmount, 0));

  const livePurchases = state.purchaseInvoices.filter((p) => !p.id.startsWith('PO-SEED-'));
  const livePurchasesNet = round2(livePurchases.reduce((a, p) => a + p.totalBeforeTax, 0));
  const livePurchasesVat = round2(livePurchases.reduce((a, p) => a + p.vatAmount, 0));

  const liveTaxableExp = state.expenses.filter((e) => !e.id.startsWith('EXP-SEED-') && e.vatAmount > 0);
  const liveExpensesNet = round2(liveTaxableExp.reduce((a, e) => a + e.amountNet, 0));
  const liveExpensesVat = round2(liveTaxableExp.reduce((a, e) => a + e.vatAmount, 0));

  if (includeLiveOps && (liveSales.length > 0 || livePurchases.length > 0 || liveTaxableExp.length > 0 || period === 'live_oct')) {
    const liveInputTotal = round2(livePurchasesVat + liveExpensesVat);
    const livePurchasesCombinedNet = round2(livePurchasesNet + liveExpensesNet);
    const liveNetPayable = round2(liveSalesVat - liveInputTotal);
    const liveOffsetPct = liveSalesVat > 0 ? round2((liveInputTotal / liveSalesVat) * 100) : 0;
    monthlyRows.push({
      key: '2026-10-live',
      labelAr: 'أكتوبر 2026 (تشغيلي مباشر)',
      labelEn: 'Oct 2026 (Live Operations)',
      quarter: 'Q4',
      grossSales: liveSalesGross,
      netSales: liveSalesNet,
      outputVat: liveSalesVat,
      taxablePurchasesNet: livePurchasesCombinedNet,
      inputVat: liveInputTotal,
      netPayable: liveNetPayable,
      offsetPct: liveOffsetPct,
      isLive: true,
    });
  }

  const baseGross = round2(selectedActualMonths.reduce((a, m) => a + m.grossRevenue, 0));
  const baseNet = round2(selectedActualMonths.reduce((a, m) => a + m.netRevenue, 0));
  const baseOutputVat = round2(selectedActualMonths.reduce((a, m) => a + m.vatOutput, 0));
  const baseInputVat = round2(
    monthlyRows.filter((r) => !r.isLive).reduce((a, r) => a + r.inputVat, 0)
  );
  const basePurchasesNet = round2(vatRate > 0 ? baseInputVat / vatRate : 0);

  const grossSalesTotal = round2(baseGross + (includeLiveOps ? liveSalesGross : 0));
  const netSalesTotal = round2(baseNet + (includeLiveOps ? liveSalesNet : 0));
  const outputVatTotal = round2(baseOutputVat + (includeLiveOps ? liveSalesVat : 0));
  const taxablePurchasesNet = round2(basePurchasesNet + (includeLiveOps ? livePurchasesNet : 0));
  const taxableExpensesNet = round2(includeLiveOps ? liveExpensesNet : 0);
  const inputVatPurchases = round2(baseInputVat + (includeLiveOps ? livePurchasesVat : 0));
  const inputVatExpenses = round2(includeLiveOps ? liveExpensesVat : 0);
  const inputVatTotal = round2(inputVatPurchases + inputVatExpenses);
  const netVatPayable = round2(outputVatTotal - inputVatTotal);
  const recoveryRatioPct = outputVatTotal > 0 ? round2((inputVatTotal / outputVatTotal) * 100) : 0;
  const effectiveVatPct = netSalesTotal > 0 ? round2((outputVatTotal / netSalesTotal) * 100) : 0;

  const glOutput2201 = round2(balances['2201'] ?? 0);
  const glInput1105 = round2(balances['1105'] ?? 0);
  const glNetPayable = round2(glOutput2201 - glInput1105);
  const glVariance = round2(
    period === 'all_incl_live' || period === '9m_ytd'
      ? (period === 'all_incl_live' ? netVatPayable - glNetPayable : 0)
      : 0
  );

  // Filter invoice registers for selected period
  const matchesQuarter = (dateStr: string, q: 'Q1' | 'Q2' | 'Q3') => {
    const m = dateStr.slice(0, 7);
    if (q === 'Q1') return m >= '2026-01' && m <= '2026-03';
    if (q === 'Q2') return m >= '2026-04' && m <= '2026-06';
    return m >= '2026-07' && m <= '2026-09';
  };

  const matchesInvoicePeriod = (dateStr: string) => {
    if (period === 'all_incl_live') return true;
    if (period === 'live_oct') return dateStr.slice(0, 7) >= '2026-10';
    if (period === '9m_ytd') return dateStr.slice(0, 7) <= '2026-09';
    if (period === 'Q1' || period === 'Q2' || period === 'Q3') return matchesQuarter(dateStr, period);
    return dateStr.slice(0, 7) === period;
  };

  const salesInvoices = state.salesInvoices.filter((s) => matchesInvoicePeriod(s.date));
  const purchaseInvoices = state.purchaseInvoices.filter((p) => matchesInvoicePeriod(p.date));
  const taxableExpenses = state.expenses.filter((e) => e.vatAmount > 0 && matchesInvoicePeriod(e.date));

  const taxJournalRows: VatTaxJournalRow[] = state.journalEntries
    .filter((je) => {
      if (period === 'all_incl_live') return true;
      if (period === 'live_oct') return je.period >= '2026-10';
      if (period === '9m_ytd') return je.period <= '2026-09';
      if (period === 'Q1') return je.period >= '2026-01' && je.period <= '2026-03';
      if (period === 'Q2') return je.period >= '2026-04' && je.period <= '2026-06';
      if (period === 'Q3') return je.period >= '2026-07' && je.period <= '2026-09';
      return je.period === period;
    })
    .flatMap((je) =>
      je.lines
        .filter((l) => l.accountCode === '2201' || l.accountCode === '1105')
        .map((l) => ({
          journalId: je.id,
          journalNo: je.journalNo,
          date: je.date,
          period: je.period,
          accountCode: l.accountCode as '2201' | '1105',
          accountNameAr: l.accountNameAr,
          description: l.description,
          debit: round2(l.debit),
          credit: round2(l.credit),
          netEffect: l.accountCode === '2201' ? round2(l.credit - l.debit) : round2(l.debit - l.credit),
          source: je.source,
        }))
    );

  const etaSubmittedCount = salesInvoices.filter((s) => s.etaStatus === 'submitted').length;
  const etaQueuedCount = salesInvoices.filter((s) => s.etaStatus === 'queued_offline').length;

  const monthObj = isSingleMonth
    ? state.monthlyActuals2026.find((m) => m.monthKey === period)
    : undefined;

  const periodLabels: Record<string, { ar: string; en: string }> = {
    all_incl_live: {
      ar: 'كامل الفترة المالية + العمليات المباشرة (يناير – أكتوبر 2026)',
      en: 'Full Fiscal Period + Live Operations (Jan – Oct 2026)',
    },
    '9m_ytd': {
      ar: 'الأشهر التسعة المدققة (يناير – سبتمبر 2026)',
      en: 'Audited 9M YTD (Jan – Sep 2026)',
    },
    Q1: {
      ar: 'الربع الأول Q1 (يناير – مارس 2026)',
      en: 'Q1 2026 (Jan – Mar)',
    },
    Q2: {
      ar: 'الربع الثاني Q2 (أبريل – يونيو 2026)',
      en: 'Q2 2026 (Apr – Jun)',
    },
    Q3: {
      ar: 'الربع الثالث Q3 (يوليو – سبتمبر 2026)',
      en: 'Q3 2026 (Jul – Sep)',
    },
    live_oct: {
      ar: 'الفترة الجارية (أكتوبر 2026 — الفواتير المباشرة)',
      en: 'Current Period (Oct 2026 — Live Invoices)',
    },
  };

  const resolvedLabel = monthObj
    ? { ar: `شهر ${monthObj.labelAr}`, en: monthObj.labelEn }
    : periodLabels[period] ?? { ar: period, en: period };

  return {
    period,
    periodLabelAr: resolvedLabel.ar,
    periodLabelEn: resolvedLabel.en,
    vatRate,
    grossSalesTotal,
    netSalesTotal,
    outputVatTotal,
    taxablePurchasesNet,
    taxableExpensesNet,
    inputVatPurchases,
    inputVatExpenses,
    inputVatTotal,
    netVatPayable,
    recoveryRatioPct,
    effectiveVatPct,
    glOutput2201,
    glInput1105,
    glNetPayable,
    glVariance,
    etaSubmittedCount,
    etaQueuedCount,
    monthlyRows,
    salesInvoices,
    purchaseInvoices,
    taxableExpenses,
    taxJournalRows,
  };
}

export interface BankAutoMatchOptions {
  maxDateDiffDays?: number;
  maxAmountTolerancePct?: number;
  dismissedBankIds?: string[];
}

export interface BankPurchaseMatchCandidate {
  id: string;
  bankTxn: BankTransaction;
  purchaseInvoice: PurchaseInvoice;
  supplierNameEn: string;
  bankAmount: number;
  invoiceAmount: number;
  amountDiff: number;
  absAmountDiff: number;
  amountDiffPct: number;
  dateDiffDays: number;
  absDateDiffDays: number;
  confidenceScore: number;
  matchTier: 'exact' | 'high' | 'medium';
  reasonsAr: string[];
  reasonsEn: string[];
}

export interface BankAutoMatchSummary {
  unmatchedOutflowCount: number;
  openPurchaseCount: number;
  suggestedMatches: BankPurchaseMatchCandidate[];
  alternativesByBankTxnId: Record<string, BankPurchaseMatchCandidate[]>;
  totalMatchedValue: number;
  exactOrHighCount: number;
}

function parseIsoDateMs(dateStr: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || '').trim());
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function computeBankPurchaseAutoMatches(
  state: ErpState,
  options?: BankAutoMatchOptions
): BankAutoMatchSummary {
  const maxDateDiffDays = Math.max(0, options?.maxDateDiffDays ?? 7);
  const maxAmountTolerancePct = Math.max(0, options?.maxAmountTolerancePct ?? 2);
  const dismissedSet = new Set(options?.dismissedBankIds ?? []);

  const unmatchedOutflows = state.bankTransactions.filter(
    (bt) => bt.matchStatus === 'unmatched' && bt.debit > 0 && !dismissedSet.has(bt.id)
  );
  const openPurchases = state.purchaseInvoices.filter((po) => po.paymentStatus === 'credit');
  const supplierById = new Map(state.suppliers.map((s) => [s.id, s]));

  const allCandidates: BankPurchaseMatchCandidate[] = [];
  const alternativesByBankTxnId: Record<string, BankPurchaseMatchCandidate[]> = {};

  for (const bt of unmatchedOutflows) {
    const btMs = parseIsoDateMs(bt.date);
    const bankAmount = round2(bt.debit);
    const descLower = `${bt.bankRef} ${bt.description}`.toLowerCase();
    const rowCandidates: BankPurchaseMatchCandidate[] = [];

    for (const po of openPurchases) {
      const poMs = parseIsoDateMs(po.date);
      if (!Number.isFinite(btMs) || !Number.isFinite(poMs)) continue;

      const dateDiffDays = Math.round((btMs - poMs) / 86400000);
      const absDateDiffDays = Math.abs(dateDiffDays);
      if (absDateDiffDays > maxDateDiffDays) continue;

      const invoiceAmount = round2(po.grandTotal);
      if (invoiceAmount <= 0) continue;

      const amountDiff = round2(bankAmount - invoiceAmount);
      const absAmountDiff = round2(Math.abs(amountDiff));
      const amountDiffPct = round2((absAmountDiff / invoiceAmount) * 100);

      // Allow <= 1 EGP rounding even when Exact (0%) is selected
      if (absAmountDiff > 1 && amountDiffPct > maxAmountTolerancePct) continue;

      const sup = supplierById.get(po.supplierId);
      const poTokens = [
        po.purchaseNo.toLowerCase(),
        po.purchaseNo.replace(/[^0-9]/g, '').slice(-4),
        po.supplierNameAr.toLowerCase(),
        (sup?.nameEn ?? '').toLowerCase(),
      ].filter((tok) => tok.length >= 3);

      const hasTextRefMatch = poTokens.some((tok) => {
        if (tok.includes(' ')) {
          return tok
            .split(/\s+/)
            .filter((w) => w.length >= 3 && w !== 'مزارع' && w !== 'شركة')
            .some((w) => descLower.includes(w));
        }
        return descLower.includes(tok);
      });

      const tolDenom = Math.max(0.5, maxAmountTolerancePct);
      const amountScore =
        absAmountDiff <= 0.05 ? 65 : 65 * Math.max(0, 1 - amountDiffPct / tolDenom);
      const dateScore =
        maxDateDiffDays === 0
          ? absDateDiffDays === 0
            ? 25
            : 0
          : 25 * Math.max(0, 1 - absDateDiffDays / maxDateDiffDays);
      const contextBonus = (hasTextRefMatch ? 7 : 0) + (dateDiffDays >= 0 ? 3 : 0);
      const confidenceScore = Math.min(100, Math.max(1, Math.round(amountScore + dateScore + contextBonus)));

      const matchTier: 'exact' | 'high' | 'medium' =
        absAmountDiff <= 1 && absDateDiffDays <= 2 && confidenceScore >= 85
          ? 'exact'
          : confidenceScore >= 70
          ? 'high'
          : 'medium';

      const reasonsAr: string[] = [];
      const reasonsEn: string[] = [];
      if (absAmountDiff <= 1) {
        reasonsAr.push('تطابق تام للمبلغ');
        reasonsEn.push('Exact Amount');
      } else {
        reasonsAr.push(`قرب المبلغ (${amountDiff >= 0 ? '+' : ''}${amountDiff.toFixed(0)} ج)`);
        reasonsEn.push(`Amount Δ ${amountDiff >= 0 ? '+' : ''}${amountDiff.toFixed(0)} EGP`);
      }

      if (absDateDiffDays === 0) {
        reasonsAr.push('نفس تاريخ الفاتورة');
        reasonsEn.push('Same Date');
      } else {
        reasonsAr.push(`فارق ${dateDiffDays >= 0 ? '+' : ''}${dateDiffDays} يوم`);
        reasonsEn.push(`Date ${dateDiffDays >= 0 ? '+' : ''}${dateDiffDays}d`);
      }

      if (hasTextRefMatch) {
        reasonsAr.push('تطابق وصف المورد/المرجع');
        reasonsEn.push('Ref/Supplier Match');
      }

      rowCandidates.push({
        id: `${bt.id}__${po.id}`,
        bankTxn: bt,
        purchaseInvoice: po,
        supplierNameEn: sup?.nameEn || po.supplierNameAr,
        bankAmount,
        invoiceAmount,
        amountDiff,
        absAmountDiff,
        amountDiffPct,
        dateDiffDays,
        absDateDiffDays,
        confidenceScore,
        matchTier,
        reasonsAr,
        reasonsEn,
      });
    }

    rowCandidates.sort(
      (a, b) =>
        b.confidenceScore - a.confidenceScore ||
        a.absAmountDiff - b.absAmountDiff ||
        a.absDateDiffDays - b.absDateDiffDays
    );

    if (rowCandidates.length > 0) {
      alternativesByBankTxnId[bt.id] = rowCandidates;
      allCandidates.push(...rowCandidates);
    }
  }

  // Optimal 1-to-1 greedy pairing across all qualifying pairs
  const sortedGlobal = [...allCandidates].sort(
    (a, b) =>
      b.confidenceScore - a.confidenceScore ||
      a.absAmountDiff - b.absAmountDiff ||
      a.absDateDiffDays - b.absDateDiffDays
  );
  const usedBankIds = new Set<string>();
  const usedPoIds = new Set<string>();
  const suggestedMatches: BankPurchaseMatchCandidate[] = [];

  for (const cand of sortedGlobal) {
    if (usedBankIds.has(cand.bankTxn.id) || usedPoIds.has(cand.purchaseInvoice.id)) continue;
    usedBankIds.add(cand.bankTxn.id);
    usedPoIds.add(cand.purchaseInvoice.id);
    suggestedMatches.push(cand);
  }

  const totalMatchedValue = round2(
    suggestedMatches.reduce((sum, m) => sum + m.bankAmount, 0)
  );
  const exactOrHighCount = suggestedMatches.filter(
    (m) => m.matchTier === 'exact' || m.matchTier === 'high'
  ).length;

  return {
    unmatchedOutflowCount: unmatchedOutflows.length,
    openPurchaseCount: openPurchases.length,
    suggestedMatches,
    alternativesByBankTxnId,
    totalMatchedValue,
    exactOrHighCount,
  };
}

export function applyBankPurchaseAutoMatchApproval(
  state: ErpState,
  links: Array<{ bankTxnId: string; purchaseInvoiceId: string }>,
  approvedBy = 'المدير المالي (CFO)'
): {
  nextState: ErpState;
  journals: JournalEntry[];
  approvedPairs: Array<{
    bankTxnId: string;
    purchaseInvoiceId: string;
    journalId: string;
    settledApAmount: number;
    bankDebitAmount: number;
  }>;
} {
  let workingState: ErpState = {
    ...state,
    suppliers: state.suppliers.map((s) => ({ ...s })),
    purchaseInvoices: state.purchaseInvoices.map((p) => ({ ...p })),
    bankTransactions: state.bankTransactions.map((b) => ({ ...b })),
    journalEntries: [...state.journalEntries],
    auditLogs: [...state.auditLogs],
  };

  const now = new Date();
  const timeStr = now.toTimeString().slice(0, 5);
  const journals: JournalEntry[] = [];
  const approvedPairs: Array<{
    bankTxnId: string;
    purchaseInvoiceId: string;
    journalId: string;
    settledApAmount: number;
    bankDebitAmount: number;
  }> = [];

  const seenBankIds = new Set<string>();
  const seenPoIds = new Set<string>();

  for (let i = 0; i < links.length; i++) {
    const { bankTxnId, purchaseInvoiceId } = links[i];
    if (seenBankIds.has(bankTxnId) || seenPoIds.has(purchaseInvoiceId)) continue;

    const txn = workingState.bankTransactions.find((b) => b.id === bankTxnId);
    const po = workingState.purchaseInvoices.find((p) => p.id === purchaseInvoiceId);
    if (!txn || !po || txn.matchStatus === 'matched' || txn.debit <= 0 || po.paymentStatus !== 'credit') {
      continue;
    }

    seenBankIds.add(bankTxnId);
    seenPoIds.add(purchaseInvoiceId);

    const bankDebitAmount = round2(txn.debit);
    const supplier = workingState.suppliers.find((s) => s.id === po.supplierId);
    const supplierTotalAp = supplier
      ? round2(supplier.aging0_30 + supplier.aging31_60 + supplier.aging61_90Plus)
      : 0;

    // Settle AP up to invoice grand total (or remaining supplier balance so subledger ties 100% with 2101)
    const settledApAmount =
      supplier && supplierTotalAp > 0
        ? round2(Math.min(supplierTotalAp, po.grandTotal))
        : round2(po.grandTotal);

    if (supplier && supplierTotalAp > 0) {
      let rem = settledApAmount;
      const deduct90 = Math.min(supplier.aging61_90Plus, rem);
      rem = round2(rem - deduct90);
      const deduct60 = Math.min(supplier.aging31_60, rem);
      rem = round2(rem - deduct60);
      const deduct30 = Math.min(supplier.aging0_30, rem);
      supplier.aging61_90Plus = round2(supplier.aging61_90Plus - deduct90);
      supplier.aging31_60 = round2(supplier.aging31_60 - deduct60);
      supplier.aging0_30 = round2(supplier.aging0_30 - deduct30);
    }

    const seq = workingState.journalEntries.length + 1;
    const journalId = `JE-MATCH-${Date.now()}-${i + 1}`;
    const journalNo = `JV-2026-${String(seq).padStart(4, '0')}`;
    const diff = round2(bankDebitAmount - settledApAmount);

    const lines: JournalEntry['lines'] = [
      {
        lineNo: 1,
        accountCode: '2101',
        accountNameAr: 'الموردون (حسابات دائنة)',
        description: `سداد ومطابقة فاتورة ${po.purchaseNo} — ${po.supplierNameAr}`,
        debit: settledApAmount,
        credit: 0,
        branchId: workingState.activeBranchId,
        costCenter: 'CC-PROC',
      },
    ];

    if (Math.abs(diff) > 0.005) {
      lines.push({
        lineNo: 2,
        accountCode: '5308',
        accountNameAr: 'عمولات ومصاريف بنكية',
        description:
          diff > 0
            ? `فرق عمولة تحويل بنكي لمطابقة ${po.purchaseNo}`
            : `فرق تسوية/خصم سداد بنكي ${po.purchaseNo}`,
        debit: diff > 0 ? diff : 0,
        credit: diff < 0 ? Math.abs(diff) : 0,
        branchId: workingState.activeBranchId,
        costCenter: 'CC-TREASURY',
      });
    }

    lines.push({
      lineNo: lines.length + 1,
      accountCode: '1102',
      accountNameAr: 'بنك CIB — حساب استادات',
      description: `تسوية كشف CIB ${txn.bankRef} مقابل ${po.purchaseNo}`,
      debit: 0,
      credit: bankDebitAmount,
      branchId: workingState.activeBranchId,
      costCenter: 'CC-TREASURY',
    });

    const journal: JournalEntry = {
      id: journalId,
      journalNo,
      date: txn.date,
      period: txn.date.slice(0, 7),
      source: 'supplier_payment',
      referenceNo: `${po.purchaseNo} / ${txn.bankRef}`,
      description: `اعتماد مطابقة CIB (${txn.bankRef}) مع فاتورة مشتريات ${po.purchaseNo} (${po.supplierNameAr})`,
      createdBy: approvedBy,
      lines,
    };

    journals.push(journal);
    workingState.journalEntries = [journal, ...workingState.journalEntries];

    workingState.purchaseInvoices = workingState.purchaseInvoices.map((item) =>
      item.id === po.id ? { ...item, paymentStatus: 'paid_cib' as const } : item
    );

    workingState.bankTransactions = workingState.bankTransactions.map((item) =>
      item.id === txn.id
        ? { ...item, matchStatus: 'matched' as const, matchedJournalId: journalId }
        : item
    );

    workingState.auditLogs = [
      {
        id: `AUD-MATCH-${Date.now()}-${i + 1}`,
        timestamp: `${txn.date} ${timeStr}`,
        user: approvedBy,
        role: 'cfo',
        action: 'اعتماد مطابقة كشف CIB مع فاتورة مشتريات (Auto-Match)',
        entityType: 'BankAutoMatch',
        entityId: `${txn.bankRef} ↔ ${po.purchaseNo}`,
        details: `ربط حركة ${txn.bankRef} (${bankDebitAmount.toFixed(2)} ج.م) بفاتورة ${po.purchaseNo} (${po.grandTotal.toFixed(2)} ج.م) وترحيل القيد ${journalNo}`,
      },
      ...workingState.auditLogs,
    ];

    approvedPairs.push({
      bankTxnId: txn.id,
      purchaseInvoiceId: po.id,
      journalId,
      settledApAmount,
      bankDebitAmount,
    });
  }

  workingState.bankTransactions = computeBankRunningBalances(workingState.bankTransactions);

  return {
    nextState: workingState,
    journals,
    approvedPairs,
  };
}

export type CfoVatPeriod = '9m_ytd' | 'Q1' | 'Q2' | 'Q3' | '9m_plus_live';

export interface CfoVatMonthlyRow {
  key: string;
  labelAr: string;
  labelEn: string;
  netSales: number;
  purchasesNet: number;
  outputVat: number;
  inputVat: number;
  deductibleInputVat: number;
  nonDeductibleCogsVat: number;
  nonDeductibleOpexVat: number;
  nonDeductibleInputVat: number;
  totalInputVatIncurred: number;
  deductibilityPct: number;
  netPayable: number;
  offsetPct: number;
  momDeltaPct: number | null;
}

export interface CfoVatAuditBucket {
  id: string;
  treatment: 'deductible' | 'non_deductible' | 'exempt_out_of_scope';
  titleAr: string;
  titleEn: string;
  glAccount: string;
  etaRefAr: string;
  etaRefEn: string;
  baseAmount: number;
  deductibleVat: number;
  nonDeductibleVat: number;
  auditNoteAr: string;
  auditNoteEn: string;
}

export interface CfoVatSummary {
  vatRate: number;
  outputVat: number;
  inputVat: number;
  deductibleInputVat: number;
  deductiblePurchaseVat: number;
  deductibleExpenseVat: number;
  nonDeductibleInputVat: number;
  nonDeductibleCogsVat: number;
  nonDeductibleOpexVat: number;
  totalInputVatIncurred: number;
  deductibilityRatioPct: number;
  nonDeductibleSharePct: number;
  taxablePurchasesBase: number;
  nonDeductiblePurchasesBase: number;
  exemptOutOfScopeBase: number;
  exemptUtilitiesBase: number;
  exemptUsufructBase: number;
  exemptPayrollBase: number;
  exemptBankFeesBase: number;
  netVatPayable: number;
  hypotheticalNetPayableIfAllDeductible: number;
  potentialTaxShieldSavings: number;
  recoveryRatioPct: number;
  effectiveOutputRatePct: number;
  outputToInputRatio: number;
  netVatBurdenPct: number;
  monthlyBreakdown: CfoVatMonthlyRow[];
  maxMonthlyVatBar: number;
  etaAuditBuckets: CfoVatAuditBucket[];
  etaSubmittedCount: number;
  etaQueuedCount: number;
  ledgerOutput2201: number;
  ledgerInput1105: number;
  ledgerNetPayable: number;
  livePurchaseVat: number;
  liveExpenseVat: number;
  liveNonDeductibleOpexVat: number;
  livePurchasesNet: number;
  liveTaxableExpNet: number;
  liveNonDeductibleExpGross: number;
  seededPurchaseVat: number;
  salesPosVat: number;
  salesFoodicsVat: number;
  salesPosCount: number;
  salesFoodicsCount: number;
  livePurchasesCount: number;
  liveTaxableExpensesCount: number;
  liveNonDeductibleExpensesCount: number;
  periodLabelAr: string;
  periodLabelEn: string;
}

export function computeCfoVatSummary(
  state: ErpState,
  period: CfoVatPeriod,
  netSalesTotal: number,
  balancesOverride?: Record<string, number>
): CfoVatSummary {
  const balances = balancesOverride ?? computeAccountBalances(state);
  const vatRate = state.vatRate || 0.14;
  const rows =
    period === 'Q1' || period === 'Q2' || period === 'Q3'
      ? state.monthlyActuals2026.filter((m) => m.quarter === period)
      : state.monthlyActuals2026;

  const audited9MInputVat = 585000;
  const audited9MCogs = state.monthlyActuals2026.reduce((a, m) => a + m.cogs, 0);

  const liveSales = state.salesInvoices.filter((s) => !s.id.startsWith('INV-SEED-'));
  const liveSalesNet = round2(liveSales.reduce((a, s) => a + s.netSales, 0));
  const liveSalesVat = round2(liveSales.reduce((a, s) => a + s.vatAmount, 0));

  const livePurchases = state.purchaseInvoices.filter((p) => !p.id.startsWith('PO-SEED-'));
  const livePurchaseVat = round2(livePurchases.reduce((a, p) => a + p.vatAmount, 0));
  const livePurchasesNet = round2(livePurchases.reduce((a, p) => a + p.totalBeforeTax, 0));

  const liveTaxableExpenses = state.expenses.filter(
    (e) => !e.id.startsWith('EXP-SEED-') && e.vatAmount > 0
  );
  const liveExpenseVat = round2(liveTaxableExpenses.reduce((a, e) => a + e.vatAmount, 0));
  const liveTaxableExpNet = round2(liveTaxableExpenses.reduce((a, e) => a + e.amountNet, 0));

  // Live non-deductible operating expenses (gross 5301 receipts posted without Acc 1105 tax credit)
  const liveNonDeductibleExpenses = state.expenses.filter(
    (e) => !e.id.startsWith('EXP-SEED-') && e.vatAmount <= 0 && e.categoryAccountCode === '5301'
  );
  const liveNonDeductibleExpGross = round2(
    liveNonDeductibleExpenses.reduce((a, e) => a + e.amountNet, 0)
  );
  const embeddedVatFactor = vatRate / (1 + vatRate);
  const liveNonDeductibleOpexVat = round2(liveNonDeductibleExpGross * embeddedVatFactor);

  // Live VAT-exempt / out-of-scope expenses (Payroll 5201, Usufruct 5202, Bank 5308)
  const liveExemptExpensesGross = round2(
    state.expenses
      .filter(
        (e) => !e.id.startsWith('EXP-SEED-') && e.vatAmount <= 0 && e.categoryAccountCode !== '5301'
      )
      .reduce((a, e) => a + e.amountNet, 0)
  );

  const liveInputVat = round2(livePurchaseVat + liveExpenseVat);
  const includeLive = period === '9m_plus_live';

  const baseOutputVat = round2(rows.reduce((a, m) => a + m.vatOutput, 0));

  const rawMonthlyBase = rows.map((m) => {
    const deductibleInputVat = round2(
      audited9MCogs > 0 ? (m.cogs / audited9MCogs) * audited9MInputVat : 0
    );
    const theoreticalCogsVat = round2(m.cogs * vatRate);
    const nonDeductibleCogsVat = round2(Math.max(0, theoreticalCogsVat - deductibleInputVat));
    const nonDeductibleOpexVat = round2(m.otherOpex * embeddedVatFactor);
    const nonDeductibleInputVat = round2(nonDeductibleCogsVat + nonDeductibleOpexVat);
    const totalInputVatIncurred = round2(deductibleInputVat + nonDeductibleInputVat);
    const deductibilityPct =
      totalInputVatIncurred > 0
        ? round2((deductibleInputVat / totalInputVatIncurred) * 100)
        : 0;
    const netPayable = round2(m.vatOutput - deductibleInputVat);
    const offsetPct = m.vatOutput > 0 ? round2((deductibleInputVat / m.vatOutput) * 100) : 0;

    return {
      key: m.monthKey,
      labelAr: m.labelAr,
      labelEn: m.labelEn,
      netSales: m.netRevenue,
      purchasesNet: round2(vatRate > 0 ? deductibleInputVat / vatRate : 0),
      outputVat: m.vatOutput,
      inputVat: deductibleInputVat,
      deductibleInputVat,
      nonDeductibleCogsVat,
      nonDeductibleOpexVat,
      nonDeductibleInputVat,
      totalInputVatIncurred,
      deductibilityPct,
      netPayable,
      offsetPct,
    };
  });

  if (
    includeLive &&
    (liveSales.length > 0 || liveInputVat > 0 || liveNonDeductibleOpexVat > 0)
  ) {
    const liveTotalIncurred = round2(liveInputVat + liveNonDeductibleOpexVat);
    const liveNetPayable = round2(liveSalesVat - liveInputVat);
    rawMonthlyBase.push({
      key: 'live-oct',
      labelAr: 'أكتوبر (مباشر)',
      labelEn: 'Oct (Live)',
      netSales: liveSalesNet,
      purchasesNet: round2(livePurchasesNet + liveTaxableExpNet),
      outputVat: liveSalesVat,
      inputVat: liveInputVat,
      deductibleInputVat: liveInputVat,
      nonDeductibleCogsVat: 0,
      nonDeductibleOpexVat: liveNonDeductibleOpexVat,
      nonDeductibleInputVat: liveNonDeductibleOpexVat,
      totalInputVatIncurred: liveTotalIncurred,
      deductibilityPct:
        liveTotalIncurred > 0 ? round2((liveInputVat / liveTotalIncurred) * 100) : 0,
      netPayable: liveNetPayable,
      offsetPct: liveSalesVat > 0 ? round2((liveInputVat / liveSalesVat) * 100) : 0,
    });
  }

  const monthlyBreakdown: CfoVatMonthlyRow[] = rawMonthlyBase.map((item, idx) => {
    const prev = idx > 0 ? rawMonthlyBase[idx - 1] : null;
    const momDeltaPct =
      prev && Math.abs(prev.netPayable) > 0
        ? round2(((item.netPayable - prev.netPayable) / Math.abs(prev.netPayable)) * 100)
        : null;
    return { ...item, momDeltaPct };
  });

  const baseDeductibleInputVat = round2(
    rows.reduce(
      (a, m) => a + (audited9MCogs > 0 ? (m.cogs / audited9MCogs) * audited9MInputVat : 0),
      0
    )
  );
  const basePurchasesNet = round2(vatRate > 0 ? baseDeductibleInputVat / vatRate : 0);

  const baseNonDeductibleCogsVat = round2(
    rows.reduce((a, m) => {
      const mDed = audited9MCogs > 0 ? (m.cogs / audited9MCogs) * audited9MInputVat : 0;
      return a + Math.max(0, round2(m.cogs * vatRate) - round2(mDed));
    }, 0)
  );
  const baseNonDeductibleOpexGross = round2(rows.reduce((a, m) => a + m.otherOpex, 0));
  const baseNonDeductibleOpexVat = round2(
    rows.reduce((a, m) => a + round2(m.otherOpex * embeddedVatFactor), 0)
  );

  const outputVat = round2(baseOutputVat + (includeLive ? liveSalesVat : 0));
  const deductiblePurchaseVat = round2(
    baseDeductibleInputVat + (includeLive ? livePurchaseVat : 0)
  );
  const deductibleExpenseVat = round2(includeLive ? liveExpenseVat : 0);
  const deductibleInputVat = round2(deductiblePurchaseVat + deductibleExpenseVat);

  const nonDeductibleCogsVat = baseNonDeductibleCogsVat;
  const nonDeductibleOpexVat = round2(
    baseNonDeductibleOpexVat + (includeLive ? liveNonDeductibleOpexVat : 0)
  );
  const nonDeductibleInputVat = round2(nonDeductibleCogsVat + nonDeductibleOpexVat);
  const totalInputVatIncurred = round2(deductibleInputVat + nonDeductibleInputVat);

  const deductibilityRatioPct =
    totalInputVatIncurred > 0
      ? round2((deductibleInputVat / totalInputVatIncurred) * 100)
      : 0;
  const nonDeductibleSharePct =
    totalInputVatIncurred > 0
      ? round2((nonDeductibleInputVat / totalInputVatIncurred) * 100)
      : 0;

  const taxablePurchasesBase = round2(
    basePurchasesNet + (includeLive ? livePurchasesNet + liveTaxableExpNet : 0)
  );
  const nonDeductibleCogsBase = round2(vatRate > 0 ? nonDeductibleCogsVat / vatRate : 0);
  const nonDeductibleOpexNetBase = round2(
    baseNonDeductibleOpexGross +
      (includeLive ? liveNonDeductibleExpGross : 0) -
      nonDeductibleOpexVat
  );
  const nonDeductiblePurchasesBase = round2(nonDeductibleCogsBase + nonDeductibleOpexNetBase);

  const exemptUtilitiesBase = round2(rows.reduce((a, m) => a + m.electricity, 0));
  const exemptUsufructBase = round2(
    rows.reduce((a, m) => a + m.usufructRent, 0) + (includeLive ? liveExemptExpensesGross : 0)
  );
  const exemptPayrollBase = round2(rows.reduce((a, m) => a + m.payroll, 0));
  const exemptBankFeesBase = round2(rows.reduce((a, m) => a + m.bankFeesNet, 0));
  const exemptOutOfScopeBase = round2(
    exemptUtilitiesBase + exemptUsufructBase + exemptPayrollBase + exemptBankFeesBase
  );

  const netVatPayable = round2(outputVat - deductibleInputVat);
  const hypotheticalNetPayableIfAllDeductible = round2(outputVat - totalInputVatIncurred);
  const potentialTaxShieldSavings = nonDeductibleInputVat;

  const recoveryRatioPct = outputVat > 0 ? round2((deductibleInputVat / outputVat) * 100) : 0;
  const effectiveOutputRatePct =
    netSalesTotal > 0 ? round2((outputVat / netSalesTotal) * 100) : 0;
  const outputToInputRatio =
    deductibleInputVat > 0 ? round2(outputVat / deductibleInputVat) : 0;
  const netVatBurdenPct =
    netSalesTotal > 0 ? round2((netVatPayable / netSalesTotal) * 100) : 0;

  const maxMonthlyVatBar = Math.max(
    1,
    ...monthlyBreakdown.map((r) =>
      Math.max(r.outputVat, r.deductibleInputVat, r.nonDeductibleInputVat)
    )
  );

  const etaAuditBuckets: CfoVatAuditBucket[] = [
    {
      id: 'BUCKET-DED-PO',
      treatment: 'deductible',
      titleAr: 'مشتريات خامات المطبخ بفواتير إلكترونية معتمدة (ETA e-Invoice)',
      titleEn: 'E-Invoiced Kitchen Raw Material Purchases',
      glAccount: '1105',
      etaRefAr: 'مادة 22 ق 67/2016 · بند 11 إقرار نموذج 10',
      etaRefEn: 'Art. 22 Law 67/2016 · Form 10 Line 11',
      baseAmount: round2(basePurchasesNet + (includeLive ? livePurchasesNet : 0)),
      deductibleVat: deductiblePurchaseVat,
      nonDeductibleVat: 0,
      auditNoteAr: 'مستندات ضريبية مستوفاة الشروط ومخصومة بالكامل من ضريبة المخرجات 2201.',
      auditNoteEn: 'Full ETA e-invoice compliance; 100% creditable against Output VAT 2201.',
    },
    {
      id: 'BUCKET-DED-EXP',
      treatment: 'deductible',
      titleAr: 'مصروفات تشغيلية خاضعة لضريبة المدخلات (بفواتير ضريبية)',
      titleEn: 'Tax-Verified Operating Expenses (Direct Voucher VAT)',
      glAccount: '1105',
      etaRefAr: 'مادة 22 ق 67/2016 · بند 12 خدمات خاضعة',
      etaRefEn: 'Art. 22 Law 67/2016 · Form 10 Line 12',
      baseAmount: includeLive ? liveTaxableExpNet : 0,
      deductibleVat: deductibleExpenseVat,
      nonDeductibleVat: 0,
      auditNoteAr:
        deductibleExpenseVat > 0
          ? 'فواتير مصروفات مباشرة مسجلة بحساب 1105 ضمن الفترة النشطة.'
          : 'لا توجد مصروفات تشغيلية مباشرة مفصولة الضريبة في النطاق المختار.',
      auditNoteEn:
        deductibleExpenseVat > 0
          ? 'Live operating expense vouchers credited cleanly to GL 1105.'
          : 'No separate live deductible expense vouchers posted in selected scope.',
    },
    {
      id: 'BUCKET-NONDED-COGS',
      treatment: 'non_deductible',
      titleAr: 'مشتريات خضروات وطازج / موردون غير مسجلين بـ ETA (محملة على COGS)',
      titleEn: 'Uninvoiced Produce & Informal Supplier COGS (Absorbed)',
      glAccount: '5101',
      etaRefAr: 'مادة 22 وقرار الفاتورة الإلكترونية · غير قابل للخصم',
      etaRefEn: 'Art. 22 & e-Invoice Mandate · Non-Creditable',
      baseAmount: nonDeductibleCogsBase,
      deductibleVat: 0,
      nonDeductibleVat: nonDeductibleCogsVat,
      auditNoteAr:
        'فارق 14% غير المخصوم في حساب 1105 نتيجة مشتريات سوق جملة/خضار بدون فاتورة إلكترونية — يُحمّل على تكلفة المبيعات 5101.',
      auditNoteEn:
        'Unrecovered 14% input tax on fresh market/unregistered vendor purchases; absorbed into COGS 5101.',
    },
    {
      id: 'BUCKET-NONDED-OPEX',
      treatment: 'non_deductible',
      titleAr: 'مصروفات تشغيلية وإدارية غير مستردة الضريبة (ضيافة / صيانة / إيصالات)',
      titleEn: 'Indirect Admin, Hospitality & Gross Receipts (Art. 22 Disallowed)',
      glAccount: '5301',
      etaRefAr: 'مادة 22 و56 · ضريبة مدخلات ضمنية غير قابلة للخصم',
      etaRefEn: 'Art. 22 & 56 · Disallowed Embedded Input VAT',
      baseAmount: nonDeductibleOpexNetBase,
      deductibleVat: 0,
      nonDeductibleVat: nonDeductibleOpexVat,
      auditNoteAr:
        'ضريبة ضمنية 14% داخل مصروفات 5301 غير مستوفاة للإيصال الإلكتروني أو مستثناة بموجب المادة 22.',
      auditNoteEn:
        'Embedded 14% VAT inside gross 5301 OpEx ineligible for ETA recovery; remains P&L expense.',
    },
    {
      id: 'BUCKET-EXEMPT',
      treatment: 'exempt_out_of_scope',
      titleAr: 'تدفقات معفاة أو خارج نطاق VAT (حق الانتفاع 5202 · رواتب 5201 · كهرباء وبنوك)',
      titleEn: 'Exempt & Out-of-Scope Outflows (Usufruct, Payroll, Utilities & Bank)',
      glAccount: '5201 / 5202 / 5308',
      etaRefAr: 'جدول الإعفاءات مادة 37 (بنوك) · تعاقدات حكومية وأجور',
      etaRefEn: 'ETA Schedule Art. 37 (Banking) · Gov. Usufruct & Payroll',
      baseAmount: exemptOutOfScopeBase,
      deductibleVat: 0,
      nonDeductibleVat: 0,
      auditNoteAr:
        'مبالغ غير محملة بضريبة قيمة مضافة قابلة للخصم (أجور موظفين، أقساط محافظة المنوفية، عمولات CIB المعفاة).',
      auditNoteEn:
        'Zero-VAT / exempt outflows (staff payroll, Menoufia Governorate usufruct rent, exempt CIB banking fees).',
    },
  ];

  const salesPosInvoices = state.salesInvoices.filter((s) => s.source === 'pos');
  const salesFoodicsInvoices = state.salesInvoices.filter((s) => s.source !== 'pos');
  const salesPosVat = round2(salesPosInvoices.reduce((a, s) => a + s.vatAmount, 0));
  const salesFoodicsVat = round2(salesFoodicsInvoices.reduce((a, s) => a + s.vatAmount, 0));
  const seededPurchaseVat = round2(
    state.purchaseInvoices
      .filter((p) => p.id.startsWith('PO-SEED-'))
      .reduce((a, p) => a + p.vatAmount, 0)
  );

  const etaSubmittedCount = state.salesInvoices.filter((inv) => inv.etaStatus === 'submitted').length;
  const etaQueuedCount = state.salesInvoices.filter((inv) => inv.etaStatus === 'queued_offline').length;
  const ledgerOutput2201 = balances['2201'] ?? 0;
  const ledgerInput1105 = balances['1105'] ?? 0;

  const periodLabelAr =
    period === '9m_ytd'
      ? 'يناير – سبتمبر 2026 (9 شهور)'
      : period === '9m_plus_live'
      ? '9 شهور + العمليات المباشرة'
      : `${period} 2026`;
  const periodLabelEn =
    period === '9m_ytd'
      ? 'Jan – Sep 2026 (9M YTD)'
      : period === '9m_plus_live'
      ? '9M YTD + Live Operations'
      : `${period} 2026`;

  return {
    vatRate,
    outputVat,
    inputVat: deductibleInputVat,
    deductibleInputVat,
    deductiblePurchaseVat,
    deductibleExpenseVat,
    nonDeductibleInputVat,
    nonDeductibleCogsVat,
    nonDeductibleOpexVat,
    totalInputVatIncurred,
    deductibilityRatioPct,
    nonDeductibleSharePct,
    taxablePurchasesBase,
    nonDeductiblePurchasesBase,
    exemptOutOfScopeBase,
    exemptUtilitiesBase,
    exemptUsufructBase,
    exemptPayrollBase,
    exemptBankFeesBase,
    netVatPayable,
    hypotheticalNetPayableIfAllDeductible,
    potentialTaxShieldSavings,
    recoveryRatioPct,
    effectiveOutputRatePct,
    outputToInputRatio,
    netVatBurdenPct,
    monthlyBreakdown,
    maxMonthlyVatBar,
    etaAuditBuckets,
    etaSubmittedCount,
    etaQueuedCount,
    ledgerOutput2201,
    ledgerInput1105,
    ledgerNetPayable: round2(ledgerOutput2201 - ledgerInput1105),
    livePurchaseVat,
    liveExpenseVat,
    liveNonDeductibleOpexVat,
    livePurchasesNet,
    liveTaxableExpNet,
    liveNonDeductibleExpGross,
    seededPurchaseVat,
    salesPosVat,
    salesFoodicsVat,
    salesPosCount: salesPosInvoices.length,
    salesFoodicsCount: salesFoodicsInvoices.length,
    livePurchasesCount: livePurchases.length,
    liveTaxableExpensesCount: liveTaxableExpenses.length,
    liveNonDeductibleExpensesCount: liveNonDeductibleExpenses.length,
    periodLabelAr,
    periodLabelEn,
  };
}



