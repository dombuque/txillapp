import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Avatar, Sheet, pillInput } from './ui';

/** Amigos próximos: quem vê os stories marcados só para eles. Só se podem juntar seguidores. */
export default function CloseFriendsSheet({ onClose, layer }: { onClose: () => void; layer?: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const friends = useQuery({ queryKey: ['close-friends'], queryFn: api.closeFriends });
  const followers = useQuery({
    queryKey: ['close-friends-search', q],
    queryFn: () => api.followers(user!.username, undefined, q.trim() || undefined),
  });
  const mine = new Set((friends.data ?? []).map((f) => f.username.toLowerCase()));
  const candidates = (followers.data?.items ?? []).filter((p) => !mine.has(p.username.toLowerCase()));

  async function toggle(username: string, add: boolean) {
    await (add ? api.addCloseFriend(username) : api.removeCloseFriend(username)).catch(() => undefined);
    await qc.invalidateQueries({ queryKey: ['close-friends'] });
    await qc.invalidateQueries({ queryKey: ['stories'] });
  }

  const row = 'flex items-center gap-3 py-2';
  return (
    <Sheet title="Amigos próximos 💚" onClose={onClose} layer={layer}>
      <p className="-mt-2 mb-3 text-sm text-zinc-600">Só estas pessoas veem os stories que marcares para amigos próximos. Elas não sabem que estão na lista.</p>

      <p className="mb-1 text-sm font-semibold text-zinc-500">Na tua lista ({friends.data?.length ?? 0})</p>
      {friends.data?.length === 0 && <p className="py-2 text-sm text-zinc-500">Ainda ninguém. Escolhe abaixo 👇</p>}
      <ul>
        {friends.data?.map((f) => (
          <li key={f.username} className={row}>
            <Avatar name={f.displayName} username={f.hasAvatar ? f.username : undefined} size={40} ring={false} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{f.displayName}</span>
              <span className="block truncate text-sm text-zinc-500">@{f.username}</span>
            </span>
            <button type="button" onClick={() => toggle(f.username, false)} className="rounded-full bg-emerald-50 px-4 py-1.5 text-sm font-bold text-emerald-700 active:scale-95">Na lista ✓</button>
          </li>
        ))}
      </ul>

      <p className="mb-2 mt-4 text-sm font-semibold text-zinc-500">Adicionar dos teus seguidores</p>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar…" aria-label="Procurar seguidores" className={pillInput} />
      <ul className="mt-1">
        {candidates.map((p) => (
          <li key={p.username} className={row}>
            <Avatar name={p.displayName} username={p.username} size={40} ring={false} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{p.displayName}</span>
              <span className="block truncate text-sm text-zinc-500">@{p.username}</span>
            </span>
            <button type="button" onClick={() => toggle(p.username, true)} className="rounded-full bg-brand px-4 py-1.5 text-sm font-bold text-white active:scale-95">Adicionar</button>
          </li>
        ))}
        {followers.isSuccess && candidates.length === 0 && <li className="py-3 text-sm text-zinc-500">{q ? 'Ninguém com esse nome 🤔' : 'Não há mais seguidores para adicionar.'}</li>}
      </ul>
    </Sheet>
  );
}
