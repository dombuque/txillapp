import { RowsSkeleton } from '../components/Loading';
import Icon from '../components/Icon';
import NewChat from '../components/NewChat';
import NotesStrip from '../components/Notes';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Avatar, timeAgo } from '../components/ui';
import { api, type ChatMessage } from '../lib/api';

function what(m: { body: string; kind: ChatMessage['kind']; fromMe: boolean }, group = false) {
  const you = m.fromMe ? 'Tu: ' : '';
  if (m.kind === 'image') return `${you}${m.body || 'Foto'}`;
  if (m.kind === 'voice') return `${you}Mensagem de voz`;
  if (m.kind === 'post') return `${you}Partilhou uma publicação`;
  if (m.kind === 'gift') return `${m.fromMe ? 'Tu: ' : ''}Presente`;
  if (m.kind === 'sticker') return `${you}Sticker`;
  if (m.kind === 'location') return `${you}Localização`;
  if (m.kind === 'story_reaction') return m.fromMe ? `Reagiste ao story ${m.body}` : `Reagiu ao teu story ${m.body}`;
  if (m.kind === 'story_reply') return `${m.fromMe ? 'Respondeste ao story' : 'Respondeu ao teu story'}: ${m.body}`;
  return `${group ? '' : you}${m.body}`;
}

/** Linha única da lista: conversa direta ou grupo. */
interface Row {
  key: string;
  to: string;
  name: string;
  sub: string;
  at: string;
  unread: number;
  avatar: { names: { name: string; username?: string }[] };
  online: boolean;
  group: boolean;
}

