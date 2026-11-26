import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { readFileSync } from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { createSeedErpState } from '../data/seedErpData.ts';
import type { ErpState } from '../types/erp.ts';
import {
  computeAccountBalances,
  computeBankRunningBalances,
  computeTrialBalanceTotals,
  round2,
  runDataQualityChecks,
} from '../utils/erpEngine.ts';
import { loadErpStateFromDb } from './erpRepository.ts';
import { createPool, db } from './index.ts';
import {
  auditLogs,
  bankTransactions,
  diningTables,
  erpMetadata,
  expenses,
  householdEntries,
  ingredients,
  journalEntries,
  kdsOrders,
  menuItems,
  purchaseInvoices,
  representatives,
  salesInvoiceItems,
  salesInvoices,
  stocktakeEntries,
  wasteEntries,
} from './schema.ts';

export type MigrationStage =
  | 'validating'
  | 'metadata_master'
  | 'sales_kds'
  | 'ledger_inventory'
  | 'verifying';

export interface MigrationProgressEvent {
  stage: MigrationStage;
  progress: number;
  labelAr: string;
  labelEn: string;
}

export interface MigrationOptions {
  overwriteExisting?: boolean;
  onProgress?: (event: MigrationProgressEvent) => void;
}

export interface MigrationReport {
  status: 'migrated' | 'verified_existing';
  counts: {
    ingredients: number;
    menuItems: number;
    tables: number;
    salesInvoices: number;
    purchaseInvoices: number;
    expenses: number;
    wasteEntries: number;
    journalEntries: number;
    bankTransactions: number;
    representatives: number;
    householdEntries: number;
    kdsOrders: number;
    auditLogs: number;
  };
  integrity: {
    trialBalanceBalanced: boolean;
    totalDebit: number;
    totalCredit: number;
    clearing1103Balance: number;
    cib1102Balance: number;
    inventoryLedger1201: number;
    qualityFailures: number;
  };
}

export function validateErpStateIntegrity(state: ErpState): void {
  const trial = computeTrialBalanceTotals(state);
  if (!trial.balanced) {
    throw new Error(
      `Pre-migration integrity error: Trial balance out of balance (Debit=${trial.totalDebit}, Credit=${trial.totalCredit}).`
    );
  }

  const ingredientIds = new Set(state.ingredients.map((i) => i.id));
  const menuItemIds = new Set(state.menuItems.map((m) => m.id));

  for (const item of state.menuItems) {
    for (const line of item.recipe) {
      if (!ingredientIds.has(line.ingredientId)) {
        throw new Error(
          `Pre-migration integrity error: Menu item ${item.id} references missing ingredient ${line.ingredientId}.`
        );
      }
    }
  }

  for (const inv of state.salesInvoices) {
    if (Math.abs(inv.grossTotal - round2(inv.netSales + inv.vatAmount)) > 0.05) {
      throw new Error(
        `Pre-migration integrity error: Sales invoice ${inv.invoiceNo} VAT/Net/Gross mismatch.`
      );
    }
    for (const line of inv.lines) {
      if (!menuItemIds.has(line.menuItemId)) {
        throw new Error(
          `Pre-migration integrity error: Sales invoice ${inv.invoiceNo} references missing menu item ${line.menuItemId}.`
        );
      }
    }
  }

  for (const po of state.purchaseInvoices) {
    if (Math.abs(po.grandTotal - round2(po.totalBeforeTax + po.vatAmount)) > 0.05) {
      throw new Error(
        `Pre-migration integrity error: Purchase invoice ${po.purchaseNo} VAT/Net/Gross mismatch.`
      );
    }
    for (const line of po.lines) {
      if (!ingredientIds.has(line.ingredientId)) {
        throw new Error(
          `Pre-migration integrity error: Purchase invoice ${po.purchaseNo} references missing ingredient ${line.ingredientId}.`
        );
      }
    }
  }

  for (const w of state.wasteEntries) {
    if (!ingredientIds.has(w.ingredientId)) {
      throw new Error(
        `Pre-migration integrity error: Waste entry ${w.wasteNo} references missing ingredient ${w.ingredientId}.`
      );
    }
  }

  for (const je of state.journalEntries) {
    const dr = round2(je.lines.reduce((acc, l) => acc + l.debit, 0));
    const cr = round2(je.lines.reduce((acc, l) => acc + l.credit, 0));
    if (Math.abs(dr - cr) > 0.05) {
      throw new Error(
        `Pre-migration integrity error: Journal entry ${je.journalNo} unbalanced (Dr=${dr}, Cr=${cr}).`
      );
    }
  }
}

