import { useEffect, useMemo, useState } from 'react';
import { tr } from '../lib/i18n';
import { FILTERS, bakeFilter, cssFilter, type Filter } from '../lib/filters';
import { firstTime } from '../lib/firstTime';
import Icon from './Icon';

/**
 * Antes de uma foto seguir no chat (tirada na câmara ou escolhida da galeria): vê-se, pode-se pôr legenda, escolher um filtro
 * e decidir se é de visualização única. Só vai quando se toca em Enviar.
 */
export default function ChatPhotoReview({ file, name, canOnce, initialCaption = '', onCancel, onSend }: {
  file: File;
  name: string;
  canOnce: boolean;
  initialCaption?: string;
  onCancel: () => void;
  onSend: (r: { file: File; caption: string; once: boolean }) => void;
}) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const [caption, setCaption] = useState(initialCaption);
  const [once, setOnce] = useState(false);
  const [help, setHelp] = useState(false);
  const [filter, setFilter] = useState<Filter>(FILTERS[0]);
  const [filters, setFilters] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onCancel]);

  async function send() {
    setBusy(true);
    try {
      onSend({ file: await bakeFilter(file, filter), caption: caption.trim(), once: once && canOnce });
    } catch {
      onSend({ file, caption: caption.trim(), once: once && canOnce });
    }
  }

  const tint = filter.tint;
  return (
    <div role="dialog" aria-modal="true" aria-label={tr('Enviar foto')} className="fixed inset-0 z-[85] flex flex-col bg-black text-white">
      <div className="flex items-center justify-between px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button type="button" onClick={onCancel} aria-label={tr('Cancelar')} className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 active:scale-90"><Icon name="x" size={24} /></button>
        <button type="button" onClick={() => setFilters(!filters)} aria-pressed={filters} className={`flex h-11 items-center gap-2 rounded-full px-4 text-sm font-bold active:scale-95 ${filters ? 'bg-white text-zinc-900' : 'bg-white/15'}`}><Icon name="sparkles" size={18} /> {tr('Filtros')}</button>
      </div>

      <div className="relative min-h-0 flex-1 px-3 py-3">
        <img src={url} alt={tr('Pré-visualização da foto')} draggable={false} className="h-full w-full rounded-2xl object-contain" style={{ filter: cssFilter(filter) }} />
        {tint && <div aria-hidden className="pointer-events-none absolute inset-3 rounded-2xl mix-blend-soft-light" style={{ background: `rgba(${tint[0]},${tint[1]},${tint[2]},${Math.min(1, tint[3] * 3)})` }} />}
      </div>

      {filters && (
        <div role="radiogroup" aria-label={tr('Filtros')} className="flex gap-2.5 overflow-x-auto px-3 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" role="radio" aria-checked={filter.id === f.id} onClick={() => setFilter(f)} className="flex w-[64px] shrink-0 flex-col items-center gap-1 active:scale-95">
              <span className={`block h-[64px] w-[64px] overflow-hidden rounded-xl ${filter.id === f.id ? 'ring-2 ring-white' : 'opacity-80'}`}><img src={url} alt="" className="h-full w-full object-cover" style={{ filter: cssFilter(f) }} /></span>
              <span className={`w-full truncate text-center text-[11px] ${filter.id === f.id ? 'font-bold' : 'text-white/70'}`}>{f.name}</span>
            </button>
          ))}
        </div>
      )}

      {once && help && (
        <p role="status" className="mx-3 mb-2 flex items-center justify-between rounded-2xl bg-white/15 px-4 py-2 text-[13px] font-semibold">
          <span>{name} {tr('só vai poder abrir esta foto uma vez.')}</span>
          <button type="button" onClick={() => setHelp(false)} aria-label={tr('Fechar a explicação')} className="ml-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/20"><Icon name="x" size={14} /></button>
        </p>
      )}

      <div className="flex items-center gap-2 px-3 pb-[max(0.9rem,env(safe-area-inset-bottom))] pt-1">
        <div className="flex min-w-0 flex-1 items-center gap-1 rounded-[26px] bg-white/15 p-1.5">
          <input value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={200} placeholder={tr('Legenda para {v0}…', { v0: name })} aria-label={tr('Legenda')} className="h-10 min-w-0 flex-1 bg-transparent px-3 text-[16px] text-white outline-none placeholder:text-white/60" />
          {canOnce && (
            <button
              type="button"
              onClick={() => { if (!once && firstTime('view-once')) setHelp(true); setOnce(!once); }}
              aria-pressed={once}
              aria-label={tr('Visualização única')}
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition active:scale-90 ${once ? 'bg-white text-zinc-900' : 'text-white'}`}
            >
              <Icon name="once" size={24} />
            </button>
          )}
        </div>
        <button type="button" onClick={send} disabled={busy} className="flex h-12 shrink-0 items-center gap-2 rounded-full bg-brand px-5 font-bold text-white transition active:scale-95 disabled:opacity-60">
          {tr('Enviar')} <Icon name="messages" size={18} />
        </button>
      </div>
    </div>
  );
}
