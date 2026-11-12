import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { btnGhost, btnPrimary, when } from '../bo';
import { storePurchasesApi, type StorePurchaseFilter, type StorePurchaseStatus } from './fin-api';
import { fmt, Kpi, Loading, money, Panel, Status, Table, tdc, tdn, type Tone } from './fin-ui';

const input = 'h-9 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-zinc-900';
const EMPTY: StorePurchaseFilter = { store: '', status: '', kind: '', product: '', env: '', user: '', from: '', to: '' };
const STATUS: Record<StorePurchaseStatus, [Tone, string]> = {
  active: ['good', 'ativa'], consumed: ['info', 'usada'], expired: ['neutral', 'expirou'], refunded: ['bad', 'reembolsada'], revoked: ['warn', 'revogada'],
};
const STORE = { apple: 'App Store', google: 'Google Play' } as const;
const month = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('pt-PT', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/**
 * Compras na loja (só leitura): a verificação paga (subscrições) e o Bombar (consumíveis). Filtros, estado, reembolsos e
 * totais por produto e por mês. As compras de teste (Sandbox) ficam fora das receitas.
 */
export function StorePurchasesPanel() {
  const [filter, setFilter] = useState(EMPTY);
  const [draft, setDraft] = useState(EMPTY);
  const q = useInfiniteQuery({
    queryKey: ['fin-store', filter],
    queryFn: ({ pageParam }) => storePurchasesApi(filter, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
  const first = q.data?.pages[0];
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  if (!first) return <Loading error={q.error} />;
  const cur = first.config.currency;
  const set = (k: keyof StorePurchaseFilter, v: string) => setDraft((d) => ({ ...d, [k]: v }));
  const net = first.totals.byMonth.reduce((s, m) => s + m.netMinor, 0);
  const refunds = first.totals.byMonth.reduce((s, m) => s + m.refunds, 0);
  const mode: [Tone, string] = first.config.enabled ? ['good', 'Ligadas'] : ['neutral', 'Desligadas (IAP_ENABLED)'];

  return (
    <div className="space-y-4">
      <Panel title="Compras na loja" right={<Status tone={mode[0]}>{mode[1]}</Status>}
        help="Só a verificação paga e o Bombar se vendem na App Store e no Google Play (os Txills não). Na Google, os valores são os preços de referência da configuração; na Apple, o que a Apple diz.">
        <ul className="grid gap-2 sm:grid-cols-2">
          {(['apple', 'google'] as const).map((s) => (
            <li key={s} className="flex items-center justify-between rounded-xl px-3 py-2.5 ring-1 ring-zinc-200">
              <span className="font-medium">{STORE[s]}</span>
              {first.config[s] ? <Status tone={first.config.enabled ? 'good' : 'warn'}>{first.config.enabled ? 'ligada' : 'configurada'}</Status> : <Status tone="neutral">sem configuração</Status>}
            </li>
          ))}
        </ul>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Receita líquida (24 meses)" value={money(net, cur)} icon="wallet" hint={first.totals.sandbox ? `${fmt(first.totals.sandbox.purchases)} compras de teste (fora)` : 'Sem compras de teste'} />
        <Kpi label="Subscrições ativas" value={fmt(first.counts.active)} icon="check-circle" />
        <Kpi label="Reembolsos" value={fmt(first.counts.refunded + first.counts.revoked)} icon="alert" tone={refunds > 0 ? 'warn' : 'neutral'} hint={`${fmt(refunds)} nos últimos 24 meses`} />
        <Kpi label="Bombar usados" value={fmt(first.counts.consumed)} icon="flame" hint={`${fmt(first.counts.expired)} subscrições expiradas`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Por produto" pad={false}>
          <Table label="Por produto" head={[{ label: 'Produto' }, { label: 'Compras', right: true }, { label: 'Renovações', right: true }, { label: 'Reembolsos', right: true }, { label: 'Líquido', right: true }]}
            empty={first.totals.byProduct.length === 0 ? <p className="px-5 py-8 text-center text-sm text-zinc-500">Ainda não há compras reais.</p> : null}>
            {first.totals.byProduct.map((p) => (
              <tr key={`${p.productId}-${p.store}`}>
                <td className={tdc}><b>{p.productId}</b><span className="ml-2 text-xs text-zinc-500">{STORE[p.store]}</span></td>
                <td className={tdn}>{fmt(p.purchases)}</td>
                <td className={tdn}>{fmt(p.renewals)}</td>
                <td className={tdn}>{fmt(p.refunds)}</td>
                <td className={tdn}>{money(p.netMinor, cur)}</td>
              </tr>
            ))}
          </Table>
        </Panel>
        <Panel title="Por mês" pad={false}>
          <Table label="Por mês" head={[{ label: 'Mês' }, { label: 'Compras', right: true }, { label: 'Renovações', right: true }, { label: 'Reembolsado', right: true }, { label: 'Líquido', right: true }]}
            empty={first.totals.byMonth.length === 0 ? <p className="px-5 py-8 text-center text-sm text-zinc-500">Ainda não há compras reais.</p> : null}>
            {first.totals.byMonth.map((m) => (
              <tr key={m.month}>
                <td className={tdc}>{month(m.month)}</td>
                <td className={tdn}>{fmt(m.purchases)}</td>
                <td className={tdn}>{fmt(m.renewals)}</td>
                <td className={tdn}>{money(m.refundedMinor, cur)}</td>
                <td className={tdn}>{money(m.netMinor, cur)}</td>
              </tr>
            ))}
          </Table>
        </Panel>
      </div>

      <Panel title="Compras" pad={false}>
        <form className="grid gap-2 px-4 pb-3 sm:grid-cols-2 sm:px-5 lg:grid-cols-4" onSubmit={(e) => { e.preventDefault(); setFilter({ ...draft, user: draft.user.trim() }); }}>
          <label className="text-xs font-semibold text-zinc-500">Loja
            <select value={draft.store} onChange={(e) => set('store', e.target.value)} className={`${input} mt-1`}>
              <option value="">Todas</option><option value="apple">App Store</option><option value="google">Google Play</option>
            </select>
          </label>
          <label className="text-xs font-semibold text-zinc-500">Estado
            <select value={draft.status} onChange={(e) => set('status', e.target.value)} className={`${input} mt-1`}>
              <option value="">Todos</option>
              {(Object.keys(STATUS) as StorePurchaseStatus[]).map((s) => <option key={s} value={s}>{STATUS[s][1]} ({fmt(first.counts[s])})</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-zinc-500">Produto
            <select value={draft.product} onChange={(e) => set('product', e.target.value)} className={`${input} mt-1`}>
              <option value="">Todos</option>
              {first.config.products.map((p) => <option key={p.id} value={p.id}>{p.id}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-zinc-500">Ambiente
            <select value={draft.env} onChange={(e) => set('env', e.target.value)} className={`${input} mt-1`}>
              <option value="">Todos</option><option value="Production">Reais</option><option value="Sandbox">Teste (sandbox)</option>
            </select>
          </label>
          <label className="text-xs font-semibold text-zinc-500">Conta
            <input value={draft.user} onChange={(e) => set('user', e.target.value)} placeholder="@utilizador" className={`${input} mt-1`} />
          </label>
          <label className="text-xs font-semibold text-zinc-500">De
            <input type="date" value={draft.from} onChange={(e) => set('from', e.target.value)} className={`${input} mt-1`} />
          </label>
          <label className="text-xs font-semibold text-zinc-500">Até
            <input type="date" value={draft.to} onChange={(e) => set('to', e.target.value)} className={`${input} mt-1`} />
          </label>
          <div className="flex items-end gap-2">
            <button type="submit" className={btnPrimary}>Filtrar</button>
            <button type="button" className={btnGhost} onClick={() => { setDraft(EMPTY); setFilter(EMPTY); }}>Limpar</button>
          </div>
        </form>
        <Table label="Compras na loja" head={[{ label: 'Quando' }, { label: 'Quem' }, { label: 'Produto' }, { label: 'Loja' }, { label: 'Pago', right: true }, { label: 'Validade / campanha' }, { label: 'Estado' }]}
          empty={rows.length === 0 ? <p className="px-5 py-10 text-center text-sm text-zinc-500">Sem compras com estes filtros.</p> : null}>
          {rows.map((r) => {
            const [tone, label] = STATUS[r.status] ?? ['neutral', r.status];
            return (
              <tr key={r.id}>
                <td className={`${tdc} whitespace-nowrap text-xs text-zinc-500`}>{when(r.createdAt)}</td>
                <td className={tdc}>{r.user.username ? `@${r.user.username}` : 'Conta apagada'}</td>
                <td className={tdc}>{r.productId}{r.renewals > 0 && <span className="ml-1 text-xs text-zinc-500">· {r.renewals} renovações</span>}</td>
                <td className={tdc}>{STORE[r.store]}{r.environment === 'Sandbox' && <span className="ml-1 text-xs font-semibold text-amber-700">teste</span>}</td>
                <td className={tdn}>{r.paidMinor === null ? '—' : money(r.paidMinor, cur)}</td>
                <td className={`${tdc} text-xs`}>
                  {r.kind === 'subscription'
                    ? r.expiresAt ? `até ${when(r.expiresAt)}${r.autoRenew ? ' · renova' : ''}` : '—'
                    : r.campaign ? `${r.campaign.venue?.name ?? 'Local'} · ${r.campaign.status}` : 'por ligar'}
                </td>
                <td className={tdc}><Status tone={tone}>{label}</Status></td>
              </tr>
            );
          })}
        </Table>
        {q.hasNextPage && (
          <div className="border-t border-zinc-100 p-3 text-center">
            <button type="button" className={btnGhost} disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>{q.isFetchingNextPage ? 'A carregar…' : 'Mais'}</button>
          </div>
        )}
      </Panel>
    </div>
  );
}
