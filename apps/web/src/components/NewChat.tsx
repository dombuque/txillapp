import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import Icon from './Icon';
import { Avatar, Sheet, fieldInput } from './ui';

interface Person { username: string; displayName: string; hasAvatar: boolean }

/**
 * Nova conversa: procura uma pessoa e conversa, ou escolhe duas ou mais para criar um grupo (com nome).
 * As pessoas escolhidas ficam em cima, como etiquetas que se podem tirar.
 */
export default function NewChat({ onClose, addTo }: { onClose: () => void; addTo?: { groupId: string; have: string[]; onAdded: () => void } }) {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<Person[]>([]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const recent = useQuery({ queryKey: ['chat-list'], queryFn: api.chatList, staleTime: 30_000 });
  const search = useQuery({ queryKey: ['mentionable', text.trim()], queryFn: () => api.mentionable(text.trim()), enabled: text.trim().length >= 1, staleTime: 30_000 });
  const have = new Set((addTo?.have ?? []).map((u) => u.toLowerCase()));

  const rows: Person[] = (text.trim() ? (search.data ?? []) : (recent.data ?? []).map((c) => ({ username: c.username, displayName: c.displayName, hasAvatar: c.hasAvatar }))).filter((p) => !have.has(p.username.toLowerCase()));
  const isPicked = (u: string) => picked.some((p) => p.username === u);
  const toggle = (p: Person) => setPicked((l) => (isPicked(p.username) ? l.filter((x) => x.username !== p.username) : [...l, p]));

  async function go() {
    setErr('');
    if (addTo) {
      setBusy(true);
      try {
        await api.chatGroupAdd(addTo.groupId, picked.map((p) => p.username));
        addTo.onAdded();
        onClose();
      } catch (e) {
        setErr((e as Error).message);
        setBusy(false);
      }
      return;
    }
    if (picked.length === 1) {
      onClose();
      return navigate(`/messages/${picked[0].username}`);
    }
    if (!naming) return setNaming(true);
    if (!name.trim()) return setErr('Dá um nome ao grupo');
    setBusy(true);
    try {
      const r = await api.chatGroupCreate(name.trim(), picked.map((p) => p.username));
      onClose();
      navigate(`/messages/g/${r.id}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  const label = addTo ? `Adicionar ${picked.length || ''}`.trim() : picked.length === 1 ? 'Conversar' : picked.length > 1 ? (naming ? 'Criar grupo' : 'Seguinte') : 'Escolhe pessoas';

  return (
    <Sheet title={addTo ? 'Adicionar ao grupo' : naming ? 'Nome do grupo' : 'Nova conversa'} onClose={onClose}>
      {naming ? (
        <>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus placeholder="Ex.: Malta da Polana" aria-label="Nome do grupo" className={fieldInput} />
          <p className="mt-2 text-sm text-zinc-600">{picked.length + 1} pessoas: {picked.map((p) => p.displayName.split(' ')[0]).join(', ')} e tu.</p>
        </>
      ) : (
        <>
          {picked.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {picked.map((p) => (
                <button key={p.username} type="button" onClick={() => toggle(p)} aria-label={`Tirar ${p.displayName}`} className="flex h-9 items-center gap-1.5 rounded-full bg-rose-50 pl-3 pr-2 text-sm font-semibold text-brand active:scale-95">
                  {p.displayName.split(' ')[0]} <Icon name="x" size={14} />
                </button>
              ))}
            </div>
          )}
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={addTo ? 'Procurar pessoas' : 'Procura uma pessoa para conversar'} aria-label="Procurar pessoas" className={fieldInput} />
          <ul className="mt-2">
            {!text.trim() && rows.length > 0 && <li className="px-1 pb-1 pt-2 text-xs font-bold uppercase tracking-wider text-zinc-500">Recentes</li>}
            {rows.length === 0 && <li className="py-8 text-center text-zinc-600">{text.trim() ? 'Ninguém com esse nome' : 'Procura pelo nome ou @.'}</li>}
            {rows.map((p) => {
              const on = isPicked(p.username);
              return (
                <li key={p.username}>
                  <button type="button" onClick={() => toggle(p)} aria-pressed={on} className="flex min-h-14 w-full items-center gap-3 rounded-2xl px-1 text-left active:bg-zinc-100">
                    <Avatar name={p.displayName} username={p.hasAvatar ? p.username : undefined} size={44} ring={false} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{p.displayName}</span>
                      <span className="block truncate text-sm text-zinc-500">@{p.username}</span>
                    </span>
                    <span className={`flex h-7 w-7 items-center justify-center rounded-full border-2 ${on ? 'border-brand bg-brand text-white' : 'border-zinc-300'}`} aria-hidden>{on && <Icon name="check" size={16} strokeWidth={3} />}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {err && <p role="alert" className="mt-2 text-center text-sm text-red-600">{err}</p>}
      <div className="mt-3 flex gap-2">
        {naming && <button type="button" onClick={() => setNaming(false)} className="h-12 rounded-full px-5 font-semibold text-zinc-700 active:bg-zinc-100">Voltar</button>}
        <button type="button" onClick={go} disabled={busy || picked.length === 0} className="h-12 flex-1 rounded-full bg-brand font-bold text-white transition active:scale-[0.98] disabled:opacity-40">{busy ? 'A criar…' : label}</button>
      </div>
      {!addTo && !naming && picked.length === 1 && <p className="mt-2 text-center text-xs text-zinc-500">Escolhe mais pessoas para criar um grupo.</p>}
    </Sheet>
  );
}
