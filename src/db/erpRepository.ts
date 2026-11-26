import { desc, eq, inArray, notInArray } from 'drizzle-orm';
import { LEGACY_MENU_ID_REMAP, OFFICIAL_MENU_109 } from '../data/officialMenu109.ts';
import { createSeedErpState } from '../data/seedErpData.ts';
import type {
  AuditLogEntry,
  BankTransaction,
  Customer,
  DiningTable,
  ErpState,
  ExpenseEntry,
  HouseholdEntry,
  Ingredient,
  JournalEntry,
  KdsOrder,
  KdsStatus,
  MenuItem,
  PurchaseInvoice,
  Representative,
  RiskAuditEntry,
  SalesInvoice,
  SalesLineItem,
  StocktakeEntry,
  StrategyRisk,
  Supplier,
  UserRole,
  WasteEntry,
} from '../types/erp.ts';
import { computeBankRunningBalances, round2 } from '../utils/erpEngine.ts';
import { db } from './index.ts';
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

const METADATA_ROW_ID = 'global';

async function seedDatabaseIfEmptyTx(tx: Parameters<Parameters<typeof db.transaction>[0]>[0]): Promise<boolean> {
  const existing = await tx.select({ id: erpMetadata.id }).from(erpMetadata).where(eq(erpMetadata.id, METADATA_ROW_ID));
  if (existing.length > 0) {
    return false;
  }

  const seed = createSeedErpState();

  await tx
    .insert(erpMetadata)
    .values({
      id: METADATA_ROW_ID,
      activeBranchId: seed.activeBranchId,
      companyNameAr: seed.companyNameAr,
      companyNameEn: seed.companyNameEn,
      taxId: seed.taxId,
      reportDate: seed.reportDate,
      vatRate: seed.vatRate,
      branches: seed.branches,
      accounts: seed.accounts,
      monthlyActuals2026: seed.monthlyActuals2026,
      strategy2027: seed.strategy2027,
      suppliers: seed.suppliers,
      customers: seed.customers,
    })
    .onConflictDoNothing();

  if (seed.ingredients.length > 0) {
    await tx
      .insert(ingredients)
      .values(
        seed.ingredients.map((i) => ({
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
        }))
      )
      .onConflictDoNothing();
  }

  if (seed.menuItems.length > 0) {
    await tx
      .insert(menuItems)
      .values(
        seed.menuItems.map((m) => ({
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
        }))
      )
      .onConflictDoNothing();
  }

  if (seed.tables.length > 0) {
    await tx
      .insert(diningTables)
      .values(
        seed.tables.map((t) => ({
          id: t.id,
          branchId: seed.activeBranchId,
          label: t.number,
          zoneAr: t.zoneAr,
          zoneEn: t.zoneEn,
          seats: t.seats,
          status: t.status,
          activeOrderId: t.activeOrderId ?? null,
          activeTotal: t.activeTotal ?? null,
        }))
      )
      .onConflictDoNothing();
  }

  for (const inv of seed.salesInvoices) {
    await tx
      .insert(salesInvoices)
      .values({
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
      })
      .onConflictDoNothing();

    if (inv.lines.length > 0) {
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

  if (seed.purchaseInvoices.length > 0) {
    await tx
      .insert(purchaseInvoices)
      .values(
        seed.purchaseInvoices.map((p) => ({
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
        }))
      )
      .onConflictDoNothing();
  }

  if (seed.representatives.length > 0) {
    await tx
      .insert(representatives)
      .values(
        seed.representatives.map((r) => ({
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
        }))
      )
      .onConflictDoNothing();
  }

  if (seed.householdEntries.length > 0) {
    await tx
      .insert(householdEntries)
      .values(
        seed.householdEntries.map((h) => ({
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
        }))
      )
      .onConflictDoNothing();
  }

  if (seed.expenses.length > 0) {
    await tx
      .insert(expenses)
      .values(
        seed.expenses.map((e) => ({
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
        }))
      )
      .onConflictDoNothing();
  }

  if (seed.wasteEntries.length > 0) {
    await tx
      .insert(wasteEntries)
      .values(
        seed.wasteEntries.map((w) => ({
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
        }))
      )
      .onConflictDoNothing();
  }

  if (seed.stocktakeEntries && seed.stocktakeEntries.length > 0) {
    await tx
      .insert(stocktakeEntries)
      .values(
        seed.stocktakeEntries.map((s) => ({
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
        }))
      )
      .onConflictDoNothing();
  }

  if (seed.journalEntries.length > 0) {
    await tx
      .insert(journalEntries)
      .values(
        seed.journalEntries.map((j) => ({
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
        }))
      )
      .onConflictDoNothing();
  }

  if (seed.bankTransactions.length > 0) {
    const bankWithRunning = computeBankRunningBalances(seed.bankTransactions);
    await tx
      .insert(bankTransactions)
      .values(
        bankWithRunning.map((b) => ({
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
        }))
      )
      .onConflictDoNothing();
  }

  if (seed.kdsOrders.length > 0) {
    await tx
      .insert(kdsOrders)
      .values(
        seed.kdsOrders.map((k) => ({
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
        }))
      )
      .onConflictDoNothing();
  }

  if (seed.auditLogs.length > 0) {
    await tx
      .insert(auditLogs)
      .values(
        seed.auditLogs.map((a) => ({
          id: a.id,
          timestamp: a.timestamp,
          actor: a.user,
          role: a.role,
          action: a.action,
          entityType: a.entityType,
          entityId: a.entityId,
          details: a.details,
        }))
      )
      .onConflictDoNothing();
  }

  return true;
}

export async function loadErpStateFromDb(): Promise<ErpState> {
  try {
    await db.transaction(async (tx) => {
      await seedDatabaseIfEmptyTx(tx);
    });

    const [
      metaRows,
      ingRows,
      menuRows,
      tableRows,
      salesRows,
      salesItemRows,
      purchaseRows,
      expenseRows,
      wasteRows,
      stocktakeRows,
      journalRows,
      bankRows,
      kdsRows,
      auditRows,
      repRows,
      householdRows,
    ] = await Promise.all([
      db.select().from(erpMetadata).where(eq(erpMetadata.id, METADATA_ROW_ID)),
      db.select().from(ingredients),
      db.select().from(menuItems),
      db.select().from(diningTables),
      db.select().from(salesInvoices).orderBy(desc(salesInvoices.createdAt), desc(salesInvoices.invoiceNo)),
      db.select().from(salesInvoiceItems),
      db.select().from(purchaseInvoices).orderBy(desc(purchaseInvoices.createdAt), desc(purchaseInvoices.purchaseNo)),
      db.select().from(expenses).orderBy(desc(expenses.createdAt), desc(expenses.expenseNo)),
      db.select().from(wasteEntries).orderBy(desc(wasteEntries.createdAt), desc(wasteEntries.wasteNo)),
      db.select().from(stocktakeEntries).orderBy(desc(stocktakeEntries.createdAt), desc(stocktakeEntries.countNo)),
      db.select().from(journalEntries).orderBy(desc(journalEntries.createdAt), desc(journalEntries.journalNo)),
      db.select().from(bankTransactions),
      db.select().from(kdsOrders).orderBy(desc(kdsOrders.timestampMs)),
      db.select().from(auditLogs),
      db.select().from(representatives),
      db.select().from(householdEntries),
    ]);

    const officialIds = OFFICIAL_MENU_109.map((m) => m.id);
    const existingIds = new Set(menuRows.map((r) => r.id));
    const hasLegacyIds = menuRows.some((r) => r.id in LEGACY_MENU_ID_REMAP);
    const missingAnyOfficial = officialIds.some((id) => !existingIds.has(id));
    const missingMetadata = menuRows.some((r) => r.menuNo === 0);

    let activeMenuRows = menuRows;
    let activeSalesItemRows = salesItemRows;
    if (hasLegacyIds || missingAnyOfficial || missingMetadata) {
      await db.transaction(async (tx) => {
        for (const m of OFFICIAL_MENU_109) {
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
          await tx
            .insert(menuItems)
            .values(row)
            .onConflictDoUpdate({ target: menuItems.id, set: row });
        }

        for (const [legacyId, targetId] of Object.entries(LEGACY_MENU_ID_REMAP)) {
          if (existingIds.has(legacyId)) {
            await tx
              .update(salesInvoiceItems)
              .set({ menuItemId: targetId })
              .where(eq(salesInvoiceItems.menuItemId, legacyId));
          }
        }

        const staleLegacyIds = Object.keys(LEGACY_MENU_ID_REMAP).filter((id) => existingIds.has(id));
        if (staleLegacyIds.length > 0) {
          await tx.delete(menuItems).where(inArray(menuItems.id, staleLegacyIds));
        }

        // Also clean up any other non-official seed rows that have zero references
        await tx.delete(menuItems).where(notInArray(menuItems.id, officialIds));
      });

      [activeMenuRows, activeSalesItemRows] = await Promise.all([
        db.select().from(menuItems),
        db.select().from(salesInvoiceItems),
      ]);
    }

    const meta = metaRows[0];
    if (!meta) {
      return createSeedErpState();
    }

    const itemsByInvoice = new Map<string, SalesLineItem[]>();
    for (const item of activeSalesItemRows) {
      const list = itemsByInvoice.get(item.invoiceId) ?? [];
      list.push({
        menuItemId: item.menuItemId,
        nameAr: item.nameAr,
        nameEn: item.nameEn,
        qty: item.qty,
        unitPriceGross: item.unitPriceGross,
        lineTotalGross: item.lineTotalGross,
        lineNet: item.lineNet,
        lineVat: item.lineVat,
        lineCogs: item.lineCogs,
        station: item.station as SalesLineItem['station'],
      });
      itemsByInvoice.set(item.invoiceId, list);
    }

    const mappedIngredients: Ingredient[] = ingRows
      .map((r) => ({
        id: r.id,
        sku: r.sku,
        nameAr: r.nameAr,
        nameEn: r.nameEn,
        category: r.category,
        unit: r.unit as Ingredient['unit'],
        openingQty: r.openingQty,
        purchasedQty: r.purchasedQty,
        issuedQty: r.issuedQty,
        wasteQty: r.wasteQty,
        currentQty: r.currentQty,
        weightedAvgCost: r.weightedAvgCost,
        reorderLevel: r.reorderLevel,
        lastPurchasePrice: r.lastPurchasePrice,
        preferredSupplierId: r.preferredSupplierId,
      }))
      .sort((a, b) => a.sku.localeCompare(b.sku));

    const mappedMenu: MenuItem[] = activeMenuRows
      .map((r) => ({
        id: r.id,
        code: r.code,
        menuNo: r.menuNo,
        nameAr: r.nameAr,
        nameEn: r.nameEn,
        descriptionAr: r.descriptionAr,
        categoryAr: r.category,
        categoryEn: r.categoryEn,
        station: r.station as MenuItem['station'],
        basePrice: r.basePrice,
        priceInclService: r.priceInclService,
        sellingPriceGross: r.sellingPriceGross,
        priceStatus: (r.priceStatus as MenuItem['priceStatus']) || (r.sellingPriceGross > 0 ? 'priced' : 'unspecified'),
        listingType: (r.listingType as MenuItem['listingType']) || 'مطبوع',
        targetFoodCostPct: r.targetFoodCostPct,
        yieldPortions: r.yieldPortions,
        recipe: r.recipe,
        q1UnitsSold: r.q1UnitsSold,
      }))
      .sort((a, b) => (a.menuNo || 999) - (b.menuNo || 999) || a.code.localeCompare(b.code));

    const mappedTables: DiningTable[] = tableRows
      .map((r) => ({
        id: r.id,
        number: r.label,
        zoneAr: r.zoneAr,
        zoneEn: r.zoneEn,
        seats: r.seats,
        status: r.status as DiningTable['status'],
        activeOrderId: r.activeOrderId ?? undefined,
        activeTotal: r.activeTotal ?? undefined,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));

    const mappedSales: SalesInvoice[] = salesRows.map((r) => ({
      id: r.id,
      invoiceNo: r.invoiceNo,
      date: r.date,
      time: r.time,
      branchId: r.branchId,
      cashier: r.cashier,
      representativeId: r.representativeId ?? undefined,
      representativeNameAr: r.representativeNameAr ?? undefined,
      orderType: r.orderType as SalesInvoice['orderType'],
      tableId: r.tableId ?? undefined,
      tableNumber: r.tableNumber ?? undefined,
      paymentMethod: r.paymentMethod as SalesInvoice['paymentMethod'],
      splitCount: r.splitCount,
      discountAmount: r.discountAmount,
      grossTotal: r.grossTotal,
      netSales: r.netSales,
      vatAmount: r.vatAmount,
      cogsTotal: r.cogsTotal,
      lines: itemsByInvoice.get(r.id) ?? [],
      journalId: r.journalId,
      etaStatus: r.etaStatus as SalesInvoice['etaStatus'],
      source: r.source as SalesInvoice['source'],
    }));

    const mappedPurchases: PurchaseInvoice[] = purchaseRows.map((r) => ({
      id: r.id,
      purchaseNo: r.purchaseNo,
      date: r.date,
      branchId: r.branchId,
      supplierId: r.supplierId,
      supplierNameAr: r.supplierNameAr,
      representativeId: r.representativeId ?? undefined,
      representativeNameAr: r.representativeNameAr ?? undefined,
      paymentStatus: r.paymentStatus as PurchaseInvoice['paymentStatus'],
      totalBeforeTax: r.netTotal,
      vatAmount: r.vatAmount,
      grandTotal: r.grossTotal,
      lines: r.lines,
      journalId: r.journalId,
    }));

    const mappedExpenses: ExpenseEntry[] = expenseRows.map((r) => ({
      id: r.id,
      expenseNo: r.expenseNo,
      date: r.date,
      branchId: r.branchId,
      categoryAccountCode: r.categoryAccountCode,
      categoryNameAr: r.categoryNameAr,
      beneficiary: r.beneficiary,
      amountNet: r.amountNet,
      vatAmount: r.vatAmount,
      totalAmount: r.amountGross,
      paymentMethod: r.paymentMethod as ExpenseEntry['paymentMethod'],
      costCenter: r.costCenter,
      journalId: r.journalId,
    }));

    const mappedWaste: WasteEntry[] = wasteRows.map((r) => ({
      id: r.id,
      wasteNo: r.wasteNo,
      date: r.date,
      branchId: r.branchId,
      ingredientId: r.ingredientId,
      ingredientNameAr: r.ingredientNameAr,
      qty: r.qty,
      unitCost: r.unitCost,
      totalValue: r.totalCost,
      reason: r.reason as WasteEntry['reason'],
      journalId: r.journalId,
    }));

    const mappedJournals: JournalEntry[] = journalRows.map((r) => ({
      id: r.id,
      journalNo: r.journalNo,
      date: r.date,
      period: r.period,
      source: r.source as JournalEntry['source'],
      referenceNo: r.referenceNo,
      description: r.description,
      createdBy: r.createdBy,
      reversedByJournalId: r.reversedByJournalId ?? undefined,
      isReversal: Boolean(r.reversalOfId) || r.source === 'reversal',
      lines: r.lines,
    }));

    const mappedBank: BankTransaction[] = computeBankRunningBalances(
      bankRows.map((r) => ({
        id: r.id,
        bankRef: r.bankRef,
        date: r.date,
        description: r.description,
        debit: r.debit,
        credit: r.credit,
        runningBalance: r.runningBalance,
        accountCode: r.accountCode,
        matchedJournalId: r.matchedJournalId ?? undefined,
        matchStatus: r.matchStatus as BankTransaction['matchStatus'],
      }))
    );

    const mappedKds: KdsOrder[] = kdsRows.map((r) => ({
      id: r.id,
      orderNo: r.orderNo,
      invoiceNo: r.invoiceNo,
      createdAt: r.createdAt,
      timestampMs: r.timestampMs,
      orderType: r.orderType as KdsOrder['orderType'],
      tableNumber: r.tableLabel ?? undefined,
      status: r.status as KdsStatus,
      priority: r.priority as KdsOrder['priority'],
      items: r.items,
    }));

    const mappedAudits: AuditLogEntry[] = auditRows
      .map((r) => ({
        id: r.id,
        timestamp: r.timestamp,
        user: r.actor,
        role: r.role as UserRole,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        details: r.details,
      }))
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    const seedDefaults = createSeedErpState();

    // Auto-heal legacy seed ING-TEA valuation & suppliers AP (952,500 -> 2,150,000) if DB holds pre-fix seed baseline
    const staleTea = mappedIngredients.find(
      (i) => i.id === 'ING-TEA' && Math.abs(i.currentQty - 173) < 0.05 && Math.abs(i.weightedAvgCost - 595.12) < 0.05
    );
    if (staleTea && purchaseRows.every((p) => p.id.startsWith('PO-SEED-'))) {
      const seedTea = seedDefaults.ingredients.find((i) => i.id === 'ING-TEA');
      if (seedTea) {
        await db
          .update(ingredients)
          .set({
            purchasedQty: seedTea.purchasedQty,
            issuedQty: seedTea.issuedQty,
            wasteQty: seedTea.wasteQty,
            currentQty: seedTea.currentQty,
            weightedAvgCost: seedTea.weightedAvgCost,
            lastPurchasePrice: seedTea.lastPurchasePrice,
          })
          .where(eq(ingredients.id, 'ING-TEA'));
        Object.assign(staleTea, seedTea);
      }
    }

    let mappedReps: Representative[] = repRows
      .map((r) => ({
        id: r.id,
        code: r.code,
        nameAr: r.nameAr,
        nameEn: r.nameEn,
        roleType: r.roleType as Representative['roleType'],
        phone: r.phone,
        branchId: r.branchId,
        assignedArea: r.assignedArea,
        commissionPct: r.commissionPct,
        monthlyTarget: r.monthlyTarget,
        achievedSales: r.achievedSales,
        collectedAmount: r.collectedAmount,
        custodyBalance: r.custodyBalance,
        status: r.status as Representative['status'],
        notes: r.notes ?? undefined,
      }))
      .sort((a, b) => a.code.localeCompare(b.code));

    if (mappedReps.length === 0 && !auditRows.some((a) => a.entityType === 'Representative') && seedDefaults.representatives.length > 0) {
      await db
        .insert(representatives)
        .values(
          seedDefaults.representatives.map((r) => ({
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
          }))
        )
        .onConflictDoNothing();
      mappedReps = seedDefaults.representatives;
    }

    let mappedHousehold: HouseholdEntry[] = householdRows
      .map((h) => ({
        id: h.id,
        entryNo: h.entryNo,
        date: h.date,
        type: h.type as HouseholdEntry['type'],
        categoryAr: h.categoryAr,
        categoryEn: h.categoryEn,
        description: h.description,
        amount: h.amount,
        paymentMethod: h.paymentMethod as HouseholdEntry['paymentMethod'],
        memberName: h.memberName,
        notes: h.notes ?? undefined,
      }))
      .sort((a, b) => b.date.localeCompare(a.date) || b.entryNo.localeCompare(a.entryNo));

    if (mappedHousehold.length === 0 && !auditRows.some((a) => a.entityType === 'Household') && seedDefaults.householdEntries.length > 0) {
      await db
        .insert(householdEntries)
        .values(
          seedDefaults.householdEntries.map((h) => ({
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
          }))
        )
        .onConflictDoNothing();
      mappedHousehold = seedDefaults.householdEntries;
    }

    let mappedStocktakes: StocktakeEntry[] = stocktakeRows.map((r) => ({
      id: r.id,
      countNo: r.countNo,
      date: r.date,
      branchId: r.branchId,
      locationAr: r.locationAr,
      locationEn: r.locationEn,
      ingredientId: r.ingredientId,
      sku: r.sku,
      ingredientNameAr: r.ingredientNameAr,
      ingredientNameEn: r.ingredientNameEn,
      unit: r.unit,
      bookQty: r.bookQty,
      actualQty: r.actualQty,
      varianceQty: r.varianceQty,
      variancePct: r.variancePct,
      unitCost: r.unitCost,
      varianceValue: r.varianceValue,
      status: r.status as StocktakeEntry['status'],
      countedBy: r.countedBy,
      notes: r.notes ?? undefined,
      reconciledAt: r.reconciledAt ?? undefined,
      reconciliationJournalId: r.reconciliationJournalId ?? undefined,
    }));

    if (mappedStocktakes.length === 0 && seedDefaults.stocktakeEntries && seedDefaults.stocktakeEntries.length > 0) {
      await db
        .insert(stocktakeEntries)
        .values(
          seedDefaults.stocktakeEntries.map((s) => ({
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
          }))
        )
        .onConflictDoNothing();
      mappedStocktakes = seedDefaults.stocktakeEntries;
    }

    let resolvedSuppliers =
      meta.suppliers && meta.suppliers.length > 4 ? meta.suppliers : seedDefaults.suppliers;

    const currentApSum = round2(
      resolvedSuppliers.reduce((sum, s) => sum + s.aging0_30 + s.aging31_60 + s.aging61_90Plus, 0)
    );
    if (
      Math.abs(currentApSum - 952500) < 100 &&
      purchaseRows.every((p) => p.id.startsWith('PO-SEED-')) &&
      !journalRows.some((j) => j.source === 'supplier_payment')
    ) {
      resolvedSuppliers = seedDefaults.suppliers;
      await db
        .update(erpMetadata)
        .set({ suppliers: resolvedSuppliers, updatedAt: new Date() })
        .where(eq(erpMetadata.id, METADATA_ROW_ID));
    }

    const resolvedCustomers =
      meta.customers && meta.customers.length > 0 ? meta.customers : seedDefaults.customers;

    let resolvedStrategy = meta.strategy2027;
    const rawRisks = resolvedStrategy?.risks ?? [];
    const hasEnrichedRisks = rawRisks.some((r) => Boolean(r.category) && Boolean(r.ownerAr));
    const missingAuditHistory = rawRisks.some((r) => !Array.isArray(r.auditHistory) || r.auditHistory.length === 0);
    if (!hasEnrichedRisks || missingAuditHistory) {
      const enrichedMap = new Map(seedDefaults.strategy2027.risks.map((r) => [r.id, r]));
      const mergedRisks: StrategyRisk[] = rawRisks.map((r) => {
        const seeded = enrichedMap.get(r.id);
        const existingHistory = Array.isArray(r.auditHistory) && r.auditHistory.length > 0 ? r.auditHistory : undefined;
        const fallbackHistory: RiskAuditEntry[] = seeded?.auditHistory ?? [
          {
            id: `RAUD-INIT-${r.id}`,
            timestamp: r.updatedAt || '2026-10-01 09:00',
            actor: r.ownerAr || 'المدير المالي CFO',
            actionType: 'created',
            summaryAr: `تسجيل الخطر المبدئي: ${r.mitigationAr || r.riskAr}`,
            summaryEn: `Initial risk baseline: ${r.mitigationEn || r.riskEn || r.riskAr}`,
            newStatus: r.status ?? 'open',
            newImpact: r.impact ?? 'medium',
            newMitigation: r.mitigationAr,
            newOwner: r.ownerAr || 'المدير المالي CFO',
          },
        ];
        return {
          ...(seeded ?? {}),
          ...r,
          category: r.category ?? seeded?.category ?? 'financial',
          focusArea: r.focusArea ?? seeded?.focusArea ?? 'usufruct',
          ownerAr: r.ownerAr ?? seeded?.ownerAr ?? 'المدير المالي CFO',
          ownerEn: r.ownerEn ?? seeded?.ownerEn ?? 'CFO',
          status: r.status ?? seeded?.status ?? 'open',
          auditHistory: existingHistory ?? fallbackHistory,
        };
      });
      if (!hasEnrichedRisks) {
        for (const seedRisk of seedDefaults.strategy2027.risks) {
          if (!mergedRisks.some((m) => m.id === seedRisk.id)) {
            mergedRisks.push(seedRisk);
          }
        }
      }
      resolvedStrategy = {
        ...resolvedStrategy,
        risks: mergedRisks,
      };
      await db
        .update(erpMetadata)
        .set({ strategy2027: resolvedStrategy, updatedAt: new Date() })
        .where(eq(erpMetadata.id, METADATA_ROW_ID));
    }

    return {
      companyNameAr: meta.companyNameAr,
      companyNameEn: meta.companyNameEn,
      taxId: meta.taxId,
      reportDate: meta.reportDate,
      vatRate: meta.vatRate,
      branches: meta.branches,
      activeBranchId: meta.activeBranchId,
      accounts: meta.accounts,
      monthlyActuals2026: meta.monthlyActuals2026,
      strategy2027: resolvedStrategy,
      suppliers: resolvedSuppliers,
      customers: resolvedCustomers,
      representatives: mappedReps,
      householdEntries: mappedHousehold,
      ingredients: mappedIngredients,
      menuItems: mappedMenu,
      tables: mappedTables,
      salesInvoices: mappedSales,
      purchaseInvoices: mappedPurchases,
      expenses: mappedExpenses,
      wasteEntries: mappedWaste,
      stocktakeEntries: mappedStocktakes,
      journalEntries: mappedJournals,
      bankTransactions: mappedBank,
      kdsOrders: mappedKds,
      auditLogs: mappedAudits,
    };
  } catch (error) {
    console.error('Failed to load ERP state from PostgreSQL:', error);
    throw new Error('Failed to load ERP data from database.', { cause: error });
  }
}

export async function persistActiveBranchInDb(branchId: string): Promise<void> {
  try {
    await db
      .update(erpMetadata)
      .set({ activeBranchId: branchId, updatedAt: new Date() })
      .where(eq(erpMetadata.id, METADATA_ROW_ID));
  } catch (error) {
    console.error('Failed to update active branch:', error);
    throw new Error('Failed to update branch selection.', { cause: error });
  }
}

export async function persistSaleInDb(
  nextState: ErpState,
  invoice: SalesInvoice,
  journal: JournalEntry,
  kdsOrder: KdsOrder,
  actorUid?: string
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await tx.insert(salesInvoices).values({
        id: invoice.id,
        invoiceNo: invoice.invoiceNo,
        date: invoice.date,
        time: invoice.time,
        branchId: invoice.branchId,
        orderType: invoice.orderType,
        tableId: invoice.tableId ?? null,
        tableNumber: invoice.tableNumber ?? null,
        cashier: invoice.cashier,
        representativeId: invoice.representativeId ?? null,
        representativeNameAr: invoice.representativeNameAr ?? null,
        paymentMethod: invoice.paymentMethod,
        splitCount: invoice.splitCount,
        grossTotal: invoice.grossTotal,
        netSales: invoice.netSales,
        vatAmount: invoice.vatAmount,
        cogsTotal: invoice.cogsTotal,
        discountAmount: invoice.discountAmount,
        journalId: invoice.journalId,
        etaStatus: invoice.etaStatus,
        source: invoice.source,
        offlineQueued: invoice.etaStatus === 'queued_offline',
        createdByUid: actorUid ?? null,
      });

      if (invoice.lines.length > 0) {
        await tx.insert(salesInvoiceItems).values(
          invoice.lines.map((l) => ({
            invoiceId: invoice.id,
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

      await tx.insert(journalEntries).values({
        id: journal.id,
        journalNo: journal.journalNo,
        date: journal.date,
        period: journal.period,
        source: journal.source,
        referenceNo: journal.referenceNo,
        description: journal.description,
        createdBy: journal.createdBy,
        isReversed: false,
        reversalOfId: null,
        reversedByJournalId: null,
        lines: journal.lines,
        createdByUid: actorUid ?? null,
      });

      await tx.insert(kdsOrders).values({
        id: kdsOrder.id,
        orderNo: kdsOrder.orderNo,
        invoiceNo: kdsOrder.invoiceNo,
        createdAt: kdsOrder.createdAt,
        timestampMs: kdsOrder.timestampMs,
        orderType: kdsOrder.orderType,
        tableLabel: kdsOrder.tableNumber ?? null,
        station: kdsOrder.items[0]?.station ?? 'oven',
        priority: kdsOrder.priority,
        status: kdsOrder.status,
        items: kdsOrder.items,
      });

      for (const ing of nextState.ingredients) {
        await tx
          .update(ingredients)
          .set({
            issuedQty: ing.issuedQty,
            currentQty: ing.currentQty,
          })
          .where(eq(ingredients.id, ing.id));
      }

      if (invoice.representativeId) {
        const rep = nextState.representatives.find((r) => r.id === invoice.representativeId);
        if (rep) {
          await tx
            .update(representatives)
            .set({
              achievedSales: rep.achievedSales,
              collectedAmount: rep.collectedAmount,
            })
            .where(eq(representatives.id, rep.id));
        }
      }

      const linkedBank = nextState.bankTransactions.find((b) => b.matchedJournalId === journal.id);
      if (linkedBank) {
        await tx
          .insert(bankTransactions)
          .values({
            id: linkedBank.id,
            date: linkedBank.date,
            bankRef: linkedBank.bankRef,
            description: linkedBank.description,
            debit: linkedBank.debit,
            credit: linkedBank.credit,
            runningBalance: linkedBank.runningBalance ?? 0,
            accountCode: linkedBank.accountCode,
            matchStatus: linkedBank.matchStatus,
            matchedJournalId: linkedBank.matchedJournalId ?? null,
          })
          .onConflictDoNothing();
      }

      if (invoice.tableId) {
        const updatedTable = nextState.tables.find((t) => t.id === invoice.tableId);
        if (updatedTable) {
          await tx
            .update(diningTables)
            .set({
              status: updatedTable.status,
              activeOrderId: updatedTable.activeOrderId ?? null,
              activeTotal: updatedTable.activeTotal ?? null,
            })
            .where(eq(diningTables.id, updatedTable.id));
        }
      }

      const latestAudit = nextState.auditLogs[0];
      if (latestAudit) {
        await tx.insert(auditLogs).values({
          id: latestAudit.id,
          timestamp: latestAudit.timestamp,
          actor: latestAudit.user,
          role: latestAudit.role,
          action: latestAudit.action,
          entityType: latestAudit.entityType,
          entityId: latestAudit.entityId,
          details: latestAudit.details,
          actorUid: actorUid ?? null,
        });
      }
    });
  } catch (error) {
    console.error('Failed to persist POS sale:', error);
    throw new Error('Failed to save sales invoice to database.', { cause: error });
  }
}

export async function persistKdsStatusInDb(orderId: string, status: KdsStatus): Promise<void> {
  try {
    await db.update(kdsOrders).set({ status }).where(eq(kdsOrders.id, orderId));
  } catch (error) {
    console.error('Failed to update KDS order status:', error);
    throw new Error('Failed to update kitchen order status.', { cause: error });
  }
}

export async function persistReleaseTableInDb(tableId: string): Promise<void> {
  try {
    await db
      .update(diningTables)
      .set({
        status: 'available',
        activeOrderId: null,
        activeTotal: null,
      })
      .where(eq(diningTables.id, tableId));
  } catch (error) {
    console.error('Failed to release dining table:', error);
    throw new Error('Failed to update table availability.', { cause: error });
  }
}

export async function persistPurchaseInDb(
  nextState: ErpState,
  purchase: PurchaseInvoice,
  actorUid?: string
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await tx.insert(purchaseInvoices).values({
        id: purchase.id,
        purchaseNo: purchase.purchaseNo,
        date: purchase.date,
        supplierId: purchase.supplierId,
        supplierNameAr: purchase.supplierNameAr,
        representativeId: purchase.representativeId ?? null,
        representativeNameAr: purchase.representativeNameAr ?? null,
        branchId: purchase.branchId,
        paymentStatus: purchase.paymentStatus,
        netTotal: purchase.totalBeforeTax,
        vatAmount: purchase.vatAmount,
        grossTotal: purchase.grandTotal,
        lines: purchase.lines,
        journalId: purchase.journalId,
        createdByUid: actorUid ?? null,
      });

      const journal = nextState.journalEntries[0];
      if (journal) {
        await tx.insert(journalEntries).values({
          id: journal.id,
          journalNo: journal.journalNo,
          date: journal.date,
          period: journal.period,
          source: journal.source,
          referenceNo: journal.referenceNo,
          description: journal.description,
          createdBy: journal.createdBy,
          isReversed: false,
          reversalOfId: null,
          reversedByJournalId: null,
          lines: journal.lines,
          createdByUid: actorUid ?? null,
        });

        const linkedBank = nextState.bankTransactions.find((b) => b.matchedJournalId === journal.id);
        if (linkedBank) {
          await tx
            .insert(bankTransactions)
            .values({
              id: linkedBank.id,
              date: linkedBank.date,
              bankRef: linkedBank.bankRef,
              description: linkedBank.description,
              debit: linkedBank.debit,
              credit: linkedBank.credit,
              runningBalance: linkedBank.runningBalance ?? 0,
              accountCode: linkedBank.accountCode,
              matchStatus: linkedBank.matchStatus,
              matchedJournalId: linkedBank.matchedJournalId ?? null,
            })
            .onConflictDoNothing();
        }
      }

      for (const line of purchase.lines) {
        const updatedIng = nextState.ingredients.find((i) => i.id === line.ingredientId);
        if (updatedIng) {
          await tx
            .update(ingredients)
            .set({
              purchasedQty: updatedIng.purchasedQty,
              currentQty: updatedIng.currentQty,
              weightedAvgCost: updatedIng.weightedAvgCost,
              lastPurchasePrice: updatedIng.lastPurchasePrice,
            })
            .where(eq(ingredients.id, updatedIng.id));
        }
      }

      await tx
        .update(erpMetadata)
        .set({ suppliers: nextState.suppliers, updatedAt: new Date() })
        .where(eq(erpMetadata.id, METADATA_ROW_ID));

      const latestAudit = nextState.auditLogs[0];
      if (latestAudit) {
        await tx.insert(auditLogs).values({
          id: latestAudit.id,
          timestamp: latestAudit.timestamp,
          actor: latestAudit.user,
          role: latestAudit.role,
          action: latestAudit.action,
          entityType: latestAudit.entityType,
          entityId: latestAudit.entityId,
          details: latestAudit.details,
          actorUid: actorUid ?? null,
        });
      }
    });
  } catch (error) {
    console.error('Failed to persist purchase invoice:', error);
    throw new Error('Failed to save purchase invoice to database.', { cause: error });
  }
}

export async function persistExpenseInDb(nextState: ErpState, actorUid?: string): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const expense = nextState.expenses[0];
      if (expense) {
        await tx.insert(expenses).values({
          id: expense.id,
          expenseNo: expense.expenseNo,
          date: expense.date,
          categoryAccountCode: expense.categoryAccountCode,
          categoryNameAr: expense.categoryNameAr,
          beneficiary: expense.beneficiary,
          amountNet: expense.amountNet,
          vatAmount: expense.vatAmount,
          amountGross: expense.totalAmount,
          paymentMethod: expense.paymentMethod,
          costCenter: expense.costCenter,
          branchId: expense.branchId,
          journalId: expense.journalId,
          createdByUid: actorUid ?? null,
        });
      }

      const journal = nextState.journalEntries[0];
      if (journal) {
        await tx.insert(journalEntries).values({
          id: journal.id,
          journalNo: journal.journalNo,
          date: journal.date,
          period: journal.period,
          source: journal.source,
          referenceNo: journal.referenceNo,
          description: journal.description,
          createdBy: journal.createdBy,
          isReversed: false,
          reversalOfId: null,
          reversedByJournalId: null,
          lines: journal.lines,
          createdByUid: actorUid ?? null,
        });

        const linkedBank = nextState.bankTransactions.find((b) => b.matchedJournalId === journal.id);
        if (linkedBank) {
          await tx
            .insert(bankTransactions)
            .values({
              id: linkedBank.id,
              date: linkedBank.date,
              bankRef: linkedBank.bankRef,
              description: linkedBank.description,
              debit: linkedBank.debit,
              credit: linkedBank.credit,
              runningBalance: linkedBank.runningBalance ?? 0,
              accountCode: linkedBank.accountCode,
              matchStatus: linkedBank.matchStatus,
              matchedJournalId: linkedBank.matchedJournalId ?? null,
            })
            .onConflictDoNothing();
        }
      }
    });
  } catch (error) {
    console.error('Failed to persist expense:', error);
    throw new Error('Failed to save operating expense to database.', { cause: error });
  }
}

