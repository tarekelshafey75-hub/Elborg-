import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Code2,
  CreditCard,
  Minus,
  Plus,
  Printer,
  Search,
  Send,
  Split,
  Trash2,
  Zap,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { ErpState, Language, OrderType, PaymentMethod, SalesInvoice } from '../types/erp';
import { calculateRecipeCost, round2, SaleRequestPayload } from '../utils/erpEngine';
import { fmtMoney, t } from '../utils/formatters';

interface PosModuleProps {
  state: ErpState;
  lang: Language;
  isOffline: boolean;
  onSubmitSale: (payload: SaleRequestPayload) => Promise<SalesInvoice | null>;
  onSimulateFoodics: () => Promise<void>;
  onPrintSalesInvoice?: (inv: SalesInvoice) => void;
}

export const PosModule: React.FC<PosModuleProps> = ({
  state,
  lang,
  isOffline,
  onSubmitSale,
  onSimulateFoodics,
  onPrintSalesInvoice,
}) => {
  const { authFetch } = useAuth();
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [menuSearch, setMenuSearch] = useState<string>('');
  const [cart, setCart] = useState<{ menuItemId: string; qty: number }[]>([]);
  const [orderType, setOrderType] = useState<OrderType>('takeaway');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [discountAmount, setDiscountAmount] = useState<number>(0);
  const [splitCount, setSplitCount] = useState<number>(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastPostedInvoice, setLastPostedInvoice] = useState<SalesInvoice | null>(null);
  const [etaModalJson, setEtaModalJson] = useState<string | null>(null);
  const [etaModalInvNo, setEtaModalInvNo] = useState<string>('');

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of state.menuItems) {
      const cat = lang === 'ar' ? m.categoryAr : m.categoryEn;
      counts.set(cat, (counts.get(cat) || 0) + 1);
    }
    return [
      { id: 'all', count: state.menuItems.length },
      ...Array.from(counts.entries()).map(([id, count]) => ({ id, count })),
    ];
  }, [state.menuItems, lang]);

  const filteredMenu = useMemo(() => {
    const q = menuSearch.trim().toLowerCase();
    return state.menuItems.filter((m) => {
      if (selectedCategory !== 'all' && (lang === 'ar' ? m.categoryAr : m.categoryEn) !== selectedCategory) {
        return false;
      }
      if (!q) return true;
      return (
        m.nameAr.toLowerCase().includes(q) ||
        m.nameEn.toLowerCase().includes(q) ||
        (m.descriptionAr || '').toLowerCase().includes(q) ||
        m.code.toLowerCase().includes(q) ||
        String(m.menuNo || '').includes(q)
      );
    });
  }, [state.menuItems, selectedCategory, menuSearch, lang]);

  const addToCart = (menuItemId: string) => {
    const target = state.menuItems.find((m) => m.id === menuItemId);
    if (!target || target.sellingPriceGross <= 0 || target.priceStatus === 'unspecified') return;
    setCart((prev) => {
      const existing = prev.find((c) => c.menuItemId === menuItemId);
      if (existing) {
        return prev.map((c) => (c.menuItemId === menuItemId ? { ...c, qty: c.qty + 1 } : c));
      }
      return [...prev, { menuItemId, qty: 1 }];
    });
  };

  const updateQty = (menuItemId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((c) => (c.menuItemId === menuItemId ? { ...c, qty: c.qty + delta } : c))
        .filter((c) => c.qty > 0)
    );
  };

  // Keyboard shortcut: keys 1..8 add quick priced items from current view
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const num = Number(e.key);
      const pricedVisible = filteredMenu.filter((m) => m.sellingPriceGross > 0 && m.priceStatus !== 'unspecified');
      if (num >= 1 && num <= 8 && pricedVisible[num - 1]) {
        addToCart(pricedVisible[num - 1].id);
      } else if (e.key === 'Escape') {
        setCart([]);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [filteredMenu, state.menuItems]);

  const cartSummary = useMemo(() => {
    let rawGross = 0;
    let estimatedCogs = 0;
    const enriched = cart.map((c) => {
      const item = state.menuItems.find((m) => m.id === c.menuItemId)!;
      const lineGross = round2(item.sellingPriceGross * c.qty);
      const unitCogs = calculateRecipeCost(item, state.ingredients);
      rawGross += lineGross;
      estimatedCogs += round2(unitCogs * c.qty);
      return { ...c, item, lineGross, unitCogs };
    });

    const effectiveDiscount = Math.min(rawGross, Math.max(0, discountAmount));
    const grossTotal = round2(rawGross - effectiveDiscount);
    const netSales = round2(grossTotal / (1 + state.vatRate));
    const vatAmount = round2(grossTotal - netSales);
    const perSplit = round2(grossTotal / Math.max(1, splitCount));

    return { enriched, rawGross, effectiveDiscount, grossTotal, netSales, vatAmount, estimatedCogs, perSplit };
  }, [cart, state.menuItems, state.ingredients, state.vatRate, discountAmount, splitCount]);

  const handleCheckout = async () => {
    if (cart.length === 0 || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const inv = await onSubmitSale({
        items: cart,
        orderType,
        paymentMethod,
        discountAmount: cartSummary.effectiveDiscount,
        splitCount,
        cashier: 'أحمد سعيد',
      });
      if (inv) {
        setLastPostedInvoice(inv);
      }
      setCart([]);
      setDiscountAmount(0);
      setSplitCount(1);
    } finally {
      setIsSubmitting(false);
    }
  };

  const openEtaPreview = async (invoiceNo: string) => {
    try {
      const res = await authFetch(`/api/erp/integrations/eta/${encodeURIComponent(invoiceNo)}`);
      if (res.ok) {
        const json = await res.json();
        setEtaModalInvNo(invoiceNo);
        setEtaModalJson(JSON.stringify(json, null, 2));
        return;
      }
    } catch {
      // Fallback for offline mode
    }
    const inv = state.salesInvoices.find((s) => s.invoiceNo === invoiceNo);
    setEtaModalInvNo(invoiceNo);
    setEtaModalJson(
      JSON.stringify(
        {
          documentType: 'I',
          documentTypeVersion: '1.0',
          issuerTaxId: state.taxId,
          internalID: invoiceNo,
          netAmount: inv?.netSales ?? 0,
          vat14: inv?.vatAmount ?? 0,
          totalAmount: inv?.grossTotal ?? 0,
        },
        null,
        2
      )
    );
  };

  return (
    <div className="space-y-6">
      {/* Top Action Strip */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-slate-900">
            {t(lang, 'تسجيل فواتير المبيعات والإيرادات (Sales Billing)', 'Sales Invoicing & Revenue Posting')}
          </h1>
          <p className="text-xs text-slate-500">
            {t(
              lang,
              'اختصار لوحة المفاتيح: الأرقام (1–8) لإضافة البنود · فصل 14% ضريبة القيمة المضافة + احتساب تكلفة المبيعات COGS + ترحيل قيد يومية متوازن + ETA',
              'Keyboard shortcuts: Keys 1–8 to add items · Auto 14% VAT Split + BOM COGS Deduction + Balanced Double-Entry Journal + ETA'
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 no-print">
          <button
            type="button"
            onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
          >
            <Printer className="w-3.5 h-3.5 text-slate-600" />
            <span>{t(lang, 'طباعة السجل', 'Print Register')}</span>
          </button>

          <button
            onClick={onSimulateFoodics}
            disabled={isOffline}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold border border-slate-200 bg-slate-50 text-slate-800 hover:bg-slate-100 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            <Zap className="w-3.5 h-3.5 text-teal-700" />
            <span>{t(lang, 'استقبال طلب Foodics API', 'Simulate Foodics API Order')}</span>
          </button>
        </div>
      </div>

      {/* Main Split Workspace: Menu & Tables (7 cols) | Cashier Cart (5 cols) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left/Start: Menu Grid + Table Map */}
        <div className="xl:col-span-7 space-y-5">
          {/* Search & Category Filter Bar */}
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute top-2.5 start-3" />
                <input
                  type="text"
                  value={menuSearch}
                  onChange={(e) => setMenuSearch(e.target.value)}
                  placeholder={t(
                    lang,
                    'ابحث باسم الصنف أو الرقم (1–109) أو التفاصيل...',
                    'Search menu item #, name, or description...'
                  )}
                  className="w-full ps-8 pe-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-teal-600"
                />
              </div>
              <span className="text-[11px] text-slate-500 font-mono-num" dir="ltr">
                {filteredMenu.length} / {state.menuItems.length} {t(lang, 'صنف', 'items')}
              </span>
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto pb-2 border-b border-slate-100">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                    selectedCategory === cat.id
                      ? 'bg-teal-700 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {cat.id === 'all' ? t(lang, 'كل الأصناف', 'All Items') : cat.id}{' '}
                  <span className="opacity-75 font-mono-num">({cat.count})</span>
                </button>
              ))}
            </div>

            {/* 1-Click Menu Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-3 mt-4 max-h-[520px] overflow-y-auto pe-1">
              {filteredMenu.map((item, idx) => {
                const recipeCost = calculateRecipeCost(item, state.ingredients);
                const isUnspecified = item.sellingPriceGross <= 0 || item.priceStatus === 'unspecified';
                const netPrice = !isUnspecified ? round2(item.sellingPriceGross / (1 + state.vatRate)) : 0;
                const fcPct = netPrice > 0 ? round2((recipeCost / netPrice) * 100) : 0;
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={isUnspecified}
                    onClick={() => addToCart(item.id)}
                    className={`text-start p-3.5 rounded-lg border transition-colors flex flex-col justify-between gap-2 ${
                      isUnspecified
                        ? 'border-amber-200 bg-amber-50/40 opacity-80 cursor-not-allowed'
                        : 'border-slate-200 bg-slate-50/50 hover:bg-teal-50/50 hover:border-teal-600 cursor-pointer'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-slate-900 leading-snug flex items-center gap-1.5">
                          <span className="font-mono-num text-[11px] text-slate-400" dir="ltr">
                            #{item.menuNo ?? idx + 1}
                          </span>
                          <span className="truncate">{lang === 'ar' ? item.nameAr : item.nameEn}</span>
                        </div>
                        {item.descriptionAr && item.descriptionAr !== 'غير محدد السعر' && (
                          <div className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">
                            {item.descriptionAr}
                          </div>
                        )}
                      </div>
                      {item.listingType && item.listingType !== 'مطبوع' && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-200/80 text-slate-700 shrink-0">
                          {item.listingType}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between text-xs pt-1">
                      <span className="text-slate-500 truncate">
                        {lang === 'ar' ? item.categoryAr : item.categoryEn}
                        {!isUnspecified && (
                          <>
                            {' '}
                            · FC <span className="font-mono-num" dir="ltr">{fcPct}%</span>
                          </>
                        )}
                      </span>
                      {isUnspecified ? (
                        <span className="text-[11px] font-semibold text-amber-800 shrink-0">
                          {t(lang, 'غير محدد السعر', 'Price TBD')}
                        </span>
                      ) : (
                        <div className="text-end shrink-0">
                          <span className="font-mono-num font-bold text-teal-800" dir="ltr">
                            {fmtMoney(item.sellingPriceGross, 2)} {t(lang, 'ج.م', 'EGP')}
                          </span>
                          {typeof item.basePrice === 'number' && (
                            <span className="block text-[10px] text-slate-400 font-mono-num" dir="ltr">
                              {t(lang, 'أساسي', 'Base')} {fmtMoney(item.basePrice, 0)} + 12%
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right/End: Active Invoice Draft & Posting Panel */}
        <div className="xl:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
            <h2 className="text-sm font-bold text-slate-900">
              {t(lang, 'مسودة فاتورة المبيعات', 'Sales Invoice Draft')}
            </h2>
            {cart.length > 0 && (
              <button
                onClick={() => setCart([])}
                className="text-xs text-red-600 hover:underline flex items-center gap-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {t(lang, 'تفريغ', 'Clear')}
              </button>
            )}
          </div>

          {/* Revenue Channel Selector */}
          <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
            {(
              [
                { id: 'takeaway', ar: 'مبيعات مباشرة / خزينة', en: 'Direct Cash Desk' },
                { id: 'delivery', ar: 'قنوات التوصيل / Foodics', en: 'Delivery & Foodics' },
              ] as const
            ).map((ot) => (
              <button
                key={ot.id}
                onClick={() => setOrderType(ot.id)}
                className={`py-1.5 px-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                  orderType === ot.id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                }`}
              >
                {lang === 'ar' ? ot.ar : ot.en}
              </button>
            ))}
          </div>

          {/* Cart Items */}
          {cartSummary.enriched.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-lg">
              {t(lang, 'اضغط على أي صنف من المنيو أو استخدم الأرقام 1–8 للإضافة الفورية', 'Click any menu item or press keys 1–8 to build order')}
            </div>
          ) : (
            <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
              {cartSummary.enriched.map((line) => (
                <div key={line.menuItemId} className="py-2.5 flex items-center justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 truncate">
                      {lang === 'ar' ? line.item.nameAr : line.item.nameEn}
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono-num" dir="ltr">
                      {fmtMoney(line.item.sellingPriceGross)} × {line.qty} · COGS {fmtMoney(line.unitCogs * line.qty, 1)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => updateQty(line.menuItemId, -1)}
                      className="w-7 h-7 rounded-md border border-slate-200 flex items-center justify-center hover:bg-slate-100"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="font-mono-num font-bold w-5 text-center">{line.qty}</span>
                    <button
                      onClick={() => updateQty(line.menuItemId, 1)}
                      className="w-7 h-7 rounded-md border border-slate-200 flex items-center justify-center hover:bg-slate-100"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                    <span className="font-mono-num font-bold text-slate-900 w-14 text-end" dir="ltr">
                      {fmtMoney(line.lineGross)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Discount & Split Bill Controls */}
          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-200">
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">
                {t(lang, 'خصم الفاتورة (ج.م)', 'Discount (EGP)')}
              </label>
              <input
                type="number"
                min={0}
                value={discountAmount}
                onChange={(e) => setDiscountAmount(Number(e.target.value) || 0)}
                className="w-full px-2.5 py-1.5 text-xs font-mono-num border border-slate-200 rounded-md focus:outline-none focus:border-teal-600"
                dir="ltr"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1 flex items-center gap-1">
                <Split className="w-3 h-3" />
                {t(lang, 'تقسيم الفاتورة (Split)', 'Split Bill (Guests)')}
              </label>
              <input
                type="number"
                min={1}
                max={12}
                value={splitCount}
                onChange={(e) => setSplitCount(Math.max(1, Number(e.target.value) || 1))}
                className="w-full px-2.5 py-1.5 text-xs font-mono-num border border-slate-200 rounded-md focus:outline-none focus:border-teal-600"
                dir="ltr"
              />
            </div>
          </div>

          {/* Payment Method */}
          <div>
            <label className="block text-[11px] text-slate-500 mb-1.5">
              {t(lang, 'طريقة الدفع والحساب المحاسبي المرتبط', 'Payment Method & Linked COA Account')}
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {(
                [
                  { id: 'cash', ar: 'كاش (1101)', en: 'Cash (1101)' },
                  { id: 'visa_cib', ar: 'فيزا CIB (1102)', en: 'VISA CIB (1102)' },
                  { id: 'foodics_credit', ar: 'فودكس (1103)', en: 'Foodics (1103)' },
                ] as const
              ).map((pm) => (
                <button
                  key={pm.id}
                  onClick={() => setPaymentMethod(pm.id)}
                  className={`py-2 px-2 rounded-md border text-[11px] font-medium transition-colors whitespace-nowrap ${
                    paymentMethod === pm.id
                      ? 'border-teal-700 bg-teal-50 text-teal-900 font-semibold'
                      : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {lang === 'ar' ? pm.ar : pm.en}
                </button>
              ))}
            </div>
          </div>

          {/* Financial Breakdown (VAT 14% + Net + COGS) */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 space-y-1.5 text-xs">
            <div className="flex justify-between text-slate-600">
              <span>{t(lang, 'صافي المبيعات (حساب 4101)', 'Net Sales (COA 4101)')}</span>
              <span className="font-mono-num" dir="ltr">{fmtMoney(cartSummary.netSales, 2)}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>{t(lang, 'ضريبة القيمة المضافة 14% (2201)', 'Output VAT 14% (COA 2201)')}</span>
              <span className="font-mono-num" dir="ltr">{fmtMoney(cartSummary.vatAmount, 2)}</span>
            </div>
            <div className="flex justify-between text-slate-500">
              <span>{t(lang, 'التكلفة التقديرية BOM (خصم 1201)', 'Est. BOM COGS (Credit 1201)')}</span>
              <span className="font-mono-num" dir="ltr">{fmtMoney(cartSummary.estimatedCogs, 2)}</span>
            </div>
            <div className="pt-2 border-t border-slate-200 flex justify-between items-baseline font-bold text-slate-900 text-sm">
              <span>{t(lang, 'الإجمالي المستحق', 'Total Payable')}</span>
              <span className="font-mono-num text-teal-800" dir="ltr">
                {fmtMoney(cartSummary.grossTotal, 2)} {t(lang, 'ج.م', 'EGP')}
              </span>
            </div>
            {splitCount > 1 && (
              <div className="flex justify-between text-xs text-teal-700 font-medium">
                <span>{t(lang, `حصة الفرد (${splitCount} أشخاص)`, `Per Guest (${splitCount} way split)`)}</span>
                <span className="font-mono-num" dir="ltr">{fmtMoney(cartSummary.perSplit, 2)} {t(lang, 'ج.م', 'EGP')}</span>
              </div>
            )}
          </div>

          {/* Checkout CTA */}
          <button
            onClick={handleCheckout}
            disabled={cart.length === 0 || isSubmitting}
            className="w-full py-3 px-4 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-40 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors"
          >
            <CreditCard className="w-4 h-4" />
            <span>
              {isOffline
                ? t(lang, 'حفظ الفاتورة Offline للمزامنة لاحقاً', 'Queue Offline Invoice (Sync Later)')
                : t(lang, 'اعتماد وترحيل الفاتورة للخزينة والأستاذ العام', 'Post Invoice · Deduct COGS & Post Ledger')}
            </span>
          </button>

          {lastPostedInvoice && (
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>
                  {t(
                    lang,
                    `تم ترحيل ${lastPostedInvoice.invoiceNo} (${fmtMoney(lastPostedInvoice.grossTotal, 2)} ج.م) وتحديث المخزون ودفتر الأستاذ العام.`,
                    `Posted ${lastPostedInvoice.invoiceNo} (${fmtMoney(lastPostedInvoice.grossTotal, 2)} EGP) across Inventory & General Ledger.`
                  )}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Recent Sales Invoices & ETA e-Invoicing Integration */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900">
            {t(lang, 'سجل فواتير المبيعات والتكامل الضريبي (ETA e-Invoicing)', 'Recent Sales Invoices & ETA e-Invoicing')}
          </h2>
          <span className="text-xs text-slate-500 font-mono-num">{state.salesInvoices.length} {t(lang, 'فاتورة', 'invoices')}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'رقم الفاتورة', 'Invoice #')}</th>
                <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'التاريخ والوقت', 'Date / Time')}</th>
                <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'النوع / الدفع', 'Channel / Payment')}</th>
                <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'صافي المبيعات', 'Net Sales')}</th>
                <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'ضريبة 14%', 'VAT 14%')}</th>
                <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'الإجمالي', 'Gross Total')}</th>
                <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'تكلفة COGS', 'BOM COGS')}</th>
                <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'إجراءات', 'Actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {state.salesInvoices.slice(0, 12).map((inv) => (
                <tr key={inv.id} className="hover:bg-slate-50">
                  <td className="py-2.5 px-4 font-mono-num font-semibold text-slate-900" dir="ltr">{inv.invoiceNo}</td>
                  <td className="py-2.5 px-4 font-mono-num text-slate-600" dir="ltr">{inv.date} · {inv.time}</td>
                  <td className="py-2.5 px-4 text-slate-700">
                    {inv.orderType} · {inv.paymentMethod} {inv.etaStatus === 'queued_offline' ? '· Offline' : ''}
                  </td>
                  <td className="py-2.5 px-4 text-end font-mono-num" dir="ltr">{fmtMoney(inv.netSales, 2)}</td>
                  <td className="py-2.5 px-4 text-end font-mono-num text-slate-600" dir="ltr">{fmtMoney(inv.vatAmount, 2)}</td>
                  <td className="py-2.5 px-4 text-end font-mono-num font-bold text-slate-900" dir="ltr">{fmtMoney(inv.grossTotal, 2)}</td>
                  <td className="py-2.5 px-4 text-end font-mono-num text-amber-700" dir="ltr">{fmtMoney(inv.cogsTotal, 2)}</td>
                  <td className="py-2.5 px-4 text-end">
                    <div className="inline-flex items-center gap-2">
                      <button
                        onClick={() => openEtaPreview(inv.invoiceNo)}
                        className="text-teal-700 hover:underline font-medium inline-flex items-center gap-1"
                      >
                        <Code2 className="w-3.5 h-3.5" />
                        ETA JSON
                      </button>
                      <button
                        type="button"
                        onClick={() => (onPrintSalesInvoice ? onPrintSalesInvoice(inv) : window.print())}
                        title={t(lang, 'طباعة الفاتورة الضريبية (A4)', 'Print Tax Invoice (A4)')}
                        className="text-slate-600 hover:text-slate-900 inline-flex items-center gap-1"
                      >
                        <Printer className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ETA e-Invoicing JSON Modal */}
      {etaModalJson && (
        <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-2xl w-full p-5 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="font-bold text-sm text-slate-900 flex items-center gap-2">
                <Send className="w-4 h-4 text-teal-700" />
                {t(lang, `مستند الفاتورة الإلكترونية المصرية ETA v1.0 — ${etaModalInvNo}`, `Egypt ETA e-Invoice v1.0 Payload — ${etaModalInvNo}`)}
              </div>
              <button
                onClick={() => setEtaModalJson(null)}
                className="px-3 py-1 text-xs font-medium rounded-md border border-slate-200 hover:bg-slate-50"
              >
                {t(lang, 'إغلاق', 'Close')}
              </button>
            </div>
            <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg text-xs font-mono-num overflow-auto max-h-96" dir="ltr">
              {etaModalJson}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};
