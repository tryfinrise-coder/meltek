import { createContext, useContext, useState, type ReactNode } from 'react';

export interface Currency { code: string; symbol: string; locale: string }

export const CURRENCIES: Currency[] = [
  { code: 'INR', symbol: '₹', locale: 'en-IN' },
  { code: 'USD', symbol: '$', locale: 'en-US' },
  { code: 'EUR', symbol: '€', locale: 'de-DE' },
  { code: 'GBP', symbol: '£', locale: 'en-GB' },
  { code: 'AED', symbol: 'د.إ', locale: 'ar-AE' },
  { code: 'JPY', symbol: '¥', locale: 'ja-JP' },
  { code: 'CNY', symbol: '¥', locale: 'zh-CN' },
];

interface CurrencyState {
  currency: Currency;
  rate: number; // 1 INR = rate units of target currency
  setCurrency: (c: Currency) => void;
  setRate: (r: number) => void;
  /** Format a value that is stored in INR for display in the selected currency. */
  money: (inr: number | null) => string;
  /** Just the symbol. */
  sym: string;
}

const CurrencyCtx = createContext<CurrencyState>({
  currency: CURRENCIES[0]!,
  rate: 1,
  setCurrency: () => {},
  setRate: () => {},
  money: (v) => v === null ? '—' : `₹${v.toFixed(2)}`,
  sym: '₹',
});

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrency] = useState<Currency>(CURRENCIES[0]!);
  const [rate, setRate] = useState(1);

  const money = (inr: number | null) => {
    if (inr === null) return '—';
    const converted = inr * rate;
    return `${currency.symbol}${converted.toLocaleString(currency.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <CurrencyCtx.Provider value={{ currency, rate, setCurrency, setRate, money, sym: currency.symbol }}>
      {children}
    </CurrencyCtx.Provider>
  );
}

export function useCurrency() { return useContext(CurrencyCtx); }

export function CurrencyPicker() {
  const { currency, rate, setCurrency, setRate } = useCurrency();
  return (
    <span className="inline-flex items-center gap-2 text-[12px]">
      <select
        value={currency.code}
        onChange={(e) => {
          const c = CURRENCIES.find((c) => c.code === e.target.value)!;
          setCurrency(c);
          if (c.code === 'INR') setRate(1);
        }}
        className="rounded border border-[var(--line)] bg-[var(--surface-1)] px-2 py-1 text-[12px]"
      >
        {CURRENCIES.map((c) => (
          <option key={c.code} value={c.code}>{c.symbol} {c.code}</option>
        ))}
      </select>
      {currency.code !== 'INR' && (
        <label className="inline-flex items-center gap-1 text-[var(--text-2)]">
          1 ₹ =
          <input
            type="number"
            step="any"
            min="0"
            value={rate}
            onChange={(e) => { const v = parseFloat(e.target.value); if (v > 0) setRate(v); }}
            className="w-20 rounded border border-[var(--line)] bg-[var(--surface-1)] px-2 py-1 text-right num text-[12px]"
          />
          {currency.symbol}
        </label>
      )}
    </span>
  );
}