export async function persistWasteInDb(nextState: ErpState, actorUid?: string): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const waste = nextState.wasteEntries[0];
      if (waste) {
        await tx.insert(wasteEntries).values({
          id: waste.id,
          wasteNo: waste.wasteNo,
          date: waste.date,
          ingredientId: waste.ingredientId,
          ingredientNameAr: waste.ingredientNameAr,
          qty: waste.qty,
          unitCost: waste.unitCost,
          totalCost: waste.totalValue,
          reason: waste.reason,
          branchId: waste.branchId,
          journalId: waste.journalId,
          createdByUid: actorUid ?? null,
        });

        const updatedIng = nextState.ingredients.find((i) => i.id === waste.ingredientId);
        if (updatedIng) {
          await tx
            .update(ingredients)
            .set({
              wasteQty: updatedIng.wasteQty,
              currentQty: updatedIng.currentQty,
            })
            .where(eq(ingredients.id, updatedIng.id));
        }
      }

      const journal = nextState.journalEntries[0];
      if (journal) {
        await tx.insert(journalEntries).values({
          id: journal.id,
          journalNo: journal.journalNo,
          date: journal.date,
          period: journal.period,
          source: journal.source,
          referenceNo: journal.referenceNo,
          description: journal.description,
          createdBy: journal.createdBy,
          isReversed: false,
          reversalOfId: null,
          reversedByJournalId: null,
          lines: journal.lines,
          createdByUid: actorUid ?? null,
        });
      }
    });
  } catch (error) {
    console.error('Failed to persist waste entry:', error);
    throw new Error('Failed to save waste record to database.', { cause: error });
  }
}

