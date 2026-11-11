import { AnBars, SERIES } from './an-charts';
import { AnCard, AnEmpty, AnPage, AnTable, AnTile, AnGrid, Num, countryName, fmt, fmtPct, useAnalysis } from './an-kit';

interface Item { name: string; kind: string; category: string; alcoholic: boolean; people: number; pct: number | null; added: number }
interface Geleira {
  holders: number | null;
  kinds: { kind: string; people: number; pct: number | null }[];
  byCountry: { country: string; people: number; items: Item[] }[];
  pairs: { a: string; aKind: string; b: string; bKind: string; people: number; pct: number | null; lift: number | null }[];
}
const KIND: Record<string, string> = { vibe: 'Vibe', bebida: 'Bebida', comida: 'Comida', sitio: 'Sítio' };

/** Os gostos mais comuns por país e as combinações frequentes (para parcerias com marcas). */
export default function AnGeleira() {
  const { q } = useAnalysis<Geleira>('geleira');
  const r = q.data;
  return (
    <AnPage
      title="Geleira"
      intro="Do que a malta gosta, por país, e que gostos andam juntos: a base para falar com marcas e locais."
      state={q}
      how={
        <>
          <p><b>Quem entra:</b> só adultos (18+), com a Geleira visível a alguém (não «só eu») e itens do catálogo. Um gosto ou uma combinação só aparece com 20 pessoas ou mais.</p>
          <p><b>% :</b> das pessoas com Geleira nesse país. <b>Novos:</b> quantas o puseram no período escolhido (o resto é o estado de hoje).</p>
          <p><b>Lift:</b> quantas vezes a combinação aparece mais do que se os dois gostos fossem independentes. 1 = acaso; 2 = o dobro. É o que interessa a uma marca: «quem gosta de A tende a gostar de B».</p>
          <p>Bebidas alcoólicas vêm marcadas: qualquer parceria tem de ser só para adultos.</p>
        </>
      }
    >
      {r && (
        <>
          <AnGrid cols={3}>
            <AnTile label="Pessoas com Geleira" value={<Num v={r.holders} />} hint="adultos, Geleira visível" />
            <AnCard title="Que tipo de gostos" className="sm:col-span-2">
              {r.kinds.length === 0 ? <AnEmpty>Ainda pouca gente.</AnEmpty> : <AnBars max={100} color={SERIES[1]} rows={r.kinds.map((k) => ({ label: KIND[k.kind] ?? k.kind, value: k.pct ?? 0, text: `${fmtPct(k.pct)} · ${fmt(k.people)}` }))} />}
              <p className="mt-2 text-xs text-zinc-500">% das pessoas com Geleira que têm pelo menos um gosto desse tipo (cada pessoa pode ter vários).</p>
            </AnCard>
          </AnGrid>
          {r.byCountry.length === 0 && <AnEmpty>Nenhum país chega a 20 pessoas com Geleira.</AnEmpty>}
          {r.byCountry.map((c) => (
            <AnCard key={c.country} title={`Gostos mais comuns · ${countryName(c.country)}`} hint={`${fmt(c.people)} pessoas com Geleira`}>
              {c.items.length === 0 ? <AnEmpty>Nenhum gosto chega a 20 pessoas.</AnEmpty> : (
                <AnBars max={100} color={SERIES[0]} rows={c.items.map((i) => ({ label: `${i.name}${i.alcoholic ? ' (álcool, 18+)' : ''}`, value: i.pct ?? 0, text: `${fmtPct(i.pct)} · ${fmt(i.people)}`, hint: `${KIND[i.kind] ?? i.kind} · ${i.category} · ${fmt(i.added)} novos no período` }))} />
              )}
            </AnCard>
          ))}
          <AnCard title="Combinações frequentes" hint="Pares de gostos na mesma Geleira (20 pessoas ou mais)">
            {r.pairs.length === 0 ? <AnEmpty>Nenhuma combinação chega a 20 pessoas.</AnEmpty> : (
              <AnTable
                head={['Gosto A', 'Gosto B', 'Pessoas', '%', 'Lift']}
                align={['l', 'l', 'r', 'r', 'r']}
                rows={r.pairs.map((p) => [`${p.a} (${KIND[p.aKind] ?? p.aKind})`, `${p.b} (${KIND[p.bKind] ?? p.bKind})`, fmt(p.people), fmtPct(p.pct), p.lift == null ? '—' : `${p.lift.toLocaleString('pt-PT')}×`])}
              />
            )}
          </AnCard>
        </>
      )}
    </AnPage>
  );
}
