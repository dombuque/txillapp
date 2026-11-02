import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, type MyTaste, type TasteItem, type TheirTaste } from '../lib/api';
import { KINDS, KIND_ICON, KIND_LABEL, iconOf } from '../lib/geleira';
import Icon from './Icon';
import IceRating from './IceRating';
import { btnPrimary } from './ui';

/** Cartão de um gosto: ícone, nome e nota. */
function Chip({ item, onClick }: { item: TasteItem & { rating: number | null; favorite: boolean }; onClick?: () => void }) {
  const body = (
    <>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sky-600"><Icon name={iconOf(item)} size={20} /></span>
      <span className="min-w-0 text-left">
        <span className="flex items-center gap-1 text-[15px] font-semibold leading-tight">
          <span className="truncate">{item.name}</span>
          {item.favorite && <Icon name="heart" size={13} className="shrink-0 fill-brand text-brand" aria-hidden={false} role="img" aria-label="Favorito" />}
        </span>
        {item.rating ? <IceRating value={item.rating} size={14} /> : <span className="text-xs text-zinc-500">{item.pending ? 'À espera de aprovação' : 'Sem nota'}</span>}
      </span>
    </>
  );
  const cls = 'flex w-44 shrink-0 items-center gap-2.5 rounded-2xl border border-zinc-200 p-2.5';
  return onClick ? <button onClick={onClick} className={`${cls} transition active:scale-[0.98]`}>{body}</button> : <div className={cls}>{body}</div>;
}

/** A geleira no perfil: prateleiras por tipo. Na minha, abre o editor; na dos outros, só mostra o que a pessoa deixa ver. */
export default function GeleiraShelf({ username, isMe }: { username: string; isMe: boolean }) {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['geleira', isMe ? 'me' : username], queryFn: (): Promise<(MyTaste | TheirTaste)[]> => (isMe ? api.geleiraMine() : api.geleiraOf(username)), retry: false });
  const items = q.data ?? [];
  if (q.isLoading) return null;
  if (!isMe && (q.isError || items.length === 0)) return null;

  return (
    <section className="mx-4 mt-6 rounded-[28px] bg-white px-5 pb-5 pt-5 shadow-[0_2px_16px_rgba(0,0,0,0.09)]" aria-label="Geleira">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-xl font-extrabold"><Icon name="snowflake" size={22} className="text-sky-500" /> {isMe ? 'A minha geleira' : 'Geleira'}</h2>
        {isMe && items.length > 0 && (
          <button onClick={() => navigate('/geleira')} className="flex h-11 items-center gap-1 px-1 text-sm font-semibold text-brand"><Icon name="pencil" size={16} /> Editar</button>
        )}
      </div>
      {items.length === 0 ? (
        <div className="mt-3 text-center">
          <p className="text-zinc-700">Está vazia! Junta as tuas vibes, bebidas, comidas e sítios, e a malta fica a saber quem tu és.</p>
          <button onClick={() => navigate('/geleira')} className={`${btnPrimary} mt-3`}>Encher a geleira</button>
        </div>
      ) : (
        KINDS.map((k) => {
          const list = items.filter((i) => i.kind === k);
          if (list.length === 0) return null;
          return (
            <div key={k} className="mt-4">
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide text-zinc-600"><Icon name={KIND_ICON[k]} size={15} /> {KIND_LABEL[k]}</h3>
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {list.map((i) => <Chip key={i.id} item={i} onClick={isMe ? () => navigate('/geleira', { state: { kind: k } }) : undefined} />)}
              </div>
            </div>
          );
        })
      )}
    </section>
  );
}