export async function persistMenuUpdateInDb(
  menuItemId: string,
  sellingPriceGross?: number,
  recipe?: MenuItem['recipe']
): Promise<void> {
  try {
    const updates: Partial<{
      sellingPriceGross: number;
      priceInclService: number | null;
      basePrice: number | null;
      priceStatus: string;
      recipe: MenuItem['recipe'];
    }> = {};
    if (typeof sellingPriceGross === 'number') {
      const rounded = Math.round(sellingPriceGross * 100) / 100;
      updates.sellingPriceGross = rounded;
      if (rounded > 0) {
        updates.priceInclService = rounded;
        updates.basePrice = Math.round((rounded / 1.12) * 100) / 100;
        updates.priceStatus = 'priced';
      } else {
        updates.priceInclService = null;
        updates.basePrice = null;
        updates.priceStatus = 'unspecified';
      }
    }
    if (Array.isArray(recipe)) updates.recipe = recipe;
    if (Object.keys(updates).length > 0) {
      await db.update(menuItems).set(updates).where(eq(menuItems.id, menuItemId));
    }
  } catch (error) {
    console.error('Failed to update menu item:', error);
    throw new Error('Failed to save menu item update.', { cause: error });
  }
}

export async function persistJournalReversalInDb(
  nextState: ErpState,
  originalJournalId: string,
  actorUid?: string
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const reversal = nextState.journalEntries[0];
      const original = nextState.journalEntries.find((j) => j.id === originalJournalId);
      if (!reversal || !original || reversal.id === original.id) {
        return;
      }

      await tx.insert(journalEntries).values({
        id: reversal.id,
        journalNo: reversal.journalNo,
        date: reversal.date,
        period: reversal.period,
        source: reversal.source,
        referenceNo: reversal.referenceNo,
        description: reversal.description,
        createdBy: reversal.createdBy,
        isReversed: false,
        reversalOfId: original.id,
        reversedByJournalId: null,
        lines: reversal.lines,
        createdByUid: actorUid ?? null,
      });

      await tx
        .update(journalEntries)
        .set({
          isReversed: true,
          reversedByJournalId: reversal.id,
        })
        .where(eq(journalEntries.id, originalJournalId));

      const latestAudit = nextState.auditLogs[0];
      if (latestAudit) {
        await tx.insert(auditLogs).values({
          id: latestAudit.id,
          timestamp: latestAudit.timestamp,
          actor: latestAudit.user,
          role: latestAudit.role,
          action: latestAudit.action,
          entityType: latestAudit.entityType,
          entityId: latestAudit.entityId,
          details: latestAudit.details,
          actorUid: actorUid ?? null,
        });
      }
    });
  } catch (error) {
    console.error('Failed to persist journal reversal:', error);
    throw new Error('Failed to save journal reversal.', { cause: error });
  }
}

