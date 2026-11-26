export type Language = 'ar' | 'en';

export type OrderType = 'dine-in' | 'takeaway' | 'delivery';
export type PaymentMethod = 'cash' | 'visa_cib' | 'foodics_credit';
export type KdsStation = 'oven' | 'grill' | 'beverages';
export type KdsStatus = 'new' | 'preparing' | 'ready' | 'served';
export type UserRole = 'cfo' | 'manager' | 'cashier' | 'chef' | 'accountant';

export interface Branch {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  locationAr: string;
  locationEn: string;
  annualUsufructRent: number;
}

export interface Account {
  code: string;
  nameAr: string;
  nameEn: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'cogs' | 'expense';
  parentCode: string | null;
  normalBalance: 'debit' | 'credit';
  taxApplicable: boolean;
}

export interface Ingredient {
  id: string;
  sku: string;
  nameAr: string;
  nameEn: string;
  category: string;
  unit: 'kg' | 'g' | 'liter' | 'piece';
  openingQty: number;
  purchasedQty: number;
  issuedQty: number;
  wasteQty: number;
  currentQty: number;
  weightedAvgCost: number;
  reorderLevel: number;
  lastPurchasePrice: number;
  preferredSupplierId: string;
}

export interface RecipeLine {
  ingredientId: string;
  qty: number;
  wastePct: number;
}

export type MenuListingType = 'مطبوع' | 'إضافة يدوية' | 'مطبوع / إضافة';

export interface MenuItem {
  id: string;
  code: string;
  menuNo?: number;
  nameAr: string;
  nameEn: string;
  descriptionAr?: string;
  categoryAr: string;
  categoryEn: string;
  station: KdsStation;
  basePrice?: number | null;
  priceInclService?: number | null;
  sellingPriceGross: number;
  priceStatus?: 'priced' | 'unspecified';
  listingType?: MenuListingType;
  targetFoodCostPct: number;
  yieldPortions: number;
  recipe: RecipeLine[];
  q1UnitsSold: number;
}

export interface Supplier {
  id: string;
  nameAr: string;
  nameEn: string;
  taxNumber: string;
  phone: string;
  paymentTermsDays: number;
  aging0_30: number;
  aging31_60: number;
  aging61_90Plus: number;
  rating: number;
  categoryAr?: string;
  categoryEn?: string;
  city?: string;
  contactName?: string;
}

export interface Customer {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  segment: 'vip' | 'corporate' | 'family' | 'delivery_partner';
  phone: string;
  city: string;
  taxNumber?: string;
  creditLimit: number;
  currentBalance: number;
  totalOrders: number;
  totalSpent: number;
  loyaltyPoints: number;
  lastOrderDate: string;
}

export interface DiningTable {
  id: string;
  number: string;
  zoneAr: string;
  zoneEn: string;
  seats: number;
  status: 'available' | 'occupied' | 'billed';
  activeOrderId?: string;
  activeTotal?: number;
}

export type RepresentativeRole = 'sales' | 'procurement' | 'collection' | 'delivery';

export interface Representative {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  roleType: RepresentativeRole;
  phone: string;
  branchId: string;
  assignedArea: string;
  commissionPct: number;
  monthlyTarget: number;
  achievedSales: number;
  collectedAmount: number;
  custodyBalance: number;
  status: 'active' | 'inactive';
  notes?: string;
}

export type HouseholdEntryType = 'expense' | 'income' | 'transfer';

export interface HouseholdEntry {
  id: string;
  entryNo: string;
  date: string;
  type: HouseholdEntryType;
  categoryAr: string;
  categoryEn: string;
  description: string;
  amount: number;
  paymentMethod: 'cash' | 'bank' | 'wallet';
  memberName: string;
  notes?: string;
}

export interface SalesLineItem {
  menuItemId: string;
  nameAr: string;
  nameEn: string;
  qty: number;
  unitPriceGross: number;
  lineTotalGross: number;
  lineNet: number;
  lineVat: number;
  lineCogs: number;
  station: KdsStation;
}

