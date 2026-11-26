import { Language } from '../types/erp';

export function fmtMoney(val: number, decimals = 0): string {
  const formatted = Math.abs(val).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return val < 0 ? `-${formatted}` : formatted;
}

export function fmtPct(val: number, decimals = 1): string {
  const formatted = Math.abs(val).toFixed(decimals);
  return val < 0 ? `-${formatted}%` : `${formatted}%`;
}

export function t(lang: Language, ar: string, en: string): string {
  return lang === 'ar' ? ar : en;
}