export async function persistBankReconInDb(
  bankTxnId: string,
  journal: JournalEntry,
  actorUid?: string
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await tx.insert(journalEntries).values({
        id: journal.id,
        journalNo: journal.journalNo,
        date: journal.date,
        period: journal.period,
        source: journal.source,
        referenceNo: journal.referenceNo,
        description: journal.description,
        createdBy: journal.createdBy,
        isReversed: false,
        reversalOfId: null,
        reversedByJournalId: null,
        lines: journal.lines,
        createdByUid: actorUid ?? null,
      });

      await tx
        .update(bankTransactions)
        .set({
          matchStatus: 'matched',
          matchedJournalId: journal.id,
        })
        .where(eq(bankTransactions.id, bankTxnId));
    });
  } catch (error) {
    console.error('Failed to persist bank reconciliation:', error);
    throw new Error('Failed to save bank reconciliation.', { cause: error });
  }
}

export async function persistPartnersDemoSeedInDb(): Promise<ErpState> {
  try {
    const seed = createSeedErpState();
    const rows = await db.select().from(erpMetadata).where(eq(erpMetadata.id, METADATA_ROW_ID));
    const current = rows[0];
    if (current) {
      const existingSupplierIds = new Set((current.suppliers ?? []).map((s) => s.id));
      const mergedSuppliers = [
        ...(current.suppliers ?? []).map((s) => seed.suppliers.find((ss) => ss.id === s.id) ?? s),
        ...seed.suppliers.filter((ss) => !existingSupplierIds.has(ss.id)),
      ];
      const existingCustomerIds = new Set((current.customers ?? []).map((c) => c.id));
      const mergedCustomers = [
        ...(current.customers ?? []),
        ...seed.customers.filter((sc) => !existingCustomerIds.has(sc.id)),
      ];
      await db
        .update(erpMetadata)
        .set({
          suppliers: mergedSuppliers,
          customers: mergedCustomers,
          updatedAt: new Date(),
        })
        .where(eq(erpMetadata.id, METADATA_ROW_ID));
    }
    return await loadErpStateFromDb();
  } catch (error) {
    console.error('Failed to seed demo partners:', error);
    throw new Error('Failed to load demo suppliers and customers.', { cause: error });
  }
}

