import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import Icon from '../../components/Icon';
import { Badge, Empty, PageHeader, btnGhost, td, th, when } from './bo';
import { modApi, type AuditFilter, type AuditRow } from './ui/mod-api';
import { AuditDetail, GROUPS, actionLabel, reasonOf, targetText } from './ui/mod-audit';
import { Field, inputCls, selectCls, useDebounced, useToast } from './ui/mod-kit';

const tone = (a: string): 'red' | 'amber' | 'blue' | 'green' | 'zinc' =>
  /suspend|remove|deleted|reject|reuse|failed/.test(a) ? 'red' : /warn|batch|export|view_media/.test(a) ? 'amber' : /restore|reactivate|approve|verified/.test(a) ? 'green' : a.startsWith('moderation.') || a.startsWith('catalog.') ? 'blue' : 'zinc';

/** O registo de auditoria: quem fez o quê, quando e porquê. Só se acrescenta, nunca se altera. Exportar fica também no registo. */
export default function BackofficeAudit() {
  const toast = useToast();
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');
  const [targetText_, setTarget] = useState('');
  const target = useDebounced(targetText_.trim());
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [open, setOpen] = useState('');
  const [busy, setBusy] = useState(false);
  const f: AuditFilter = { actor: actor || undefined, action: action || undefined, target: target || undefined, from: from || undefined, to: to || undefined };

  const facets = useQuery({ queryKey: ['mod-audit-facets'], queryFn: modApi.auditFacets, staleTime: 60_000 });
  const q = useInfiniteQuery({
    queryKey: ['mod-audit', f],
    queryFn: ({ pageParam }) => modApi.audit(f, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  const filtered = !!(actor || action || target || from || to);

  async function exportCsv() {
    setBusy(true);
    try {
      const blob = await modApi.auditCsv(f);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `auditoria-txillapp-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast.show('CSV descarregado (até 5000 linhas). A exportação ficou no registo.');
    } catch (e) {
      toast.show((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  }

  const actions = facets.data?.actions ?? [];
  const row = (r: AuditRow) => (
    <Fragment key={r.id}>
      <tr className="cursor-pointer hover:bg-zinc-50/70" onClick={() => setOpen(open === r.id ? '' : r.id)} aria-expanded={open === r.id}>
        <td className={`${td} whitespace-nowrap text-zinc-600`}>{when(r.created_at)}</td>
        <td className={td}>{r.actorName ?? r.actor ?? <span className="text-zinc-400">Sistema</span>}</td>
        <td className={td}><Badge tone={tone(r.action)}>{actionLabel(r.action)}</Badge></td>
        <td className={`${td} break-all`}>{targetText(r)}{r.ownerLabel && !r.targetLabel ? <span className="block text-xs text-zinc-500">de {r.ownerLabel}</span> : null}</td>
        <td className={`${td} max-w-[280px] text-zinc-700`}><span className="line-clamp-2 break-words">{reasonOf(r)}</span></td>
        <td className={`${td} w-6 text-zinc-400`}><Icon name={open === r.id ? 'chevron-left' : 'chevron-right'} size={14} className={open === r.id ? '-rotate-90' : ''} /></td>
      </tr>
      {open === r.id && <tr className="bg-zinc-50/70"><td colSpan={6} className="px-4 py-3"><AuditDetail r={r} /></td></tr>}
    </Fragment>
  );

  return (
    <>
      <PageHeader
        title="Auditoria"
        description="Quem fez o quê, quando e porquê. Os registos não se alteram nem se apagam."
        actions={<button type="button" disabled={busy} onClick={() => void exportCsv()} className={btnGhost}><Icon name="download" size={16} className="mr-1.5" />{busy ? 'A preparar…' : 'Exportar CSV'}</button>}
      />
      <div className="mb-4 grid grid-cols-2 gap-2 rounded-2xl bg-white p-3 ring-1 ring-zinc-200/70 sm:p-4 md:grid-cols-3 xl:grid-cols-5">
        <Field label="Pessoa da equipa">
          <select value={actor} onChange={(e) => setActor(e.target.value)} className={`${selectCls} w-full`}>
            <option value="">Todas</option>
            {facets.data?.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Ação">
          <select value={action} onChange={(e) => setAction(e.target.value)} className={`${selectCls} w-full`}>
            <option value="">Todas</option>
            {GROUPS.map((g) => (
              <optgroup key={g.prefix} label={g.label}>
                <option value={g.prefix}>{g.label}: tudo</option>
                {actions.filter((a) => a.action.startsWith(g.prefix)).map((a) => <option key={a.action} value={a.action}>{actionLabel(a.action)} ({a.count})</option>)}
              </optgroup>
            ))}
            {actions.filter((a) => !GROUPS.some((g) => a.action.startsWith(g.prefix))).map((a) => <option key={a.action} value={a.action}>{actionLabel(a.action)} ({a.count})</option>)}
          </select>
        </Field>
        <Field label="Alvo" className="col-span-2 md:col-span-1"><input value={targetText_} onChange={(e) => setTarget(e.target.value)} placeholder="@conta ou id" className={inputCls} /></Field>
        <Field label="Desde"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} /></Field>
        <Field label="Até"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} /></Field>
        {filtered && <button type="button" onClick={() => { setActor(''); setAction(''); setTarget(''); setFrom(''); setTo(''); }} className="col-span-2 justify-self-start text-xs font-semibold text-zinc-500 underline md:col-span-3 xl:col-span-5">Limpar filtros</button>}
      </div>

      {q.isLoading ? <div className="h-48 animate-pulse rounded-2xl bg-white" /> : q.isError ? (
        <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{(q.error as Error).message}</p>
      ) : rows.length === 0 ? <Empty title="Sem registos" text="Nada corresponde a estes filtros." /> : (
        <>
          <div className="hidden overflow-x-auto rounded-2xl bg-white shadow-[0_1px_2px_rgba(15,18,25,0.06)] ring-1 ring-zinc-200/70 md:block">
            <table className="w-full min-w-[760px]">
              <thead className="border-b border-zinc-200 bg-zinc-50"><tr><th className={th}>Quando</th><th className={th}>Quem</th><th className={th}>Ação</th><th className={th}>Alvo</th><th className={th}>Motivo</th><th className={th} /></tr></thead>
              <tbody className="divide-y divide-zinc-100">{rows.map(row)}</tbody>
            </table>
          </div>
          <ul className="space-y-2 md:hidden">
            {rows.map((r) => (
              <li key={r.id} className="rounded-xl bg-white p-3 ring-1 ring-zinc-200/70">
                <button type="button" onClick={() => setOpen(open === r.id ? '' : r.id)} className="w-full text-left" aria-expanded={open === r.id}>
                  <span className="flex items-center gap-2"><Badge tone={tone(r.action)}>{actionLabel(r.action)}</Badge><span className="ml-auto text-xs text-zinc-500">{when(r.created_at)}</span></span>
                  <span className="mt-1 block text-sm"><b>{r.actorName ?? r.actor ?? 'Sistema'}</b> · {targetText(r)}</span>
                  {reasonOf(r) && <span className="mt-0.5 block break-words text-sm text-zinc-600">{reasonOf(r)}</span>}
                </button>
                {open === r.id && <div className="mt-2 border-t border-zinc-100 pt-2"><AuditDetail r={r} /></div>}
              </li>
            ))}
          </ul>
        </>
      )}
      {q.hasNextPage && <button type="button" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()} className={`${btnGhost} mt-4`}>{q.isFetchingNextPage ? 'A carregar…' : 'Mostrar mais'}</button>}
      {toast.node}
    </>
  );
}
