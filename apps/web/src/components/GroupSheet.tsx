import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type GroupThread } from '../lib/api';
import { useAuth } from '../lib/auth';
import Icon from './Icon';
import NewChat from './NewChat';
import { Avatar, Sheet, fieldInput } from './ui';

/** Membros de um grupo: quem administra muda o nome, adiciona e tira pessoas; qualquer pessoa pode sair. */
export default function GroupSheet({ group, onClose, onChanged, onLeft }: { group: GroupThread['group']; onClose: () => void; onChanged: () => void; onLeft: () => void }) {
  const { user } = useAuth();
  const admin = group.myRole === 'admin';
  const [name, setName] = useState(group.name);
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState<null | 'leave'>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function run(job: () => Promise<unknown>, after?: () => void) {
    setBusy(true);
    setErr('');
    try {
      await job();
      after?.();
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (adding) return <NewChat onClose={() => setAdding(false)} addTo={{ groupId: group.id, have: group.members.map((m) => m.username), onAdded: onChanged }} />;

  if (confirm === 'leave') {
    return (
      <Sheet title="Sair do grupo?" onClose={() => setConfirm(null)}>
        <p className="mb-4 text-zinc-600">Deixas de receber as mensagens de “{group.name}”. Só voltas se alguém te adicionar.</p>
        <button disabled={busy} onClick={() => run(() => api.chatGroupRemove(group.id, user!.username), onLeft)} className="h-12 w-full rounded-full bg-red-700 font-bold text-white active:scale-[0.98] disabled:opacity-50">Sair do grupo</button>
        <button onClick={() => setConfirm(null)} className="mt-2 h-12 w-full rounded-full font-semibold text-zinc-700 active:bg-zinc-100">Ficar</button>
      </Sheet>
    );
  }

  return (
    <Sheet title={group.name} onClose={onClose}>
      {admin && (
        <div className="mb-3 flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} aria-label="Nome do grupo" className={fieldInput} />
          <button disabled={busy || !name.trim() || name.trim() === group.name} onClick={() => run(() => api.chatGroupRename(group.id, name.trim()))} className="h-12 shrink-0 rounded-full bg-brand px-5 font-bold text-white active:scale-95 disabled:opacity-40">Guardar</button>
        </div>
      )}
      {err && <p role="alert" className="mb-2 text-center text-sm text-red-600">{err}</p>}
      {admin && (
        <button onClick={() => setAdding(true)} className="flex min-h-14 w-full items-center gap-3 rounded-2xl px-1 text-left active:bg-zinc-100">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-rose-50 text-brand"><Icon name="user-plus" size={22} /></span>
          <span className="font-semibold">Adicionar pessoas</span>
        </button>
      )}
      <p className="px-1 pb-1 pt-3 text-xs font-bold uppercase tracking-wider text-zinc-500">{group.members.length} pessoas</p>
      <ul>
        {group.members.map((m) => (
          <li key={m.username} className="flex min-h-14 items-center gap-3 px-1">
            <Link to={`/u/${m.username}`} onClick={onClose} className="flex min-w-0 flex-1 items-center gap-3">
              <Avatar name={m.displayName} username={m.hasAvatar ? m.username : undefined} size={44} ring={false} />
              <span className="min-w-0">
                <span className="block truncate font-semibold">{m.displayName}{m.username === user?.username ? ' (tu)' : ''}</span>
                <span className="block truncate text-sm text-zinc-500">@{m.username}</span>
              </span>
            </Link>
            {m.role === 'admin' && <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-bold text-zinc-700">Admin</span>}
            {admin && m.username !== user?.username && (
              <button disabled={busy} onClick={() => run(() => api.chatGroupRemove(group.id, m.username))} aria-label={`Tirar ${m.displayName} do grupo`} className="flex h-10 w-10 items-center justify-center rounded-full text-red-600 active:bg-red-50"><Icon name="x" size={18} /></button>
            )}
          </li>
        ))}
      </ul>
      <button onClick={() => setConfirm('leave')} className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-full font-semibold text-red-700 active:bg-red-50"><Icon name="logout" size={18} /> Sair do grupo</button>
    </Sheet>
  );
}