export async function persistSupplierInDb(supplier: Supplier): Promise<ErpState> {
  try {
    const rows = await db.select().from(erpMetadata).where(eq(erpMetadata.id, METADATA_ROW_ID));
    const current = rows[0];
    if (current) {
      const nextSuppliers = [supplier, ...(current.suppliers ?? []).filter((s) => s.id !== supplier.id)];
      await db
        .update(erpMetadata)
        .set({ suppliers: nextSuppliers, updatedAt: new Date() })
        .where(eq(erpMetadata.id, METADATA_ROW_ID));
    }
    return await loadErpStateFromDb();
  } catch (error) {
    console.error('Failed to add supplier:', error);
    throw new Error('Failed to save supplier.', { cause: error });
  }
}

export async function persistCustomerInDb(customer: Customer): Promise<ErpState> {
  try {
    const rows = await db.select().from(erpMetadata).where(eq(erpMetadata.id, METADATA_ROW_ID));
    const current = rows[0];
    if (current) {
      const nextCustomers = [customer, ...(current.customers ?? []).filter((c) => c.id !== customer.id)];
      await db
        .update(erpMetadata)
        .set({ customers: nextCustomers, updatedAt: new Date() })
        .where(eq(erpMetadata.id, METADATA_ROW_ID));
    }
    return await loadErpStateFromDb();
  } catch (error) {
    console.error('Failed to add customer:', error);
    throw new Error('Failed to save customer.', { cause: error });
  }
}

export async function persistStocktakeEntryInDb(
  nextState: ErpState,
  entry: StocktakeEntry,
  actorUid?: string
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await tx.insert(stocktakeEntries).values({
        id: entry.id,
        countNo: entry.countNo,
        date: entry.date,
        branchId: entry.branchId,
        locationAr: entry.locationAr,
        locationEn: entry.locationEn,
        ingredientId: entry.ingredientId,
        sku: entry.sku,
        ingredientNameAr: entry.ingredientNameAr,
        ingredientNameEn: entry.ingredientNameEn,
        unit: entry.unit,
        bookQty: entry.bookQty,
        actualQty: entry.actualQty,
        varianceQty: entry.varianceQty,
        variancePct: entry.variancePct,
        unitCost: entry.unitCost,
        varianceValue: entry.varianceValue,
        status: entry.status,
        countedBy: entry.countedBy,
        notes: entry.notes ?? null,
        reconciledAt: entry.reconciledAt ?? null,
        reconciliationJournalId: entry.reconciliationJournalId ?? null,
      });

      const latestAudit = nextState.auditLogs[0];
      if (latestAudit) {
        await tx.insert(auditLogs).values({
          id: latestAudit.id,
          timestamp: latestAudit.timestamp,
          actor: latestAudit.user,
          role: latestAudit.role,
          action: latestAudit.action,
          entityType: latestAudit.entityType,
          entityId: latestAudit.entityId,
          details: latestAudit.details,
          actorUid: actorUid ?? null,
        });
      }
    });
  } catch (error) {
    console.error('Failed to persist stocktake entry:', error);
    throw new Error('Failed to save stocktake count record.', { cause: error });
  }
}

