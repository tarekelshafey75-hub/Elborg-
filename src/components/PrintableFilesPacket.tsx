import React from 'react';
import type {
  ErpState,
  Language,
  PurchaseInvoice,
  SalesInvoice,
} from '../types/erp';
import {
  computeAccountBalances,
  computeTrialBalanceTotals,
  round2,
} from '../utils/erpEngine';
import { fmtMoney, fmtPct, t } from '../utils/formatters';
import { CfoPrintableBrief } from './CfoPrintableBrief';

export type PrintFileKey =
  | 'cfo_board_pack'
  | 'cfo_pnl'
  | 'sales_invoices'
  | 'purchase_invoices'
  | 'suppliers_aging'
  | 'customers'
  | 'representatives'
  | 'inventory'
  | 'menu_bom'
  | 'stocktake'
  | 'waste_expenses'
  | 'bank_statement'
  | 'accounting_vat'
  | 'strategy_risks'
  | 'household';

export interface PrintCatalogItem {
  key: PrintFileKey;
  titleAr: string;
  titleEn: string;
  descAr: string;
  descEn: string;
  group: 'company' | 'personal';
}

export const PRINT_FILES_CATALOG: PrintCatalogItem[] = [
  {
    key: 'cfo_board_pack',
    titleAr: '0. حزمة تقارير CFO التنفيذية الجاهزة (Board Pack A4)',
    titleEn: '0. CFO Board-Ready Executive Pack (A4 Complete)',
    descAr: 'الملخص التنفيذي، قائمة الدخل 9M، مراكز التكلفة، عائد الـ 80% فراغ، سجل المخاطر، والتوقيعات',
    descEn: 'Executive KPIs, 9M P&L, cost centers, 80% land ROI simulation, risk register & sign-off',
    group: 'company',
  },
  {
    key: 'cfo_pnl',
    titleAr: '1. ملخص الأداء المالي الشهري (9M P&L & KPIs)',
    titleEn: '1. Monthly Financial Performance & P&L (9M 2026)',
    descAr: 'الإيرادات، التكلفة، مجمل الربح، الرواتب، حق الانتفاع، وصافي النتيجة',
    descEn: 'Revenue, COGS, GP, Payroll, Usufruct Rent & Net Profit',
    group: 'company',
  },
  {
    key: 'sales_invoices',
    titleAr: '2. سجل فواتير المبيعات والإيرادات (Sales Invoices)',
    titleEn: '2. Sales & Revenue Invoices Register',
    descAr: 'تفاصيل الفواتير، ضريبة 14%، تكلفة COGS، وطرق الدفع',
    descEn: 'Invoice register, 14% VAT split, BOM COGS & payment methods',
    group: 'company',
  },
  {
    key: 'purchase_invoices',
    titleAr: '3. سجل فواتير المشتريات (Purchase Invoices)',
    titleEn: '3. Supplier Purchase Invoices Register',
    descAr: 'فواتير الموردين، صافي المشتريات، ضريبة المدخلات، والإجمالي',
    descEn: 'Supplier invoices, net purchases, input VAT & payment status',
    group: 'company',
  },
  {
    key: 'suppliers_aging',
    titleAr: '4. دليل الموردين وأعمار الديون (Suppliers & AP Aging)',
    titleEn: '4. Suppliers Directory & AP Aging Schedule',
    descAr: 'أرصدة الموردين المستحقة (0-30 / 31-60 / 61-90+ يوم) والأرقام الضريبية',
    descEn: 'Payable balances by aging bucket & supplier tax registration',
    group: 'company',
  },
  {
    key: 'customers',
    titleAr: '5. سجل العملاء والذمم (Customers Register)',
    titleEn: '5. Customers & Accounts Receivable Directory',
    descAr: 'تصنيف العملاء، الحدود الائتمانية، والأرصدة المدينة وإجمالي الطلبات',
    descEn: 'Customer segments, credit limits, balances & order totals',
    group: 'company',
  },
  {
    key: 'representatives',
    titleAr: '6. بيانات المناديب والعُهد والتحصيل (Representatives)',
    titleEn: '6. Representatives, Custody & Collection Report',
    descAr: 'المبيعات المحققة، التحصيل، أرصدة العهد، والعمولات المستحقة',
    descEn: 'Achieved sales, collections, custody balances & commissions',
    group: 'company',
  },
  {
    key: 'inventory',
    titleAr: '7. كشف أرصدة المخزون الخام والتقييم (Inventory WAC)',
    titleEn: '7. Raw Inventory Valuation & Movement (WAC)',
    descAr: 'الأرصدة الافتتاحية، المشتريات، المنصرف BOM، الهالك، والقيمة الحالية',
    descEn: 'Opening, purchased, BOM issued, waste & current WAC valuation',
    group: 'company',
  },
  {
    key: 'menu_bom',
    titleAr: '8. قائمة المنيو وتكلفة الوصفات (Menu & BOM — 109 صنف)',
    titleEn: '8. Menu Engineering & Recipe Costing (109 Items)',
    descAr: 'أسعار البيع، نسبة تكلفة الطعام المستهدفة، والمبيعات التقديرية',
    descEn: 'Gross/net pricing, target food cost % & BOM lines',
    group: 'company',
  },
  {
    key: 'stocktake',
    titleAr: '9. تقرير الجرد الفعلي والانحرافات (Stocktake & Variance)',
    titleEn: '9. Physical Stocktake & Inventory Variance Report',
    descAr: 'الرصيد الدفتري مقابل الجرد الفعلي ونسب وقيم الفروق والتسويات',
    descEn: 'Book vs actual physical count quantities, variances & status',
    group: 'company',
  },
  {
    key: 'waste_expenses',
    titleAr: '10. سجل الهالك والمصروفات التشغيلية (Waste & OPEX)',
    titleEn: '10. Waste Logs & Operating Expenses Register',
    descAr: 'الهالك المسجل وأسبابه + المصروفات التشغيلية موزعة على مراكز التكلفة',
    descEn: 'Recorded spoilage/waste + itemized OPEX by cost center',
    group: 'company',
  },
  {
    key: 'bank_statement',
    titleAr: '11. كشف حساب بنك CIB وتسوية 1103 (Bank & Recon)',
    titleEn: '11. CIB Bank Statement & 1103 Clearing Reconciliation',
    descAr: 'الحركات البنكية، الأرصدة التراكمية، وحالة المطابقة مع القيود',
    descEn: 'Bank movements, running balance & GL match reconciliation',
    group: 'company',
  },
  {
    key: 'accounting_vat',
    titleAr: '12. دفتر اليومية وميزان المراجعة وإقرار الضريبة (GL & VAT 14%)',
    titleEn: '12. General Ledger, Trial Balance & VAT 14% Return',
    descAr: 'شجرة الحسابات بأرصدتها، قيود اليومية، وملخص ضريبة القيمة المضافة',
    descEn: 'Chart of accounts balances, journal entries & output/input VAT net',
    group: 'company',
  },
  {
    key: 'strategy_risks',
    titleAr: '13. خطة 2027 وسجل المخاطر والتدقيق التاريخي (Strategy & Risks)',
    titleEn: '13. 2027 Strategy, CFO Risk Register & Audit Trail',
    descAr: 'سيناريوهات 2027، المبادرات، سجل المخاطر وتقدم المعالجة، وأحدث قيود التدقيق',
    descEn: '2027 scenarios, strategic initiatives, risk mitigation & audit log',
    group: 'company',
  },
  {
    key: 'household',
    titleAr: '14. الحساب المنفصل للبيت (معزول عن الشركة)',
    titleEn: '14. Separate Household Ledger (Isolated Personal)',
    descAr: 'سجل الدخل والمصروفات الشخصية والعائلية المعزول تماماً عن حسابات الشركة',
    descEn: 'Personal family income & expenses completely isolated from corporate ERP',
    group: 'personal',
  },
];

