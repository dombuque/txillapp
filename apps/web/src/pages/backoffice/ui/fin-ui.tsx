import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import Icon, { type IconName } from '../../../components/Icon';

/** Peças dos ecrãs de Finanças, Crescimento e Resumo: números grandes, estados com cor e ícone, seletor de período e tabelas. */

export const fmt = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toLocaleString('pt-PT'));
/** Números grandes compactos (12,3 mil; 1,2 M). */
export const compact = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toLocaleString('pt-PT', { notation: Math.abs(v) >= 100_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }));
export const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v.toLocaleString('pt-PT', { maximumFractionDigits: 1 })}%`);
export const share = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
/** Valores em centavos (MZN) para dinheiro. */
export const money = (minor: number, currency = 'MZN') => `${(minor / 100).toLocaleString('pt-PT', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${currency}`;
export const day = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString('pt-PT', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info';
const TONE: Record<Tone, { chip: string; icon: IconName; ring: string }> = {
  neutral: { chip: 'bg-zinc-100 text-zinc-700', icon: 'info', ring: 'ring-zinc-200/70' },
  good: { chip: 'bg-emerald-50 text-emerald-800', icon: 'check-circle', ring: 'ring-emerald-200' },
  warn: { chip: 'bg-amber-50 text-amber-900', icon: 'alert', ring: 'ring-amber-300' },
  bad: { chip: 'bg-red-50 text-red-800', icon: 'flag', ring: 'ring-red-300' },
  info: { chip: 'bg-sky-50 text-sky-800', icon: 'info', ring: 'ring-sky-200' },
};

/** Estado com cor, ícone e texto (a cor nunca vai sozinha). */
export function Status({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${TONE[tone].chip}`}>
      <Icon name={TONE[tone].icon} size={13} strokeWidth={2.2} aria-hidden />
      {children}
    </span>
  );
}

/** Seletor de período (7/30/90 dias). */
export function PeriodPicker({ value, onChange, options = [7, 30, 90] }: { value: number; onChange: (d: number) => void; options?: number[] }) {
  return (
    <div role="radiogroup" aria-label="Período" className="inline-flex gap-1 rounded-lg bg-zinc-200/70 p-1">
      {options.map((d) => (
        <button key={d} type="button" role="radio" aria-checked={value === d} onClick={() => onChange(d)}
          className={`h-8 rounded-md px-3 text-sm font-semibold tabular-nums sm:px-4 ${value === d ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-600 hover:text-zinc-900'}`}>
          {d} dias
        </button>
      ))}
    </div>
  );
}

/** Separadores de uma página (com o estado no endereço, para se poder partilhar). */
export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (t: T) => void; items: { id: T; label: string; badge?: number }[] }) {
  return (
    <div role="tablist" className="-mx-4 mb-6 flex gap-1 overflow-x-auto border-b border-zinc-200 px-4 sm:mx-0 sm:px-0">
      {items.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={`-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-semibold transition ${value === t.id ? 'border-zinc-900 text-zinc-900' : 'border-transparent text-zinc-500 hover:text-zinc-800'}`}>
          {t.label}
          {!!t.badge && <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">{t.badge}</span>}
        </button>
      ))}
    </div>
  );
}

/** Um número grande com rótulo; com `to` é uma ligação para o ecrã certo. */
export function Kpi({ label, value, hint, icon, tone = 'neutral', to, loading }: { label: string; value: ReactNode; hint?: ReactNode; icon?: IconName; tone?: Tone; to?: string; loading?: boolean }) {
  const alert = tone === 'warn' || tone === 'bad';
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[13px] font-semibold leading-tight text-zinc-500">{label}</span>
        {icon && <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${alert ? (tone === 'bad' ? 'bg-red-600 text-white' : 'bg-amber-500 text-white') : 'bg-zinc-100 text-zinc-500'}`}><Icon name={icon} size={17} /></span>}
      </div>
      <p className="mt-2 text-[30px] font-extrabold leading-none tracking-tight tabular-nums text-zinc-900 sm:text-[34px]">{loading ? <span className="inline-block h-8 w-16 animate-pulse rounded bg-zinc-100" /> : value}</p>
      {hint && <p className="mt-1.5 text-xs text-zinc-500">{hint}</p>}
    </>
  );
  const cls = `block rounded-2xl bg-white p-4 shadow-[0_1px_2px_rgba(15,18,25,0.06)] ring-1 sm:p-5 ${alert ? TONE[tone].ring : 'ring-zinc-200/70'}`;
  return to ? <Link to={to} className={`${cls} transition hover:-translate-y-0.5 hover:shadow-md`}>{body}</Link> : <div className={cls}>{body}</div>;
}

/** Uma secção com título, ajuda e ações. */
export function Panel({ title, help, right, children, pad = true }: { title: string; help?: string; right?: ReactNode; children: ReactNode; pad?: boolean }) {
  return (
    <section className="min-w-0 rounded-2xl bg-white shadow-[0_1px_2px_rgba(15,18,25,0.06)] ring-1 ring-zinc-200/70">
      <header className="flex flex-wrap items-start justify-between gap-2 px-4 pt-4 sm:px-5">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-zinc-900">{title}</h2>
          {help && <p className="mt-0.5 text-[13px] text-zinc-500">{help}</p>}
        </div>
        {right}
      </header>
      <div className={pad ? 'px-4 pb-4 pt-3 sm:px-5 sm:pb-5' : 'pt-3'}>{children}</div>
    </section>
  );
}

/** Tabela legível que desliza na horizontal no telemóvel. */
export function Table({ head, children, empty, label }: { head: { label: ReactNode; right?: boolean }[]; children: ReactNode; empty?: ReactNode; label?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm" aria-label={label}>
        <thead>
          <tr className="border-b border-zinc-200 bg-zinc-50/70">
            {head.map((h, i) => (
              <th key={i} scope="col" className={`px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-zinc-500 ${h.right ? 'text-right' : 'text-left'}`}>{h.label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">{children}</tbody>
      </table>
      {empty}
    </div>
  );
}
export const tdc = 'px-4 py-2.5 align-middle text-zinc-800';
export const tdn = 'px-4 py-2.5 align-middle text-right tabular-nums text-zinc-900';

/** Mensagem curta para os estados de carregar e de erro. */
export function Loading({ error }: { error?: unknown }) {
  if (error) return <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{(error as Error).message || 'Não consegui carregar'}</p>;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true" aria-label="A carregar">
      {[0, 1, 2, 3].map((i) => <div key={i} className="h-28 animate-pulse rounded-2xl bg-white ring-1 ring-zinc-200/70" />)}
    </div>
  );
}

/** Txills com a unidade. */
export const Txl = ({ v, sign }: { v: number; sign?: boolean }) => (
  <span className="tabular-nums">{sign && v > 0 ? '+' : ''}{fmt(v)}<span className="ml-0.5 text-[0.8em] font-semibold text-zinc-400"> TXL</span></span>
);