export interface SalesInvoice {
  id: string;
  invoiceNo: string;
  date: string;
  time: string;
  branchId: string;
  cashier: string;
  representativeId?: string;
  representativeNameAr?: string;
  orderType: OrderType;
  tableId?: string;
  tableNumber?: string;
  paymentMethod: PaymentMethod;
  splitCount: number;
  discountAmount: number;
  grossTotal: number;
  netSales: number;
  vatAmount: number;
  cogsTotal: number;
  lines: SalesLineItem[];
  journalId: string;
  etaStatus: 'submitted' | 'queued_offline';
  source: 'pos' | 'foodics_api';
}

export interface PurchaseLineItem {
  ingredientId: string;
  nameAr: string;
  nameEn: string;
  qty: number;
  unitCostNet: number;
  lineTotalNet: number;
}

export interface PurchaseInvoice {
  id: string;
  purchaseNo: string;
  date: string;
  branchId: string;
  supplierId: string;
  supplierNameAr: string;
  representativeId?: string;
  representativeNameAr?: string;
  paymentStatus: 'paid_cash' | 'paid_cib' | 'credit';
  totalBeforeTax: number;
  vatAmount: number;
  grandTotal: number;
  lines: PurchaseLineItem[];
  journalId: string;
}

export interface ExpenseEntry {
  id: string;
  expenseNo: string;
  date: string;
  branchId: string;
  categoryAccountCode: string;
  categoryNameAr: string;
  beneficiary: string;
  amountNet: number;
  vatAmount: number;
  totalAmount: number;
  paymentMethod: 'cash' | 'visa_cib';
  costCenter: string;
  journalId: string;
}

export interface WasteEntry {
  id: string;
  wasteNo: string;
  date: string;
  branchId: string;
  ingredientId: string;
  ingredientNameAr: string;
  qty: number;
  unitCost: number;
  totalValue: number;
  reason: 'expired' | 'spoilage' | 'prep_error' | 'overcooked';
  journalId: string;
}

export interface StocktakeEntry {
  id: string;
  countNo: string;
  date: string;
  branchId: string;
  locationAr: string;
  locationEn: string;
  ingredientId: string;
  sku: string;
  ingredientNameAr: string;
  ingredientNameEn: string;
  unit: string;
  bookQty: number;
  actualQty: number;
  varianceQty: number;
  variancePct: number;
  unitCost: number;
  varianceValue: number;
  status: 'pending_reconciliation' | 'reconciled';
  countedBy: string;
  notes?: string;
  reconciledAt?: string;
  reconciliationJournalId?: string;
}

export interface JournalLine {
  lineNo: number;
  accountCode: string;
  accountNameAr: string;
  description: string;
  debit: number;
  credit: number;
  branchId: string;
  costCenter: string;
}

export interface JournalEntry {
  id: string;
  journalNo: string;
  date: string;
  period: string;
  source:
    | 'opening'
    | 'q1_summary'
    | 'ytd_summary'
    | 'pos_sale'
    | 'purchase'
    | 'supplier_payment'
    | 'expense'
    | 'waste'
    | 'stocktake_adjustment'
    | 'bank_settlement'
    | 'reversal';
  referenceNo: string;
  description: string;
  createdBy: string;
  reversedByJournalId?: string;
  isReversal?: boolean;
  lines: JournalLine[];
}

export interface BankTransaction {
  id: string;
  bankRef: string;
  date: string;
  description: string;
  debit: number;
  credit: number;
  runningBalance?: number;
  accountCode: string;
  matchedJournalId?: string;
  matchStatus: 'matched' | 'unmatched';
}

export interface VisaMonthlyFeePoint {
  monthKey: string;
  labelAr: string;
  labelEn: string;
  visaSales: number;
  bankSettled: number;
  feeAmount: number;
  feePct: number;
  anomaly: boolean;
  noteAr: string;
  noteEn: string;
}

export interface KdsOrder {
  id: string;
  orderNo: string;
  invoiceNo: string;
  createdAt: string;
  timestampMs: number;
  orderType: OrderType;
  tableNumber?: string;
  status: KdsStatus;
  priority: 'normal' | 'rush';
  items: {
    nameAr: string;
    nameEn: string;
    qty: number;
    station: KdsStation;
    notes?: string;
  }[];
}

