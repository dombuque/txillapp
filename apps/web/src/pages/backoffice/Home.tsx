import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { IconName } from '../../components/Icon';
import { api } from '../../lib/api';
import { Card, PageHeader, ago, useCan, useStaff } from './bo';
import { finApi } from './ui/fin-api';
import { compact, fmt, Kpi, type Tone } from './ui/fin-ui';

interface Tile { key: string; show: boolean; label: string; value: number | undefined; hint?: string; icon: IconName; to: string; tone?: Tone }

/** Resumo: o que precisa de atenção, o dia de hoje e o que a equipa fez há pouco. Cada cartão só aparece a quem tem a permissão. */
export default function BackofficeHome() {
  const staff = useStaff();
  const can = (p: string) => !!staff?.permissions.includes(p);
  const canAudit = useCan('audit.read');
  const canWallet = useCan('wallet.view');
  const s = useQuery({ queryKey: ['bo-summary'], queryFn: finApi.summary, refetchInterval: 60_000 });
  const ov = useQuery({ queryKey: ['bo-overview'], queryFn: api.boOverview, refetchInterval: 60_000 });
  const alerts = useQuery({ queryKey: ['fin-alerts'], queryFn: finApi.alerts, enabled: canWallet, staleTime: 60_000 });
  const recent = useQuery({ queryKey: ['bo-audit-recent'], queryFn: () => api.boAudit('', ''), enabled: canAudit, staleTime: 30_000 });
  const d = s.data ?? {};
  const o = ov.data;
  const busy = (n: number | undefined): Tone => ((n ?? 0) > 0 ? 'warn' : 'neutral');
  const today = new Date().toISOString().slice(0, 10);
  const signupsTo = can('invites.view') ? '/backoffice/growth' : can('stats.view') ? '/backoffice/stats' : '/backoffice/users';
  const alertN = alerts.data?.items.length;

  const attention: Tile[] = [
    { key: 'reports', show: can('reports.read'), label: 'Queixas por tratar', value: d.reportsOpen, icon: 'flag', to: '/backoffice/reports', tone: busy(d.reportsOpen) },
    { key: 'verifications', show: can('verification.decide'), label: 'Verificações por decidir', value: d.verificationsPending, icon: 'shield', to: '/backoffice/verifications', tone: busy(d.verificationsPending) },
    { key: 'venues', show: can('catalog.manage'), label: 'Locais por aprovar', value: d.venuesPending, icon: 'map-pin', to: '/backoffice/venues', tone: busy(d.venuesPending) },
    { key: 'alerts', show: canWallet, label: 'Alertas de Txills', value: alertN, icon: 'alert', to: '/backoffice/finance', tone: alerts.data?.items.some((x) => x.level === 'critical') ? 'bad' : busy(alertN), hint: alertN ? 'Presentes fora do normal e outros' : 'Tudo normal' },
    { key: 'suspended', show: can('users.view'), label: 'Contas suspensas', value: o?.suspended, icon: 'lock', to: '/backoffice/users?status=suspended' },
  ];
  const now: Tile[] = [
    { key: 'dau', show: can('stats.view'), label: 'Ativos hoje (DAU)', value: d.dau, hint: d.wau !== undefined ? `${fmt(d.wau)} na semana (WAU) · ${fmt(d.mau)} no mês (MAU)` : undefined, icon: 'users', to: '/backoffice/stats' },
    { key: 'signups', show: can('stats.view') || can('users.view') || can('invites.view'), label: 'Registos hoje', value: d.signupsToday, hint: d.signupsYesterday !== undefined ? `${fmt(d.signupsYesterday)} ontem` : undefined, icon: 'user-plus', to: signupsTo },
    { key: 'invites', show: can('invites.view'), label: 'Entraram por convite hoje', value: d.invitesToday, icon: 'gift', to: '/backoffice/growth' },
    { key: 'boosts', show: canWallet || can('catalog.manage'), label: 'Campanhas Bombar ativas', value: d.boostsActive, icon: 'flame', to: canWallet ? '/backoffice/bombar' : '/backoffice/venues' },
    { key: 'txills', show: canWallet, label: 'Txills movimentados hoje', value: d.txillsToday, hint: d.movesToday !== undefined ? `${fmt(d.movesToday)} movimentos` : undefined, icon: 'wallet', to: `/backoffice/finance?tab=movimentos&from=${today}&to=${today}` },
  ];
  const tiles = (list: Tile[]) => list.filter((t) => t.show).map((t) => (
    <Kpi key={t.key} label={t.label} value={t.key === 'txills' ? compact(t.value) : fmt(t.value)} hint={t.hint} icon={t.icon} to={t.to} tone={t.tone} loading={t.value === undefined && (s.isLoading || ov.isLoading || alerts.isLoading)} />
  ));
  const attentionTiles = tiles(attention);
  const nowTiles = tiles(now);

  return (
    <>
      <PageHeader title="Resumo" description="O que precisa de atenção agora e como está a correr o dia." />

      {attentionTiles.length > 0 && (
        <>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-zinc-500">Precisa de atenção</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{attentionTiles}</div>
        </>
      )}

      {nowTiles.length > 0 && (
        <>
          <h2 className="mb-3 mt-8 text-sm font-bold uppercase tracking-wide text-zinc-500">Hoje</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{nowTiles}</div>
        </>
      )}

      <h2 className="mb-3 mt-8 text-sm font-bold uppercase tracking-wide text-zinc-500">A app, em números</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi label="Contas ativas" value={fmt(o?.active_total)} icon="users" loading={!o} />
        <Kpi label="Novas em 7 dias" value={fmt(o?.new_7d)} icon="trending" loading={!o} hint={o ? `${fmt(o.new_24h)} nas últimas 24 h` : undefined} />
        <Kpi label="Entraram por convite (7 dias)" value={fmt(o?.invites_7d)} icon="gift" loading={!o} hint={o?.invites_blocked ? `${fmt(o.invites_blocked)} bloqueados pela antifraude (sempre)` : undefined} />
      </div>

      {canAudit && (
        <div className="mt-8">
          <Card title="Atividade recente da equipa" right={<Link to="/backoffice/audit" className="text-sm font-semibold text-zinc-500 hover:text-zinc-900">Ver tudo →</Link>}>
            {recent.isLoading && <p className="text-sm text-zinc-500">A carregar…</p>}
            <ul className="divide-y divide-zinc-100 text-sm">
              {(recent.data?.items ?? []).slice(0, 8).map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2.5">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-zinc-300" aria-hidden />
                  <span className="font-mono text-xs text-zinc-600">{r.action}</span>
                  <span className="text-zinc-500">{r.actor ? `@${r.actor}` : ''}</span>
                  <span className="ml-auto text-xs text-zinc-400">{ago(r.created_at)}</span>
                </li>
              ))}
              {recent.isSuccess && recent.data.items.length === 0 && <li className="py-4 text-zinc-500">Ainda sem atividade.</li>}
            </ul>
          </Card>
        </div>
      )}
    </>
  );
}