/** Lista de conversas e grupos, com pesquisa (pelo nome ou pelo que foi dito) e um botão para começar uma conversa nova. */
export default function Messages() {
  const { user } = useAuth();
  const [view, setView] = useState<'all' | 'requests'>('all');
  const direct = useQuery({ queryKey: ['chat-list'], queryFn: api.chatList, refetchInterval: 60_000 });
  const groups = useQuery({ queryKey: ['chat-groups'], queryFn: api.chatGroups, refetchInterval: 60_000 });
  const [text, setText] = useState('');
  const [creating, setCreating] = useState(false);
  const term = text.trim().toLowerCase().replace(/^@/, '');
  const people = useQuery({ queryKey: ['mentionable', term], queryFn: () => api.mentionable(term), enabled: term.length >= 1, staleTime: 30_000 });

  const requestCount = (direct.data ?? []).filter((c) => c.request).length;
  const rows: Row[] = [
    ...(direct.data ?? []).filter((c) => (view === 'requests' ? c.request : !c.request)).map((c): Row => ({
      key: `d:${c.username}`,
      to: `/messages/${c.username}`,
      name: c.displayName,
      sub: what(c.lastMessage),
      at: c.lastMessage.at,
      unread: c.unread,
      avatar: { names: [{ name: c.displayName, username: c.hasAvatar ? c.username : undefined }] },
      online: !!c.presence?.online,
      group: false,
    })),
    ...(view === 'requests' ? [] : groups.data ?? []).map((g): Row => ({
      key: `g:${g.id}`,
      to: `/messages/g/${g.id}`,
      name: g.name,
      sub: g.lastMessage.empty ? `${g.members} pessoas` : `${g.lastMessage.fromMe ? '' : g.lastMessage.senderName ? `${g.lastMessage.senderName}: ` : ''}${what(g.lastMessage, true)}`,
      at: g.lastMessage.at,
      unread: g.unread,
      avatar: { names: g.preview.slice(0, 2).map((p) => ({ name: p.displayName, username: p.hasAvatar ? p.username : undefined })) },
      online: false,
      group: true,
    })),
  ]
    .filter((r) => !term || r.name.toLowerCase().includes(term) || r.sub.toLowerCase().includes(term))
    .sort((a, b) => +new Date(b.at) - +new Date(a.at));

  // Pessoas que ainda não têm conversa: a pesquisa deixa começar uma.
  const known = new Set((direct.data ?? []).map((c) => c.username.toLowerCase()));
  const strangers = term ? (people.data ?? []).filter((p) => !known.has(p.username.toLowerCase())) : [];
  const loading = direct.isLoading || groups.isLoading;

  return (
    <section className="px-4 pb-28">
      {/* O @ fica ao centro, como no Instagram; o ícone de nova mensagem à direita (tamanho inteiro, para ficar nítido). */}
      <header className="relative mb-1 flex h-12 items-center justify-center">
        <h1 className="max-w-[70%] truncate text-[20px] font-extrabold leading-tight">{user?.username ?? 'Mensagens'}</h1>
        <button onClick={() => setCreating(true)} aria-label="Nova conversa ou grupo" className="absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-zinc-900 active:bg-zinc-100"><Icon name="compose" size={24} strokeWidth={2} /></button>
      </header>
      <label className="mb-2 flex h-11 items-center gap-2 rounded-full bg-zinc-100 px-4 text-zinc-500 transition focus-within:bg-zinc-200/70">
        <Icon name="search" size={18} />
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Procurar pessoas e grupos" aria-label="Procurar conversas" className="min-w-0 flex-1 bg-transparent text-[16px] text-zinc-900 outline-none placeholder:text-zinc-500" />
        {text && <button onClick={() => setText('')} aria-label="Limpar" className="flex h-8 w-8 items-center justify-center"><Icon name="x" size={16} /></button>}
      </label>

      {!term && view === 'all' && <NotesStrip />}
      <div role="tablist" aria-label="Caixa" className="mb-1 flex items-center gap-5 px-1 pt-1">
        <button role="tab" aria-selected={view === 'all'} onClick={() => setView('all')} className={`h-10 text-[17px] ${view === 'all' ? 'font-extrabold text-zinc-900' : 'font-semibold text-zinc-500'}`}>Mensagens</button>
        <button role="tab" aria-selected={view === 'requests'} onClick={() => setView('requests')} className={`flex h-10 items-center gap-1.5 text-[17px] ${view === 'requests' ? 'font-extrabold text-zinc-900' : 'font-semibold text-zinc-500'}`}>
          Pedidos {requestCount > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-xs font-bold text-white">{requestCount}</span>}
        </button>
      </div>
      {view === 'requests' && <p className="px-1 pb-2 text-[13px] leading-snug text-zinc-500">Mensagens de quem não segues. Só passam para a caixa normal se aceitares. Quem recusas não é avisado.</p>}

      {loading && <RowsSkeleton />}
      {!loading && rows.length === 0 && strangers.length === 0 && (
        <div className="mt-10 text-center">
          <p className="text-zinc-300" aria-hidden><Icon name="messages" size={44} className="mx-auto" /></p>
          <p className="mt-3 text-xl font-bold">{term ? 'Nada com esse nome' : view === 'requests' ? 'Sem pedidos' : 'Ainda sem cochichos'}</p>
          <p className="mx-auto mt-1 max-w-xs text-zinc-600">{term ? 'Tenta outro nome ou começa uma conversa nova.' : view === 'requests' ? 'Quando alguém que não segues te escrever, aparece aqui.' : 'Toca no ícone no canto para falar com alguém ou criar um grupo.'}</p>
          {!term && view === 'all' && <button onClick={() => setCreating(true)} className="mt-4 h-11 rounded-full bg-brand px-6 font-bold text-white active:scale-95">Nova conversa</button>}
        </div>
      )}
      <ul>
        {rows.map((r) => (
          <li key={r.key}>
            <Link to={r.to} className="flex items-center gap-3 rounded-2xl px-1 py-3 active:bg-zinc-100">
              <span className="relative shrink-0">
                {r.group ? (
                  <span className="relative block h-[52px] w-[52px]">
                    {r.avatar.names.slice(0, 2).map((a, i) => (
                      <span key={i} className={`absolute rounded-full ring-2 ring-white ${i === 0 ? 'left-0 top-0' : 'bottom-0 right-0'}`}><Avatar name={a.name} username={a.username} size={32} ring={false} /></span>
                    ))}
                    {r.avatar.names.length === 0 && <span className="flex h-full w-full items-center justify-center rounded-full bg-zinc-100 text-zinc-600"><Icon name="users" size={24} /></span>}
                  </span>
                ) : (
                  <Avatar name={r.avatar.names[0].name} username={r.avatar.names[0].username} size={52} ring={false} />
                )}
                {r.online && <span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-white bg-emerald-500" aria-label="Online" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`flex items-center gap-1.5 text-[17px] ${r.unread ? 'font-extrabold' : 'font-semibold'}`}>
                  <span className="truncate">{r.name}</span>
                  {r.group && <Icon name="users" size={14} className="shrink-0 text-zinc-400" aria-label="Grupo" />}
                </span>
                <span className={`block truncate text-[15px] ${r.unread ? 'font-semibold text-zinc-900' : 'text-zinc-500'}`}>{r.sub}</span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1.5">
                <span className="text-xs text-zinc-500">{timeAgo(r.at)}</span>
                {r.unread > 0 && <span aria-label={`${r.unread} por ler`} className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-xs font-bold text-white">{r.unread > 9 ? '9+' : r.unread}</span>}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {strangers.length > 0 && (
        <>
          <p className="px-1 pb-1 pt-4 text-xs font-bold uppercase tracking-wider text-zinc-500">Outras pessoas</p>
          <ul>
            {strangers.map((p) => (
              <li key={p.username}>
                <Link to={`/messages/${p.username}`} className="flex items-center gap-3 rounded-2xl px-1 py-2.5 active:bg-zinc-100">
                  <Avatar name={p.displayName} username={p.hasAvatar ? p.username : undefined} size={46} ring={false} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{p.displayName}</span>
                    <span className="block truncate text-sm text-zinc-500">@{p.username}</span>
                  </span>
                  <span className="rounded-full bg-zinc-100 px-4 py-1.5 text-sm font-bold">Conversar</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      {creating && <NewChat onClose={() => setCreating(false)} />}
    </section>
  );
}
