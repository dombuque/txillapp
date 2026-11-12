import type { ReactNode } from 'react';
import Icon, { type IconName } from '../../../components/Icon';
import VerifiedBadge from '../../../components/VerifiedBadge';
import { Badge, btnGhost } from '../bo';
import type { SessionState } from './contas-api';

/** Peças do backoffice › Contas: separadores, números, linhas de dados, tabela, estados vazio, a carregar e erro. */

/** Separadores (deslizam no telemóvel). */
export function ContasTabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; count?: number; tone?: 'red' | 'amber' }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div role="tablist" aria-label="Secções da conta" className="-mx-4 flex gap-1 overflow-x-auto border-b border-zinc-200 px-4 sm:mx-0 sm:px-0">
      {tabs.map((t) => {
        const on = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.id)}
            className={`-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-semibold transition ${on ? 'border-zinc-900 text-zinc-900' : 'border-transparent text-zinc-500 hover:text-zinc-800'}`}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className={`rounded-full px-1.5 py-px text-[11px] font-bold tabular-nums ${t.tone === 'red' ? 'bg-red-100 text-red-800' : t.tone === 'amber' ? 'bg-amber-100 text-amber-900' : 'bg-zinc-100 text-zinc-600'}`}>{t.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Um número com legenda (cartão pequeno). */
export function ContasStat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'red' | 'amber' | 'green' }) {
  const color = tone === 'red' ? 'text-red-700' : tone === 'amber' ? 'text-amber-700' : tone === 'green' ? 'text-emerald-700' : 'text-zinc-900';
  return (
    <div className="rounded-xl bg-white px-4 py-3 ring-1 ring-zinc-200/70">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={`mt-0.5 text-2xl font-extrabold tabular-nums ${color}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

/** Lista de dados "rótulo: valor". */
export function ContasFacts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="divide-y divide-zinc-100">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-start justify-between gap-4 py-2 text-sm">
          <dt className="shrink-0 text-zinc-500">{k}</dt>
          <dd className="min-w-0 text-right font-medium text-zinc-900">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Caixa de tabela: cantos, sombra e deslizar na horizontal quando não cabe. */
export const ContasTable = ({ children, minWidth = 760 }: { children: ReactNode; minWidth?: number }) => (
  <div className="overflow-x-auto rounded-2xl bg-white shadow-[0_1px_2px_rgba(15,18,25,0.06)] ring-1 ring-zinc-200/70">
    <table className="w-full" style={{ minWidth }}>{children}</table>
  </div>
);

/** A carregar: linhas cinzentas no lugar do conteúdo. */
export function ContasLoading({ rows = 4, label = 'A carregar…' }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-2">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="h-12 animate-pulse rounded-xl bg-zinc-200/60" />)}
    </div>
  );
}

/** Erro com a mensagem e um botão para tentar outra vez. */
export function ContasError({ error, onRetry, title = 'Não foi possível carregar' }: { error: unknown; onRetry?: () => void; title?: string }) {
  const status = (error as { status?: number } | null)?.status;
  const text = status === 403 ? 'Não tens permissão para ver isto.' : status === 404 ? 'Não encontrámos o que procuras.' : (error as Error | null)?.message || 'Tenta outra vez daqui a pouco.';
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
      <Icon name="alert" size={18} />
      <span className="flex-1"><b>{title}.</b> {text}</span>
      {onRetry && status !== 403 && status !== 404 && <button type="button" onClick={onRetry} className={`${btnGhost} h-8`}>Tentar outra vez</button>}
    </div>
  );
}

/** Vazio dentro de um cartão (mais discreto que o Empty de página). */
export const ContasNone = ({ children }: { children: ReactNode }) => <p className="rounded-xl bg-zinc-50 px-4 py-6 text-center text-sm text-zinc-500">{children}</p>;

export function SessionStateBadge({ state }: { state: SessionState }) {
  return state === 'active' ? <Badge tone="green">ativa</Badge> : state === 'ended' ? <Badge tone="zinc">terminada</Badge> : <Badge tone="amber">expirada</Badge>;
}

export const MinorBadge = () => <Badge tone="amber">menor de 18</Badge>;

export type Tier = 'verified' | 'official' | 'paid';
/** Os níveis do selo, como a equipa os escolhe: os dois primeiros a vermelho (do Txillapp), o pago a azul. */
export const TIERS: { id: Tier; label: string; short: string; help: string }[] = [
  { id: 'verified', label: 'Verificado (vermelho)', short: 'verificada', help: 'Verificada pelo Txillapp, por mérito ou pedido aceite.' },
  { id: 'official', label: 'Conta oficial do Txillapp (vermelho)', short: 'conta oficial', help: 'Só para as contas da casa.' },
  { id: 'paid', label: 'Verificação paga (azul)', short: 'verificação paga', help: 'Para quem tem a verificação paga (ainda não se vende).' },
];
export const tierShort = (t: string | null | undefined) => TIERS.find((x) => x.id === t)?.short ?? (t || 'sem selo');

/** O selo da conta, com a cor de cada nível (vermelho do Txillapp, azul na verificação paga). */
export function BadgeTier({ tier }: { tier: Tier | null }) {
  if (!tier) return null;
  return <Badge tone={tier === 'paid' ? 'blue' : 'zinc'}><span className="mr-1 inline-flex"><VerifiedBadge size={12} tier={tier} /></span>{tierShort(tier)}</Badge>;
}

/** A escolha do nível do selo (botões de rádio), para aprovar um pedido ou mudar o selo de uma conta. */
export function TierPicker({ value, onChange, allowNone, name }: { value: Tier | null; onChange: (t: Tier | null) => void; allowNone?: boolean; name: string }) {
  const opts: { id: Tier | null; label: string; help: string }[] = [...TIERS, ...(allowNone ? [{ id: null, label: 'Sem selo', help: 'Tira o selo à conta.' }] : [])];
  return (
    <fieldset className="mt-4">
      <legend className="text-sm font-semibold text-zinc-700">Selo</legend>
      <div className="mt-1 space-y-1.5">
        {opts.map((o) => (
          <label key={o.id ?? 'none'} className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-sm ${value === o.id ? 'border-zinc-900 bg-zinc-50' : 'border-zinc-200'}`}>
            <input type="radio" name={name} checked={value === o.id} onChange={() => onChange(o.id)} className="mt-0.5" />
            {o.id ? <span className="mt-0.5 inline-flex"><VerifiedBadge size={16} tier={o.id} /></span> : <span className="mt-0.5 inline-block h-4 w-4 rounded-full border border-dashed border-zinc-400" aria-hidden />}
            <span><span className="font-semibold">{o.label}</span><span className="block text-xs text-zinc-500">{o.help}</span></span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Ícone do aparelho num círculo. */
export function DeviceGlyph({ mobile, kind }: { mobile: boolean; kind?: string }) {
  const name: IconName = mobile ? 'phone' : kind === 'unknown' ? 'globe' : 'laptop';
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-700" aria-hidden>
      <Icon name={name} size={20} />
    </span>
  );
}

/** Interruptor em forma de etiqueta (filtros "com queixas", "menores"). */
export function FilterChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={`inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-sm font-semibold transition ${on ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50'}`}>
      {on && <Icon name="check" size={15} />}
      {children}
    </button>
  );
}

export const inputCls = 'h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-zinc-900';
