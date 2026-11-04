import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { PageHeader, btnGhost, td, th, when } from './bo';

const GROUPS = [
  ['', 'Tudo'],
  ['backoffice.', 'Backoffice'],
  ['moderation.', 'Moderação'],
  ['account.', 'Contas'],
  ['auth.', 'Autenticação'],
] as const;

/** O registo de auditoria: só se acrescenta, nunca se altera. */
export default function BackofficeAudit() {
  const [action, setAction] = useState('');
  const [actorText, setActorText] = useState('');
  const [actor, setActor] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setActor(actorText.trim()), 300);
    return () => clearTimeout(t);
  }, [actorText]);
  const q = useInfiniteQuery({
    queryKey: ['bo-audit', action, actor],
    queryFn: ({ pageParam }) => api.boAudit(action, actor, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <>
      <PageHeader title="Auditoria" description="Quem fez o quê e quando. Os registos não se apagam." />
      <div className="flex flex-wrap gap-3">
        <select value={action} onChange={(e) => setAction(e.target.value)} aria-label="Tipo de ação" className="h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm">
          {GROUPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input value={actorText} onChange={(e) => setActorText(e.target.value)} placeholder="Quem (@utilizador)" aria-label="Quem" className="h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-zinc-900" />
      </div>
      <div className="mt-4 overflow-x-auto rounded-2xl bg-white shadow-[0_1px_2px_rgba(15,18,25,0.06)] ring-1 ring-zinc-200/70">
        <table className="w-full min-w-[720px]">
          <thead className="border-b border-zinc-200 bg-zinc-50"><tr><th className={th}>Quando</th><th className={th}>Quem</th><th className={th}>Ação</th><th className={th}>Alvo</th><th className={th}>Detalhe</th></tr></thead>
          <tbody className="divide-y divide-zinc-100">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className={`${td} whitespace-nowrap`}>{when(r.created_at)}</td>
                <td className={td}>{r.actor ? `@${r.actor}` : '—'}</td>
                <td className={`${td} font-mono text-xs`}>{r.action}</td>
                <td className={`${td} break-all font-mono text-xs`}>{r.target ?? '—'}</td>
                <td className={td}>{typeof r.metadata?.reason === 'string' ? r.metadata.reason : typeof r.metadata?.note === 'string' ? r.metadata.note : typeof r.metadata?.motivo === 'string' ? r.metadata.motivo : ''}</td>
              </tr>
            ))}
            {q.isSuccess && rows.length === 0 && <tr><td colSpan={5} className="px-3 py-10 text-center text-zinc-500">Sem registos com este filtro.</td></tr>}
          </tbody>
        </table>
      </div>
      {q.hasNextPage && <button type="button" onClick={() => void q.fetchNextPage()} className={`${btnGhost} mt-4`}>Mostrar mais</button>}
    </>
  );
}
