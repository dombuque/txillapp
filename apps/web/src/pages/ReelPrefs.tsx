import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import Icon from '../components/Icon';
import StackPage from '../components/StackPage';
import { api } from '../lib/api';
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
  async function reset() {
    setBusy(true);
    await api.resetExplore().catch(() => undefined);
    await qc.invalidateQueries({ queryKey: ['explore-prefs'] });
    await qc.invalidateQueries({ queryKey: ['explore-activity'] });
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
