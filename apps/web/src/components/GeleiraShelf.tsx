import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type CatalogItem, type MyTaste, type TasteItem, type TasteKind, type TasteVisibility, type TheirTaste } from '../lib/api';
import { CATEGORIES, KINDS, KIND_ICON, KIND_LABEL, iconOf } from '../lib/geleira';
import Icon from './Icon';
import IceRating from './IceRating';
import { Sheet, btnGhost, btnPrimary, fieldInput } from './ui';

const VIS: { v: TasteVisibility; label: string }[] = [
  { v: 'everyone', label: 'Todos' },
  { v: 'followers', label: 'Seguidores' },
  { v: 'me', label: 'Só eu' },
];

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
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<MyTaste | null>(null);
  const q = useQuery({ queryKey: ['geleira', isMe ? 'me' : username], queryFn: (): Promise<(MyTaste | TheirTaste)[]> => (isMe ? api.geleiraMine() : api.geleiraOf(username)), retry: false });
  const items = q.data ?? [];
  if (q.isLoading) return null;
  if (!isMe && (q.isError || items.length === 0)) return null;

  return (
    <section className="mx-4 mt-6 rounded-[28px] bg-white px-5 pb-5 pt-5 shadow-[0_2px_16px_rgba(0,0,0,0.09)]" aria-label="Geleira">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-xl font-extrabold"><Icon name="snowflake" size={22} className="text-sky-500" /> {isMe ? 'A minha geleira' : 'Geleira'}</h2>
        {isMe && items.length > 0 && <button onClick={() => setAdding(true)} className="flex h-11 items-center gap-1 px-1 text-sm font-semibold text-brand"><Icon name="plus" size={16} /> Juntar</button>}
      </div>
      {items.length === 0 ? (
        <div className="mt-3 text-center">
          <p className="text-zinc-700">Está vazia! Junta as tuas vibes, bebidas, comidas e sítios, e a malta fica a saber quem tu és.</p>
          <button onClick={() => setAdding(true)} className={`${btnPrimary} mt-3`}>Encher a geleira</button>
        </div>
      ) : (
        KINDS.map((k) => {
          const list = items.filter((i) => i.kind === k);
          if (list.length === 0) return null;
          return (
            <div key={k} className="mt-4">
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide text-zinc-600"><Icon name={KIND_ICON[k]} size={15} /> {KIND_LABEL[k]}</h3>
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {list.map((i) => <Chip key={i.id} item={i} onClick={isMe ? () => setEditing(i as MyTaste) : undefined} />)}
              </div>
            </div>
          );
        })
      )}
      {adding && <AddSheet onClose={() => setAdding(false)} />}
      {editing && <EditSheet item={editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

/** Editar um item meu: nota, favorito, quem vê e tirar. */
function EditSheet({ item, onClose }: { item: MyTaste; onClose: () => void }) {
  const qc = useQueryClient();
  const [cur, setCur] = useState(item);
  const save = useMutation({
    mutationFn: (b: { rating?: number | null; favorite?: boolean; visibility?: TasteVisibility }) => api.geleiraPut(item.id, b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['geleira'] }),
  });
  const remove = useMutation({
    mutationFn: () => api.geleiraRemove(item.id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['geleira'] });
      onClose();
    },
  });
  const set = (b: { rating?: number | null; favorite?: boolean; visibility?: TasteVisibility }) => {
    setCur({ ...cur, ...b } as MyTaste);
    save.mutate(b);
  };
  return (
    <Sheet title={item.name} onClose={onClose}>
      <p className="mb-1 font-semibold">O quanto gostas?</p>
      <IceRating value={cur.rating} onChange={(rating) => set({ rating })} size={34} />
      <button onClick={() => set({ favorite: !cur.favorite })} aria-pressed={cur.favorite} className={`mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-full border-2 font-semibold ${cur.favorite ? 'border-brand text-brand' : 'border-zinc-200 text-zinc-800'}`}>
        <Icon name="heart" size={18} className={cur.favorite ? 'fill-brand' : ''} /> {cur.favorite ? 'É dos meus favoritos' : 'Marcar como favorito'}
      </button>
      <p className="mb-2 mt-5 font-semibold">Quem vê este gosto?</p>
      <div className="flex gap-2" role="radiogroup" aria-label="Visibilidade">
        {VIS.map((o) => (
          <button key={o.v} role="radio" aria-checked={cur.visibility === o.v} onClick={() => set({ visibility: o.v })} className={`h-11 flex-1 rounded-full text-sm font-semibold ${cur.visibility === o.v ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-800'}`}>
            {o.label}
          </button>
        ))}
      </div>
      <button onClick={() => remove.mutate()} disabled={remove.isPending} className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-full font-semibold text-red-700 active:bg-red-50">
        <Icon name="trash" size={18} /> Tirar da geleira
      </button>
    </Sheet>
  );
}

