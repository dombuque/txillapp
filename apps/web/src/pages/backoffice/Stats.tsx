import { LoadingBlock } from '../../components/Loading';
import { tr } from '../../lib/i18n';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import BarChart from '../../components/BarChart';
import Icon from '../../components/Icon';
import { PageHeader } from './bo';
import { api } from '../../lib/api';

// Limites "bom / a melhorar" dos Core Web Vitals (Google). A cor nunca vai sozinha: leva ícone e texto.
const LIMITS: Record<string, { good: number; poor: number; unit: string; label: string }> = {
  LCP: { good: 2500, poor: 4000, unit: ' ms', label: 'Maior imagem a aparecer' },
  INP: { good: 200, poor: 500, unit: ' ms', label: 'Resposta ao toque' },
  CLS: { good: 0.1, poor: 0.25, unit: '', label: 'Saltos no ecrã' },
  FCP: { good: 1800, poor: 3000, unit: ' ms', label: 'Primeiro conteúdo' },
  TTFB: { good: 800, poor: 1800, unit: ' ms', label: 'Resposta do servidor' },
  // Da app (apps/mobile): do arranque até ao primeiro ecrã útil (na web conta desde o pedido da página).
  first_screen_android: { good: 2000, poor: 4000, unit: ' ms', label: 'Primeiro ecrã útil (Android)' },
  first_screen_ios: { good: 2000, poor: 4000, unit: ' ms', label: 'Primeiro ecrã útil (iPhone)' },
  first_screen_web: { good: 2500, poor: 4000, unit: ' ms', label: 'Primeiro ecrã útil (site)' },
};