interface PrintableFilesPacketProps {
  state: ErpState;
  lang: Language;
  selectedKeys: PrintFileKey[];
  singleSalesInvoice?: SalesInvoice | null;
  singlePurchaseInvoice?: PurchaseInvoice | null;
}

export const PrintableFilesPacket: React.FC<PrintableFilesPacketProps> = ({
  state,
  lang,
  selectedKeys,
  singleSalesInvoice,
  singlePurchaseInvoice,
}) => {
  const balances = computeAccountBalances(state);
  const tb = computeTrialBalanceTotals(state);
  const printDate = new Date().toISOString().slice(0, 16).replace('T', ' ');

  const renderDocHeader = (titleAr: string, titleEn: string, docRef?: string) => (
    <div className="border-b-2 border-slate-900 pb-3 mb-4 flex items-start justify-between gap-4">
      <div>
        <div className="text-[11px] font-bold uppercase tracking-wider text-teal-800">
          {t(lang, 'شركة استادات للاستثمار الرياضي — فرع برج المنوفية', 'ESTADAT SPORTS INVESTMENT — MENOUFIA TOWER')}
        </div>
        <h2 className="text-base font-bold text-slate-900 mt-0.5">{t(lang, titleAr, titleEn)}</h2>
      </div>
      <div className="text-end text-[10px] text-slate-600 font-mono-num shrink-0" dir="ltr">
        <div>TAX ID: {state.taxId}</div>
        {docRef && <div className="font-bold text-slate-900">{docRef}</div>}
        <div>Printed: {printDate}</div>
      </div>
    </div>
  );

  const renderSignatures = () => (
    <div className="mt-8 pt-4 border-t border-slate-300 grid grid-cols-3 gap-6 text-center text-[11px] text-slate-700 print-avoid-break">
      <div>
        <div className="font-semibold mb-6">{t(lang, 'إعداد / المحاسب العام', 'Prepared By / Chief Accountant')}</div>
        <div className="border-t border-slate-400 pt-1 text-[10px] text-slate-500">{t(lang, 'التوقيع والتاريخ', 'Signature & Date')}</div>
      </div>
      <div>
        <div className="font-semibold mb-6">{t(lang, 'مراجعة / المراقب المالي', 'Reviewed By / Financial Controller')}</div>
        <div className="border-t border-slate-400 pt-1 text-[10px] text-slate-500">{t(lang, 'التوقيع والتاريخ', 'Signature & Date')}</div>
      </div>
      <div>
        <div className="font-semibold mb-6">{t(lang, 'اعتماد / المدير المالي CFO', 'Approved By / CFO')}</div>
        <div className="border-t border-slate-400 pt-1 text-[10px] text-slate-500">{t(lang, 'الختم والاعتماد', 'Stamp & Approval')}</div>
      </div>
    </div>
  );

  if (singleSalesInvoice) {
    const inv = singleSalesInvoice;
    return (
      <div className="p-6 text-slate-900 bg-white text-xs" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        {renderDocHeader('فاتورة ضريبية معتمدة (ETA e-Invoice)', 'Official Tax Sales Invoice', inv.invoiceNo)}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 rounded-lg border border-slate-300 mb-4 bg-slate-50">
          <div>
            <div className="text-[10px] text-slate-500">{t(lang, 'التاريخ والوقت', 'Date & Time')}</div>
            <div className="font-mono-num font-semibold" dir="ltr">{inv.date} · {inv.time}</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-500">{t(lang, 'القناة / الطاولة', 'Channel / Table')}</div>
            <div className="font-semibold">{inv.orderType}{inv.tableNumber ? ` (${inv.tableNumber})` : ''}</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-500">{t(lang, 'طريقة الدفع', 'Payment Method')}</div>
            <div className="font-semibold">{inv.paymentMethod}</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-500">{t(lang, 'المسؤول / القيد', 'Cashier / Journal')}</div>
            <div className="font-mono-num font-semibold">{inv.cashier} · {inv.journalId}</div>
          </div>
        </div>

        <table className="w-full text-xs border border-slate-300">
          <thead>
            <tr className="bg-slate-100 border-b border-slate-300">
              <th className="py-2 px-3 text-start">#</th>
              <th className="py-2 px-3 text-start">{t(lang, 'الصنف', 'Item')}</th>
              <th className="py-2 px-3 text-end">{t(lang, 'الكمية', 'Qty')}</th>
              <th className="py-2 px-3 text-end">{t(lang, 'سعر الوحدة', 'Unit Price')}</th>
              <th className="py-2 px-3 text-end">{t(lang, 'صافي', 'Net')}</th>
              <th className="py-2 px-3 text-end">{t(lang, 'ضريبة 14%', 'VAT 14%')}</th>
              <th className="py-2 px-3 text-end">{t(lang, 'الإجمالي', 'Total')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {inv.lines.map((line, i) => (
              <tr key={`${line.menuItemId}-${i}`}>
                <td className="py-2 px-3 font-mono-num">{i + 1}</td>
                <td className="py-2 px-3 font-medium">{lang === 'ar' ? line.nameAr : line.nameEn}</td>
                <td className="py-2 px-3 text-end font-mono-num" dir="ltr">{line.qty}</td>
                <td className="py-2 px-3 text-end font-mono-num" dir="ltr">{fmtMoney(line.unitPriceGross, 2)}</td>
                <td className="py-2 px-3 text-end font-mono-num" dir="ltr">{fmtMoney(line.lineNet, 2)}</td>
                <td className="py-2 px-3 text-end font-mono-num" dir="ltr">{fmtMoney(line.lineVat, 2)}</td>
                <td className="py-2 px-3 text-end font-mono-num font-bold" dir="ltr">{fmtMoney(line.lineTotalGross, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 ms-auto max-w-xs border border-slate-300 rounded-lg p-3 space-y-1.5 bg-slate-50">
          <div className="flex justify-between">
            <span>{t(lang, 'صافي المبيعات:', 'Net Sales:')}</span>
            <span className="font-mono-num font-semibold" dir="ltr">{fmtMoney(inv.netSales, 2)} EGP</span>
          </div>
          <div className="flex justify-between">
            <span>{t(lang, 'ضريبة القيمة المضافة 14%:', 'VAT 14%:')}</span>
            <span className="font-mono-num font-semibold" dir="ltr">{fmtMoney(inv.vatAmount, 2)} EGP</span>
          </div>
          {inv.discountAmount > 0 && (
            <div className="flex justify-between text-red-700">
              <span>{t(lang, 'الخصم:', 'Discount:')}</span>
              <span className="font-mono-num" dir="ltr">-{fmtMoney(inv.discountAmount, 2)} EGP</span>
            </div>
          )}
          <div className="flex justify-between border-t border-slate-300 pt-1.5 font-bold text-sm">
            <span>{t(lang, 'الإجمالي المستحق:', 'Gross Total:')}</span>
            <span className="font-mono-num" dir="ltr">{fmtMoney(inv.grossTotal, 2)} EGP</span>
          </div>
        </div>
        {renderSignatures()}
      </div>
    );
  }

  if (singlePurchaseInvoice) {
    const po = singlePurchaseInvoice;
    return (
      <div className="p-6 text-slate-900 bg-white text-xs" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        {renderDocHeader('مستند فاتورة مشتريات مورد معتمد', 'Supplier Purchase Invoice Voucher', po.purchaseNo)}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 rounded-lg border border-slate-300 mb-4 bg-slate-50">
          <div>
            <div className="text-[10px] text-slate-500">{t(lang, 'المورد', 'Supplier')}</div>
            <div className="font-bold">{po.supplierNameAr}</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-500">{t(lang, 'التاريخ', 'Date')}</div>
            <div className="font-mono-num font-semibold" dir="ltr">{po.date}</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-500">{t(lang, 'حالة السداد', 'Payment Status')}</div>
            <div className="font-semibold">{po.paymentStatus}</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-500">{t(lang, 'القيد المحاسبي', 'Journal Ref')}</div>
            <div className="font-mono-num font-semibold" dir="ltr">{po.journalId}</div>
          </div>
        </div>

        <table className="w-full text-xs border border-slate-300">
          <thead>
            <tr className="bg-slate-100 border-b border-slate-300">
              <th className="py-2 px-3 text-start">#</th>
              <th className="py-2 px-3 text-start">{t(lang, 'الصنف الخام', 'Ingredient')}</th>
              <th className="py-2 px-3 text-end">{t(lang, 'الكمية', 'Qty')}</th>
              <th className="py-2 px-3 text-end">{t(lang, 'سعر الوحدة الصافي', 'Unit Cost Net')}</th>
              <th className="py-2 px-3 text-end">{t(lang, 'الإجمالي الصافي', 'Line Net Total')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {po.lines.map((line, i) => (
              <tr key={`${line.ingredientId}-${i}`}>
                <td className="py-2 px-3 font-mono-num">{i + 1}</td>
                <td className="py-2 px-3 font-medium">{lang === 'ar' ? line.nameAr : line.nameEn}</td>
                <td className="py-2 px-3 text-end font-mono-num" dir="ltr">{line.qty}</td>
                <td className="py-2 px-3 text-end font-mono-num" dir="ltr">{fmtMoney(line.unitCostNet, 2)}</td>
                <td className="py-2 px-3 text-end font-mono-num font-bold" dir="ltr">{fmtMoney(line.lineTotalNet, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 ms-auto max-w-xs border border-slate-300 rounded-lg p-3 space-y-1.5 bg-slate-50">
          <div className="flex justify-between">
            <span>{t(lang, 'صافي الفاتورة:', 'Total Before Tax:')}</span>
            <span className="font-mono-num font-semibold" dir="ltr">{fmtMoney(po.totalBeforeTax, 2)} EGP</span>
          </div>
          <div className="flex justify-between">
            <span>{t(lang, 'ضريبة المدخلات 14%:', 'Input VAT 14%:')}</span>
            <span className="font-mono-num font-semibold" dir="ltr">{fmtMoney(po.vatAmount, 2)} EGP</span>
          </div>
          <div className="flex justify-between border-t border-slate-300 pt-1.5 font-bold text-sm">
            <span>{t(lang, 'الإجمالي المستحق للمورد:', 'Grand Total:')}</span>
            <span className="font-mono-num" dir="ltr">{fmtMoney(po.grandTotal, 2)} EGP</span>
          </div>
        </div>
        {renderSignatures()}
      </div>
    );
  }

  const keysSet = new Set<PrintFileKey>(selectedKeys);
  const orderedKeys = PRINT_FILES_CATALOG.map((c) => c.key).filter((k) => keysSet.has(k));

  const renderSection = (key: PrintFileKey, index: number) => {
    const breakCls = index > 0 ? 'print-break-before' : '';

    switch (key) {
      case 'cfo_board_pack':
        return (
          <section key={key} className={`${breakCls} py-2`}>
            <CfoPrintableBrief state={state} lang={lang} />
          </section>
        );

      case 'cfo_pnl': {
        const totNetRev = state.monthlyActuals2026.reduce((s, m) => s + m.netRevenue, 0);
        const totCogs = state.monthlyActuals2026.reduce((s, m) => s + m.cogs, 0);
        const totGp = state.monthlyActuals2026.reduce((s, m) => s + m.grossProfit, 0);
        const totOpex = state.monthlyActuals2026.reduce((s, m) => s + m.totalOpexInclRent, 0);
        const totNet = state.monthlyActuals2026.reduce((s, m) => s + m.netProfit, 0);
        return (
          <section key={key} className={`${breakCls} py-2`}>
            {renderDocHeader('ملخص الأداء المالي الشهري (9M P&L & KPIs)', 'Monthly Financial Performance & P&L (9M 2026)', 'FIN-9M-2026')}
            <table className="w-full text-[11px] border border-slate-300">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-300">
                  <th className="py-1.5 px-2 text-start">{t(lang, 'الشهر', 'Month')}</th>
                  <th className="py-1.5 px-2 text-end">{t(lang, 'صافي المبيعات', 'Net Rev')}</th>
                  <th className="py-1.5 px-2 text-end">{t(lang, 'التكلفة COGS', 'COGS')}</th>
                  <th className="py-1.5 px-2 text-end">{t(lang, 'مجمل الربح', 'Gross Profit')}</th>
                  <th className="py-1.5 px-2 text-end">{t(lang, 'هامش %', 'GP %')}</th>
                  <th className="py-1.5 px-2 text-end">{t(lang, 'الرواتب', 'Payroll')}</th>
                  <th className="py-1.5 px-2 text-end">{t(lang, 'حق الانتفاع', 'Usufruct')}</th>
                  <th className="py-1.5 px-2 text-end">{t(lang, 'المصروفات', 'Total OPEX')}</th>
                  <th className="py-1.5 px-2 text-end">{t(lang, 'صافي النتيجة', 'Net Result')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {state.monthlyActuals2026.map((m) => (
                  <tr key={m.monthKey}>
                    <td className="py-1.5 px-2 font-semibold">{lang === 'ar' ? m.labelAr : m.labelEn}</td>
                    <td className="py-1.5 px-2 text-end font-mono-num" dir="ltr">{fmtMoney(m.netRevenue, 0)}</td>
                    <td className="py-1.5 px-2 text-end font-mono-num" dir="ltr">{fmtMoney(m.cogs, 0)}</td>
                    <td className="py-1.5 px-2 text-end font-mono-num" dir="ltr">{fmtMoney(m.grossProfit, 0)}</td>
                    <td className="py-1.5 px-2 text-end font-mono-num" dir="ltr">{fmtPct(m.gpMarginPct)}</td>
                    <td className="py-1.5 px-2 text-end font-mono-num" dir="ltr">{fmtMoney(m.payroll, 0)}</td>
                    <td className="py-1.5 px-2 text-end font-mono-num" dir="ltr">{fmtMoney(m.usufructRent, 0)}</td>
                    <td className="py-1.5 px-2 text-end font-mono-num" dir="ltr">{fmtMoney(m.totalOpexInclRent, 0)}</td>
                    <td className={`py-1.5 px-2 text-end font-mono-num font-bold ${m.netProfit < 0 ? 'text-red-700' : 'text-emerald-700'}`} dir="ltr">
                      {fmtMoney(m.netProfit, 0)}
                    </td>
                  </tr>
                ))}
                <tr className="bg-slate-100 font-bold border-t-2 border-slate-400">
                  <td className="py-2 px-2">{t(lang, 'الإجمالي 9M', 'Total 9M')}</td>
                  <td className="py-2 px-2 text-end font-mono-num" dir="ltr">{fmtMoney(totNetRev, 0)}</td>
                  <td className="py-2 px-2 text-end font-mono-num" dir="ltr">{fmtMoney(totCogs, 0)}</td>
                  <td className="py-2 px-2 text-end font-mono-num" dir="ltr">{fmtMoney(totGp, 0)}</td>
                  <td className="py-2 px-2 text-end font-mono-num" dir="ltr">{fmtPct((totGp / Math.max(1, totNetRev)) * 100)}</td>
                  <td className="py-2 px-2 text-end font-mono-num" dir="ltr">—</td>
                  <td className="py-2 px-2 text-end font-mono-num" dir="ltr">—</td>
                  <td className="py-2 px-2 text-end font-mono-num" dir="ltr">{fmtMoney(totOpex, 0)}</td>
                  <td className={`py-2 px-2 text-end font-mono-num ${totNet < 0 ? 'text-red-700' : 'text-emerald-700'}`} dir="ltr">
                    {fmtMoney(totNet, 0)}
                  </td>
                </tr>
              </tbody>
            </table>
          </section>
        );
      }

      case 'sales_invoices': {
        const totGross = state.salesInvoices.reduce((s, i) => s + i.grossTotal, 0);
        const totVat = state.salesInvoices.reduce((s, i) => s + i.vatAmount, 0);
        const totNet = state.salesInvoices.reduce((s, i) => s + i.netSales, 0);
        return (
          <section key={key} className={`${breakCls} py-2`}>
            {renderDocHeader('سجل فواتير المبيعات والإيرادات', 'Sales & Revenue Invoices Register', `COUNT: ${state.salesInvoices.length}`)}
            <table className="w-full text-[11px] border border-slate-300">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-300">
                  <th className="py-1.5 px-2 text-start">{t(lang, 'رقم الفاتورة', 'Invoice #')}</th>
                  <th className="py-1.5 px-2 text-start">{t(lang, 'التاريخ', 'Date')}</th>
                  <th className="py-1.5 px-2 text-start">{t(lang, 'القناة / الدفع', 'Channel / Pay')}</th>
                  <th className="py-1.5 px-2 text-end">{t(lang, 'صافي المبيعات', 'Net Sales')}</th>
                  <th className="py-1.5 px-2 text-end">{t(lang, 'ضريبة 14%', 'VAT 14%')}</th>
                  <th className="py-1.5 px-2 text-end">{t(lang, 'الإجمالي', 'Gross Total')}</th>
                  <th className="py-1.5 px-2 text-end">{t(lang, 'تكلفة COGS', 'COGS')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {state.salesInvoices.map((inv) => (
                  <tr key={inv.id}>
                    <td className="py-1.5 px-2 font-mono-num font-semibold" dir="ltr">{inv.invoiceNo}</td>
                    <td className="py-1.5 px-2 font-mono-num" dir="ltr">{inv.date} {inv.time}</td>
                    <td className="py-1.5 px-2">{inv.orderType} · {inv.paymentMethod}</td>
                    <td className="py-1.5 px-2 text-end font-mono-num" dir="ltr">{fmtMoney(inv.netSales, 2)}</td>
                    <td className="py-1.5 px-2 text-end font-mono-num" dir="ltr">{fmtMoney(inv.vatAmount, 2)}</td>
                    <td className="py-1.5 px-2 text-end font-mono-num font-bold" dir="ltr">{fmtMoney(inv.grossTotal, 2)}</td>
                    <td className="py-1.5 px-2 text-end font-mono-num" dir="ltr">{fmtMoney(inv.cogsTotal, 2)}</td>
                  </tr>
                ))}
                <tr className="bg-slate-100 font-bold border-t-2 border-slate-400">
                  <td colSpan={3} className="py-2 px-2">{t(lang, 'الإجمالي', 'Total')}</td>
                  <td className="py-2 px-2 text-end font-mono-num" dir="ltr">{fmtMoney(totNet, 2)}</td>
                  <td className="py-2 px-2 text-end font-mono-num" dir="ltr">{fmtMoney(totVat, 2)}</td>
                  <td className="py-2 px-2 text-end font-mono-num" dir="ltr">{fmtMoney(totGross, 2)}</td>
                  <td className="py-2 px-2 text-end font-mono-num" dir="ltr">—</td>
                </tr>
              </tbody>
            </table>
          </section>
        );
      }

      case 'purchase_invoices': {
        const totNet = state.purchaseInvoices.reduce((s, p) => s + p.totalBeforeTax, 0);
        const totVat = state.purchaseInvoices.reduce((s, p) => s + p.vatAmount, 0);
        const totGrand = state.purchaseInvoices.reduce((s, p) => s + p.grandTotal, 0);
        return (
          <section key={key} className={`${breakCls} py-2`}>
            {renderDocHeader('سجل فواتير المشتريات المعتمدة', 'Supplier Purchase Invoices Register', `COUNT: ${state.purchaseInvoices.length}`)}
            <table className="w-full text-[11px] border border-slate-300">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-300">
                  <th className="py-1.5 px-2 text-start">{t(lang, 'رقم الفاتورة', 'PO #')}</th>
                  <th className="py-1.5 px-2 text-start">{t(lang, 'التاريخ', 'Date')}</th>
                  <th className="py-1.5 px-2 text-start">{t(lang, 'المورد', 'Supplier')}</th>
                  <th className="py-1.5 px-2 text-start">{t(lang, 'السداد', 'Payment')}</th>
                  <th className="py-1.5 px-2 text-end">{t(lang, 'الصافي', 'Net')}</th>
                  <th className="py-1.5 px-2 text-end">{t(lang, 'ضريبة 14%', 'VAT 14%')}</th>
                  <th className="py-1.5 px-2 text-end">{t(lang, 'الإجمالي', 'Grand Total')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {state.purchaseInvoices.map((p) => (
                  <tr key={p.id}>
                    <td className="py-1.5 px-2 font-mono-num font-semibold" dir="ltr">{p.purchaseNo}</td>
                    <td className="py-1.5 px-2 font-mono-num" dir="ltr">{p.date}</td>
                    <td className="py-1.5 px-2">{p.supplierNameAr}</td>
                    <td className="py-1.5 px-2">{p.paymentStatus}</td>
                    <td className="py-1.5 px-2 text-end font-mono-num" dir="ltr">{fmtMoney(p.totalBeforeTax, 2)}</td>
                    <td className="py-1.5 px-2 text-end font-mono-num" dir="ltr">{fmtMoney(p.vatAmount, 2)}</td>
                    <td className="py-1.5 px-2 text-end font-mono-num font-bold" dir="ltr">{fmtMoney(p.grandTotal, 2)}</td>
                  </tr>
                ))}
                <tr className="bg-slate-100 font-bold border-t-2 border-slate-400">
                  <td colSpan={4} className="py-2 px-2">{t(lang, 'الإجمالي', 'Total')}</td>
                  <td className="py-2 px-2 text-end font-mono-num" dir="ltr">{fmtMoney(totNet, 2)}</td>
                  <td className="py-2 px-2 text-end font-mono-num" dir="ltr">{fmtMoney(totVat, 2)}</td>
                  <td className="py-2 px-2 text-end font-mono-num" dir="ltr">{fmtMoney(totGrand, 2)}</td>
                </tr>
              </tbody>
            </table>
          </section>
        );
      }

      case 'suppliers_aging': {
        const totAp = state.suppliers.reduce((s, sp) => s + sp.aging0_30 + sp.aging31_60 + sp.aging61_90Plus, 0);
        return (
          <section key={key} className={`${breakCls} py-2`}>
            {renderDocHeader('دليل الموردين وأعمار الديون', 'Suppliers Directory & AP Aging Schedule', `AP TOTAL: ${fmtMoney(totAp, 0)} EGP`)}
            <table className="w-full text-[11px] border border-slate-300">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-300">
                  <th className="py-1.5 px-2 text-start">{t(lang, 'المورد', 'Supplier')}</th>
                  <th className="py-1.5 px-2 text-start">{t(lang, 'الرقم الضريبي', 'Tax ID')}</th>
                  <th className="py-1.5 px-2 text-end">{t(lang, '0-30 يوم', '0-30d')}</th>
                  <th className="py-1.5 px-2 text-end">{t(lang, '31-60 يوم', '31-60d')}</th>
                  <th className="py-1.5 px-2 text-end">{t(lang, '61-90+ يوم', '61-90+d')}</th>
                  <th className="py-1.5 px-2 text-end">{t(lang, 'إجمالي المستحق', 'Total AP')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {state.suppliers.map((sp) => {
                  const total = sp.aging0_30 + sp.aging31_60 + sp.aging61_90Plus;
                  return (
                    <tr key={sp.id}>
                      <td className="py-1.5 px-2 font-semibold">{lang === 'ar' ? sp.nameAr : sp.nameEn}</td>
                      <td className="py-1.5 px-2 font-mono-num" dir="ltr">{sp.taxNumber}</td>
                      <td className="py-1.5 px-2 text-end font-mono-num" dir="ltr">{fmtMoney(sp.aging0_30, 0)}</td>
                      <td className="py-1.5 px-2 text-end font-mono-num" dir="ltr">{fmtMoney(sp.aging31_60, 0)}</td>
                      <td className="py-1.5 px-2 text-end font-mono-num" dir="ltr">{fmtMoney(sp.aging61_90Plus, 0)}</td>
                      <td className="py-1.5 px-2 text-end font-mono-num font-bold" dir="ltr">{fmtMoney(total, 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        );
      }

      case 'customers':
        return (
          <section key={key} className={`${breakCls} py-2`}>
            {renderDocHeader('سجل العملاء والذمم المدينة', 'Customers & Accounts Receivable Register', `COUNT: ${state.customers.length}`)}
            <table className="w-full text-[11px] border border-slate-300">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-300">
                  <th className="py-1.5 px-2 text-start">{t(lang, 'الكود', 'Code')}</th>
                  <th className="py-1.5 px-2 text-start">{t(lang, 'العميل', 'Customer')}</th>
                  <th className="py-1.5 px-2 text-start">{t(lang, 'الشريحة / المدينة', 'Segment / City')}</th>
                  <th className="py-1.5 px-2 text-end">{t(lang, 'الحد الائتماني', 'Credit Limit')}</th>
                  <th className="py-1.5 px-2 text-end">{t(lang, 'الرصيد الحالي', 'Balance')}</th>
                  <th className="py-1.5 px-2 text-end">{t(lang, 'إجمالي المشتريات', 'Total Spent')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {state.customers.map((c) => (
                  <tr key={c.id}>
                    <td className="py-1.5 px-2 font-mono-num" dir="ltr">{c.code}</td>
                    <td className="py-1.5 px-2 font-semibold">{lang === 'ar' ? c.nameAr : c.nameEn}</td>
                    <td className="py-1.5 px-2">{c.segment} · {c.city}</td>
                    <td className="py-1.5 px-2 text-end font-mono-num" dir="ltr">{fmtMoney(c.creditLimit, 0)}</td>
                    <td className="py-1.5 px-2 text-end font-mono-num font-bold" dir="ltr">{fmtMoney(c.currentBalance, 0)}</td>
                    <td className="py-1.5 px-2 text-end font-mono-num" dir="ltr">{fmtMoney(c.totalSpent, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );

      case 'representatives':
        return (
          <section key={key} className={`${breakCls} py-2`}>
            {renderDocHeader('تقرير المناديب والعُهد والتحصيل', 'Representatives, Custody & Collection Report', `COUNT: ${(state.representatives ?? []).length}`)}
            <table className="w-full text-[11px] border border-slate-300">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-300">
                  <th className="py-1.5 px-2 text-start">{t(lang, 'الكود', 'Code')}</th>
                  <th className="py-1.5 px-2 text-start">{t(lang, 'المندوب', 'Representative')}</th>
                  <th className="py-1.5 px-2 text-start">{t(lang, 'الدور / المنطقة', 'Role / Area')}</th>
                  <th className="py-1.5 px-2 text-end">{t(lang, 'المستهدف', 'Target')}</th>
                  <th className="py-1.5 px-2 text-end">{t(lang, 'المحقق', 'Achieved')}</th>
                  <th className="py-1.5 px-2 text-end">{t(lang, 'المحصل', 'Collected')}</th>
                  <th className="py-1.5 px-2 text-end">{t(lang, 'رصيد العهدة', 'Custody Bal')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {(state.representatives ?? []).map((rep) => (
                  <tr key={rep.id}>
                    <td className="py-1.5 px-2 font-mono-num" dir="ltr">{rep.code}</td>
                    <td className="py-1.5 px-2 font-semibold">{lang === 'ar' ? rep.nameAr : rep.nameEn}</td>
                    <td className="py-1.5 px-2">{rep.roleType} · {rep.assignedArea}</td>
                    <td className="py-1.5 px-2 text-end font-mono-num" dir="ltr">{fmtMoney(rep.monthlyTarget, 0)}</td>
                    <td className="py-1.5 px-2 text-end font-mono-num" dir="ltr">{fmtMoney(rep.achievedSales, 0)}</td>
                    <td className="py-1.5 px-2 text-end font-mono-num" dir="ltr">{fmtMoney(rep.collectedAmount, 0)}</td>
                    <td className="py-1.5 px-2 text-end font-mono-num font-bold" dir="ltr">{fmtMoney(rep.custodyBalance, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );

      case 'inventory': {
        const totStockVal = round2(state.ingredients.reduce((s, i) => s + i.currentQty * i.weightedAvgCost, 0));
        return (
          <section key={key} className={`${breakCls} py-2`}>
            {renderDocHeader('كشف أرصدة المخزون الخام والتقييم (WAC)', 'Raw Inventory Stock Valuation (WAC)', `VALUATION: ${fmtMoney(totStockVal, 0)} EGP`)}
            <table className="w-full text-[11px] border border-slate-300">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-300">
                  <th className="py-1.5 px-2 text-start">SKU</th>
                  <th className="py-1.5 px-2 text-start">{t(lang, 'الصنف', 'Ingredient')}</th>
                  <th className="py-1.5 px-2 text-start">{t(lang, 'الوحدة', 'Unit')}</th>
                  <th className="py-1.5 px-2 text-end">{t(lang, 'افتتاحي', 'Open')}</th>
                  <th className="py-1.5 px-2 text-end">{t(lang, 'مشتريات', 'Purch')}</th>
                  <th className="py-1.5 px-2 text-end">{t(lang, 'منصرف', 'Issued')}</th>
                  <th className="py-1.5 px-2 text-end">{t(lang, 'الرصيد الحالي', 'Current Qty')}</th>
                  <th className="py-1.5 px-2 text-end">{t(lang, 'متوسط التكلفة', 'WAC')}</th>
                  <th className="py-1.5 px-2 text-end">{t(lang, 'القيمة', 'Stock Value')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {state.ingredients.map((ing) => (
                  <tr key={ing.id}>
                    <td className="py-1.5 px-2 font-mono-num" dir="ltr">{ing.sku}</td>
                    <td className="py-1.5 px-2 font-medium">{lang === 'ar' ? ing.nameAr : ing.nameEn}</td>
                    <td className="py-1.5 px-2">{ing.unit}</td>
                    <td className="py-1.5 px-2 text-end font-mono-num" dir="ltr">{ing.openingQty}</td>
                    <td className="py-1.5 px-2 text-end font-mono-num" dir="ltr">{ing.purchasedQty}</td>
                    <td className="py-1.5 px-2 text-end font-mono-num" dir="ltr">{ing.issuedQty}</td>
                    <td className="py-1.5 px-2 text-end font-mono-num font-bold" dir="ltr">{ing.currentQty}</td>
                    <td className="py-1.5 px-2 text-end font-mono-num" dir="ltr">{fmtMoney(ing.weightedAvgCost, 2)}</td>
                    <td className="py-1.5 px-2 text-end font-mono-num font-bold" dir="ltr">
                      {fmtMoney(ing.currentQty * ing.weightedAvgCost, 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      }

      case 'menu_bom':
        return (
          <section key={key} className={`${breakCls} py-2`}>
            {renderDocHeader('دليل المنيو وتكلفة الوصفات المعيارية (BOM)', 'Menu Catalog & BOM Recipe Costing', `ITEMS: ${state.menuItems.length}`)}
            <table className="w-full text-[11px] border border-slate-300">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-300">
                  <th className="py-1.5 px-2 text-start">{t(lang, 'الكود', 'Code')}</th>
                  <th className="py-1.5 px-2 text-start">{t(lang, 'الصنف', 'Menu Item')}</th>
                  <th className="py-1.5 px-2 text-start">{t(lang, 'القسم', 'Category')}</th>
                  <th className="py-1.5 px-2 text-end">{t(lang, 'سعر البيع', 'Gross Price')}</th>
                  <th className="py-1.5 px-2 text-end">{t(lang, 'Food Cost %', 'Target FC %')}</th>
                  <th className="py-1.5 px-2 text-end">{t(lang, 'مكونات BOM', 'BOM Lines')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {state.menuItems.map((m) => (
                  <tr key={m.id}>
                    <td className="py-1 px-2 font-mono-num" dir="ltr">{m.code}</td>
                    <td className="py-1 px-2 font-medium">{lang === 'ar' ? m.nameAr : m.nameEn}</td>
                    <td className="py-1 px-2">{lang === 'ar' ? m.categoryAr : m.categoryEn}</td>
                    <td className="py-1 px-2 text-end font-mono-num font-bold" dir="ltr">{fmtMoney(m.sellingPriceGross, 2)}</td>
                    <td className="py-1 px-2 text-end font-mono-num" dir="ltr">{m.targetFoodCostPct}%</td>
                    <td className="py-1 px-2 text-end font-mono-num" dir="ltr">{m.recipe.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );

      case 'stocktake':
        return (
          <section key={key} className={`${breakCls} py-2`}>
            {renderDocHeader('تقرير الجرد الفعلي والانحرافات المخزنية', 'Physical Stocktake & Variance Report', `COUNTS: ${(state.stocktakeEntries ?? []).length}`)}
            <table className="w-full text-[11px] border border-slate-300">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-300">
                  <th className="py-1.5 px-2 text-start">{t(lang, 'رقم الجرد', 'Count #')}</th>
                  <th className="py-1.5 px-2 text-start">{t(lang, 'التاريخ / الموقع', 'Date / Site')}</th>
                  <th className="py-1.5 px-2 text-start">{t(lang, 'الصنف', 'Ingredient')}</th>
                  <th className="py-1.5 px-2 text-end">{t(lang, 'دفتري', 'Book')}</th>
                  <th className="py-1.5 px-2 text-end">{t(lang, 'فعلي', 'Actual')}</th>
                  <th className="py-1.5 px-2 text-end">{t(lang, 'الفرق %', 'Var %')}</th>
                  <th className="py-1.5 px-2 text-end">{t(lang, 'قيمة الفارق', 'Var Value')}</th>
                  <th className="py-1.5 px-2 text-start">{t(lang, 'الحالة', 'Status')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {(state.stocktakeEntries ?? []).map((s) => (
                  <tr key={s.id}>
                    <td className="py-1.5 px-2 font-mono-num font-semibold" dir="ltr">{s.countNo}</td>
                    <td className="py-1.5 px-2">{s.date} · {lang === 'ar' ? s.locationAr : s.locationEn}</td>
                    <td className="py-1.5 px-2">{lang === 'ar' ? s.ingredientNameAr : s.ingredientNameEn}</td>
                    <td className="py-1.5 px-2 text-end font-mono-num" dir="ltr">{s.bookQty}</td>
                    <td className="py-1.5 px-2 text-end font-mono-num" dir="ltr">{s.actualQty}</td>
                    <td className="py-1.5 px-2 text-end font-mono-num" dir="ltr">{fmtPct(s.variancePct)}</td>
                    <td className="py-1.5 px-2 text-end font-mono-num font-bold" dir="ltr">{fmtMoney(s.varianceValue, 2)}</td>
                    <td className="py-1.5 px-2">{s.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );

      case 'waste_expenses':
        return (
          <section key={key} className={`${breakCls} py-2 space-y-5`}>
            {renderDocHeader('تقرير الهالك والمصروفات التشغيلية', 'Waste & Operating Expenses Register')}
            <div>
              <h3 className="text-xs font-bold mb-2">{t(lang, 'أولاً: سجل الهالك والتالف', '1. Waste & Spoilage Entries')}</h3>
              <table className="w-full text-[11px] border border-slate-300">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-300">
                    <th className="py-1.5 px-2 text-start">{t(lang, 'المرجع', 'Ref #')}</th>
                    <th className="py-1.5 px-2 text-start">{t(lang, 'التاريخ', 'Date')}</th>
                    <th className="py-1.5 px-2 text-start">{t(lang, 'الصنف', 'Ingredient')}</th>
                    <th className="py-1.5 px-2 text-start">{t(lang, 'السبب', 'Reason')}</th>
                    <th className="py-1.5 px-2 text-end">{t(lang, 'الكمية', 'Qty')}</th>
                    <th className="py-1.5 px-2 text-end">{t(lang, 'القيمة', 'Value')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {state.wasteEntries.map((w) => (
                    <tr key={w.id}>
                      <td className="py-1.5 px-2 font-mono-num" dir="ltr">{w.wasteNo}</td>
                      <td className="py-1.5 px-2 font-mono-num" dir="ltr">{w.date}</td>
                      <td className="py-1.5 px-2">{w.ingredientNameAr}</td>
                      <td className="py-1.5 px-2">{w.reason}</td>
                      <td className="py-1.5 px-2 text-end font-mono-num" dir="ltr">{w.qty}</td>
                      <td className="py-1.5 px-2 text-end font-mono-num font-bold" dir="ltr">{fmtMoney(w.totalValue, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div>
              <h3 className="text-xs font-bold mb-2">{t(lang, 'ثانياً: المصروفات التشغيلية المعتمدة', '2. Operating Expenses Register')}</h3>
              <table className="w-full text-[11px] border border-slate-300">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-300">
                    <th className="py-1.5 px-2 text-start">{t(lang, 'المرجع', 'Expense #')}</th>
                    <th className="py-1.5 px-2 text-start">{t(lang, 'التاريخ', 'Date')}</th>
                    <th className="py-1.5 px-2 text-start">{t(lang, 'الحساب / المستفيد', 'Category / Beneficiary')}</th>
                    <th className="py-1.5 px-2 text-start">{t(lang, 'مركز التكلفة', 'Cost Center')}</th>
                    <th className="py-1.5 px-2 text-end">{t(lang, 'الصافي', 'Net')}</th>
                    <th className="py-1.5 px-2 text-end">{t(lang, 'ضريبة', 'VAT')}</th>
                    <th className="py-1.5 px-2 text-end">{t(lang, 'الإجمالي', 'Total')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {state.expenses.map((e) => (
                    <tr key={e.id}>
                      <td className="py-1.5 px-2 font-mono-num" dir="ltr">{e.expenseNo}</td>
                      <td className="py-1.5 px-2 font-mono-num" dir="ltr">{e.date}</td>
                      <td className="py-1.5 px-2">{e.categoryNameAr} — {e.beneficiary}</td>
                      <td className="py-1.5 px-2">{e.costCenter}</td>
                      <td className="py-1.5 px-2 text-end font-mono-num" dir="ltr">{fmtMoney(e.amountNet, 2)}</td>
                      <td className="py-1.5 px-2 text-end font-mono-num" dir="ltr">{fmtMoney(e.vatAmount, 2)}</td>
                      <td className="py-1.5 px-2 text-end font-mono-num font-bold" dir="ltr">{fmtMoney(e.totalAmount, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );

      case 'bank_statement':
        return (
          <section key={key} className={`${breakCls} py-2`}>
            {renderDocHeader('كشف حساب بنك CIB وتسوية 1103', 'CIB Bank Statement & Reconciliation', `TXNS: ${state.bankTransactions.length}`)}
            <table className="w-full text-[11px] border border-slate-300">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-300">
                  <th className="py-1.5 px-2 text-start">{t(lang, 'التاريخ', 'Date')}</th>
                  <th className="py-1.5 px-2 text-start">{t(lang, 'المرجع البنكي', 'Bank Ref')}</th>
                  <th className="py-1.5 px-2 text-start">{t(lang, 'البيان', 'Description')}</th>
                  <th className="py-1.5 px-2 text-end">{t(lang, 'مدين (وارد)', 'Debit (+)')}</th>
                  <th className="py-1.5 px-2 text-end">{t(lang, 'دائن (صادر)', 'Credit (-)')}</th>
                  <th className="py-1.5 px-2 text-end">{t(lang, 'الرصيد التراكمي', 'Running Bal')}</th>
                  <th className="py-1.5 px-2 text-start">{t(lang, 'المطابقة', 'Match')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {state.bankTransactions.map((b) => (
                  <tr key={b.id}>
                    <td className="py-1.5 px-2 font-mono-num" dir="ltr">{b.date}</td>
                    <td className="py-1.5 px-2 font-mono-num" dir="ltr">{b.bankRef}</td>
                    <td className="py-1.5 px-2">{b.description}</td>
                    <td className="py-1.5 px-2 text-end font-mono-num" dir="ltr">{fmtMoney(b.debit, 2)}</td>
                    <td className="py-1.5 px-2 text-end font-mono-num" dir="ltr">{fmtMoney(b.credit, 2)}</td>
                    <td className="py-1.5 px-2 text-end font-mono-num font-bold" dir="ltr">{fmtMoney(b.runningBalance ?? 0, 2)}</td>
                    <td className="py-1.5 px-2">{b.matchStatus}{b.matchedJournalId ? ` (${b.matchedJournalId})` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );

      case 'accounting_vat': {
        const vatOut = state.journalEntries.reduce(
          (s, j) => s + j.lines.filter((l) => l.accountCode === '2102').reduce((a, l) => a + l.credit - l.debit, 0),
          0
        );
        const vatIn = state.journalEntries.reduce(
          (s, j) => s + j.lines.filter((l) => l.accountCode === '1104').reduce((a, l) => a + l.debit - l.credit, 0),
          0
        );
        return (
          <section key={key} className={`${breakCls} py-2 space-y-5`}>
            {renderDocHeader('دفتر اليومية وميزان المراجعة وإقرار ضريبة القيمة المضافة', 'General Ledger, Trial Balance & VAT 14% Return', tb.balanced ? 'BALANCED' : 'UNBALANCED')}

            <div className="grid grid-cols-3 gap-3 p-3 border border-slate-300 rounded-lg bg-slate-50">
              <div>
                <div className="text-[10px] text-slate-500">{t(lang, 'ضريبة المخرجات (2102)', 'Output VAT (2102)')}</div>
                <div className="font-mono-num font-bold text-sm" dir="ltr">{fmtMoney(vatOut, 2)} EGP</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500">{t(lang, 'ضريبة المدخلات (1104)', 'Input VAT (1104)')}</div>
                <div className="font-mono-num font-bold text-sm" dir="ltr">{fmtMoney(vatIn, 2)} EGP</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500">{t(lang, 'صافي الضريبة المستحقة للمصلحة', 'Net VAT Payable (ETA)')}</div>
                <div className="font-mono-num font-bold text-sm text-teal-800" dir="ltr">{fmtMoney(vatOut - vatIn, 2)} EGP</div>
              </div>
            </div>

            <div>
              <h3 className="text-xs font-bold mb-2">{t(lang, 'شجرة الحسابات والأرصدة الختامية', 'Chart of Accounts & Balances')}</h3>
              <table className="w-full text-[11px] border border-slate-300">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-300">
                    <th className="py-1.5 px-2 text-start">{t(lang, 'كود الحساب', 'Code')}</th>
                    <th className="py-1.5 px-2 text-start">{t(lang, 'اسم الحساب', 'Account Name')}</th>
                    <th className="py-1.5 px-2 text-start">{t(lang, 'النوع', 'Type')}</th>
                    <th className="py-1.5 px-2 text-end">{t(lang, 'الرصيد', 'Balance (EGP)')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {state.accounts.map((acc) => (
                    <tr key={acc.code}>
                      <td className="py-1 px-2 font-mono-num font-semibold" dir="ltr">{acc.code}</td>
                      <td className="py-1 px-2">{lang === 'ar' ? acc.nameAr : acc.nameEn}</td>
                      <td className="py-1 px-2">{acc.type}</td>
                      <td className="py-1 px-2 text-end font-mono-num font-bold" dir="ltr">
                        {fmtMoney(balances[acc.code] ?? 0, 2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div>
              <h3 className="text-xs font-bold mb-2">
                {t(lang, `دفتر قيود اليومية العامة (${state.journalEntries.length} قيد)`, `General Journal Entries (${state.journalEntries.length})`)}
              </h3>
              <table className="w-full text-[11px] border border-slate-300">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-300">
                    <th className="py-1.5 px-2 text-start">{t(lang, 'رقم القيد', 'Journal #')}</th>
                    <th className="py-1.5 px-2 text-start">{t(lang, 'التاريخ', 'Date')}</th>
                    <th className="py-1.5 px-2 text-start">{t(lang, 'المرجع والبيان', 'Ref & Description')}</th>
                    <th className="py-1.5 px-2 text-end">{t(lang, 'إجمالي مدين', 'Total Dr')}</th>
                    <th className="py-1.5 px-2 text-end">{t(lang, 'إجمالي دائن', 'Total Cr')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {state.journalEntries.slice(0, 60).map((j) => {
                    const dr = j.lines.reduce((s, l) => s + l.debit, 0);
                    const cr = j.lines.reduce((s, l) => s + l.credit, 0);
                    return (
                      <tr key={j.id}>
                        <td className="py-1 px-2 font-mono-num font-semibold" dir="ltr">{j.journalNo}</td>
                        <td className="py-1 px-2 font-mono-num" dir="ltr">{j.date}</td>
                        <td className="py-1 px-2">{j.referenceNo} — {j.description}</td>
                        <td className="py-1 px-2 text-end font-mono-num" dir="ltr">{fmtMoney(dr, 2)}</td>
                        <td className="py-1 px-2 text-end font-mono-num" dir="ltr">{fmtMoney(cr, 2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      }

      case 'strategy_risks':
        return (
          <section key={key} className={`${breakCls} py-2 space-y-5`}>
            {renderDocHeader('خطة 2027 وسجل المخاطر وسجل التدقيق التاريخي', '2027 Strategy, CFO Risk Register & Audit Trail')}
            <div>
              <h3 className="text-xs font-bold mb-2">{t(lang, 'سجل المخاطر ومتابعة المعالجة (Risk Register)', 'CFO Risk Register & Mitigation Progress')}</h3>
              <table className="w-full text-[11px] border border-slate-300">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-300">
                    <th className="py-1.5 px-2 text-start">{t(lang, 'الكود', 'Code')}</th>
                    <th className="py-1.5 px-2 text-start">{t(lang, 'الخطر', 'Risk')}</th>
                    <th className="py-1.5 px-2 text-start">{t(lang, 'التأثير', 'Impact')}</th>
                    <th className="py-1.5 px-2 text-start">{t(lang, 'الإجراء التصحيحي', 'Corrective Action')}</th>
                    <th className="py-1.5 px-2 text-start">{t(lang, 'المكلف', 'Owner')}</th>
                    <th className="py-1.5 px-2 text-start">{t(lang, 'الحالة', 'Status')}</th>
                    <th className="py-1.5 px-2 text-end">{t(lang, 'السجل التاريخي', 'History')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {(state.strategy2027.risks ?? []).map((r, i) => (
                    <tr key={r.id}>
                      <td className="py-1.5 px-2 font-mono-num font-bold" dir="ltr">{r.code || `RSK-${i + 1}`}</td>
                      <td className="py-1.5 px-2 font-semibold">{lang === 'ar' ? r.riskAr : r.riskEn}</td>
                      <td className="py-1.5 px-2 font-bold uppercase">{r.impact}</td>
                      <td className="py-1.5 px-2">{lang === 'ar' ? r.mitigationAr : r.mitigationEn}</td>
                      <td className="py-1.5 px-2">{lang === 'ar' ? r.ownerAr : r.ownerEn}</td>
                      <td className="py-1.5 px-2 font-semibold">{r.status ?? 'open'}</td>
                      <td className="py-1.5 px-2 text-end font-mono-num" dir="ltr">{(r.auditHistory ?? []).length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div>
              <h3 className="text-xs font-bold mb-2">{t(lang, 'أحدث قيود سجل التدقيق العام (Audit Trail)', 'Recent Global Audit Trail Entries')}</h3>
              <table className="w-full text-[11px] border border-slate-300">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-300">
                    <th className="py-1.5 px-2 text-start">{t(lang, 'التوقيت', 'Timestamp')}</th>
                    <th className="py-1.5 px-2 text-start">{t(lang, 'المستخدم', 'Actor')}</th>
                    <th className="py-1.5 px-2 text-start">{t(lang, 'الإجراء', 'Action')}</th>
                    <th className="py-1.5 px-2 text-start">{t(lang, 'التفاصيل', 'Details')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {state.auditLogs.slice(0, 25).map((a) => (
                    <tr key={a.id}>
                      <td className="py-1 px-2 font-mono-num" dir="ltr">{a.timestamp}</td>
                      <td className="py-1 px-2">{a.user}</td>
                      <td className="py-1 px-2 font-semibold">{a.action}</td>
                      <td className="py-1 px-2">{a.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );

      case 'household': {
        const inc = (state.householdEntries ?? []).filter((h) => h.type === 'income').reduce((s, h) => s + h.amount, 0);
        const exp = (state.householdEntries ?? []).filter((h) => h.type !== 'income').reduce((s, h) => s + h.amount, 0);
        return (
          <section key={key} className={`${breakCls} py-2`}>
            {renderDocHeader('دفتر حساب البيت المنفصل (معزول عن الشركة)', 'Separate Household Ledger (Isolated)', `NET: ${fmtMoney(inc - exp, 2)} EGP`)}
            <table className="w-full text-[11px] border border-slate-300">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-300">
                  <th className="py-1.5 px-2 text-start">{t(lang, 'رقم البند', 'Entry #')}</th>
                  <th className="py-1.5 px-2 text-start">{t(lang, 'التاريخ', 'Date')}</th>
                  <th className="py-1.5 px-2 text-start">{t(lang, 'النوع / التصنيف', 'Type / Category')}</th>
                  <th className="py-1.5 px-2 text-start">{t(lang, 'البيان', 'Description')}</th>
                  <th className="py-1.5 px-2 text-start">{t(lang, 'الفرد', 'Member')}</th>
                  <th className="py-1.5 px-2 text-end">{t(lang, 'المبلغ', 'Amount')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {(state.householdEntries ?? []).map((h) => (
                  <tr key={h.id}>
                    <td className="py-1.5 px-2 font-mono-num" dir="ltr">{h.entryNo}</td>
                    <td className="py-1.5 px-2 font-mono-num" dir="ltr">{h.date}</td>
                    <td className="py-1.5 px-2">{h.type} · {lang === 'ar' ? h.categoryAr : h.categoryEn}</td>
                    <td className="py-1.5 px-2">{h.description}</td>
                    <td className="py-1.5 px-2">{h.memberName}</td>
                    <td className="py-1.5 px-2 text-end font-mono-num font-bold" dir="ltr">{fmtMoney(h.amount, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      }
    }
  };

  return (
    <div className="p-6 text-slate-900 bg-white text-xs space-y-6" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      {orderedKeys.map((k, idx) => renderSection(k, idx))}
      {orderedKeys.length > 0 && renderSignatures()}
    </div>
  );
};
