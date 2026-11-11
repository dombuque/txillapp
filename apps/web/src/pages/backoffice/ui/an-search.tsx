import { AnBars, AnLine, SERIES } from './an-charts';
import { AnCard, AnEmpty, AnGrid, AnPage, AnTile, fmt, fmtPct, useAnalysis } from './an-kit';

interface Row { term: string; searches: number; empty: number; emptyPct: number | null }
interface Search {
  retentionDays: number;
  effectiveDays: number;
  totals: { searches: number; empty: number; emptyPct: number | null; terms: number };
  top: Row[];
  gaps: Row[];
  series: { day: string; searches: number; empty: number }[];
}

/** O que a malta procura e o que procura sem encontrar (lacunas de conteúdo). */
export default function AnSearch() {
  const { q } = useAnalysis<Search>('search');
  const r = q.data;
  return (
    <AnPage
      title="Pesquisa"
      intro="Os termos mais pesquisados e as pesquisas sem resultados: o que falta no Txillapp."
      periods={[7, 30, 90]}
      state={q}
      how={
        <>
          <p><b>Como se conta:</b> um contador agregado por dia, país e termo normalizado (minúsculas, sem acentos, sem @ ou #). Não fica quem pesquisou. Cada pessoa conta no máximo uma vez por termo e por dia, e só o termo final (a app pesquisa enquanto se escreve).</p>
          <p><b>Não entram:</b> menores de 18 anos, quem desligou «Ajudar a melhorar o Txillapp», emails, ligações e textos com muitos algarismos. Tudo se apaga ao fim de 90 dias.</p>
          <p><b>Lacunas:</b> termos pesquisados 20 vezes ou mais em que pelo menos metade não deu nada (sem pessoas, publicações, hashtags nem locais). Boas ideias para conteúdo, locais a convidar ou temas novos.</p>
        </>
      }
    >
      {r && (
        <>
          <AnGrid>
            <AnTile label="Pesquisas" value={fmt(r.totals.searches)} hint={r.effectiveDays < 90 ? `últimos ${r.effectiveDays} dias` : 'últimos 90 dias (o máximo guardado)'} />
            <AnTile label="Sem resultados" value={fmtPct(r.totals.emptyPct)} hint={`${fmt(r.totals.empty)} pesquisas`} />
            <AnTile label="Termos diferentes" value={fmt(r.totals.terms)} />
            <AnTile label="Termos que se mostram" value={fmt(r.top.length)} hint="com 20 pesquisas ou mais" />
          </AnGrid>
          <AnCard title="Pesquisas por dia">
            <AnLine data={r.series} series={[{ key: 'searches', label: 'Pesquisas' }, { key: 'empty', label: 'Sem resultados' }]} />
          </AnCard>
          <AnGrid cols={2}>
            <AnCard title="Mais pesquisados">
              {r.top.length === 0 ? <AnEmpty>Nenhum termo chega a 20 pesquisas.</AnEmpty> : <AnBars rows={r.top.map((t) => ({ label: t.term, value: t.searches, text: `${fmt(t.searches)} · ${fmtPct(t.emptyPct)} vazias` }))} />}
            </AnCard>
            <AnCard title="Lacunas: procuram e não encontram">
              {r.gaps.length === 0 ? <AnEmpty>Sem lacunas com 20 pesquisas ou mais.</AnEmpty> : <AnBars color={SERIES[1]} rows={r.gaps.map((t) => ({ label: t.term, value: t.empty, text: `${fmt(t.empty)} de ${fmt(t.searches)} sem nada` }))} />}
            </AnCard>
          </AnGrid>
        </>
      )}
    </AnPage>
  );
}
