import { relations } from 'drizzle-orm';
import {
  bigint,
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import type {
  Account,
  Branch,
  Customer,
  JournalLine,
  KdsOrder,
  MonthlySummary,
  PurchaseLineItem,
  RecipeLine,
  Strategy2027Data,
  Supplier,
} from '../types/erp.ts';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  displayName: text('display_name'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const erpMetadata = pgTable('erp_metadata', {
  id: text('id').primaryKey(),
  activeBranchId: text('active_branch_id').notNull(),
  companyNameAr: text('company_name_ar').notNull(),
  companyNameEn: text('company_name_en').notNull(),
  taxId: text('tax_id').notNull(),
  reportDate: text('report_date').notNull(),
  vatRate: doublePrecision('vat_rate').notNull(),
  branches: jsonb('branches').$type<Branch[]>().notNull(),
  accounts: jsonb('accounts').$type<Account[]>().notNull(),
  monthlyActuals2026: jsonb('monthly_actuals_2026').$type<MonthlySummary[]>().notNull(),
  strategy2027: jsonb('strategy_2027').$type<Strategy2027Data>().notNull(),
  suppliers: jsonb('suppliers').$type<Supplier[]>().notNull(),
  customers: jsonb('customers').$type<Customer[]>().notNull().default([]),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const ingredients = pgTable('ingredients', {
  id: text('id').primaryKey(),
  sku: text('sku').notNull(),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en').notNull(),
  category: text('category').notNull().default('عام'),
  unit: text('unit').notNull(),
  currentQty: doublePrecision('current_qty').notNull(),
  reorderLevel: doublePrecision('reorder_level').notNull(),
  weightedAvgCost: doublePrecision('weighted_avg_cost').notNull(),
  lastPurchasePrice: doublePrecision('last_purchase_price').notNull(),
  openingQty: doublePrecision('opening_qty').notNull(),
  purchasedQty: doublePrecision('purchased_qty').notNull(),
  issuedQty: doublePrecision('issued_qty').notNull(),
  wasteQty: doublePrecision('waste_qty').notNull(),
  preferredSupplierId: text('preferred_supplier_id').notNull(),
});

export const menuItems = pgTable('menu_items', {
  id: text('id').primaryKey(),
  code: text('code').notNull().default(''),
  menuNo: integer('menu_no').notNull().default(0),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en').notNull(),
  descriptionAr: text('description_ar').notNull().default(''),
  category: text('category').notNull(),
  categoryEn: text('category_en').notNull().default(''),
  station: text('station').notNull(),
  basePrice: doublePrecision('base_price'),
  priceInclService: doublePrecision('price_incl_service'),
  sellingPriceGross: doublePrecision('selling_price_gross').notNull(),
  priceStatus: text('price_status').notNull().default('priced'),
  listingType: text('listing_type').notNull().default('مطبوع'),
  targetFoodCostPct: doublePrecision('target_food_cost_pct').notNull().default(35),
  q1UnitsSold: integer('q1_units_sold').notNull(),
  yieldPortions: integer('yield_portions').notNull().default(1),
  recipe: jsonb('recipe').$type<RecipeLine[]>().notNull(),
});

export const diningTables = pgTable('dining_tables', {
  id: text('id').primaryKey(),
  branchId: text('branch_id').notNull(),
  label: text('label').notNull(),
  zoneAr: text('zone_ar').notNull().default(''),
  zoneEn: text('zone_en').notNull().default(''),
  seats: integer('seats').notNull(),
  status: text('status').notNull(),
  activeOrderId: text('active_order_id'),
  activeTotal: doublePrecision('active_total'),
});

export const salesInvoices = pgTable('sales_invoices', {
  id: text('id').primaryKey(),
  invoiceNo: text('invoice_no').notNull().unique(),
  date: text('date').notNull(),
  time: text('time').notNull(),
  branchId: text('branch_id').notNull(),
  orderType: text('order_type').notNull(),
  tableId: text('table_id'),
  tableNumber: text('table_number'),
  cashier: text('cashier').notNull(),
  representativeId: text('representative_id'),
  representativeNameAr: text('representative_name_ar'),
  paymentMethod: text('payment_method').notNull(),
  splitCashAmount: doublePrecision('split_cash_amount'),
  splitVisaAmount: doublePrecision('split_visa_amount'),
  splitCount: integer('split_count').notNull().default(1),
  grossTotal: doublePrecision('gross_total').notNull(),
  netSales: doublePrecision('net_sales').notNull(),
  vatAmount: doublePrecision('vat_amount').notNull(),
  cogsTotal: doublePrecision('cogs_total').notNull(),
  discountAmount: doublePrecision('discount_amount').notNull().default(0),
  journalId: text('journal_id').notNull().default(''),
  etaStatus: text('eta_status').notNull().default('submitted'),
  source: text('source').notNull(),
  offlineQueued: boolean('offline_queued').default(false),
  createdByUid: text('created_by_uid').references(() => users.uid),
  createdAt: timestamp('created_at').defaultNow(),
});

export const salesInvoiceItems = pgTable('sales_invoice_items', {
  id: serial('id').primaryKey(),
  invoiceId: text('invoice_id')
    .notNull()
    .references(() => salesInvoices.id, { onDelete: 'cascade' }),
  menuItemId: text('menu_item_id')
    .notNull()
    .references(() => menuItems.id),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en').notNull().default(''),
  qty: integer('qty').notNull(),
  unitPriceGross: doublePrecision('unit_price_gross').notNull(),
  lineTotalGross: doublePrecision('line_total_gross').notNull(),
  lineNet: doublePrecision('line_net').notNull(),
  lineVat: doublePrecision('line_vat').notNull(),
  lineCogs: doublePrecision('line_cogs').notNull(),
  station: text('station').notNull().default('oven'),
});

export const purchaseInvoices = pgTable('purchase_invoices', {
  id: text('id').primaryKey(),
  purchaseNo: text('purchase_no').notNull().unique(),
  date: text('date').notNull(),
  supplierId: text('supplier_id').notNull(),
  supplierNameAr: text('supplier_name_ar').notNull(),
  representativeId: text('representative_id'),
  representativeNameAr: text('representative_name_ar'),
  branchId: text('branch_id').notNull(),
  paymentStatus: text('payment_status').notNull(),
  netTotal: doublePrecision('net_total').notNull(),
  vatAmount: doublePrecision('vat_amount').notNull(),
  grossTotal: doublePrecision('gross_total').notNull(),
  lines: jsonb('lines').$type<PurchaseLineItem[]>().notNull(),
  journalId: text('journal_id').notNull().default(''),
  createdByUid: text('created_by_uid').references(() => users.uid),
  createdAt: timestamp('created_at').defaultNow(),
});

export const representatives = pgTable('representatives', {
  id: text('id').primaryKey(),
  code: text('code').notNull(),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en').notNull(),
  roleType: text('role_type').notNull().default('sales'),
  phone: text('phone').notNull().default(''),
  branchId: text('branch_id').notNull().default('BR-BORG'),
  assignedArea: text('assigned_area').notNull().default(''),
  commissionPct: doublePrecision('commission_pct').notNull().default(0),
  monthlyTarget: doublePrecision('monthly_target').notNull().default(0),
  achievedSales: doublePrecision('achieved_sales').notNull().default(0),
  collectedAmount: doublePrecision('collected_amount').notNull().default(0),
  custodyBalance: doublePrecision('custody_balance').notNull().default(0),
  status: text('status').notNull().default('active'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const householdEntries = pgTable('household_entries', {
  id: text('id').primaryKey(),
  entryNo: text('entry_no').notNull().unique(),
  date: text('date').notNull(),
  type: text('type').notNull().default('expense'),
  categoryAr: text('category_ar').notNull(),
  categoryEn: text('category_en').notNull().default(''),
  description: text('description').notNull(),
  amount: doublePrecision('amount').notNull(),
  paymentMethod: text('payment_method').notNull().default('cash'),
  memberName: text('member_name').notNull().default(''),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const expenses = pgTable('expenses', {
  id: text('id').primaryKey(),
  expenseNo: text('expense_no').notNull().unique(),
  date: text('date').notNull(),
  categoryAccountCode: text('category_account_code').notNull(),
  categoryNameAr: text('category_name_ar').notNull(),
  beneficiary: text('beneficiary').notNull(),
  amountNet: doublePrecision('amount_net').notNull(),
  vatAmount: doublePrecision('vat_amount').notNull(),
  amountGross: doublePrecision('amount_gross').notNull(),
  paymentMethod: text('payment_method').notNull(),
  costCenter: text('cost_center').notNull(),
  branchId: text('branch_id').notNull(),
  journalId: text('journal_id').notNull().default(''),
  createdByUid: text('created_by_uid').references(() => users.uid),
  createdAt: timestamp('created_at').defaultNow(),
});

export const wasteEntries = pgTable('waste_entries', {
  id: text('id').primaryKey(),
  wasteNo: text('waste_no').notNull().default(''),
  date: text('date').notNull(),
  ingredientId: text('ingredient_id')
    .notNull()
    .references(() => ingredients.id),
  ingredientNameAr: text('ingredient_name_ar').notNull(),
  qty: doublePrecision('qty').notNull(),
  unitCost: doublePrecision('unit_cost').notNull(),
  totalCost: doublePrecision('total_cost').notNull(),
  reason: text('reason').notNull(),
  branchId: text('branch_id').notNull(),
  journalId: text('journal_id').notNull().default(''),
  createdByUid: text('created_by_uid').references(() => users.uid),
  createdAt: timestamp('created_at').defaultNow(),
});

export const stocktakeEntries = pgTable('stocktake_entries', {
  id: text('id').primaryKey(),
  countNo: text('count_no').notNull().unique(),
  date: text('date').notNull(),
  branchId: text('branch_id').notNull(),
  locationAr: text('location_ar').notNull(),
  locationEn: text('location_en').notNull(),
  ingredientId: text('ingredient_id')
    .notNull()
    .references(() => ingredients.id),
  sku: text('sku').notNull(),
  ingredientNameAr: text('ingredient_name_ar').notNull(),
  ingredientNameEn: text('ingredient_name_en').notNull(),
  unit: text('unit').notNull(),
  bookQty: doublePrecision('book_qty').notNull(),
  actualQty: doublePrecision('actual_qty').notNull(),
  varianceQty: doublePrecision('variance_qty').notNull(),
  variancePct: doublePrecision('variance_pct').notNull(),
  unitCost: doublePrecision('unit_cost').notNull(),
  varianceValue: doublePrecision('variance_value').notNull(),
  status: text('status').notNull().default('pending_reconciliation'),
  countedBy: text('counted_by').notNull(),
  notes: text('notes'),
  reconciledAt: text('reconciled_at'),
  reconciliationJournalId: text('reconciliation_journal_id'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const journalEntries = pgTable('journal_entries', {
  id: text('id').primaryKey(),
  journalNo: text('journal_no').notNull().unique(),
  date: text('date').notNull(),
  period: text('period').notNull(),
  source: text('source').notNull(),
  referenceNo: text('reference_no').notNull(),
  description: text('description').notNull(),
  createdBy: text('created_by').notNull(),
  isReversed: boolean('is_reversed').default(false),
  reversalOfId: text('reversal_of_id'),
  reversedByJournalId: text('reversed_by_journal_id'),
  lines: jsonb('lines').$type<JournalLine[]>().notNull(),
  createdByUid: text('created_by_uid').references(() => users.uid),
  createdAt: timestamp('created_at').defaultNow(),
});

export const bankTransactions = pgTable('bank_transactions', {
  id: text('id').primaryKey(),
  date: text('date').notNull(),
  bankRef: text('bank_ref').notNull(),
  description: text('description').notNull(),
  debit: doublePrecision('debit').notNull(),
  credit: doublePrecision('credit').notNull(),
  runningBalance: doublePrecision('running_balance').notNull(),
  accountCode: text('account_code').notNull().default('1102'),
  matchStatus: text('match_status').notNull(),
  matchedJournalId: text('matched_journal_id'),
});

export const kdsOrders = pgTable('kds_orders', {
  id: text('id').primaryKey(),
  orderNo: text('order_no').notNull().default(''),
  invoiceNo: text('invoice_no').notNull(),
  createdAt: text('created_at').notNull(),
  timestampMs: bigint('timestamp_ms', { mode: 'number' }).notNull().default(0),
  orderType: text('order_type').notNull(),
  tableLabel: text('table_label'),
  station: text('station').notNull(),
  priority: text('priority').notNull(),
  status: text('status').notNull(),
  items: jsonb('items').$type<KdsOrder['items']>().notNull(),
});

export const auditLogs = pgTable('audit_logs', {
  id: text('id').primaryKey(),
  timestamp: text('timestamp').notNull(),
  actor: text('actor').notNull(),
  role: text('role').notNull().default('cfo'),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  details: text('details').notNull(),
  actorUid: text('actor_uid').references(() => users.uid),
});

export const salesInvoicesRelations = relations(salesInvoices, ({ many, one }) => ({
  items: many(salesInvoiceItems),
  creator: one(users, {
    fields: [salesInvoices.createdByUid],
    references: [users.uid],
  }),
}));

export const salesInvoiceItemsRelations = relations(salesInvoiceItems, ({ one }) => ({
  invoice: one(salesInvoices, {
    fields: [salesInvoiceItems.invoiceId],
    references: [salesInvoices.id],
  }),
  menuItem: one(menuItems, {
    fields: [salesInvoiceItems.menuItemId],
    references: [menuItems.id],
  }),
}));

export const backupConfigs = pgTable('backup_configs', {
  id: text('id').primaryKey(),
  bucketName: text('bucket_name').notNull(),
  prefix: text('prefix').notNull(),
  scheduleCron: text('schedule_cron').notNull(),
  timezone: text('timezone').notNull(),
  retentionDays: integer('retention_days').notNull().default(30),
  enabled: boolean('enabled').notNull().default(true),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const backupSnapshots = pgTable('backup_snapshots', {
  id: text('id').primaryKey(),
  createdAt: text('created_at').notNull(),
  snapshotDate: text('snapshot_date').notNull(),
  triggerType: text('trigger_type').notNull(),
  status: text('status').notNull(),
  storageMode: text('storage_mode').notNull(),
  bucketName: text('bucket_name').notNull(),
  objectPath: text('object_path').notNull(),
  gcsUri: text('gcs_uri').notNull(),
  localFilePath: text('local_file_path'),
  fileSizeBytes: integer('file_size_bytes').notNull().default(0),
  checksumSha256: text('checksum_sha256').notNull().default(''),
  rowCounts: jsonb('row_counts').$type<Record<string, number>>().notNull(),
  trialBalanceBalanced: boolean('trial_balance_balanced').notNull().default(true),
  triggeredBy: text('triggered_by').notNull(),
  errorMessage: text('error_message'),
});

export const executiveAutomationConfigs = pgTable('executive_automation_configs', {
  id: text('id').primaryKey(),
  gcsBucketName: text('gcs_bucket_name').notNull(),
  monthlyFolderPrefix: text('monthly_folder_prefix').notNull(),
  monthlyPdfEnabled: boolean('monthly_pdf_enabled').notNull().default(true),
  monthlyDayOfMonth: integer('monthly_day_of_month').notNull().default(1),
  monthlyHour: integer('monthly_hour').notNull().default(6),
  timezone: text('timezone').notNull().default('Africa/Cairo'),
  weeklyDigestEnabled: boolean('weekly_digest_enabled').notNull().default(false),
  weeklyDayOfWeek: integer('weekly_day_of_week').notNull().default(0),
  weeklyHour: integer('weekly_hour').notNull().default(8),
  weeklyRecipientEmail: text('weekly_recipient_email').notNull().default('tarek.elshafey75@gmail.com'),
  weeklyCcEmails: text('weekly_cc_emails').notNull().default(''),
  weeklyIncludePdf: boolean('weekly_include_pdf').notNull().default(true),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const executiveAutomationRuns = pgTable('executive_automation_runs', {
  id: text('id').primaryKey(),
  runType: text('run_type').notNull(),
  createdAt: text('created_at').notNull(),
  periodKey: text('period_key').notNull(),
  triggerType: text('trigger_type').notNull(),
  triggeredBy: text('triggered_by').notNull(),
  status: text('status').notNull(),
  storageMode: text('storage_mode').notNull(),
  bucketName: text('bucket_name').notNull(),
  objectPath: text('object_path').notNull(),
  gcsUri: text('gcs_uri').notNull(),
  localFilePath: text('local_file_path'),
  emlFilePath: text('eml_file_path'),
  fileSizeBytes: integer('file_size_bytes').notNull().default(0),
  checksumSha256: text('checksum_sha256').notNull().default(''),
  recipientEmail: text('recipient_email'),
  emailSubject: text('email_subject'),
  emailHtmlPreview: text('email_html_preview'),
  kpiSnapshot: jsonb('kpi_snapshot').$type<Record<string, unknown>>(),
  riskSnapshot: jsonb('risk_snapshot').$type<Record<string, unknown>>(),
  errorMessage: text('error_message'),
});

