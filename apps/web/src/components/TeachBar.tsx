import { useState } from 'react';
import { api, type Post } from '../lib/api';
import { tr } from '../lib/i18n';
import Icon from './Icon';

/**
 * "Interessado / Não interessado": ensina o algoritmo (só aparece em publicações de quem não segues).
 * Não interessado esconde-a e mostra menos disto; Interessado mostra mais.
 */
export default function TeachBar({ post, dark = false, onNo, className = '' }: { post: Post; dark?: boolean; onNo?: () => void; className?: string }) {
  const [done, setDone] = useState<null | 'yes' | 'no'>(null);
  const [busy, setBusy] = useState(false);
  async function pick(v: 1 | -1) {
    if (busy) return;
    setBusy(true);
    try {
      await api.setInterest(post.id, v);
      setDone(v > 0 ? 'yes' : 'no');
      if (v < 0) window.setTimeout(() => onNo?.(), 450);
    } catch {
      /* sem rede: não conta */
    }
    setBusy(false);
  }
  const base = dark
    ? 'flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-white/15 text-[15px] font-semibold text-white backdrop-blur-sm transition active:scale-95'
    : 'flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-zinc-100 text-[14px] font-semibold text-zinc-800 transition active:scale-95';
  if (done) {
    return (
      <p role="status" className={`${className} flex h-11 items-center justify-center rounded-xl text-[14px] font-semibold ${dark ? 'bg-white/15 text-white' : 'bg-zinc-100 text-zinc-700'}`}>
        {done === 'yes' ? tr('Boa! Vamos mostrar mais disto.') : tr('Ok, vamos mostrar menos disto.')}
      </p>
    );
  }
  return (
    <div className={`${className} flex gap-2`}>
      <button type="button" onClick={() => void pick(-1)} className={base}><Icon name="x" size={16} strokeWidth={2.6} /> {tr('Não interessado')}</button>
      <button type="button" onClick={() => void pick(1)} className={base}><Icon name="check" size={16} strokeWidth={2.6} /> {tr('Interessado')}</button>
    </div>
  );
}