export async function persistStocktakeReconciliationInDb(
  nextState: ErpState,
  stocktakeId: string,
  actorUid?: string
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const updatedEntry = (nextState.stocktakeEntries ?? []).find((s) => s.id === stocktakeId);
      if (!updatedEntry) return;

      await tx
        .update(stocktakeEntries)
        .set({
          bookQty: updatedEntry.bookQty,
          varianceQty: updatedEntry.varianceQty,
          variancePct: updatedEntry.variancePct,
          unitCost: updatedEntry.unitCost,
          varianceValue: updatedEntry.varianceValue,
          status: updatedEntry.status,
          reconciledAt: updatedEntry.reconciledAt ?? null,
          reconciliationJournalId: updatedEntry.reconciliationJournalId ?? null,
        })
        .where(eq(stocktakeEntries.id, stocktakeId));

      const updatedIng = nextState.ingredients.find((i) => i.id === updatedEntry.ingredientId);
      if (updatedIng) {
        await tx
          .update(ingredients)
          .set({
            currentQty: updatedIng.currentQty,
            wasteQty: updatedIng.wasteQty,
            purchasedQty: updatedIng.purchasedQty,
          })
          .where(eq(ingredients.id, updatedIng.id));
      }

      if (updatedEntry.reconciliationJournalId) {
        const journal = nextState.journalEntries.find((j) => j.id === updatedEntry.reconciliationJournalId);
        if (journal) {
          await tx.insert(journalEntries).values({
            id: journal.id,
            journalNo: journal.journalNo,
            date: journal.date,
            period: journal.period,
            source: journal.source,
            referenceNo: journal.referenceNo,
            description: journal.description,
            createdBy: journal.createdBy,
            isReversed: false,
            reversalOfId: null,
            reversedByJournalId: null,
            lines: journal.lines,
            createdByUid: actorUid ?? null,
          });
        }
      }

      const latestAudit = nextState.auditLogs[0];
      if (latestAudit) {
        await tx.insert(auditLogs).values({
          id: latestAudit.id,
          timestamp: latestAudit.timestamp,
          actor: latestAudit.user,
          role: latestAudit.role,
          action: latestAudit.action,
          entityType: latestAudit.entityType,
          entityId: latestAudit.entityId,
          details: latestAudit.details,
          actorUid: actorUid ?? null,
        });
      }
    });
  } catch (error) {
    console.error('Failed to persist stocktake reconciliation:', error);
    throw new Error('Failed to save stocktake reconciliation.', { cause: error });
  }
}

export async function persistIngredientInDb(ing: Ingredient): Promise<ErpState> {
  try {
    const row = {
      id: ing.id,
      sku: ing.sku,
      nameAr: ing.nameAr,
      nameEn: ing.nameEn,
      category: ing.category,
      unit: ing.unit,
      openingQty: ing.openingQty,
      purchasedQty: ing.purchasedQty,
      issuedQty: ing.issuedQty,
      wasteQty: ing.wasteQty,
      currentQty: ing.currentQty,
      weightedAvgCost: ing.weightedAvgCost,
      reorderLevel: ing.reorderLevel,
      lastPurchasePrice: ing.lastPurchasePrice,
      preferredSupplierId: ing.preferredSupplierId,
    };
    await db.insert(ingredients).values(row).onConflictDoUpdate({ target: ingredients.id, set: row });
    return await loadErpStateFromDb();
  } catch (error) {
    console.error('Failed to save ingredient:', error);
    throw new Error('Failed to save ingredient to PostgreSQL.', { cause: error });
  }
}

export async function persistSupplierPaymentInDb(nextState: ErpState, actorUid?: string): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(erpMetadata)
        .set({ suppliers: nextState.suppliers, updatedAt: new Date() })
        .where(eq(erpMetadata.id, METADATA_ROW_ID));

      const journal = nextState.journalEntries[0];
      if (journal) {
        await tx.insert(journalEntries).values({
          id: journal.id,
          journalNo: journal.journalNo,
          date: journal.date,
          period: journal.period,
          source: journal.source,
          referenceNo: journal.referenceNo,
          description: journal.description,
          createdBy: journal.createdBy,
          isReversed: false,
          reversalOfId: null,
          reversedByJournalId: null,
          lines: journal.lines,
          createdByUid: actorUid ?? null,
        });

        const linkedBank = nextState.bankTransactions.find((b) => b.matchedJournalId === journal.id);
        if (linkedBank) {
          await tx
            .insert(bankTransactions)
            .values({
              id: linkedBank.id,
              date: linkedBank.date,
              bankRef: linkedBank.bankRef,
              description: linkedBank.description,
              debit: linkedBank.debit,
              credit: linkedBank.credit,
              runningBalance: linkedBank.runningBalance ?? 0,
              accountCode: linkedBank.accountCode,
              matchStatus: linkedBank.matchStatus,
              matchedJournalId: linkedBank.matchedJournalId ?? null,
            })
            .onConflictDoNothing();
        }
      }

      const latestAudit = nextState.auditLogs[0];
      if (latestAudit) {
        await tx.insert(auditLogs).values({
          id: latestAudit.id,
          timestamp: latestAudit.timestamp,
          actor: latestAudit.user,
          role: latestAudit.role,
          action: latestAudit.action,
          entityType: latestAudit.entityType,
          entityId: latestAudit.entityId,
          details: latestAudit.details,
          actorUid: actorUid ?? null,
        });
      }
    });
  } catch (error) {
    console.error('Failed to persist supplier payment:', error);
    throw new Error('Failed to save supplier payment settlement.', { cause: error });
  }
}

export async function persistRepresentativeInDb(rep: Representative, actorUid?: string): Promise<ErpState> {
  try {
    const row = {
      id: rep.id,
      code: rep.code,
      nameAr: rep.nameAr,
      nameEn: rep.nameEn,
      roleType: rep.roleType,
      phone: rep.phone,
      branchId: rep.branchId,
      assignedArea: rep.assignedArea,
      commissionPct: rep.commissionPct,
      monthlyTarget: rep.monthlyTarget,
      achievedSales: rep.achievedSales,
      collectedAmount: rep.collectedAmount,
      custodyBalance: rep.custodyBalance,
      status: rep.status,
      notes: rep.notes ?? null,
    };
    await db.transaction(async (tx) => {
      await tx.insert(representatives).values(row).onConflictDoUpdate({ target: representatives.id, set: row });
      await tx.insert(auditLogs).values({
        id: `AUD-REP-${Date.now()}`,
        timestamp: new Date().toISOString().slice(0, 16).replace('T', ' '),
        actor: 'الإدارة المالية',
        role: 'manager',
        action: 'تحديث بيانات مندوب',
        entityType: 'Representative',
        entityId: rep.code,
        details: `${rep.nameAr} (${rep.roleType}) — عهدة ${rep.custodyBalance.toFixed(2)} ج.م`,
        actorUid: actorUid ?? null,
      });
    });
    return await loadErpStateFromDb();
  } catch (error) {
    console.error('Failed to save representative:', error);
    throw new Error('Failed to save representative record.', { cause: error });
  }
}

export async function persistHouseholdEntryInDb(entry: HouseholdEntry, actorUid?: string): Promise<ErpState> {
  try {
    const row = {
      id: entry.id,
      entryNo: entry.entryNo,
      date: entry.date,
      type: entry.type,
      categoryAr: entry.categoryAr,
      categoryEn: entry.categoryEn,
      description: entry.description,
      amount: entry.amount,
      paymentMethod: entry.paymentMethod,
      memberName: entry.memberName,
      notes: entry.notes ?? null,
    };
    await db.transaction(async (tx) => {
      await tx.insert(householdEntries).values(row).onConflictDoUpdate({ target: householdEntries.id, set: row });
      await tx.insert(auditLogs).values({
        id: `AUD-HSH-${Date.now()}`,
        timestamp: new Date().toISOString().slice(0, 16).replace('T', ' '),
        actor: entry.memberName || 'الحساب المنفصل للبيت',
        role: 'cfo',
        action: 'قيد بحساب البيت المنفصل',
        entityType: 'Household',
        entityId: entry.entryNo,
        details: `${entry.type === 'income' ? 'دخل منزلي' : 'مصروف منزلي'}: ${entry.description} (${entry.amount.toFixed(2)} ج.م) — معزول عن الشركة`,
        actorUid: actorUid ?? null,
      });
    });
    return await loadErpStateFromDb();
  } catch (error) {
    console.error('Failed to persist household entry:', error);
    throw new Error('Failed to save household ledger entry.', { cause: error });
  }
}

export async function deleteHouseholdEntryInDb(id: string, actorUid?: string): Promise<ErpState> {
  try {
    await db.transaction(async (tx) => {
      await tx.delete(householdEntries).where(eq(householdEntries.id, id));
      await tx.insert(auditLogs).values({
        id: `AUD-HSH-DEL-${Date.now()}`,
        timestamp: new Date().toISOString().slice(0, 16).replace('T', ' '),
        actor: 'الحساب المنفصل للبيت',
        role: 'cfo',
        action: 'حذف بند من حساب البيت المنفصل',
        entityType: 'Household',
        entityId: id,
        details: `حذف البند ${id} من حساب البيت المنفصل`,
        actorUid: actorUid ?? null,
      });
    });
    return await loadErpStateFromDb();
  } catch (error) {
    console.error('Failed to delete household entry:', error);
    throw new Error('Failed to delete household entry.', { cause: error });
  }
}

