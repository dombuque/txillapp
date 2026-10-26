import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, type PhotoTag } from '../lib/api';
import { useVisualViewport, visibleStyle } from '../lib/useVisualViewport';
import { Avatar } from './ui';
import TaggedImage from './TaggedImage';

const MAX_TAGS = 10;

/** Identificar pessoas numa foto: toca onde a pessoa está e escolhe quem é. Posição manual, sem reconhecimento facial. */
export default function PhotoTagger({ src, tags, onDone }: { src: string; tags: PhotoTag[]; onDone: (tags: PhotoTag[]) => void }) {
  const vv = useVisualViewport();
  const [list, setList] = useState(tags);
  const [pending, setPending] = useState<{ x: number; y: number } | null>(null);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim().replace(/^@/, '')), 150);
    return () => clearTimeout(t);
  }, [q]);

  const found = useQuery({ queryKey: ['mentionable', debounced], queryFn: () => api.mentionable(debounced), enabled: !!pending, staleTime: 60_000, retry: false });
  const taken = new Set(list.map((t) => t.username.toLowerCase()));
  const people = (found.data ?? []).filter((p) => !taken.has(p.username.toLowerCase()));

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && (pending ? setPending(null) : onDone(list));
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  function choose(p: { username: string; displayName: string }) {
    if (!pending) return;
    setList([...list, { username: p.username, displayName: p.displayName, x: pending.x, y: pending.y }]);
    setPending(null);
    setQ('');
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Identificar pessoas" className="fixed inset-0 z-[80] flex flex-col bg-black text-white" style={visibleStyle(vv)}>
      <div className="flex items-center justify-between px-4 pb-2 pt-[max(1rem,env(safe-area-inset-top))]">
        <p className="text-lg font-bold">Identificar pessoas</p>
        <button type="button" onClick={() => onDone(list)} className="h-10 rounded-full bg-brand px-5 font-bold active:scale-95">Feito</button>
      </div>

      <div className="min-h-0 flex-1 px-2">
        <TaggedImage
          src={src}
          alt="Foto a identificar"
          tags={list}
          pending={pending}
          onPoint={(x, y) => list.length < MAX_TAGS && setPending({ x, y })}
          onRemove={(i) => setList(list.filter((_, n) => n !== i))}
        />
      </div>

      {!pending && (
        <p className="px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 text-center text-sm text-white/80">
          {list.length >= MAX_TAGS ? `Máximo de ${MAX_TAGS} pessoas por foto.` : list.length ? 'Toca noutra pessoa para identificar, ou ✕ para tirar. 👆' : 'Toca na foto, em cima da pessoa que queres identificar. 👆'}
        </p>
      )}

      {pending && (
        <div className="max-h-[55%] rounded-t-3xl bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-zinc-900">
          <div className="mb-2 flex items-center gap-2">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Quem é? Procura um nome…"
              aria-label="Procurar pessoa"
              className="h-11 min-w-0 flex-1 rounded-full bg-zinc-100 px-4 text-base outline-none focus:ring-2 focus:ring-brand/60"
            />
            <button type="button" onClick={() => setPending(null)} className="h-11 px-3 font-semibold text-zinc-600">Cancelar</button>
          </div>
          <ul className="max-h-60 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {people.map((p) => (
              <li key={p.username}>
                <button type="button" onClick={() => choose(p)} className="flex w-full items-center gap-3 rounded-xl px-1 py-2 text-left active:bg-zinc-100">
                  <Avatar name={p.displayName} username={p.hasAvatar ? p.username : undefined} size={40} ring={false} />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{p.displayName}</span>
                    <span className="block truncate text-sm text-zinc-500">@{p.username}</span>
                  </span>
                </button>
              </li>
            ))}
            {found.isSuccess && people.length === 0 && <li className="py-3 text-sm text-zinc-500">Ninguém que possas identificar 🤔 Só podes identificar quem aceita menções.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
