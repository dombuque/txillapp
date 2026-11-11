import { AnBars, SERIES } from './an-charts';
import { when } from '../bo';
import { AnCard, AnEmpty, AnGrid, AnPage, AnTable, Delta, fmt, useAnalysis } from './an-kit';

interface TrendItem { label: string; now: number; before: number; people: number; change: number | null }
interface Trend { top: TrendItem[]; rising: TrendItem[]; falling: TrendItem[] }
interface Content {
  minPeople: number;
  hashtags: Trend;
  topics: Trend;
  places: { label: string; posts: number; people: number }[];
  music: { title: string; artist: string; uses: number; people: number; inPosts: number; inMimos: number }[];
  gifs: { title: string; url: string | null; uses: number; people: number; inChat: number; inComments: number }[];
  topPosts: { code: string; body: string; createdAt: string; tcheka: boolean; reach: number; cheers: number; comments: number }[];
}

const POST_URL = (code: string) => `https://txillapp.com/p/${encodeURIComponent(code)}`;

function TrendCard({ title, t, prefix = '' }: { title: string; t: Trend; prefix?: string }) {
  return (
    <AnCard title={title} hint="Usos no período vs. o período anterior do mesmo tamanho">
      {t.top.length === 0 ? <AnEmpty>Ainda nada que chegue (cada item precisa de 3 pessoas diferentes).</AnEmpty> : (
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-500">Mais usados</h3>
            <AnBars rows={t.top.map((x) => ({ label: `${prefix}${x.label}`, value: x.now }))} />
          </div>
          <div>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-500">A subir</h3>
            <ul className="space-y-1.5 text-sm">
              {t.rising.map((x) => <li key={x.label} className="flex justify-between gap-2"><span className="truncate">{prefix}{x.label}</span><span className="shrink-0 tabular-nums text-zinc-600">{x.before} → {x.now} <Delta v={x.change} /></span></li>)}
              {t.rising.length === 0 && <li className="text-zinc-400">—</li>}
            </ul>
          </div>
          <div>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-500">A descer</h3>
            <ul className="space-y-1.5 text-sm">
              {t.falling.map((x) => <li key={x.label} className="flex justify-between gap-2"><span className="truncate">{prefix}{x.label}</span><span className="shrink-0 tabular-nums text-zinc-600">{x.before} → {x.now} <Delta v={x.change} /></span></li>)}
              {t.falling.length === 0 && <li className="text-zinc-400">—</li>}
            </ul>
          </div>
        </div>
      )}
    </AnCard>
  );
}

/** Hashtags e temas a subir ou a descer, sítios, música, GIFs e as publicações com mais alcance. */
export default function AnContent() {
  const { q } = useAnalysis<Content>('content');
  const r = q.data;
  return (
    <AnPage
      title="Conteúdo e tendências"
      intro="Sobre o que se publica, onde, com que música e GIFs, e o que chega a mais gente."
      state={q}
      how={
        <>
          <p><b>A subir / a descer:</b> compara os usos no período escolhido com o período anterior do mesmo tamanho (por exemplo, estes 30 dias com os 30 antes). «Novo» quer dizer que não havia antes.</p>
          <p><b>Só conteúdo público:</b> entram publicações de contas públicas. Uma hashtag, sítio, música ou GIF só aparece se for usado por 3 pessoas diferentes ou mais (para não expor o hábito de alguém).</p>
          <p><b>Temas:</b> os do Explorar, classificados pelo Txillapp. <b>Alcance:</b> pessoas diferentes que viram a publicação no feed durante o período.</p>
        </>
      }
    >
      {r && (
        <>
          <TrendCard title="Hashtags" t={r.hashtags} prefix="#" />
          <TrendCard title="Temas" t={r.topics} />
          <AnGrid cols={3}>
            <AnCard title="Sítios mais publicados">
              {r.places.length === 0 ? <AnEmpty>Nada ainda.</AnEmpty> : <AnBars color={SERIES[2]} rows={r.places.map((p) => ({ label: p.label, value: p.posts, text: `${fmt(p.posts)} · ${fmt(p.people)} pessoas` }))} />}
            </AnCard>
            <AnCard title="Música mais usada" hint="Em publicações e mimos (sem os áudios gravados pela pessoa)">
              {r.music.length === 0 ? <AnEmpty>Nada ainda.</AnEmpty> : <AnBars color={SERIES[1]} rows={r.music.map((m) => ({ label: `${m.title}${m.artist ? ` · ${m.artist}` : ''}`, value: m.uses, hint: `${m.inPosts} em publicações · ${m.inMimos} em mimos · ${m.people} pessoas` }))} />}
            </AnCard>
            <AnCard title="GIFs mais usados" hint="Nas conversas e nos comentários">
              {r.gifs.length === 0 ? <AnEmpty>Nada ainda.</AnEmpty> : (
                <AnBars rows={r.gifs.map((g) => ({
                  label: g.url ? <a href={g.url} target="_blank" rel="noreferrer noopener" className="underline decoration-zinc-300 hover:decoration-zinc-700">{g.title}</a> : g.title,
                  value: g.uses,
                  hint: `${g.inChat} em conversas · ${g.inComments} em comentários · ${g.people} pessoas`,
                }))} />
              )}
            </AnCard>
          </AnGrid>
          <AnCard title="Publicações com mais alcance" hint="Públicas, no período">
            {r.topPosts.length === 0 ? <AnEmpty>Nada ainda.</AnEmpty> : (
              <AnTable
                head={['Publicação', 'Alcance', 'Brindes', 'Comentários', 'Data']}
                align={['l', 'r', 'r', 'r', 'r']}
                rows={r.topPosts.map((p) => [
                  <a key="l" href={POST_URL(p.code)} target="_blank" rel="noreferrer noopener" className="line-clamp-2 max-w-md font-semibold text-zinc-900 underline decoration-zinc-300 hover:decoration-zinc-700">
                    {p.tcheka ? 'Tcheka · ' : ''}{p.body || '(sem texto)'}
                  </a>,
                  fmt(p.reach), fmt(p.cheers), fmt(p.comments), when(p.createdAt),
                ])}
              />
            )}
          </AnCard>
        </>
      )}
    </AnPage>
  );
}
