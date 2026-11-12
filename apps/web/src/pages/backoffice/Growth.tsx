import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader, useCan } from './bo';
import { finApi, type FinComeback } from './ui/fin-api';
import { Funnel, HBars, LineChart, Meter, SERIES, SplitBar } from './ui/fin-charts';
import { fmt, Kpi, Loading, Panel, PeriodPicker, pct, share, Status, Table, tdc, tdn } from './ui/fin-ui';

const PLATFORM: Record<string, string> = { android: 'Android', ios: 'iPhone', web: 'Site (app nova)', pwa: 'Site antigo instalado', browser: 'Site antigo no browser', desconhecida: 'Ainda não abriu a app' };
const METHOD: Record<string, string> = { email: 'Email e senha', google: 'Google', apple: 'Apple' };
const COMEBACK_KIND: Record<string, string> = { messages: 'Mensagens por ler', posts: 'Quem segue publicou', stories: 'Mimos novos', cheers: 'Brindes recebidos', generic: 'Texto simpático (sem novidades)' };
const CHANNEL: Record<string, string> = { push: 'Notificação (push)', email: 'E-mail' };

/** Crescimento (invites.view): convites, quem mais convida, orçamento dos prémios, série diária, funil de registo e fontes. */
export default function Growth() {
  const [days, setDays] = useState(30);
  const canUsers = useCan('users.view');
  const q = useQuery({ queryKey: ['bo-growth', days], queryFn: () => finApi.growth(days) });
  const cb = useQuery({ queryKey: ['bo-growth-comeback', days], queryFn: () => finApi.comeback(days) });
  const g = q.data;
  return (
    <>
      <PageHeader title="Crescimento" description="Quem entra, por onde, e como correm os convites (prémios, antifraude e orçamento do mês)." actions={<PeriodPicker value={days} onChange={setDays} />} />
      {!g ? <Loading error={q.error} /> : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label={`Entraram por convite (${days} dias)`} value={fmt(g.invites.joined)} icon="user-plus" hint={`${pct(g.invites.share)} das ${fmt(g.sources.total)} contas novas`} />
            <Kpi label="Ficaram ativas" value={fmt(g.invites.active)} icon="check-circle" hint={`${pct(share(g.invites.active, g.invites.joined))} · ${fmt(g.invites.waiting)} ainda à espera`} />
            <Kpi label="Premiadas" value={fmt(g.invites.paid)} icon="gift" hint={`${fmt(g.invites.holding)} com o prémio em espera (${g.rules.HOLD_DAYS} dias)`} />
            <Kpi label="Bloqueadas pela antifraude" value={fmt(g.invites.blocked)} icon="shield" tone={g.invites.joined && g.invites.blocked / g.invites.joined > 0.2 ? 'warn' : 'neutral'}
              hint={g.invites.blockedBy.length ? g.invites.blockedBy.map((b) => `${b.reason}: ${b.count}`).join(' · ') : 'Nenhuma'} />
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
            <Panel title="Por dia">
              <LineChart title="" height={260} days={g.series.map((s) => s.day)} series={[
                { label: 'Contas novas', values: g.series.map((s) => s.signups), color: SERIES[0] },
                { label: 'Por convite', values: g.series.map((s) => s.joined), color: SERIES[1] },
                { label: 'Ficaram ativas', values: g.series.map((s) => s.qualified), color: SERIES[2] },
              ]} />
            </Panel>
            <Panel title="Orçamento dos prémios (este mês)" help={`Teto de ${fmt(g.budget.monthly)} Txills por mês, para quem entra e quem convida (${g.rules.REWARD} cada).`}>
              <Meter label={`${fmt(g.budget.used)} de ${fmt(g.budget.monthly)} Txills`} value={g.budget.used} max={g.budget.monthly} hint={`${fmt(g.budget.rewards)} prémios pagos · faltam ${fmt(g.budget.left)} Txills`} />
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-zinc-100 pt-3 text-sm">
                <dt className="text-zinc-500">Prémios por dia</dt><dd className="text-right tabular-nums">{g.rules.PER_DAY} por pessoa</dd>
                <dt className="text-zinc-500">Teto por pessoa</dt><dd className="text-right tabular-nums">{g.rules.MAX_PAID} convites</dd>
                <dt className="text-zinc-500">Pode convidar com prémio</dt><dd className="text-right">conta com {g.rules.MIN_AGE_DAYS}+ dias</dd>
                <dt className="text-zinc-500">Mesma rede (24 h)</dt><dd className="text-right tabular-nums">a partir de {g.rules.SAME_NET_MAX}, sem prémio</dd>
              </dl>
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title={`Funil de registo (${days} dias)`} help="Das contas novas no período, quantas chegaram a cada passo.">
              <Funnel steps={[
                { label: 'Registaram-se', value: g.funnel.signed },
                { label: 'Confirmaram o email', value: g.funnel.verified },
                { label: 'Seguiram alguém', value: g.funnel.followed },
                { label: 'Publicaram', value: g.funnel.posted },
                { label: 'Ficaram ativas', value: g.funnel.active, help: `email + publicou ou segue ${g.rules.ACTIVE_FOLLOWS}` },
                { label: 'Voltaram noutro dia', value: g.funnel.returned },
              ]} />
            </Panel>
            <Panel title="Fontes de entrada" help={`${fmt(g.sources.total)} contas novas em ${days} dias.`}>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-500">Como chegaram</p>
              <SplitBar parts={[{ label: 'Por convite', value: g.sources.invite }, { label: 'Diretas (sem convite)', value: g.sources.direct }]} />
              <p className="mb-2 mt-5 text-xs font-bold uppercase tracking-wide text-zinc-500">Como se registaram</p>
              <HBars rows={g.sources.methods.map((m) => ({ key: m.id, label: METHOD[m.id] ?? m.id, value: m.count, hint: pct(share(m.count, g.sources.total)) }))} />
              <p className="mb-2 mt-5 text-xs font-bold uppercase tracking-wide text-zinc-500">Primeira plataforma</p>
              {g.sources.platforms.length === 0 ? <p className="text-sm text-zinc-500">Sem dados.</p> : (
                <HBars color={SERIES[2]} rows={g.sources.platforms.map((p) => ({ key: p.platform, label: PLATFORM[p.platform] ?? p.platform, value: p.count, hint: pct(share(p.count, g.sources.total)) }))} />
              )}
            </Panel>
          </div>

          <ComebackPanel data={cb.data} error={cb.error} days={days} />

          <Panel title="Quem mais convida" help={`Pessoas convidadas nos últimos ${days} dias.`} pad={false}>
            <Table label="Quem mais convida" head={[{ label: 'Pessoa' }, { label: 'Entraram', right: true }, { label: 'Ativas', right: true }, { label: 'Premiadas', right: true }, { label: 'Bloqueadas', right: true }, { label: 'Ganhou', right: true }]}
              empty={g.top.length === 0 ? <p className="px-5 py-10 text-center text-sm text-zinc-500">Ninguém entrou por convite neste período.</p> : null}>
              {g.top.map((t) => {
                const flagged = t.joined >= 3 && t.blocked / t.joined >= 0.5;
                return (
                  <tr key={t.id} className="hover:bg-zinc-50">
                    <td className={tdc}>
                      {canUsers ? <Link className="font-semibold hover:underline" to={`/backoffice/users/${t.id}`}>@{t.username}</Link> : <b>@{t.username}</b>}
                      <span className="block text-xs text-zinc-500">{t.displayName}</span>
                    </td>
                    <td className={`${tdn} font-semibold`}>{fmt(t.joined)}</td>
                    <td className={tdn}>{fmt(t.active)}</td>
                    <td className={tdn}>{fmt(t.paid)}</td>
                    <td className={tdn}>{t.blocked ? (flagged ? <Status tone="bad">{fmt(t.blocked)}</Status> : fmt(t.blocked)) : <span className="text-zinc-300">0</span>}</td>
                    <td className={tdn}>{fmt(t.earned)} TXL</td>
                  </tr>
                );
              })}
            </Table>
          </Panel>
        </div>
      )}
    </>
  );
}

