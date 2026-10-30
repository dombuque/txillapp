import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useDesktop } from '../lib/useDesktop';
import Icon from './Icon';
import { BellIcon, HomeIcon, MessagesIcon, PlusIcon, SearchIcon, WalletIcon } from './icons';
import Suggestions from './Suggestions';
import { Avatar, Wordmark } from './ui';

const link = ({ isActive }: { isActive: boolean }) =>
  `group flex items-center gap-4 rounded-full px-3 py-3 text-[19px] transition hover:bg-zinc-100 xl:pr-6 ${isActive ? 'font-extrabold text-zinc-900' : 'font-medium text-zinc-700'}`;

function Badge({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span className="absolute -right-2 -top-2 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand px-1 text-[11px] font-bold leading-none text-white">
      {n > 9 ? '9+' : n}
    </span>
  );
}

function Item({ to, label, end, badge, children }: { to: string; label: string; end?: boolean; badge?: number; children: (active: boolean) => ReactNode }) {
  return (
    <NavLink to={to} end={end} aria-label={label} className={link}>
      {({ isActive }) => (
        <>
          <span className="relative flex h-7 w-7 shrink-0 items-center justify-center">
            {children(isActive)}
            <Badge n={badge ?? 0} />
          </span>
          <span className="hidden xl:inline">{label}</span>
        </>
      )}
    </NavLink>
  );
}

/** Menu à esquerda: fica fixo enquanto o conteúdo rola. Só ícones em ecrãs médios, com texto em ecrãs largos. */
function LeftNav() {
  const { user } = useAuth();
  const unread = useQuery({ queryKey: ['unread'], queryFn: api.unreadCount, refetchInterval: 30_000, staleTime: 10_000 });
  const chats = useQuery({ queryKey: ['chat-unread'], queryFn: api.chatUnread, refetchInterval: 20_000, staleTime: 8_000 });
  return (
    <nav aria-label="Navegação principal" className="sticky top-0 flex h-dvh flex-col items-end justify-between py-3 pr-3 xl:pr-8">
      <div className="flex flex-col items-end gap-1 xl:items-stretch">
        <Link to="/" aria-label="Início" className="mb-3 flex h-12 items-center px-3 text-zinc-900">
          <Wordmark className="h-7" />
        </Link>
        <Item to="/" end label="Início">{(a) => <HomeIcon filled={a} width={27} height={27} />}</Item>
        <Item to="/search" label="Pesquisar">{(a) => <SearchIcon width={27} height={27} strokeWidth={a ? 2.6 : 1.8} />}</Item>
        <Item to="/reels" label="Reels">{() => <Icon name="film" size={27} />}</Item>
        <Item to="/messages" label="Mensagens" badge={chats.data?.conversations}>{() => <MessagesIcon width={27} height={27} />}</Item>
        <Item to="/notifications" label="Notificações" badge={unread.data?.count}>{() => <BellIcon width={27} height={27} />}</Item>
        <Item to="/wallet" label="Carteira">{() => <WalletIcon width={27} height={27} />}</Item>
        <Item to="/profile" label="Perfil">
          {() => <Avatar name={user?.displayName ?? '?'} username={user?.username} size={28} ring={false} />}
        </Item>
        <Item to="/settings" label="Definições">{() => <Icon name="shield" size={27} />}</Item>
        <Link
          to="/new"
          aria-label="Nova publicação"
          className="mt-3 flex h-12 items-center justify-center gap-2 self-end rounded-full bg-brand px-4 font-bold text-white transition hover:brightness-110 active:scale-95 xl:self-stretch"
        >
          <PlusIcon width={22} height={22} strokeWidth={2.6} />
          <span className="hidden xl:inline">Publicar</span>
        </Link>
      </div>
      {user && (
        <Link to="/profile" className="flex items-center gap-3 rounded-full p-2 transition hover:bg-zinc-100 xl:w-full">
          <Avatar name={user.displayName} username={user.username} size={40} ring={false} />
          <span className="hidden min-w-0 xl:block">
            <span className="block truncate font-bold leading-tight">{user.displayName}</span>
            <span className="block truncate text-sm text-zinc-500">@{user.username}</span>
          </span>
        </Link>
      )}
    </nav>
  );
}

/** Painel da direita (ecrãs largos): pesquisa rápida, pessoas para seguir, assuntos do momento e ligações legais. */
function RightPanel() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const trending = useQuery({ queryKey: ['trending'], queryFn: api.trending, staleTime: 60_000 });
  const tags = trending.data?.tags.slice(0, 6) ?? [];
  const go = (e: FormEvent) => {
    e.preventDefault();
    if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`);
  };
  return (
    <aside aria-label="Descobrir" className="sticky top-0 hidden h-dvh w-[320px] flex-col gap-4 overflow-y-auto py-3 pl-8 [scrollbar-width:none] xl:flex [&::-webkit-scrollbar]:hidden">
      <form onSubmit={go} role="search">
        <label className="flex h-12 items-center gap-3 rounded-full bg-zinc-100 px-4 text-zinc-500 focus-within:ring-2 focus-within:ring-brand">
          <SearchIcon width={20} height={20} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Pesquisar no Txillapp"
            aria-label="Pesquisar"
            className="min-w-0 flex-1 bg-transparent text-[16px] text-zinc-900 outline-none placeholder:text-zinc-500"
          />
        </label>
      </form>
      <Suggestions compact />
      {tags.length > 0 && (
        <section aria-label="Assuntos do momento" className="rounded-[28px] bg-zinc-50 py-4">
          <h2 className="px-5 text-lg font-bold">O que está a bombar</h2>
          <ul className="mt-2">
            {tags.map((t) => (
              <li key={t.tag}>
                <Link to={`/tag/${encodeURIComponent(t.tag)}`} className="block px-5 py-2 transition hover:bg-zinc-100">
                  <span className="block font-semibold">#{t.tag}</span>
                  <span className="text-sm text-zinc-500">{t.rising ? 'A subir agora' : `${t.authors} pessoas a falar disto`}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="px-3 text-xs leading-5 text-zinc-500">
        <Link to="/terms" className="hover:underline">Termos</Link> · <Link to="/privacy" className="hover:underline">Privacidade</Link> ·{' '}
        <a href="mailto:suporte@txillapp.com" className="hover:underline">Suporte</a> · © Txillapp
      </p>
    </aside>
  );
}

/**
 * Casca da app em computador: menu | coluna central | painel. As duas laterais têm a mesma largura, por isso a coluna central
 * fica sempre ao meio do ecrã (as páginas em ecrã inteiro, como o chat e os reels, alinham com ela).
 * No telemóvel não faz nada: só entrega a página.
 */
export default function DesktopShell() {
  const desktop = useDesktop();
  if (!desktop) return <Outlet />;
  return (
    <div className="grid min-h-dvh grid-cols-[minmax(0,1fr)_minmax(0,36rem)_minmax(0,1fr)] bg-white">
      <div className="flex justify-end"><LeftNav /></div>
      <main className="min-w-0 border-x border-zinc-100">
        <Outlet />
      </main>
      <div className="flex justify-start"><RightPanel /></div>
    </div>
  );
}
