import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { btnGhost, btnPrimary, when } from '../bo';
import { finApi, LEDGER_LABEL, LEDGER_TYPES, type FinLedgerFilter } from './fin-api';
import { TxDialog } from './fin-tx';
import { fmt, Loading, Panel, Table, tdc, tdn, Txl } from './fin-ui';

const input = 'h-9 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-zinc-900';
export const EMPTY_FILTER: FinLedgerFilter = { type: '', account: '', from: '', to: '' };

/** O livro de movimentos: filtros (tipo, conta, datas), totais do filtro, páginas e o detalhe de cada movimento. */
export function LedgerPanel({ filter, onFilter }: { filter: FinLedgerFilter; onFilter: (f: FinLedgerFilter) => void }) {
  const [draft, setDraft] = useState(filter);
  const [open, setOpen] = useState<string | null>(null);
  const q = useInfiniteQuery({
    queryKey: ['fin-ledger', filter],
    queryFn: ({ pageParam }) => finApi.ledger(filter, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
  const first = q.data?.pages[0];
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  const filtered = !!filter.account;
  const set = (k: keyof FinLedgerFilter, v: string) => setDraft((d) => ({ ...d, [k]: v }));
  const apply = () => onFilter({ ...draft, account: draft.account.trim() });

  return (
    <Panel title="Livro de movimentos" help="Cada movimento tira de uma conta e põe noutra (partidas dobradas). Toca numa linha para ver o detalhe." pad={false}>
      <form className="grid gap-2 px-4 pb-3 sm:grid-cols-2 sm:px-5 lg:grid-cols-[1.2fr_1.4fr_1fr_1fr_auto]" onSubmit={(e) => { e.preventDefault(); apply(); }}>
        <label className="text-xs font-semibold text-zinc-500">Tipo
          <select value={draft.type} onChange={(e) => set('type', e.target.value)} className={`${input} mt-1`}>
            <option value="">Todos</option>
            {LEDGER_TYPES.map((t) => <option key={t} value={t}>{LEDGER_LABEL[t]}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-zinc-500">Conta
          <input value={draft.account} onChange={(e) => set('account', e.target.value)} placeholder="@utilizador, endereço do local, id ou emissao" className={`${input} mt-1`} />
        </label>
        <label className="text-xs font-semibold text-zinc-500">De
          <input type="date" value={draft.from} onChange={(e) => set('from', e.target.value)} className={`${input} mt-1`} />
        </label>
        <label className="text-xs font-semibold text-zinc-500">Até
          <input type="date" value={draft.to} onChange={(e) => set('to', e.target.value)} className={`${input} mt-1`} />
        </label>
        <div className="flex items-end gap-2">
          <button type="submit" className={btnPrimary}>Filtrar</button>
          <button type="button" className={btnGhost} onClick={() => { setDraft(EMPTY_FILTER); onFilter(EMPTY_FILTER); }}>Limpar</button>
        </div>
      </form>

      {first && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 border-y border-zinc-100 bg-zinc-50/60 px-4 py-2.5 text-sm sm:px-5">
          {first.account && <span>Conta: <b>{first.account.found ? first.account.label : `"${first.account.query}" não encontrada`}</b></span>}
          <span>Movimentos: <b className="tabular-nums">{fmt(first.totals.count)}</b></span>
          <span>Volume: <b><Txl v={first.totals.volume} /></b></span>
          {filtered && <span className="text-emerald-700">Entrou: <b><Txl v={first.totals.in} /></b></span>}
          {filtered && <span className="text-red-700">Saiu: <b><Txl v={first.totals.out} /></b></span>}
        </div>
      )}
      {q.isLoading && <div className="p-5"><Loading /></div>}
      {q.isError && <div className="p-5"><Loading error={q.error} /></div>}
      {/* No telemóvel: uma lista (o montante sempre à vista); no computador: a tabela. */}
      {q.isSuccess && rows.length > 0 && (
        <ul className="divide-y divide-zinc-100 sm:hidden">
          {rows.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => setOpen(r.id)} className="w-full px-4 py-3 text-left active:bg-zinc-50">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="font-medium text-zinc-900">{LEDGER_LABEL[r.type] ?? r.type}</span>
                  <span className={`shrink-0 font-semibold ${r.net !== null ? (r.net < 0 ? 'text-red-700' : 'text-emerald-700') : ''}`}>{r.net !== null ? <Txl v={r.net} sign /> : <Txl v={r.amount} />}</span>
                </span>
                <span className="mt-0.5 block truncate text-sm text-zinc-600">{r.from.join(', ')} → {r.to.join(', ')}</span>
                <span className="block text-xs text-zinc-400">{when(r.createdAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {q.isSuccess && (
        <div className={rows.length > 0 ? 'hidden sm:block' : ''}>
        <Table label="Movimentos" head={[{ label: 'Quando' }, { label: 'Tipo' }, { label: 'De' }, { label: 'Para' }, { label: filtered ? 'Nesta conta' : 'Montante', right: true }]}
          empty={rows.length === 0 ? <p className="px-5 py-10 text-center text-sm text-zinc-500">Nenhum movimento com estes filtros.</p> : null}>
          {rows.map((r) => (
            <tr key={r.id} tabIndex={0} onClick={() => setOpen(r.id)} onKeyDown={(e) => e.key === 'Enter' && setOpen(r.id)} className="cursor-pointer hover:bg-zinc-50 focus:bg-zinc-50 focus:outline-none">
              <td className={`${tdc} whitespace-nowrap text-xs text-zinc-500`}>{when(r.createdAt)}</td>
              <td className={tdc}><span className="font-medium">{LEDGER_LABEL[r.type] ?? r.type}</span>{r.note && <span className="block max-w-[220px] truncate text-xs text-zinc-500">“{r.note}”</span>}</td>
              <td className={`${tdc} max-w-[200px] truncate`}>{r.from.join(', ')}</td>
              <td className={`${tdc} max-w-[200px] truncate`}>{r.to.join(', ')}</td>
              <td className={`${tdn} font-semibold ${r.net !== null ? (r.net < 0 ? 'text-red-700' : 'text-emerald-700') : ''}`}>{r.net !== null ? <Txl v={r.net} sign /> : <Txl v={r.amount} />}</td>
            </tr>
          ))}
        </Table>
        </div>
      )}
      {q.hasNextPage && (
        <div className="flex justify-center p-4">
          <button type="button" className={btnGhost} disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>{q.isFetchingNextPage ? 'A carregar…' : `Mostrar mais (${rows.length} de ${fmt(first?.totals.count ?? 0)})`}</button>
        </div>
      )}
      {open && <TxDialog id={open} onClose={() => setOpen(null)} />}
    </Panel>
  );
}
