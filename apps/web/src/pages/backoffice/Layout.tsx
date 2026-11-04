import { useQuery } from '@tanstack/react-query';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';

const NAV: { to: string; label: string; end?: boolean }[] = [
  { to: '/backoffice', label: 'Resumo', end: true },
  { to: '/backoffice/reports', label: 'Queixas' },
  { to: '/backoffice/users', label: 'Utilizadores' },
  { to: '/backoffice/audit', label: 'Auditoria' },
  { to: '/admin/verifications', label: 'Pedidos de selo' },
  { to: '/admin/stats', label: 'Estatísticas' },
];

/** Backoffice do Txillapp: barra lateral e conteúdo largo, para computador. Só entra quem é da moderação. */
export default function BackofficeLayout() {
  const { user } = useAuth();
  const ov = useQuery({ queryKey: ['bo-overview'], queryFn: api.boOverview, retry: false, refetchInterval: 60_000 });
  if (ov.isError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-6 text-center">
        <div>
          <p className="text-xl font-bold">Sem acesso</p>
          <p className="mt-1 text-zinc-600">Esta área é só para a equipa de moderação.</p>
          <Link to="/" className="mt-4 inline-block rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white">Voltar à app</Link>
        </div>
      </div>
    );
  }
  const badge = (to: string) => (to.endsWith('/reports') ? ov.data?.reports_open : to === '/admin/verifications' ? ov.data?.verifications_pending : 0) || 0;
  return (
    <div className="flex min-h-screen bg-zinc-50 text-zinc-900">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-zinc-200 bg-white p-4 md:flex">
        <p className="px-2 text-xl font-black tracking-tight">txillapp <span className="text-sm font-semibold text-brand">backoffice</span></p>
        <nav className="mt-6 flex flex-1 flex-col gap-1" aria-label="Backoffice">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `flex items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold ${isActive ? 'bg-zinc-900 text-white' : 'text-zinc-700 hover:bg-zinc-100'}`}>
              {n.label}
              {badge(n.to) > 0 && <span className="rounded-full bg-brand px-2 py-0.5 text-xs font-bold text-white">{badge(n.to)}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-zinc-200 pt-3 text-sm">
          <p className="truncate font-semibold">@{user?.username}</p>
          <Link to="/" className="text-zinc-500 underline">Voltar à app</Link>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-6 lg:p-8">
        <div className="mx-auto max-w-6xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
