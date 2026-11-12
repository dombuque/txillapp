import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import Icon from '../../components/Icon';
import { Badge, Empty, ago, btnGhost, td, th, useCan } from './bo';
import { catalogApi, type MusicAdminItem, type MusicSort, type MusicStatus, type MusicStatusFilter } from './ui/music-api';
import { DecideDialog, Field, inputCls, selectCls, useDebounced, useToast } from './ui/mod-kit';

type Tab = 'uses' | 'dislikes' | 'featured' | 'hidden' | 'downranked' | 'all';
const TABS: { id: Tab; label: string; sort: MusicSort; status: MusicStatusFilter }[] = [
  { id: 'uses', label: 'Mais usadas', sort: 'uses', status: 'all' },
  { id: 'dislikes', label: 'Mais rejeitadas', sort: 'dislikes', status: 'all' },
  { id: 'featured', label: 'Destacadas', sort: 'uses', status: 'featured' },
  { id: 'hidden', label: 'Escondidas', sort: 'recent', status: 'hidden' },
  { id: 'downranked', label: 'Abaixo do limiar', sort: 'dislikes', status: 'downranked' },
  { id: 'all', label: 'Todas', sort: 'quality', status: 'all' },
];
const SOURCE: Record<string, string> = { ccmixter: 'ccMixter', archive: 'Internet Archive', jamendo: 'Jamendo', freesound: 'Freesound', local: 'Artistas de Moçambique' };
const sourceLabel = (s: string) => SOURCE[s] ?? s;
const licenseLabel = (l: string) => (l === 'cc0' ? 'CC0' : l === 'pdm' ? 'Domínio público' : l === 'txillapp' ? 'Artista no Txillapp' : `CC ${l.toUpperCase()}`);
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const STATUS: Record<MusicStatus, { label: string; tone: 'zinc' | 'green' | 'red' | 'amber' | 'blue' }> = {
  active: { label: 'na lista', tone: 'green' },
  featured: { label: 'destacada', tone: 'blue' },
  hidden: { label: 'escondida', tone: 'red' },
};
const ACTION: Record<MusicStatus, { verb: string; help: string; done: string }> = {
  hidden: { verb: 'Esconder', help: 'Sai de todas as listas do seletor e deixa de poder ser posta em mimos e tchekas novos. Os que já a têm continuam.', done: 'Faixa escondida' },
  featured: { verb: 'Destacar', help: 'Aparece no topo de «Em alta no Txillapp» para toda a gente.', done: 'Faixa destacada' },
  active: { verb: 'Repor', help: 'Volta ao normal: entra nas listas pela ordem de uso e de qualidade.', done: 'Faixa reposta' },
};

/** Ouvir um pedaço da faixa (só uma de cada vez). */
function Preview({ item, playing, onToggle }: { item: MusicAdminItem; playing: boolean; onToggle: () => void }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const a = ref.current;
    if (!a) return;
    if (playing) void a.play().catch(() => onToggle());
    else a.pause();
  }, [playing, onToggle]);
  return (
    <>
      <button type="button" onClick={onToggle} aria-label={playing ? `Parar ${item.title}` : `Ouvir ${item.title}`} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white hover:bg-zinc-700">
        <Icon name={playing ? 'pause' : 'play'} size={14} />
      </button>
      <audio ref={ref} src={item.previewUrl} preload="none" onEnded={onToggle} />
    </>
  );
}

