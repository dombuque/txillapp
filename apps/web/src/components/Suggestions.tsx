import Icon from './Icon';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, type Suggestion } from '../lib/api';
import FollowButton from './FollowButton';
import { Avatar } from './ui';

/** "Pessoas que talvez conheças": amigos em comum primeiro; dá para dispensar com o X. */
export default function Suggestions({ compact = false }: { compact?: boolean }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['suggestions'], queryFn: api.suggestions, staleTime: 60_000 });
  if (!data || data.length === 0) return null;

  function dismiss(p: Suggestion) {
    qc.setQueryData<Suggestion[]>(['suggestions'], (d) => d?.filter((x) => x.username !== p.username));
    api.dismissSuggestion(p.username).catch(() => qc.invalidateQueries({ queryKey: ['suggestions'] }));
  }

  if (compact) {
    // Painel do computador: lista vertical e curta.
    return (
      <section aria-label="Sugestões de pessoas" className="rounded-[28px] bg-zinc-50 py-4">
        <h2 className="px-5 text-lg font-bold">Bora conhecer malta nova?</h2>
        <ul className="mt-2">
          {data.slice(0, 4).map((p) => (
            <li key={p.username} className="flex items-center gap-2.5 px-4 py-2.5">
              <Link to={`/u/${p.username}`} className="flex min-w-0 flex-1 items-center gap-2.5">
                <Avatar name={p.displayName} username={p.username} size={40} />
                <span className="min-w-0">
                  <span className="block truncate font-semibold leading-tight">{p.displayName} {p.isPrivate && <Icon name="lock" size={14} className="inline align-[-2px] text-zinc-500" aria-hidden={false} role="img" aria-label="Conta privada" />}</span>
                  <span className="block truncate text-sm text-zinc-500">{p.reason || `@${p.username}`}</span>
                </span>
              </Link>
              <div className="w-[100px] shrink-0">
                <FollowButton username={p.username} following={false} requested={p.requested} isPrivate={p.isPrivate} />
              </div>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <section aria-label="Sugestões de pessoas" className="mx-4 mb-6 xl:hidden rounded-[28px] bg-white py-5 shadow-[0_2px_16px_rgba(0,0,0,0.09)]">
      <h2 className="px-5 text-lg font-bold">Bora conhecer malta nova?</h2>
      <div className="mt-4 flex gap-3 overflow-x-auto px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {data.map((p) => (
          <div key={p.username} className="relative flex w-[152px] shrink-0 flex-col items-center rounded-2xl border border-zinc-200 px-3 pb-3 pt-5 text-center">
            <button onClick={() => dismiss(p)} aria-label={`Não sugerir ${p.displayName}`} className="absolute right-2 top-1 px-1.5 text-xl leading-none text-zinc-500">
              ×
            </button>
            <Link to={`/u/${p.username}`} className="flex w-full flex-col items-center">
              <Avatar name={p.displayName} username={p.username} size={64} />
              <p className="mt-3 w-full truncate font-semibold leading-tight">
                {p.displayName} {p.isPrivate && <Icon name="lock" size={14} className="inline align-[-2px] text-zinc-500" aria-hidden={false} role="img" aria-label="Conta privada" />}
              </p>
              <p className="w-full truncate text-sm text-zinc-500">@{p.username}</p>
              <p className="mt-1 line-clamp-2 min-h-[2rem] text-xs leading-4 text-zinc-500">{p.reason}</p>
            </Link>
            <div className="mt-3 w-full">
              <FollowButton username={p.username} following={false} requested={p.requested} isPrivate={p.isPrivate} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
