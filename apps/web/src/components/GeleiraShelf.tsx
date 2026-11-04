import { useQuery } from '@tanstack/react-query';
import { tr } from '../lib/i18n';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type MyTaste, type TasteItem, type TheirTaste } from '../lib/api';
import { ICE, KINDS, KIND_ICON, KIND_LABEL } from '../lib/geleira';
import TasteBubble from './TasteIcon';
import FridgeArt, { LEVEL_LABEL, geleiraLevel, geleiraPoints, nextLevelHint } from './FridgeArt';
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
  const label = `${tr(item.name)}${item.rating ? `, ${ICE[item.rating]}` : ''}${item.favorite ? ', favorito' : ''}`;
  const inner = (
    <>
      <span className="relative">
        <TasteBubble item={item} size={60} />
        {item.favorite && (
          <span className="absolute -right-0.5 -top-0.5 flex h-[22px] w-[22px] items-center justify-center rounded-full bg-brand text-white ring-2 ring-white">
            <Icon name="heart" size={12} className="fill-white" />
          </span>
        )}
      </span>
      <span className="mt-2 line-clamp-2 min-h-[2.15em] w-full break-words text-center text-[12.5px] font-semibold leading-[1.1] text-zinc-800">{tr(item.name)}</span>
      {item.pending ? <span className="mt-1 text-[10px] font-medium text-zinc-500">{tr('à espera')}</span> : <Frost rating={item.rating} />}
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

/** Botão da geleira na linha de ações do perfil: abre/fecha a prateleira para baixo. Nos perfis dos outros só aparece se houver o que mostrar. */
export function GeleiraToggle({ username, isMe, open, onToggle, icon = false, grow = false }: { username: string; isMe: boolean; open: boolean; onToggle: () => void; icon?: boolean; grow?: boolean }) {
  const q = useQuery({ queryKey: ['geleira', isMe ? 'me' : username], queryFn: (): Promise<(MyTaste | TheirTaste)[]> => (isMe ? api.geleiraMine() : api.geleiraOf(username)), retry: false });
  const total = (q.data ?? []).length;
  if (!isMe && (q.isError || total === 0)) return null;
  return (
    <button
      onClick={onToggle}
      aria-expanded={open}
      aria-label={open ? tr('Fechar a geleira') : tr('Abrir a geleira')}
      className={`flex h-10 items-center justify-center gap-1.5 rounded-xl px-3 text-[14px] font-bold transition active:scale-95 ${icon ? `${grow ? 'flex-1' : 'w-11'} !px-0` : 'flex-1'} ${open ? 'bg-sky-200 text-sky-900 ring-1 ring-sky-300' : 'bg-sky-50 text-sky-900 ring-1 ring-sky-200'}`}
    >
      <FridgeArt count={total} level={geleiraLevel(geleiraPoints((q.data ?? []).filter((i) => !('pending' in i && (i as { pending?: boolean }).pending))))} open={open} size={24} />
      {!icon && <span>{tr('Geleira')}</span>}
      <Icon name="chevron-right" size={14} className={`transition ${open ? 'rotate-90' : ''}`} />
    </button>
  );
}

/** A geleira: vitrine de gostos (vibes, bebidas, comidas, sítios), só para ver. Editar fica em "Editar perfil". Nos perfis dos outros só mostra o que a pessoa deixa ver. */
/** `compact`: fechada por omissão (cabeçalho e uma fila de bolinhas); toca-se para abrir as prateleiras. */
export default function GeleiraShelf({ username, isMe, flush = false, compact = false }: { username: string; isMe: boolean; flush?: boolean; compact?: boolean }) {
  const [open, setOpen] = useState(!compact);
  const q = useQuery({ queryKey: ['geleira', isMe ? 'me' : username], queryFn: (): Promise<(MyTaste | TheirTaste)[]> => (isMe ? api.geleiraMine() : api.geleiraOf(username)), retry: false });
  const items = q.data ?? [];
  // O nível vem do servidor (conta tudo, venha quem vier ver, e o título respeita a idade). Fica antes dos return: os hooks têm de ser sempre os mesmos.
  const lv = useQuery({ queryKey: ['geleira-level', username], queryFn: () => api.geleiraLevel(username), retry: false, staleTime: 60_000 });
  if (q.isLoading) return <div className={`${flush ? '' : 'mx-4'} skel mt-4 ${compact ? 'h-[60px]' : 'h-48'} rounded-[24px]`} role="status" aria-label={tr('A carregar a geleira')} />;
  if (!isMe && (q.isError || items.length === 0)) return null;

  const favorites = items.filter((i) => i.favorite).slice(0, 8);
  const total = items.filter((i) => !i.pending).length;
  // O nível vem do servidor (conta tudo, venha quem vier ver, e o título respeita a idade); enquanto carrega usa a conta local.
  const points = geleiraPoints(items);
  const level = lv.data?.level ?? geleiraLevel(points);
  // O título e a frase de progresso vêm do servidor em português: traduzem-se aqui.
  const title = lv.data ? tr(lv.data.title) : LEVEL_LABEL[level];
  const hint = lv.data
    ? lv.data.toNext === null
      ? tr('Nível máximo: {t}!', { t: lv.data.title.toLowerCase() })
      : tr(lv.data.toNext === 1 ? 'Falta {n} ponto para {next}. Bebidas com álcool e vibes de festa valem mais.' : 'Faltam {n} pontos para {next}. Bebidas com álcool e vibes de festa valem mais.', { n: lv.data.toNext, next: tr(lv.data.nextTitle ?? '').toLowerCase() })
    : nextLevelHint(points);

  const folded = compact && !open;

  return (
    <section
      aria-label={folded ? 'Abrir a geleira' : 'Geleira'}
      // Fechada, qualquer parte do cartão abre a geleira (o frigorífico, o texto, o espaço à volta).
      {...(folded ? { role: 'button', tabIndex: 0, 'aria-expanded': false, onClick: () => setOpen(true), onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(true); } } } : {})}
      className={`${folded ? 'cursor-pointer active:scale-[0.99] ' : ''}transition ${flush ? '' : 'mx-4'} mt-4 overflow-hidden rounded-[24px] border border-sky-100 bg-gradient-to-b from-sky-50 via-white to-cyan-50/60 px-4 shadow-[0_2px_12px_rgba(14,116,144,0.1)] ${folded ? 'pb-3 pt-3' : 'pb-6 pt-4'}`}
    >
      <div className="flex items-center gap-4 pb-1">
        {compact ? (
          <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={open ? 'Fechar a geleira' : 'Abrir a geleira'} className="shrink-0 transition active:scale-95">
            <FridgeArt count={total} level={level} open={!folded} invite={folded} size={folded ? 80 : 88} />
          </button>
        ) : (
          <FridgeArt count={total} level={level} open={!folded} size={84} />
        )}
        <div className="min-w-0 flex-1">
          <span className="block text-[18px] font-extrabold leading-tight">{isMe ? tr('A minha geleira') : tr('Geleira')}</span>
          <span className="block text-[13px] text-zinc-600">
            {items.length === 0 ? tr('Ainda vazia') : `${total} ${total === 1 ? tr('gosto') : tr('gostos')}${favorites.length ? ` · ${favorites.length} ${favorites.length === 1 ? tr('favorito') : tr('favoritos')}` : ''}`}
          </span>
          {total > 0 && <span className="mt-1 inline-block rounded-full bg-rose-50 px-2.5 py-0.5 text-[12px] font-bold text-brand">{title}</span>}
          {isMe && !folded && <span className="mt-1 block text-[12px] text-zinc-500">{hint}</span>}
        </div>
        {isMe && (
          <Link to="/geleira" onClick={(e) => e.stopPropagation()} aria-label={tr('Editar a minha geleira')} className="flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-white px-3.5 text-sm font-bold text-zinc-900 shadow-sm ring-1 ring-sky-100 transition active:scale-95">
            <Icon name="pencil" size={16} /> {tr('Editar')}
          </Link>
        )}
      </div>

      {items.length === 0 && (!compact || open) ? (
        <div className="mt-4 rounded-2xl bg-white/70 px-4 py-6 text-center ring-1 ring-sky-100">
          <p className="text-lg font-extrabold">{tr('Geleira vazia!')}</p>
          <p className="mx-auto mt-1 max-w-[17rem] text-zinc-600">{isMe ? tr('Escolhe as bebidas, comidas, vibes e sítios de que gostas.') : tr('Ainda não há nada para mostrar.')}</p>
          {isMe && <Link to="/geleira" className="mt-3 inline-flex h-11 items-center rounded-full bg-brand px-6 font-bold text-white active:scale-95">{tr('Encher a minha geleira')}</Link>}
        </div>
      ) : (
        !folded && items.length > 0 && (
          <>
            {favorites.length > 0 && <Shelf title={tr('Os favoritos')} icon="heart" items={favorites} />}
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
