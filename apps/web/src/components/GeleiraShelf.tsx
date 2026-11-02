import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type MyTaste, type TasteItem, type TheirTaste } from '../lib/api';
import { ICE, KINDS, KIND_ICON, KIND_LABEL, iconOf } from '../lib/geleira';
import Icon from './Icon';

type Shown = TasteItem & { rating: number | null; favorite: boolean };

/** Nota em cinco pontos de gelo, pequenos, por baixo do nome. */
function Frost({ rating }: { rating: number | null }) {
  return (
    <span className="mt-1 flex justify-center gap-[3px]" aria-hidden>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={`h-[5px] w-[5px] rounded-full ${rating && n <= rating ? 'bg-sky-500' : 'bg-sky-200/70'}`} />
      ))}
    </span>
  );
}

/** Um gosto: bolinha de vidro com o ícone, o nome e a nota. O favorito leva um coração. */
function Tile({ item }: { item: Shown }) {
  const label = `${item.name}${item.rating ? `, ${ICE[item.rating]}` : ''}${item.favorite ? ', favorito' : ''}`;
  const inner = (
    <>
      <span className="relative flex h-[60px] w-[60px] items-center justify-center rounded-full bg-gradient-to-b from-white to-sky-100 text-sky-600 shadow-[0_4px_12px_rgba(14,116,144,0.2)] ring-1 ring-white">
        <Icon name={iconOf(item)} size={26} strokeWidth={1.6} />
        {item.favorite && (
          <span className="absolute -right-0.5 -top-0.5 flex h-[22px] w-[22px] items-center justify-center rounded-full bg-brand text-white ring-2 ring-white">
            <Icon name="heart" size={12} className="fill-white" />
          </span>
        )}
      </span>
      <span className="mt-2 line-clamp-2 min-h-[2.15em] w-full break-words text-center text-[12.5px] font-semibold leading-[1.1] text-zinc-800">{item.name}</span>
      {item.pending ? <span className="mt-1 text-[10px] font-medium text-zinc-500">à espera</span> : <Frost rating={item.rating} />}
    </>
  );
  return (
    <div role="img" aria-label={label} className="flex w-[78px] shrink-0 flex-col items-center">{inner}</div>
  );
}

/** Prateleira: os gostos em fila e, por baixo, a tábua de vidro. */
function Shelf({ title, icon, items }: { title: string; icon: Parameters<typeof Icon>[0]['name']; items: Shown[] }) {
  return (
    <div className="mt-5">
      <h3 className="mb-2 flex items-center gap-1.5 px-0.5 text-[12px] font-bold uppercase tracking-[0.12em] text-sky-800/70">
        <Icon name={icon} size={14} /> {title} <span className="font-semibold text-sky-800/45">{items.length}</span>
      </h3>
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-3 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((i) => <Tile key={i.id} item={i} />)}
      </div>
      <div aria-hidden className="h-[6px] rounded-full bg-gradient-to-r from-sky-200/70 via-white to-sky-200/70 shadow-[0_3px_5px_rgba(14,116,144,0.18)] ring-1 ring-white/80" />
    </div>
  );
}

/** A geleira: vitrine de gostos (vibes, bebidas, comidas, sítios), só para ver. Editar fica em "Editar perfil". Nos perfis dos outros só mostra o que a pessoa deixa ver. */
/** `compact`: fechada por omissão (cabeçalho e uma fila de bolinhas); toca-se para abrir as prateleiras. */
export default function GeleiraShelf({ username, isMe, flush = false, compact = false }: { username: string; isMe: boolean; flush?: boolean; compact?: boolean }) {
  const [open, setOpen] = useState(!compact);
  const q = useQuery({ queryKey: ['geleira', isMe ? 'me' : username], queryFn: (): Promise<(MyTaste | TheirTaste)[]> => (isMe ? api.geleiraMine() : api.geleiraOf(username)), retry: false });
  const items = q.data ?? [];
  if (q.isLoading) return <div className={`${flush ? '' : 'mx-4'} skel mt-4 ${compact ? 'h-[60px]' : 'h-48'} rounded-[24px]`} role="status" aria-label="A carregar a geleira" />;
  if (!isMe && (q.isError || items.length === 0)) return null;

  const favorites = items.filter((i) => i.favorite).slice(0, 8);
  const total = items.filter((i) => !i.pending).length;

  const folded = compact && !open;
  const preview = items.slice(0, 7);
  const more = items.length - preview.length;

  return (
    <section
      aria-label="Geleira"
      className={`${flush ? '' : 'mx-4'} mt-4 overflow-hidden rounded-[24px] border border-sky-100 bg-gradient-to-b from-sky-50 via-white to-cyan-50/60 px-4 shadow-[0_2px_12px_rgba(14,116,144,0.1)] ${folded ? 'pb-3 pt-3' : 'pb-6 pt-4'}`}
    >
      <button
        type="button"
        onClick={compact ? () => setOpen(!open) : undefined}
        disabled={!compact}
        aria-expanded={compact ? open : undefined}
        className="flex w-full items-center gap-3 text-left disabled:cursor-default"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-cyan-400 text-white shadow-[0_3px_8px_rgba(14,116,144,0.3)]"><Icon name="snowflake" size={22} /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[17px] font-extrabold leading-tight">{isMe ? 'A minha geleira' : 'Geleira'}</span>
          <span className="block text-[13px] text-zinc-600">
            {items.length === 0 ? 'Ainda vazia' : `${total} ${total === 1 ? 'gosto' : 'gostos'}${favorites.length ? ` · ${favorites.length} ${favorites.length === 1 ? 'favorito' : 'favoritos'}` : ''}`}
          </span>
        </span>
        {compact && <Icon name="chevron-right" size={20} className={`shrink-0 text-sky-700 transition-transform ${open ? 'rotate-90' : ''}`} />}
      </button>

      {folded && items.length > 0 && (
        <button type="button" onClick={() => setOpen(true)} aria-label="Abrir a geleira" className="mt-3 flex w-full items-center gap-1.5 text-left">
          {preview.map((i) => (
            <span key={i.id} className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-white to-sky-100 text-sky-600 shadow-[0_2px_6px_rgba(14,116,144,0.18)] ring-1 ring-white">
              <Icon name={iconOf(i)} size={19} strokeWidth={1.7} />
              {i.favorite && <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-brand ring-2 ring-white" />}
            </span>
          ))}
          {more > 0 && <span className="flex h-10 min-w-10 shrink-0 items-center justify-center rounded-full bg-sky-100 px-2 text-[13px] font-bold text-sky-700">+{more}</span>}
        </button>
      )}

      {items.length === 0 && (!compact || open) ? (
        <div className="mt-4 rounded-2xl bg-white/70 px-4 py-6 text-center ring-1 ring-sky-100">
          <p className="text-lg font-extrabold">Geleira vazia!</p>
          <p className="mx-auto mt-1 max-w-[17rem] text-zinc-600">{isMe ? 'Para a encher, vai a Editar perfil e abre "A minha geleira".' : 'Ainda não há nada para mostrar.'}</p>
        </div>
      ) : (
        !folded && items.length > 0 && (
          <>
            {favorites.length > 0 && <Shelf title="Os favoritos" icon="heart" items={favorites} />}
            {KINDS.map((k) => {
              const list = items.filter((i) => i.kind === k);
              return list.length ? <Shelf key={k} title={KIND_LABEL[k]} icon={KIND_ICON[k]} items={list} /> : null;
            })}
          </>
        )
      )}
    </section>
  );
}
