import { useNavigate } from 'react-router-dom';
import { tr } from '../lib/i18n';
import { FEATURES, markSeen, useIsNew, useUnseenFeatures } from '../lib/whatsNew';
import Icon from './Icon';

/** Pequeno "Novo" para pôr no canto do botão de uma função nova. Some quando a pessoa a descobre (`markSeen`). */
export function NewBadge({ id, className = '' }: { id: string; className?: string }) {
  const isNew = useIsNew(id);
  if (!isNew) return null;
  return <span aria-label={tr('Novo')} className={`pointer-events-none flex h-[18px] items-center rounded-full bg-gradient-to-r from-brand to-[#ff9a5b] px-1.5 text-[10px] font-black uppercase tracking-wide text-white shadow-[0_2px_6px_rgba(214,51,79,0.5)] ring-2 ring-white ${className}`}>{tr('Novo')}</span>;
}

/** Cartão no topo do feed com o que há de novo e ainda não foi descoberto. */
export default function WhatsNewCard() {
  const unseen = useUnseenFeatures();
  const navigate = useNavigate();
  if (!unseen.length) return null;
  const shown = unseen.slice(0, 3);
  return (
    <section aria-label={tr('Novidades')} className="mx-3 mb-4 overflow-hidden rounded-3xl bg-gradient-to-br from-brand to-[#ff9a5b] p-4 text-white shadow-[0_6px_18px_rgba(214,51,79,0.35)]">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/25"><Icon name="sparkles" size={16} /></span>
        <h2 className="flex-1 text-[17px] font-extrabold tracking-tight">{tr('Há novidades no Txillapp!')}</h2>
        <button type="button" onClick={() => markSeen(...FEATURES.map((f) => f.id))} aria-label={tr('Dispensar as novidades')} className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 active:scale-90"><Icon name="x" size={16} /></button>
      </div>
      <ul className="mt-3 space-y-2">
        {shown.map((f) => (
          <li key={f.id}>
            <button type="button" onClick={() => { markSeen(f.id); navigate(f.path); }} className="flex w-full items-center gap-3 rounded-2xl bg-white/15 p-2.5 text-left active:bg-white/25">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-brand"><Icon name={f.icon} size={20} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-bold leading-tight">{f.title}</span>
                <span className="block text-[13px] leading-snug text-white/90">{f.text}</span>
              </span>
              <Icon name="chevron-right" size={18} className="shrink-0 text-white/80" />
            </button>
          </li>
        ))}
      </ul>
      {unseen.length > shown.length && <p className="mt-2 text-center text-xs font-semibold text-white/85">{tr('E mais {n}…', { n: unseen.length - shown.length })}</p>}
    </section>
  );
}
