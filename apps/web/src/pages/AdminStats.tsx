import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import BarChart from '../components/BarChart';
import Icon from '../components/Icon';
import StackPage from '../components/StackPage';
import { api } from '../lib/api';

// Limites "bom / a melhorar" dos Core Web Vitals (Google). A cor nunca vai sozinha: leva ícone e texto.
const LIMITS: Record<string, { good: number; poor: number; unit: string; label: string }> = {
  LCP: { good: 2500, poor: 4000, unit: ' ms', label: 'Maior imagem a aparecer' },
  INP: { good: 200, poor: 500, unit: ' ms', label: 'Resposta ao toque' },
  CLS: { good: 0.1, poor: 0.25, unit: '', label: 'Saltos no ecrã' },
  FCP: { good: 1800, poor: 3000, unit: ' ms', label: 'Primeiro conteúdo' },
  TTFB: { good: 800, poor: 1800, unit: ' ms', label: 'Resposta do servidor' },
};

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
      <p className="text-sm text-zinc-600">{label}</p>
      <p className="mt-1 text-3xl font-extrabold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

const pct = (v: number | null) => (v === null ? '—' : `${v}%`);

/** Painel de produto: quem usa, retenção, funil, interação com o feed, desempenho e erros. Só para a moderação. */
export default function AdminStats() {
  const [days, setDays] = useState(14);
  const q = useQuery({ queryKey: ['admin-stats', days], queryFn: () => api.adminStats(days), retry: false });
  const s = q.data;
  return (
    <StackPage title="Estatísticas">
      <div className="space-y-4 px-4 pb-10 pt-4">
        <div role="tablist" aria-label="Período" className="flex gap-2">
          {[7, 14, 30].map((d) => (
            <button key={d} role="tab" aria-selected={days === d} onClick={() => setDays(d)} className={`flex-1 rounded-full py-2.5 text-sm font-bold ${days === d ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-700'}`}>
              {d} dias
            </button>
          ))}
        </div>
        {q.isError && <p role="alert" className="py-10 text-center text-zinc-600">Sem acesso</p>}
        {q.isLoading && <p className="py-10 text-center text-zinc-500">A carregar…</p>}
        {s && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Tile label="Contas ativas" value={String(s.totals.users)} hint={`${s.totals.posts} publicações · ${s.totals.messages} mensagens`} />
              <Tile label="Ativos hoje (DAU)" value={String(s.active.dau)} hint={`${s.active.wau} na semana · ${s.active.mau} no mês`} />
              <Tile label="Voltam no dia 1" value={pct(s.retention.d1)} hint={`de ${s.retention.d1Base} contas novas`} />
              <Tile label="Voltam no dia 7" value={pct(s.retention.d7)} hint={`de ${s.retention.d7Base} contas novas`} />
            </div>

            <BarChart title="Pessoas que abriram a app" data={s.series.opens} />
            <BarChart title="Contas novas" data={s.series.signups} />
            <BarChart title="Publicações" data={s.series.posts} />
            <BarChart title="Brindes" data={s.series.cheers} />
            <BarChart title="Comentários" data={s.series.comments} />
            <BarChart title="Mensagens" data={s.series.messages} />

            <section className="rounded-2xl border border-zinc-200 bg-white p-4" aria-label="Funil das contas novas">
              <h2 className="font-bold">Funil das contas novas ({days} dias)</h2>
              <ul className="mt-3 space-y-2">
                {[
                  ['Registaram-se', s.funnel.signed],
                  ['Publicaram', s.funnel.posted],
                  ['Seguiram alguém', s.funnel.followed],
                  ['Brindaram', s.funnel.cheered],
                ].map(([label, n]) => (
                  <li key={label as string}>
                    <div className="flex justify-between text-sm">
                      <span>{label}</span>
                      <span className="tabular-nums text-zinc-600">{n} · {pct(s.funnel.signed ? Math.round(((n as number) / s.funnel.signed) * 1000) / 10 : null)}</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-zinc-100">
                      <div className="h-full rounded-full bg-brand" style={{ width: `${s.funnel.signed ? ((n as number) / s.funnel.signed) * 100 : 0}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-2xl border border-zinc-200 bg-white p-4" aria-label="Feed">
              <h2 className="font-bold">Feed</h2>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <dt className="text-zinc-600">Publicações vistas</dt><dd className="text-right tabular-nums">{s.feed.seen}</dd>
                <dt className="text-zinc-600">Reações por visualização</dt><dd className="text-right tabular-nums">{pct(s.feed.engagementRate)}</dd>
                <dt className="text-zinc-600">“Não me interessa”</dt><dd className="text-right tabular-nums">{pct(s.feed.hideRate)}</dd>
              </dl>
            </section>

            <section className="rounded-2xl border border-zinc-200 bg-white p-4" aria-label="Desempenho">
              <h2 className="font-bold">Desempenho no telemóvel (percentil 75)</h2>
              {s.perf.length === 0 && <p className="mt-2 text-sm text-zinc-500">Ainda sem medições.</p>}
              <ul className="mt-2 divide-y divide-zinc-100">
                {s.perf.map((p) => {
                  const l = LIMITS[p.metric];
                  const status = !l ? 'good' : p.p75 <= l.good ? 'good' : p.p75 <= l.poor ? 'warn' : 'bad';
                  return (
                    <li key={p.metric} className="flex items-center gap-3 py-2.5">
                      <span className={status === 'good' ? 'text-emerald-700' : status === 'warn' ? 'text-amber-700' : 'text-red-700'}>
                        <Icon name={status === 'good' ? 'check-circle' : status === 'warn' ? 'info' : 'flag'} size={20} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">{p.metric} <span className="font-normal text-zinc-500">· {l?.label ?? ''}</span></span>
                        <span className="block text-xs text-zinc-500">{status === 'good' ? 'Bom' : status === 'warn' ? 'A melhorar' : 'Fraco'} · {p.n} medições</span>
                      </span>
                      <span className="font-bold tabular-nums">{p.p75}{l?.unit ?? ''}</span>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className="rounded-2xl border border-zinc-200 bg-white p-4" aria-label="Ecrãs e erros">
              <h2 className="font-bold">Ecrãs mais vistos</h2>
              <ul className="mt-2 text-sm">
                {s.screens.length === 0 && <li className="text-zinc-500">Sem dados.</li>}
                {s.screens.map((x) => (
                  <li key={x.path} className="flex justify-between border-t border-zinc-100 py-1.5 first:border-0"><span className="truncate">{x.path}</span><span className="tabular-nums text-zinc-600">{x.n}</span></li>
                ))}
              </ul>
              <h2 className="mt-4 font-bold">Erros no telemóvel</h2>
              <ul className="mt-2 text-sm">
                {s.errors.length === 0 && <li className="text-zinc-500">Nenhum</li>}
                {s.errors.map((x) => (
                  <li key={x.message} className="flex justify-between gap-3 border-t border-zinc-100 py-1.5 first:border-0"><span className="min-w-0 break-words">{x.message}</span><span className="tabular-nums text-zinc-600">{x.n}</span></li>
                ))}
              </ul>
              <p className="mt-4 text-sm text-zinc-600">
                Instalada como app: {s.platform.find((p) => p.platform === 'pwa')?.users ?? 0} · no browser: {s.platform.find((p) => p.platform === 'browser')?.users ?? 0}
              </p>
            </section>
          </>
        )}
      </div>
    </StackPage>
  );
}
