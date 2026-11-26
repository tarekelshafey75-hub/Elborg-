/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Circle, Database, Loader2, ShieldCheck, X } from 'lucide-react';
import { AccountingBankModule } from './components/AccountingBankModule';
import { CfoDashboard } from './components/CfoDashboard';
import { CfoExecutiveReviewModule } from './components/CfoExecutiveReviewModule';
import { DataQualityExportModule } from './components/DataQualityExportModule';
import { InventoryMenuModule } from './components/InventoryMenuModule';
import { InvestmentRoiSimulatorModule } from './components/InvestmentRoiSimulatorModule';
import { LoginScreen } from './components/LoginScreen';
import { PosModule } from './components/PosModule';
import { PrintCenterModal } from './components/PrintCenterModal';
import { PrintableFilesPacket, PrintFileKey } from './components/PrintableFilesPacket';
import { PurchasesSuppliersModule } from './components/PurchasesSuppliersModule';
import { NavTab, Sidebar } from './components/Sidebar';
import { Strategy2027Module } from './components/Strategy2027Module';
import { TopBar } from './components/TopBar';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { createSeedErpState } from './data/seedErpData';
import {
  Customer,
  ErpState,
  Language,
  PurchaseInvoice,
  RiskAuditEntry,
  SalesInvoice,
  StrategyRisk,
  Supplier,
  UserRole,
  WasteEntry,
} from './types/erp';
import {
  applySaleAutomation,
  applyStocktakeEntryAutomation,
  applyStocktakeReconciliationAutomation,
  computeStockOpportunityAlerts,
  exportErpWorkbook,
  PurchaseRequestPayload,
  SaleRequestPayload,
} from './utils/erpEngine';
import { fmtMoney } from './utils/formatters';

type MigrationStageKey = 'validating' | 'metadata_master' | 'sales_kds' | 'ledger_inventory' | 'verifying';