export async function persistBankStatementImportInDb(
  txns: Array<Partial<BankTransaction> & { date: string; description: string; debit: number; credit: number }>,
  actorUid?: string
): Promise<{ state: ErpState; insertedCount: number; skippedCount: number }> {
  try {
    let insertedCount = 0;
    let skippedCount = 0;

    await db.transaction(async (tx) => {
      const existing = await tx.select().from(bankTransactions);
      const existingRefs = new Set(existing.map((b) => b.bankRef.trim().toUpperCase()));
      const existingSig = new Set(
        existing.map((b) => `${b.date}|${round2(b.debit)}|${round2(b.credit)}|${b.description.trim()}`)
      );

      for (let idx = 0; idx < txns.length; idx++) {
        const raw = txns[idx];
        const debit = round2(Math.max(0, Number(raw.debit) || 0));
        const credit = round2(Math.max(0, Number(raw.credit) || 0));
        if (debit === 0 && credit === 0) continue;
        const date = /^\d{4}-\d{2}-\d{2}$/.test(String(raw.date || '').trim())
          ? String(raw.date).trim()
          : new Date().toISOString().slice(0, 10);
        const description = String(raw.description || 'حركة كشف حساب بنك CIB').trim();
        const bankRef = String(raw.bankRef || `CIB-IMP-${Date.now()}-${idx + 1}`).trim();
        const sig = `${date}|${debit}|${credit}|${description}`;

        if (existingRefs.has(bankRef.toUpperCase()) || existingSig.has(sig)) {
          skippedCount++;
          continue;
        }

        existingRefs.add(bankRef.toUpperCase());
        existingSig.add(sig);

        await tx
          .insert(bankTransactions)
          .values({
            id: raw.id || `BNK-IMP-${Date.now()}-${idx + 1}`,
            date,
            bankRef,
            description,
            debit,
            credit,
            runningBalance: 0,
            accountCode: raw.accountCode || '1102',
            matchStatus: raw.matchStatus === 'matched' ? 'matched' : 'unmatched',
            matchedJournalId: raw.matchedJournalId ?? null,
          })
          .onConflictDoNothing();
        insertedCount++;
      }

      if (insertedCount > 0) {
        await tx.insert(auditLogs).values({
          id: `AUD-BNK-IMP-${Date.now()}`,
          timestamp: new Date().toISOString().slice(0, 16).replace('T', ' '),
          actor: 'المحاسب العام',
          role: 'accountant',
          action: 'استيراد كشف حساب بنك CIB',
          entityType: 'BankStatement',
          entityId: `IMP-${Date.now()}`,
          details: `إدراج ${insertedCount} حركة جديدة وتخطي ${skippedCount} مكررة`,
          actorUid: actorUid ?? null,
        });
      }
    });

    const state = await loadErpStateFromDb();
    return { state, insertedCount, skippedCount };
  } catch (error) {
    console.error('Failed to import bank statement rows:', error);
    throw new Error('Failed to import bank statement transactions.', { cause: error });
  }
}

export type ModuleImportKey =
  | 'ingredients'
  | 'suppliers'
  | 'representatives'
  | 'customers'
  | 'bank'
  | 'household';

