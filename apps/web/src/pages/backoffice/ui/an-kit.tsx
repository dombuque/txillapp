import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { NavLink, useSearchParams } from 'react-router-dom';
import { api } from '../../../lib/api';
import { LoadingBlock } from '../../../components/Loading';

/** Peças comuns das Análises do backoffice: filtros (período e país), "como ler", números e o aviso do limiar k. */

export const K = 20;
export const PERIODS = [7, 30, 90, 180] as const;

/** As páginas: o caminho em português e a página da API. */
export const AN_PAGES = [
  { slug: 'coortes', api: 'cohorts', label: 'Coortes' },
  { slug: 'envolvimento', api: 'engagement', label: 'Envolvimento' },
  { slug: 'conteudo', api: 'content', label: 'Conteúdo' },
  { slug: 'geografia', api: 'geo', label: 'Geografia' },
  { slug: 'locais', api: 'venues', label: 'Locais' },
  { slug: 'geleira', api: 'geleira', label: 'Geleira' },
  { slug: 'pesquisa', api: 'search', label: 'Pesquisa' },
  { slug: 'saude', api: 'health', label: 'Saúde' },
] as const;

/** O que todas as respostas trazem. */
export interface AnBase { page: string; days: number; country: string | null; k: number; hidden: boolean; reason?: string; generatedAt?: string }

const regionNames = (() => {
  try {
    return new Intl.DisplayNames(['pt-PT'], { type: 'region' });
  } catch {
    return null;
  }
})();
export const countryName = (code: string | null | undefined) => {
  if (!code || code === '--') return 'Sem país';
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
};

