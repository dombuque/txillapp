import { useState } from 'react';
import { when } from '../bo';
import { AnCard, AnEmpty, AnGrid, AnPage, AnTable, AnTile, Delta, Num, fmt, useAnalysis } from './an-kit';

interface Venue {
  slug: string; name: string; kind: string; city: string | null; verified: boolean;
  followers: number; followersNew: number; followersGrowth: number | null; checkins: number; checkinsGrowth: number | null;
  mentions: number; ownPosts: number; events: number; interest: number;
}
interface Campaign { venue: string; target: string; package: string; startsAt: string; endsAt: string; status: string; price: number; views: number; viewers: number | null; taps: number; tapRate: number | null; conversion: number | null; conversionOfTaps: number | null }
interface Venues { ranking: Venue[]; boosts: { campaigns: Campaign[]; total: { campaigns: number; views: number; taps: number; tapRate: number | null; conversion: number | null } } }

const SORTS = [
  { key: 'followers', label: 'Seguidores' },
  { key: 'followersNew', label: 'Novos seguidores' },
  { key: 'checkins', label: 'Check-ins' },
  { key: 'mentions', label: 'Menções' },
  { key: 'events', label: 'Eventos' },
  { key: 'interest', label: '«Tenho interesse»' },
] as const;
const KIND: Record<string, string> = { bar: 'Bar', restaurante: 'Restaurante', discoteca: 'Discoteca', cafe: 'Café', hotel: 'Hotel', evento: 'Evento', outro: 'Outro' };

/** Ranking dos locais e a conversão dos destaques Bombar. */
export default function AnVenues() {
  const { q } = useAnalysis<Venues>('venues');
  const [sort, setSort] = useState<(typeof SORTS)[number]['key']>('followers');
  const r = q.data;
  const rows = r ? [...r.ranking].sort((a, b) => b[sort] - a[sort] || b.followers - a.followers).slice(0, 30) : [];
  return (
    <AnPage
      title="Locais"
      intro="Que locais crescem, recebem gente e são falados, e se o Bombar traz pessoas."
      state={q}
      how={
        <>
          <p><b>Crescimento:</b> novos seguidores (ou check-ins) no período comparados com o período anterior do mesmo tamanho. <b>Menções:</b> publicações com o sítio igual ao nome do local. <b>Eventos:</b> eventos do local que começam no período.</p>
          <p><b>Bombar:</b> «toque» é abrir o destaque. «Conversão» é a % de quem o viu que, nos 7 dias a seguir a tocar, seguiu o local, fez check-in ou marcou interesse num evento. Só se calcula com 20 pessoas ou mais a ver a campanha.</p>
        </>
      }
    >
      {r && (
        <>
          <AnGrid>
            <AnTile label="Campanhas Bombar no período" value={fmt(r.boosts.total.campaigns)} />
            <AnTile label="Vistas" value={fmt(r.boosts.total.views)} hint={`${fmt(r.boosts.total.taps)} toques`} />
            <AnTile label="Taxa de toque" value={<Num v={r.boosts.total.tapRate} pct />} hint="das pessoas que viram" />
            <AnTile label="Conversão" value={<Num v={r.boosts.total.conversion} pct />} hint="seguiu, check-in ou interesse em 7 dias" />
          </AnGrid>
          <AnCard
            title="Ranking dos locais"
            hint="Locais aprovados"
            right={
              <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Ordenar por" className="h-9 rounded-lg border border-zinc-300 bg-white px-2 text-sm font-semibold">
                {SORTS.map((s) => <option key={s.key} value={s.key}>Por {s.label.toLowerCase()}</option>)}
              </select>
            }
          >
            {rows.length === 0 ? <AnEmpty>Ainda não há locais aprovados.</AnEmpty> : (
              <AnTable
                head={['Local', 'Seguidores', 'Novos', 'Check-ins', 'Menções', 'Eventos', 'Interesse']}
                align={['l', 'r', 'r', 'r', 'r', 'r', 'r']}
                rows={rows.map((v) => [
                  <span key="n"><b className="text-zinc-900">{v.name}</b>{v.verified ? ' ✓' : ''}<span className="block text-xs text-zinc-500">{KIND[v.kind] ?? v.kind}{v.city ? ` · ${v.city}` : ''}</span></span>,
                  fmt(v.followers),
                  <span key="f">{fmt(v.followersNew)} <span className="text-xs"><Delta v={v.followersGrowth} /></span></span>,
                  <span key="c">{fmt(v.checkins)} <span className="text-xs"><Delta v={v.checkinsGrowth} /></span></span>,
                  fmt(v.mentions), fmt(v.events), fmt(v.interest),
                ])}
              />
            )}
          </AnCard>
          <AnCard title="Destaques Bombar" hint="Campanhas que estiveram no ar no período">
            {r.boosts.campaigns.length === 0 ? <AnEmpty>Sem campanhas no período.</AnEmpty> : (
              <AnTable
                head={['Local', 'O quê', 'Quando', 'Vistas', 'Pessoas', 'Toques', 'Taxa de toque', 'Conversão']}
                align={['l', 'l', 'l', 'r', 'r', 'r', 'r', 'r']}
                rows={r.boosts.campaigns.map((c) => [
                  c.venue, c.target === 'event' ? 'Evento' : 'Publicação', `${when(c.startsAt)} (${c.package})`,
                  fmt(c.views), <Num key="p" v={c.viewers} />, fmt(c.taps), <Num key="t" v={c.tapRate} pct />, <Num key="c" v={c.conversion} pct />,
                ])}
              />
            )}
          </AnCard>
        </>
      )}
    </AnPage>
  );
}