export async function importModuleRowsInDb(
  moduleKey: ModuleImportKey,
  rows: Record<string, unknown>[],
  mode: 'merge' | 'replace' = 'merge',
  actorUid?: string
): Promise<{ state: ErpState; importedCount: number }> {
  try {
    let importedCount = 0;

    if (moduleKey === 'bank') {
      const mapped = rows.map((r, idx) => ({
        id: String(r.id ?? '').trim() || undefined,
        bankRef: String(r.bankRef ?? r.bank_ref ?? r['المرجع'] ?? r['المرجع البنكي'] ?? `CIB-MOD-${Date.now()}-${idx + 1}`),
        date: String(r.date ?? r['التاريخ'] ?? new Date().toISOString().slice(0, 10)).slice(0, 10),
        description: String(r.description ?? r['البيان'] ?? r['الوصف'] ?? 'حركة مستوردة'),
        debit: Number(r.debit ?? r['مدين'] ?? r['صادر'] ?? 0) || 0,
        credit: Number(r.credit ?? r['دائن'] ?? r['وارد'] ?? 0) || 0,
        accountCode: '1102',
        matchStatus: (String(r.matchStatus ?? r['الحالة'] ?? 'unmatched') === 'matched' ? 'matched' : 'unmatched') as 'matched' | 'unmatched',
      }));
      if (mode === 'replace') {
        await db.delete(bankTransactions);
      }
      const res = await persistBankStatementImportInDb(mapped, actorUid);
      return { state: res.state, importedCount: res.insertedCount };
    }

    await db.transaction(async (tx) => {
      if (moduleKey === 'ingredients') {
        for (let idx = 0; idx < rows.length; idx++) {
          const r = rows[idx];
          const id = String(r.id ?? r['الكود الداخلي'] ?? `ING-${Date.now()}-${idx + 1}`).trim();
          const sku = String(r.sku ?? r['الكود SKU'] ?? r['كود الصنف'] ?? id).trim();
          const nameAr = String(r.nameAr ?? r['اسم الصنف'] ?? r['الصنف الخام'] ?? '').trim();
          if (!nameAr) continue;
          const openingQty = Number(r.openingQty ?? r['الافتتاحي'] ?? 0) || 0;
          const purchasedQty = Number(r.purchasedQty ?? r['المشتريات'] ?? 0) || 0;
          const issuedQty = Number(r.issuedQty ?? r['المنصرف BOM'] ?? r['المنصرف'] ?? 0) || 0;
          const wasteQty = Number(r.wasteQty ?? r['الهالك'] ?? 0) || 0;
          const currentQtyRaw = r.currentQty ?? r['الرصيد الحالي'];
          const currentQty =
            currentQtyRaw !== undefined && currentQtyRaw !== ''
              ? Number(currentQtyRaw) || 0
              : round2(openingQty + purchasedQty - issuedQty - wasteQty);
          const wac = Number(r.weightedAvgCost ?? r['المتوسط المرجح WAC'] ?? r['التكلفة'] ?? 0) || 0;
          const lastPrice = Number(r.lastPurchasePrice ?? r['آخر سعر شراء'] ?? wac) || wac;
          const row = {
            id,
            sku,
            nameAr,
            nameEn: String(r.nameEn ?? r['Name EN'] ?? nameAr).trim(),
            category: String(r.category ?? r['التصنيف'] ?? 'عام').trim(),
            unit: String(r.unit ?? r['الوحدة'] ?? 'كجم').trim(),
            openingQty,
            purchasedQty,
            issuedQty,
            wasteQty,
            currentQty,
            weightedAvgCost: wac,
            reorderLevel: Number(r.reorderLevel ?? r['حد إعادة الطلب'] ?? 10) || 10,
            lastPurchasePrice: lastPrice,
            preferredSupplierId: String(r.preferredSupplierId ?? r['المورد المفضل'] ?? 'SUP-01').trim(),
          };
          await tx.insert(ingredients).values(row).onConflictDoUpdate({ target: ingredients.id, set: row });
          importedCount++;
        }
      } else if (moduleKey === 'suppliers') {
        const metaRows = await tx.select().from(erpMetadata).where(eq(erpMetadata.id, METADATA_ROW_ID));
        const existing = mode === 'replace' ? [] : [...(metaRows[0]?.suppliers ?? [])];
        const supMap = new Map<string, Supplier>(existing.map((s) => [s.id, s]));
        for (let idx = 0; idx < rows.length; idx++) {
          const r = rows[idx];
          const nameAr = String(r.nameAr ?? r['المورد'] ?? r['اسم المورد'] ?? '').trim();
          if (!nameAr) continue;
          const id = String(r.id ?? r['الكود'] ?? `SUP-IMP-${Date.now()}-${idx + 1}`).trim();
          supMap.set(id, {
            id,
            nameAr,
            nameEn: String(r.nameEn ?? r['Supplier EN'] ?? nameAr).trim(),
            taxNumber: String(r.taxNumber ?? r['الرقم الضريبي'] ?? '000-000-000').trim(),
            phone: String(r.phone ?? r['الهاتف'] ?? '').trim(),
            paymentTermsDays: Number(r.paymentTermsDays ?? r['شروط السداد'] ?? 15) || 15,
            aging0_30: Number(r.aging0_30 ?? r['0-30 يوم'] ?? r['الرصيد الحالي'] ?? 0) || 0,
            aging31_60: Number(r.aging31_60 ?? r['31-60 يوم'] ?? 0) || 0,
            aging61_90Plus: Number(r.aging61_90Plus ?? r['61-90+ يوم'] ?? 0) || 0,
            rating: Number(r.rating ?? r['التقييم'] ?? 4.5) || 4.5,
            categoryAr: String(r.categoryAr ?? r['النشاط'] ?? 'توريدات عامة').trim(),
            categoryEn: String(r.categoryEn ?? 'General Supply').trim(),
            city: String(r.city ?? r['المدينة'] ?? 'شبين الكوم').trim(),
            contactName: String(r.contactName ?? r['المسؤول'] ?? '').trim(),
          });
          importedCount++;
        }
        await tx
          .update(erpMetadata)
          .set({ suppliers: Array.from(supMap.values()), updatedAt: new Date() })
          .where(eq(erpMetadata.id, METADATA_ROW_ID));
      } else if (moduleKey === 'customers') {
        const metaRows = await tx.select().from(erpMetadata).where(eq(erpMetadata.id, METADATA_ROW_ID));
        const existing = mode === 'replace' ? [] : [...(metaRows[0]?.customers ?? [])];
        const cusMap = new Map<string, Customer>(existing.map((c) => [c.id, c]));
        for (let idx = 0; idx < rows.length; idx++) {
          const r = rows[idx];
          const nameAr = String(r.nameAr ?? r['العميل'] ?? r['اسم العميل'] ?? '').trim();
          if (!nameAr) continue;
          const id = String(r.id ?? `CUS-IMP-${Date.now()}-${idx + 1}`).trim();
          cusMap.set(id, {
            id,
            code: String(r.code ?? r['الكود'] ?? id).trim(),
            nameAr,
            nameEn: String(r.nameEn ?? nameAr).trim(),
            segment: (String(r.segment ?? r['الشريحة'] ?? 'family') as Customer['segment']) || 'family',
            phone: String(r.phone ?? r['الهاتف'] ?? '').trim(),
            city: String(r.city ?? r['المدينة'] ?? 'شبين الكوم').trim(),
            taxNumber: r.taxNumber ? String(r.taxNumber) : undefined,
            creditLimit: Number(r.creditLimit ?? r['الحد الائتماني'] ?? 5000) || 5000,
            currentBalance: Number(r.currentBalance ?? r['الرصيد الحالي'] ?? 0) || 0,
            totalOrders: Number(r.totalOrders ?? r['إجمالي الطلبات'] ?? 0) || 0,
            totalSpent: Number(r.totalSpent ?? r['إجمالي المشتريات'] ?? 0) || 0,
            loyaltyPoints: Number(r.loyaltyPoints ?? r['نقاط الولاء'] ?? 0) || 0,
            lastOrderDate: String(r.lastOrderDate ?? new Date().toISOString().slice(0, 10)).slice(0, 10),
          });
          importedCount++;
        }
        await tx
          .update(erpMetadata)
          .set({ customers: Array.from(cusMap.values()), updatedAt: new Date() })
          .where(eq(erpMetadata.id, METADATA_ROW_ID));
      } else if (moduleKey === 'representatives') {
        if (mode === 'replace') {
          await tx.delete(representatives);
        }
        for (let idx = 0; idx < rows.length; idx++) {
          const r = rows[idx];
          const nameAr = String(r.nameAr ?? r['اسم المندوب'] ?? r['المندوب'] ?? '').trim();
          if (!nameAr) continue;
          const id = String(r.id ?? `REP-IMP-${Date.now()}-${idx + 1}`).trim();
          const row = {
            id,
            code: String(r.code ?? r['الكود'] ?? `REP-${String(idx + 1).padStart(2, '0')}`).trim(),
            nameAr,
            nameEn: String(r.nameEn ?? nameAr).trim(),
            roleType: String(r.roleType ?? r['الدور'] ?? 'sales').trim(),
            phone: String(r.phone ?? r['الهاتف'] ?? '').trim(),
            branchId: String(r.branchId ?? 'BR-BORG').trim(),
            assignedArea: String(r.assignedArea ?? r['المنطقة'] ?? 'المنوفية').trim(),
            commissionPct: Number(r.commissionPct ?? r['العمولة %'] ?? 0) || 0,
            monthlyTarget: Number(r.monthlyTarget ?? r['المستهدف الشهري'] ?? 0) || 0,
            achievedSales: Number(r.achievedSales ?? r['المحقق'] ?? 0) || 0,
            collectedAmount: Number(r.collectedAmount ?? r['المحصل'] ?? 0) || 0,
            custodyBalance: Number(r.custodyBalance ?? r['رصيد العهدة'] ?? 0) || 0,
            status: String(r.status ?? r['الحالة'] ?? 'active').trim(),
            notes: r.notes ? String(r.notes) : null,
          };
          await tx.insert(representatives).values(row).onConflictDoUpdate({ target: representatives.id, set: row });
          importedCount++;
        }
      } else if (moduleKey === 'household') {
        if (mode === 'replace') {
          await tx.delete(householdEntries);
        }
        for (let idx = 0; idx < rows.length; idx++) {
          const r = rows[idx];
          const description = String(r.description ?? r['البيان'] ?? r['الوصف'] ?? '').trim();
          const amount = Number(r.amount ?? r['المبلغ'] ?? 0) || 0;
          if (!description || amount <= 0) continue;
          const id = String(r.id ?? `HSH-IMP-${Date.now()}-${idx + 1}`).trim();
          const entryNo = String(r.entryNo ?? r['رقم البند'] ?? `HOME-${Date.now().toString().slice(-4)}-${idx + 1}`).trim();
          const typeRaw = String(r.type ?? r['النوع'] ?? 'expense').toLowerCase();
          const type = typeRaw.includes('income') || typeRaw.includes('دخل') || typeRaw.includes('إيراد') ? 'income' : 'expense';
          const row = {
            id,
            entryNo,
            date: String(r.date ?? r['التاريخ'] ?? new Date().toISOString().slice(0, 10)).slice(0, 10),
            type,
            categoryAr: String(r.categoryAr ?? r['التصنيف'] ?? 'مصروفات منزلية').trim(),
            categoryEn: String(r.categoryEn ?? 'Home Expenses').trim(),
            description,
            amount: round2(amount),
            paymentMethod: String(r.paymentMethod ?? r['طريقة الدفع'] ?? 'cash').trim(),
            memberName: String(r.memberName ?? r['الفرد'] ?? 'حساب الأسرة').trim(),
            notes: r.notes ? String(r.notes) : null,
          };
          await tx.insert(householdEntries).values(row).onConflictDoUpdate({ target: householdEntries.id, set: row });
          importedCount++;
        }
      }

      if (importedCount > 0) {
        await tx.insert(auditLogs).values({
          id: `AUD-MOD-${Date.now()}`,
          timestamp: new Date().toISOString().slice(0, 16).replace('T', ' '),
          actor: 'المستخدم المصادق',
          role: 'cfo',
          action: `استيراد ملف مستقل (${moduleKey})`,
          entityType: moduleKey === 'household' ? 'Household' : 'ModuleImport',
          entityId: `${moduleKey}-${mode}`,
          details: `تم استيراد ${importedCount} سجل إلى قسم ${moduleKey} (${mode})`,
          actorUid: actorUid ?? null,
        });
      }
    });

    const state = await loadErpStateFromDb();
    return { state, importedCount };
  } catch (error) {
    console.error('Failed to import module rows:', error);
    throw new Error(`Failed to import module "${moduleKey}" records.`, { cause: error });
  }
}

export async function persistStrategyRisksInDb(
  nextRisks: StrategyRisk[],
  actionLabel: string,
  entityId: string,
  details: string,
  actor?: string,
  actorUid?: string
): Promise<ErpState> {
  try {
    await db.transaction(async (tx) => {
      const metaRows = await tx.select().from(erpMetadata).where(eq(erpMetadata.id, METADATA_ROW_ID));
      const seedDefaults = createSeedErpState();
      const baseStrategy = metaRows[0]?.strategy2027 ?? seedDefaults.strategy2027;
      const updatedStrategy = {
        ...baseStrategy,
        risks: nextRisks,
      };
      await tx
        .update(erpMetadata)
        .set({ strategy2027: updatedStrategy, updatedAt: new Date() })
        .where(eq(erpMetadata.id, METADATA_ROW_ID));

      await tx.insert(auditLogs).values({
        id: `AUD-RSK-${Date.now()}`,
        timestamp: new Date().toISOString().slice(0, 16).replace('T', ' '),
        actor: actor || 'المدير المالي CFO',
        role: 'cfo',
        action: actionLabel,
        entityType: 'RiskRegister',
        entityId,
        details,
        actorUid: actorUid ?? null,
      });
    });

    return await loadErpStateFromDb();
  } catch (error) {
    console.error('Failed to persist CFO risk register update:', error);
    throw new Error('Failed to save risk register changes to PostgreSQL.', { cause: error });
  }
}

export async function resetErpDatabaseInDb(): Promise<ErpState> {
  try {
    await db.transaction(async (tx) => {
      await tx.delete(salesInvoiceItems);
      await tx.delete(salesInvoices);
      await tx.delete(purchaseInvoices);
      await tx.delete(expenses);
      await tx.delete(wasteEntries);
      await tx.delete(stocktakeEntries);
      await tx.delete(journalEntries);
      await tx.delete(bankTransactions);
      await tx.delete(kdsOrders);
      await tx.delete(auditLogs);
      await tx.delete(representatives);
      await tx.delete(householdEntries);
      await tx.delete(diningTables);
      await tx.delete(menuItems);
      await tx.delete(ingredients);
      await tx.delete(erpMetadata);
      await seedDatabaseIfEmptyTx(tx);
    });
    return await loadErpStateFromDb();
  } catch (error) {
    console.error('Failed to reset ERP database:', error);
    throw new Error('Failed to reset ERP database.', { cause: error });
  }
}
