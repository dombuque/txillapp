import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Empty, PageHeader, ReasonDialog, ago, btnDanger, btnGhost, td, th, useCan } from './bo';
import { txApi, type BoTxillada, type TxReason } from './ui/txillada-api';

const AUDIENCE: Record<BoTxillada['audience'], string> = { everyone: 'Todos', followers: 'Seguidores', close: 'Amigos próximos' };
const REASON: Record<TxReason, string> = {
  spam: 'spam', harassment: 'assédio', hate: 'ódio', nudity: 'nudez', violence: 'violência', scam: 'burla', impersonation: 'falsa identidade', minor: 'menor', other: 'outro',
};

/**
 * Txilladas ao vivo: as que estão a decorrer agora (as denunciadas primeiro), com quantos estão a ver, os últimos
 * comentários e o «Cortar» (fecha a sala no LiveKit, quem está a ver recebe «A Txillada acabou», as denúncias por decidir
 * fecham-se e o anfitrião é avisado). Nada se grava: depois de acabar já não se vê.
 */
export default function Txilladas() {
  const qc = useQueryClient();
  const can = useCan('reports.decide');
  const q = useQuery({ queryKey: ['bo-txilladas'], queryFn: txApi.list, refetchInterval: 10_000 });
  const [cutting, setCutting] = useState<BoTxillada | null>(null);
  const rows = q.data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Txilladas ao vivo"
        description="Os lives a decorrer agora. Nada se grava: quando acaba, já não se vê. Corta as que violem as regras."
        actions={<button onClick={() => void q.refetch()} className={btnGhost}>Atualizar</button>}
      />
      {q.isLoading && <p className="text-sm text-zinc-500">A carregar…</p>}
      {q.isError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{(q.error as Error).message}</p>}
      {q.isSuccess && rows.length === 0 && <Empty title="Nenhuma Txillada a decorrer" text="Quando alguém abrir uma, aparece aqui." />}
      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-zinc-200/70">
          <table className="w-full">
            <thead>
              <tr>
                <th className={th}>Anfitrião</th><th className={th}>Título</th><th className={th}>Desde</th><th className={th}>A ver</th>
                <th className={th}>Denúncias</th><th className={th}>Últimos comentários</th><th className={th} />
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="border-t border-zinc-100 align-top">
                  <td className={td}>
                    <Link to={`/backoffice/users/${t.host.id}`} className="font-semibold hover:underline">@{t.host.username}</Link>
                    <span className="block text-xs text-zinc-500">{t.host.displayName}</span>
                  </td>
                  <td className={td}>
                    <span className="font-medium text-zinc-900">{t.title}</span>
                    <span className="block text-xs text-zinc-500">{AUDIENCE[t.audience]} · {t.cheers} brindes · {t.comments} comentários</span>
                  </td>
                  <td className={`${td} text-xs`}>{ago(t.startedAt)}</td>
                  <td className={td}>{t.viewers}<span className="block text-xs text-zinc-500">máx. {t.peakViewers}</span></td>
                  <td className={td}>
                    {t.reports.open > 0 ? <Badge tone="red">{t.reports.open} por decidir</Badge> : <span className="text-xs text-zinc-400">—</span>}
                    {t.reports.reasons.length > 0 && <span className="mt-1 block text-xs text-zinc-600">{t.reports.reasons.map((r) => REASON[r] ?? r).join(', ')}</span>}
                  </td>
                  <td className={`${td} max-w-xs text-xs`}>
                    {t.lastComments.length === 0 ? <span className="text-zinc-400">—</span> : (
                      <ul className="space-y-0.5">
                        {t.lastComments.map((c) => <li key={c.id} className="truncate"><span className="font-semibold">@{c.username}</span> {c.body}</li>)}
                      </ul>
                    )}
                  </td>
                  <td className={`${td} text-right`}>
                    {can && <button onClick={() => setCutting(t)} className={btnDanger}>Cortar</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {cutting && (
        <ReasonDialog
          title={`Cortar a Txillada de @${cutting.host.username}?`}
          help="A sala fecha já, quem está a ver recebe «A Txillada acabou» e o anfitrião é avisado com o motivo. As denúncias por decidir fecham-se."
          confirm="Cortar"
          danger
          onCancel={() => setCutting(null)}
          onConfirm={async (reason) => {
            await txApi.cut(cutting.id, reason);
            setCutting(null);
            await qc.invalidateQueries({ queryKey: ['bo-txilladas'] });
          }}
        />
      )}
    </>
  );
}
