import { useState } from 'react';
import { AnHeatmap, AnLine, AnStack, SERIES } from './an-charts';
import { AnCard, AnGrid, AnPage, AnTable, AnTile, KHidden, fmt, fmtPct, useAnalysis } from './an-kit';

const METRICS = [
  { key: 'posts', label: 'Publicações' },
  { key: 'tchekas', label: 'Tchekas' },
  { key: 'mimos', label: 'Mimos' },
  { key: 'zas', label: 'Zás' },
  { key: 'comments', label: 'Comentários' },
  { key: 'cheers', label: 'Brindes' },
  { key: 'messages', label: 'Mensagens' },
] as const;

interface Engagement {
  series: Record<string, number | string | null>[];
  totals: Record<string, { total: number; perDay: number; perActive: number | null }>;
  activePeopleDays: number;
  distribution: { people: number; creators: number | null; interactors: number | null; viewers: number | null; top1Share: number | null; top10Share: number | null } | { people: null; small: true };
  heatmap: number[][];
}

const dec = (v: number | null) => (v == null ? '—' : v.toLocaleString('pt-PT', { maximumFractionDigits: 2 }));

/** O que a malta faz por dia e por pessoa ativa, quem cria e quem só vê, e as horas com mais uso. */
export default function AnEngagement() {
  const { q } = useAnalysis<Engagement>('engagement');
  const [metric, setMetric] = useState<string>('posts');
  const r = q.data;
  const label = METRICS.find((m) => m.key === metric)?.label ?? metric;
  const avgActive = r && r.series.length ? Math.round(r.activePeopleDays / r.series.length) : 0;
  return (
    <AnPage
      title="Envolvimento"
      intro="Quanto se cria e se interage, por dia e por pessoa ativa; quem cria e quem só vê; quando se usa mais."
      state={q}
      how={
        <>
          <p><b>Por pessoa ativa:</b> o total do dia a dividir pelas pessoas ativas nesse dia (DAU). Sobe quando cada pessoa faz mais, não só quando chega mais gente.</p>
          <p><b>1% / 9% / 90%:</b> a regra clássica das redes: 1% cria, 9% interage, 90% só vê. «Cria» = publicou, fez uma Tcheka, um Mimo ou um Zás. «Interage» = comentou, brindou, mandou mensagem ou repostou, sem criar. «Só vê» = o resto das pessoas ativas.</p>
          <p><b>Concentração:</b> quanto do conteúdo vem do 1% e dos 10% de pessoas que mais criam. Muito alto quer dizer que a rede depende de poucos.</p>
          <p><b>Mapa de calor:</b> horas de Maputo. Cada pessoa conta uma vez por hora em que fez alguma coisa («pessoas-hora»).</p>
        </>
      }
    >
      {r && (
        <>
          <AnGrid>
            <AnTile label="Pessoas ativas por dia (média)" value={fmt(avgActive)} />
            <AnTile label="Publicações por pessoa ativa" value={dec(r.totals.posts.perActive)} hint={`${fmt(r.totals.posts.total)} no período`} />
            <AnTile label="Brindes por pessoa ativa" value={dec(r.totals.cheers.perActive)} hint={`${fmt(r.totals.cheers.total)} no período`} />
            <AnTile label="Mensagens por pessoa ativa" value={dec(r.totals.messages.perActive)} hint={`${fmt(r.totals.messages.total)} no período`} />
          </AnGrid>

          <AnCard
            title={`${label} por dia`}
            hint="Total do dia e por pessoa ativa (dois gráficos, cada um com a sua escala)"
            right={
              <select value={metric} onChange={(e) => setMetric(e.target.value)} aria-label="Métrica" className="h-9 rounded-lg border border-zinc-300 bg-white px-2 text-sm font-semibold">
                {METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
              </select>
            }
          >
            <div className="grid gap-4 md:grid-cols-2">
              <AnLine data={r.series} series={[{ key: metric, label: 'Total' }]} />
              <AnLine data={r.series} series={[{ key: `${metric}PerActive`, label: 'Por pessoa ativa', color: SERIES[1] }]} />
            </div>
          </AnCard>

          <AnCard title="Totais do período">
            <AnTable
              head={['', 'Total', 'Por dia', 'Por pessoa ativa']}
              align={['l', 'r', 'r', 'r']}
              rows={METRICS.map((m) => [m.label, fmt(r.totals[m.key].total), fmt(r.totals[m.key].perDay), dec(r.totals[m.key].perActive)])}
            />
          </AnCard>

          <AnGrid cols={2}>
            <AnCard title="Quem cria e quem só vê" hint="Das pessoas ativas no período · referência: 1% / 9% / 90%">
              {'small' in r.distribution ? <p className="text-sm text-zinc-500">Menos de 20 pessoas ativas <KHidden /></p> : (
                <>
                  <AnStack parts={[{ label: 'Criam', pct: r.distribution.creators }, { label: 'Interagem', pct: r.distribution.interactors }, { label: 'Só veem', pct: r.distribution.viewers, color: '#a1a1aa' }]} />
                  <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                    <dt className="text-zinc-600">Pessoas ativas</dt><dd className="text-right tabular-nums">{fmt(r.distribution.people)}</dd>
                    <dt className="text-zinc-600">Conteúdo feito pelo 1% que mais cria</dt><dd className="text-right tabular-nums">{fmtPct(r.distribution.top1Share)}</dd>
                    <dt className="text-zinc-600">Conteúdo feito pelos 10% que mais criam</dt><dd className="text-right tabular-nums">{fmtPct(r.distribution.top10Share)}</dd>
                  </dl>
                </>
              )}
            </AnCard>
            <AnCard title="Quando se usa mais" hint="Dia da semana × hora (Maputo)">
              {'small' in r.distribution ? <p className="text-sm text-zinc-500">Menos de 20 pessoas ativas <KHidden /></p> : <AnHeatmap grid={r.heatmap} />}
            </AnCard>
          </AnGrid>
        </>
      )}
    </AnPage>
  );
}
