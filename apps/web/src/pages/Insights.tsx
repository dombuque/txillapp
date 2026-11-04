import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import BarChart from '../components/BarChart';
import Icon, { type IconName } from '../components/Icon';
import { LoadingBlock } from '../components/Loading';
import StackPage from '../components/StackPage';
import { api } from '../lib/api';
import { tr, locale } from '../lib/i18n';

type Period = 7 | 30 | 90;

const card = 'rounded-2xl border border-zinc-200 bg-white p-4';
const num = (n: number) => n.toLocaleString(locale);

function Delta({ v }: { v: number }) {
  if (!v) return <span className="text-xs text-zinc-500">{tr('igual ao período anterior')}</span>;
  return <span className={`text-xs font-bold ${v > 0 ? 'text-green-700' : 'text-red-600'}`}>{v > 0 ? '+' : ''}{v}% <span className="font-normal text-zinc-500">{tr('face ao período anterior')}</span></span>;
}

function Stat({ icon, label, value, delta }: { icon: IconName; label: string; value: number; delta?: number }) {
  return (
    <div className={card}>
      <p className="flex items-center gap-1.5 text-sm font-semibold text-zinc-600"><Icon name={icon} size={16} /> {label}</p>
      <p className="mt-1 text-3xl font-extrabold tabular-nums">{num(value)}</p>
      {delta !== undefined && <Delta v={delta} />}
    </div>
  );
}

/** Barras horizontais (percentagens): idades, género, sítios e interesses do público. */
function Bars({ title, rows, hint }: { title: string; rows: { label: string; pct: number; value: number }[]; hint?: string }) {
  if (rows.length === 0) return null;
  return (
    <div className={card}>
      <p className="font-bold">{title}</p>
      {hint && <p className="text-xs text-zinc-500">{hint}</p>}
      <ul className="mt-3 space-y-2.5">
        {rows.map((r) => (
          <li key={r.label}>
            <div className="flex items-baseline justify-between gap-3 text-sm"><span className="truncate font-medium">{r.label}</span><span className="tabular-nums text-zinc-600">{r.pct}%</span></div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-zinc-100"><div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(3, r.pct)}%` }} /></div>
          </li>
        ))}
      </ul>
    </div>
  );
}

const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const GENDER: Record<string, string> = { female: 'Mulheres', male: 'Homens', other: 'Outro' };