/** Backoffice › Música › Catálogo: o catálogo curado do seletor, as faixas mais usadas e as mais rejeitadas; esconder, destacar e repor (fica na auditoria). */
export function MusicCatalogPanel() {
  const qc = useQueryClient();
  const toast = useToast();
  const can = useCan('catalog.manage');
  const [tab, setTab] = useState<Tab>('uses');
  const [style, setStyle] = useState('');
  const [text, setText] = useState('');
  const q = useDebounced(text.trim());
  const [playing, setPlaying] = useState<string | null>(null);
  const [acting, setActing] = useState<{ item: MusicAdminItem; status: MusicStatus } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const t = TABS.find((x) => x.id === tab)!;

  const list = useQuery({ queryKey: ['bo-music-catalog', tab, style, q], queryFn: () => catalogApi.list({ sort: t.sort, status: t.status, style: style || undefined, q: q || undefined }) });
  const items = list.data?.items ?? [];
  const reload = () => void qc.invalidateQueries({ queryKey: ['bo-music-catalog'] });
  const toggle = (id: string) => setPlaying((p) => (p === id ? null : id));

  async function refreshNow() {
    setRefreshing(true);
    try {
      const r = await catalogApi.refresh();
      const failed = Object.entries(r.sources).filter(([, s]) => !s.ok).map(([k]) => sourceLabel(k));
      toast.show(`Catálogo atualizado: ${r.added} novas, ${r.updated} atualizadas, ${r.total} no total${failed.length ? `. Falharam: ${failed.join(', ')}` : ''}`, failed.length ? 'err' : 'ok');
      reload();
    } catch (e) {
      toast.show((e as Error).message, 'err');
    }
    setRefreshing(false);
  }

  const actions = (i: MusicAdminItem, cls: string) => can && (
    <>
      {i.status !== 'hidden' && <button type="button" onClick={() => setActing({ item: i, status: 'hidden' })} className={`${cls} bg-zinc-100 text-zinc-700 hover:bg-zinc-200`}>Esconder</button>}
      {i.status !== 'featured' && i.status !== 'hidden' && <button type="button" onClick={() => setActing({ item: i, status: 'featured' })} className={`${cls} bg-blue-600 text-white hover:bg-blue-700`}>Destacar</button>}
      {i.status !== 'active' && <button type="button" onClick={() => setActing({ item: i, status: 'active' })} className={`${cls} border border-zinc-300 text-zinc-700 hover:bg-zinc-50`}>Repor</button>}
    </>
  );
  const credit = (i: MusicAdminItem) => (
    <>
      <span className="block truncate font-semibold">{i.title}</span>
      <span className="block truncate text-xs text-zinc-500">
        {i.artist || 'Autor desconhecido'}{i.artistUsername ? <> · <a href={`/${i.artistUsername}`} target="_blank" rel="noopener noreferrer" className="underline">@{i.artistUsername}</a></> : null}
        {i.kind === 'sound' ? ' · som' : ''}
      </span>
    </>
  );
  const dislikes = (i: MusicAdminItem) => (
    <span className={i.downranked ? 'font-bold text-red-700' : ''} title={i.downranked ? 'Abaixo do limiar: desce para todos' : undefined}>
      {i.dislikes}{i.downranked ? ' ↓' : ''}
    </span>
  );
  const styleLabel = (id: string) => list.data?.styles.find((s) => s.id === id)?.label ?? id;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-sm text-zinc-600">O catálogo curado do seletor de música dos mimos e das tchekas: só faixas com sinais de qualidade das fontes e licença que deixa usar, mais as faixas aprovadas dos artistas de Moçambique. As contagens são agregadas (nunca quem usou ou rejeitou).</p>
        {can ? <button type="button" disabled={refreshing} onClick={() => void refreshNow()} className={btnGhost}><Icon name="repeat" size={16} className="mr-1.5" />{refreshing ? 'A atualizar…' : 'Atualizar agora'}</button> : null}
      </div>

      {list.data && (
        <div className="mb-4 grid gap-3 md:grid-cols-[1fr_2fr]">
          <div className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200/70">
            <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">Limiar do «Não gosto desta»</p>
            <p className="mt-1 text-2xl font-bold text-zinc-900">{list.data.threshold.minPeople} pessoas</p>
            <p className="mt-1 text-sm text-zinc-600">{list.data.threshold.rule}</p>
            <p className="mt-2 text-xs text-zinc-500">Catálogo: {list.data.total} faixas · atualizado {list.data.refreshedAt ? ago(list.data.refreshedAt) : 'nunca'}</p>
          </div>
          <div className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200/70">
            <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">Fontes</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {list.data.sources.map((s) => (
                <li key={s.id} title={s.note} className={`rounded-xl px-3 py-2 text-sm ring-1 ${s.enabled ? (s.lastError ? 'bg-amber-50 ring-amber-200' : 'bg-emerald-50 ring-emerald-200') : 'bg-zinc-50 ring-zinc-200'}`}>
                  <span className="font-semibold">{sourceLabel(s.id)}</span> <span className="text-zinc-500">· {s.enabled ? `${s.tracks} faixas` : 'desligada'}</span>
                  {s.note && <span className="block max-w-xs text-xs text-zinc-500">{s.note}</span>}
                  {s.lastError && <span className="block max-w-xs text-xs text-amber-800">Último erro: {s.lastError}</span>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div role="tablist" aria-label="Lista" className="mb-4 flex flex-wrap gap-2">
        {TABS.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} onClick={() => setTab(x.id)} className={`h-9 rounded-lg px-4 text-sm font-semibold ${tab === x.id ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-50'}`}>{x.label}</button>
        ))}
      </div>
      <div className="mb-4 grid gap-3 rounded-2xl bg-white p-3 ring-1 ring-zinc-200/70 sm:p-4 md:grid-cols-[1fr_220px] md:items-end">
        <Field label="Procurar"><input value={text} onChange={(e) => setText(e.target.value)} placeholder="Título ou artista" className={inputCls} /></Field>
        <Field label="Estilo">
          <select value={style} onChange={(e) => setStyle(e.target.value)} className={`${selectCls} w-full`}>
            <option value="">Todos</option>
            {list.data?.styles.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </Field>
      </div>

      {list.isError ? <Empty title="Não consegui carregar a música" text={(list.error as Error).message} /> : list.isLoading ? <div className="h-40 animate-pulse rounded-2xl bg-white" /> : items.length === 0 ? (
        <Empty title="Nada nesta lista" text={tab === 'hidden' ? 'Nenhuma faixa escondida.' : tab === 'featured' ? 'Nenhuma faixa destacada.' : tab === 'downranked' ? 'Nenhuma faixa passou o limiar de rejeições.' : undefined} />
      ) : (
        <>
          {/* Computador: tabela. */}
          <div className="hidden overflow-x-auto rounded-2xl bg-white shadow-[0_1px_2px_rgba(15,18,25,0.06)] ring-1 ring-zinc-200/70 md:block">
            <table className="w-full">
              <thead className="border-b border-zinc-200 bg-zinc-50">
                <tr>
                  <th className={`${th} w-10`} /><th className={th}>Faixa</th><th className={th}>Fonte e licença</th><th className={th}>Estilos</th><th className={th}>Duração</th>
                  <th className={th}>Usos 7 d / 30 d</th><th className={th}>Não gosto</th><th className={th}>Qualidade</th><th className={th}>Estado</th><th className={th} />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {items.map((i) => (
                  <tr key={i.id} className={`hover:bg-zinc-50/60 ${i.status === 'hidden' ? 'opacity-60' : ''}`}>
                    <td className={td}><Preview item={i} playing={playing === i.id} onToggle={() => toggle(i.id)} /></td>
                    <td className={`${td} max-w-[260px]`}>{credit(i)}</td>
                    <td className={`${td} whitespace-nowrap text-xs`}>
                      <span className="block text-zinc-700">{i.landing ? <a href={i.landing} target="_blank" rel="noopener noreferrer" className="underline">{sourceLabel(i.source)}</a> : sourceLabel(i.source)}</span>
                      <span className="text-zinc-500">{i.licenseUrl ? <a href={i.licenseUrl} target="_blank" rel="noopener noreferrer" className="underline">{licenseLabel(i.license)}</a> : licenseLabel(i.license)}</span>
                    </td>
                    <td className={td}><span className="flex flex-wrap gap-1">{i.styles.map((s) => <Badge key={s}>{styleLabel(s)}</Badge>)}</span></td>
                    <td className={`${td} tabular-nums`}>{mmss(i.duration)}</td>
                    <td className={`${td} tabular-nums`}>{i.uses7d} / {i.uses30d}</td>
                    <td className={`${td} tabular-nums`}>{dislikes(i)}</td>
                    <td className={`${td} tabular-nums`}>{Math.round(i.quality * 100)}%</td>
                    <td className={td}>
                      <Badge tone={STATUS[i.status].tone}>{STATUS[i.status].label}</Badge>
                      {i.downranked && <span className="ml-1"><Badge tone="amber">abaixo do limiar</Badge></span>}
                      {i.statusReason && <span className="mt-0.5 block max-w-[200px] truncate text-xs text-zinc-500" title={i.statusReason}>{i.statusReason}{i.statusAt ? ` · ${ago(i.statusAt)}` : ''}</span>}
                    </td>
                    <td className={`${td} whitespace-nowrap text-right`}><span className="inline-flex gap-1">{actions(i, 'rounded-md px-2.5 py-1 text-xs font-semibold')}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Telemóvel: cartões. */}
          <ul className="space-y-2 md:hidden">
            {items.map((i) => (
              <li key={i.id} className={`rounded-xl bg-white p-3 ring-1 ring-zinc-200/70 ${i.status === 'hidden' ? 'opacity-60' : ''}`}>
                <div className="flex items-start gap-3">
                  <Preview item={i} playing={playing === i.id} onToggle={() => toggle(i.id)} />
                  <div className="min-w-0 flex-1">
                    {credit(i)}
                    <p className="mt-1 text-xs text-zinc-500">{sourceLabel(i.source)} · {licenseLabel(i.license)} · {mmss(i.duration)} · {i.styles.map(styleLabel).join(', ')}</p>
                    <p className="text-xs text-zinc-600">Usos {i.uses7d} (7 d) · {i.uses30d} (30 d) · Não gosto {dislikes(i)} · Qualidade {Math.round(i.quality * 100)}%</p>
                    <p className="mt-1"><Badge tone={STATUS[i.status].tone}>{STATUS[i.status].label}</Badge>{i.downranked && <span className="ml-1"><Badge tone="amber">abaixo do limiar</Badge></span>}</p>
                  </div>
                </div>
                {can && <div className="mt-2 flex gap-2">{actions(i, 'h-9 flex-1 rounded-lg text-sm font-semibold')}</div>}
              </li>
            ))}
          </ul>
        </>
      )}

      {acting && (
        <DecideDialog
          title={`${ACTION[acting.status].verb} «${acting.item.title}»`}
          help={ACTION[acting.status].help}
          confirm={ACTION[acting.status].verb}
          danger={acting.status === 'hidden'}
          presets={acting.status === 'hidden' ? ['Qualidade má', 'Licença duvidosa', 'Não é música', 'Letra imprópria', 'Muitas rejeições'] : acting.status === 'featured' ? ['Faixa do momento', 'Artista local', 'Campanha'] : ['Revisto: está bem']}
          onCancel={() => setActing(null)}
          onConfirm={async (reason) => {
            await catalogApi.setStatus(acting.item.id, acting.status, reason);
            toast.show(ACTION[acting.status].done);
            setActing(null);
            reload();
          }}
        />
      )}
      {toast.node}
    </>
  );
}
