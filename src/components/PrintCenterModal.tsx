import React, { useMemo, useState } from 'react';
import {
  CheckSquare,
  Eye,
  FileText,
  Layers,
  Printer,
  Square,
  X,
} from 'lucide-react';
import type { ErpState, Language, PurchaseInvoice, SalesInvoice } from '../types/erp';
import { fmtMoney, t } from '../utils/formatters';
import {
  PRINT_FILES_CATALOG,
  PrintableFilesPacket,
  PrintFileKey,
} from './PrintableFilesPacket';

interface PrintCenterModalProps {
  open: boolean;
  onClose: () => void;
  state: ErpState;
  lang: Language;
  onPrintPacket: (keys: PrintFileKey[]) => void;
  onPrintSalesInvoice: (inv: SalesInvoice) => void;
  onPrintPurchaseInvoice: (po: PurchaseInvoice) => void;
}

export const PrintCenterModal: React.FC<PrintCenterModalProps> = ({
  open,
  onClose,
  state,
  lang,
  onPrintPacket,
  onPrintSalesInvoice,
  onPrintPurchaseInvoice,
}) => {
  const companyKeys = useMemo(
    () => PRINT_FILES_CATALOG.filter((c) => c.group === 'company').map((c) => c.key),
    []
  );
  const allKeys = useMemo(() => PRINT_FILES_CATALOG.map((c) => c.key), []);

  const [selectedKeys, setSelectedKeys] = useState<PrintFileKey[]>(companyKeys);
  const [showPreview, setShowPreview] = useState(false);
  const [selectedSaleId, setSelectedSaleId] = useState<string>(state.salesInvoices[0]?.id ?? '');
  const [selectedPurchaseId, setSelectedPurchaseId] = useState<string>(state.purchaseInvoices[0]?.id ?? '');

  if (!open) return null;

  const countsMap: Record<PrintFileKey, number> = {
    cfo_board_pack: 4,
    cfo_pnl: state.monthlyActuals2026.length,
    sales_invoices: state.salesInvoices.length,
    purchase_invoices: state.purchaseInvoices.length,
    suppliers_aging: state.suppliers.length,
    customers: state.customers.length,
    representatives: (state.representatives ?? []).length,
    inventory: state.ingredients.length,
    menu_bom: state.menuItems.length,
    stocktake: (state.stocktakeEntries ?? []).length,
    waste_expenses: state.wasteEntries.length + state.expenses.length,
    bank_statement: state.bankTransactions.length,
    accounting_vat: state.accounts.length + state.journalEntries.length,
    strategy_risks: (state.strategy2027.risks ?? []).length + state.auditLogs.length,
    household: (state.householdEntries ?? []).length,
  };

  const toggleKey = (key: PrintFileKey) => {
    setSelectedKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const selectedSale =
    state.salesInvoices.find((i) => i.id === selectedSaleId) ?? state.salesInvoices[0] ?? null;
  const selectedPurchase =
    state.purchaseInvoices.find((p) => p.id === selectedPurchaseId) ?? state.purchaseInvoices[0] ?? null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4 no-print"
      role="dialog"
      aria-modal="true"
      aria-labelledby="print-center-title"
    >
      <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl max-w-5xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4 bg-slate-50/70 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 rounded-xl bg-teal-700 text-white shrink-0">
              <Printer className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 id="print-center-title" className="text-base font-bold text-slate-900 truncate">
                {t(
                  lang,
                  'مركز الطباعة الشامل لكل ملفات السيستم (A4 / PDF)',
                  'Universal ERP Print Center — All Files & Registers (A4 / PDF)'
                )}
              </h2>
              <p className="text-xs text-slate-500 truncate">
                {t(
                  lang,
                  'اطبع ملفاً محدداً أو حزمة السيستم الكاملة (14 ملف وسجل) أو الفواتير المنفردة بتنسيق محاسبي رسمي',
                  'Print any single register, the full 14-file corporate ERP packet, or individual tax/purchase vouchers'
                )}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-200/70 transition-colors shrink-0"
            aria-label={t(lang, 'إغلاق', 'Close')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Controls Bar */}
        <div className="px-6 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-white shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedKeys(allKeys)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-800 whitespace-nowrap"
            >
              <CheckSquare className="w-3.5 h-3.5 text-teal-700" />
              {t(lang, `تحديد الكل (${allKeys.length})`, `Select All (${allKeys.length})`)}
            </button>
            <button
              type="button"
              onClick={() => setSelectedKeys(companyKeys)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-teal-200 bg-teal-50 hover:bg-teal-100 text-xs font-semibold text-teal-800 whitespace-nowrap"
            >
              <Layers className="w-3.5 h-3.5" />
              {t(lang, `ملفات الشركة فقط (${companyKeys.length})`, `Company Only (${companyKeys.length})`)}
            </button>
            <button
              type="button"
              onClick={() => setSelectedKeys(['cfo_board_pack'])}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-900 bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-white whitespace-nowrap cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              {t(lang, 'حزمة CFO الجاهزة (A4)', 'CFO Board Pack (A4)')}
            </button>
            <button
              type="button"
              onClick={() => setSelectedKeys([])}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-600 whitespace-nowrap"
            >
              <Square className="w-3.5 h-3.5" />
              {t(lang, 'إلغاء التحديد', 'Clear')}
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 font-mono-num" dir="ltr">
              {selectedKeys.length} / {allKeys.length} {t(lang, 'محدد', 'selected')}
            </span>
            <button
              type="button"
              onClick={() => setShowPreview((p) => !p)}
              disabled={selectedKeys.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50 text-xs font-semibold text-slate-800 whitespace-nowrap"
            >
              <Eye className="w-3.5 h-3.5 text-teal-700" />
              {showPreview
                ? t(lang, 'العودة لقائمة الملفات', 'Back to Files List')
                : t(lang, 'معاينة A4 قبل الطباعة', 'Preview A4 Layout')}
            </button>
          </div>
        </div>

        {/* Body: Checklist OR Inline Preview */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {showPreview ? (
            <div className="border border-slate-300 rounded-xl shadow-sm bg-white overflow-hidden">
              <PrintableFilesPacket
                state={state}
                lang={lang}
                selectedKeys={selectedKeys}
              />
            </div>
          ) : (
            <>
              {/* Quick Single-Voucher Printers */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2">
                  <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-teal-700" />
                    {t(lang, 'طباعة فاتورة مبيعات ضريبية منفردة', 'Quick Print Single Sales Tax Invoice')}
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={selectedSale?.id ?? ''}
                      onChange={(e) => setSelectedSaleId(e.target.value)}
                      className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs text-slate-800"
                    >
                      {state.salesInvoices.slice(0, 40).map((inv) => (
                        <option key={inv.id} value={inv.id}>
                          {inv.invoiceNo} · {inv.date} · {fmtMoney(inv.grossTotal, 0)} EGP
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={!selectedSale}
                      onClick={() => selectedSale && onPrintSalesInvoice(selectedSale)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white text-xs font-semibold whitespace-nowrap shrink-0"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      {t(lang, 'طباعة الفاتورة', 'Print')}
                    </button>
                  </div>
                </div>

                <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2">
                  <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-amber-700" />
                    {t(lang, 'طباعة فاتورة مشتريات مورد منفردة', 'Quick Print Single Purchase Voucher')}
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={selectedPurchase?.id ?? ''}
                      onChange={(e) => setSelectedPurchaseId(e.target.value)}
                      className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs text-slate-800"
                    >
                      {state.purchaseInvoices.slice(0, 40).map((po) => (
                        <option key={po.id} value={po.id}>
                          {po.purchaseNo} · {po.supplierNameAr} · {fmtMoney(po.grandTotal, 0)} EGP
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={!selectedPurchase}
                      onClick={() => selectedPurchase && onPrintPurchaseInvoice(selectedPurchase)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white text-xs font-semibold whitespace-nowrap shrink-0"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      {t(lang, 'طباعة الفاتورة', 'Print')}
                    </button>
                  </div>
                </div>
              </div>

              {/* 14-File Catalog Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {PRINT_FILES_CATALOG.map((item) => {
                  const checked = selectedKeys.includes(item.key);
                  const count = countsMap[item.key] ?? 0;
                  const isPersonal = item.group === 'personal';

                  return (
                    <div
                      key={item.key}
                      className={`p-3.5 rounded-xl border transition-colors flex items-start justify-between gap-3 ${
                        checked
                          ? isPersonal
                            ? 'border-amber-300 bg-amber-50/50'
                            : 'border-teal-300 bg-teal-50/40'
                          : 'border-slate-200 bg-white hover:bg-slate-50'
                      }`}
                    >
                      <label className="flex items-start gap-3 cursor-pointer flex-1 min-w-0">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleKey(item.key)}
                          className="mt-1 h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600 shrink-0"
                        />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-bold text-slate-900">
                              {lang === 'ar' ? item.titleAr : item.titleEn}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-[10px] font-mono-num font-semibold text-slate-700" dir="ltr">
                              {count} {t(lang, 'سجل', 'rows')}
                            </span>
                            {isPersonal && (
                              <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-semibold">
                                {t(lang, 'معزول', 'Isolated')}
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            {lang === 'ar' ? item.descAr : item.descEn}
                          </p>
                        </div>
                      </label>

                      <button
                        type="button"
                        onClick={() => onPrintPacket([item.key])}
                        title={t(lang, 'طباعة هذا الملف منفرداً', 'Print this file standalone')}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-[11px] font-semibold whitespace-nowrap shrink-0"
                      >
                        <Printer className="w-3.5 h-3.5 text-teal-700" />
                        <span>{t(lang, 'طباعة', 'Print')}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-slate-500">
            {t(
              lang,
              'ملاحظة: يمكن اختيار "حفظ بصيغة PDF" من نافذة طباعة المتصفح لإصدار ملف PDF كامل بجودة A4.',
              'Tip: Choose "Save as PDF" in your browser print dialog to export a crisp A4 multi-page PDF packet.'
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-700"
            >
              {t(lang, 'إغلاق', 'Close')}
            </button>
            <button
              type="button"
              disabled={selectedKeys.length === 0}
              onClick={() => onPrintPacket(selectedKeys)}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-xs font-bold shadow-sm whitespace-nowrap"
            >
              <Printer className="w-4 h-4" />
              <span>
                {t(
                  lang,
                  `طباعة الملفات المحددة (${selectedKeys.length})`,
                  `Print Selected Files (${selectedKeys.length})`
                )}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