/** As estatísticas do teu perfil, como os Insights de outras redes: só tu as vês. */
export default function Insights() {
  const [days, setDays] = useState<Period>(30);
  const tz = -new Date().getTimezoneOffset();
  const q = useQuery({ queryKey: ['insights', days, tz], queryFn: () => api.insights(days, tz), staleTime: 60_000, retry: false });
  const d = q.data;
  const bestHour = d ? [...d.hours].sort((a, b) => b.value - a.value)[0] : null;
  const bestDay = d ? [...d.weekdays].sort((a, b) => b.value - a.value)[0] : null;
  const maxHour = d ? Math.max(1, ...d.hours.map((h) => h.value)) : 1;

  return (
    <StackPage title={tr('Estatísticas do perfil')}>
      <div className="space-y-3 px-4 pb-10 pt-3">
        <div role="tablist" aria-label={tr('Período')} className="flex gap-2">
          {([7, 30, 90] as const).map((p) => (
            <button key={p} role="tab" aria-selected={days === p} onClick={() => setDays(p)} className={`flex-1 rounded-full py-2.5 text-sm font-bold transition ${days === p ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-800'}`}>
              {tr('{v0} dias', { v0: p })}
            </button>
          ))}
        </div>

        {q.isLoading && <LoadingBlock className="py-16" />}
        {q.isError && <p role="alert" className="py-16 text-center text-zinc-600">{tr('Não consegui ver as estatísticas agora')}</p>}
        {d && (
          <>
            <p className="text-sm text-zinc-600">{tr('Só tu vês isto. Mostramos números, nunca quem é quem.')}</p>
            <div className="grid grid-cols-2 gap-3">
              <Stat icon="eye" label={tr('Contas alcançadas')} value={d.overview.reach} delta={d.overview.reachDelta} />
              <Stat icon="cheers" label={tr('Interações')} value={d.overview.interactions} delta={d.overview.interactionsDelta} />
              <Stat icon="user-plus" label={tr('Novos seguidores')} value={d.overview.newFollowers} delta={d.overview.newFollowersDelta} />
              <Stat icon="user" label={tr('Visitas ao perfil')} value={d.overview.profileVisitors} delta={d.overview.profileVisitorsDelta} />
            </div>
            <div className={`${card} flex items-center justify-between`}>
              <span className="font-semibold">{tr('Seguidores')}</span>
              <span className="text-2xl font-extrabold tabular-nums">{num(d.overview.followers)}</span>
            </div>

            <BarChart title={tr('Contas alcançadas por dia')} data={d.series.map((s) => ({ day: s.day, value: s.reach }))} />
            <BarChart title={tr('Interações por dia')} data={d.series.map((s) => ({ day: s.day, value: s.interactions }))} />
            <BarChart title={tr('Novos seguidores por dia')} data={d.series.map((s) => ({ day: s.day, value: s.followers }))} />

            <div className={card}>
              <p className="font-bold">{tr('Interações')}</p>
              <dl className="mt-3 grid grid-cols-2 gap-y-3 text-sm">
                {([
                  ['cheers', tr('Brindes'), d.interactions.cheers], ['comments', tr('Comentários'), d.interactions.comments],
                  ['reposts', tr('Reposts'), d.interactions.reposts], ['gifts', tr('Presentes'), d.interactions.gifts],
                  ['sc', tr('Brindes em stories'), d.interactions.storyCheers], ['sr', tr('Respostas a stories'), d.interactions.storyReplies],
                ] as const).map(([k, label, v]) => (
                  <div key={k}><dt className="text-zinc-600">{label}</dt><dd className="text-xl font-extrabold tabular-nums">{num(v)}</dd></div>
                ))}
                <div><dt className="text-zinc-600">{tr('Visualizações de stories')}</dt><dd className="text-xl font-extrabold tabular-nums">{num(d.overview.storyViews)}</dd></div>
              </dl>
            </div>

            <div className={card}>
              <p className="font-bold">{tr('Quando a malta reage mais')}</p>
              {bestHour && bestHour.value > 0 && bestDay ? (
                <p className="mt-1 text-sm text-zinc-600">{tr('Melhor hora: {v0}h · melhor dia: {v1}', { v0: bestHour.hour, v1: tr(DAYS[bestDay.dow]) })}</p>
              ) : (
                <p className="mt-1 text-sm text-zinc-500">{tr('Ainda sem dados suficientes.')}</p>
              )}
              <div className="mt-3 flex h-20 items-end gap-[3px]" role="img" aria-label={tr('Reações por hora do dia')}>
                {d.hours.map((h) => (
                  <span key={h.hour} title={`${h.hour}h: ${h.value}`} className={`flex-1 rounded-t ${h.hour === bestHour?.hour && h.value > 0 ? 'bg-brand' : 'bg-zinc-300'}`} style={{ height: `${Math.max(4, (h.value / maxHour) * 100)}%` }} />
                ))}
              </div>
              <div className="mt-1 flex justify-between text-[11px] text-zinc-500"><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span></div>
            </div>

            {d.top.length > 0 && (
              <div className={card}>
                <p className="font-bold">{tr('Publicações em destaque')}</p>
                <ul className="mt-2 divide-y divide-zinc-100">
                  {d.top.map((p) => (
                    <li key={p.id}>
                      <Link to={p.video ? `/r/${p.code}` : `/p/${p.code}`} className="flex items-center gap-3 py-3 active:bg-zinc-50">
                        {p.mediaUrl ? <img src={p.mediaUrl} alt="" className="h-14 w-14 shrink-0 rounded-xl bg-zinc-100 object-cover" /> : <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-400"><Icon name="file-text" size={22} /></span>}
                        <span className="min-w-0 flex-1">
                          <span className="line-clamp-1 font-medium">{p.body || tr('Publicação')}</span>
                          <span className="block text-xs text-zinc-600">{num(p.reach)} {tr('alcançadas')} · {num(p.cheers)} {tr('brindes')} · {num(p.comments)} {tr('comentários')} · {num(p.reposts)} {tr('reposts')}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {d.audience.enough ? (
              <>
                <h2 className="pt-2 text-lg font-extrabold">{tr('O teu público')}</h2>
                <p className="-mt-2 text-sm text-zinc-600">{tr('Os teus {v0} seguidores, em números agregados.', { v0: num(d.audience.followers) })}</p>
                <Bars title={tr('Idades')} rows={d.audience.ages} />
                <Bars title={tr('Género')} rows={d.audience.gender.map((g) => ({ ...g, label: tr(GENDER[g.label] ?? g.label) }))} />
                <Bars title={tr('Países')} rows={d.audience.countries} />
                <Bars title={tr('Cidades')} rows={d.audience.cities} />
                <Bars title={tr('Interesses do teu público')} hint={tr('Da geleira de quem a deixa visível. Só aparecem gostos partilhados por várias pessoas.')} rows={d.audience.interests} />
              </>
            ) : (
              <div className={card}>
                <p className="font-bold">{tr('O teu público')}</p>
                <p className="mt-1 text-sm text-zinc-600">{tr('Com pelo menos {v0} seguidores mostramos as idades, o género, os sítios e os interesses do teu público, sempre em números agregados. Tens {v1}.', { v0: d.audience.minimum, v1: d.audience.followers })}</p>
              </div>
            )}
          </>
        )}
      </div>
    </StackPage>
  );
}
