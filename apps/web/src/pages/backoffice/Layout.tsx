import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import Icon, { type IconName } from '../../components/Icon';
import { api, staffSession } from '../../lib/api';
import { Wordmark } from '../../components/ui';
import { Kbd, StaffContext, ago } from './bo';

interface Item { to: string; label: string; icon: IconName; perm?: string; end?: boolean; badge?: 'reports' | 'verifications' }
const GROUPS: { title: string; items: Item[] }[] = [
  { title: 'Operação', items: [
    { to: '/backoffice', label: 'Resumo', icon: 'home', end: true },
    { to: '/backoffice/reports', label: 'Queixas', icon: 'flag', perm: 'reports.read', badge: 'reports' },
    { to: '/backoffice/verifications', label: 'Pedidos de selo', icon: 'shield', perm: 'verification.decide', badge: 'verifications' },
    { to: '/backoffice/venues', label: 'Locais', icon: 'map-pin', perm: 'catalog.manage' },
  ] },
  { title: 'Pessoas', items: [
    { to: '/backoffice/users', label: 'Utilizadores', icon: 'user', perm: 'users.view' },
    { to: '/backoffice/team', label: 'Equipa', icon: 'users', perm: 'staff.manage' },
  ] },
  { title: 'Sistema', items: [
    { to: '/backoffice/audit', label: 'Auditoria', icon: 'file-text', perm: 'audit.read' },
    { to: '/backoffice/stats', label: 'Estatísticas', icon: 'trending', perm: 'stats.view' },
  ] },
  { title: 'Análises', items: [
    { to: '/backoffice/analises/coortes', label: 'Coortes e retenção', icon: 'repeat', perm: 'insights.view' },
    { to: '/backoffice/analises/envolvimento', label: 'Envolvimento', icon: 'flame', perm: 'insights.view' },
    { to: '/backoffice/analises/conteudo', label: 'Conteúdo e tendências', icon: 'sparkles', perm: 'insights.view' },
    { to: '/backoffice/analises/geografia', label: 'Geografia', icon: 'globe', perm: 'insights.view' },
    { to: '/backoffice/analises/locais', label: 'Locais', icon: 'store', perm: 'insights.view' },
    { to: '/backoffice/analises/geleira', label: 'Geleira', icon: 'snowflake', perm: 'insights.view' },
    { to: '/backoffice/analises/pesquisa', label: 'Pesquisa', icon: 'search', perm: 'insights.view' },
    { to: '/backoffice/analises/saude', label: 'Saúde da app', icon: 'bolt', perm: 'insights.view' },
  ] },
];

/** Procurar uma conta de qualquer sítio (Ctrl/Cmd + K). */
function Palette({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 200);
    return () => clearTimeout(t);
  }, [text]);
  const res = useQuery({ queryKey: ['bo-palette', q], queryFn: () => api.boUsers(q, ''), enabled: q.length >= 2, staleTime: 15_000 });
  const rows = res.data?.items.slice(0, 7) ?? [];
  const go = (id: string) => { onClose(); navigate(`/backoffice/users/${id}`); };
  return (
    <div role="dialog" aria-modal="true" aria-label="Procurar conta" data-swipe="off" className="fixed inset-0 z-50 flex items-start justify-center bg-zinc-950/50 p-4 pt-[14vh] backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/10" onClick={(e) => e.stopPropagation()}>
        <input ref={input} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); if (e.key === 'Enter' && rows[0]) go(rows[0].id); }} placeholder="Procurar conta por @, nome ou email…" aria-label="Procurar" className="h-14 w-full border-b border-zinc-200 px-5 text-base outline-none" />
        <ul className="max-h-80 overflow-y-auto p-2">
          {rows.map((u) => (
            <li key={u.id}>
              <button type="button" onClick={() => go(u.id)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-zinc-100">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-sm font-bold text-zinc-600">{u.username[0].toUpperCase()}</span>
                <span className="min-w-0 flex-1"><span className="block truncate font-semibold">@{u.username}</span><span className="block truncate text-xs text-zinc-500">{u.display_name} · {u.email}</span></span>
                <span className="text-xs text-zinc-400">{ago(u.last_seen)}</span>
              </button>
            </li>
          ))}
          {q.length >= 2 && res.isSuccess && rows.length === 0 && <li className="px-3 py-6 text-center text-sm text-zinc-500">Nada encontrado.</li>}
          {q.length < 2 && <li className="px-3 py-6 text-center text-sm text-zinc-500">Escreve pelo menos 2 letras. <Kbd>Enter</Kbd> abre o primeiro.</li>}
        </ul>
      </div>
    </div>
  );
}

