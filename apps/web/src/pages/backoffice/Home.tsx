import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import Icon, { type IconName } from '../../components/Icon';
import { api } from '../../lib/api';
import { Card, PageHeader, ago, useCan, useStaff } from './bo';

/** Resumo: o que precisa de atenção, os números do dia e o que a equipa fez há pouco. */
export default function BackofficeHome() {
  const staff = useStaff();
  const canAudit = useCan('audit.read');
  const q = useQuery({ queryKey: ['bo-overview'], queryFn: api.boOverview, refetchInterval: 60_000 });
  const recent = useQuery({ queryKey: ['bo-audit-recent'], queryFn: () => api.boAudit('', ''), enabled: canAudit, staleTime: 30_000 });
  const d = q.data;

  const attention: { to: string; n: number | undefined; label: string; icon: IconName; perm: string }[] = [
    { to: '/backoffice/reports', n: d?.reports_open, label: 'queixas por decidir', icon: 'flag', perm: 'reports.read' },
    { to: '/backoffice/verifications', n: d?.verifications_pending, label: 'pedidos de selo', icon: 'shield', perm: 'verification.decide' },
    { to: '/backoffice/users?status=suspended', n: d?.suspended, label: 'contas suspensas', icon: 'lock', perm: 'users.view' },
    { to: '/backoffice/users', n: d?.unverified_old, label: 'sem email confirmado há mais de 1 dia', icon: 'mail', perm: 'users.view' },
  ];
  const kpi = (n: number | undefined, label: string, icon: IconName) => (
    <div className="rounded-2xl bg-white p-5 shadow-[0_1px_2px_rgba(15,18,25,0.06)] ring-1 ring-zinc-200/70">
      <div className="flex items-center justify-between text-zinc-400"><span className="text-[13px] font-semibold text-zinc-500">{label}</span><Icon name={icon} size={18} /></div>
      <p className="mt-2 text-[34px] font-extrabold leading-none tracking-tight tabular-nums">{n === undefined ? '…' : n.toLocaleString('pt-PT')}</p>
    </div>
  );

  return (
    <>
      <PageHeader title="Resumo" description={`Bom trabalho, ${staff?.teams.length ? 'equipa' : 'equipa'}. Isto é o que precisa de atenção agora.`} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {attention.filter((a) => staff?.permissions.includes(a.perm)).map((a) => (
          <Link key={a.label} to={a.to} className={`group rounded-2xl p-5 ring-1 transition hover:-translate-y-0.5 hover:shadow-md ${(a.n ?? 0) > 0 ? 'bg-brand/[0.06] ring-brand/30' : 'bg-white ring-zinc-200/70'}`}>
            <div className="flex items-center justify-between"><span className={`flex h-9 w-9 items-center justify-center rounded-lg ${(a.n ?? 0) > 0 ? 'bg-brand text-white' : 'bg-zinc-100 text-zinc-500'}`}><Icon name={a.icon} size={18} /></span><span className="text-zinc-300 transition group-hover:text-zinc-500" aria-hidden>→</span></div>
            <p className="mt-4 text-[34px] font-extrabold leading-none tracking-tight tabular-nums">{a.n ?? '…'}</p>
            <p className="mt-1 text-sm text-zinc-600">{a.label}</p>
          </Link>
        ))}
      </div>

      <h2 className="mb-3 mt-8 text-sm font-bold uppercase tracking-wide text-zinc-500">A app, em números</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        {kpi(d?.active_total, 'Contas ativas', 'users')}
        {kpi(d?.new_24h, 'Novas nas últimas 24 h', 'user-plus')}
        {kpi(d?.new_7d, 'Novas em 7 dias', 'trending')}
      </div>

      {canAudit && (
        <div className="mt-8">
          <Card title="Atividade recente da equipa" right={<Link to="/backoffice/audit" className="text-sm font-semibold text-zinc-500 hover:text-zinc-900">Ver tudo →</Link>}>
            {recent.isLoading && <p className="text-sm text-zinc-500">A carregar…</p>}
            <ul className="divide-y divide-zinc-100 text-sm">
              {(recent.data?.items ?? []).slice(0, 8).map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-2.5">
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
