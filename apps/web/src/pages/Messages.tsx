import { RowsSkeleton } from '../components/Loading';
import Icon from '../components/Icon';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Avatar, timeAgo } from '../components/ui';
import { api, type Conversation } from '../lib/api';

function preview(c: Conversation) {
  const m = c.lastMessage;
  if (m.kind === 'image') return `${m.fromMe ? 'Tu: ' : ''}${m.body || 'Foto'}`;
  if (m.kind === 'voice') return `${m.fromMe ? 'Tu: ' : ''}Mensagem de voz`;
  if (m.kind === 'story_reaction') return m.fromMe ? `Reagiste ao story ${m.body}` : `Reagiu ao teu story ${m.body}`;
  if (m.kind === 'story_reply') return `${m.fromMe ? 'Respondeste ao story' : 'Respondeu ao teu story'}: ${m.body}`;
  return `${m.fromMe ? 'Tu: ' : ''}${m.body}`;
}

/** Lista de conversas (as mensagens directas e as respostas aos stories). */
export default function Messages() {
  const q = useQuery({ queryKey: ['chat-list'], queryFn: api.chatList, refetchInterval: 60_000 });
  return (
    <section className="px-4 pb-28">
      <h1 className="px-1 pb-3 pt-1 text-2xl font-extrabold">Mensagens</h1>
      {q.isLoading && <RowsSkeleton />}
      {q.isSuccess && q.data.length === 0 && (
        <div className="mt-10 text-center">
          <p className="text-zinc-300" aria-hidden><Icon name="messages" size={44} className="mx-auto" /></p>
          <p className="mt-3 text-xl font-bold">Ainda sem cochichos</p>
          <p className="mx-auto mt-1 max-w-xs text-zinc-600">Abre o perfil de alguém e toca no envelope, ou responde a um story.</p>
        </div>
      )}
      <ul>
        {q.data?.map((c) => (
          <li key={c.username}>
            <Link to={`/messages/${c.username}`} className="flex items-center gap-3 rounded-2xl px-1 py-3 active:bg-zinc-100">
              <Avatar name={c.displayName} username={c.hasAvatar ? c.username : undefined} size={52} ring={false} />
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-[17px] ${c.unread ? 'font-extrabold' : 'font-semibold'}`}>{c.displayName}</span>
                <span className={`block truncate text-[15px] ${c.unread ? 'font-semibold text-zinc-900' : 'text-zinc-500'}`}>{preview(c)}</span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1.5">
                <span className="text-xs text-zinc-500">{timeAgo(c.lastMessage.at)}</span>
                {c.unread > 0 && (
                  <span aria-label={`${c.unread} por ler`} className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-xs font-bold text-white">{c.unread > 9 ? '9+' : c.unread}</span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
