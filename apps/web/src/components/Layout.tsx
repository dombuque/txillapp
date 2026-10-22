import type { ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { HomeIcon, PlaneIcon, PlusIcon, StarIcon, WalletIcon } from './icons';
import { Wordmark } from './ui';

const tab = ({ isActive }: { isActive: boolean }) =>
  `flex h-12 w-12 items-center justify-center ${isActive ? 'text-zinc-600' : 'text-zinc-500'}`;

const Item = ({ to, label, children, end }: { to: string; label: string; children: (active: boolean) => ReactNode; end?: boolean }) => (
  <NavLink to={to} end={end} aria-label={label} className={tab}>
    {({ isActive }) => children(isActive)}
  </NavLink>
);

export default function Layout() {
  const { user } = useAuth();
  const home = useLocation().pathname === '/';
  const bg = home ? 'bg-white' : 'bg-canvas';
  const headerBg = home ? 'bg-white/95' : 'bg-canvas/95';
  const initials = (user?.displayName ?? '?')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <div className={`mx-auto min-h-dvh max-w-xl ${bg} pb-32`}>
      <header className={`sticky top-0 z-10 flex items-center justify-center ${headerBg} py-4 backdrop-blur`}>
        <Wordmark className="h-8" />
        <NavLink to="/messages" aria-label="Mensagens" className="absolute right-5 text-zinc-800">
          <PlaneIcon width={28} height={28} />
        </NavLink>
      </header>
      <Outlet />
      <nav
        aria-label="Navegação principal"
        className="fixed bottom-0 left-1/2 z-20 w-full max-w-xl -translate-x-1/2 border-t border-zinc-100 bg-white pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-6px_24px_rgba(0,0,0,0.05)]"
      >
        <div className="relative flex items-center justify-around px-3">
          <Item to="/" label="Início" end>{(a) => <HomeIcon filled={a} width={34} height={34} />}</Item>
          <Item to="/favorites" label="Favoritos">{() => <StarIcon width={32} height={32} />}</Item>
          <span className="w-20" aria-hidden />
          <Item to="/wallet" label="Carteira">{() => <WalletIcon width={32} height={32} />}</Item>
          <Item to="/profile" label="Perfil">
            {() => (
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-rose-50 text-xs font-bold text-brand ring-2 ring-brand">
                {initials}
              </span>
            )}
          </Item>
          <NavLink
            to="/new"
            aria-label="Nova publicação"
            className="absolute -top-12 left-1/2 flex h-[76px] w-[76px] -translate-x-1/2 items-center justify-center rounded-[28px] bg-white shadow-[0_-4px_16px_rgba(0,0,0,0.08)]"
          >
            <span className="flex h-16 w-16 items-center justify-center rounded-2xl border-[5px] border-zinc-600 text-zinc-600">
              <PlusIcon />
            </span>
          </NavLink>
        </div>
      </nav>
    </div>
  );
}