export interface MonthlySummary {
  monthKey: string;
  quarter: 'Q1' | 'Q2' | 'Q3';
  labelAr: string;
  labelEn: string;
  grossRevenue: number;
  netRevenue: number;
  vatOutput: number;
  cogs: number;
  grossProfit: number;
  payrollBase: number;
  payrollBonuses: number;
  payroll: number;
  usufructRent: number;
  electricity: number;
  otherOpex: number;
  totalOpexInclRent: number;
  bankFeesNet: number;
  totalExpenses: number;
  netProfit: number;
  gpMarginPct: number;
  netMarginPct: number;
}

export interface StrategyScenario {
  id: 'A' | 'B' | 'C';
  nameAr: string;
  nameEn: string;
  netRevenue: number;
  growthPct: number;
  cogsPct: number;
  payroll: number;
  usufructRent: number;
  otherOpex: number;
  bankFees: number;
  netResult: number;
  monthlyBreakEven: number;
}

export interface StrategyInitiative {
  id: string;
  titleAr: string;
  titleEn: string;
  targetImpactAr: string;
  targetImpactEn: string;
  budgetEgp: number;
  ownerAr: string;
  ownerEn: string;
  timeline: string;
  status: 'planned' | 'in_progress' | 'needs_approval';
}

export type RiskImpact = 'low' | 'medium' | 'high';
export type RiskCategory = 'financial' | 'operational';
export type RiskFocusArea = 'usufruct' | 'unused_space' | 'general';
export type RiskStatus = 'open' | 'in_progress' | 'mitigated';

export interface RiskAuditEntry {
  id: string;
  timestamp: string;
  actor: string;
  actionType: 'created' | 'status_change' | 'mitigation_update' | 'impact_change' | 'owner_change' | 'updated';
  summaryAr: string;
  summaryEn: string;
  previousStatus?: RiskStatus;
  newStatus?: RiskStatus;
  previousImpact?: RiskImpact;
  newImpact?: RiskImpact;
  previousMitigation?: string;
  newMitigation?: string;
  previousOwner?: string;
  newOwner?: string;
  note?: string;
}

export interface StrategyRisk {
  id: string;
  code?: string;
  riskAr: string;
  riskEn: string;
  category?: RiskCategory;
  focusArea?: RiskFocusArea;
  likelihood: 'low' | 'medium' | 'high' | 'confirmed';
  impact: RiskImpact;
  mitigationAr: string;
  mitigationEn: string;
  ownerAr?: string;
  ownerEn?: string;
  status?: RiskStatus;
  dueDate?: string;
  financialExposureEgp?: number;
  updatedAt?: string;
  auditHistory?: RiskAuditEntry[];
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  user: string;
  role: UserRole;
  action: string;
  entityType: string;
  entityId: string;
  details: string;
}

export interface DataQualityCheck {
  id: string;
  code: string;
  titleAr: string;
  titleEn: string;
  status: 'PASS' | 'WARN' | 'ERROR';
  metricValue: string;
  detailAr: string;
  detailEn: string;
}

export interface StockOpportunityAlert {
  ingredientId: string;
  sku: string;
  nameAr: string;
  nameEn: string;
  unit: string;
  currentQty: number;
  reorderLevel: number;
  severity: 'critical' | 'approaching';
  dailyBurnRate: number;
  daysRemaining: number;
  affectedMenuItems: { id: string; nameAr: string; nameEn: string }[];
  dailyNetRevenueAtRisk: number;
  dailyOpportunityCost: number;
  sevenDayOpportunityCost: number;
  suggestedOrderQty: number;
  estimatedOrderCostNet: number;
  preferredSupplierId: string;
}

export interface FoodCostMonthlyVariance {
  monthKey: string;
  quarter: string;
  labelAr: string;
  labelEn: string;
  netRevenue: number;
  actualFoodCost: number;
  actualFoodCostPct: number;
  theoreticalRecipeCost: number;
  theoreticalRecipePct: number;
  varianceAmount: number;
  variancePct: number;
  exceedsThreshold: boolean;
}

