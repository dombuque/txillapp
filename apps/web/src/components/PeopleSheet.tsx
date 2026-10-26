import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, type PeopleKind } from '../lib/api';
import { Avatar, Sheet, timeAgo } from './ui';

const TITLE: Record<PeopleKind, string> = { reposts: 'Quem repostou 🔁', cheers: 'Quem brindou 🍻', gifts: 'Quem presenteou 🎁' };
const EMPTY: Record<PeopleKind, string> = { reposts: 'Ainda ninguém repostou.', cheers: 'Ainda ninguém brindou.', gifts: 'Ainda ninguém presenteou.' };

/** Lista de quem interagiu com uma publicação. O servidor só responde se o dono o permitir. */
export default function PeopleSheet({ postId, kind, onClose, layer }: { postId: string; kind: PeopleKind; onClose: () => void; layer?: string }) {
  const q = useQuery({ queryKey: ['post-people', postId, kind], queryFn: () => api.postPeople(postId, kind), retry: false });
  return (
    <Sheet title={TITLE[kind]} onClose={onClose} layer={layer}>
      {q.isLoading && <p className="py-6 text-center text-zinc-500">A carregar…</p>}
      {q.isError && <p role="alert" className="py-6 text-center text-zinc-600">Esta lista não está disponível 🔒</p>}
      {q.isSuccess && q.data.length === 0 && <p className="py-6 text-center text-zinc-500">{EMPTY[kind]}</p>}
      <ul>
        {q.data?.map((p) => (
          <li key={p.username}>
            <Link to={`/u/${p.username}`} onClick={onClose} className="flex items-center gap-3 rounded-xl py-2.5 active:bg-zinc-100">
              <Avatar name={p.displayName} username={p.hasAvatar ? p.username : undefined} size={44} ring={false} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{p.displayName}</span>
                <span className="block truncate text-sm text-zinc-500">@{p.username}</span>
              </span>
              <span className="shrink-0 text-sm text-zinc-500">{timeAgo(p.at)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
