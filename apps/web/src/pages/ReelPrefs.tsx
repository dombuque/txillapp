import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import StackPage from '../components/StackPage';
import { api } from '../lib/api';
import { tr } from '../lib/i18n';

/** Os filtros do algoritmo dos reels e do Explorar: por tema, mais ou menos. Ecrã próprio (não é uma janela por cima). */
export default function ReelPrefs() {
  const qc = useQueryClient();
  const topics = useQuery({ queryKey: ['explore-topics', 'all'], queryFn: () => api.exploreTopics(true), staleTime: 60_000, retry: false });
  const prefs = useQuery({ queryKey: ['explore-prefs'], queryFn: api.explorePrefs, retry: false });
  const [busy, setBusy] = useState(false);
  const mine = prefs.data ?? {};

  async function set(topic: string, pref: -1 | 0 | 1) {
    qc.setQueryData(['explore-prefs'], { ...mine, ...(pref === 0 ? {} : { [topic]: pref }), ...(pref === 0 ? Object.fromEntries(Object.entries(mine).filter(([k]) => k !== topic)) : {}) });
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
    void qc.invalidateQueries({ queryKey: ['reels'] });
    void qc.invalidateQueries({ queryKey: ['explore'] });
    setBusy(false);
  }
  const seg = (active: boolean, tone: 'less' | 'more' | 'normal') =>
    `h-9 flex-1 rounded-full text-[13px] font-bold transition active:scale-95 ${active ? (tone === 'more' ? 'bg-zinc-900 text-white' : tone === 'less' ? 'bg-zinc-500 text-white' : 'bg-white text-zinc-900 shadow-sm') : 'text-zinc-600'}`;

  return (
    <StackPage title={tr('Filtros dos reels')}>
      <div className="px-4 pb-10 pt-3">
        <p className="text-sm text-zinc-600">{tr('Escolhe o que queres ver mais ou menos. Isto muda os reels e o Explorar. O algoritmo também aprende com o que brindas, comentas e guardas, e com o "Interessado / Não interessado" nos reels.')}</p>
        {topics.isLoading && <p className="py-10 text-center text-zinc-500">{tr('A carregar…')}</p>}
        <ul className="mt-4 divide-y divide-zinc-100">
          {(topics.data ?? []).map((t) => {
            const p = mine[t.id] ?? 0;
            return (
              <li key={t.id} className="flex items-center gap-3 py-3">
                <span className="min-w-0 flex-1 truncate text-[16px] font-semibold">{tr(t.label)}</span>
                <div role="radiogroup" aria-label={tr(t.label)} className="flex w-[210px] shrink-0 gap-1 rounded-full bg-zinc-100 p-1">
                  <button role="radio" aria-checked={p === -1} onClick={() => void set(t.id, p === -1 ? 0 : -1)} className={seg(p === -1, 'less')}>{tr('Menos')}</button>
                  <button role="radio" aria-checked={p === 0} onClick={() => void set(t.id, 0)} className={seg(p === 0, 'normal')}>{tr('Normal')}</button>
                  <button role="radio" aria-checked={p === 1} onClick={() => void set(t.id, p === 1 ? 0 : 1)} className={seg(p === 1, 'more')}>{tr('Mais')}</button>
                </div>
              </li>
            );
          })}
        </ul>
        <button onClick={() => void reset()} disabled={busy} className="mt-6 h-12 w-full rounded-full bg-zinc-100 font-bold text-zinc-800 active:scale-[0.98] disabled:opacity-60">{tr('Repor o algoritmo')}</button>
        <p className="mt-2 text-center text-xs text-zinc-500">{tr('Apaga estas escolhas e o "Interessado / Não interessado" que deste.')}</p>
      </div>
    </StackPage>
  );
}
