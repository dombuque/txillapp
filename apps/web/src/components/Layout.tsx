import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { BellIcon, HomeIcon, PlaneIcon, PlusIcon, SearchIcon, WalletIcon } from './icons';
import { Avatar, Wordmark } from './ui';

/** Áreas de toque de 48 px (acima dos 44 px recomendados), com ícones de tamanho moderado. */
const tab = ({ isActive }: { isActive: boolean }) =>
  `flex h-12 w-12 items-center justify-center ${isActive ? 'text-zinc-900' : 'text-zinc-600'}`;

const Item = ({ to, label, children, end }: { to: string; label: string; children: (active: boolean) => ReactNode; end?: boolean }) => (
  <NavLink to={to} end={end} aria-label={label} className={tab}>
    {({ isActive }) => children(isActive)}
  </NavLink>
);

export default function Layout() {
  const { user } = useAuth();
  // Contador do sino: pergunta de tempos a tempos (e ao voltar à app).
  const unread = useQuery({ queryKey: ['unread'], queryFn: api.unreadCount, refetchInterval: 30_000, staleTime: 10_000 });
  const count = unread.data?.count ?? 0;

  return (
    <div className="mx-auto min-h-dvh max-w-xl bg-white pb-24">
      <header className="sticky top-0 z-10 flex items-center justify-center bg-white/95 py-3 backdrop-blur">
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
        <NavLink to="/messages" aria-label="Mensagens" className="absolute right-3 flex h-11 w-11 items-center justify-center text-zinc-900">
          <PlaneIcon width={26} height={26} />
        </NavLink>
      </header>
      <Outlet />
      <nav
        aria-label="Navegação principal"
        className="fixed bottom-0 left-1/2 z-20 w-full max-w-xl -translate-x-1/2 border-t border-zinc-100 bg-white pb-[max(0.35rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-6px_24px_rgba(0,0,0,0.05)]"
      >
        <div className="flex items-center justify-around px-3">
          <Item to="/" label="Início" end>{(a) => <HomeIcon filled={a} width={27} height={27} />}</Item>
          <Item to="/search" label="Pesquisar">{(a) => <SearchIcon width={27} height={27} strokeWidth={a ? 2.6 : 1.8} />}</Item>
          {/* Nova publicação: na mesma linha dos outros ícones, só um pouco maior (não sobressai da barra). */}
          <NavLink
            to="/new"
            aria-label="Nova publicação"
            className={({ isActive }) => `flex h-12 w-12 items-center justify-center rounded-[14px] border-[2.5px] transition active:scale-90 ${isActive ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-700 text-zinc-700'}`}
          >
            <PlusIcon width={24} height={24} strokeWidth={2.6} />
          </NavLink>
          <Item to="/wallet" label="Carteira">{() => <WalletIcon width={27} height={27} />}</Item>
          <Item to="/profile" label="Perfil">
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