/**
 * Lembretes de regresso (quem não abre a app há 3 dias ou mais): quantos saíram por dia, por etapa e por canal, e quantas
 * pessoas voltaram a abrir a app nas 48 h seguintes. Só números agregados: nunca quem os recebeu.
 */
function ComebackPanel({ data, error, days }: { data?: FinComeback; error?: unknown; days: number }) {
  if (!data) return <Panel title="Lembretes de regresso"><Loading error={error} /></Panel>;
  const t = data.totals;
  return (
    <Panel title={`Lembretes de regresso (${days} dias)`} help="A quem não abre o Txillapp há 3 dias ou mais: etapas aos 3, 7, 14, 30 e 60 dias, no máximo um por semana, só das 9h às 20h de Maputo. «Voltaram» = abriram a app nas 48 h seguintes.">
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi label="Lembretes enviados" value={fmt(t.sent)} icon="bell" hint={`a ${fmt(t.people)} pessoas`} />
        <Kpi label="Voltaram em 48 h" value={fmt(t.returned)} icon="repeat" hint={`${pct(share(t.returned, t.sent))} dos lembretes`} tone={t.sent >= 20 && t.returned / t.sent >= 0.1 ? 'good' : 'neutral'} />
        <Kpi label="Por e-mail" value={fmt(data.byChannel.find((c) => c.channel === 'email')?.sent ?? 0)} icon="mail" hint="só a quem não tem notificações que cheguem" />
      </div>
      <div className="mt-4">
        <LineChart title="" height={220} days={data.series.map((s) => s.day)} series={[
          { label: 'Notificação', values: data.series.map((s) => s.push), color: SERIES[0] },
          { label: 'E-mail', values: data.series.map((s) => s.email), color: SERIES[1] },
          { label: 'Voltaram em 48 h', values: data.series.map((s) => s.returned), color: SERIES[2] },
        ]} />
      </div>
      <div className="mt-5 grid gap-6 lg:grid-cols-3">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-500">Por etapa</p>
          <HBars rows={data.byStage.map((s) => ({ key: String(s.stage), label: `${s.stage}.ª · aos ${s.afterDays} dias`, value: s.sent, hint: `voltaram ${pct(share(s.returned, s.sent))}` }))} />
        </div>
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-500">Por canal</p>
          <HBars color={SERIES[1]} rows={data.byChannel.map((c) => ({ key: c.channel, label: CHANNEL[c.channel] ?? c.channel, value: c.sent, hint: `voltaram ${pct(share(c.returned, c.sent))}` }))} />
        </div>
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-500">Pelo que dizia</p>
          {data.byKind.length === 0 ? <p className="text-sm text-zinc-500">Nenhum lembrete neste período.</p> : (
            <HBars color={SERIES[2]} rows={data.byKind.map((k) => ({ key: k.kind, label: COMEBACK_KIND[k.kind] ?? k.kind, value: k.sent, hint: `voltaram ${pct(share(k.returned, k.sent))}` }))} />
          )}
        </div>
      </div>
    </Panel>
  );
}
