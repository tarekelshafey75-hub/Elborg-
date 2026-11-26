import React, { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  Plus,
  Printer,
  Search,
  Sparkles,
  Star,
  Truck,
  UserPlus,
  Users,
} from 'lucide-react';
import { Customer, ErpState, Language, PurchaseInvoice, Supplier } from '../types/erp';
import { PurchaseRequestPayload, round2 } from '../utils/erpEngine';
import { fmtMoney, t } from '../utils/formatters';

interface PurchasesSuppliersModuleProps {
  state: ErpState;
  lang: Language;
  onCreatePurchase: (payload: PurchaseRequestPayload) => Promise<void>;
  onSeedDemoPartners: () => Promise<void>;
  onAddSupplier: (supplier: Partial<Supplier>) => Promise<void>;
  onAddCustomer: (customer: Partial<Customer>) => Promise<void>;
  prefillPurchase?: { ingredientId: string; supplierId: string; qty: number } | null;
  onClearPrefill?: () => void;
  onPrintPurchaseInvoice?: (po: PurchaseInvoice) => void;
}

export const PurchasesSuppliersModule: React.FC<PurchasesSuppliersModuleProps> = ({
  state,
  lang,
  onCreatePurchase,
  onSeedDemoPartners,
  onAddSupplier,
  onAddCustomer,
  prefillPurchase,
  onClearPrefill,
  onPrintPurchaseInvoice,
}) => {
  const [subTab, setSubTab] = useState<'purchases' | 'suppliers' | 'customers'>('purchases');
  const [supplierId, setSupplierId] = useState(state.suppliers[0]?.id || '');
  const [paymentStatus, setPaymentStatus] = useState<'credit' | 'paid_cash' | 'paid_cib'>('credit');
  const [ingredientId, setIngredientId] = useState(state.ingredients[0]?.id || '');
  const [qty, setQty] = useState<number>(50);
  const [unitCostNet, setUnitCostNet] = useState<number>(state.ingredients[0]?.lastPurchasePrice || 25);
  const [submitting, setSubmitting] = useState(false);
  const [seedingDemo, setSeedingDemo] = useState(false);

  // Search & filter states for Suppliers and Customers directories
  const [partnerSearch, setPartnerSearch] = useState('');
  const [customerSegmentFilter, setCustomerSegmentFilter] = useState<'all' | Customer['segment']>('all');

  // Quick Add Supplier form
  const [showAddSupplier, setShowAddSupplier] = useState(false);
  const [newSup, setNewSup] = useState({
    nameAr: '',
    categoryAr: 'خامات ومواد غذائية',
    phone: '',
    city: 'شبين الكوم',
    contactName: '',
    taxNumber: '',
    paymentTermsDays: 15,
  });

  // Quick Add Customer form
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [newCus, setNewCus] = useState<{
    nameAr: string;
    segment: Customer['segment'];
    phone: string;
    city: string;
    taxNumber: string;
    creditLimit: number;
  }>({
    nameAr: '',
    segment: 'vip',
    phone: '',
    city: 'شبين الكوم',
    taxNumber: '',
    creditLimit: 10000,
  });

  useEffect(() => {
    if (!prefillPurchase) return;
    setSubTab('purchases');
    setSupplierId(prefillPurchase.supplierId);
    setIngredientId(prefillPurchase.ingredientId);
    setQty(prefillPurchase.qty);
    const found = state.ingredients.find((i) => i.id === prefillPurchase.ingredientId);
    if (found) setUnitCostNet(found.lastPurchasePrice);
    onClearPrefill?.();
  }, [prefillPurchase, state.ingredients, onClearPrefill]);

  const selectedIng = state.ingredients.find((i) => i.id === ingredientId) || state.ingredients[0];

  const handleIngredientChange = (id: string) => {
    setIngredientId(id);
    const found = state.ingredients.find((i) => i.id === id);
    if (found) setUnitCostNet(found.lastPurchasePrice);
  };

  // Live Weighted Average Cost (WAC) preview
  const newWacPreview = selectedIng
    ? round2(
        (selectedIng.currentQty * selectedIng.weightedAvgCost + qty * unitCostNet) /
          Math.max(1, selectedIng.currentQty + qty)
      )
    : 0;

  const netSubtotal = round2(qty * unitCostNet);
  const vatAmount = round2(netSubtotal * state.vatRate);
  const grandTotal = round2(netSubtotal + vatAmount);

  const handleSubmitPurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (qty <= 0 || unitCostNet <= 0 || submitting) return;
    setSubmitting(true);
    try {
      await onCreatePurchase({
        supplierId,
        paymentStatus,
        lines: [{ ingredientId, qty, unitCostNet }],
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSeedDemo = async () => {
    setSeedingDemo(true);
    try {
      await onSeedDemoPartners();
    } finally {
      setSeedingDemo(false);
    }
  };

  const handleCreateSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSup.nameAr.trim()) return;
    await onAddSupplier(newSup);
    setNewSup({
      nameAr: '',
      categoryAr: 'خامات ومواد غذائية',
      phone: '',
      city: 'شبين الكوم',
      contactName: '',
      taxNumber: '',
      paymentTermsDays: 15,
    });
    setShowAddSupplier(false);
  };

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCus.nameAr.trim()) return;
    await onAddCustomer(newCus);
    setNewCus({
      nameAr: '',
      segment: 'vip',
      phone: '',
      city: 'شبين الكوم',
      taxNumber: '',
      creditLimit: 10000,
    });
    setShowAddCustomer(false);
  };

  const customers = state.customers ?? [];

  const filteredSuppliers = useMemo(() => {
    const q = partnerSearch.trim().toLowerCase();
    if (!q) return state.suppliers;
    return state.suppliers.filter(
      (s) =>
        s.nameAr.toLowerCase().includes(q) ||
        s.nameEn.toLowerCase().includes(q) ||
        (s.categoryAr ?? '').toLowerCase().includes(q) ||
        s.phone.includes(q)
    );
  }, [state.suppliers, partnerSearch]);

  const filteredCustomers = useMemo(() => {
    const q = partnerSearch.trim().toLowerCase();
    return customers.filter((c) => {
      if (customerSegmentFilter !== 'all' && c.segment !== customerSegmentFilter) return false;
      if (!q) return true;
      return (
        c.nameAr.toLowerCase().includes(q) ||
        c.nameEn.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        c.phone.includes(q) ||
        c.city.toLowerCase().includes(q)
      );
    });
  }, [customers, partnerSearch, customerSegmentFilter]);

  const customerKpis = useMemo(() => {
    const totalSpent = customers.reduce((sum, c) => sum + c.totalSpent, 0);
    const totalReceivables = customers.reduce((sum, c) => sum + c.currentBalance, 0);
    const totalPoints = customers.reduce((sum, c) => sum + c.loyaltyPoints, 0);
    const vipOrCorp = customers.filter((c) => c.segment === 'vip' || c.segment === 'corporate').length;
    return { totalSpent, totalReceivables, totalPoints, vipOrCorp };
  }, [customers]);

  const segmentLabel = (seg: Customer['segment']) => {
    switch (seg) {
      case 'vip':
        return t(lang, 'عميل VIP', 'VIP Guest');
      case 'corporate':
        return t(lang, 'شركات ومؤسسات', 'Corporate');
      case 'delivery_partner':
        return t(lang, 'منصة توصيل', 'Delivery Partner');
      default:
        return t(lang, 'عملاء أفراد وعائلات', 'Individual & Family');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header + Sub-Tab Navigation */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Truck className="w-5 h-5 text-teal-700" />
            {t(
              lang,
              'المشتريات والموردون والعملاء (WAC & Partners CRM)',
              'Purchases, Suppliers & Customers CRM'
            )}
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {t(
              lang,
              'إدارة فواتير الموردين وتكلفة المخزون المرجحة + دليل الموردين والعملاء ببيانات تشغيلية متكاملة',
              'Supplier invoices & WAC costing + complete Suppliers and Customers directories'
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 no-print">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 text-xs font-semibold transition-colors whitespace-nowrap"
          >
            <Printer className="w-3.5 h-3.5 text-slate-600" />
            <span>{t(lang, 'طباعة', 'Print')}</span>
          </button>

          <button
            type="button"
            onClick={handleSeedDemo}
            disabled={seedingDemo}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-teal-200 bg-teal-50 text-teal-800 hover:bg-teal-100 text-xs font-semibold transition-colors disabled:opacity-50"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {seedingDemo
              ? t(lang, 'جاري التحميل...', 'Loading...')
              : t(lang, 'تعبئة بيانات وهمية (الموردون والعملاء)', 'Load Demo Suppliers & Customers')}
          </button>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(
              [
                { id: 'purchases', ar: 'فواتير الشراء', en: 'Purchases & AP' },
                { id: 'suppliers', ar: `الموردون (${state.suppliers.length})`, en: `Suppliers (${state.suppliers.length})` },
                { id: 'customers', ar: `العملاء (${customers.length})`, en: `Customers (${customers.length})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setSubTab(tab.id)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                  subTab === tab.id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {lang === 'ar' ? tab.ar : tab.en}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* TAB 1: PURCHASES & AP AGING */}
      {subTab === 'purchases' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* New Purchase Invoice Form */}
          <form onSubmit={handleSubmitPurchase} className="xl:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <h2 className="text-sm font-bold text-slate-900 border-b border-slate-200 pb-3">
              {t(lang, 'إدخال فاتورة شراء مورد جديدة', 'New Supplier Purchase Invoice')}
            </h2>

            <div>
              <label className="block text-xs text-slate-600 mb-1">{t(lang, 'المورد', 'Supplier')}</label>
              <select
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
              >
                {state.suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {lang === 'ar' ? s.nameAr : s.nameEn}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-slate-600 mb-1">{t(lang, 'الصنف الخام', 'Raw Ingredient')}</label>
              <select
                value={ingredientId}
                onChange={(e) => handleIngredientChange(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
              >
                {state.ingredients.map((i) => (
                  <option key={i.id} value={i.id}>
                    {lang === 'ar' ? i.nameAr : i.nameEn} ({t(lang, 'الحالي:', 'Current:')} {i.currentQty} {i.unit})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-600 mb-1">
                  {t(lang, `الكمية (${selectedIng?.unit})`, `Quantity (${selectedIng?.unit})`)}
                </label>
                <input
                  type="number"
                  min={1}
                  step="0.5"
                  value={qty}
                  onChange={(e) => setQty(Number(e.target.value) || 0)}
                  className="w-full px-3 py-2 text-xs font-mono-num border border-slate-200 rounded-lg"
                  dir="ltr"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">
                  {t(lang, 'تكلفة الوحدة قبل الضريبة', 'Net Unit Cost (EGP)')}
                </label>
                <input
                  type="number"
                  min={0.5}
                  step="0.5"
                  value={unitCostNet}
                  onChange={(e) => setUnitCostNet(Number(e.target.value) || 0)}
                  className="w-full px-3 py-2 text-xs font-mono-num border border-slate-200 rounded-lg"
                  dir="ltr"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-600 mb-1">{t(lang, 'حالة السداد', 'Payment Terms')}</label>
              <select
                value={paymentStatus}
                onChange={(e) => setPaymentStatus(e.target.value as any)}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
              >
                <option value="credit">{t(lang, 'آجل على المورد (حساب 2101)', 'Credit — Accounts Payable (2101)')}</option>
                <option value="paid_cib">{t(lang, 'سداد فوري من بنك CIB (1102)', 'Paid via CIB Bank (1102)')}</option>
                <option value="paid_cash">{t(lang, 'سداد نقدي من الخزينة (1101)', 'Paid Cash (1101)')}</option>
              </select>
            </div>

            {/* Live WAC & VAT Preview */}
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 space-y-1.5 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>{t(lang, 'المتوسط المرجح WAC (الحالي ← الجديد)', 'WAC Update (Current → New)')}</span>
                <span className="font-mono-num font-bold text-teal-800" dir="ltr">
                  {fmtMoney(selectedIng?.weightedAvgCost || 0, 2)} → {fmtMoney(newWacPreview, 2)}
                </span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>{t(lang, 'إجمالي قبل الضريبة (1201)', 'Net Purchase (Dr 1201)')}</span>
                <span className="font-mono-num" dir="ltr">{fmtMoney(netSubtotal, 2)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>{t(lang, 'ضريبة مدخلات 14% (1105)', 'Input VAT 14% (Dr 1105)')}</span>
                <span className="font-mono-num" dir="ltr">{fmtMoney(vatAmount, 2)}</span>
              </div>
              <div className="pt-2 border-t border-slate-200 flex justify-between font-bold text-slate-900">
                <span>{t(lang, 'إجمالي الفاتورة', 'Grand Total')}</span>
                <span className="font-mono-num" dir="ltr">{fmtMoney(grandTotal, 2)} {t(lang, 'ج.م', 'EGP')}</span>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 px-4 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" />
              {t(lang, 'اعتماد فاتورة الشراء وتحديث المخزون والأستاذ', 'Post Purchase · Update WAC & Ledger')}
            </button>
          </form>

          {/* Right: Suppliers AP Aging & Recent POs */}
          <div className="xl:col-span-7 space-y-6">
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-900">
                  {t(lang, 'أعمار ديون الموردين (AP Aging Report)', 'Suppliers AP Aging Report')}
                </h2>
                <button
                  type="button"
                  onClick={() => setSubTab('suppliers')}
                  className="text-xs font-semibold text-teal-700 hover:underline"
                >
                  {t(lang, 'عرض دليل الموردين ←', 'View Suppliers Directory →')}
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                      <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'المورد', 'Supplier')}</th>
                      <th className="py-2.5 px-4 text-end font-semibold">0–30d</th>
                      <th className="py-2.5 px-4 text-end font-semibold">31–60d</th>
                      <th className="py-2.5 px-4 text-end font-semibold">61–90d+</th>
                      <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'الإجمالي المستحق', 'Total AP')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {state.suppliers.map((sup) => {
                      const tot = sup.aging0_30 + sup.aging31_60 + sup.aging61_90Plus;
                      return (
                        <tr key={sup.id} className="hover:bg-slate-50">
                          <td className="py-2.5 px-4">
                            <div className="font-semibold text-slate-900">{lang === 'ar' ? sup.nameAr : sup.nameEn}</div>
                            <div className="text-[11px] text-slate-500 font-mono-num" dir="ltr">
                              Tax: {sup.taxNumber} · {sup.paymentTermsDays}d terms
                            </div>
                          </td>
                          <td className="py-2.5 px-4 text-end font-mono-num" dir="ltr">{fmtMoney(sup.aging0_30)}</td>
                          <td className="py-2.5 px-4 text-end font-mono-num text-amber-700" dir="ltr">{fmtMoney(sup.aging31_60)}</td>
                          <td className="py-2.5 px-4 text-end font-mono-num text-red-600" dir="ltr">{fmtMoney(sup.aging61_90Plus)}</td>
                          <td className="py-2.5 px-4 text-end font-mono-num font-bold text-slate-900" dir="ltr">{fmtMoney(tot)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200">
                <h2 className="text-sm font-bold text-slate-900">{t(lang, 'سجل فواتير المشتريات المعتمدة', 'Purchase Invoices Register')}</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                      <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'رقم الفاتورة', 'PO #')}</th>
                      <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'المورد', 'Supplier')}</th>
                      <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'الصافي', 'Net')}</th>
                      <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'ضريبة 14%', 'VAT')}</th>
                      <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'الإجمالي', 'Grand Total')}</th>
                      <th className="py-2.5 px-4 text-end font-semibold no-print">{t(lang, 'طباعة', 'Print')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {state.purchaseInvoices.map((po) => (
                      <tr key={po.id} className="hover:bg-slate-50">
                        <td className="py-2.5 px-4 font-mono-num font-semibold" dir="ltr">{po.purchaseNo}</td>
                        <td className="py-2.5 px-4 text-slate-800">{po.supplierNameAr}</td>
                        <td className="py-2.5 px-4 text-end font-mono-num" dir="ltr">{fmtMoney(po.totalBeforeTax, 2)}</td>
                        <td className="py-2.5 px-4 text-end font-mono-num text-slate-600" dir="ltr">{fmtMoney(po.vatAmount, 2)}</td>
                        <td className="py-2.5 px-4 text-end font-mono-num font-bold text-slate-900" dir="ltr">{fmtMoney(po.grandTotal, 2)}</td>
                        <td className="py-2.5 px-4 text-end no-print">
                          <button
                            type="button"
                            onClick={() => (onPrintPurchaseInvoice ? onPrintPurchaseInvoice(po) : window.print())}
                            title={t(lang, 'طباعة مستند فاتورة المشتريات', 'Print Purchase Invoice Voucher')}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 hover:bg-slate-100 text-slate-700"
                          >
                            <Printer className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: SUPPLIERS DIRECTORY */}
      {subTab === 'suppliers' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="relative flex-1 min-w-[220px] max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute top-2.5 start-3" />
              <input
                type="text"
                value={partnerSearch}
                onChange={(e) => setPartnerSearch(e.target.value)}
                placeholder={t(lang, 'بحث باسم المورد أو النشاط أو الهاتف...', 'Search supplier name, category or phone...')}
                className="w-full ps-9 pe-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
              />
            </div>
            <button
              type="button"
              onClick={() => setShowAddSupplier((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold"
            >
              <Plus className="w-3.5 h-3.5" />
              {t(lang, 'إضافة مورد جديد', 'Add Supplier')}
            </button>
          </div>

          {showAddSupplier && (
            <form onSubmit={handleCreateSupplier} className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input
                type="text"
                required
                value={newSup.nameAr}
                onChange={(e) => setNewSup({ ...newSup, nameAr: e.target.value })}
                placeholder={t(lang, 'اسم المورد *', 'Supplier Name *')}
                className="px-3 py-2 text-xs border border-slate-200 rounded-lg"
              />
              <input
                type="text"
                value={newSup.categoryAr}
                onChange={(e) => setNewSup({ ...newSup, categoryAr: e.target.value })}
                placeholder={t(lang, 'فئة التوريد', 'Category')}
                className="px-3 py-2 text-xs border border-slate-200 rounded-lg"
              />
              <input
                type="text"
                value={newSup.contactName}
                onChange={(e) => setNewSup({ ...newSup, contactName: e.target.value })}
                placeholder={t(lang, 'اسم المسؤول', 'Contact Person')}
                className="px-3 py-2 text-xs border border-slate-200 rounded-lg"
              />
              <input
                type="text"
                value={newSup.phone}
                onChange={(e) => setNewSup({ ...newSup, phone: e.target.value })}
                placeholder={t(lang, 'رقم الهاتف', 'Phone')}
                className="px-3 py-2 text-xs font-mono-num border border-slate-200 rounded-lg"
                dir="ltr"
              />
              <input
                type="text"
                value={newSup.taxNumber}
                onChange={(e) => setNewSup({ ...newSup, taxNumber: e.target.value })}
                placeholder={t(lang, 'الرقم الضريبي', 'Tax ID')}
                className="px-3 py-2 text-xs font-mono-num border border-slate-200 rounded-lg"
                dir="ltr"
              />
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={newSup.paymentTermsDays}
                  onChange={(e) => setNewSup({ ...newSup, paymentTermsDays: Number(e.target.value) || 15 })}
                  placeholder={t(lang, 'مدة السداد (يوم)', 'Terms (days)')}
                  className="w-28 px-3 py-2 text-xs font-mono-num border border-slate-200 rounded-lg"
                  dir="ltr"
                />
                <button
                  type="submit"
                  className="flex-1 py-2 px-3 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold"
                >
                  {t(lang, 'حفظ المورد', 'Save Supplier')}
                </button>
              </div>
            </form>
          )}

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'المورد والنشاط', 'Supplier & Category')}</th>
                    <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'المسؤول / المدينة', 'Contact / City')}</th>
                    <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'الهاتف والبطاقة الضريبية', 'Phone & Tax ID')}</th>
                    <th className="py-2.5 px-4 text-center font-semibold">{t(lang, 'التقييم وشروط الدفع', 'Rating & Terms')}</th>
                    <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'الرصيد المستحق', 'AP Balance')}</th>
                    <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'إجراء', 'Action')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredSuppliers.map((sup) => {
                    const totAp = sup.aging0_30 + sup.aging31_60 + sup.aging61_90Plus;
                    return (
                      <tr key={sup.id} className="hover:bg-slate-50">
                        <td className="py-3 px-4">
                          <div className="font-bold text-slate-900 flex items-center gap-1.5">
                            <Building2 className="w-3.5 h-3.5 text-teal-700 shrink-0" />
                            <span>{lang === 'ar' ? sup.nameAr : sup.nameEn}</span>
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            {lang === 'ar' ? sup.categoryAr || 'توريدات مطاعم' : sup.categoryEn || 'F&B Supply'}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="text-slate-800 font-medium">{sup.contactName || '—'}</div>
                          <div className="text-[11px] text-slate-500">{sup.city || t(lang, 'المنوفية', 'Menoufia')}</div>
                        </td>
                        <td className="py-3 px-4 font-mono-num" dir="ltr">
                          <div className="text-slate-800">{sup.phone}</div>
                          <div className="text-[11px] text-slate-500">Tax: {sup.taxNumber}</div>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <div className="inline-flex items-center gap-1 font-mono-num font-bold text-amber-700" dir="ltr">
                            <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
                            {sup.rating.toFixed(1)}
                          </div>
                          <div className="text-[11px] text-slate-500 font-mono-num" dir="ltr">
                            Net {sup.paymentTermsDays}d
                          </div>
                        </td>
                        <td className="py-3 px-4 text-end font-mono-num font-bold text-slate-900" dir="ltr">
                          {fmtMoney(totAp)} EGP
                        </td>
                        <td className="py-3 px-4 text-end">
                          <button
                            type="button"
                            onClick={() => {
                              setSupplierId(sup.id);
                              setSubTab('purchases');
                            }}
                            className="px-2.5 py-1 rounded border border-slate-200 bg-white hover:bg-slate-50 text-[11px] font-semibold text-teal-700"
                          >
                            {t(lang, 'فاتورة شراء', 'New PO')}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: CUSTOMERS & LOYALTY CRM */}
      {subTab === 'customers' && (
        <div className="space-y-5">
          {/* Customer KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs text-slate-500">{t(lang, 'إجمالي العملاء المسجلين', 'Registered Customers')}</div>
              <div className="text-2xl font-bold font-mono-num text-slate-900 mt-1" dir="ltr">
                {customers.length}
              </div>
              <div className="text-[11px] text-teal-700 mt-0.5">
                {customerKpis.vipOrCorp} {t(lang, 'عميل VIP وشركات', 'VIP & Corporate')}
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs text-slate-500">{t(lang, 'إجمالي مشتريات العملاء', 'Total Customer Spend')}</div>
              <div className="text-2xl font-bold font-mono-num text-slate-900 mt-1" dir="ltr">
                {fmtMoney(customerKpis.totalSpent)}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">{t(lang, 'جنيه مصري', 'EGP YTD')}</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs text-slate-500">{t(lang, 'أرصدة الآجل لدى العملاء', 'Customer Credit Balances')}</div>
              <div className="text-2xl font-bold font-mono-num text-amber-700 mt-1" dir="ltr">
                {fmtMoney(customerKpis.totalReceivables)}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">{t(lang, 'تحت التحصيل (شركات وتوصيل)', 'Corporate & Delivery AR')}</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs text-slate-500">{t(lang, 'نقاط الولاء النشطة', 'Active Loyalty Points')}</div>
              <div className="text-2xl font-bold font-mono-num text-emerald-700 mt-1" dir="ltr">
                {fmtMoney(customerKpis.totalPoints)}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">{t(lang, 'برنامج ولاء مطعم البرج', 'Al-Borg Loyalty Tier')}</div>
            </div>
          </div>

          {/* Search & Segment Filter + Add Customer */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 flex-1">
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search className="w-4 h-4 text-slate-400 absolute top-2.5 start-3" />
                <input
                  type="text"
                  value={partnerSearch}
                  onChange={(e) => setPartnerSearch(e.target.value)}
                  placeholder={t(lang, 'بحث بالاسم أو الكود أو الموبايل...', 'Search customer, code, phone...')}
                  className="w-full ps-9 pe-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
                />
              </div>
              <select
                value={customerSegmentFilter}
                onChange={(e) => setCustomerSegmentFilter(e.target.value as any)}
                className="px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
              >
                <option value="all">{t(lang, 'كل الفئات', 'All Segments')}</option>
                <option value="vip">{t(lang, 'عملاء VIP', 'VIP')}</option>
                <option value="corporate">{t(lang, 'شركات ومؤسسات', 'Corporate')}</option>
                <option value="family">{t(lang, 'عملاء أفراد وعائلات', 'Individual & Family')}</option>
                <option value="delivery_partner">{t(lang, 'منصات التوصيل', 'Delivery Partners')}</option>
              </select>
            </div>
            <button
              type="button"
              onClick={() => setShowAddCustomer((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold"
            >
              <UserPlus className="w-3.5 h-3.5" />
              {t(lang, 'إضافة عميل جديد', 'Add Customer')}
            </button>
          </div>

          {showAddCustomer && (
            <form onSubmit={handleCreateCustomer} className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input
                type="text"
                required
                value={newCus.nameAr}
                onChange={(e) => setNewCus({ ...newCus, nameAr: e.target.value })}
                placeholder={t(lang, 'اسم العميل أو الشركة *', 'Customer / Company Name *')}
                className="px-3 py-2 text-xs border border-slate-200 rounded-lg"
              />
              <select
                value={newCus.segment}
                onChange={(e) => setNewCus({ ...newCus, segment: e.target.value as Customer['segment'] })}
                className="px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
              >
                <option value="vip">{t(lang, 'عميل VIP', 'VIP Guest')}</option>
                <option value="corporate">{t(lang, 'شركات ومؤسسات', 'Corporate')}</option>
                <option value="family">{t(lang, 'عملاء أفراد وعائلات', 'Individual & Family')}</option>
                <option value="delivery_partner">{t(lang, 'منصة توصيل', 'Delivery Partner')}</option>
              </select>
              <input
                type="text"
                value={newCus.phone}
                onChange={(e) => setNewCus({ ...newCus, phone: e.target.value })}
                placeholder={t(lang, 'رقم الموبايل', 'Phone')}
                className="px-3 py-2 text-xs font-mono-num border border-slate-200 rounded-lg"
                dir="ltr"
              />
              <input
                type="text"
                value={newCus.city}
                onChange={(e) => setNewCus({ ...newCus, city: e.target.value })}
                placeholder={t(lang, 'المدينة / العنوان', 'City / Area')}
                className="px-3 py-2 text-xs border border-slate-200 rounded-lg"
              />
              <input
                type="text"
                value={newCus.taxNumber}
                onChange={(e) => setNewCus({ ...newCus, taxNumber: e.target.value })}
                placeholder={t(lang, 'الرقم الضريبي (للشركات)', 'Tax ID (Optional)')}
                className="px-3 py-2 text-xs font-mono-num border border-slate-200 rounded-lg"
                dir="ltr"
              />
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={newCus.creditLimit}
                  onChange={(e) => setNewCus({ ...newCus, creditLimit: Number(e.target.value) || 0 })}
                  placeholder={t(lang, 'حد الائتمان', 'Credit Limit')}
                  className="w-28 px-3 py-2 text-xs font-mono-num border border-slate-200 rounded-lg"
                  dir="ltr"
                />
                <button
                  type="submit"
                  className="flex-1 py-2 px-3 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold"
                >
                  {t(lang, 'حفظ العميل', 'Save Customer')}
                </button>
              </div>
            </form>
          )}

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Users className="w-4 h-4 text-teal-700" />
                {t(lang, 'دليل العملاء والشركات وبرامج الولاء', 'Customers, Corporate Accounts & Loyalty Directory')}
              </h2>
              <span className="text-xs text-slate-500 font-mono-num" dir="ltr">
                {filteredCustomers.length} / {customers.length}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'العميل / الكود', 'Customer & Code')}</th>
                    <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'التصنيف', 'Segment')}</th>
                    <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'التواصل والمنطقة', 'Contact & Area')}</th>
                    <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'الطلبات / المشتريات', 'Orders / Spend')}</th>
                    <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'نقاط الولاء', 'Loyalty')}</th>
                    <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'الرصيد الآجل', 'Credit Balance')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredCustomers.map((cus) => (
                    <tr key={cus.id} className="hover:bg-slate-50">
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900">{lang === 'ar' ? cus.nameAr : cus.nameEn}</div>
                        <div className="text-[11px] text-slate-500 font-mono-num" dir="ltr">
                          {cus.code}
                          {cus.taxNumber ? ` · Tax: ${cus.taxNumber}` : ''}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-block px-2 py-0.5 rounded border text-[11px] font-semibold ${
                            cus.segment === 'vip'
                              ? 'bg-amber-50 border-amber-200 text-amber-800'
                              : cus.segment === 'corporate'
                              ? 'bg-teal-50 border-teal-200 text-teal-800'
                              : cus.segment === 'delivery_partner'
                              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                              : 'bg-slate-50 border-slate-200 text-slate-700'
                          }`}
                        >
                          {segmentLabel(cus.segment)}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-mono-num text-slate-800" dir="ltr">{cus.phone}</div>
                        <div className="text-[11px] text-slate-500">{cus.city}</div>
                      </td>
                      <td className="py-3 px-4 text-end font-mono-num" dir="ltr">
                        <div className="font-bold text-slate-900">{fmtMoney(cus.totalSpent)} EGP</div>
                        <div className="text-[11px] text-slate-500">
                          {cus.totalOrders} orders · {cus.lastOrderDate}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-end font-mono-num font-semibold text-emerald-700" dir="ltr">
                        {fmtMoney(cus.loyaltyPoints)} pts
                      </td>
                      <td className="py-3 px-4 text-end font-mono-num" dir="ltr">
                        <div className={`font-bold ${cus.currentBalance > 0 ? 'text-amber-700' : 'text-slate-700'}`}>
                          {fmtMoney(cus.currentBalance)} EGP
                        </div>
                        <div className="text-[11px] text-slate-500">Limit {fmtMoney(cus.creditLimit)}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
