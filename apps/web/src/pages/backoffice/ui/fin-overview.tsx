import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import Icon from '../../../components/Icon';
import { finApi, LEDGER_LABEL, type FinAlert } from './fin-api';
import { LineChart, SERIES, SplitBar } from './fin-charts';
import { compact, fmt, Kpi, Loading, Panel, Status, Table, tdc, tdn, Txl } from './fin-ui';

const LEVEL: Record<FinAlert['level'], ['bad' | 'warn' | 'info', string]> = { critical: ['bad', 'Grave'], warning: ['warn', 'Atenção'], info: ['info', 'Info'] };

/** Os alertas simples (livro, presentes fora do normal, compras presas). */
export function AlertsPanel({ onAccount }: { onAccount: (q: string) => void }) {
  const q = useQuery({ queryKey: ['fin-alerts'], queryFn: finApi.alerts, staleTime: 60_000 });
  const a = q.data;
  return (
    <Panel title="Alertas" help={a ? `Presentes dos últimos ${a.rules.DAYS} dias: o normal (mediana) é ${fmt(a.medianReceived)} Txills por pessoa, em ${fmt(a.receivers)} pessoas que receberam.` : undefined}
      right={a && <Status tone={a.items.some((x) => x.level === 'critical') ? 'bad' : a.items.length ? 'warn' : 'good'}>{a.items.length ? `${a.items.length} por ver` : 'Tudo normal'}</Status>}>
      {!a && <Loading error={q.error} />}
      {a && a.items.length === 0 && <p className="text-sm text-zinc-500">Sem nada fora do normal. O livro bate certo.</p>}
      {a && a.items.length > 0 && (
        <ul className="divide-y divide-zinc-100">
          {a.items.map((x) => {
            const [tone, label] = LEVEL[x.level];
            return (
              <li key={x.id} className="flex flex-col items-start gap-2 py-3 sm:flex-row sm:gap-3">
                <Status tone={tone}>{label}</Status>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-zinc-900">{x.title}</p>
                  <p className="text-sm text-zinc-600">{x.detail}</p>
                </div>
                {x.account && (
                  <div className="flex gap-3 text-sm">
                    <button type="button" className="font-semibold text-zinc-700 underline" onClick={() => onAccount(`@${x.account!.username}`)}>Movimentos</button>
                    <Link className="font-semibold text-zinc-700 underline" to={`/backoffice/users/${x.account.userId}`}>Conta</Link>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/** Txills em circulação, emitidos e resgatados, por tipo e por dia. */
export function FinOverviewPanel({ days, onAccount, onType }: { days: number; onAccount: (q: string) => void; onType: (t: string) => void }) {
  const q = useQuery({ queryKey: ['fin-overview', days], queryFn: () => finApi.overview(days) });
  const o = q.data;
  if (!o) return <Loading error={q.error} />;
  const c = o.circulation;
  const dd = o.series.map((s) => s.day);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Txills em circulação" value={compact(c.total)} icon="wallet" tone={c.balanced ? 'neutral' : 'bad'}
          hint={c.balanced ? <>Emitidos {compact(c.issuedEver)} − resgatados {compact(c.redeemedEver)}</> : 'O livro não bate certo: vê os alertas'} />
        <Kpi label={`Emitidos em ${days} dias`} value={compact(o.period.issued)} icon="sparkles" hint="Bónus, convites, compras e devoluções do Bombar" />
        <Kpi label={`Resgatados pelo Bombar em ${days} dias`} value={compact(o.period.redeemed)} icon="flame" hint="Voltaram à emissão" />
        <Kpi label={`Movimentos em ${days} dias`} value={fmt(o.period.count)} icon="repeat" hint={<>Volume <Txl v={o.period.volume} /></>} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Panel title="Emitidos e resgatados por dia">
          <LineChart title="" height={300} days={dd} series={[{ label: 'Emitidos', values: o.series.map((s) => s.issued), color: SERIES[0] }, { label: 'Resgatados', values: o.series.map((s) => s.redeemed), color: SERIES[1] }]} />
        </Panel>
        <Panel title="Onde estão agora" help="Saldos de todas as contas, menos a emissão.">
          <SplitBar parts={[{ label: `Pessoas (${fmt(c.wallets.users)} carteiras)`, value: c.users }, { label: `Locais (${fmt(c.wallets.venues)})`, value: c.venues }, { label: `Cofres de grupo (${fmt(c.wallets.groups)})`, value: c.groups }]} />
          <div className="mt-4 border-t border-zinc-100 pt-3">
            <LineChart title="Volume movimentado" days={dd} height={140} area series={[{ label: 'Volume', values: o.series.map((s) => s.volume), color: SERIES[0] }]} />
          </div>
        </Panel>
      </div>

      <Panel title={`Por tipo de movimento (${days} dias)`} help="Volume: o que passou de conta para conta. Emitidos: criados pela emissão. Resgatados: devolvidos à emissão." pad={false}>
        <Table label="Por tipo" head={[{ label: 'Tipo' }, { label: 'Movimentos', right: true }, { label: 'Volume', right: true }, { label: 'Emitidos', right: true }, { label: 'Resgatados', right: true }]}>
          {o.byType.map((t) => {
            const max = Math.max(1, ...o.byType.map((x) => x.volume));
            return (
              <tr key={t.type} className="hover:bg-zinc-50">
                <td className={tdc}>
                  <button type="button" className="text-left font-medium hover:underline" onClick={() => onType(t.type)}>{LEDGER_LABEL[t.type] ?? t.type}</button>
                  <div className="mt-1 h-1.5 max-w-[180px] rounded-full bg-zinc-100"><div className="h-full rounded-full" style={{ width: `${(t.volume / max) * 100}%`, minWidth: t.volume ? 3 : 0, background: SERIES[0] }} /></div>
                </td>
                <td className={tdn}>{fmt(t.count)}</td>
                <td className={tdn}>{fmt(t.volume)}</td>
                <td className={tdn}>{t.issued ? fmt(t.issued) : <span className="text-zinc-300">—</span>}</td>
                <td className={tdn}>{t.redeemed ? fmt(t.redeemed) : <span className="text-zinc-300">—</span>}</td>
              </tr>
            );
          })}
          <tr className="bg-zinc-50 font-bold">
            <td className={tdc}>Total</td><td className={tdn}>{fmt(o.period.count)}</td><td className={tdn}>{fmt(o.period.volume)}</td><td className={tdn}>{fmt(o.period.issued)}</td><td className={tdn}>{fmt(o.period.redeemed)}</td>
          </tr>
        </Table>
      </Panel>

      <AlertsPanel onAccount={onAccount} />
      <p className="flex items-center gap-1.5 text-xs text-zinc-500"><Icon name="info" size={14} /> Os Txills são fictícios nesta fase. Os dias contam em UTC.</p>
    </div>
  );
}
