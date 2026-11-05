import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { Badge, Empty, PageHeader, btnDanger, btnGhost, btnPrimary, td, th, useCan, when } from './bo';

const KIND: Record<string, string> = { bar: 'Bar', restaurante: 'Restaurante', discoteca: 'Discoteca', cafe: 'Café', hotel: 'Hotel', evento: 'Evento', outro: 'Outro' };

/** Os locais (bares, restaurantes…): por verificar primeiro. Dar ou tirar o selo fica no registo de auditoria. */
export default function BackofficeVenues() {
  const qc = useQueryClient();
  const can = useCan('catalog.manage');
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const q = useQuery({ queryKey: ['bo-venues', filter], queryFn: () => api.boVenues(filter) });
  const [busy, setBusy] = useState<string | null>(null);
  const rows = q.data ?? [];

  async function set(slug: string, verified: boolean) {
    setBusy(slug);
    await api.boVerifyVenue(slug, verified).catch(() => undefined);
    await qc.invalidateQueries({ queryKey: ['bo-venues'] });
    setBusy(null);
  }

  return (
    <div>
      <PageHeader title="Locais" description="Bares, restaurantes, discotecas… Verifica os que são mesmo do dono." />
      <div className="mb-4 flex gap-2">
        {([['pending', 'Por verificar'], ['all', 'Todos']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)} className={`${btnGhost} ${filter === k ? '!bg-zinc-900 !text-white' : ''}`}>{label}</button>
        ))}
      </div>
      {q.isLoading && <p className="text-sm text-zinc-500">A carregar…</p>}
      {q.isSuccess && rows.length === 0 && <Empty title={filter === 'pending' ? 'Nada por verificar' : 'Ainda não há locais'} />}
      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-zinc-200/70">
          <table className="w-full">
            <thead><tr><th className={th}>Local</th><th className={th}>Tipo</th><th className={th}>Dono</th><th className={th}>Check-ins</th><th className={th}>Criado</th><th className={th}>Estado</th><th className={th} /></tr></thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.slug} className="border-t border-zinc-100">
                  <td className={td}><Link to={`/v/${v.slug}`} className="font-semibold underline-offset-2 hover:underline">{v.name}</Link>{v.city ? <span className="block text-xs text-zinc-500">{v.city}</span> : null}</td>
                  <td className={td}>{KIND[v.kind] ?? v.kind}</td>
                  <td className={td}>@{v.owner}</td>
                  <td className={td}>{v.checkins}</td>
                  <td className={td}>{when(v.createdAt)}</td>
                  <td className={td}><Badge tone={v.verified ? 'green' : 'amber'}>{v.verified ? 'verificado' : 'por verificar'}</Badge></td>
                  <td className={`${td} text-right`}>
                    {can && (v.verified
                      ? <button disabled={busy === v.slug} onClick={() => void set(v.slug, false)} className={btnDanger}>Tirar o selo</button>
                      : <button disabled={busy === v.slug} onClick={() => void set(v.slug, true)} className={btnPrimary}>Verificar</button>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
