import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { Card } from './bo';

/** Resumo: o que precisa de atenção hoje. */
export default function BackofficeHome() {
  const q = useQuery({ queryKey: ['bo-overview'], queryFn: api.boOverview, refetchInterval: 60_000 });
  const d = q.data;
  const tile = (to: string, n: number | undefined, label: string, warn = false) => (
    <Link to={to} className={`rounded-2xl border p-5 transition hover:shadow-md ${warn && (n ?? 0) > 0 ? 'border-brand/40 bg-brand/5' : 'border-zinc-200 bg-white'}`}>
      <p className="text-3xl font-extrabold tabular-nums">{n ?? '…'}</p>
      <p className="mt-1 text-sm text-zinc-600">{label}</p>
    </Link>
  );
  return (
    <>
      <h1 className="text-2xl font-extrabold">Resumo</h1>
      <p className="mt-1 text-zinc-600">O que precisa de atenção.</p>
      <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {tile('/backoffice/reports', d?.reports_open, 'queixas por decidir', true)}
        {tile('/admin/verifications', d?.verifications_pending, 'pedidos de selo', true)}
        {tile('/backoffice/users?status=suspended', d?.suspended, 'contas suspensas')}
        {tile('/backoffice/users', d?.unverified_old, 'sem email confirmado há mais de 1 dia')}
        {tile('/backoffice/users', d?.new_24h, 'contas novas nas últimas 24 h')}
        {tile('/backoffice/users', d?.new_7d, 'contas novas em 7 dias')}
        {tile('/backoffice/users', d?.active_total, 'contas ativas')}
        {tile('/backoffice/audit', d?.invites_blocked, 'convites sem prémio (suspeitos)')}
      </div>
      <div className="mt-6">
        <Card title="Atalhos">
          <ul className="space-y-1 text-sm">
            <li><Link to="/backoffice/users" className="font-semibold underline">Procurar uma conta</Link> por @, nome ou email: confirmar email, suspender, reativar e deixar notas.</li>
            <li><Link to="/backoffice/reports" className="font-semibold underline">Queixas</Link>: decidir com motivo e consultar o que já foi decidido.</li>
            <li><Link to="/backoffice/audit" className="font-semibold underline">Auditoria</Link>: quem fez o quê e quando.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