interface MigrationReportView {
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

interface MigrationProgressState {
  open: boolean;
  status: 'idle' | 'running' | 'completed' | 'error';
  progress: number;
  currentStage: MigrationStageKey | null;
  completedStages: MigrationStageKey[];
  statusLabelAr: string;
  statusLabelEn: string;
  report: MigrationReportView | null;
  errorMessage: string | null;
}

const MIGRATION_STAGES: { key: MigrationStageKey; labelAr: string; labelEn: string }[] = [
  {
    key: 'validating',
    labelAr: 'فحص الاتزان المحاسبي وروابط التكاليف (BOM)',
    labelEn: 'Pre-migration trial balance & BOM validation',
  },
  {
    key: 'metadata_master',
    labelAr: 'ترحيل شجرة الحسابات والمواد الخام وقائمة الأصناف',
    labelEn: 'Migrate chart of accounts, ingredients & catalog',
  },
  {
    key: 'sales_kds',
    labelAr: 'ترحيل فواتير المبيعات وبنود الإيرادات',
    labelEn: 'Migrate sales invoices & revenue line items',
  },
  {
    key: 'ledger_inventory',
    labelAr: 'ترحيل المشتريات والقيود المحاسبية وحركات CIB',
    labelEn: 'Migrate purchases, ledger journals & CIB bank records',
  },
  {
    key: 'verifying',
    labelAr: 'مطابقة البيانات بعد الترحيل وفحص الجودة',
    labelEn: 'Post-migration PostgreSQL integrity verification',
  },
];

const INITIAL_MIGRATION_STATE: MigrationProgressState = {
  open: false,
  status: 'idle',
  progress: 0,
  currentStage: null,
  completedStages: [],
  statusLabelAr: '',
  statusLabelEn: '',
  report: null,
  errorMessage: null,
};

const OFFLINE_QUEUE_KEY = 'estadat_pos_offline_queue_v1';
const THEME_STORAGE_KEY = 'estadat_theme_v1';

function ErpWorkspace({
  lang,
  onToggleLang,
  theme,
  onToggleTheme,
}: {
  lang: Language;
  onToggleLang: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}) {
  const { user, idToken, authFetch, signOutUser } = useAuth();
  const [erpState, setErpState] = useState<ErpState>(() => createSeedErpState());
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [role, setRole] = useState<UserRole>('cfo');
  const [isOffline, setIsOffline] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [apiErrorBanner, setApiErrorBanner] = useState<string | null>(null);
  const [migrationState, setMigrationState] = useState<MigrationProgressState>(INITIAL_MIGRATION_STATE);
  const [prefillPurchase, setPrefillPurchase] = useState<{
    ingredientId: string;
    supplierId: string;
    qty: number;
  } | null>(null);
  const [inventoryFocus, setInventoryFocus] = useState<{
    subTab: 'stock' | 'recipes' | 'waste' | 'stocktake';
    stocktakeId?: string | null;
  } | null>(null);
  const [offlineQueue, setOfflineQueue] = useState<SaleRequestPayload[]>(() => {
    try {
      const saved = localStorage.getItem(OFFLINE_QUEUE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [printCenterOpen, setPrintCenterOpen] = useState(false);
  const [activePrintJob, setActivePrintJob] = useState<{
    keys: PrintFileKey[];
    singleSalesInvoice?: SalesInvoice | null;
    singlePurchaseInvoice?: PurchaseInvoice | null;
  } | null>(null);

  // Trigger clean A4 print packet when activePrintJob commits to DOM
  useEffect(() => {
    if (!activePrintJob) return;
    document.body.classList.add('printing-packet');

    const cleanup = () => {
      document.body.classList.remove('printing-packet');
      setActivePrintJob(null);
    };

    window.addEventListener('afterprint', cleanup, { once: true });
    let timerId: number | undefined;
    const rafId = requestAnimationFrame(() => {
      timerId = window.setTimeout(() => {
        window.print();
      }, 60);
    });

    return () => {
      cancelAnimationFrame(rafId);
      if (timerId !== undefined) window.clearTimeout(timerId);
      window.removeEventListener('afterprint', cleanup);
      document.body.classList.remove('printing-packet');
    };
  }, [activePrintJob]);

  // Persist offline POS queue
  useEffect(() => {
    try {
      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(offlineQueue));
    } catch {
      // ignore storage quota errors
    }
  }, [offlineQueue]);

  const fetchErpState = useCallback(async () => {
    if (isOffline || !user) return;
    try {
      const res = await authFetch('/api/erp/state');
      if (res.ok) {
        const data = await res.json();
        if (data?.state) {
          setErpState(data.state);
          setApiErrorBanner(null);
        }
      } else {
        setApiErrorBanner(
          lang === 'ar'
            ? 'تعذر تحميل أحدث البيانات من الخادم — تم الإبقاء على العرض الحالي.'
            : 'Unable to refresh latest records from server.'
        );
      }
    } catch {
      setApiErrorBanner(
        lang === 'ar'
          ? 'تعذر الاتصال بالخادم حالياً — يمكنك الاستمرار أو التبديل لوضع Offline.'
          : 'Server temporarily unreachable — you may continue or switch to Offline mode.'
      );
    }
  }, [isOffline, user, authFetch, lang]);

  // Initial load + Authenticated Real-Time SSE subscription for Ledger, Sales & Dashboard
  useEffect(() => {
    if (!user || !idToken) return;
    fetchErpState();
    const evtSource = new EventSource(`/api/erp/events?token=${encodeURIComponent(idToken)}`);
    const refreshHandler = () => {
      fetchErpState();
    };
    evtSource.addEventListener('sale_created', refreshHandler);
    evtSource.addEventListener('purchase_created', refreshHandler);
    evtSource.addEventListener('expense_created', refreshHandler);
    evtSource.addEventListener('waste_created', refreshHandler);
    evtSource.addEventListener('stocktake_updated', refreshHandler);
    evtSource.addEventListener('journal_reversed', refreshHandler);
    evtSource.addEventListener('bank_reconciled', refreshHandler);
    evtSource.addEventListener('foodics_order', refreshHandler);
    evtSource.addEventListener('sync_completed', refreshHandler);
    evtSource.addEventListener('state_reset', refreshHandler);
    evtSource.addEventListener('menu_updated', refreshHandler);
    evtSource.addEventListener('partners_updated', refreshHandler);
    evtSource.addEventListener('risks_updated', refreshHandler);
    return () => evtSource.close();
  }, [fetchErpState, user, idToken]);

  const handleSelectBranch = async (branchId: string) => {
    setErpState((prev) => ({ ...prev, activeBranchId: branchId }));
    if (!isOffline) {
      try {
        const res = await authFetch('/api/erp/branch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ branchId }),
        });
        if (!res.ok) throw new Error('Branch update failed');
      } catch {
        setApiErrorBanner(lang === 'ar' ? 'تعذر حفظ تغيير الفرع على الخادم.' : 'Failed to save branch change.');
      }
    }
  };

  const handleSubmitSale = async (payload: SaleRequestPayload): Promise<SalesInvoice | null> => {
    if (isOffline) {
      const { nextState, invoice } = applySaleAutomation(erpState, { ...payload, offlineQueued: true });
      setErpState(nextState);
      setOfflineQueue((q) => [...q, payload]);
      return invoice;
    }

    try {
      const res = await authFetch('/api/erp/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        setErpState(data.state);
        setApiErrorBanner(null);
        return data.invoice;
      }
      setApiErrorBanner(lang === 'ar' ? 'تعذر حفظ فاتورة البيع. يرجى المحاولة مرة أخرى.' : 'Failed to save sales invoice.');
    } catch {
      setApiErrorBanner(lang === 'ar' ? 'تعذر الاتصال بالخادم لحفظ الفاتورة.' : 'Network error saving invoice.');
    }
    return null;
  };

  const handleSyncOffline = async () => {
    if (isOffline || offlineQueue.length === 0) return;
    setIsSyncing(true);
    try {
      const res = await authFetch('/api/erp/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queuedSales: offlineQueue }),
      });
      if (res.ok) {
        const data = await res.json();
        setErpState(data.state);
        setOfflineQueue([]);
        setApiErrorBanner(null);
      } else {
        setApiErrorBanner(lang === 'ar' ? 'فشلت مزامنة فواتير Offline.' : 'Failed to sync offline invoices.');
      }
    } catch {
      setApiErrorBanner(lang === 'ar' ? 'تعذر الاتصال بالخادم للمزامنة.' : 'Unable to connect for sync.');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSimulateFoodics = async () => {
    try {
      const res = await authFetch('/api/erp/integrations/foodics', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setErpState(data.state);
      }
    } catch {
      setApiErrorBanner(lang === 'ar' ? 'تعذر استيراد طلب Foodics.' : 'Failed to process Foodics order.');
    }
  };

  const handleCreatePurchase = async (payload: PurchaseRequestPayload) => {
    try {
      const res = await authFetch('/api/erp/purchases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        setErpState(data.state);
      }
    } catch {
      setApiErrorBanner(lang === 'ar' ? 'تعذر حفظ فاتورة المشتريات.' : 'Failed to record purchase invoice.');
    }
  };

  const handleSeedDemoPartners = async () => {
    const seed = createSeedErpState();
    if (isOffline) {
      setErpState((prev) => ({
        ...prev,
        suppliers: seed.suppliers,
        customers: seed.customers,
      }));
      return;
    }
    try {
      const res = await authFetch('/api/erp/partners/seed-demo', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setErpState(data.state);
        setApiErrorBanner(null);
      }
    } catch {
      setApiErrorBanner(lang === 'ar' ? 'تعذر تحميل البيانات الوهمية للموردين والعملاء.' : 'Failed to load demo partners.');
    }
  };

  const handleAddSupplier = async (supplier: Partial<Supplier>) => {
    if (isOffline) {
      const offlineSup: Supplier = {
        id: `SUP-${Date.now()}`,
        nameAr: supplier.nameAr || 'مورد جديد',
        nameEn: supplier.nameEn || supplier.nameAr || 'New Supplier',
        taxNumber: supplier.taxNumber || '000-000-000',
        phone: supplier.phone || '',
        paymentTermsDays: supplier.paymentTermsDays || 15,
        aging0_30: 0,
        aging31_60: 0,
        aging61_90Plus: 0,
        rating: 4.5,
        categoryAr: supplier.categoryAr,
        city: supplier.city,
        contactName: supplier.contactName,
      };
      setErpState((prev) => ({ ...prev, suppliers: [offlineSup, ...prev.suppliers] }));
      return;
    }
    try {
      const res = await authFetch('/api/erp/partners/suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(supplier),
      });
      if (res.ok) {
        const data = await res.json();
        setErpState(data.state);
      }
    } catch {
      setApiErrorBanner(lang === 'ar' ? 'تعذر حفظ المورد الجديد.' : 'Failed to save supplier.');
    }
  };

  const handleAddCustomer = async (customer: Partial<Customer>) => {
    if (isOffline) {
      const offlineCus: Customer = {
        id: `CUS-${Date.now()}`,
        code: `CUS-${Math.floor(1000 + Math.random() * 9000)}`,
        nameAr: customer.nameAr || 'عميل جديد',
        nameEn: customer.nameEn || customer.nameAr || 'New Customer',
        segment: customer.segment || 'family',
        phone: customer.phone || '',
        city: customer.city || 'شبين الكوم',
        taxNumber: customer.taxNumber,
        creditLimit: customer.creditLimit || 5000,
        currentBalance: 0,
        totalOrders: 0,
        totalSpent: 0,
        loyaltyPoints: 0,
        lastOrderDate: new Date().toISOString().slice(0, 10),
      };
      setErpState((prev) => ({ ...prev, customers: [offlineCus, ...(prev.customers ?? [])] }));
      return;
    }
    try {
      const res = await authFetch('/api/erp/partners/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(customer),
      });
      if (res.ok) {
        const data = await res.json();
        setErpState(data.state);
      }
    } catch {
      setApiErrorBanner(lang === 'ar' ? 'تعذر حفظ العميل الجديد.' : 'Failed to save customer.');
    }
  };

  const handleRecordWaste = async (payload: { ingredientId: string; qty: number; reason: WasteEntry['reason'] }) => {
    try {
      const res = await authFetch('/api/erp/waste', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        setErpState(data.state);
      }
    } catch {
      setApiErrorBanner(lang === 'ar' ? 'تعذر تسجيل الهالك.' : 'Failed to record waste.');
    }
  };

  const handleRecordStocktake = async (payload: {
    ingredientId: string;
    actualQty: number;
    locationAr?: string;
    notes?: string;
  }) => {
    if (isOffline) {
      const { nextState } = applyStocktakeEntryAutomation(erpState, {
        ...payload,
        countedBy: user?.email || 'مراقب المخزون — جرد Offline',
      });
      setErpState(nextState);
      return;
    }
    try {
      const res = await authFetch('/api/erp/stocktake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        setErpState(data.state);
        setApiErrorBanner(null);
      }
    } catch {
      setApiErrorBanner(lang === 'ar' ? 'تعذر تسجيل محضر الجرد.' : 'Failed to record stocktake count.');
    }
  };

  const handleReconcileStocktake = async (stocktakeId: string) => {
    if (isOffline) {
      const nextState = applyStocktakeReconciliationAutomation(
        erpState,
        stocktakeId,
        user?.email || 'المدير المالي'
      );
      setErpState(nextState);
      return;
    }
    try {
      const res = await authFetch(`/api/erp/stocktake/${stocktakeId}/reconcile`, {
        method: 'POST',
      });
      if (res.ok) {
        const data = await res.json();
        setErpState(data.state);
        setApiErrorBanner(null);
      }
    } catch {
      setApiErrorBanner(
        lang === 'ar' ? 'تعذر اعتماد تسوية فارق الجرد.' : 'Failed to reconcile stocktake discrepancy.'
      );
    }
  };

  const handleUpdateMenuPrice = async (menuItemId: string, sellingPriceGross: number) => {
    if (isOffline) {
      const rounded = Math.round(sellingPriceGross * 100) / 100;
      setErpState((prev) => ({
        ...prev,
        menuItems: prev.menuItems.map((m) =>
          m.id === menuItemId
            ? {
                ...m,
                sellingPriceGross: rounded,
                priceInclService: rounded > 0 ? rounded : null,
                basePrice: rounded > 0 ? Math.round((rounded / 1.12) * 100) / 100 : null,
                priceStatus: rounded > 0 ? 'priced' : 'unspecified',
              }
            : m
        ),
      }));
      return;
    }
    try {
      const res = await authFetch(`/api/erp/menu/${menuItemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sellingPriceGross }),
      });
      if (res.ok) {
        const data = await res.json();
        setErpState(data.state);
      }
    } catch {
      setApiErrorBanner(lang === 'ar' ? 'تعذر تحديث سعر الصنف.' : 'Failed to update menu price.');
    }
  };

  const handleCreateRisk = async (payload: Partial<StrategyRisk>) => {
    if (isOffline) {
      const existing = erpState.strategy2027.risks ?? [];
      const nowTs = new Date().toISOString().slice(0, 16).replace('T', ' ');
      const ownerAr = payload.ownerAr || 'المدير المالي CFO';
      const impact = payload.impact ?? 'high';
      const status = payload.status ?? 'open';
      const created: StrategyRisk = {
        id: `RSK-${Date.now()}`,
        code: payload.code || `RSK-${String(existing.length + 1).padStart(2, '0')}`,
        riskAr: payload.riskAr || 'خطر جديد',
        riskEn: payload.riskEn || payload.riskAr || 'New Risk',
        category: payload.category ?? 'financial',
        focusArea: payload.focusArea ?? 'usufruct',
        likelihood: payload.likelihood ?? 'medium',
        impact,
        mitigationAr: payload.mitigationAr || '',
        mitigationEn: payload.mitigationEn || payload.mitigationAr || '',
        ownerAr,
        ownerEn: payload.ownerEn || 'Chief Financial Officer (CFO)',
        status,
        dueDate: payload.dueDate || '2026-12-31',
        financialExposureEgp: Number(payload.financialExposureEgp) || 0,
        updatedAt: nowTs,
        auditHistory: [
          {
            id: `RAUD-${Date.now()}`,
            timestamp: nowTs,
            actor: user?.email || 'المدير المالي CFO',
            actionType: 'created',
            summaryAr: `إنشاء بند خطر جديد وتكليف "${ownerAr}" بالإجراء التصحيحي`,
            summaryEn: `Created new risk item & assigned corrective action to "${ownerAr}"`,
            newStatus: status,
            newImpact: impact,
            newMitigation: payload.mitigationAr || '',
            newOwner: ownerAr,
          },
        ],
      };
      setErpState((prev) => ({
        ...prev,
        strategy2027: { ...prev.strategy2027, risks: [created, ...(prev.strategy2027.risks ?? [])] },
      }));
      return;
    }
    try {
      const res = await authFetch('/api/erp/risks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        setErpState(data.state);
        setApiErrorBanner(null);
      } else {
        setApiErrorBanner(lang === 'ar' ? 'تعذر حفظ الخطر الجديد في قاعدة البيانات.' : 'Failed to save new risk.');
      }
    } catch {
      setApiErrorBanner(lang === 'ar' ? 'تعذر الاتصال بالخادم لحفظ الخطر.' : 'Network error saving risk.');
    }
  };

  const handleUpdateRisk = async (id: string, patch: Partial<StrategyRisk> & { auditNote?: string }) => {
    if (isOffline) {
      const nowTs = new Date().toISOString().slice(0, 16).replace('T', ' ');
      const actor = user?.email || 'المدير المالي CFO';
      setErpState((prev) => ({
        ...prev,
        strategy2027: {
          ...prev.strategy2027,
          risks: prev.strategy2027.risks.map((r) => {
            if (r.id !== id) return r;
            const { auditNote, ...fields } = patch;
            const nextStatus = fields.status ?? r.status ?? 'open';
            const nextImpact = fields.impact ?? r.impact;
            const nextMitigation = fields.mitigationAr ?? r.mitigationAr;
            const nextOwner = fields.ownerAr ?? r.ownerAr ?? 'المدير المالي CFO';
            const statusChanged = nextStatus !== (r.status ?? 'open');
            const impactChanged = nextImpact !== r.impact;
            const mitigationChanged = nextMitigation !== r.mitigationAr;
            const ownerChanged = nextOwner !== (r.ownerAr ?? 'المدير المالي CFO');
            const entry: RiskAuditEntry = {
              id: `RAUD-${Date.now()}`,
              timestamp: nowTs,
              actor,
              actionType: statusChanged
                ? 'status_change'
                : impactChanged
                ? 'impact_change'
                : mitigationChanged
                ? 'mitigation_update'
                : ownerChanged
                ? 'owner_change'
                : 'updated',
              summaryAr: statusChanged
                ? `تغيير حالة المعالجة (${r.status ?? 'open'} ← ${nextStatus})`
                : auditNote?.trim() || 'تحديث بيانات الخطر وخطة المعالجة',
              summaryEn: statusChanged
                ? `Status changed (${r.status ?? 'open'} → ${nextStatus})`
                : auditNote?.trim() || 'Updated risk & mitigation progress',
              ...(statusChanged ? { previousStatus: r.status ?? 'open', newStatus: nextStatus } : {}),
              ...(impactChanged ? { previousImpact: r.impact, newImpact: nextImpact } : {}),
              ...(mitigationChanged ? { previousMitigation: r.mitigationAr, newMitigation: nextMitigation } : {}),
              ...(ownerChanged ? { previousOwner: r.ownerAr, newOwner: nextOwner } : {}),
              ...(auditNote?.trim() ? { note: auditNote.trim() } : {}),
            };
            return {
              ...r,
              ...fields,
              updatedAt: nowTs,
              auditHistory: [entry, ...(r.auditHistory ?? [])],
            };
          }),
        },
      }));
      return;
    }
    try {
      const res = await authFetch(`/api/erp/risks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const data = await res.json();
        setErpState(data.state);
        setApiErrorBanner(null);
      } else {
        setApiErrorBanner(lang === 'ar' ? 'تعذر تحديث بيانات الخطر.' : 'Failed to update risk entry.');
      }
    } catch {
      setApiErrorBanner(lang === 'ar' ? 'تعذر الاتصال بالخادم لتحديث الخطر.' : 'Network error updating risk.');
    }
  };

  const handleDeleteRisk = async (id: string) => {
    if (isOffline) {
      setErpState((prev) => ({
        ...prev,
        strategy2027: {
          ...prev.strategy2027,
          risks: prev.strategy2027.risks.filter((r) => r.id !== id),
        },
      }));
      return;
    }
    try {
      const res = await authFetch(`/api/erp/risks/${id}`, { method: 'DELETE' });
      if (res.ok) {
        const data = await res.json();
        setErpState(data.state);
        setApiErrorBanner(null);
      } else {
        setApiErrorBanner(lang === 'ar' ? 'تعذر حذف الخطر من قاعدة البيانات.' : 'Failed to delete risk.');
      }
    } catch {
      setApiErrorBanner(lang === 'ar' ? 'تعذر الاتصال بالخادم لحذف الخطر.' : 'Network error deleting risk.');
    }
  };

  const handleReverseJournal = async (journalId: string) => {
    try {
      const res = await authFetch(`/api/erp/journal/${journalId}/reverse`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setErpState(data.state);
      }
    } catch {
      setApiErrorBanner(lang === 'ar' ? 'تعذر عكس القيد المحاسبي.' : 'Failed to reverse journal entry.');
    }
  };

  const handleReconcileBank = async (bankTxnId: string) => {
    try {
      const res = await authFetch(`/api/erp/bank/${bankTxnId}/reconcile`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setErpState(data.state);
      }
    } catch {
      setApiErrorBanner(lang === 'ar' ? 'تعذر تسوية الحركة البنكية.' : 'Failed to reconcile bank transaction.');
    }
  };

  const handleRecordExpense = async (payload: {
    categoryAccountCode: string;
    beneficiary: string;
    amountNet: number;
    applyVat: boolean;
    paymentMethod: 'cash' | 'visa_cib';
  }) => {
    try {
      const res = await authFetch('/api/erp/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        setErpState(data.state);
      }
    } catch {
      setApiErrorBanner(lang === 'ar' ? 'تعذر تسجيل المصروف.' : 'Failed to record expense.');
    }
  };

  const handleResetState = async () => {
    try {
      const res = await authFetch('/api/erp/reset', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setErpState(data.state);
        setOfflineQueue([]);
      }
    } catch {
      setApiErrorBanner(lang === 'ar' ? 'تعذر إعادة ضبط البيانات.' : 'Failed to reset ERP data.');
    }
  };

  const handleStartMigration = async () => {
    if (isOffline) {
      setApiErrorBanner(
        lang === 'ar'
          ? 'يرجى إيقاف وضع Offline أولاً للاتصال بقاعدة بيانات PostgreSQL.'
          : 'Please disable Offline mode first to migrate records to PostgreSQL.'
      );
      return;
    }

    // Include any queued offline POS sales in the local snapshot being migrated
    let snapshotToMigrate: ErpState = erpState;
    if (offlineQueue.length > 0) {
      for (const queued of offlineQueue) {
        snapshotToMigrate = applySaleAutomation(snapshotToMigrate, { ...queued, offlineQueued: false }).nextState;
      }
    }

    setMigrationState({
      open: true,
      status: 'running',
      progress: 8,
      currentStage: 'validating',
      completedStages: [],
      statusLabelAr: 'جاري تجهيز الحالة المحلية والاتصال بقاعدة بيانات PostgreSQL...',
      statusLabelEn: 'Preparing local ERP state and connecting to PostgreSQL...',
      report: null,
      errorMessage: null,
    });

    try {
      const res = await authFetch('/api/erp/migrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: snapshotToMigrate, overwriteExisting: false }),
      });

      if (!res.ok) {
        throw new Error(lang === 'ar' ? 'تعذر بدء عملية الترحيل إلى قاعدة البيانات.' : 'Unable to start migration.');
      }

      const stageOrder: MigrationStageKey[] = [
        'validating',
        'metadata_master',
        'sales_kds',
        'ledger_inventory',
        'verifying',
      ];

      const processLine = (rawLine: string) => {
        const trimmed = rawLine.trim();
        if (!trimmed) return;
        const event = JSON.parse(trimmed);

        if (event.type === 'progress') {
          const idx = stageOrder.indexOf(event.stage);
          const completed = idx > 0 ? stageOrder.slice(0, idx) : [];
          setMigrationState((prev) => ({
            ...prev,
            status: 'running',
            progress: Math.max(prev.progress, Number(event.progress) || 0),
            currentStage: event.stage,
            completedStages: completed,
            statusLabelAr: event.labelAr || prev.statusLabelAr,
            statusLabelEn: event.labelEn || prev.statusLabelEn,
          }));
        } else if (event.type === 'complete') {
          if (event.state) {
            setErpState(event.state);
          }
          if (offlineQueue.length > 0) {
            setOfflineQueue([]);
          }
          setApiErrorBanner(null);
          setMigrationState({
            open: true,
            status: 'completed',
            progress: 100,
            currentStage: null,
            completedStages: stageOrder,
            statusLabelAr: 'تم الترحيل والتحقق من تطابق السجلات في PostgreSQL بنجاح.',
            statusLabelEn: 'Migration completed and verified in PostgreSQL.',
            report: event.report ?? null,
            errorMessage: null,
          });
        } else if (event.type === 'error') {
          setMigrationState((prev) => ({
            ...prev,
            status: 'error',
            errorMessage: event.message || (lang === 'ar' ? 'حدث خطأ أثناء الترحيل.' : 'Migration failed.'),
          }));
        }
      };

      if (res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            processLine(line);
          }
        }
        if (buffer.trim()) {
          processLine(buffer);
        }
      } else {
        const text = await res.text();
        for (const line of text.split('\n')) {
          processLine(line);
        }
      }
    } catch (err: any) {
      setMigrationState((prev) => ({
        ...prev,
        status: 'error',
        errorMessage:
          err?.message ||
          (lang === 'ar' ? 'تعذر إتمام الترحيل إلى قاعدة البيانات.' : 'Failed to complete database migration.'),
      }));
    }
  };

  const breadcrumbs: Record<NavTab, { ar: string; en: string }> = {
    dashboard: { ar: 'برج المنوفية / لوحة CFO (يناير–سبتمبر 2026)', en: 'Menoufia Tower / CFO Dashboard (Jan–Sep 2026)' },
    cfo_review: { ar: 'برج المنوفية / المراجعة التنفيذية الشاملة (10M 2026 + 2027)', en: 'Menoufia Tower / CFO Executive Review (10M 2026 + 2027)' },
    strategy: { ar: 'برج المنوفية / استراتيجية وموازنة 2027', en: 'Menoufia Tower / 2027 Strategy & Budget' },
    roi_simulator: { ar: 'برج المنوفية / محاكي العائد الاستثماري للـ 80% فراغ (ROI & NPV)', en: 'Menoufia Tower / 80% Land Investment ROI Simulator' },
    pos: { ar: 'برج المنوفية / فواتير المبيعات والإيرادات', en: 'Menoufia Tower / Sales & Revenue Billing' },
    inventory: { ar: 'برج المنوفية / المخزون وتكلفة الأصناف (BOM)', en: 'Menoufia Tower / Inventory & Costing (BOM)' },
    purchases: { ar: 'برج المنوفية / المشتريات والموردون والعملاء', en: 'Menoufia Tower / Purchases, Suppliers & Customers' },
    accounting: { ar: 'برج المنوفية / المحاسبة وتسوية CIB', en: 'Menoufia Tower / Ledger & Bank Recon' },
    quality: { ar: 'برج المنوفية / جودة البيانات وتصدير Excel', en: 'Menoufia Tower / Audit & Excel Export' },
  };

  const lowStockCount = computeStockOpportunityAlerts(erpState).length;

  return (
    <>
    <div id="app-shell" className="min-h-screen flex bg-slate-50 text-slate-900">
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        lang={lang}
        role={role}
        onChangeRole={(newRole) => {
          setRole(newRole);
          if (newRole === 'cashier') setActiveTab('pos');
          else if (newRole === 'accountant') setActiveTab('accounting');
          else setActiveTab('dashboard');
        }}
        branches={erpState.branches}
        activeBranchId={erpState.activeBranchId}
        onSelectBranch={handleSelectBranch}
        lowStockCount={lowStockCount}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        <TopBar
          lang={lang}
          onToggleLang={onToggleLang}
          theme={theme}
          onToggleTheme={onToggleTheme}
          breadcrumbAr={breadcrumbs[activeTab].ar}
          breadcrumbEn={breadcrumbs[activeTab].en}
          isOffline={isOffline}
          onToggleOffline={() => setIsOffline((o) => !o)}
          offlineQueueCount={offlineQueue.length}
          onSyncOffline={handleSyncOffline}
          isSyncing={isSyncing}
          onExportExcel={() => exportErpWorkbook(erpState)}
          onPrintPage={() => window.print()}
          onOpenPrintCenter={() => setPrintCenterOpen(true)}
          onStartMigration={handleStartMigration}
          userEmail={user?.email}
          onSignOut={signOutUser}
        />

        {apiErrorBanner && (
          <div className="mx-6 mt-4 px-4 py-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-center justify-between gap-3">
            <span>{apiErrorBanner}</span>
            <button
              onClick={() => setApiErrorBanner(null)}
              className="text-amber-800 font-semibold hover:underline shrink-0"
            >
              {lang === 'ar' ? 'إغلاق' : 'Dismiss'}
            </button>
          </div>
        )}

        <main className="flex-1 p-6 max-w-[1440px] w-full mx-auto">
          {activeTab === 'dashboard' && (
            <CfoDashboard
              state={erpState}
              lang={lang}
              onNavigate={(t) => setActiveTab(t)}
              onQuickReorder={(payload) => {
                setPrefillPurchase(payload);
                setActiveTab('purchases');
              }}
              onNavigateToStocktakeReconcile={(payload) => {
                setInventoryFocus({ subTab: 'stocktake', stocktakeId: payload.stocktakeId ?? null });
                setActiveTab('inventory');
              }}
              onReconcileStocktake={handleReconcileStocktake}
              onCreateRisk={handleCreateRisk}
              onUpdateRisk={handleUpdateRisk}
              onDeleteRisk={handleDeleteRisk}
            />
          )}
          {activeTab === 'cfo_review' && (
            <CfoExecutiveReviewModule
              state={erpState}
              lang={lang}
              onNavigate={(t) => setActiveTab(t)}
              onCreateRisk={handleCreateRisk}
              onUpdateRisk={handleUpdateRisk}
              onDeleteRisk={handleDeleteRisk}
            />
          )}
          {activeTab === 'strategy' && (
            <Strategy2027Module
              state={erpState}
              lang={lang}
              onOpenExecReview={() => setActiveTab('cfo_review')}
            />
          )}
          {activeTab === 'roi_simulator' && (
            <InvestmentRoiSimulatorModule
              state={erpState}
              lang={lang}
              onBackToDashboard={() => setActiveTab('dashboard')}
            />
          )}
          {activeTab === 'pos' && (
            <PosModule
              state={erpState}
              lang={lang}
              isOffline={isOffline}
              onSubmitSale={handleSubmitSale}
              onSimulateFoodics={handleSimulateFoodics}
              onPrintSalesInvoice={(inv) =>
                setActivePrintJob({ keys: [], singleSalesInvoice: inv })
              }
            />
          )}
          {activeTab === 'inventory' && (
            <InventoryMenuModule
              state={erpState}
              lang={lang}
              onRecordWaste={handleRecordWaste}
              onUpdateMenuPrice={handleUpdateMenuPrice}
              onRecordStocktake={handleRecordStocktake}
              onReconcileStocktake={handleReconcileStocktake}
              initialSubTab={inventoryFocus?.subTab}
              focusedStocktakeId={inventoryFocus?.stocktakeId ?? null}
              onClearFocusStocktake={() => setInventoryFocus(null)}
            />
          )}
          {activeTab === 'purchases' && (
            <PurchasesSuppliersModule
              state={erpState}
              lang={lang}
              onCreatePurchase={handleCreatePurchase}
              onSeedDemoPartners={handleSeedDemoPartners}
              onAddSupplier={handleAddSupplier}
              onAddCustomer={handleAddCustomer}
              prefillPurchase={prefillPurchase}
              onClearPrefill={() => setPrefillPurchase(null)}
              onPrintPurchaseInvoice={(po) =>
                setActivePrintJob({ keys: [], singlePurchaseInvoice: po })
              }
            />
          )}
          {activeTab === 'accounting' && (
            <AccountingBankModule
              state={erpState}
              lang={lang}
              onReverseJournal={handleReverseJournal}
              onReconcileBank={handleReconcileBank}
              onRecordExpense={handleRecordExpense}
            />
          )}
          {activeTab === 'quality' && (
            <DataQualityExportModule
              state={erpState}
              lang={lang}
              onExportExcel={() => exportErpWorkbook(erpState)}
              onResetState={handleResetState}
              onStartMigration={handleStartMigration}
              onOpenPrintCenter={() => setPrintCenterOpen(true)}
            />
          )}
        </main>
      </div>

      {/* Visual PostgreSQL Migration Progress Modal */}
      {migrationState.open && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4 no-print"
          role="dialog"
          aria-modal="true"
          aria-labelledby="migration-modal-title"
        >
          <div className="bg-white border border-slate-200 rounded-xl shadow-xl max-w-lg w-full overflow-hidden">
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3 bg-slate-50/70">
              <div className="flex items-center gap-2.5">
                <div
                  className={`p-2 rounded-lg border ${
                    migrationState.status === 'completed'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                      : migrationState.status === 'error'
                      ? 'bg-red-50 border-red-200 text-red-700'
                      : 'bg-teal-50 border-teal-200 text-teal-700'
                  }`}
                >
                  <Database className="w-4 h-4" />
                </div>
                <div>
                  <h2 id="migration-modal-title" className="text-sm font-bold text-slate-900">
                    {lang === 'ar'
                      ? 'تقدم الترحيل إلى قاعدة بيانات PostgreSQL'
                      : 'PostgreSQL Database Migration Progress'}
                  </h2>
                  <p className="text-[11px] text-slate-500">
                    {lang === 'ar'
                      ? 'ترحيل المبيعات والمخزون والقيود المحاسبية مع فحص الاتزان'
                      : 'Transitioning local state to persistent Cloud SQL tables'}
                  </p>
                </div>
              </div>

              {migrationState.status !== 'running' && (
                <button
                  onClick={() => setMigrationState(INITIAL_MIGRATION_STATE)}
                  className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                  aria-label={lang === 'ar' ? 'إغلاق' : 'Close'}
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-4">
              {/* Progress Bar */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-700">
                    {lang === 'ar' ? migrationState.statusLabelAr : migrationState.statusLabelEn}
                  </span>
                  <span className="font-mono-num font-bold text-slate-900" dir="ltr">
                    {migrationState.progress}%
                  </span>
                </div>
                <div className="w-full h-2.5 bg-slate-100 rounded-md overflow-hidden border border-slate-200">
                  <div
                    className={`h-full transition-all duration-300 ${
                      migrationState.status === 'error'
                        ? 'bg-red-600'
                        : migrationState.status === 'completed'
                        ? 'bg-emerald-600'
                        : 'bg-teal-700'
                    }`}
                    style={{ width: `${migrationState.progress}%` }}
                  />
                </div>
              </div>

              {/* Stage Checklist */}
              <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 bg-slate-50/40">
                {MIGRATION_STAGES.map((st) => {
                  const isDone = migrationState.completedStages.includes(st.key);
                  const isActive = migrationState.status === 'running' && migrationState.currentStage === st.key;
                  return (
                    <div key={st.key} className="px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs">
                      <div className="flex items-center gap-2.5">
                        {isDone ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        ) : isActive ? (
                          <Loader2 className="w-4 h-4 text-teal-700 animate-spin shrink-0" />
                        ) : (
                          <Circle className="w-4 h-4 text-slate-300 shrink-0" />
                        )}
                        <span className={isDone || isActive ? 'font-semibold text-slate-900' : 'text-slate-500'}>
                          {lang === 'ar' ? st.labelAr : st.labelEn}
                        </span>
                      </div>
                      <span
                        className={`text-[11px] font-medium shrink-0 ${
                          isDone ? 'text-emerald-700' : isActive ? 'text-teal-700' : 'text-slate-400'
                        }`}
                      >
                        {isDone
                          ? lang === 'ar'
                            ? 'مكتمل'
                            : 'Done'
                          : isActive
                          ? lang === 'ar'
                            ? 'جاري التنفيذ'
                            : 'Running'
                          : lang === 'ar'
                          ? 'في الانتظار'
                          : 'Pending'}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Error Banner */}
              {migrationState.status === 'error' && migrationState.errorMessage && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <span>{migrationState.errorMessage}</span>
                </div>
              )}

              {/* Completion Integrity Summary */}
              {migrationState.status === 'completed' && migrationState.report && (
                <div className="p-3.5 rounded-lg bg-emerald-50/70 border border-emerald-200 space-y-2.5 text-xs">
                  <div className="flex items-center justify-between font-bold text-emerald-900">
                    <span className="flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-emerald-700" />
                      {lang === 'ar' ? 'تقرير المطابقة والتكامل بعد الترحيل' : 'Post-Migration Integrity Report'}
                    </span>
                    <span className="px-2 py-0.5 rounded border border-emerald-300 bg-white text-emerald-800 text-[11px]">
                      {migrationState.report.integrity.trialBalanceBalanced
                        ? lang === 'ar'
                          ? 'متزن 100%'
                          : 'Balanced'
                        : lang === 'ar'
                        ? 'غير متزن'
                        : 'Unbalanced'}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-[11px]">
                    <div className="bg-white border border-emerald-200 rounded p-2">
                      <div className="text-slate-500">{lang === 'ar' ? 'فواتير البيع' : 'Sales Invoices'}</div>
                      <div className="font-mono-num font-bold text-slate-900 mt-0.5" dir="ltr">
                        {migrationState.report.counts.salesInvoices}
                      </div>
                    </div>
                    <div className="bg-white border border-emerald-200 rounded p-2">
                      <div className="text-slate-500">{lang === 'ar' ? 'أصناف المخزون' : 'Ingredients'}</div>
                      <div className="font-mono-num font-bold text-slate-900 mt-0.5" dir="ltr">
                        {migrationState.report.counts.ingredients}
                      </div>
                    </div>
                    <div className="bg-white border border-emerald-200 rounded p-2">
                      <div className="text-slate-500">{lang === 'ar' ? 'القيود اليومية' : 'Ledger Entries'}</div>
                      <div className="font-mono-num font-bold text-slate-900 mt-0.5" dir="ltr">
                        {migrationState.report.counts.journalEntries}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1 text-[11px] text-emerald-900">
                    <span>{lang === 'ar' ? 'إجمالي ميزان المراجعة (مدين = دائن):' : 'Trial Balance (Dr = Cr):'}</span>
                    <span className="font-mono-num font-bold" dir="ltr">
                      {fmtMoney(migrationState.report.integrity.totalDebit)} EGP
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50/70 flex items-center justify-end gap-2">
              {migrationState.status === 'error' && (
                <button
                  onClick={handleStartMigration}
                  className="px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold transition-colors"
                >
                  {lang === 'ar' ? 'إعادة المحاولة' : 'Retry Migration'}
                </button>
              )}
              {migrationState.status !== 'running' && (
                <button
                  onClick={() => setMigrationState(INITIAL_MIGRATION_STATE)}
                  className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${
                    migrationState.status === 'completed'
                      ? 'bg-teal-700 hover:bg-teal-800 text-white'
                      : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {migrationState.status === 'completed'
                    ? lang === 'ar'
                      ? 'تم — إغلاق'
                      : 'Done'
                    : lang === 'ar'
                    ? 'إغلاق'
                    : 'Close'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <PrintCenterModal
        open={printCenterOpen}
        onClose={() => setPrintCenterOpen(false)}
        state={erpState}
        lang={lang}
        onPrintPacket={(keys) => setActivePrintJob({ keys })}
        onPrintSalesInvoice={(inv) => setActivePrintJob({ keys: [], singleSalesInvoice: inv })}
        onPrintPurchaseInvoice={(po) => setActivePrintJob({ keys: [], singlePurchaseInvoice: po })}
      />
    </div>

    <div id="universal-print-root" className="hidden print:block bg-white text-slate-900">
      {activePrintJob && (
        <PrintableFilesPacket
          state={erpState}
          lang={lang}
          selectedKeys={activePrintJob.keys}
          singleSalesInvoice={activePrintJob.singleSalesInvoice}
          singlePurchaseInvoice={activePrintJob.singlePurchaseInvoice}
        />
      )}
    </div>
    </>
  );
}

function AppRouter() {
  const { user, loading, authError, signInWithGoogle } = useAuth();
  const [lang, setLang] = useState<Language>('ar');
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      return localStorage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // ignore storage errors
    }
  }, [theme]);

  const toggleTheme = () => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="text-sm font-medium text-slate-600">
          {lang === 'ar' ? 'جاري التحقق من الجلسة...' : 'Verifying session...'}
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <LoginScreen
        lang={lang}
        onToggleLang={() => setLang((l) => (l === 'ar' ? 'en' : 'ar'))}
        theme={theme}
        onToggleTheme={toggleTheme}
        onSignIn={signInWithGoogle}
        authError={authError}
      />
    );
  }

  return (
    <ErpWorkspace
      lang={lang}
      onToggleLang={() => setLang((l) => (l === 'ar' ? 'en' : 'ar'))}
      theme={theme}
      onToggleTheme={toggleTheme}
    />
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  );
}
