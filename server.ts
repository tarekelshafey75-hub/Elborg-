import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  loadErpStateFromDb,
  persistActiveBranchInDb,
  persistBankReconInDb,
  persistCustomerInDb,
  persistExpenseInDb,
  persistJournalReversalInDb,
  persistKdsStatusInDb,
  persistMenuUpdateInDb,
  persistPartnersDemoSeedInDb,
  persistPurchaseInDb,
  persistReleaseTableInDb,
  persistSaleInDb,
  persistStocktakeEntryInDb,
  persistStocktakeReconciliationInDb,
  persistStrategyRisksInDb,
  persistSupplierInDb,
  persistWasteInDb,
  resetErpDatabaseInDb,
} from './src/db/erpRepository.ts';
import { migrateErpStateToPostgres } from './src/db/migrateErpState.ts';
import { requireAuth, type AuthRequest } from './src/middleware/auth.ts';
import {
  buildFullDatabaseDownloadPayload,
  exportAllPostgresTablesBundle,
  type FullDatabaseExportFormat,
  generateSnapshotBufferForDownload,
  getOrCreateBackupConfig,
  listBackupSnapshots,
  runDatabaseSnapshotBackup,
  startDailyBackupScheduler,
  updateBackupConfig,
} from './src/services/backupService.ts';
import type {
  Customer,
  ErpState,
  JournalEntry,
  KdsStatus,
  RiskAuditEntry,
  RiskCategory,
  RiskFocusArea,
  RiskImpact,
  RiskStatus,
  StrategyRisk,
  Supplier,
} from './src/types/erp.ts';
import {
  applyExpenseAutomation,
  applyJournalReversal,
  applyPurchaseAutomation,
  applySaleAutomation,
  applyStocktakeEntryAutomation,
  applyStocktakeReconciliationAutomation,
  applyWasteAutomation,
  computeAccountBalances,
  computeTrialBalanceTotals,
  round2,
  runDataQualityChecks,
} from './src/utils/erpEngine.ts';
import type { SaleRequestPayload } from './src/utils/erpEngine.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolvePort(): number {
  const portFlagIdx = process.argv.findIndex((arg) => arg === '--port' || arg === '-p');
  if (portFlagIdx !== -1 && process.argv[portFlagIdx + 1]) {
    const parsed = Number(process.argv[portFlagIdx + 1]);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const eqFlag = process.argv.find((arg) => arg.startsWith('--port='));
  if (eqFlag) {
    const parsed = Number(eqFlag.split('=')[1]);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const envPort = Number(process.env.PORT);
  const nginxPort = Number(process.env.NGINX_PORT);
  if (
    process.env.NODE_ENV !== 'production' &&
    Number.isFinite(nginxPort) &&
    nginxPort > 0 &&
    envPort === nginxPort
  ) {
    return Number(process.env.DEFAULT_APP_PORT) || 3000;
  }
  return Number.isFinite(envPort) && envPort > 0 ? envPort : 3000;
}

const PORT = resolvePort();

const sseClients = new Set<express.Response>();

function broadcastStateUpdate(eventType: string, payload?: unknown) {
  const message = `event: ${eventType}\ndata: ${JSON.stringify(payload ?? { updatedAt: Date.now() })}\n\n`;
  for (const client of sseClients) {
    client.write(message);
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', port: PORT });
  });

  let viteInitError: unknown = null;
  const vitePromise =
    process.env.NODE_ENV !== 'production'
      ? (async () => {
          try {
            const { createServer: createViteServer } = await import('vite');
            const disableHmr = process.env.DISABLE_HMR === 'true';
            return await createViteServer({
              server: {
                middlewareMode: true,
                allowedHosts: true,
                ...(disableHmr ? { hmr: false, ws: false, watch: null } : {}),
              },
              appType: 'spa',
            });
          } catch (err) {
            viteInitError = err;
            console.error('Vite dev server initialization error:', err);
            return null;
          }
        })()
      : null;

  // SSE endpoint for real-time POS -> KDS & Dashboard updates across devices
  app.get('/api/erp/events', requireAuth, (req: AuthRequest, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    res.write(`event: connected\ndata: ${JSON.stringify({ status: 'connected' })}\n\n`);
    sseClients.add(res);
    req.on('close', () => {
      sseClients.delete(res);
    });
  });

  // Get full ERP state + computed balances from PostgreSQL
  app.get('/api/erp/state', requireAuth, async (_req: AuthRequest, res) => {
    try {
      const erpState = await loadErpStateFromDb();
      res.json({
        state: erpState,
        balances: computeAccountBalances(erpState),
        trialBalance: computeTrialBalanceTotals(erpState),
        dataQuality: runDataQualityChecks(erpState),
      });
    } catch (error: any) {
      console.error('Error loading ERP state:', error);
      res.status(500).json({ error: error?.message || 'Failed to load ERP data' });
    }
  });

  // Switch active branch
  app.post('/api/erp/branch', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { branchId } = req.body as { branchId: string };
      let erpState = await loadErpStateFromDb();
      if (erpState.branches.some((b) => b.id === branchId)) {
        await persistActiveBranchInDb(branchId);
        erpState = { ...erpState, activeBranchId: branchId };
        broadcastStateUpdate('state_updated', { branchId });
      }
      res.json({ state: erpState });
    } catch (error: any) {
      console.error('Error switching branch:', error);
      res.status(500).json({ error: error?.message || 'Failed to update branch' });
    }
  });

  // Create POS Sale -> Auto KDS + BOM Stock Deduction + Double-Entry Journal (Persisted in PostgreSQL)
  app.post('/api/erp/sales', requireAuth, async (req: AuthRequest, res) => {
    try {
      const payload = req.body as SaleRequestPayload;
      if (!payload?.items?.length) {
        res.status(400).json({ error: 'Sale must contain at least one item' });
        return;
      }
      const currentState = await loadErpStateFromDb();
      const { nextState, invoice, journal, kdsOrder } = applySaleAutomation(currentState, payload);
      await persistSaleInDb(nextState, invoice, journal, kdsOrder, req.user?.uid);
      broadcastStateUpdate('sale_created', { invoiceNo: invoice.invoiceNo, kdsOrderId: kdsOrder.id });
      res.status(201).json({ state: nextState, invoice, journal, kdsOrder });
    } catch (error: any) {
      console.error('Error creating sale:', error);
      res.status(500).json({ error: error?.message || 'Failed to record sale' });
    }
  });

  // Batch Offline Sync endpoint
  app.post('/api/erp/sync', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { queuedSales } = req.body as { queuedSales: SaleRequestPayload[] };
      let currentState = await loadErpStateFromDb();
      if (!Array.isArray(queuedSales) || queuedSales.length === 0) {
        res.json({ syncedCount: 0, state: currentState });
        return;
      }
      let syncedCount = 0;
      for (const sale of queuedSales) {
        const { nextState, invoice, journal, kdsOrder } = applySaleAutomation(currentState, {
          ...sale,
          offlineQueued: false,
        });
        await persistSaleInDb(nextState, invoice, journal, kdsOrder, req.user?.uid);
        currentState = nextState;
        syncedCount++;
      }
      broadcastStateUpdate('sync_completed', { syncedCount });
      res.json({ syncedCount, state: currentState });
    } catch (error: any) {
      console.error('Error syncing offline sales:', error);
      res.status(500).json({ error: error?.message || 'Failed to sync offline sales' });
    }
  });

  // Update KDS Order status
  app.patch('/api/erp/kds/:id/status', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body as { status: KdsStatus };
      await persistKdsStatusInDb(id, status);
      const erpState = await loadErpStateFromDb();
      broadcastStateUpdate('kds_updated', { id, status });
      res.json({ state: erpState });
    } catch (error: any) {
      console.error('Error updating KDS status:', error);
      res.status(500).json({ error: error?.message || 'Failed to update kitchen order status' });
    }
  });

  // Release Dining Table
  app.post('/api/erp/tables/:id/release', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      await persistReleaseTableInDb(id);
      const erpState = await loadErpStateFromDb();
      broadcastStateUpdate('table_updated', { id });
      res.json({ state: erpState });
    } catch (error: any) {
      console.error('Error releasing table:', error);
      res.status(500).json({ error: error?.message || 'Failed to release dining table' });
    }
  });

  // Create Purchase Invoice -> Recalculate WAC + Update Stock + Journal Entry
  app.post('/api/erp/purchases', requireAuth, async (req: AuthRequest, res) => {
    try {
      const payload = req.body;
      if (!payload?.lines?.length) {
        res.status(400).json({ error: 'Purchase invoice requires lines' });
        return;
      }
      const currentState = await loadErpStateFromDb();
      const { nextState, purchase } = applyPurchaseAutomation(currentState, payload);
      await persistPurchaseInDb(nextState, purchase, req.user?.uid);
      broadcastStateUpdate('purchase_created', { purchaseNo: purchase.purchaseNo });
      res.status(201).json({ state: nextState, purchase });
    } catch (error: any) {
      console.error('Error creating purchase:', error);
      res.status(500).json({ error: error?.message || 'Failed to record purchase invoice' });
    }
  });

  // Seed or Refresh Demo Suppliers & Customers in PostgreSQL
  app.post('/api/erp/partners/seed-demo', requireAuth, async (_req: AuthRequest, res) => {
    try {
      const nextState = await persistPartnersDemoSeedInDb();
      broadcastStateUpdate('partners_updated');
      res.json({ state: nextState });
    } catch (error: any) {
      console.error('Error seeding demo partners:', error);
      res.status(500).json({ error: error?.message || 'Failed to load demo suppliers and customers' });
    }
  });

  // Add Supplier
  app.post('/api/erp/partners/suppliers', requireAuth, async (req: AuthRequest, res) => {
    try {
      const body = req.body as Partial<Supplier>;
      if (!body?.nameAr?.trim()) {
        res.status(400).json({ error: 'Supplier Arabic name is required' });
        return;
      }
      const supplier: Supplier = {
        id: body.id || `SUP-${Date.now()}`,
        nameAr: body.nameAr.trim(),
        nameEn: body.nameEn?.trim() || body.nameAr.trim(),
        taxNumber: body.taxNumber?.trim() || '000-000-000',
        phone: body.phone?.trim() || '',
        paymentTermsDays: Number(body.paymentTermsDays) || 15,
        aging0_30: Number(body.aging0_30) || 0,
        aging31_60: Number(body.aging31_60) || 0,
        aging61_90Plus: Number(body.aging61_90Plus) || 0,
        rating: Number(body.rating) || 4.5,
        categoryAr: body.categoryAr?.trim() || 'توريدات عامة',
        categoryEn: body.categoryEn?.trim() || 'General Supply',
        city: body.city?.trim() || 'شبين الكوم',
        contactName: body.contactName?.trim() || '',
      };
      const nextState = await persistSupplierInDb(supplier);
      broadcastStateUpdate('partners_updated', { supplierId: supplier.id });
      res.status(201).json({ state: nextState, supplier });
    } catch (error: any) {
      console.error('Error adding supplier:', error);
      res.status(500).json({ error: error?.message || 'Failed to save supplier' });
    }
  });

  // Add Customer
  app.post('/api/erp/partners/customers', requireAuth, async (req: AuthRequest, res) => {
    try {
      const body = req.body as Partial<Customer>;
      if (!body?.nameAr?.trim()) {
        res.status(400).json({ error: 'Customer Arabic name is required' });
        return;
      }
      const customer: Customer = {
        id: body.id || `CUS-${Date.now()}`,
        code: body.code?.trim() || `CUS-${Math.floor(1000 + Math.random() * 9000)}`,
        nameAr: body.nameAr.trim(),
        nameEn: body.nameEn?.trim() || body.nameAr.trim(),
        segment: body.segment || 'family',
        phone: body.phone?.trim() || '',
        city: body.city?.trim() || 'شبين الكوم',
        taxNumber: body.taxNumber?.trim() || undefined,
        creditLimit: Number(body.creditLimit) || 5000,
        currentBalance: Number(body.currentBalance) || 0,
        totalOrders: Number(body.totalOrders) || 0,
        totalSpent: Number(body.totalSpent) || 0,
        loyaltyPoints: Number(body.loyaltyPoints) || 0,
        lastOrderDate: body.lastOrderDate || new Date().toISOString().slice(0, 10),
      };
      const nextState = await persistCustomerInDb(customer);
      broadcastStateUpdate('partners_updated', { customerId: customer.id });
      res.status(201).json({ state: nextState, customer });
    } catch (error: any) {
      console.error('Error adding customer:', error);
      res.status(500).json({ error: error?.message || 'Failed to save customer' });
    }
  });

  // Record Operating Expense
  app.post('/api/erp/expenses', requireAuth, async (req: AuthRequest, res) => {
    try {
      const payload = req.body;
      if (!payload?.amountNet || payload.amountNet <= 0) {
        res.status(400).json({ error: 'Valid expense amount required' });
        return;
      }
      const currentState = await loadErpStateFromDb();
      const nextState = applyExpenseAutomation(currentState, payload);
      await persistExpenseInDb(nextState, req.user?.uid);
      broadcastStateUpdate('expense_created');
      res.status(201).json({ state: nextState });
    } catch (error: any) {
      console.error('Error recording expense:', error);
      res.status(500).json({ error: error?.message || 'Failed to record operating expense' });
    }
  });

  // Record Inventory Waste
  app.post('/api/erp/waste', requireAuth, async (req: AuthRequest, res) => {
    try {
      const payload = req.body;
      if (!payload?.ingredientId || !payload?.qty) {
        res.status(400).json({ error: 'Ingredient and quantity required' });
        return;
      }
      const currentState = await loadErpStateFromDb();
      const nextState = applyWasteAutomation(currentState, payload);
      await persistWasteInDb(nextState, req.user?.uid);
      broadcastStateUpdate('waste_created');
      res.status(201).json({ state: nextState });
    } catch (error: any) {
      console.error('Error recording waste:', error);
      res.status(500).json({ error: error?.message || 'Failed to record inventory waste' });
    }
  });

  // Record Physical Stocktake Count
  app.post('/api/erp/stocktake', requireAuth, async (req: AuthRequest, res) => {
    try {
      const payload = req.body as {
        ingredientId?: string;
        actualQty?: number;
        locationAr?: string;
        locationEn?: string;
        notes?: string;
      };
      if (!payload?.ingredientId || typeof payload.actualQty !== 'number' || payload.actualQty < 0) {
        res.status(400).json({ error: 'Valid ingredientId and non-negative actualQty are required' });
        return;
      }
      const currentState = await loadErpStateFromDb();
      const { nextState, entry } = applyStocktakeEntryAutomation(currentState, {
        ingredientId: payload.ingredientId,
        actualQty: payload.actualQty,
        locationAr: payload.locationAr,
        locationEn: payload.locationEn,
        countedBy: req.user?.email || 'مراقب التكاليف — جرد مباشر',
        notes: payload.notes,
      });
      await persistStocktakeEntryInDb(nextState, entry, req.user?.uid);
      broadcastStateUpdate('stocktake_updated', { stocktakeId: entry.id, countNo: entry.countNo });
      res.status(201).json({ state: nextState, entry });
    } catch (error: any) {
      console.error('Error recording stocktake:', error);
      res.status(500).json({ error: error?.message || 'Failed to record stocktake count' });
    }
  });

  // Reconcile Stocktake Variance -> Update Book Stock + Auto Journal Entry (5305 <-> 1201)
  app.post('/api/erp/stocktake/:id/reconcile', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const currentState = await loadErpStateFromDb();
      const actor = req.user?.email || 'المدير المالي / مراقب المخزون';
      const nextState = applyStocktakeReconciliationAutomation(currentState, id, actor);
      await persistStocktakeReconciliationInDb(nextState, id, req.user?.uid);
      broadcastStateUpdate('stocktake_updated', { stocktakeId: id, reconciled: true });
      res.json({ state: nextState });
    } catch (error: any) {
      console.error('Error reconciling stocktake variance:', error);
      res.status(500).json({ error: error?.message || 'Failed to reconcile stocktake variance' });
    }
  });

  // Update Menu Item Recipe or Selling Price
  app.patch('/api/erp/menu/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { sellingPriceGross, recipe } = req.body;
      await persistMenuUpdateInDb(id, sellingPriceGross, recipe);
      const erpState = await loadErpStateFromDb();
      broadcastStateUpdate('menu_updated', { id });
      res.json({ state: erpState });
    } catch (error: any) {
      console.error('Error updating menu item:', error);
      res.status(500).json({ error: error?.message || 'Failed to update menu item' });
    }
  });

  // Reverse Journal Entry (Immutable audit trail)
  app.post('/api/erp/journal/:id/reverse', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const currentState = await loadErpStateFromDb();
      const nextState = applyJournalReversal(currentState, id);
      await persistJournalReversalInDb(nextState, id, req.user?.uid);
      broadcastStateUpdate('journal_reversed', { id });
      res.json({ state: nextState });
    } catch (error: any) {
      console.error('Error reversing journal entry:', error);
      res.status(500).json({ error: error?.message || 'Failed to reverse journal entry' });
    }
  });

  // Reconcile pending Bank Transaction
  app.post('/api/erp/bank/:id/reconcile', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const currentState = await loadErpStateFromDb();
      const txn = currentState.bankTransactions.find((b) => b.id === id);
      if (!txn || txn.matchStatus === 'matched') {
        res.json({ state: currentState });
        return;
      }

      const amount = txn.debit > 0 ? txn.debit : txn.credit;
      const journalId = `JE-BNK-${Date.now()}`;
      const journalNo = `JV-2026-${String(currentState.journalEntries.length + 1).padStart(4, '0')}`;
      const isOutflow = txn.debit > 0;

      const newJournal: JournalEntry = {
        id: journalId,
        journalNo,
        date: txn.date,
        period: txn.date.slice(0, 7),
        source: 'bank_settlement',
        referenceNo: txn.bankRef,
        description: `تسوية حركة بنك CIB: ${txn.description}`,
        createdBy: req.user?.email || 'المحاسب العام',
        lines: isOutflow
          ? [
              {
                lineNo: 1,
                accountCode: '5301',
                accountNameAr: 'مصروفات تشغيلية ومرافق',
                description: txn.description,
                debit: amount,
                credit: 0,
                branchId: currentState.activeBranchId,
                costCenter: 'CC-TREASURY',
              },
              {
                lineNo: 2,
                accountCode: '1102',
                accountNameAr: 'بنك CIB — حساب استادات',
                description: `خصم بنكي ${txn.bankRef}`,
                debit: 0,
                credit: amount,
                branchId: currentState.activeBranchId,
                costCenter: 'CC-TREASURY',
              },
            ]
          : [
              {
                lineNo: 1,
                accountCode: '1102',
                accountNameAr: 'بنك CIB — حساب استادات',
                description: txn.description,
                debit: amount,
                credit: 0,
                branchId: currentState.activeBranchId,
                costCenter: 'CC-TREASURY',
              },
              {
                lineNo: 2,
                accountCode: '1103',
                accountNameAr: 'تحصيل VISA/POS تحت التسوية',
                description: `إيداع ${txn.bankRef}`,
                debit: 0,
                credit: amount,
                branchId: currentState.activeBranchId,
                costCenter: 'CC-TREASURY',
              },
            ],
      };

      await persistBankReconInDb(id, newJournal, req.user?.uid);
      const nextState = await loadErpStateFromDb();
      broadcastStateUpdate('bank_reconciled', { id });
      res.json({ state: nextState });
    } catch (error: any) {
      console.error('Error reconciling bank transaction:', error);
      res.status(500).json({ error: error?.message || 'Failed to reconcile bank transaction' });
    }
  });

  // Foodics API Webhook Simulation
  app.post('/api/erp/integrations/foodics', requireAuth, async (req: AuthRequest, res) => {
    try {
      const currentState = await loadErpStateFromDb();
      const { nextState, invoice, journal, kdsOrder } = applySaleAutomation(currentState, {
        items: [
          { menuItemId: 'MNU-099', qty: 1 },
          { menuItemId: 'MNU-001', qty: 2 },
        ],
        orderType: 'delivery',
        paymentMethod: 'foodics_credit',
        cashier: 'Foodics Webhook',
        source: 'foodics_api',
      });
      await persistSaleInDb(nextState, invoice, journal, kdsOrder, req.user?.uid);
      broadcastStateUpdate('foodics_order', { invoiceNo: invoice.invoiceNo });
      res.status(201).json({ state: nextState, invoice });
    } catch (error: any) {
      console.error('Error processing Foodics order:', error);
      res.status(500).json({ error: error?.message || 'Failed to process Foodics order' });
    }
  });

  // ETA Egyptian Tax Authority e-Invoicing JSON v1.0 Preview
  app.get('/api/erp/integrations/eta/:invoiceNo', requireAuth, async (req: AuthRequest, res) => {
    try {
      const erpState = await loadErpStateFromDb();
      const inv = erpState.salesInvoices.find((s) => s.invoiceNo === req.params.invoiceNo) || erpState.salesInvoices[0];
      if (!inv) {
        res.status(404).json({ error: 'Invoice not found' });
        return;
      }
      res.json({
        issuer: {
          address: {
            branchID: '0',
            country: 'EG',
            governate: 'Menoufia',
            regionCity: 'Shebin El-Kom',
            street: 'Al-Borg Sports Complex',
          },
          type: 'B',
          id: erpState.taxId,
          name: erpState.companyNameAr,
        },
        receiver: { type: 'P', id: '', name: 'Walk-in / POS Consumer' },
        documentType: 'I',
        documentTypeVersion: '1.0',
        dateTimeIssued: `${inv.date}T${inv.time}:00Z`,
        taxpayerActivityCode: '5610',
        internalID: inv.invoiceNo,
        invoiceLines: inv.lines.map((l) => ({
          description: l.nameAr,
          itemType: 'GS1',
          itemCode: l.menuItemId,
          unitType: 'EA',
          quantity: l.qty,
          unitValue: { currencySold: 'EGP', amountEGP: round2(l.lineNet / l.qty) },
          salesTotal: l.lineNet,
          total: l.lineTotalGross,
          taxableItems: [{ taxType: 'T1', amount: l.lineVat, subType: 'V009', rate: 14 }],
        })),
        totalSalesAmount: inv.netSales,
        netAmount: inv.netSales,
        taxTotals: [{ taxType: 'T1', amount: inv.vatAmount }],
        totalAmount: inv.grossTotal,
      });
    } catch (error: any) {
      console.error('Error generating ETA JSON:', error);
      res.status(500).json({ error: error?.message || 'Failed to generate ETA e-invoice payload' });
    }
  });

  // Migrate local/in-memory ErpState snapshot into PostgreSQL with live NDJSON progress stream
  app.post('/api/erp/migrate', requireAuth, async (req: AuthRequest, res) => {
    const body = (req.body || {}) as { state?: ErpState; overwriteExisting?: boolean };
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const writeEvent = (payload: unknown) => {
      res.write(`${JSON.stringify(payload)}\n`);
    };

    try {
      const report = await migrateErpStateToPostgres(body.state, {
        overwriteExisting: Boolean(body.overwriteExisting),
        onProgress: (ev) => {
          writeEvent({ type: 'progress', ...ev });
        },
      });
      const persistedState = await loadErpStateFromDb();
      broadcastStateUpdate('sync_completed', { migrated: true });
      writeEvent({
        type: 'complete',
        progress: 100,
        report,
        state: persistedState,
      });
      res.end();
    } catch (error: any) {
      console.error('Error migrating ERP state:', error);
      writeEvent({
        type: 'error',
        message: error?.message || 'Failed to migrate local state to PostgreSQL.',
      });
      res.end();
    }
  });

  // Disaster Recovery & Daily Cloud Storage Snapshot Backups
  app.get('/api/erp/backups/status', requireAuth, async (_req: AuthRequest, res) => {
    try {
      const [config, snapshots] = await Promise.all([getOrCreateBackupConfig(), listBackupSnapshots(20)]);
      res.json({ config, snapshots });
    } catch (error: any) {
      console.error('Error loading backup status:', error);
      res.status(500).json({ error: error?.message || 'Failed to load backup status' });
    }
  });

  app.patch('/api/erp/backups/config', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { bucketName, prefix, scheduleCron, timezone, retentionDays, enabled } = req.body || {};
      const config = await updateBackupConfig({
        bucketName,
        prefix,
        scheduleCron,
        timezone,
        retentionDays,
        enabled,
      });
      res.json({ config });
    } catch (error: any) {
      console.error('Error updating backup config:', error);
      res.status(500).json({ error: error?.message || 'Failed to update backup configuration' });
    }
  });

  // Triggered either by Google Cloud Scheduler (X-Backup-Scheduler-Secret) or authenticated admin
  app.post('/api/erp/backups/run', async (req: AuthRequest, res) => {
    const cronSecret = process.env.BACKUP_CRON_SECRET?.trim();
    const headerSecret = req.headers['x-backup-scheduler-secret'];
    const isCronAuthorized = Boolean(cronSecret && typeof headerSecret === 'string' && headerSecret === cronSecret);

    if (isCronAuthorized) {
      try {
        const snapshot = await runDatabaseSnapshotBackup({
          triggerType: 'cloud_scheduler',
          triggeredBy: 'Google Cloud Scheduler',
        });
        const config = await getOrCreateBackupConfig();
        broadcastStateUpdate('backup_completed', { snapshotId: snapshot.id });
        res.status(201).json({ snapshot, config });
      } catch (error: any) {
        console.error('Scheduled backup run failed:', error);
        res.status(500).json({ error: error?.message || 'Scheduled backup export failed' });
      }
      return;
    }

    await requireAuth(req, res, async () => {
      try {
        const snapshot = await runDatabaseSnapshotBackup({
          triggerType: 'manual',
          triggeredBy: req.user?.email || 'Authenticated Admin',
        });
        const config = await getOrCreateBackupConfig();
        broadcastStateUpdate('backup_completed', { snapshotId: snapshot.id });
        res.status(201).json({ snapshot, config });
      } catch (error: any) {
        console.error('Manual backup run failed:', error);
        res.status(500).json({ error: error?.message || 'Backup export failed' });
      }
    });
  });

  app.get('/api/erp/backups/:id/download', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { filename, buffer } = await generateSnapshotBufferForDownload(id);
      res.setHeader('Content-Type', 'application/gzip');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (error: any) {
      console.error('Error downloading snapshot:', error);
      res.status(404).json({ error: error?.message || 'Snapshot archive not found' });
    }
  });

  // Full PostgreSQL Database JSON / CSV / ZIP Bundle Export
  app.get('/api/erp/export/full-database/summary', requireAuth, async (req: AuthRequest, res) => {
    try {
      const bundle = await exportAllPostgresTablesBundle(req.user?.email || 'Authenticated User');
      res.json({
        exportedAt: bundle.exportedAt,
        databaseEngine: 'PostgreSQL (Cloud SQL)',
        tableCount: bundle.tableCount,
        totalRows: bundle.totalRows,
        rowCounts: bundle.rowCounts,
        integrity: bundle.integrity,
      });
    } catch (error: any) {
      console.error('Error summarizing full database export:', error);
      res.status(500).json({ error: error?.message || 'Failed to summarize PostgreSQL tables' });
    }
  });

  app.get('/api/erp/export/full-database', requireAuth, async (req: AuthRequest, res) => {
    try {
      const rawFmt = String(req.query.format || 'zip').toLowerCase();
      const format: FullDatabaseExportFormat =
        rawFmt === 'json-zip' || rawFmt === 'json_zip' || rawFmt === 'audit-zip'
          ? 'json-zip'
          : rawFmt === 'json'
            ? 'json'
            : rawFmt === 'csv'
              ? 'csv'
              : 'zip';
      const exportedBy = req.user?.email || 'Authenticated User';
      const payload = await buildFullDatabaseDownloadPayload(format, exportedBy);
      res.setHeader('Content-Type', payload.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${payload.filename}"`);
      res.setHeader('X-Export-Bundle-Format', format);
      res.setHeader('X-Export-Table-Count', String(payload.summary.tableCount));
      res.setHeader('X-Export-Total-Rows', String(payload.summary.totalRows));
      res.send(payload.buffer);
    } catch (error: any) {
      console.error('Error exporting full PostgreSQL database:', error);
      res.status(500).json({ error: error?.message || 'Failed to export PostgreSQL database bundle' });
    }
  });

  // CFO Risk Register CRUD (Persisted in PostgreSQL strategy2027 JSONB)
  app.post('/api/erp/risks', requireAuth, async (req: AuthRequest, res) => {
    try {
      const body = (req.body || {}) as Partial<StrategyRisk>;
      const riskAr = String(body.riskAr || '').trim();
      const riskEn = String(body.riskEn || riskAr).trim();
      const mitigationAr = String(body.mitigationAr || '').trim();
      if (!riskAr || !mitigationAr) {
        res.status(400).json({ error: 'Risk description and corrective action are required' });
        return;
      }

      const validCategories: RiskCategory[] = ['financial', 'operational'];
      const validFocusAreas: RiskFocusArea[] = ['usufruct', 'unused_space', 'general'];
      const validImpacts: RiskImpact[] = ['low', 'medium', 'high'];
      const validLikelihoods: StrategyRisk['likelihood'][] = ['low', 'medium', 'high', 'confirmed'];
      const validStatuses: RiskStatus[] = ['open', 'in_progress', 'mitigated'];

      const currentState = await loadErpStateFromDb();
      const existing = currentState.strategy2027.risks ?? [];
      const nextNum = existing.length + 1;
      const nowTs = new Date().toISOString().slice(0, 16).replace('T', ' ');
      const actorLabel = req.user?.email || 'المدير المالي CFO';
      const initialImpact: RiskImpact = validImpacts.includes(body.impact as RiskImpact)
        ? (body.impact as RiskImpact)
        : 'high';
      const initialStatus: RiskStatus = validStatuses.includes(body.status as RiskStatus)
        ? (body.status as RiskStatus)
        : 'open';
      const initialOwnerAr = String(body.ownerAr || 'المدير المالي CFO').trim();

      const initialAuditEntry: RiskAuditEntry = {
        id: `RAUD-${Date.now()}`,
        timestamp: nowTs,
        actor: actorLabel,
        actionType: 'created',
        summaryAr: `إنشاء بند خطر جديد وتكليف "${initialOwnerAr}" بالإجراء التصحيحي`,
        summaryEn: `Created new risk item & assigned corrective action to "${initialOwnerAr}"`,
        newStatus: initialStatus,
        newImpact: initialImpact,
        newMitigation: mitigationAr,
        newOwner: initialOwnerAr,
      };

      const newRisk: StrategyRisk = {
        id: `RSK-${Date.now()}`,
        code: body.code?.trim() || `RSK-${String(nextNum).padStart(2, '0')}`,
        riskAr,
        riskEn,
        category: validCategories.includes(body.category as RiskCategory)
          ? (body.category as RiskCategory)
          : 'financial',
        focusArea: validFocusAreas.includes(body.focusArea as RiskFocusArea)
          ? (body.focusArea as RiskFocusArea)
          : 'usufruct',
        likelihood: validLikelihoods.includes(body.likelihood as StrategyRisk['likelihood'])
          ? (body.likelihood as StrategyRisk['likelihood'])
          : 'medium',
        impact: initialImpact,
        mitigationAr,
        mitigationEn: String(body.mitigationEn || mitigationAr).trim(),
        ownerAr: initialOwnerAr,
        ownerEn: String(body.ownerEn || initialOwnerAr || 'CFO').trim(),
        status: initialStatus,
        dueDate: body.dueDate ? String(body.dueDate).slice(0, 10) : '2026-12-31',
        financialExposureEgp:
          typeof body.financialExposureEgp === 'number' && Number.isFinite(body.financialExposureEgp)
            ? Math.max(0, round2(body.financialExposureEgp))
            : 0,
        updatedAt: nowTs,
        auditHistory: [initialAuditEntry],
      };

      const nextRisks = [newRisk, ...existing];
      const nextState = await persistStrategyRisksInDb(
        nextRisks,
        'إضافة خطر جديد بسجل CFO',
        newRisk.code || newRisk.id,
        `${newRisk.riskAr} — التأثير: ${newRisk.impact.toUpperCase()} — المكلف: ${newRisk.ownerAr}`,
        actorLabel,
        req.user?.uid
      );
      broadcastStateUpdate('risks_updated', { id: newRisk.id });
      res.status(201).json({ state: nextState, risk: newRisk });
    } catch (error: any) {
      console.error('Error creating CFO risk:', error);
      res.status(500).json({ error: error?.message || 'Failed to create risk entry' });
    }
  });

  app.patch('/api/erp/risks/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const body = (req.body || {}) as Partial<StrategyRisk> & { auditNote?: string };
      const currentState = await loadErpStateFromDb();
      const existing = currentState.strategy2027.risks ?? [];
      const target = existing.find((r) => r.id === id);
      if (!target) {
        res.status(404).json({ error: 'Risk record not found' });
        return;
      }

      const validCategories: RiskCategory[] = ['financial', 'operational'];
      const validFocusAreas: RiskFocusArea[] = ['usufruct', 'unused_space', 'general'];
      const validImpacts: RiskImpact[] = ['low', 'medium', 'high'];
      const validLikelihoods: StrategyRisk['likelihood'][] = ['low', 'medium', 'high', 'confirmed'];
      const validStatuses: RiskStatus[] = ['open', 'in_progress', 'mitigated'];

      const nextImpact = validImpacts.includes(body.impact as RiskImpact) ? (body.impact as RiskImpact) : target.impact;
      const nextStatus: RiskStatus = validStatuses.includes(body.status as RiskStatus)
        ? (body.status as RiskStatus)
        : target.status ?? 'open';
      const nextMitigationAr = body.mitigationAr?.trim() ? body.mitigationAr.trim() : target.mitigationAr;
      const nextMitigationEn = body.mitigationEn?.trim() ? body.mitigationEn.trim() : target.mitigationEn;
      const nextOwnerAr = body.ownerAr !== undefined ? String(body.ownerAr).trim() || 'المدير المالي CFO' : target.ownerAr || 'المدير المالي CFO';
      const nextOwnerEn = body.ownerEn !== undefined ? String(body.ownerEn).trim() || nextOwnerAr || 'CFO' : target.ownerEn || 'CFO';
      const nextDueDate = body.dueDate !== undefined ? String(body.dueDate).slice(0, 10) : target.dueDate;
      const auditNote = typeof body.auditNote === 'string' ? body.auditNote.trim().slice(0, 500) : '';

      const nowTs = new Date().toISOString().slice(0, 16).replace('T', ' ');
      const actorLabel = req.user?.email || 'المدير المالي CFO';
      const prevStatus: RiskStatus = target.status ?? 'open';
      const prevImpact = target.impact;
      const prevOwner = target.ownerAr || 'المدير المالي CFO';

      const statusChanged = nextStatus !== prevStatus;
      const impactChanged = nextImpact !== prevImpact;
      const mitigationChanged = nextMitigationAr !== target.mitigationAr;
      const ownerChanged = nextOwnerAr !== prevOwner;

      const summaryPartsAr: string[] = [];
      const summaryPartsEn: string[] = [];
      if (statusChanged) {
        summaryPartsAr.push(`تغيير حالة المعالجة (${prevStatus} ← ${nextStatus})`);
        summaryPartsEn.push(`Status changed (${prevStatus} → ${nextStatus})`);
      }
      if (impactChanged) {
        summaryPartsAr.push(`تعديل التأثير (${prevImpact.toUpperCase()} ← ${nextImpact.toUpperCase()})`);
        summaryPartsEn.push(`Impact changed (${prevImpact.toUpperCase()} → ${nextImpact.toUpperCase()})`);
      }
      if (mitigationChanged) {
        summaryPartsAr.push('تحديث خطة الإجراء التصحيحي');
        summaryPartsEn.push('Updated corrective mitigation plan');
      }
      if (ownerChanged) {
        summaryPartsAr.push(`تغيير المسؤول المكلف إلى "${nextOwnerAr}"`);
        summaryPartsEn.push(`Reassigned owner to "${nextOwnerAr}"`);
      }
      if (nextDueDate && nextDueDate !== target.dueDate) {
        summaryPartsAr.push(`تحديث موعد الاستحقاق إلى ${nextDueDate}`);
        summaryPartsEn.push(`Updated due date to ${nextDueDate}`);
      }
      if (summaryPartsAr.length === 0) {
        summaryPartsAr.push(auditNote ? 'توثيق متابعة تقدم المعالجة' : 'مراجعة وتحديث بيانات الخطر');
        summaryPartsEn.push(auditNote ? 'Logged mitigation progress note' : 'Reviewed & updated risk record');
      }

      const actionType: RiskAuditEntry['actionType'] = statusChanged
        ? 'status_change'
        : impactChanged
        ? 'impact_change'
        : mitigationChanged
        ? 'mitigation_update'
        : ownerChanged
        ? 'owner_change'
        : 'updated';

      const newAuditEntry: RiskAuditEntry = {
        id: `RAUD-${Date.now()}`,
        timestamp: nowTs,
        actor: actorLabel,
        actionType,
        summaryAr: summaryPartsAr.join(' · '),
        summaryEn: summaryPartsEn.join(' · '),
        ...(statusChanged ? { previousStatus: prevStatus, newStatus: nextStatus } : {}),
        ...(impactChanged ? { previousImpact: prevImpact, newImpact: nextImpact } : {}),
        ...(mitigationChanged ? { previousMitigation: target.mitigationAr, newMitigation: nextMitigationAr } : {}),
        ...(ownerChanged ? { previousOwner: prevOwner, newOwner: nextOwnerAr } : {}),
        ...(auditNote ? { note: auditNote } : {}),
      };

      const existingHistory = Array.isArray(target.auditHistory) ? target.auditHistory : [];

      const updated: StrategyRisk = {
        ...target,
        ...(body.riskAr?.trim() ? { riskAr: body.riskAr.trim() } : {}),
        ...(body.riskEn?.trim() ? { riskEn: body.riskEn.trim() } : {}),
        mitigationAr: nextMitigationAr,
        mitigationEn: nextMitigationEn,
        ownerAr: nextOwnerAr,
        ownerEn: nextOwnerEn,
        dueDate: nextDueDate,
        ...(typeof body.financialExposureEgp === 'number' && Number.isFinite(body.financialExposureEgp)
          ? { financialExposureEgp: Math.max(0, round2(body.financialExposureEgp)) }
          : {}),
        category: validCategories.includes(body.category as RiskCategory)
          ? (body.category as RiskCategory)
          : target.category,
        focusArea: validFocusAreas.includes(body.focusArea as RiskFocusArea)
          ? (body.focusArea as RiskFocusArea)
          : target.focusArea,
        impact: nextImpact,
        likelihood: validLikelihoods.includes(body.likelihood as StrategyRisk['likelihood'])
          ? (body.likelihood as StrategyRisk['likelihood'])
          : target.likelihood,
        status: nextStatus,
        updatedAt: nowTs,
        auditHistory: [newAuditEntry, ...existingHistory],
      };

      const nextRisks = existing.map((r) => (r.id === id ? updated : r));
      const nextState = await persistStrategyRisksInDb(
        nextRisks,
        'تحديث خطر وتكليف إجراء تصحيحي',
        updated.code || updated.id,
        `${updated.riskAr} — ${newAuditEntry.summaryAr}${auditNote ? ` (${auditNote})` : ''}`,
        actorLabel,
        req.user?.uid
      );
      broadcastStateUpdate('risks_updated', { id });
      res.json({ state: nextState, risk: updated });
    } catch (error: any) {
      console.error('Error updating CFO risk:', error);
      res.status(500).json({ error: error?.message || 'Failed to update risk entry' });
    }
  });

  app.delete('/api/erp/risks/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const currentState = await loadErpStateFromDb();
      const existing = currentState.strategy2027.risks ?? [];
      const target = existing.find((r) => r.id === id);
      if (!target) {
        res.status(404).json({ error: 'Risk record not found' });
        return;
      }

      const nextRisks = existing.filter((r) => r.id !== id);
      const nextState = await persistStrategyRisksInDb(
        nextRisks,
        'حذف بند من سجل المخاطر',
        target.code || target.id,
        `تم حذف البند: ${target.riskAr}`,
        req.user?.email || 'المدير المالي CFO',
        req.user?.uid
      );
      broadcastStateUpdate('risks_updated', { id, deleted: true });
      res.json({ state: nextState });
    } catch (error: any) {
      console.error('Error deleting CFO risk:', error);
      res.status(500).json({ error: error?.message || 'Failed to delete risk entry' });
    }
  });

  // Reset ERP database to 9M 2026 baseline
  app.post('/api/erp/reset', requireAuth, async (_req: AuthRequest, res) => {
    try {
      const erpState = await resetErpDatabaseInDb();
      broadcastStateUpdate('state_reset');
      res.json({ state: erpState });
    } catch (error: any) {
      console.error('Error resetting ERP state:', error);
      res.status(500).json({ error: error?.message || 'Failed to reset ERP baseline' });
    }
  });

  if (vitePromise) {
    app.use(async (req, res, next) => {
      try {
        const vite = await vitePromise;
        if (!vite) {
          return next(viteInitError || new Error('Vite dev server failed to initialize'));
        }
        vite.middlewares(req, res, next);
      } catch (err) {
        next(err);
      }
    });
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Estadat Al-Borg ERP server running on http://localhost:${PORT}`);
    startDailyBackupScheduler();
  });
}

startServer();
