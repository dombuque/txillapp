import { AnLine, PctCell } from './an-charts';
import { AnCard, AnGrid, AnPage, AnTable, AnTile, Delta, KHidden, Num, PLATFORM, fmtDay, fmtPct, useAnalysis } from './an-kit';

interface Cell { d1Base: number | null; d1: number | null; w1Base: number | null; w1: number | null }
interface Cohorts {
  cohorts: { week: string; size: number | null; retention: (number | null | 'small')[] }[];
  curve: { day: number; base: number | null; pct: number | null }[];
  headline: { d1: number | null; d7: number | null; d30: number | null; d1Base: number | null; d7Base: number | null; d30Base: number | null; stickiness: number | null };
  stickiness: { day: string; dau: number; wau: number; mau: number; ratio: number | null }[];
  all: Cell;
  platforms: ({ platform: string } & Cell)[];
  aha: { id: string; label: string; yes: Cell; no: Cell; liftW1: number | null; liftD1: number | null }[];
}

/** Coortes semanais, curvas D1/D7/D30, DAU/MAU e "quem volta" (o momento aha). */
export default function AnCohorts() {
  const { q } = useAnalysis<Cohorts>('cohorts', 90);
  const r = q.data;
  return (
    <AnPage
      title="Coortes e retenção"
      intro="Quem se regista volta? Em que semana se perde a malta, e o que fazem no 1.º dia os que ficam."
      state={q}
      how={
        <>
          <p><b>Coortes:</b> cada linha junta quem se registou nessa semana (segunda a domingo). «S1» é a % que teve atividade entre o 7.º e o 13.º dia depois do registo, «S2» entre o 14.º e o 20.º, e assim por diante. Um ponto (·) quer dizer que a semana ainda não acabou para essa coorte.</p>
          <p><b>D1, D7, D30:</b> % que voltou exatamente nesse dia depois do registo. A curva só usa quem já teve esse dia completo. Atividade = abrir a app, ver o feed ou um mimo, publicar, comentar, brindar, mandar mensagem, seguir ou fazer check-in.</p>
          <p><b>Stickiness (DAU/MAU):</b> das pessoas ativas nos últimos 30 dias, quantas vieram nesse dia. Acima de 20% é bom; acima de 30% é hábito forte.</p>
          <p><b>Momento aha:</b> compara quem fez X no dia do registo com quem não fez. Uma diferença grande sugere (não prova) que X ajuda a ficar.</p>
        </>
      }
    >
      {r && (
        <>
          <AnGrid>
            <AnTile label="Voltam no dia 1 (D1)" value={<Num v={r.headline.d1} pct />} hint={<>de <Num v={r.headline.d1Base} /> contas novas</>} />
            <AnTile label="Voltam no dia 7 (D7)" value={<Num v={r.headline.d7} pct />} hint={<>de <Num v={r.headline.d7Base} /> contas novas</>} />
            <AnTile label="Voltam no dia 30 (D30)" value={<Num v={r.headline.d30} pct />} hint={<>de <Num v={r.headline.d30Base} /> contas novas</>} />
            <AnTile label="Stickiness média (DAU/MAU)" value={fmtPct(r.headline.stickiness)} hint="média dos dias do período" />
          </AnGrid>

          <AnCard title="Coortes semanais de registo" hint="% de cada coorte com atividade na semana N depois do registo">
            {r.cohorts.length === 0 ? <p className="text-sm text-zinc-500">Sem registos no período.</p> : (
              <AnTable
                head={['Semana de', 'Pessoas', ...Array.from({ length: 8 }, (_, i) => `S${i + 1}`)]}
                align={['l', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r']}
                rows={r.cohorts.map((c) => [fmtDay(c.week), <Num key="n" v={c.size} />, ...c.retention.map((v, i) => <PctCell key={i} v={c.size == null && v != null ? 'small' : v} />)])}
              />
            )}
          </AnCard>

          <AnGrid cols={2}>
            <AnCard title="Curva de retenção (dias 1 a 30)" hint="% que voltou exatamente no dia N depois de se registar">
              <AnLine data={r.curve as unknown as Record<string, unknown>[]} xKey="day" xLabel={(x) => `D${x}`} unit="%" series={[{ key: 'pct', label: 'Voltaram' }]} />
            </AnCard>
            <AnCard title="Stickiness (DAU / MAU)" hint="% das pessoas ativas no mês que vieram em cada dia">
              <AnLine data={r.stickiness} unit="%" series={[{ key: 'ratio', label: 'DAU/MAU' }]} />
            </AnCard>
          </AnGrid>

          <AnCard title="Pessoas ativas por dia" hint="DAU (no dia), WAU (7 dias) e MAU (30 dias)">
            <AnLine data={r.stickiness} series={[{ key: 'dau', label: 'DAU' }, { key: 'wau', label: 'WAU' }, { key: 'mau', label: 'MAU' }]} />
          </AnCard>

          <AnGrid cols={2}>
            <AnCard title="Quem volta, por plataforma" hint="Plataforma do primeiro evento da app. D1: voltou no dia seguinte. Semana 1: voltou entre o 1.º e o 7.º dia.">
              <AnTable
                head={['Plataforma', 'D1', 'Semana 1', 'Base']}
                align={['l', 'r', 'r', 'r']}
                rows={[
                  ['Todas', <Num key="a" v={r.all.d1} pct />, <Num key="b" v={r.all.w1} pct />, <Num key="c" v={r.all.w1Base ?? r.all.d1Base} />],
                  ...r.platforms.sort((a, b) => (b.d1Base ?? 0) - (a.d1Base ?? 0)).map((p) => [PLATFORM[p.platform] ?? p.platform, <Num key="a" v={p.d1} pct />, <Num key="b" v={p.w1} pct />, <Num key="c" v={p.w1Base ?? p.d1Base} />]),
                ]}
              />
            </AnCard>
            <AnCard title="O momento aha: o que fazem no 1.º dia os que voltam" hint="Semana 1 de quem fez vs. de quem não fez; a diferença em pontos percentuais">
              <ul className="space-y-3">
                {r.aha.map((a) => (
                  <li key={a.id} className="rounded-xl bg-zinc-50 px-3 py-2.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-semibold text-zinc-900">{a.label}</span>
                      <span className="text-sm">{a.liftW1 == null ? <KHidden /> : <Delta v={a.liftW1} unit=" p.p." />}</span>
                    </div>
                    <p className="mt-0.5 text-sm text-zinc-600">
                      Fizeram: <b><Num v={a.yes.w1} pct /></b> voltaram (<Num v={a.yes.w1Base} /> pessoas) · Não fizeram: <b><Num v={a.no.w1} pct /></b> (<Num v={a.no.w1Base} />)
                    </p>
                  </li>
                ))}
              </ul>
            </AnCard>
          </AnGrid>
        </>
      )}
    </AnPage>
  );
}