/** Nomes das plataformas (browser/pwa: o site antigo; web/android/ios: a app nova, que também é o site). */
const PLATFORM: Record<string, string> = { android: 'Android', ios: 'iPhone', web: 'Site (app nova)', pwa: 'Site antigo instalado', browser: 'Site antigo no browser' };

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
    <>
      <PageHeader
        title={tr('Estatísticas')}
        description="Quem usa o Txillapp, retenção, funil, feed, desempenho e erros."
        actions={
          <div role="tablist" aria-label={tr('Período')} className="flex gap-1 rounded-lg bg-zinc-200/70 p-1">
            {[7, 14, 30].map((d) => (
              <button key={d} role="tab" aria-selected={days === d} onClick={() => setDays(d)} className={`h-8 rounded-md px-4 text-sm font-semibold ${days === d ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-600 hover:text-zinc-900'}`}>
                {d} {tr('dias')}
              </button>
            ))}
          </div>
        }
      />
      <div className="space-y-4">
        {q.isError && <p role="alert" className="py-10 text-center text-zinc-600">{tr('Sem acesso')}</p>}
        {q.isLoading && <LoadingBlock />}
        {s && (
          <>
            <div className="grid grid-cols-4 gap-4">
              <Tile label={tr('Contas ativas')} value={String(s.totals.users)} hint={`${s.totals.posts} publicações · ${s.totals.messages} mensagens`} />
              <Tile label={tr('Ativos hoje (DAU)')} value={String(s.active.dau)} hint={`${s.active.wau} na semana · ${s.active.mau} no mês`} />
              <Tile label={tr('Voltam no dia 1')} value={pct(s.retention.d1)} hint={`de ${s.retention.d1Base} contas novas`} />
              <Tile label={tr('Voltam no dia 7')} value={pct(s.retention.d7)} hint={`de ${s.retention.d7Base} contas novas`} />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <BarChart title={tr('Pessoas que abriram a app')} data={s.series.opens} />
              <BarChart title={tr('Contas novas')} data={s.series.signups} />
              <BarChart title={tr('Publicações')} data={s.series.posts} />
              <BarChart title={tr('Brindes')} data={s.series.cheers} />
              <BarChart title={tr('Comentários')} data={s.series.comments} />
              <BarChart title={tr('Mensagens')} data={s.series.messages} />
            </div>
            <div className="grid grid-cols-2 gap-4">

            <section className="rounded-2xl border border-zinc-200 bg-white p-4" aria-label={tr('Funil das contas novas')}>
              <h2 className="font-bold">{tr('Funil das contas novas (')}{days} {tr('dias)')}</h2>
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

            <section className="rounded-2xl border border-zinc-200 bg-white p-4" aria-label={tr('Feed')}>
              <h2 className="font-bold">{tr('Feed')}</h2>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <dt className="text-zinc-600">{tr('Publicações vistas')}</dt><dd className="text-right tabular-nums">{s.feed.seen}</dd>
                <dt className="text-zinc-600">{tr('Reações por visualização')}</dt><dd className="text-right tabular-nums">{pct(s.feed.engagementRate)}</dd>
                <dt className="text-zinc-600">{tr('“Não me interessa”')}</dt><dd className="text-right tabular-nums">{pct(s.feed.hideRate)}</dd>
              </dl>
            </section>

            <section className="rounded-2xl border border-zinc-200 bg-white p-4" aria-label={tr('Desempenho')}>
              <h2 className="font-bold">{tr('Desempenho (percentil 75)')}</h2>
              {s.perf.length === 0 && <p className="mt-2 text-sm text-zinc-500">{tr('Ainda sem medições.')}</p>}
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
                        <span className="block text-xs text-zinc-500">{status === 'good' ? tr('Bom') : status === 'warn' ? tr('A melhorar') : tr('Fraco')} · {p.n} {tr('medições')}</span>
                      </span>
                      <span className="font-bold tabular-nums">{p.p75}{l?.unit ?? ''}</span>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className="rounded-2xl border border-zinc-200 bg-white p-4" aria-label={tr('Ecrãs e erros')}>
              <h2 className="font-bold">{tr('Ecrãs mais vistos')}</h2>
              <ul className="mt-2 text-sm">
                {s.screens.length === 0 && <li className="text-zinc-500">{tr('Sem dados.')}</li>}
                {s.screens.map((x) => (
                  <li key={x.path} className="flex justify-between border-t border-zinc-100 py-1.5 first:border-0"><span className="truncate">{x.path}</span><span className="tabular-nums text-zinc-600">{x.n}</span></li>
                ))}
              </ul>
              <h2 className="mt-4 font-bold">{tr('Erros no telemóvel')}</h2>
              <ul className="mt-2 text-sm">
                {s.errors.length === 0 && <li className="text-zinc-500">{tr('Nenhum')}</li>}
                {s.errors.map((x) => (
                  <li key={x.message} className="flex justify-between gap-3 border-t border-zinc-100 py-1.5 first:border-0"><span className="min-w-0 break-words">{x.message}</span><span className="tabular-nums text-zinc-600">{x.n}</span></li>
                ))}
              </ul>
              <h2 className="mt-4 font-bold">{tr('Pessoas por plataforma')}</h2>
              <ul className="mt-2 text-sm">
                {s.platform.length === 0 && <li className="text-zinc-500">{tr('Sem dados.')}</li>}
                {s.platform.map((p) => (
                  <li key={p.platform} className="flex justify-between border-t border-zinc-100 py-1.5 first:border-0"><span>{tr(PLATFORM[p.platform] ?? p.platform)}</span><span className="tabular-nums text-zinc-600">{p.users}</span></li>
                ))}
              </ul>
              {s.platform.length > 1 && <p className="mt-1 text-xs text-zinc-500">{tr('Quem usa mais do que uma plataforma conta em cada uma; os ativos lá em cima contam cada pessoa uma vez.')}</p>}
              {!!s.versions?.length && (
                <>
                  <h2 className="mt-4 font-bold">{tr('Versões da app')}</h2>
                  <ul className="mt-2 text-sm">
                    {s.versions.map((v) => (
                      <li key={`${v.platform}-${v.version}`} className="flex justify-between border-t border-zinc-100 py-1.5 first:border-0"><span>{tr(PLATFORM[v.platform] ?? v.platform)} {v.version}</span><span className="tabular-nums text-zinc-600">{v.users}</span></li>
                    ))}
                  </ul>
                </>
              )}
            </section>
            </div>
          </>
        )}
      </div>
    </>
  );
}
