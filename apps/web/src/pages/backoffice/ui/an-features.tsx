import { AnLine } from './an-charts';
import { AnCard, AnGrid, AnPage, AnTable, AnTile, Delta, KHidden, Num, fmtPct, useAnalysis } from './an-kit';

interface Feature { id: string; label: string; people: number | null; actions: number | null; perPerson: number | null; reach: number | null; prevPeople: number | null; change: number | null }
interface Features { active: number | null; features: Feature[]; top: { key: string; label: string }[]; series: Record<string, unknown>[] }

/** Funcionalidades: quem usa o quê (mimos, Zás, notas, chat, chamadas, Txillada, Mixar, presentes…) e como está a mudar. */
export default function AnFeatures() {
  const { q } = useAnalysis<Features>('features', 30);
  const r = q.data;
  const used = r?.features.filter((x) => x.people != null) ?? [];
  return (
    <AnPage
      title="Funcionalidades"
      intro="Que partes do Txillapp a malta usa mesmo, quantas vezes, e se está a subir ou a descer."
      state={q}
      how={
        <>
          <p><b>Pessoas:</b> contas diferentes que usaram a funcionalidade no período (publicar, mandar, comentar, transmitir…). <b>Alcance:</b> essas pessoas em % de quem esteve ativo no período.</p>
          <p><b>Por pessoa:</b> ações a dividir pelas pessoas. <b>Variação:</b> pessoas agora contra o período anterior do mesmo tamanho.</p>
          <p>Com menos de 5 pessoas a funcionalidade aparece sem números, para ninguém ser identificável.</p>
        </>
      }
    >
      {r && (
        <>
          <AnGrid>
            <AnTile label="Pessoas ativas no período" value={<Num v={r.active} />} hint="abriram a app ou fizeram alguma coisa" />
            <AnTile label="Funcionalidade mais usada" value={used[0]?.label ?? '–'} hint={used[0] ? <><Num v={used[0].people} /> pessoas</> : undefined} />
            <AnTile label="Mais alcance" value={fmtPct([...used].sort((a, b) => (b.reach ?? 0) - (a.reach ?? 0))[0]?.reach ?? null)} hint={[...used].sort((a, b) => (b.reach ?? 0) - (a.reach ?? 0))[0]?.label} />
            <AnTile label="Funcionalidades com uso" value={String(used.length)} hint={`de ${r.features.length}`} />
          </AnGrid>

          <AnCard title="Pessoas por dia" hint="As 6 funcionalidades mais usadas: contas diferentes em cada dia">
            {r.series.length === 0 ? <p className="text-sm text-zinc-500">Sem atividade no período.</p> : <AnLine data={r.series} series={r.top} />}
          </AnCard>

          <AnCard title="Todas as funcionalidades" hint="Ordenadas por pessoas no período">
            <AnTable
              head={['Funcionalidade', 'Pessoas', 'Alcance', 'Ações', 'Por pessoa', 'Variação']}
              align={['l', 'r', 'r', 'r', 'r', 'r']}
              rows={r.features.map((x) => [
                x.label,
                x.people == null ? <KHidden key="p" /> : <Num key="p" v={x.people} />,
                <Num key="r" v={x.reach} pct />,
                <Num key="a" v={x.actions} />,
                x.perPerson == null ? '–' : String(x.perPerson),
                x.change == null ? '–' : <Delta key="c" v={x.change} unit="%" />,
              ])}
            />
          </AnCard>
        </>
      )}
    </AnPage>
  );
}