/** Backoffice do Txillapp: barra lateral escura, menu por equipa e conteúdo largo, para computador. */
export default function BackofficeLayout() {
  const navigate = useNavigate();
  const [palette, setPalette] = useState(false);
  const who = useQuery({ queryKey: ['bo-who'], queryFn: api.staffMe, retry: false, staleTime: 5 * 60_000 });
  async function leave() {
    await api.staffLogout().catch(() => undefined);
    staffSession.clear();
    navigate('/backoffice/login', { replace: true });
  }
  const me = useQuery({ queryKey: ['bo-me'], queryFn: api.boMe, retry: false });
  const ov = useQuery({ queryKey: ['bo-overview'], queryFn: api.boOverview, retry: false, enabled: me.isSuccess, refetchInterval: 60_000 });
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(true); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  if (me.isLoading) return <div className="flex min-h-screen items-center justify-center bg-zinc-50 text-zinc-500">A abrir o backoffice…</div>;
  if (me.isError || !me.data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-6 text-center">
        <div>
          <p className="text-xl font-bold">Sem acesso</p>
          <p className="mt-1 text-zinc-600">Esta área é só para a equipa do Txillapp.</p>
          <Link to="/backoffice/login" onClick={() => staffSession.clear()} className="mt-4 inline-block rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white">Entrar com outra conta</Link>
        </div>
      </div>
    );
  }
  const staff = me.data;
  const badge = (b?: Item['badge']) => (b === 'reports' ? ov.data?.reports_open : b === 'verifications' ? ov.data?.verifications_pending : 0) || 0;
  const teamNames = staff.teams.map((t) => staff.catalog.find((c) => c.id === t)?.name ?? t);

  return (
    <StaffContext.Provider value={staff}>
      <div className="flex min-h-screen bg-[#f5f6f8] text-zinc-900 antialiased">
        <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col bg-[#0f1219] text-zinc-300">
          <div className="px-5 pb-4 pt-6">
            <Wordmark className="h-9 text-white" />
            <p className="mt-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">Backoffice</p>
          </div>
          <button type="button" onClick={() => setPalette(true)} className="mx-4 mb-3 flex h-9 items-center justify-between rounded-lg bg-white/[0.06] px-3 text-sm text-zinc-400 hover:bg-white/10">
            <span className="flex items-center gap-2"><Icon name="search" size={15} /> Procurar conta</span><span className="flex gap-1"><Kbd>Ctrl</Kbd><Kbd>K</Kbd></span>
          </button>
          <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4" aria-label="Backoffice">
            {GROUPS.map((g) => {
              const items = g.items.filter((i) => !i.perm || staff.permissions.includes(i.perm));
              if (!items.length) return null;
              return (
                <div key={g.title}>
                  <p className="px-3 pb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500">{g.title}</p>
                  {items.map((n) => (
                    <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `group flex items-center gap-3 rounded-lg px-3 py-2 text-[14.5px] font-semibold transition ${isActive ? 'bg-white/10 text-white' : 'text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100'}`}>
                      <Icon name={n.icon} size={18} />
                      <span className="flex-1">{n.label}</span>
                      {badge(n.badge) > 0 && <span className="rounded-full bg-brand px-2 py-0.5 text-[11px] font-bold text-white">{badge(n.badge)}</span>}
                    </NavLink>
                  ))}
                </div>
              );
            })}
          </nav>
          <div className="border-t border-white/10 p-4">
            <p className="truncate text-sm font-semibold text-white">{who.data?.name ?? 'Equipa'}</p>
            <p className="truncate text-xs text-zinc-500">{who.data?.email}</p>
            <p className="mt-0.5 text-xs text-zinc-500">{teamNames.join(' · ') || 'Equipa'}</p>
            <button type="button" onClick={() => void leave()} className="mt-2 inline-block text-xs text-zinc-400 underline hover:text-white">Sair da equipa</button>
          </div>
        </aside>
        <main className="min-w-0 flex-1 px-8 py-8">
          <div className="mx-auto max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
      {palette && <Palette onClose={() => setPalette(false)} />}
    </StaffContext.Provider>
  );
}
