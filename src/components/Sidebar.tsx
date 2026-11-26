import React from 'react';
import {
  BarChart3,
  BookOpenCheck,
  BriefcaseBusiness,
  FileSpreadsheet,
  LandPlot,
  Package,
  Receipt,
  Store,
  Target,
  Truck,
} from 'lucide-react';
import { Branch, Language, UserRole } from '../types/erp';
import { t } from '../utils/formatters';

export type NavTab = 'dashboard' | 'cfo_review' | 'strategy' | 'roi_simulator' | 'pos' | 'inventory' | 'purchases' | 'accounting' | 'quality';

interface SidebarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  lang: Language;
  role: UserRole;
  onChangeRole: (role: UserRole) => void;
  branches: Branch[];
  activeBranchId: string;
  onSelectBranch: (branchId: string) => void;
  lowStockCount: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  lang,
  role,
  onChangeRole,
  branches,
  activeBranchId,
  onSelectBranch,
  lowStockCount,
}) => {
  const navItems: {
    id: NavTab;
    labelAr: string;
    labelEn: string;
    icon: React.ReactNode;
    counter?: number;
  }[] = [
    {
      id: 'dashboard',
      labelAr: 'لوحة CFO (9M 2026)',
      labelEn: 'CFO & 9M P&L',
      icon: <BarChart3 className="w-4 h-4 shrink-0" />,
    },
    {
      id: 'cfo_review',
      labelAr: 'المراجعة التنفيذية (10M + 2027)',
      labelEn: 'CFO Exec Review (10M)',
      icon: <BriefcaseBusiness className="w-4 h-4 shrink-0" />,
    },
    {
      id: 'strategy',
      labelAr: 'استراتيجية وموازنة 2027',
      labelEn: '2027 Strategy & Budget',
      icon: <Target className="w-4 h-4 shrink-0" />,
    },
    {
      id: 'roi_simulator',
      labelAr: 'محاكي عائد الـ 80% فراغ (ROI)',
      labelEn: 'Investment ROI Simulator',
      icon: <LandPlot className="w-4 h-4 shrink-0" />,
    },
    {
      id: 'pos',
      labelAr: 'فواتير المبيعات والإيرادات',
      labelEn: 'Sales & Revenue Billing',
      icon: <Receipt className="w-4 h-4 shrink-0" />,
    },
    {
      id: 'inventory',
      labelAr: 'المخزون وتكلفة الأصناف (BOM)',
      labelEn: 'Inventory & Costing (BOM)',
      icon: <Package className="w-4 h-4 shrink-0" />,
      counter: lowStockCount > 0 ? lowStockCount : undefined,
    },
    {
      id: 'purchases',
      labelAr: 'المشتريات والموردون والعملاء',
      labelEn: 'Purchases, Suppliers & Customers',
      icon: <Truck className="w-4 h-4 shrink-0" />,
    },
    {
      id: 'accounting',
      labelAr: 'المحاسبة وتسوية CIB',
      labelEn: 'Ledger & Bank Recon',
      icon: <BookOpenCheck className="w-4 h-4 shrink-0" />,
    },
    {
      id: 'quality',
      labelAr: 'التدقيق وتصدير Excel',
      labelEn: 'Audit, Excel & API',
      icon: <FileSpreadsheet className="w-4 h-4 shrink-0" />,
    },
  ];

  const roles: { id: UserRole; ar: string; en: string }[] = [
    { id: 'cfo', ar: 'المدير المالي (CFO)', en: 'CFO / Finance' },
    { id: 'accountant', ar: 'محاسب عام / مراجع حسابات', en: 'General Accountant' },
    { id: 'manager', ar: 'المراقب المالي / مدير الفرع', en: 'Financial Controller' },
    { id: 'cashier', ar: 'مسؤول الفواتير والخزينة', en: 'Billing & Treasury Clerk' },
  ];

  return (
    <aside className="w-64 shrink-0 bg-white border-e border-slate-200 flex flex-col justify-between min-h-screen no-print">
      <div>
        {/* Brand Identity */}
        <div className="px-5 py-5 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-slate-950 border border-slate-800 overflow-hidden flex items-center justify-center shrink-0">
              <img
                src="/assets/aistudio/WhatsApp_Image_2025-11-02_at_7.40.10_PM_8e721bed.jpeg"
                alt="Estadat Sports Investment"
                referrerPolicy="no-referrer"
                className="w-full h-full object-contain p-1"
              />
            </div>
            <div className="min-w-0">
              <div className="font-bold text-slate-900 text-sm truncate">
                {t(lang, 'استادات للأنظمة المالية (ERP)', 'Estadat Financial ERP')}
              </div>
              <div className="text-xs text-slate-500 truncate">
                {t(lang, 'فرع البرج المنوفية', 'Al-Borg El-Menoufia')}
              </div>
            </div>
          </div>

          {/* Branch Switcher */}
          <div className="mt-4">
            <label className="block text-[11px] font-medium text-slate-500 mb-1">
              {t(lang, 'الفرع النشط', 'Active Branch')}
            </label>
            <div className="relative">
              <Store className="w-3.5 h-3.5 text-slate-400 absolute top-2.5 start-2.5 pointer-events-none" />
              <select
                value={activeBranchId}
                onChange={(e) => onSelectBranch(e.target.value)}
                className="w-full ps-8 pe-3 py-1.5 text-xs font-medium bg-slate-50 border border-slate-200 rounded-md text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-600/20 focus:border-teal-600"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {lang === 'ar' ? b.nameAr : b.nameEn}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Primary Navigation */}
        <nav className="p-3 space-y-1" aria-label="Main ERP Navigation">
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectTab(item.id)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                  isActive
                    ? 'bg-teal-700 text-white'
                    : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span className="flex items-center gap-2.5 truncate">
                  {item.icon}
                  <span className="truncate">{lang === 'ar' ? item.labelAr : item.labelEn}</span>
                </span>
                {item.counter !== undefined && (
                  <span
                    className={`font-mono-num text-[11px] font-semibold ${
                      isActive ? 'text-teal-100' : 'text-amber-700'
                    }`}
                  >
                    {item.counter}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Role & Tax Info Footer */}
      <div className="p-4 border-t border-slate-200 space-y-3 bg-slate-50/70">
        <div>
          <label className="block text-[11px] font-medium text-slate-500 mb-1">
            {t(lang, 'صلاحية المستخدم (RBAC)', 'Active Role (RBAC)')}
          </label>
          <select
            value={role}
            onChange={(e) => onChangeRole(e.target.value as UserRole)}
            className="w-full px-2.5 py-1.5 text-xs font-medium bg-white border border-slate-200 rounded-md text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-600/20 focus:border-teal-600"
          >
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {lang === 'ar' ? r.ar : r.en}
              </option>
            ))}
          </select>
        </div>

        <div className="text-[11px] text-slate-500 flex items-center justify-between font-mono-num" dir="ltr">
          <span>TAX ID: 726264628</span>
          <span>VAT 14%</span>
        </div>
      </div>
    </aside>
  );
};
