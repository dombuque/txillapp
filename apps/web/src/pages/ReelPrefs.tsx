import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import Icon from '../components/Icon';
import StackPage from '../components/StackPage';
import { api, type FeedSettings } from '../lib/api';
import { tr } from '../lib/i18n';

type T = { id: string; label: string };

/**
 * O teu algoritmo (ecrã próprio, não é uma janela): uma frase com o que andas a ver, "o que queres ver mais" e "o que queres ver menos".
 * Os temas que o Txillapp aprendeu contigo vêm já escolhidos; tocas num tema para o juntar, e no × para o tirar.
 */
export default function ReelPrefs() {
  const qc = useQueryClient();
  const topics = useQuery({ queryKey: ['explore-topics', 'all'], queryFn: () => api.exploreTopics(true), staleTime: 60_000, retry: false });
  const prefs = useQuery({ queryKey: ['explore-prefs'], queryFn: api.explorePrefs, retry: false });
  const activity = useQuery({ queryKey: ['explore-activity'], queryFn: api.exploreActivity, retry: false });
  const settings = useQuery({ queryKey: ['feed-settings'], queryFn: api.feedSettings, retry: false });
  const people = useQuery({ queryKey: ['feed-people'], queryFn: api.feedPeople, retry: false });
  const [who, setWho] = useState('');
  const [personErr, setPersonErr] = useState('');
  const [picking, setPicking] = useState<null | 'more' | 'less'>(null);
  const [busy, setBusy] = useState(false);
  const mine = prefs.data ?? {};
  const all: T[] = topics.data ?? [];
  const label = (id: string) => all.find((t) => t.id === id)?.label ?? activity.data?.find((t) => t.id === id)?.label ?? id;

  const less = Object.keys(mine).filter((k) => mine[k] === -1).map((id) => ({ id, label: label(id) }));
  const explicitMore = Object.keys(mine).filter((k) => mine[k] === 1).map((id) => ({ id, label: label(id) }));
  const learned = (activity.data ?? []).filter((t) => mine[t.id] !== -1 && mine[t.id] !== 1);
  const more: (T & { learned: boolean })[] = [...explicitMore.map((t) => ({ ...t, learned: false })), ...learned.slice(0, 6).map((t) => ({ ...t, learned: true }))];
  const used = new Set([...more.map((t) => t.id), ...less.map((t) => t.id)]);
  const suggestions = all.filter((t) => !used.has(t.id)).slice(0, 4);
  const top = (activity.data ?? []).slice(0, 3).map((t) => tr(t.label).toLowerCase());

  async function set(topic: string, pref: -1 | 0 | 1) {
    const next = { ...mine } as Record<string, number>;
    if (pref === 0) delete next[topic];
    else next[topic] = pref;
    qc.setQueryData(['explore-prefs'], next);
    try {
      qc.setQueryData(['explore-prefs'], await api.setExplorePref(topic, pref));
      void qc.invalidateQueries({ queryKey: ['reels'] });
      void qc.invalidateQueries({ queryKey: ['explore'] });
    } catch {
      void qc.invalidateQueries({ queryKey: ['explore-prefs'] });
    }
  }
  const refreshFeeds = () => { void qc.invalidateQueries({ queryKey: ['reels'] }); void qc.invalidateQueries({ queryKey: ['explore'] }); };
  async function setOpt<K extends keyof FeedSettings>(k: K, v: FeedSettings[K]) {
    const prev = settings.data;
    if (prev) qc.setQueryData(['feed-settings'], { ...prev, [k]: v });
    try {
      qc.setQueryData(['feed-settings'], await api.setFeedSettings({ [k]: v }));
      refreshFeeds();
    } catch {
      qc.setQueryData(['feed-settings'], prev);
    }
  }
  async function addPerson(pref: -1 | 1) {
    setPersonErr('');
    try {
      qc.setQueryData(['feed-people'], await api.setFeedPerson(who.trim().replace(/^@/, ''), pref));
      setWho('');
      refreshFeeds();
    } catch (e) {
      setPersonErr((e as Error).message);
    }
  }
  async function removePerson(username: string) {
    qc.setQueryData(['feed-people'], await api.setFeedPerson(username, 0));
    refreshFeeds();
  }
  const cur = settings.data;
  const opt = <K extends 'following' | 'freshness' | 'media' | 'variety'>(title: string, key: K, options: [FeedSettings[K], string][]) => (
    <div className="mb-4">
      <p className="mb-2 text-[15px] font-semibold text-zinc-800">{title}</p>
      <div role="radiogroup" aria-label={title} className="flex rounded-full bg-zinc-100 p-1">
        {options.map(([v, label]) => (
          <button key={String(v)} type="button" role="radio" aria-checked={cur?.[key] === v} onClick={() => void setOpt(key, v)} className={`h-10 min-w-0 flex-1 truncate rounded-full px-1.5 text-[13px] font-bold transition active:scale-95 ${cur?.[key] === v ? 'bg-brand text-white' : 'text-zinc-700'}`}>{label}</button>
        ))}
      </div>
    </div>
  );
  const sw = (title: string, text: string, key: 'hideSeen' | 'calm') => (
    <div className="flex items-center gap-3 py-2">
      <span className="min-w-0 flex-1"><span className="block font-semibold">{title}</span><span className="block text-sm text-zinc-600">{text}</span></span>
      <button type="button" role="switch" aria-checked={!!cur?.[key]} aria-label={title} onClick={() => void setOpt(key, !cur?.[key])} className={`relative h-8 w-14 shrink-0 rounded-full transition-colors ${cur?.[key] ? 'bg-brand' : 'bg-zinc-300'}`}>
        <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${cur?.[key] ? 'left-7' : 'left-1'}`} />
      </button>
    </div>
  );
  async function reset() {
    setBusy(true);
    await api.resetExplore().catch(() => undefined);
    await qc.invalidateQueries({ queryKey: ['explore-prefs'] });
    await qc.invalidateQueries({ queryKey: ['explore-activity'] });
    await qc.invalidateQueries({ queryKey: ['feed-settings'] });
    await qc.invalidateQueries({ queryKey: ['feed-people'] });
    void qc.invalidateQueries({ queryKey: ['reels'] });
    void qc.invalidateQueries({ queryKey: ['explore'] });
    setBusy(false);
  }

  const chip = 'inline-flex h-11 items-center gap-1.5 rounded-full px-4 text-[15px] font-semibold transition active:scale-95';
  const filled = `${chip} bg-zinc-100 text-zinc-900`;
  const outline = `${chip} border border-zinc-300 bg-white text-zinc-900`;
  const headline = top.length
    ? tr('Ultimamente tens andado a ver {v0}.', { v0: top.length > 1 ? `${top.slice(0, -1).join(', ')} ${tr('e')} ${top[top.length - 1]}` : top[0] })
    : tr('Ainda estou a conhecer-te. Brinda, comenta e guarda o que gostas para eu aprender.');

  return (
    <StackPage title={tr('O teu algoritmo')}>
      <div className="px-5 pb-12 pt-5">
        <h2 className="text-[26px] font-extrabold leading-tight tracking-tight">{headline}</h2>

        <section className="mt-9" aria-label={tr('Constrói o teu algoritmo')}>
          <h3 className="text-[16px] font-bold">{tr('Constrói o teu algoritmo')}</h3>
          <p className="mb-4 text-sm text-zinc-500">{tr('Escolhe como o Explorar e os Reels te mostram as coisas')}</p>
          {opt(tr('De onde vem o que vês'), 'following', [['less', tr('Descobrir mais')], ['balanced', tr('Equilibrado')], ['more', tr('Mais de quem sigo')]])}
          {opt(tr('Ordem'), 'freshness', [['recent', tr('Mais recentes')], ['balanced', tr('Equilibrado')], ['popular', tr('Mais populares')]])}
          {opt(tr('Tipo de conteúdo'), 'media', [['all', tr('Tudo')], ['photos', tr('Fotos')], ['videos', tr('Vídeos')]])}
          {opt(tr('Variedade de contas'), 'variety', [['low', tr('Poucas contas')], ['normal', tr('Normal')], ['high', tr('Muitas contas')]])}
          {sw(tr('Esconder o que já vi'), tr('Não repete publicações que já te apareceram.'), 'hideSeen')}
          {sw(tr('Modo tranquilo'), tr('Menos festa e bebidas, para dias mais calmos.'), 'calm')}
        </section>

        <section className="mt-9" aria-label={tr('Pessoas')}>
          <h3 className="text-[16px] font-bold">{tr('Pessoas')}</h3>
          <p className="mb-3 text-sm text-zinc-500">{tr('Quem queres ver mais ou menos no Explorar e nos Reels')}</p>
          <div className="flex gap-2">
            <input value={who} onChange={(e) => setWho(e.target.value)} placeholder={tr('@utilizador')} aria-label={tr('Utilizador')} autoCapitalize="none" autoCorrect="off" className="h-12 min-w-0 flex-1 rounded-2xl bg-zinc-100 px-4 outline-none focus:bg-zinc-200/70" />
            <button type="button" disabled={!who.trim()} onClick={() => void addPerson(1)} className="h-12 rounded-full bg-brand px-5 text-sm font-bold text-white disabled:opacity-50">{tr('Mais')}</button>
            <button type="button" disabled={!who.trim()} onClick={() => void addPerson(-1)} className="h-12 rounded-full bg-zinc-100 px-5 text-sm font-bold text-zinc-900 disabled:opacity-50">{tr('Menos')}</button>
          </div>
          {personErr && <p role="alert" className="mt-1.5 text-sm text-red-600">{personErr}</p>}
          <div className="mt-3 flex flex-wrap gap-2.5">
            {(people.data ?? []).map((p) => (
              <span key={p.username} className={`${chip} ${p.pref > 0 ? 'bg-rose-50' : 'bg-zinc-100'} text-zinc-900`}>
                {p.pref > 0 ? tr('Mais') : tr('Menos')} · @{p.username}
                <button type="button" onClick={() => void removePerson(p.username)} aria-label={tr('Tirar {v0}', { v0: `@${p.username}` })} className="-mr-1 flex h-6 w-6 items-center justify-center rounded-full text-zinc-500 active:bg-zinc-200"><Icon name="x" size={14} strokeWidth={2.4} /></button>
              </span>
            ))}
          </div>
        </section>

        <section className="mt-9" aria-label={tr('O que queres ver mais')}>
          <h3 className="text-[16px] font-bold">{tr('O que queres ver mais')}</h3>
          <p className="mb-3 text-sm text-zinc-500">{tr('Com base na tua atividade e nas tuas escolhas')}</p>
          <div className="flex flex-wrap gap-2.5">
            {more.map((t) => (
              <span key={t.id} className={filled}>
                {tr(t.label)}
                <button type="button" onClick={() => void set(t.id, t.learned ? -1 : 0)} aria-label={tr('Tirar {v0}', { v0: tr(t.label) })} className="-mr-1 flex h-6 w-6 items-center justify-center rounded-full text-zinc-500 active:bg-zinc-200"><Icon name="x" size={14} strokeWidth={2.6} /></button>
              </span>
            ))}
            {suggestions.map((t) => (
              <button key={t.id} type="button" onClick={() => void set(t.id, 1)} className={outline}><Icon name="plus" size={15} strokeWidth={2.4} /> {tr(t.label)}</button>
            ))}
            <button type="button" onClick={() => setPicking(picking === 'more' ? null : 'more')} className={outline}><Icon name="plus" size={15} strokeWidth={2.4} /> {tr('Adicionar')}</button>
          </div>
          {picking === 'more' && <AllTopics all={all} skip={used} onPick={(id) => { void set(id, 1); setPicking(null); }} />}
        </section>

        <section className="mt-9" aria-label={tr('O que queres ver menos')}>
          <h3 className="mb-3 text-[16px] font-bold">{tr('O que queres ver menos')}</h3>
          <div className="flex flex-wrap gap-2.5">
            {less.map((t) => (
              <span key={t.id} className={filled}>
                {tr(t.label)}
                <button type="button" onClick={() => void set(t.id, 0)} aria-label={tr('Tirar {v0}', { v0: tr(t.label) })} className="-mr-1 flex h-6 w-6 items-center justify-center rounded-full text-zinc-500 active:bg-zinc-200"><Icon name="x" size={14} strokeWidth={2.6} /></button>
              </span>
            ))}
            <button type="button" onClick={() => setPicking(picking === 'less' ? null : 'less')} className={outline}><Icon name="plus" size={15} strokeWidth={2.4} /> {tr('Adicionar')}</button>
          </div>
          {picking === 'less' && <AllTopics all={all} skip={used} onPick={(id) => { void set(id, -1); setPicking(null); }} />}
        </section>

        <button onClick={() => void reset()} disabled={busy} className="mt-12 h-12 w-full rounded-full bg-zinc-100 font-bold text-zinc-800 active:scale-[0.98] disabled:opacity-60">{tr('Repor o algoritmo')}</button>
        <p className="mt-2 text-center text-xs text-zinc-500">{tr('Apaga as tuas escolhas e o "Interessado / Não interessado" que deste.')}</p>
      </div>
    </StackPage>
  );
}

/** Todos os temas, ali mesmo por baixo (sem janela por cima). */
function AllTopics({ all, skip, onPick }: { all: T[]; skip: Set<string>; onPick: (id: string) => void }) {
  const list = all.filter((t) => !skip.has(t.id));
  return (
    <div className="mt-4 rounded-3xl bg-zinc-50 p-3.5">
      {list.length === 0 ? <p className="py-2 text-center text-sm text-zinc-500">{tr('Já escolheste todos os temas.')}</p> : (
        <div className="flex flex-wrap gap-2">
          {list.map((t) => <button key={t.id} type="button" onClick={() => onPick(t.id)} className="h-10 rounded-full bg-white px-3.5 text-[14px] font-semibold text-zinc-800 ring-1 ring-zinc-200 active:scale-95">{tr(t.label)}</button>)}
        </div>
      )}
    </div>
  );
}