export async function migrateErpStateToPostgres(
  sourceState?: ErpState,
  options: MigrationOptions = {}
): Promise<MigrationReport> {
  const state = sourceState ?? createSeedErpState();
  const overwrite = Boolean(options.overwriteExisting);
  const emit = options.onProgress;

  emit?.({
    stage: 'validating',
    progress: 15,
    labelAr: 'فحص الاتزان المحاسبي وروابط المنيو والمخزون...',
    labelEn: 'Validating trial balance, VAT math & BOM references...',
  });

  // 1. Verify source in-memory ErpState integrity before opening a DB transaction
  validateErpStateIntegrity(state);

  let insertedAny = false;

  try {
    await db.transaction(async (tx) => {
      emit?.({
        stage: 'metadata_master',
        progress: 35,
        labelAr: 'ترحيل بيانات الفرع وشجرة الحسابات والخامات والمنيو...',
        labelEn: 'Migrating branch metadata, chart of accounts, ingredients & menu BOM...',
      });
      // Metadata (global config, branches, accounts, 9M actuals, 2027 strategy, suppliers)
      const metaPayload = {
        id: 'global',
        activeBranchId: state.activeBranchId,
        companyNameAr: state.companyNameAr,
        companyNameEn: state.companyNameEn,
        taxId: state.taxId,
        reportDate: state.reportDate,
        vatRate: state.vatRate,
        branches: state.branches,
        accounts: state.accounts,
        monthlyActuals2026: state.monthlyActuals2026,
        strategy2027: state.strategy2027,
        suppliers: state.suppliers,
        customers: state.customers ?? [],
        updatedAt: new Date(),
      };

      if (overwrite) {
        await tx
          .insert(erpMetadata)
          .values(metaPayload)
          .onConflictDoUpdate({
            target: erpMetadata.id,
            set: metaPayload,
          });
        insertedAny = true;
      } else {
        const res = await tx.insert(erpMetadata).values(metaPayload).onConflictDoNothing().returning({ id: erpMetadata.id });
        if (res.length > 0) insertedAny = true;
      }

      // Ingredients (must exist before waste_entries & menu recipe refs)
      for (const i of state.ingredients) {
        const row = {
          id: i.id,
          sku: i.sku,
          nameAr: i.nameAr,
          nameEn: i.nameEn,
          category: i.category,
          unit: i.unit,
          currentQty: i.currentQty,
          reorderLevel: i.reorderLevel,
          weightedAvgCost: i.weightedAvgCost,
          lastPurchasePrice: i.lastPurchasePrice,
          openingQty: i.openingQty,
          purchasedQty: i.purchasedQty,
          issuedQty: i.issuedQty,
          wasteQty: i.wasteQty,
          preferredSupplierId: i.preferredSupplierId,
        };
        if (overwrite) {
          await tx.insert(ingredients).values(row).onConflictDoUpdate({ target: ingredients.id, set: row });
        } else {
          const res = await tx.insert(ingredients).values(row).onConflictDoNothing().returning({ id: ingredients.id });
          if (res.length > 0) insertedAny = true;
        }
      }

      // Menu items (must exist before sales_invoice_items FK)
      for (const m of state.menuItems) {
        const row = {
          id: m.id,
          code: m.code,
          menuNo: m.menuNo ?? 0,
          nameAr: m.nameAr,
          nameEn: m.nameEn,
          descriptionAr: m.descriptionAr ?? '',
          category: m.categoryAr,
          categoryEn: m.categoryEn,
          station: m.station,
          basePrice: m.basePrice ?? null,
          priceInclService: m.priceInclService ?? null,
          sellingPriceGross: m.sellingPriceGross,
          priceStatus: m.priceStatus ?? (m.sellingPriceGross > 0 ? 'priced' : 'unspecified'),
          listingType: m.listingType ?? 'مطبوع',
          targetFoodCostPct: m.targetFoodCostPct,
          yieldPortions: m.yieldPortions,
          q1UnitsSold: m.q1UnitsSold,
          recipe: m.recipe,
        };
        if (overwrite) {
          await tx.insert(menuItems).values(row).onConflictDoUpdate({ target: menuItems.id, set: row });
        } else {
          const res = await tx.insert(menuItems).values(row).onConflictDoNothing().returning({ id: menuItems.id });
          if (res.length > 0) insertedAny = true;
        }
      }

      // Dining tables
      for (const t of state.tables) {
        const row = {
          id: t.id,
          branchId: state.activeBranchId,
          label: t.number,
          zoneAr: t.zoneAr,
          zoneEn: t.zoneEn,
          seats: t.seats,
          status: t.status,
          activeOrderId: t.activeOrderId ?? null,
          activeTotal: t.activeTotal ?? null,
        };
        if (overwrite) {
          await tx.insert(diningTables).values(row).onConflictDoUpdate({ target: diningTables.id, set: row });
        } else {
          const res = await tx.insert(diningTables).values(row).onConflictDoNothing().returning({ id: diningTables.id });
          if (res.length > 0) insertedAny = true;
        }
      }

      emit?.({
        stage: 'sales_kds',
        progress: 60,
        labelAr: 'ترحيل فواتير المبيعات وبنودها وطلبات المطبخ...',
        labelEn: 'Migrating sales invoices, line items & kitchen display orders...',
      });

      // Sales invoices + invoice line items (idempotent child item insertion)
      for (const inv of state.salesInvoices) {
        const row = {
          id: inv.id,
          invoiceNo: inv.invoiceNo,
          date: inv.date,
          time: inv.time,
          branchId: inv.branchId,
          orderType: inv.orderType,
          tableId: inv.tableId ?? null,
          tableNumber: inv.tableNumber ?? null,
          cashier: inv.cashier,
          representativeId: inv.representativeId ?? null,
          representativeNameAr: inv.representativeNameAr ?? null,
          paymentMethod: inv.paymentMethod,
          splitCount: inv.splitCount,
          grossTotal: inv.grossTotal,
          netSales: inv.netSales,
          vatAmount: inv.vatAmount,
          cogsTotal: inv.cogsTotal,
          discountAmount: inv.discountAmount,
          journalId: inv.journalId,
          etaStatus: inv.etaStatus,
          source: inv.source,
          offlineQueued: inv.etaStatus === 'queued_offline',
        };

        let shouldInsertLines = false;
        if (overwrite) {
          await tx.insert(salesInvoices).values(row).onConflictDoUpdate({ target: salesInvoices.id, set: row });
          await tx.delete(salesInvoiceItems).where(eq(salesInvoiceItems.invoiceId, inv.id));
          shouldInsertLines = true;
          insertedAny = true;
        } else {
          const res = await tx.insert(salesInvoices).values(row).onConflictDoNothing().returning({ id: salesInvoices.id });
          if (res.length > 0) {
            shouldInsertLines = true;
            insertedAny = true;
          }
        }

        if (shouldInsertLines && inv.lines.length > 0) {
          await tx.insert(salesInvoiceItems).values(
            inv.lines.map((l) => ({
              invoiceId: inv.id,
              menuItemId: l.menuItemId,
              nameAr: l.nameAr,
              nameEn: l.nameEn,
              qty: l.qty,
              unitPriceGross: l.unitPriceGross,
              lineTotalGross: l.lineTotalGross,
              lineNet: l.lineNet,
              lineVat: l.lineVat,
              lineCogs: l.lineCogs,
              station: l.station,
            }))
          );
        }
      }

      emit?.({
        stage: 'ledger_inventory',
        progress: 82,
        labelAr: 'ترحيل المشتريات والمصروفات والقيود اليومية والتسوية البنكية...',
        labelEn: 'Migrating purchases, expenses, journal ledger & bank reconciliation...',
      });

      // Purchase invoices
      for (const p of state.purchaseInvoices) {
        const row = {
          id: p.id,
          purchaseNo: p.purchaseNo,
          date: p.date,
          supplierId: p.supplierId,
          supplierNameAr: p.supplierNameAr,
          representativeId: p.representativeId ?? null,
          representativeNameAr: p.representativeNameAr ?? null,
          branchId: p.branchId,
          paymentStatus: p.paymentStatus,
          netTotal: p.totalBeforeTax,
          vatAmount: p.vatAmount,
          grossTotal: p.grandTotal,
          lines: p.lines,
          journalId: p.journalId,
        };
        if (overwrite) {
          await tx.insert(purchaseInvoices).values(row).onConflictDoUpdate({ target: purchaseInvoices.id, set: row });
        } else {
          const res = await tx.insert(purchaseInvoices).values(row).onConflictDoNothing().returning({ id: purchaseInvoices.id });
          if (res.length > 0) insertedAny = true;
        }
      }

      // Operating expenses
      for (const e of state.expenses) {
        const row = {
          id: e.id,
          expenseNo: e.expenseNo,
          date: e.date,
          categoryAccountCode: e.categoryAccountCode,
          categoryNameAr: e.categoryNameAr,
          beneficiary: e.beneficiary,
          amountNet: e.amountNet,
          vatAmount: e.vatAmount,
          amountGross: e.totalAmount,
          paymentMethod: e.paymentMethod,
          costCenter: e.costCenter,
          branchId: e.branchId,
          journalId: e.journalId,
        };
        if (overwrite) {
          await tx.insert(expenses).values(row).onConflictDoUpdate({ target: expenses.id, set: row });
        } else {
          const res = await tx.insert(expenses).values(row).onConflictDoNothing().returning({ id: expenses.id });
          if (res.length > 0) insertedAny = true;
        }
      }

      // Waste entries
      for (const w of state.wasteEntries) {
        const row = {
          id: w.id,
          wasteNo: w.wasteNo,
          date: w.date,
          ingredientId: w.ingredientId,
          ingredientNameAr: w.ingredientNameAr,
          qty: w.qty,
          unitCost: w.unitCost,
          totalCost: w.totalValue,
          reason: w.reason,
          branchId: w.branchId,
          journalId: w.journalId,
        };
        if (overwrite) {
          await tx.insert(wasteEntries).values(row).onConflictDoUpdate({ target: wasteEntries.id, set: row });
        } else {
          const res = await tx.insert(wasteEntries).values(row).onConflictDoNothing().returning({ id: wasteEntries.id });
          if (res.length > 0) insertedAny = true;
        }
      }

      // Stocktake entries
      for (const s of state.stocktakeEntries ?? []) {
        const row = {
          id: s.id,
          countNo: s.countNo,
          date: s.date,
          branchId: s.branchId,
          locationAr: s.locationAr,
          locationEn: s.locationEn,
          ingredientId: s.ingredientId,
          sku: s.sku,
          ingredientNameAr: s.ingredientNameAr,
          ingredientNameEn: s.ingredientNameEn,
          unit: s.unit,
          bookQty: s.bookQty,
          actualQty: s.actualQty,
          varianceQty: s.varianceQty,
          variancePct: s.variancePct,
          unitCost: s.unitCost,
          varianceValue: s.varianceValue,
          status: s.status,
          countedBy: s.countedBy,
          notes: s.notes ?? null,
          reconciledAt: s.reconciledAt ?? null,
          reconciliationJournalId: s.reconciliationJournalId ?? null,
        };
        if (overwrite) {
          await tx.insert(stocktakeEntries).values(row).onConflictDoUpdate({ target: stocktakeEntries.id, set: row });
        } else {
          const res = await tx.insert(stocktakeEntries).values(row).onConflictDoNothing().returning({ id: stocktakeEntries.id });
          if (res.length > 0) insertedAny = true;
        }
      }

      // Journal ledger entries
      for (const j of state.journalEntries) {
        const row = {
          id: j.id,
          journalNo: j.journalNo,
          date: j.date,
          period: j.period,
          source: j.source,
          referenceNo: j.referenceNo,
          description: j.description,
          createdBy: j.createdBy,
          isReversed: Boolean(j.reversedByJournalId),
          reversalOfId: j.isReversal ? j.referenceNo : null,
          reversedByJournalId: j.reversedByJournalId ?? null,
          lines: j.lines,
        };
        if (overwrite) {
          await tx.insert(journalEntries).values(row).onConflictDoUpdate({ target: journalEntries.id, set: row });
        } else {
          const res = await tx.insert(journalEntries).values(row).onConflictDoNothing().returning({ id: journalEntries.id });
          if (res.length > 0) insertedAny = true;
        }
      }

      // Bank transactions
      const bankWithBalances = computeBankRunningBalances(state.bankTransactions);
      for (const b of bankWithBalances) {
        const row = {
          id: b.id,
          date: b.date,
          bankRef: b.bankRef,
          description: b.description,
          debit: b.debit,
          credit: b.credit,
          runningBalance: b.runningBalance ?? 0,
          accountCode: b.accountCode,
          matchStatus: b.matchStatus,
          matchedJournalId: b.matchedJournalId ?? null,
        };
        if (overwrite) {
          await tx.insert(bankTransactions).values(row).onConflictDoUpdate({ target: bankTransactions.id, set: row });
        } else {
          const res = await tx.insert(bankTransactions).values(row).onConflictDoNothing().returning({ id: bankTransactions.id });
          if (res.length > 0) insertedAny = true;
        }
      }

      // Representatives
      for (const r of state.representatives ?? []) {
        const row = {
          id: r.id,
          code: r.code,
          nameAr: r.nameAr,
          nameEn: r.nameEn,
          roleType: r.roleType,
          phone: r.phone,
          branchId: r.branchId,
          assignedArea: r.assignedArea,
          commissionPct: r.commissionPct,
          monthlyTarget: r.monthlyTarget,
          achievedSales: r.achievedSales,
          collectedAmount: r.collectedAmount,
          custodyBalance: r.custodyBalance,
          status: r.status,
          notes: r.notes ?? null,
        };
        if (overwrite) {
          await tx.insert(representatives).values(row).onConflictDoUpdate({ target: representatives.id, set: row });
        } else {
          const res = await tx.insert(representatives).values(row).onConflictDoNothing().returning({ id: representatives.id });
          if (res.length > 0) insertedAny = true;
        }
      }

      // Household entries (isolated ledger)
      for (const h of state.householdEntries ?? []) {
        const row = {
          id: h.id,
          entryNo: h.entryNo,
          date: h.date,
          type: h.type,
          categoryAr: h.categoryAr,
          categoryEn: h.categoryEn,
          description: h.description,
          amount: h.amount,
          paymentMethod: h.paymentMethod,
          memberName: h.memberName,
          notes: h.notes ?? null,
        };
        if (overwrite) {
          await tx.insert(householdEntries).values(row).onConflictDoUpdate({ target: householdEntries.id, set: row });
        } else {
          const res = await tx.insert(householdEntries).values(row).onConflictDoNothing().returning({ id: householdEntries.id });
          if (res.length > 0) insertedAny = true;
        }
      }

      // KDS orders
      for (const k of state.kdsOrders) {
        const row = {
          id: k.id,
          orderNo: k.orderNo,
          invoiceNo: k.invoiceNo,
          createdAt: k.createdAt,
          timestampMs: k.timestampMs,
          orderType: k.orderType,
          tableLabel: k.tableNumber ?? null,
          station: k.items[0]?.station ?? 'oven',
          priority: k.priority,
          status: k.status,
          items: k.items,
        };
        if (overwrite) {
          await tx.insert(kdsOrders).values(row).onConflictDoUpdate({ target: kdsOrders.id, set: row });
        } else {
          const res = await tx.insert(kdsOrders).values(row).onConflictDoNothing().returning({ id: kdsOrders.id });
          if (res.length > 0) insertedAny = true;
        }
      }

      // Audit logs
      for (const a of state.auditLogs) {
        const row = {
          id: a.id,
          timestamp: a.timestamp,
          actor: a.user,
          role: a.role,
          action: a.action,
          entityType: a.entityType,
          entityId: a.entityId,
          details: a.details,
        };
        if (overwrite) {
          await tx.insert(auditLogs).values(row).onConflictDoUpdate({ target: auditLogs.id, set: row });
        } else {
          const res = await tx.insert(auditLogs).values(row).onConflictDoNothing().returning({ id: auditLogs.id });
          if (res.length > 0) insertedAny = true;
        }
      }
    });
  } catch (error) {
    console.error('Migration transaction failed:', error);
    throw new Error('Failed to migrate ERP state into PostgreSQL.', { cause: error });
  }

  emit?.({
    stage: 'verifying',
    progress: 94,
    labelAr: 'التحقق من القراءة الفعلية واتزان القيود بعد الترحيل...',
    labelEn: 'Verifying persisted records & post-migration trial balance...',
  });

  // 2. Post-migration verification against persisted PostgreSQL records
  const persistedState = await loadErpStateFromDb();
  const persistedTrial = computeTrialBalanceTotals(persistedState);
  const persistedBalances = computeAccountBalances(persistedState);
  const persistedChecks = runDataQualityChecks(persistedState);
  const qualityFailures = persistedChecks.filter((c) => c.status === 'ERROR').length;

  if (!persistedTrial.balanced || qualityFailures > 0) {
    throw new Error(
      `Post-migration verification failed: balanced=${persistedTrial.balanced}, qualityFailures=${qualityFailures}`
    );
  }

  return {
    status: insertedAny ? 'migrated' : 'verified_existing',
    counts: {
      ingredients: persistedState.ingredients.length,
      menuItems: persistedState.menuItems.length,
      tables: persistedState.tables.length,
      salesInvoices: persistedState.salesInvoices.length,
      purchaseInvoices: persistedState.purchaseInvoices.length,
      expenses: persistedState.expenses.length,
      wasteEntries: persistedState.wasteEntries.length,
      journalEntries: persistedState.journalEntries.length,
      bankTransactions: persistedState.bankTransactions.length,
      representatives: (persistedState.representatives ?? []).length,
      householdEntries: (persistedState.householdEntries ?? []).length,
      kdsOrders: persistedState.kdsOrders.length,
      auditLogs: persistedState.auditLogs.length,
    },
    integrity: {
      trialBalanceBalanced: persistedTrial.balanced,
      totalDebit: persistedTrial.totalDebit,
      totalCredit: persistedTrial.totalCredit,
      clearing1103Balance: persistedBalances['1103'] ?? 0,
      cib1102Balance: persistedBalances['1102'] ?? 0,
      inventoryLedger1201: persistedBalances['1201'] ?? 0,
      qualityFailures,
    },
  };
}

async function runCli() {
  const args = process.argv.slice(2);
  const overwriteExisting = args.includes('--overwrite');
  const fileFlagIdx = args.indexOf('--file');
  let customState: ErpState | undefined;

  if (fileFlagIdx !== -1 && args[fileFlagIdx + 1]) {
    const resolvedPath = path.resolve(process.cwd(), args[fileFlagIdx + 1]);
    const raw = readFileSync(resolvedPath, 'utf8');
    const parsed = JSON.parse(raw);
    customState = parsed?.state ?? parsed;
  }

  try {
    const report = await migrateErpStateToPostgres(customState, { overwriteExisting });
    console.log('ERP PostgreSQL Migration Report:', JSON.stringify(report, null, 2));
  } finally {
    await createPool().end();
  }
}

const isCli =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isCli) {
  runCli().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}