export const PLATFORM: Record<string, string> = { android: 'Android', ios: 'iPhone', web: 'Site (app nova)', pwa: 'Site antigo instalado', browser: 'Site antigo no browser', unknown: 'Sem dados da app' };
export const fmt = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('pt-PT'));
export const fmtPct = (v: number | null | undefined) => (v == null ? '—' : `${v.toLocaleString('pt-PT', { maximumFractionDigits: 1 })}%`);
export const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('pt-PT', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Filtros guardados no endereço (?dias=30&pais=MZ): passam de página em página. */
export function useAnFilters(defaultDays = 30) {
  const [params, setParams] = useSearchParams();
  const d = Number(params.get('dias'));
  const days = (PERIODS as readonly number[]).includes(d) ? d : defaultDays;
  const country = /^[A-Z]{2}$/.test(params.get('pais') ?? '') ? params.get('pais') : null;
  const set = (k: 'dias' | 'pais', v: string | null) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  return { days, country, setDays: (v: number) => set('dias', String(v)), setCountry: (v: string | null) => set('pais', v), query: params.toString() };
}

/** Pede uma página das Análises (a API guarda 10 minutos em cache e regista cada consulta na auditoria). */
export function useAnalysis<T>(apiPage: string, defaultDays = 30) {
  const f = useAnFilters(defaultDays);
  const q = useQuery({ queryKey: ['bo-an', apiPage, f.days, f.country], queryFn: () => api.boInsights<AnBase & T>(apiPage, f.days, f.country), retry: false, staleTime: 5 * 60_000 });
  return { ...f, q };
}

function Filters({ periods = PERIODS }: { periods?: readonly number[] }) {
  const f = useAnFilters();
  const countries = useQuery({ queryKey: ['bo-an-countries'], queryFn: api.boInsightsCountries, retry: false, staleTime: 10 * 60_000 });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="radiogroup" aria-label="Período" className="flex gap-1 rounded-lg bg-zinc-200/70 p-1">
        {periods.map((d) => (
          <button key={d} type="button" role="radio" aria-checked={f.days === d} onClick={() => f.setDays(d)} className={`h-8 rounded-md px-3 text-sm font-semibold ${f.days === d ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-600 hover:text-zinc-900'}`}>
            {d} dias
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm text-zinc-600">
        <span className="sr-only">País</span>
        <select value={f.country ?? ''} onChange={(e) => f.setCountry(e.target.value || null)} className="h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-800">
          <option value="">Todos os países</option>
          {countries.data?.countries.map((c) => (
            <option key={c.code} value={c.code}>{countryName(c.code)} ({fmt(c.people)})</option>
          ))}
        </select>
      </label>
    </div>
  );
}

/** Separadores das Análises (úteis no telemóvel, onde a barra lateral não cabe). */
function Tabs() {
  const { query } = useAnFilters();
  return (
    <nav aria-label="Análises" className="-mx-1 mb-4 flex gap-1 overflow-x-auto px-1 pb-1">
      {AN_PAGES.map((p) => (
        <NavLink key={p.slug} to={`/backoffice/analises/${p.slug}${query ? `?${query}` : ''}`} className={({ isActive }) => `shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold ${isActive ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-600 ring-1 ring-zinc-200 hover:text-zinc-900'}`}>
          {p.label}
        </NavLink>
      ))}
    </nav>
  );
}

/** Cabeçalho de uma página das Análises: título, explicação curta, filtros e "como ler". */
export function AnPage({ title, intro, how, periods, children, state }: { title: string; intro: string; how: ReactNode; periods?: readonly number[]; children: ReactNode; state: { isLoading: boolean; isError: boolean; error?: unknown; data?: AnBase } }) {
  return (
    <div className="min-w-0">
      <Tabs />
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">Análises</p>
          <h1 className="text-[24px] font-extrabold leading-tight tracking-tight text-zinc-900 sm:text-[26px]">{title}</h1>
          <p className="mt-1 max-w-2xl text-[15px] text-zinc-500">{intro}</p>
        </div>
        <Filters periods={periods} />
      </header>
      <details className="mb-5 rounded-xl bg-sky-50 px-4 py-3 text-sm text-sky-950 ring-1 ring-sky-100">
        <summary className="cursor-pointer font-semibold">Como ler esta página</summary>
        <div className="mt-2 space-y-1.5 leading-relaxed">
          {how}
          <p>
            <b>Privacidade:</b> só números agregados, nunca listas de pessoas. Um grupo com menos de {K} pessoas aparece como <KHidden />. Quem desligou «Ajudar a melhorar o Txillapp» não entra. Cada consulta fica no registo de auditoria.
          </p>
        </div>
      </details>
      {state.isLoading && <LoadingBlock />}
      {state.isError && <p role="alert" className="rounded-xl bg-red-50 px-4 py-6 text-center text-red-800">{(state.error as Error)?.message || 'Não foi possível carregar.'}</p>}
      {state.data?.hidden && <p className="rounded-xl bg-amber-50 px-4 py-6 text-center text-amber-900">{state.data.reason}</p>}
      {state.data && !state.data.hidden && (
        <>
          <div className="space-y-4">{children}</div>
          {state.data.generatedAt && <p className="mt-6 text-xs text-zinc-400">Calculado {new Date(state.data.generatedAt).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' })} · guardado 10 minutos · dias no fuso de Maputo</p>}
        </>
      )}
    </div>
  );
}

/** "Menos de 20": o lugar de um número escondido pelo limiar k. */
export const KHidden = () => (
  <span title={`Escondido: menos de ${K} pessoas`} className="inline-flex items-center rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-semibold text-zinc-500">
    &lt; {K}
  </span>
);
/** Um número que pode vir escondido (null) pelo limiar. */
export const Num = ({ v, pct }: { v: number | null | undefined; pct?: boolean }) => (v == null ? <KHidden /> : <>{pct ? fmtPct(v) : fmt(v)}</>);

export function AnCard({ title, hint, children, right, className = '' }: { title: string; hint?: string; children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-2xl bg-white p-4 shadow-[0_1px_2px_rgba(15,18,25,0.06)] ring-1 ring-zinc-200/70 sm:p-5 ${className}`}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-zinc-900">{title}</h2>
          {hint && <p className="mt-0.5 text-[13px] text-zinc-500">{hint}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export function AnTile({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-2xl bg-white p-4 shadow-[0_1px_2px_rgba(15,18,25,0.06)] ring-1 ring-zinc-200/70">
      <p className="text-sm text-zinc-600">{label}</p>
      <p className="mt-1 text-[28px] font-extrabold leading-tight tabular-nums text-zinc-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

export const AnGrid = ({ children, cols = 4 }: { children: ReactNode; cols?: 2 | 3 | 4 }) => (
  <div className={`grid grid-cols-1 gap-4 ${cols === 2 ? 'md:grid-cols-2' : cols === 3 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'grid-cols-2 lg:grid-cols-4'}`}>{children}</div>
);

export const AnEmpty = ({ children }: { children: ReactNode }) => <p className="rounded-lg bg-zinc-50 px-3 py-6 text-center text-sm text-zinc-500">{children}</p>;

/** Tabela simples que encolhe bem no telemóvel (desliza na horizontal dentro do cartão). */
export function AnTable({ head, rows, align }: { head: ReactNode[]; rows: ReactNode[][]; align?: ('l' | 'r')[] }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
      <table className="w-full min-w-[480px] text-sm">
        <thead>
          <tr className="border-b border-zinc-200">
            {head.map((h, i) => (
              <th key={i} className={`px-2 py-2 text-xs font-bold uppercase tracking-wide text-zinc-500 ${align?.[i] === 'r' ? 'text-right' : 'text-left'}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-zinc-100 last:border-0">
              {r.map((c, j) => (
                <td key={j} className={`px-2 py-2 align-top text-zinc-800 ${align?.[j] === 'r' ? 'text-right tabular-nums' : ''}`}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Variação em pontos ou %: seta e texto (a cor nunca vai sozinha). */
export function Delta({ v, unit = '%' }: { v: number | null | undefined; unit?: string }) {
  if (v == null) return <span className="text-zinc-400">novo</span>;
  if (v === 0) return <span className="text-zinc-500">=</span>;
  const up = v > 0;
  return <span className={up ? 'text-emerald-700' : 'text-red-700'}>{up ? '▲' : '▼'} {Math.abs(v).toLocaleString('pt-PT', { maximumFractionDigits: 1 })}{unit}</span>;
}
