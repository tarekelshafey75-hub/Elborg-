import React, { useMemo, useState } from 'react';
import {
  BookOpenCheck,
  CalendarRange,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Landmark,
  Percent,
  Printer,
  ReceiptText,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import { ErpState, Language } from '../types/erp';
import {
  computeAccountBalances,
  computeTrialBalanceTotals,
  computeVatReportSummary,
  VatReportPeriod,
} from '../utils/erpEngine';
import { fmtMoney, fmtPct, t } from '../utils/formatters';

interface AccountingBankModuleProps {
  state: ErpState;
  lang: Language;
  onReverseJournal: (journalId: string) => Promise<void>;
  onReconcileBank: (bankTxnId: string) => Promise<void>;
  onRecordExpense: (payload: {
    categoryAccountCode: string;
    beneficiary: string;
    amountNet: number;
    applyVat: boolean;
    paymentMethod: 'cash' | 'visa_cib';
  }) => Promise<void>;
}

export const AccountingBankModule: React.FC<AccountingBankModuleProps> = ({
  state,
  lang,
  onReverseJournal,
  onReconcileBank,
  onRecordExpense,
}) => {
  const [subTab, setSubTab] = useState<'journals' | 'coa' | 'bank' | 'vat' | 'expense'>('journals');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [vatPeriod, setVatPeriod] = useState<VatReportPeriod>('all_incl_live');
  const [vatDetailTab, setVatDetailTab] = useState<'schedule' | 'sales' | 'inputs' | 'ledger'>('schedule');

  const [expAccount, setExpAccount] = useState('5301');
  const [expBeneficiary, setExpBeneficiary] = useState('شركة كهرباء ومياه المنوفية');
  const [expAmount, setExpAmount] = useState<number>(4500);
  const [expVat, setExpVat] = useState(true);
  const [expPay, setExpPay] = useState<'cash' | 'visa_cib'>('visa_cib');

  const balances = useMemo(() => computeAccountBalances(state), [state]);
  const tb = useMemo(() => computeTrialBalanceTotals(state), [state]);
  const vatReport = useMemo(() => computeVatReportSummary(state, vatPeriod), [state, vatPeriod]);

  const filteredJournals = useMemo(() => {
    if (sourceFilter === 'all') return state.journalEntries;
    return state.journalEntries.filter((j) => j.source === sourceFilter);
  }, [state.journalEntries, sourceFilter]);

  const handleExportVatCsv = () => {
    const headers = [
      'الفترة / Period',
      'إجمالي المبيعات (Gross)',
      'صافي المبيعات الخاضعة (Net Sales)',
      'ضريبة المخرجات المحصلة 14% (2201)',
      'صافي المشتريات والمصروفات الخاضعة',
      'ضريبة المدخلات القابلة للخصم 14% (1105)',
      'صافي الضريبة المستحقة للسداد (Net VAT)',
      'نسبة الاسترداد %',
    ];
    const rows = vatReport.monthlyRows.map((r) => [
      `"${lang === 'ar' ? r.labelAr : r.labelEn}"`,
      r.grossSales.toFixed(2),
      r.netSales.toFixed(2),
      r.outputVat.toFixed(2),
      r.taxablePurchasesNet.toFixed(2),
      r.inputVat.toFixed(2),
      r.netPayable.toFixed(2),
      r.offsetPct.toFixed(2),
    ]);
    rows.push([
      `"${lang === 'ar' ? 'الإجمالي للفترة المختارة' : 'Period Total'}"`,
      vatReport.grossSalesTotal.toFixed(2),
      vatReport.netSalesTotal.toFixed(2),
      vatReport.outputVatTotal.toFixed(2),
      (vatReport.taxablePurchasesNet + vatReport.taxableExpensesNet).toFixed(2),
      vatReport.inputVatTotal.toFixed(2),
      vatReport.netVatPayable.toFixed(2),
      vatReport.recoveryRatioPct.toFixed(2),
    ]);
    const csv = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `VAT_Report_${state.taxId}_${vatPeriod}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExpenseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (expAmount <= 0 || !expBeneficiary.trim()) return;
    await onRecordExpense({
      categoryAccountCode: expAccount,
      beneficiary: expBeneficiary,
      amountNet: expAmount,
      applyVat: expVat,
      paymentMethod: expPay,
    });
    setSubTab('journals');
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <BookOpenCheck className="w-5 h-5 text-teal-700" />
            {t(lang, 'النظام المحاسبي الآلي وتسوية بنك CIB', 'Auto General Ledger, Trial Balance & CIB Bank Recon')}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mt-1">
            <span className={tb.balanced ? 'text-emerald-700 font-semibold' : 'text-red-600 font-semibold'}>
              {tb.balanced
                ? t(lang, 'ميزان المراجعة متوازن 100% (Debit = Credit)', 'Trial Balance Balanced 100% (Dr = Cr)')
                : t(lang, 'يوجد فرق في ميزان المراجعة', 'Trial Balance Imbalance')}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-num" dir="ltr">
              {fmtMoney(tb.totalDebit, 2)} EGP
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-num text-emerald-700 font-medium" dir="ltr">
              1103 = {fmtMoney(balances['1103'] ?? 0, 2)}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 no-print">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 text-xs font-semibold whitespace-nowrap transition-colors"
          >
            <Printer className="w-3.5 h-3.5 text-slate-600" />
            <span>{t(lang, 'طباعة', 'Print')}</span>
          </button>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
            {(
              [
                { id: 'journals', ar: 'دفتر القيود الآلية', en: 'Journal Entries' },
                { id: 'coa', ar: 'شجرة الحسابات والميزان', en: 'COA & Trial Balance' },
                { id: 'bank', ar: 'تسوية بنك CIB و 1103', en: 'CIB & 1103 Recon' },
                { id: 'vat', ar: 'تقرير ضريبة القيمة المضافة (VAT)', en: 'VAT Tax Report' },
                { id: 'expense', ar: '+ تسجيل مصروف', en: '+ Record Expense' },
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

      {/* TAB 1: JOURNAL ENTRIES */}
      {subTab === 'journals' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { id: 'all', ar: 'الكل', en: 'All' },
              { id: 'pos_sale', ar: 'مبيعات POS', en: 'POS Sales' },
              { id: 'purchase', ar: 'مشتريات', en: 'Purchases' },
              { id: 'expense', ar: 'مصروفات', en: 'Expenses' },
              { id: 'waste', ar: 'هالك', en: 'Waste' },
              { id: 'bank_settlement', ar: 'تسوية CIB/1103', en: 'CIB/1103 Settlement' },
              { id: 'q1_summary', ar: 'ملخص Q1', en: 'Q1 Summary' },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setSourceFilter(f.id)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                  sourceFilter === f.id
                    ? 'bg-teal-700 border-teal-700 text-white'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                {lang === 'ar' ? f.ar : f.en}
              </button>
            ))}
          </div>

          <div className="space-y-4">
            {filteredJournals.map((je) => {
              const jeDebit = je.lines.reduce((a, l) => a + l.debit, 0);
              const jeCredit = je.lines.reduce((a, l) => a + l.credit, 0);
              return (
                <div key={je.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono-num font-bold text-slate-900" dir="ltr">{je.journalNo}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono-num text-slate-600" dir="ltr">{je.date}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-medium text-slate-800">{je.description}</span>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="font-mono-num text-slate-600" dir="ltr">
                        Dr/Cr: {fmtMoney(jeDebit, 2)}
                      </span>
                      {!je.isReversal && !je.reversedByJournalId && je.source !== 'opening' && (
                        <button
                          onClick={() => onReverseJournal(je.id)}
                          className="text-amber-700 hover:underline inline-flex items-center gap-1 font-medium"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          {t(lang, 'عكس القيد', 'Reverse')}
                        </button>
                      )}
                      {je.reversedByJournalId && (
                        <span className="text-red-600 font-medium">{t(lang, 'تم عكسه', 'Reversed')}</span>
                      )}
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-100 text-slate-500">
                          <th className="py-2 px-4 text-start font-medium">{t(lang, 'كود الحساب', 'Code')}</th>
                          <th className="py-2 px-4 text-start font-medium">{t(lang, 'اسم الحساب', 'Account')}</th>
                          <th className="py-2 px-4 text-start font-medium">{t(lang, 'البيان', 'Memo')}</th>
                          <th className="py-2 px-4 text-end font-medium">{t(lang, 'مدين (Debit)', 'Debit')}</th>
                          <th className="py-2 px-4 text-end font-medium">{t(lang, 'دائن (Credit)', 'Credit')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {je.lines.map((l, idx) => (
                          <tr key={idx}>
                            <td className="py-2 px-4 font-mono-num text-slate-600" dir="ltr">{l.accountCode}</td>
                            <td className="py-2 px-4 font-medium text-slate-900">{l.accountNameAr}</td>
                            <td className="py-2 px-4 text-slate-600">{l.description}</td>
                            <td className="py-2 px-4 text-end font-mono-num text-slate-900" dir="ltr">
                              {l.debit > 0 ? fmtMoney(l.debit, 2) : '—'}
                            </td>
                            <td className="py-2 px-4 text-end font-mono-num text-slate-900" dir="ltr">
                              {l.credit > 0 ? fmtMoney(l.credit, 2) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 2: CHART OF ACCOUNTS & TRIAL BALANCE */}
      {subTab === 'coa' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <th className="py-3 px-4 text-start font-semibold">{t(lang, 'كود الحساب', 'Code')}</th>
                  <th className="py-3 px-4 text-start font-semibold">{t(lang, 'اسم الحساب', 'Account Name')}</th>
                  <th className="py-3 px-4 text-start font-semibold">{t(lang, 'التصنيف', 'Type')}</th>
                  <th className="py-3 px-4 text-start font-semibold">{t(lang, 'الطبيعة', 'Normal')}</th>
                  <th className="py-3 px-4 text-end font-semibold">{t(lang, 'الرصيد الحالي (ج.م)', 'Current Balance (EGP)')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {state.accounts.map((acc) => {
                  const bal = balances[acc.code] ?? 0;
                  return (
                    <tr key={acc.code} className={acc.code === '1103' ? 'bg-emerald-50/40' : 'hover:bg-slate-50'}>
                      <td className="py-2.5 px-4 font-mono-num font-bold text-slate-900" dir="ltr">{acc.code}</td>
                      <td className="py-2.5 px-4 font-semibold text-slate-900">
                        {lang === 'ar' ? acc.nameAr : acc.nameEn}
                      </td>
                      <td className="py-2.5 px-4 text-slate-600">{acc.type}</td>
                      <td className="py-2.5 px-4 text-slate-600">{acc.normalBalance}</td>
                      <td className="py-2.5 px-4 text-end font-mono-num font-bold text-slate-900" dir="ltr">
                        {fmtMoney(bal, 2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: BANK RECONCILIATION */}
      {subTab === 'bank' && (
        <div className="space-y-4">
          <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-4 flex items-start gap-3">
            <Landmark className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
            <div className="text-xs text-slate-800 space-y-1">
              <div className="font-bold text-emerald-900">
                {t(lang, 'حالة تسوية بنك CIB وحساب وسيط 1103 (VISA/POS)', 'CIB Bank & Account 1103 (VISA/POS) Clearing Status')}
              </div>
              <div>
                {t(
                  lang,
                  `رصيد بنك CIB (1102): ${fmtMoney(balances['1102'] ?? 0, 2)} ج.م · رصيد حساب 1103: ${fmtMoney(balances['1103'] ?? 0, 2)} ج.م (تم توريد تسوية 1,276,578.62 ج.م بالكامل في 20 أبريل 2026).`,
                  `CIB Balance (1102): ${fmtMoney(balances['1102'] ?? 0, 2)} EGP · Account 1103: ${fmtMoney(balances['1103'] ?? 0, 2)} EGP (1,276,578.62 EGP batch settled 20 Apr 2026).`
                )}
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <th className="py-3 px-4 text-start font-semibold">{t(lang, 'المرجع البنكي', 'Bank Ref')}</th>
                    <th className="py-3 px-4 text-start font-semibold">{t(lang, 'التاريخ', 'Date')}</th>
                    <th className="py-3 px-4 text-start font-semibold">{t(lang, 'الوصف في كشف CIB', 'Bank Description')}</th>
                    <th className="py-3 px-4 text-end font-semibold">{t(lang, 'مدين (صادر)', 'Outflow')}</th>
                    <th className="py-3 px-4 text-end font-semibold">{t(lang, 'دائن (وارد)', 'Inflow')}</th>
                    <th className="py-3 px-4 text-end font-semibold">{t(lang, 'الحالة / الإجراء', 'Status / Action')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {state.bankTransactions.map((bt) => (
                    <tr key={bt.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-4 font-mono-num font-semibold" dir="ltr">{bt.bankRef}</td>
                      <td className="py-2.5 px-4 font-mono-num text-slate-600" dir="ltr">{bt.date}</td>
                      <td className="py-2.5 px-4 text-slate-800">{bt.description}</td>
                      <td className="py-2.5 px-4 text-end font-mono-num text-red-600" dir="ltr">
                        {bt.debit > 0 ? fmtMoney(bt.debit, 2) : '—'}
                      </td>
                      <td className="py-2.5 px-4 text-end font-mono-num text-emerald-700" dir="ltr">
                        {bt.credit > 0 ? fmtMoney(bt.credit, 2) : '—'}
                      </td>
                      <td className="py-2.5 px-4 text-end">
                        {bt.matchStatus === 'matched' ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            {t(lang, 'مطابق', 'Matched')}
                          </span>
                        ) : (
                          <button
                            onClick={() => onReconcileBank(bt.id)}
                            className="px-3 py-1 rounded-md bg-teal-700 hover:bg-teal-800 text-white text-[11px] font-semibold"
                          >
                            {t(lang, 'ترحيل ومطابقة القيد', 'Post & Match Entry')}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Monthly VISA Fee Anomaly Analysis (Jan–Sep 2026) */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">
                {t(lang, 'تحليل مصاريف وعمولة الفيزا شهرياً (يناير – سبتمبر 2026) — رصد انحراف مايو', 'Monthly VISA MDR Fee Analysis (Jan–Sep 2026) — May Anomaly Detection')}
              </h3>
              <span className="text-xs font-semibold text-red-600">
                {t(lang, 'انحراف مايو: 3.52% مقابل 1.06%', 'May Spike: 3.52% vs 1.06%')}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'الشهر', 'Month')}</th>
                    <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'مبيعات VISA POS', 'POS VISA Sales')}</th>
                    <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'المحصل بالبنك', 'Bank Settled')}</th>
                    <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'العمولة', 'Fee Amount')}</th>
                    <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'النسبة %', 'MDR %')}</th>
                    <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'ملاحظة التدقيق', 'Audit Note')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {state.strategy2027.visaMonthlyFees.map((v) => (
                    <tr key={v.monthKey} className={v.anomaly ? 'bg-red-50/60' : 'hover:bg-slate-50'}>
                      <td className={`py-2 px-4 font-semibold ${v.anomaly ? 'text-red-700' : 'text-slate-900'}`}>
                        {lang === 'ar' ? v.labelAr : v.labelEn}
                      </td>
                      <td className="py-2 px-4 text-end font-mono-num" dir="ltr">{fmtMoney(v.visaSales, 0)}</td>
                      <td className="py-2 px-4 text-end font-mono-num" dir="ltr">{fmtMoney(v.bankSettled, 0)}</td>
                      <td className="py-2 px-4 text-end font-mono-num" dir="ltr">{fmtMoney(v.feeAmount, 2)}</td>
                      <td className={`py-2 px-4 text-end font-mono-num font-bold ${v.anomaly ? 'text-red-600' : 'text-emerald-700'}`} dir="ltr">
                        {v.feePct.toFixed(2)}%
                      </td>
                      <td className={`py-2 px-4 ${v.anomaly ? 'text-red-700 font-medium' : 'text-slate-600'}`}>
                        {lang === 'ar' ? v.noteAr : v.noteEn}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: RECORD OPERATING EXPENSE */}
      {subTab === 'expense' && (
        <form onSubmit={handleExpenseSubmit} className="bg-white border border-slate-200 rounded-xl p-6 max-w-xl space-y-4">
          <h2 className="text-sm font-bold text-slate-900 border-b border-slate-200 pb-3">
            {t(lang, 'تسجيل مصروف تشغيلي (قيد يومية آلي)', 'Record Operating Expense (Auto Journal Entry)')}
          </h2>

          <div>
            <label className="block text-xs text-slate-600 mb-1">{t(lang, 'بند الحساب', 'Expense Account')}</label>
            <select
              value={expAccount}
              onChange={(e) => setExpAccount(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
            >
              <option value="5301">{t(lang, '5301 — مصروفات تشغيلية ومرافق', '5301 — Operating & Utilities')}</option>
              <option value="5201">{t(lang, '5201 — الرواتب والأجور', '5201 — Payroll & Wages')}</option>
              <option value="5202">{t(lang, '5202 — إيجار حق الانتفاع', '5202 — Usufruct Rent')}</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-slate-600 mb-1">{t(lang, 'المستفيد / المورد', 'Beneficiary')}</label>
            <input
              type="text"
              value={expBeneficiary}
              onChange={(e) => setExpBeneficiary(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-600 mb-1">{t(lang, 'المبلغ صافي (ج.م)', 'Net Amount (EGP)')}</label>
              <input
                type="number"
                min={1}
                value={expAmount}
                onChange={(e) => setExpAmount(Number(e.target.value) || 0)}
                className="w-full px-3 py-2 text-xs font-mono-num border border-slate-200 rounded-lg"
                dir="ltr"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-600 mb-1">{t(lang, 'حساب السداد', 'Payment Account')}</label>
              <select
                value={expPay}
                onChange={(e) => setExpPay(e.target.value as any)}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
              >
                <option value="visa_cib">{t(lang, 'بنك CIB (1102)', 'CIB Bank (1102)')}</option>
                <option value="cash">{t(lang, 'الخزينة (1101)', 'Cash Vault (1101)')}</option>
              </select>
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-700">
            <input type="checkbox" checked={expVat} onChange={(e) => setExpVat(e.target.checked)} />
            {t(lang, 'تطبيق ضريبة مدخلات 14% (حساب 1105)', 'Apply 14% Input VAT (COA 1105)')}
          </label>

          <button
            type="submit"
            className="w-full py-2.5 px-4 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold"
          >
            {t(lang, 'ترحيل المصروف وإنشاء القيد المتوازن', 'Post Expense & Balanced Journal')}
          </button>
        </form>
      )}

      {/* TAB 5: VAT REPORT MODULE */}
      {subTab === 'vat' && (
        <div className="space-y-5">
          {/* Period Filter & Actions Header */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <ReceiptText className="w-4 h-4 text-teal-700" />
                  {t(lang, 'تقرير الإقرار الضريبي لضريبة القيمة المضافة (نموذج 10 — مصلحة الضرائب المصرية)', 'VAT Return Report (ETA Form 10 — Tax Authority Summary)')}
                </h2>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mt-1">
                  <span>{t(lang, 'الفترة المختارة:', 'Selected Period:')}</span>
                  <span className="font-semibold text-teal-800">
                    {lang === 'ar' ? vatReport.periodLabelAr : vatReport.periodLabelEn}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{t(lang, 'التسجيل الضريبي:', 'Tax ID:')}</span>
                  <span className="font-mono-num font-bold text-slate-800" dir="ltr">{state.taxId}</span>
                  <span aria-hidden="true">·</span>
                  <span>{t(lang, 'السعر القياسي:', 'Standard Rate:')} <strong className="font-mono-num">14%</strong></span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleExportVatCsv}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-colors"
                >
                  <Download className="w-3.5 h-3.5 text-teal-700" />
                  {t(lang, 'تصدير CSV ضريبي', 'Export VAT CSV')}
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold transition-colors"
                >
                  <Printer className="w-3.5 h-3.5" />
                  {t(lang, 'طباعة الإقرار', 'Print Return')}
                </button>
              </div>
            </div>

            {/* Period Controls */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100">
              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    { id: 'all_incl_live', ar: 'كامل الفترة + المباشر', en: 'Full YTD + Live' },
                    { id: '9m_ytd', ar: '9 أشهر المدققة', en: 'Audited 9M' },
                    { id: 'Q1', ar: 'الربع الأول Q1', en: 'Q1 2026' },
                    { id: 'Q2', ar: 'الربع الثاني Q2', en: 'Q2 2026' },
                    { id: 'Q3', ar: 'الربع الثالث Q3', en: 'Q3 2026' },
                    { id: 'live_oct', ar: 'أكتوبر المباشر', en: 'Oct Live' },
                  ] as const
                ).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setVatPeriod(p.id)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                      vatPeriod === p.id
                        ? 'bg-teal-700 border-teal-700 text-white'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {lang === 'ar' ? p.ar : p.en}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <CalendarRange className="w-4 h-4 text-slate-500" />
                <label htmlFor="vat-month-select" className="text-xs text-slate-600 font-medium">
                  {t(lang, 'تصفية بشهر محدد:', 'Specific Month:')}
                </label>
                <select
                  id="vat-month-select"
                  value={vatPeriod.startsWith('2026-') ? vatPeriod : ''}
                  onChange={(e) => {
                    if (e.target.value) setVatPeriod(e.target.value as VatReportPeriod);
                  }}
                  className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white text-slate-800 font-medium"
                >
                  <option value="">{t(lang, '— اختر شهراً (يناير–سبتمبر) —', '— Select Month (Jan–Sep) —')}</option>
                  {state.monthlyActuals2026.map((m) => (
                    <option key={m.monthKey} value={m.monthKey}>
                      {lang === 'ar' ? m.labelAr : m.labelEn}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* 4 KPI Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1.5">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span className="font-semibold text-slate-700">
                  {t(lang, 'إجمالي الضرائب المحصلة (مخرجات)', 'Total Collected Output VAT')}
                </span>
                <span className="px-2 py-0.5 rounded bg-teal-50 text-teal-800 font-mono-num font-bold text-[11px]" dir="ltr">
                  COA 2201
                </span>
              </div>
              <div className="text-2xl font-bold font-mono-num text-teal-700" dir="ltr">
                {fmtMoney(vatReport.outputVatTotal, 2)} <span className="text-xs font-medium text-slate-500">EGP</span>
              </div>
              <div className="text-[11px] text-slate-500 flex items-center justify-between pt-1 border-t border-slate-100">
                <span>{t(lang, 'صافي المبيعات الخاضعة:', 'Taxable Net Sales:')}</span>
                <span className="font-mono-num font-semibold text-slate-700" dir="ltr">
                  {fmtMoney(vatReport.netSalesTotal, 0)}
                </span>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1.5">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span className="font-semibold text-slate-700">
                  {t(lang, 'ضريبة المدخلات القابلة للخصم', 'Deductible Input VAT')}
                </span>
                <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 font-mono-num font-bold text-[11px]" dir="ltr">
                  COA 1105
                </span>
              </div>
              <div className="text-2xl font-bold font-mono-num text-emerald-700" dir="ltr">
                {fmtMoney(vatReport.inputVatTotal, 2)} <span className="text-xs font-medium text-slate-500">EGP</span>
              </div>
              <div className="text-[11px] text-slate-500 flex items-center justify-between pt-1 border-t border-slate-100">
                <span>{t(lang, 'نسبة الخصم من المخرجات:', 'Input Offset Ratio:')}</span>
                <span className="font-mono-num font-semibold text-emerald-700" dir="ltr">
                  {fmtPct(vatReport.recoveryRatioPct, 1)}
                </span>
              </div>
            </div>

            <div
              className={`border rounded-xl p-4 space-y-1.5 ${
                vatReport.netVatPayable >= 0
                  ? 'bg-amber-50/70 border-amber-200'
                  : 'bg-emerald-50/70 border-emerald-200'
              }`}
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-800">
                  {t(lang, 'صافي الضريبة المستحقة للسداد', 'Net VAT Payable / (Credit)')}
                </span>
                <span
                  className={`px-2 py-0.5 rounded font-semibold text-[11px] ${
                    vatReport.netVatPayable >= 0
                      ? 'bg-amber-100 text-amber-900'
                      : 'bg-emerald-100 text-emerald-900'
                  }`}
                >
                  {vatReport.netVatPayable >= 0
                    ? t(lang, 'مستحق للضرائب', 'Payable to ETA')
                    : t(lang, 'رصيد دائن مرحل', 'Tax Credit')}
                </span>
              </div>
              <div
                className={`text-2xl font-bold font-mono-num ${
                  vatReport.netVatPayable >= 0 ? 'text-amber-800' : 'text-emerald-800'
                }`}
                dir="ltr"
              >
                {fmtMoney(vatReport.netVatPayable, 2)} <span className="text-xs font-medium">EGP</span>
              </div>
              <div className="text-[11px] text-slate-600 flex items-center justify-between pt-1 border-t border-amber-200/60">
                <span>{t(lang, 'المعادلة (مخرجات − مدخلات):', 'Formula (Output − Input):')}</span>
                <span className="font-mono-num font-semibold" dir="ltr">
                  {fmtPct(vatReport.effectiveVatPct, 2)} eff.
                </span>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1.5">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span className="font-semibold text-slate-700">
                  {t(lang, 'مطابقة دفتر الأستاذ (GL Live)', 'GL Reconciliation (2201 − 1105)')}
                </span>
                <ShieldCheck className="w-4 h-4 text-emerald-700" />
              </div>
              <div className="text-2xl font-bold font-mono-num text-slate-900" dir="ltr">
                {fmtMoney(vatReport.glNetPayable, 2)} <span className="text-xs font-medium text-slate-500">EGP</span>
              </div>
              <div className="text-[11px] text-slate-500 flex items-center justify-between pt-1 border-t border-slate-100">
                <span>
                  {t(lang, 'إيصالات ETA مرسلة:', 'ETA Submitted:')}{' '}
                  <strong className="font-mono-num text-slate-800">{vatReport.etaSubmittedCount}</strong>
                  {vatReport.etaQueuedCount > 0 && (
                    <span className="text-amber-700"> ({vatReport.etaQueuedCount} {t(lang, 'قيد المزامنة', 'queued')})</span>
                  )}
                </span>
                <span
                  className={`font-mono-num font-semibold ${
                    Math.abs(vatReport.glVariance) < 0.05 ? 'text-emerald-700' : 'text-amber-700'
                  }`}
                  dir="ltr"
                >
                  {vatPeriod === 'all_incl_live'
                    ? Math.abs(vatReport.glVariance) < 0.05
                      ? t(lang, 'مطابق 100%', '0.00 Diff')
                      : `${fmtMoney(vatReport.glVariance, 2)} diff`
                    : t(lang, 'رصيد إجمالي', 'Cumulative GL')}
                </span>
              </div>
            </div>
          </div>

          {/* Detail Sub-tabs */}
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: 'schedule', ar: 'جدول الإقرار والتوزيع الشهري', en: 'Return Schedule & Monthly Breakdown', icon: FileSpreadsheet },
                { id: 'sales', ar: `سجل فواتير المبيعات (${vatReport.salesInvoices.length})`, en: `Sales Output Register (${vatReport.salesInvoices.length})`, icon: Percent },
                { id: 'inputs', ar: `سجل المشتريات والمصروفات (${vatReport.purchaseInvoices.length + vatReport.taxableExpenses.length})`, en: `Purchases & Expense Inputs (${vatReport.purchaseInvoices.length + vatReport.taxableExpenses.length})`, icon: ReceiptText },
                { id: 'ledger', ar: `قيود ضريبة 2201 / 1105 (${vatReport.taxJournalRows.length})`, en: `GL Tax Ledger (${vatReport.taxJournalRows.length})`, icon: BookOpenCheck },
              ] as const
            ).map((d) => {
              const Icon = d.icon;
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setVatDetailTab(d.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                    vatDetailTab === d.id
                      ? 'bg-slate-900 border-slate-900 text-white'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {lang === 'ar' ? d.ar : d.en}
                </button>
              );
            })}
          </div>

          {/* DETAIL 1: OFFICIAL RETURN SCHEDULE + MONTHLY BREAKDOWN */}
          {vatDetailTab === 'schedule' && (
            <div className="space-y-5">
              {/* Official Tax Authority Form 10 Table */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-slate-900">
                    {t(lang, 'ملخص الإقرار الضريبي المقارن (مخرجات مقابل مدخلات)', 'Comparative Tax Return Summary (Output vs Input VAT)')}
                  </h3>
                  <span className="text-xs text-slate-500 font-mono-num" dir="ltr">
                    {lang === 'ar' ? vatReport.periodLabelAr : vatReport.periodLabelEn}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-600 bg-slate-50/50">
                        <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'البند الضريبي', 'Tax Line Item')}</th>
                        <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'الحساب', 'COA')}</th>
                        <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'الوعاء الخاضع (ج.م)', 'Taxable Base (EGP)')}</th>
                        <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'النسبة', 'Rate')}</th>
                        <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'قيمة الضريبة (ج.م)', 'VAT Amount (EGP)')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      <tr className="hover:bg-slate-50">
                        <td className="py-2.5 px-4 font-semibold text-slate-900">
                          {t(lang, 'أولاً: مبيعات المطعم الخاضعة للضريبة (صافي بدون ضريبة)', '1. Taxable Restaurant Sales (Net ex-VAT)')}
                        </td>
                        <td className="py-2.5 px-4 font-mono-num text-slate-500" dir="ltr">4101–4103</td>
                        <td className="py-2.5 px-4 text-end font-mono-num font-semibold text-slate-900" dir="ltr">
                          {fmtMoney(vatReport.netSalesTotal, 2)}
                        </td>
                        <td className="py-2.5 px-4 text-end font-mono-num text-slate-600" dir="ltr">14.0%</td>
                        <td className="py-2.5 px-4 text-end font-mono-num font-bold text-teal-700" dir="ltr">
                          +{fmtMoney(vatReport.outputVatTotal, 2)}
                        </td>
                      </tr>
                      <tr className="hover:bg-slate-50">
                        <td className="py-2.5 px-4 text-slate-800">
                          {t(lang, 'ثانياً: مشتريات خامات ومخزون خاضعة للضريبة (مدخلات)', '2. Taxable Raw Material & Inventory Purchases (Input)')}
                        </td>
                        <td className="py-2.5 px-4 font-mono-num text-slate-500" dir="ltr">1105</td>
                        <td className="py-2.5 px-4 text-end font-mono-num text-slate-800" dir="ltr">
                          {fmtMoney(vatReport.taxablePurchasesNet, 2)}
                        </td>
                        <td className="py-2.5 px-4 text-end font-mono-num text-slate-600" dir="ltr">14.0%</td>
                        <td className="py-2.5 px-4 text-end font-mono-num font-semibold text-emerald-700" dir="ltr">
                          −{fmtMoney(vatReport.inputVatPurchases, 2)}
                        </td>
                      </tr>
                      <tr className="hover:bg-slate-50">
                        <td className="py-2.5 px-4 text-slate-800">
                          {t(lang, 'ثالثاً: مصروفات تشغيلية ومرافق بفواتير ضريبية (مدخلات)', '3. Taxable Operating Expenses & Utilities (Input)')}
                        </td>
                        <td className="py-2.5 px-4 font-mono-num text-slate-500" dir="ltr">1105</td>
                        <td className="py-2.5 px-4 text-end font-mono-num text-slate-800" dir="ltr">
                          {fmtMoney(vatReport.taxableExpensesNet, 2)}
                        </td>
                        <td className="py-2.5 px-4 text-end font-mono-num text-slate-600" dir="ltr">14.0%</td>
                        <td className="py-2.5 px-4 text-end font-mono-num font-semibold text-emerald-700" dir="ltr">
                          −{fmtMoney(vatReport.inputVatExpenses, 2)}
                        </td>
                      </tr>
                    </tbody>
                    <tfoot>
                      <tr className="bg-amber-50/70 border-t-2 border-amber-200 font-bold">
                        <td className="py-3 px-4 text-slate-900" colSpan={2}>
                          {vatReport.netVatPayable >= 0
                            ? t(lang, 'صافي ضريبة القيمة المضافة المستحقة للسداد لمصلحة الضرائب (مخرجات − مدخلات)', 'Net VAT Payable to Tax Authority (Output − Input)')
                            : t(lang, 'صافي الرصيد الضريبي الدائن لصالح المنشأة (يرحل للفترة التالية)', 'Net Tax Credit Carried Forward')}
                        </td>
                        <td className="py-3 px-4 text-end font-mono-num text-slate-700" dir="ltr">
                          {fmtMoney(vatReport.grossSalesTotal, 2)} <span className="text-[10px] font-normal">({t(lang, 'إجمالي الفواتير', 'Gross')})</span>
                        </td>
                        <td className="py-3 px-4 text-end font-mono-num text-slate-700" dir="ltr">
                          {fmtPct(vatReport.recoveryRatioPct, 1)}
                        </td>
                        <td
                          className={`py-3 px-4 text-end font-mono-num text-sm ${
                            vatReport.netVatPayable >= 0 ? 'text-amber-800' : 'text-emerald-800'
                          }`}
                          dir="ltr"
                        >
                          {fmtMoney(vatReport.netVatPayable, 2)} EGP
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* Monthly Breakdown Table */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900">
                    {t(lang, 'التحليل الشهري لضريبة القيمة المضافة (محصلة مقابل مستحقة)', 'Monthly VAT Breakdown (Collected Output vs Deductible Input vs Net Payable)')}
                  </h3>
                  <span className="text-xs text-slate-500">
                    {vatReport.monthlyRows.length} {t(lang, 'فترات شهرية', 'monthly periods')}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                        <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'الشهر', 'Month')}</th>
                        <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'إجمالي المبيعات', 'Gross Sales')}</th>
                        <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'صافي المبيعات', 'Net Sales')}</th>
                        <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'ضريبة المخرجات (2201)', 'Output VAT')}</th>
                        <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'ضريبة المدخلات (1105)', 'Input VAT')}</th>
                        <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'نسبة الخصم %', 'Offset %')}</th>
                        <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'صافي الضريبة المستحقة', 'Net Payable')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {vatReport.monthlyRows.map((row) => (
                        <tr key={row.key} className={row.isLive ? 'bg-teal-50/40 font-medium' : 'hover:bg-slate-50'}>
                          <td className="py-2.5 px-4 font-semibold text-slate-900">
                            {lang === 'ar' ? row.labelAr : row.labelEn}
                          </td>
                          <td className="py-2.5 px-4 text-end font-mono-num text-slate-700" dir="ltr">{fmtMoney(row.grossSales, 2)}</td>
                          <td className="py-2.5 px-4 text-end font-mono-num text-slate-700" dir="ltr">{fmtMoney(row.netSales, 2)}</td>
                          <td className="py-2.5 px-4 text-end font-mono-num font-semibold text-teal-700" dir="ltr">{fmtMoney(row.outputVat, 2)}</td>
                          <td className="py-2.5 px-4 text-end font-mono-num font-semibold text-emerald-700" dir="ltr">{fmtMoney(row.inputVat, 2)}</td>
                          <td className="py-2.5 px-4 text-end font-mono-num text-slate-600" dir="ltr">{fmtPct(row.offsetPct, 1)}</td>
                          <td
                            className={`py-2.5 px-4 text-end font-mono-num font-bold ${
                              row.netPayable >= 0 ? 'text-amber-800' : 'text-emerald-700'
                            }`}
                            dir="ltr"
                          >
                            {fmtMoney(row.netPayable, 2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-100 border-t border-slate-200 font-bold text-slate-900">
                        <td className="py-3 px-4">{t(lang, 'الإجمالي العام للفترة', 'Period Total')}</td>
                        <td className="py-3 px-4 text-end font-mono-num" dir="ltr">{fmtMoney(vatReport.grossSalesTotal, 2)}</td>
                        <td className="py-3 px-4 text-end font-mono-num" dir="ltr">{fmtMoney(vatReport.netSalesTotal, 2)}</td>
                        <td className="py-3 px-4 text-end font-mono-num text-teal-800" dir="ltr">{fmtMoney(vatReport.outputVatTotal, 2)}</td>
                        <td className="py-3 px-4 text-end font-mono-num text-emerald-800" dir="ltr">{fmtMoney(vatReport.inputVatTotal, 2)}</td>
                        <td className="py-3 px-4 text-end font-mono-num" dir="ltr">{fmtPct(vatReport.recoveryRatioPct, 1)}</td>
                        <td className="py-3 px-4 text-end font-mono-num text-amber-900" dir="ltr">{fmtMoney(vatReport.netVatPayable, 2)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* DETAIL 2: SALES OUTPUT TAX REGISTER */}
          {vatDetailTab === 'sales' && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900">
                  {t(lang, 'سجل ضريبة مخرجات فواتير المبيعات (حساب 2201)', 'Sales Invoices Output VAT Register (COA 2201)')}
                </h3>
                <span className="text-xs text-slate-500">
                  {vatReport.salesInvoices.length} {t(lang, 'فاتورة في الفترة', 'invoices in period')}
                </span>
              </div>
              {vatReport.salesInvoices.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  {t(
                    lang,
                    'بيانات يناير–سبتمبر 2026 مجمعة في قيود الإغلاق الشهري (راجع تبويب جدول الإقرار أو قيود الضريبة 2201).',
                    'Jan–Sep 2026 sales are aggregated in monthly closing entries (see Return Schedule or GL Tax Ledger).'
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                        <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'رقم الفاتورة', 'Invoice #')}</th>
                        <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'التاريخ', 'Date')}</th>
                        <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'طريقة السداد', 'Payment')}</th>
                        <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'صافي المبيعات', 'Net Sales')}</th>
                        <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'ضريبة 14% (2201)', 'Output VAT 14%')}</th>
                        <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'الإجمالي شامل الضريبة', 'Gross Total')}</th>
                        <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'حالة ETA', 'ETA Status')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {vatReport.salesInvoices.map((inv) => (
                        <tr key={inv.id} className="hover:bg-slate-50">
                          <td className="py-2.5 px-4 font-mono-num font-bold text-slate-900" dir="ltr">{inv.invoiceNo}</td>
                          <td className="py-2.5 px-4 font-mono-num text-slate-600" dir="ltr">{inv.date}</td>
                          <td className="py-2.5 px-4 text-slate-700">{inv.paymentMethod}</td>
                          <td className="py-2.5 px-4 text-end font-mono-num text-slate-800" dir="ltr">{fmtMoney(inv.netSales, 2)}</td>
                          <td className="py-2.5 px-4 text-end font-mono-num font-bold text-teal-700" dir="ltr">{fmtMoney(inv.vatAmount, 2)}</td>
                          <td className="py-2.5 px-4 text-end font-mono-num font-semibold text-slate-900" dir="ltr">{fmtMoney(inv.grossTotal, 2)}</td>
                          <td className="py-2.5 px-4 text-end">
                            <span
                              className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                                inv.etaStatus === 'submitted'
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : 'bg-amber-50 text-amber-800'
                              }`}
                            >
                              {inv.etaStatus === 'submitted' ? t(lang, 'مرسلة ETA', 'Submitted') : t(lang, 'قيد المزامنة', 'Queued')}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* DETAIL 3: PURCHASES & TAXABLE EXPENSES REGISTER */}
          {vatDetailTab === 'inputs' && (
            <div className="space-y-4">
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900">
                    {t(lang, 'سجل ضريبة مدخلات فواتير المشتريات (حساب 1105)', 'Purchase Invoices Input VAT Register (COA 1105)')}
                  </h3>
                  <span className="text-xs text-slate-500">
                    {vatReport.purchaseInvoices.length} {t(lang, 'فاتورة شراء', 'purchase invoices')}
                  </span>
                </div>
                {vatReport.purchaseInvoices.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-500">
                    {t(lang, 'لا توجد فواتير مشتريات تفصيلية مسجلة في هذا النطاق (مدرجة ضمن إجماليات الإقفال).', 'No individual purchase documents in this filter range (included in period closing totals).')}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                          <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'رقم المستند', 'Purchase #')}</th>
                          <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'التاريخ', 'Date')}</th>
                          <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'المورد', 'Supplier')}</th>
                          <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'الصافي قبل الضريبة', 'Net Amount')}</th>
                          <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'ضريبة المدخلات 14% (1105)', 'Input VAT 14%')}</th>
                          <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'الإجمالي', 'Grand Total')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {vatReport.purchaseInvoices.map((po) => (
                          <tr key={po.id} className="hover:bg-slate-50">
                            <td className="py-2.5 px-4 font-mono-num font-bold text-slate-900" dir="ltr">{po.purchaseNo}</td>
                            <td className="py-2.5 px-4 font-mono-num text-slate-600" dir="ltr">{po.date}</td>
                            <td className="py-2.5 px-4 font-medium text-slate-800">{po.supplierNameAr}</td>
                            <td className="py-2.5 px-4 text-end font-mono-num" dir="ltr">{fmtMoney(po.totalBeforeTax, 2)}</td>
                            <td className="py-2.5 px-4 text-end font-mono-num font-bold text-emerald-700" dir="ltr">{fmtMoney(po.vatAmount, 2)}</td>
                            <td className="py-2.5 px-4 text-end font-mono-num font-semibold text-slate-900" dir="ltr">{fmtMoney(po.grandTotal, 2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900">
                    {t(lang, 'المصروفات التشغيلية الخاضعة لضريبة المدخلات (حساب 1105)', 'Taxable Operating Expenses (Input VAT COA 1105)')}
                  </h3>
                  <span className="text-xs text-slate-500">
                    {vatReport.taxableExpenses.length} {t(lang, 'مستند مصروف', 'expense vouchers')}
                  </span>
                </div>
                {vatReport.taxableExpenses.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-500">
                    {t(lang, 'لا توجد مصروفات تشغيلية خاضعة للضريبة مسجلة في هذه الفترة.', 'No taxable operating expense vouchers recorded in this period.')}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                          <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'رقم الإيصال', 'Voucher #')}</th>
                          <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'التاريخ', 'Date')}</th>
                          <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'الحساب / المستفيد', 'Account / Beneficiary')}</th>
                          <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'الصافي', 'Net')}</th>
                          <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'ضريبة المدخلات (1105)', 'Input VAT')}</th>
                          <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'الإجمالي', 'Total')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {vatReport.taxableExpenses.map((exp) => (
                          <tr key={exp.id} className="hover:bg-slate-50">
                            <td className="py-2.5 px-4 font-mono-num font-bold text-slate-900" dir="ltr">{exp.expenseNo}</td>
                            <td className="py-2.5 px-4 font-mono-num text-slate-600" dir="ltr">{exp.date}</td>
                            <td className="py-2.5 px-4 text-slate-800">
                              <span className="font-semibold">{exp.beneficiary}</span>
                              <span className="text-slate-500 mx-1">·</span>
                              <span className="text-slate-500">{exp.categoryNameAr}</span>
                            </td>
                            <td className="py-2.5 px-4 text-end font-mono-num" dir="ltr">{fmtMoney(exp.amountNet, 2)}</td>
                            <td className="py-2.5 px-4 text-end font-mono-num font-bold text-emerald-700" dir="ltr">{fmtMoney(exp.vatAmount, 2)}</td>
                            <td className="py-2.5 px-4 text-end font-mono-num font-semibold text-slate-900" dir="ltr">{fmtMoney(exp.totalAmount, 2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* DETAIL 4: GL TAX LEDGER MOVEMENTS (2201 & 1105) */}
          {vatDetailTab === 'ledger' && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900">
                  {t(lang, 'حركات دفتر الأستاذ لحسابات الضريبة (2201 مخرجات & 1105 مدخلات)', 'General Ledger Movements for VAT Accounts (2201 Output & 1105 Input)')}
                </h3>
                <span className="text-xs text-slate-500 font-mono-num" dir="ltr">
                  {vatReport.taxJournalRows.length} lines
                </span>
              </div>
              {vatReport.taxJournalRows.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  {t(lang, 'لا توجد قيود ضريبية مفردة ضمن هذا الفلتر الفرعي.', 'No individual tax journal lines in this sub-filter.')}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                        <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'رقم القيد', 'Journal #')}</th>
                        <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'التاريخ', 'Date')}</th>
                        <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'الحساب', 'Account')}</th>
                        <th className="py-2.5 px-4 text-start font-semibold">{t(lang, 'البيان', 'Memo')}</th>
                        <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'مدين (Debit)', 'Debit')}</th>
                        <th className="py-2.5 px-4 text-end font-semibold">{t(lang, 'دائن (Credit)', 'Credit')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {vatReport.taxJournalRows.map((row, idx) => (
                        <tr key={`${row.journalId}-${row.accountCode}-${idx}`} className="hover:bg-slate-50">
                          <td className="py-2.5 px-4 font-mono-num font-bold text-slate-900" dir="ltr">{row.journalNo}</td>
                          <td className="py-2.5 px-4 font-mono-num text-slate-600" dir="ltr">{row.date}</td>
                          <td className="py-2.5 px-4">
                            <span
                              className={`px-2 py-0.5 rounded font-mono-num font-bold text-[11px] ${
                                row.accountCode === '2201'
                                  ? 'bg-teal-50 text-teal-800'
                                  : 'bg-emerald-50 text-emerald-800'
                              }`}
                              dir="ltr"
                            >
                              {row.accountCode}
                            </span>{' '}
                            <span className="text-slate-700 font-medium">{row.accountNameAr}</span>
                          </td>
                          <td className="py-2.5 px-4 text-slate-600">{row.description}</td>
                          <td className="py-2.5 px-4 text-end font-mono-num text-slate-900" dir="ltr">
                            {row.debit > 0 ? fmtMoney(row.debit, 2) : '—'}
                          </td>
                          <td className="py-2.5 px-4 text-end font-mono-num text-slate-900" dir="ltr">
                            {row.credit > 0 ? fmtMoney(row.credit, 2) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
