import { useQuery } from '@tanstack/react-query';
import { tr } from '../lib/i18n';
import { useState } from 'react';
import { api, type MyTaste, type TasteItem, type TheirTaste } from '../lib/api';
import { ICE, KINDS, KIND_ICON, KIND_LABEL } from '../lib/geleira';
import TasteBubble from './TasteIcon';
import FridgeArt, { LEVEL_LABEL, geleiraLevel, geleiraPoints, nextLevelHint } from './FridgeArt';
import Icon from './Icon';

type Shown = TasteItem & { rating: number | null; favorite: boolean };

/** A nota como temperatura: quanto mais gelado, mais forte o gosto (1 ° é "gelada de rachar"). Sem pontinhos. */
const TEMP = ['', '18°', '12°', '8°', '4°', '1°'];
const TEMP_STYLE = ['', 'bg-zinc-100 text-zinc-500', 'bg-zinc-100 text-zinc-600', 'bg-zinc-200 text-zinc-700', 'bg-zinc-700 text-white', 'bg-zinc-900 text-white'];
function Frost({ rating }: { rating: number | null }) {
  if (!rating) return <span className="mt-0.5 block h-[14px]" aria-hidden />;
  return (
    <span className={`mx-auto mt-0.5 flex w-fit items-center gap-0.5 rounded-full px-1.5 text-[9.5px] font-bold tabular-nums leading-[14px] ${TEMP_STYLE[rating]}`} aria-hidden>
      <Icon name="snowflake" size={9} strokeWidth={2.4} />{TEMP[rating]}
    </span>
  );
}

/** Um gosto: bolinha de vidro com o ícone, o nome e a nota. O favorito leva um coração. */
function Tile({ item }: { item: Shown }) {
  const label = `${tr(item.name)}${item.rating ? `, ${ICE[item.rating]}` : ''}${item.favorite ? ', favorito' : ''}`;
  const inner = (
    <>
      <span className="relative">
        <TasteBubble item={item} size={44} />
        {item.favorite && (
          <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-brand text-white ring-2 ring-white">
            <Icon name="heart" size={9} className="fill-white" />
          </span>
        )}
      </span>
      <span className="mt-1 line-clamp-2 min-h-[2.1em] w-full break-words text-center text-[11px] font-semibold leading-[1.05] text-zinc-800">{tr(item.name)}</span>
      {item.pending ? <span className="mt-1 text-[10px] font-medium text-zinc-500">{tr('à espera')}</span> : <Frost rating={item.rating} />}
    </>
  );
  return (
    <div role="img" aria-label={label} className="flex w-[58px] shrink-0 flex-col items-center">{inner}</div>
  );
}

/** Prateleira: os gostos em fila e, por baixo, a tábua de vidro. */
function Shelf({ title, icon, items }: { title: string; icon: Parameters<typeof Icon>[0]['name']; items: Shown[] }) {
  return (
    <div className="mt-3">
      <h3 className="mb-1 flex items-center gap-1.5 px-0.5 text-[12px] font-bold uppercase tracking-[0.12em] text-zinc-800/70">
        <Icon name={icon} size={14} /> {title} <span className="font-semibold text-zinc-800/45">{items.length}</span>
      </h3>
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-2 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((i) => <Tile key={i.id} item={i} />)}
      </div>
      <div aria-hidden className="h-[4px] rounded-full bg-gradient-to-r from-zinc-200/70 via-white to-zinc-200/70 shadow-[0_3px_5px_rgba(0,0,0,0.18)] ring-1 ring-white/80" />
    </div>
  );
}

/** Botão da geleira na linha de ações do perfil: abre/fecha a prateleira para baixo. Nos perfis dos outros só aparece se houver o que mostrar. */
export function GeleiraToggle({ username, isMe, open, onToggle, icon = false, grow = false }: { username: string; isMe: boolean; open: boolean; onToggle: () => void; icon?: boolean; grow?: boolean }) {
  const q = useQuery({ queryKey: ['geleira', isMe ? 'me' : username], queryFn: (): Promise<(MyTaste | TheirTaste)[]> => (isMe ? api.geleiraMine() : api.geleiraOf(username)), retry: false });
  const shown = (q.data ?? []).filter((i) => i.kind === 'bebida' || i.kind === 'comida');
  const total = shown.length;
  if (!isMe && (q.isError || total === 0)) return null;
  return (
    <button
      onClick={onToggle}
      aria-expanded={open}
      aria-label={open ? tr('Fechar a geleira') : tr('Abrir a geleira')}
      className={`flex h-10 items-center justify-center gap-1.5 rounded-xl px-3 text-[14px] font-bold transition active:scale-95 ${icon ? `${grow ? 'flex-1' : 'w-11'} !px-0` : 'flex-1'} ${open ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-900'}`}
    >
      <FridgeArt count={total} level={geleiraLevel(geleiraPoints(shown.filter((i) => !('pending' in i && (i as { pending?: boolean }).pending))))} open={open} size={24} />
      {!icon && <span>{tr('Geleira')}</span>}
      {!icon && <Icon name="chevron-right" size={14} className={`transition ${open ? 'rotate-90' : ''}`} />}
    </button>
  );
}