export interface FoodCostRecipeVariance {
  menuItemId: string;
  code: string;
  nameAr: string;
  nameEn: string;
  categoryAr: string;
  categoryEn: string;
  unitsSold: number;
  netSellingPrice: number;
  theoreticalRecipeCost: number;
  theoreticalRecipePct: number;
  targetRecipeCost: number;
  targetFoodCostPct: number;
  actualUnitFoodCost: number;
  actualFoodCostPct: number;
  wasteAndPriceDriftPct: number;
  varianceAmountPerUnit: number;
  varianceTotalPeriod: number;
  variancePct: number;
  exceedsThreshold: boolean;
  driverAr: string;
  driverEn: string;
}

export interface FoodCostVarianceSummary {
  periodActualFoodCost: number;
  periodActualPct: number;
  periodTheoreticalRecipeCost: number;
  periodTheoreticalPct: number;
  periodBomBaselinePct: number;
  periodVarianceAmount: number;
  periodVariancePct: number;
  exceedsThreshold: boolean;
  exceedingMonthsCount: number;
  exceedingRecipesCount: number;
  liveWasteCostTotal: number;
  monthlySeries: FoodCostMonthlyVariance[];
  recipeVariances: FoodCostRecipeVariance[];
}

export interface Strategy2027Data {
  submissionDate: string;
  actual9MSummary: {
    grossRevenue: number;
    netRevenue: number;
    vatOutput: number;
    cogs: number;
    grossProfit: number;
    payrollAndBonuses: number;
    opexInclUsufruct: number;
    bankFeesNet: number;
    netResult: number;
    endingSepInventoryValue: number;
    endingSepSkuCount: number;
    inventoryLocations: number;
    fixedAssetsCost: number;
    fixedAssetsNbvEnd2026: number;
    cashVaultMin: number;
    cashVaultMax: number;
    quarterlyUsufructInstallment: number;
  };
  channelMixAug: {
    takeawayPct: number;
    dineInPct: number;
    deliveryPct: number;
    cashPaymentPct: number;
    visaPaymentPct: number;
  };
  dayOfWeekBenchmark: {
    weakestDayAr: string;
    weakestDayEn: string;
    weakestAvg: number;
    strongestDayAr: string;
    strongestDayEn: string;
    strongestAvg: number;
    targetMondayAvg: number;
  };
  scenarios: StrategyScenario[];
  quarterly2027Target: { quarter: string; netRevenue: number }[];
  initiatives: StrategyInitiative[];
  risks: StrategyRisk[];
  swot: {
    strengthsAr: string[];
    weaknessesAr: string[];
    opportunitiesAr: string[];
    threatsAr: string[];
  };
  contractEscalation: {
    years: string;
    increasePct: number;
    annualAmountEgp: number;
    quarterlyInstallmentEgp: number;
  }[];
  visaMonthlyFees: VisaMonthlyFeePoint[];
}

export interface StocktakeVarianceAlertItem {
  entry: StocktakeEntry;
  liveBookQty: number;
  varianceQty: number;
  signedVariancePct: number;
  absVariancePct: number;
  varianceValue: number;
  exceedsThreshold: boolean;
  direction: 'shortage' | 'surplus' | 'exact';
}

export interface StocktakeVarianceSummary {
  items: StocktakeVarianceAlertItem[];
  pendingExceedingCount: number;
  pendingCount: number;
  reconciledCount: number;
  withinToleranceCount: number;
  totalCountedItems: number;
  netVarianceValue: number;
  totalShortageValue: number;
  totalSurplusValue: number;
  maxAbsVariancePct: number;
}

export interface ErpState {
  companyNameAr: string;
  companyNameEn: string;
  taxId: string;
  reportDate: string;
  vatRate: number;
  branches: Branch[];
  activeBranchId: string;
  accounts: Account[];
  monthlyActuals2026: MonthlySummary[];
  strategy2027: Strategy2027Data;
  ingredients: Ingredient[];
  menuItems: MenuItem[];
  suppliers: Supplier[];
  customers: Customer[];
  representatives: Representative[];
  householdEntries: HouseholdEntry[];
  tables: DiningTable[];
  salesInvoices: SalesInvoice[];
  purchaseInvoices: PurchaseInvoice[];
  expenses: ExpenseEntry[];
  wasteEntries: WasteEntry[];
  stocktakeEntries?: StocktakeEntry[];
  journalEntries: JournalEntry[];
  bankTransactions: BankTransaction[];
  kdsOrders: KdsOrder[];
  auditLogs: AuditLogEntry[];
}