/** Procurar no catálogo e juntar; se não existe, sugerir um novo. */
export function AddSheet({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<TasteKind>('vibe');
  const [text, setText] = useState('');
  const [suggest, setSuggest] = useState(false);
  const [category, setCategory] = useState('');
  const [alcoholic, setAlcoholic] = useState(false);
  const [err, setErr] = useState('');
  const cat = useQuery({ queryKey: ['geleira-catalog', kind, text], queryFn: () => api.geleiraCatalog(text, kind), staleTime: 30_000 });
  const list = cat.data ?? [];
  const chosen = category || CATEGORIES[kind][0].slug;
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['geleira'] }), qc.invalidateQueries({ queryKey: ['geleira-catalog'] })]);

  async function toggle(i: CatalogItem) {
    setErr('');
    try {
      if (i.mine) await api.geleiraRemove(i.id);
      else await api.geleiraPut(i.id, { favorite: false });
      await refresh();
    } catch (x) {
      setErr((x as Error).message);
    }
  }
  async function create() {
    setErr('');
    try {
      await api.geleiraSuggest({ name: text.trim(), kind, category: chosen, alcoholic: kind === 'bebida' ? alcoholic : undefined });
      await refresh();
      setSuggest(false);
      setText('');
    } catch (x) {
      setErr((x as Error).message);
    }
  }

  return (
    <Sheet title="Encher a geleira" onClose={onClose}>
      <div className="mb-3 flex gap-2 overflow-x-auto [scrollbar-width:none]" role="tablist">
        {KINDS.map((k) => (
          <button key={k} role="tab" aria-selected={kind === k} onClick={() => { setKind(k); setSuggest(false); setCategory(''); }} className={`flex h-11 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-semibold ${kind === k ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-800'}`}>
            <Icon name={KIND_ICON[k]} size={16} /> {KIND_LABEL[k]}
          </button>
        ))}
      </div>
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Procurar…" aria-label="Procurar" maxLength={40} className={fieldInput} />
      {err && <p role="alert" className="mt-2 text-sm text-red-600">{err}</p>}
      <ul className="mt-2">
        {list.map((i) => (
          <li key={i.id}>
            <button onClick={() => toggle(i)} aria-pressed={i.mine} className="flex min-h-14 w-full items-center gap-3 rounded-2xl px-1 text-left active:bg-zinc-100">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sky-600"><Icon name={iconOf(i)} size={20} /></span>
              <span className="min-w-0 flex-1 truncate font-semibold">{i.name}{i.pending && <span className="ml-2 text-xs font-normal text-zinc-500">à espera de aprovação</span>}</span>
              <span className={`flex h-8 w-8 items-center justify-center rounded-full ${i.mine ? 'bg-brand text-white' : 'border border-zinc-300 text-zinc-500'}`} aria-hidden>
                <Icon name={i.mine ? 'check' : 'plus'} size={16} />
              </span>
            </button>
          </li>
        ))}
        {cat.isSuccess && list.length === 0 && <li className="py-4 text-center text-zinc-600">Nada com esse nome na geleira da malta.</li>}
      </ul>
      {!suggest ? (
        <button onClick={() => setSuggest(true)} disabled={text.trim().length < 2} className={`${btnGhost} mt-3 w-full disabled:opacity-40`}>
          Não encontras? Sugere “{text.trim() || '…'}”
        </button>
      ) : (
        <div className="mt-3 rounded-2xl bg-zinc-50 p-3">
          <p className="font-semibold">Sugerir “{text.trim()}” em {KIND_LABEL[kind]}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {CATEGORIES[kind].map((c) => (
              <button key={c.slug} onClick={() => setCategory(c.slug)} aria-pressed={chosen === c.slug} className={`h-9 rounded-full px-3 text-sm font-semibold ${chosen === c.slug ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-800'}`}>{c.label}</button>
            ))}
          </div>
          {kind === 'bebida' && (
            <label className="mt-3 flex items-center gap-2 text-sm text-zinc-700">
              <input type="checkbox" checked={alcoholic} onChange={(e) => setAlcoholic(e.target.checked)} className="h-5 w-5 accent-[#d6334f]" /> Tem álcool (só maiores de 18)
            </label>
          )}
          <p className="mt-2 text-xs text-zinc-600">Fica na tua geleira já; a malta só o vê depois de a moderação aprovar.</p>
          <button onClick={create} className={`${btnPrimary} mt-3 w-full`}>Sugerir</button>
        </div>
      )}
      <button onClick={onClose} className={`${btnPrimary} mt-4 w-full`}>Pronto</button>
    </Sheet>
  );
}
