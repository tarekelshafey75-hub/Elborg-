import React, { useState } from 'react';
import { Globe, Lock, Moon, ShieldCheck, Sun } from 'lucide-react';
import type { Language } from '../types/erp';
import { t } from '../utils/formatters';

interface LoginScreenProps {
  lang: Language;
  onToggleLang: () => void;
  theme?: 'light' | 'dark';
  onToggleTheme?: () => void;
  onSignIn: () => Promise<void>;
  authError: string | null;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  lang,
  onToggleLang,
  theme = 'light',
  onToggleTheme,
  onSignIn,
  authError,
}) => {
  const [submitting, setSubmitting] = useState(false);
  const [logoError, setLogoError] = useState(false);

  const handleSignIn = async () => {
    setSubmitting(true);
    try {
      await onSignIn();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between p-6">
      <div className="flex justify-end gap-2 max-w-5xl w-full mx-auto">
        {onToggleTheme && (
          <button
            onClick={onToggleTheme}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 transition-colors"
          >
            {theme === 'dark' ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5 text-slate-600" />}
            <span>{theme === 'dark' ? t(lang, 'نهاري', 'Light') : t(lang, 'ليلي', 'Dark')}</span>
          </button>
        )}
        <button
          onClick={onToggleLang}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 transition-colors"
        >
          <Globe className="w-3.5 h-3.5 text-slate-500" />
          <span>{lang === 'ar' ? 'EN' : 'العربية'}</span>
        </button>
      </div>

      <div className="max-w-md w-full mx-auto bg-white border border-slate-200 rounded-xl p-8 space-y-6">
        <div className="flex flex-col items-center text-center space-y-4">
          {!logoError ? (
            <div className="bg-slate-950 border border-slate-800 rounded-xl px-5 py-3 flex items-center justify-center">
              <img
                src="/assets/aistudio/estadat_8cd1ae06.jpeg"
                alt="Estadat Sports Investment"
                referrerPolicy="no-referrer"
                onError={() => setLogoError(true)}
                className="h-10 w-auto object-contain"
              />
            </div>
          ) : (
            <div className="w-12 h-12 rounded-xl bg-slate-950 text-white font-bold flex items-center justify-center text-lg">
              E
            </div>
          )}

          <div>
            <h1 className="text-lg font-bold text-slate-900">
              {t(lang, 'نظام استادات المحاسبي والمالي (ERP)', 'Estadat Accounting & Financial ERP')}
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              {t(
                lang,
                'منظومة المحاسبة المالية وإدارة المبيعات والمخزون والتكاليف ولوحة CFO',
                'Integrated Financial Accounting, Revenue Billing, Inventory Costing & CFO Dashboard'
              )}
            </p>
          </div>
        </div>

        <div className="border-t border-b border-slate-100 py-4 space-y-2 text-xs text-slate-600">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-teal-700 shrink-0" />
            <span>
              {t(
                lang,
                'دخول آمن ومزامنة فورية بين الفواتير والخزينة ودفتر الأستاذ ولوحة المدير المالي',
                'Secure multi-device sync across Revenue Billing, Treasury, General Ledger & CFO Dashboard'
              )}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-teal-700 shrink-0" />
            <span>
              {t(
                lang,
                'حفظ دائم للفواتير والقيود المحاسبية وحركة المخزون',
                'Permanent persistence for invoices, ledger entries & inventory'
              )}
            </span>
          </div>
        </div>

        {authError && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
            {authError}
          </div>
        )}

        <button
          onClick={handleSignIn}
          disabled={submitting}
          className="w-full py-3 px-4 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white font-semibold text-sm flex items-center justify-center gap-2.5 transition-colors"
        >
          <span>
            {submitting
              ? t(lang, 'جاري تسجيل الدخول...', 'Signing in...')
              : t(lang, 'تسجيل الدخول بحساب Google', 'Sign in with Google')}
          </span>
        </button>
      </div>

      <div className="text-center text-[11px] text-slate-400">
        {t(lang, 'شركة استادات لإدارة المنشآت الرياضية · ق.م: 726264628', 'Estadat Sports Facilities Management · Tax ID: 726264628')}
      </div>
    </div>
  );
};
