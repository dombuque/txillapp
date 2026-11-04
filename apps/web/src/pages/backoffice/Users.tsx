import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { Badge, ago, btnGhost, statusBadge, td, th } from './bo';

/** Procurar contas por @, nome ou email. */
export default function BackofficeUsers() {
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(params.get('q') ?? '');
  const [q, setQ] = useState(params.get('q') ?? '');
  const status = params.get('status') ?? '';
  // Pesquisa só depois de uma pequena pausa a escrever.
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);

  const list = useInfiniteQuery({
    queryKey: ['bo-users', q, status],
    queryFn: ({ pageParam }) => api.boUsers(q, status, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <h1 className="text-2xl font-extrabold">Utilizadores</h1>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input value={text} onChange={(e) => setText(e.target.value)} autoFocus placeholder="Procurar por @, nome ou email" aria-label="Procurar contas" className="h-10 w-full max-w-md rounded-lg border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-zinc-900" />
        <select value={status} onChange={(e) => setParams(e.target.value ? { status: e.target.value } : {})} aria-label="Estado" className="h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm">
          <option value="">Todos os estados</option>
          <option value="active">Ativas</option>
          <option value="suspended">Suspensas</option>
          <option value="deleted">Eliminadas</option>
        </select>
      </div>

      <div className="mt-4 overflow-x-auto rounded-2xl border border-zinc-200 bg-white">
        <table className="w-full min-w-[820px]">
          <thead className="border-b border-zinc-200 bg-zinc-50">
            <tr>
              <th className={th}>Conta</th>
              <th className={th}>Email</th>
              <th className={th}>Estado</th>
              <th className={`${th} text-right`}>Publ.</th>
              <th className={`${th} text-right`}>Seguidores</th>
              <th className={`${th} text-right`}>Queixas</th>
              <th className={th}>Última entrada</th>
              <th className={th}>Criada</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {rows.map((u) => (
              <tr key={u.id} className="hover:bg-zinc-50">
                <td className={td}>
                  <Link to={`/backoffice/users/${u.id}`} className="font-semibold underline-offset-2 hover:underline">@{u.username}</Link>
                  <span className="block text-xs text-zinc-500">{u.display_name}{u.is_admin ? ' · moderação' : ''}</span>
                </td>
                <td className={td}>
                  <span className="break-all">{u.email}</span>
                  <span className="ml-1 align-middle">{u.verified ? <Badge tone="green">confirmado</Badge> : <Badge tone="amber">por confirmar</Badge>}</span>
                </td>
                <td className={td}>{statusBadge(u.status)}</td>
                <td className={`${td} text-right tabular-nums`}>{u.posts}</td>
                <td className={`${td} text-right tabular-nums`}>{u.followers}</td>
                <td className={`${td} text-right tabular-nums`}>{u.reports > 0 ? <Badge tone="red">{u.reports}</Badge> : 0}</td>
                <td className={td}>{ago(u.last_seen)}</td>
                <td className={td}>{new Date(u.created_at).toLocaleDateString('pt-PT')}</td>
              </tr>
            ))}
            {list.isSuccess && rows.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-10 text-center text-zinc-500">Nenhuma conta encontrada.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {list.isLoading && <p className="mt-4 text-sm text-zinc-500">A carregar…</p>}
      {list.hasNextPage && <button type="button" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage} className={`${btnGhost} mt-4`}>{list.isFetchingNextPage ? 'A carregar…' : 'Mostrar mais'}</button>}
    </>
  );
}