/** A geleira: vitrine de gostos (vibes, bebidas, comidas, sítios), só para ver. Editar fica em "Editar perfil". Nos perfis dos outros só mostra o que a pessoa deixa ver. */
/** `compact`: fechada por omissão (cabeçalho e uma fila de bolinhas); toca-se para abrir as prateleiras. */
export default function GeleiraShelf({ username, isMe, flush = false, compact = false, pointed = false }: { username: string; isMe: boolean; flush?: boolean; compact?: boolean; pointed?: boolean }) {
  const [open, setOpen] = useState(!compact);
  const q = useQuery({ queryKey: ['geleira', isMe ? 'me' : username], queryFn: (): Promise<(MyTaste | TheirTaste)[]> => (isMe ? api.geleiraMine() : api.geleiraOf(username)), retry: false });
  // Na geleira só aparecem as bebidas e as comidas; as vibes e os sítios ficam só nas Definições (Editar perfil).
  const items = (q.data ?? []).filter((i) => i.kind === 'bebida' || i.kind === 'comida');
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
      className={`${folded ? 'cursor-pointer active:scale-[0.99] ' : ''}transition ${flush ? '' : 'mx-4'} mt-4 overflow-hidden rounded-[24px] border ${pointed ? 'border-zinc-300' : 'border-zinc-200'} bg-gradient-to-b from-zinc-50 via-white to-white/60 px-4 shadow-[0_2px_12px_rgba(0,0,0,0.1)] ${folded ? 'pb-3 pt-3' : 'pb-3 pt-4'}`}
    >
      <div className="flex items-center gap-3 pb-0">
        {compact ? (
          <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={open ? 'Fechar a geleira' : 'Abrir a geleira'} className="shrink-0 transition active:scale-95">
            <FridgeArt count={total} level={level} open={!folded} invite={folded} size={folded ? 64 : 56} />
          </button>
        ) : (
          <FridgeArt count={total} level={level} open={!folded} size={52} />
        )}
        <div className="min-w-0 flex-1">
          <span className="block text-[16px] font-extrabold leading-tight">{isMe ? tr('A minha geleira') : tr('Geleira')}</span>
          <span className="block text-[12px] text-zinc-600">
            {items.length === 0 ? tr('Ainda vazia') : `${total} ${total === 1 ? tr('gosto') : tr('gostos')}${favorites.length ? ` · ${favorites.length} ${favorites.length === 1 ? tr('favorito') : tr('favoritos')}` : ''}`}
          </span>
          {total > 0 && <span className="mt-0.5 inline-block rounded-full bg-zinc-100 px-2 py-0 text-[11px] font-bold text-brand">{title}</span>}
        </div>
      </div>

      {items.length === 0 && (!compact || open) ? (
        <div className="mt-4 rounded-2xl bg-white/70 px-4 py-6 text-center ring-1 ring-zinc-100">
          <p className="text-lg font-extrabold">{tr('Geleira vazia!')}</p>
          <p className="mx-auto mt-1 max-w-[17rem] text-zinc-600">{isMe ? tr('Para a encher, abre Editar perfil e escolhe a tua geleira.') : tr('Ainda não há nada para mostrar.')}</p>
        </div>
      ) : (
        !folded && items.length > 0 && (
          <>
            {KINDS.map((k) => {
              const list = items.filter((i) => i.kind === k).sort((a, b) => Number(b.favorite) - Number(a.favorite)); // os favoritos primeiro, com o coração
              return list.length ? <Shelf key={k} title={KIND_LABEL[k]} icon={KIND_ICON[k]} items={list} /> : null;
            })}
          </>
        )
      )}
    </section>
  );
}
