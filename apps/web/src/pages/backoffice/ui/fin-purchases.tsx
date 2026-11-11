import { useQuery } from '@tanstack/react-query';
import { when } from '../bo';
import { finApi } from './fin-api';
import { fmt, Kpi, Loading, money, Panel, Status, Table, tdc, tdn, type Tone } from './fin-ui';

const ORDER: Record<string, [Tone, string]> = { paid: ['good', 'pago'], pending: ['warn', 'pendente'], failed: ['bad', 'falhou'], cancelled: ['neutral', 'cancelado'], expired: ['neutral', 'expirou'] };

/** Compras de Txills: estado do fornecedor, pacotes e pedidos (só leitura). */
export function PurchasesPanel({ days, onTx }: { days: number; onTx: (id: string) => void }) {
  const q = useQuery({ queryKey: ['fin-purchases', days], queryFn: () => finApi.purchases(days) });
  const p = q.data;
  if (!p) return <Loading error={q.error} />;
  const mode = p.mode === 'live' ? (['good', 'Pagamentos reais ligados'] as const) : p.mode === 'sandbox' ? (['warn', 'Só pagamentos de teste (sandbox)'] as const) : (['neutral', 'Compras desligadas'] as const);
  return (
    <div className="space-y-4">
      <Panel title="Fornecedor de pagamentos" right={<Status tone={mode[0]}>{mode[1]}</Status>}
        help={p.mode === 'live' ? undefined : 'M-Pesa, e-Mola e cartão entram quando houver as chaves do fornecedor. Até lá, as compras de teste creditam Txills fictícios.'}>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {p.providers.map((x) => (
            <li key={x.id} className="flex items-center justify-between rounded-xl px-3 py-2.5 ring-1 ring-zinc-200">
              <span className="font-medium">{x.label}</span>
              {x.enabled ? <Status tone={x.test ? 'warn' : 'good'}>{x.test ? 'teste' : 'ligado'}</Status> : <Status tone="neutral">desligado</Status>}
            </li>
          ))}
        </ul>
      </Panel>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label={`Compras pagas em ${days} dias`} value={fmt(p.paid.count)} icon="check-circle" hint={`${fmt(p.paid.txills)} Txills creditados`} />
        <Kpi label="Receita real" value={money(p.paid.revenueMinor)} icon="wallet" hint={p.paid.testMinor ? `mais ${money(p.paid.testMinor)} em pagamentos de teste` : 'Sem pagamentos de teste'} />
        <Kpi label="Pendentes" value={fmt(p.orders.pending)} icon="clock" tone={p.orders.pending > 0 ? 'warn' : 'neutral'} hint={`${fmt(p.orders.expired)} expiraram · ${fmt(p.orders.cancelled)} cancelados`} />
        <Kpi label="Falharam" value={fmt(p.orders.failed)} icon="alert" tone={p.orders.failed > 0 ? 'bad' : 'neutral'} />
      </div>
      <Panel title="Pacotes" help={`Vendas nos últimos ${days} dias.`} pad={false}>
        <Table label="Pacotes" head={[{ label: 'Pacote' }, { label: 'Txills', right: true }, { label: 'Preço', right: true }, { label: 'Vendidos', right: true }, { label: 'Txills vendidos', right: true }, { label: 'Estado' }]}>
          {p.packages.map((k) => (
            <tr key={k.id}>
              <td className={tdc}><b>{k.name}</b><span className="ml-2 text-xs text-zinc-500">{k.id}</span></td>
              <td className={tdn}>{fmt(k.txills)}</td>
              <td className={tdn}>{money(k.priceMinor, k.currency)}</td>
              <td className={tdn}>{fmt(k.sold)}</td>
              <td className={tdn}>{fmt(k.txillsSold)}</td>
              <td className={tdc}>{k.active ? <Status tone="good">à venda</Status> : <Status tone="neutral">retirado</Status>}</td>
            </tr>
          ))}
        </Table>
      </Panel>
      <Panel title="Últimos pedidos" pad={false}>
        <Table label="Pedidos" head={[{ label: 'Quando' }, { label: 'Quem' }, { label: 'Pacote' }, { label: 'Valor', right: true }, { label: 'Como' }, { label: 'Estado' }]}
          empty={p.recent.length === 0 ? <p className="px-5 py-10 text-center text-sm text-zinc-500">Ainda não há pedidos.</p> : null}>
          {p.recent.map((o) => {
            const [tone, label] = ORDER[o.status] ?? ['neutral', o.status];
            return (
              <tr key={o.id} className={o.ledgerTx ? 'cursor-pointer hover:bg-zinc-50' : ''} onClick={() => o.ledgerTx && onTx(o.ledgerTx)}>
                <td className={`${tdc} whitespace-nowrap text-xs text-zinc-500`}>{when(o.createdAt)}</td>
                <td className={tdc}>{o.username ? `@${o.username}` : '—'}</td>
                <td className={tdc}>{o.packageId} · {fmt(o.txills)} TXL</td>
                <td className={tdn}>{money(o.amountMinor, o.currency)}</td>
                <td className={tdc}>{o.provider === 'sandbox' ? 'teste' : o.provider}</td>
                <td className={tdc}><Status tone={tone}>{label}</Status></td>
              </tr>
            );
          })}
        </Table>
      </Panel>
    </div>
  );
}
