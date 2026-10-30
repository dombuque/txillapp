import Icon from './Icon';
import PullToRefresh from './PullToRefresh';
import { refreshPage } from '../lib/refresh';
import GenderGate from './GenderGate';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { BellIcon, HomeIcon, MessagesIcon, PlusIcon, SearchIcon, WalletIcon } from './icons';
import { Avatar, Wordmark } from './ui';

/** Áreas de toque de 48 px (acima dos 44 px recomendados), com ícones de tamanho moderado. */
const tab = ({ isActive }: { isActive: boolean }) =>
  `flex h-12 min-w-0 flex-1 items-center justify-center ${isActive ? 'text-zinc-900' : 'text-zinc-600'}`;

const Item = ({ to, label, children, end, onClick }: { to: string; label: string; children: (active: boolean) => ReactNode; end?: boolean; onClick?: (e: React.MouseEvent) => void }) => (
  <NavLink to={to} end={end} aria-label={label} className={tab} onClick={onClick}>
    {({ isActive }) => children(isActive)}
  </NavLink>
);

export default function Layout() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const qc = useQueryClient();
  /**
   * Tocar no separador onde já estás: sobe ao topo (1.º toque, se estiveres mais abaixo) e, no Início, atualiza o feed
   * (toque seguinte). Como no Instagram e no X.
   */
  const tapTab = (e: React.MouseEvent) => {
    const target = (e.currentTarget as HTMLAnchorElement).getAttribute('href');
    if (target !== pathname) return;
    e.preventDefault();
    if (window.scrollY > 120) return window.scrollTo({ top: 0, behavior: 'smooth' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (pathname === '/') void refreshPage(qc, pathname);
  };
  // Contador do sino: pergunta de tempos a tempos (e ao voltar à app).
  const unread = useQuery({ queryKey: ['unread'], queryFn: api.unreadCount, refetchInterval: 30_000, staleTime: 10_000 });
  const count = unread.data?.count ?? 0;
  const chats = useQuery({ queryKey: ['chat-unread'], queryFn: api.chatUnread, refetchInterval: 20_000, staleTime: 8_000 });
  const chatCount = chats.data?.conversations ?? 0;

  return (
    <div className="mx-auto min-h-dvh max-w-xl bg-white pb-24 lg:pb-8">
      <header className="sticky top-0 z-10 flex items-center justify-center bg-white/95 py-3 backdrop-blur lg:hidden">
        <NavLink to="/notifications" aria-label={count > 0 ? `Notificações (${count} por ler)` : 'Notificações'} className="absolute left-3 flex h-11 w-11 items-center justify-center text-zinc-900">
          <span className="relative">
            <BellIcon width={26} height={26} />
            {count > 0 && (
              <span className="absolute -right-2 -top-2 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand px-1 text-[11px] font-bold leading-none text-white">
                {count > 9 ? '9+' : count}
              </span>
            )}
          </span>
        </NavLink>
        <Wordmark className="h-8" />
        <NavLink to="/messages" aria-label={chatCount > 0 ? `Mensagens (${chatCount} por ler)` : 'Mensagens'} className="absolute right-3 flex h-11 w-11 items-center justify-center text-zinc-900">
          <span className="relative">
            <MessagesIcon width={26} height={26} />
            {chatCount > 0 && (
              <span className="absolute -right-2 -top-2 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand px-1 text-[11px] font-bold leading-none text-white">
                {chatCount > 9 ? '9+' : chatCount}
              </span>
            )}
          </span>
        </NavLink>
      </header>
      {/* Puxar para baixo recarrega a página (menos ao escrever uma publicação). */}
      {pathname === '/new' ? <Outlet /> : <PullToRefresh onRefresh={() => refreshPage(qc, pathname)}><Outlet /></PullToRefresh>}
      <GenderGate />
      <nav
        aria-label="Navegação principal"
        className="fixed bottom-0 left-1/2 z-20 w-full max-w-xl -translate-x-1/2 lg:hidden border-t border-zinc-100 bg-white pb-[max(0.35rem,env(safe-area-inset-bottom))] pt-1 shadow-[0_-6px_24px_rgba(0,0,0,0.05)]"
      >
        <div className="flex items-end justify-around px-1 min-[360px]:px-3">
          <Item to="/" label="Início" end onClick={tapTab}>{(a) => <HomeIcon filled={a} width={27} height={27} />}</Item>
          <Item to="/search" label="Pesquisar" onClick={tapTab}>{(a) => <SearchIcon width={27} height={27} strokeWidth={a ? 2.6 : 1.8} />}</Item>
          {/* Nova publicação: base alinhada com os outros ícones, mas mais alto: ultrapassa a linha da barra (~8 px) para cima. */}
          <NavLink
            to="/new"
            aria-label="Nova publicação"
            className={({ isActive }) => `-mt-3 flex h-[60px] w-14 shrink-0 items-center justify-center rounded-[18px] border-[2.5px] transition active:scale-90 ${isActive ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-700 bg-white text-zinc-700'}`}
          >
            <PlusIcon width={24} height={24} strokeWidth={2.6} />
          </NavLink>
          <Item to="/reels" label="Reels">{() => <Icon name="film" size={27} />}</Item>
          <Item to="/profile" label="Perfil" onClick={tapTab}>
            {(a) => (
              <span className={`rounded-full ${a ? 'ring-2 ring-zinc-900 ring-offset-1' : ''}`}>
                <Avatar name={user?.displayName ?? '?'} username={user?.username} size={28} ring={false} />
              </span>
            )}
          </Item>
        </div>
      </nav>
    </div>
  );
}
