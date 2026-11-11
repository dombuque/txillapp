import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ago } from '../bo';
import { finApi } from './fin-api';
import { fmt, Kpi, Loading, Panel, Status, Table, tdc, tdn, Txl } from './fin-ui';

type Sort = 'balance' | 'received' | 'boostSpent';

/** As carteiras dos locais: saldo, recebido em pagamentos e gasto no Bombar (no período). */
export function VenueWalletsPanel({ days, onAccount }: { days: number; onAccount: (q: string) => void }) {
  const q = useQuery({ queryKey: ['fin-venues', days], queryFn: () => finApi.venues(days) });
  const [sort, setSort] = useState<Sort>('balance');
  const [text, setText] = useState('');
  const rows = useMemo(() => {
    const t = text.trim().toLowerCase();
    return (q.data?.items ?? []).filter((r) => !t || r.venue?.name.toLowerCase().includes(t) || r.venue?.slug.includes(t)).sort((a, b) => b[sort] - a[sort]);
  }, [q.data, sort, text]);
  const d = q.data;
  if (!d) return <Loading error={q.error} />;
  const head = (k: Sort, label: string) => (
    <button type="button" onClick={() => setSort(k)} className={`uppercase ${sort === k ? 'text-zinc-900 underline' : ''}`} aria-pressed={sort === k}>{label}</button>
  );
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi label="Saldo nos locais" value={<Txl v={d.totals.balance} />} icon="store" hint={`${fmt(d.totals.wallets)} carteiras`} />
        <Kpi label={`Recebido em ${days} dias`} value={<Txl v={d.totals.received} />} icon="download" hint="Pagamentos com Txills (pessoas e cofres)" />
        <Kpi label={`Gasto no Bombar em ${days} dias`} value={<Txl v={d.totals.boostSpent} />} icon="flame" hint="Já descontadas as devoluções" />
      </div>
      <Panel title="Carteiras dos locais" pad={false} right={<input value={text} onChange={(e) => setText(e.target.value)} placeholder="Procurar local" aria-label="Procurar local" className="h-9 w-full rounded-lg border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900 sm:w-56" />}>
        <Table label="Carteiras dos locais" head={[{ label: 'Local' }, { label: 'Estado' }, { label: head('balance', 'Saldo'), right: true }, { label: head('received', 'Recebido'), right: true }, { label: head('boostSpent', 'Bombar'), right: true }, { label: 'Último movimento', right: true }]}
          empty={rows.length === 0 ? <p className="px-5 py-10 text-center text-sm text-zinc-500">Nenhum local com carteira.</p> : null}>
          {rows.map((r) => (
            <tr key={r.accountId} className="hover:bg-zinc-50">
              <td className={tdc}>
                <button type="button" className="text-left font-semibold hover:underline" onClick={() => onAccount(r.venue?.slug ?? r.accountId)}>{r.venue?.name ?? 'Local apagado'}</button>
                <span className="block text-xs text-zinc-500">{r.venue?.slug ?? r.accountId.slice(0, 8)}{r.payments ? ` · ${r.payments} pagamentos` : ''}</span>
              </td>
              <td className={tdc}>
                {!r.venue ? <Status tone="neutral">apagado</Status> : r.venue.reviewStatus === 'approved' ? (r.venue.acceptsTxills ? <Status tone="good">aceita Txills</Status> : <Status tone="neutral">aprovado</Status>) : r.venue.reviewStatus === 'pending' ? <Status tone="warn">por aprovar</Status> : <Status tone="bad">recusado</Status>}
              </td>
              <td className={`${tdn} font-semibold`}>{fmt(r.balance)}</td>
              <td className={tdn}>{r.received ? fmt(r.received) : <span className="text-zinc-300">0</span>}</td>
              <td className={tdn}>{r.boostSpent ? fmt(r.boostSpent) : <span className="text-zinc-300">0</span>}</td>
              <td className={`${tdn} text-xs text-zinc-500`}>{ago(r.lastMove)}</td>
            </tr>
          ))}
        </Table>
      </Panel>
    </div>
  );
}
