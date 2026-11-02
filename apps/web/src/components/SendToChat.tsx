import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type Post } from '../lib/api';
import { track } from '../lib/analytics';
import Icon from './Icon';
import { Avatar, Sheet, fieldInput } from './ui';

/** Escolher a quem enviar uma publicação ou reel no chat. Conversas recentes e pessoas que se procuram pelo nome; cada envio fica marcado. */
export default function SendToChat({ post, onClose, layer }: { post: Post; onClose: () => void; layer?: string }) {
  const [text, setText] = useState('');
  const [sent, setSent] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const recent = useQuery({ queryKey: ['chat-list'], queryFn: api.chatList, staleTime: 30_000 });
  const search = useQuery({ queryKey: ['mentionable', text.trim()], queryFn: () => api.mentionable(text.trim()), enabled: text.trim().length >= 1, staleTime: 30_000 });

  const rows: { username: string; displayName: string; hasAvatar: boolean }[] =
    text.trim().length >= 1
      ? (search.data ?? [])
      : (recent.data ?? []).map((c) => ({ username: c.username, displayName: c.displayName, hasAvatar: c.hasAvatar }));

  async function send(username: string) {
    if (sent.has(username) || busy) return;
    setBusy(username);
    setErr('');
    try {
      await api.chatSend(username, { kind: 'post', body: post.id });
      track('share', { where: 'chat', video: post.media[0]?.kind === 'video' });
      setSent((s) => new Set(s).add(username));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet title="Enviar a…" onClose={onClose} layer={layer}>
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Procurar pessoas" aria-label="Procurar pessoas" className={fieldInput} />
      {err && <p role="alert" className="mt-2 text-center text-sm text-red-600">{err}</p>}
      <ul className="mt-2">
        {rows.length === 0 && <li className="py-8 text-center text-zinc-600">{text.trim() ? 'Ninguém com esse nome' : 'Ainda não tens conversas. Procura alguém pelo nome.'}</li>}
        {rows.map((r) => {
          const done = sent.has(r.username);
          return (
            <li key={r.username}>
              <button onClick={() => send(r.username)} disabled={!!busy && busy !== r.username} className="flex min-h-14 w-full items-center gap-3 rounded-2xl px-1 text-left active:bg-zinc-100 disabled:opacity-50">
                <Avatar name={r.displayName} username={r.hasAvatar ? r.username : undefined} size={44} ring={false} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{r.displayName}</span>
                  <span className="block truncate text-sm text-zinc-500">@{r.username}</span>
                </span>
                <span className={`flex h-10 min-w-[5.5rem] items-center justify-center gap-1.5 rounded-full px-4 text-sm font-bold ${done ? 'bg-emerald-50 text-emerald-700' : 'bg-brand text-white'}`}>
                  {done ? <><Icon name="check" size={16} /> Enviado</> : busy === r.username ? '…' : 'Enviar'}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
