import React from 'react';
import { CloudOff, Database, Download, Globe, LogOut, Moon, Printer, RefreshCw, Sun, Wifi } from 'lucide-react';
import { Language } from '../types/erp';
import { t } from '../utils/formatters';

interface TopBarProps {
  lang: Language;
  onToggleLang: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  breadcrumbAr: string;
  breadcrumbEn: string;
  isOffline: boolean;
  onToggleOffline: () => void;
  offlineQueueCount: number;
  onSyncOffline: () => void;
  isSyncing: boolean;
  onExportExcel: () => void;
  onPrintPage?: () => void;
  onOpenPrintCenter?: () => void;
  onStartMigration?: () => void;
  userEmail?: string | null;
  onSignOut?: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  lang,
  onToggleLang,
  theme,
  onToggleTheme,
  breadcrumbAr,
  breadcrumbEn,
  isOffline,
  onToggleOffline,
  offlineQueueCount,
  onSyncOffline,
  isSyncing,
  onExportExcel,
  onPrintPage,
  onOpenPrintCenter,
  onStartMigration,
  userEmail,
  onSignOut,
}) => {
  return (
    <header className="h-14 bg-white border-b border-slate-200 px-6 flex items-center justify-between gap-4 shrink-0 no-print">
      {/* Zone 1: Contextual Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-slate-500 min-w-0">
        <span className="font-semibold text-slate-900 whitespace-nowrap shrink-0">
          {t(lang, 'شركة استادات', 'Estadat')}
        </span>
        <span aria-hidden="true">/</span>
        <span className="truncate text-slate-700 font-medium">
          {lang === 'ar' ? breadcrumbAr : breadcrumbEn}
        </span>
        <span aria-hidden="true" className="hidden md:inline">·</span>
        <span className="hidden md:inline font-mono-num text-slate-500 whitespace-nowrap shrink-0" dir="ltr">
          2026-10-20
        </span>
      </div>

      {/* Zone 2: Workspace Controls (Offline/Sync + Language) */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onToggleOffline}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${
            isOffline
              ? 'bg-amber-50 border-amber-300 text-amber-800'
              : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
          }`}
          title={t(lang, 'اختبار العمل بدون إنترنت ثم المزامنة', 'Simulate Offline POS Mode & Sync')}
        >
          {isOffline ? <CloudOff className="w-3.5 h-3.5" /> : <Wifi className="w-3.5 h-3.5 text-teal-700" />}
          <span>{isOffline ? t(lang, 'وضع Offline', 'Offline Mode') : t(lang, 'متصل بالسيرفر', 'Connected')}</span>
        </button>

        {offlineQueueCount > 0 && (
          <button
            onClick={onSyncOffline}
            disabled={isOffline || isSyncing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>
              {t(lang, `مزامنة (${offlineQueueCount})`, `Sync (${offlineQueueCount})`)}
            </span>
          </button>
        )}

        <button
          onClick={onToggleTheme}
          title={theme === 'dark' ? t(lang, 'التبديل للوضع النهاري', 'Switch to Light Mode') : t(lang, 'التبديل للوضع الليلي', 'Switch to Dark Mode')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
        >
          {theme === 'dark' ? (
            <Sun className="w-3.5 h-3.5 text-amber-400" />
          ) : (
            <Moon className="w-3.5 h-3.5 text-slate-600" />
          )}
          <span>{theme === 'dark' ? t(lang, 'نهاري', 'Light') : t(lang, 'ليلي', 'Dark')}</span>
        </button>

        <button
          onClick={onToggleLang}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
        >
          <Globe className="w-3.5 h-3.5 text-slate-500" />
          <span>{lang === 'ar' ? 'EN' : 'العربية'}</span>
        </button>
      </div>

      {/* Zone 3: Primary Action & Session */}
      <div className="flex items-center gap-2 shrink-0">
        {onStartMigration && (
          <button
            onClick={onStartMigration}
            disabled={isOffline}
            title={t(lang, 'ترحيل الحالة المحلية إلى PostgreSQL والتحقق من التكامل', 'Migrate local state to PostgreSQL & verify integrity')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            <Database className="w-3.5 h-3.5 text-teal-700" />
            <span className="hidden lg:inline">{t(lang, 'ترحيل PostgreSQL', 'Migrate DB')}</span>
          </button>
        )}

        {onPrintPage && (
          <button
            onClick={onPrintPage}
            title={t(lang, 'طباعة الشاشة الحالية', 'Print Current Page')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
          >
            <Printer className="w-3.5 h-3.5 text-slate-600" />
            <span className="hidden xl:inline">{t(lang, 'طباعة الصفحة', 'Print View')}</span>
          </button>
        )}

        {onOpenPrintCenter && (
          <button
            onClick={onOpenPrintCenter}
            title={t(lang, 'فتح مركز الطباعة الشامل لكل ملفات النظام', 'Open Universal Print Center for all ERP files')}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>{t(lang, 'طباعة كل الملفات', 'Print All Files')}</span>
          </button>
        )}

        <button
          onClick={onExportExcel}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-teal-700 text-white hover:bg-teal-800 transition-colors whitespace-nowrap shrink-0"
        >
          <Download className="w-3.5 h-3.5" />
          <span>{t(lang, 'تصدير Excel ERP', 'Export Excel ERP')}</span>
        </button>

        {onSignOut && (
          <button
            onClick={onSignOut}
            title={userEmail || t(lang, 'تسجيل الخروج', 'Sign Out')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
          >
            <LogOut className="w-3.5 h-3.5 text-slate-500" />
            <span className="hidden sm:inline">{t(lang, 'خروج', 'Sign Out')}</span>
          </button>
        )}
      </div>
    </header>
  );
};
