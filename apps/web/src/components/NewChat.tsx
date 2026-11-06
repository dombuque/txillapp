import { useQuery } from '@tanstack/react-query';
import { tr } from '../lib/i18n';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import Icon from './Icon';
import { Avatar, useScrollLock, useSwipeDown } from './ui';

interface Person { username: string; displayName: string; hasAvatar: boolean }

/**
 * Nova conversa: procura uma pessoa e conversa, ou escolhe duas ou mais para criar um grupo (com nome).
 * As pessoas escolhidas ficam em cima, como etiquetas que se podem tirar.
 */
export default function NewChat({ onClose, addTo, onCreated }: { onClose: () => void; addTo?: { groupId: string; have: string[]; onAdded: () => void }; onCreated?: (g: { id: string; name: string }) => void }) {
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
    if (!name.trim()) return setErr(tr('Dá um nome ao grupo'));
    setBusy(true);
    try {
      const r = await api.chatGroupCreate(name.trim(), picked.map((p) => p.username));
      onClose();
      if (onCreated) onCreated({ id: r.id, name: name.trim() });
      else navigate(`/messages/g/${r.id}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  const label = addTo ? `Adicionar ${picked.length || ''}`.trim() : picked.length === 1 ? 'Conversar' : picked.length > 1 ? (naming ? 'Criar grupo' : 'Seguinte') : 'Escolhe pessoas';

  const title = addTo ? 'Adicionar ao grupo' : naming ? 'Nome do grupo' : 'Nova conversa';
  useScrollLock();
  const { dy, props: drag } = useSwipeDown(onClose);
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40" onClick={onClose} role="presentation" style={{ touchAction: 'none' }} onTouchStart={(e) => e.stopPropagation()} onTouchMove={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()}>
      <div role="dialog" aria-modal="true" data-swipe="own" aria-label={title} style={{ transform: dy ? `translateY(${dy}px)` : undefined, transition: dy ? 'none' : 'transform .2s ease-out' }} className="flex h-[78dvh] max-h-[640px] w-full max-w-xl animate-[rise_.25s_ease-out] flex-col rounded-t-[28px] bg-white" onClick={(e) => e.stopPropagation()}>
        <div {...drag} className="shrink-0" style={{ touchAction: 'none' }}>
        <div className="mx-auto mt-3 h-1.5 w-10 shrink-0 rounded-full bg-zinc-300" aria-hidden />
        <div className="relative flex shrink-0 items-center justify-center px-4 pb-2 pt-3">
          <h2 className="text-[17px] font-bold">{title}</h2>
        </div>
        </div>

        {naming ? (
          <div className="min-h-0 flex-1 px-5 pt-4">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus placeholder={tr('Ex.: Malta da Polana')} aria-label={tr('Nome do grupo')} className="h-12 w-full rounded-full bg-zinc-100 px-5 text-[16px] outline-none placeholder:text-zinc-500 focus:bg-zinc-200/70" />
            <div className="mt-5 flex flex-wrap justify-center gap-4">
              {picked.map((p) => (
                <span key={p.username} className="flex w-16 flex-col items-center gap-1">
                  <Avatar name={p.displayName} username={p.hasAvatar ? p.username : undefined} size={52} ring={false} />
                  <span className="w-full truncate text-center text-[12px] text-zinc-700">{p.displayName.split(' ')[0]}</span>
                </span>
              ))}
            </div>
            <p className="mt-4 text-center text-sm text-zinc-500">{picked.length + 1} {tr('pessoas, contigo.')}</p>
          </div>
        ) : (
          <>
            <div className="shrink-0 px-4 pb-1">
              <label className="flex h-11 items-center gap-2 rounded-full bg-zinc-100 px-4 text-zinc-500 transition focus-within:bg-zinc-200/70">
                <Icon name="search" size={18} />
                <input value={text} onChange={(e) => setText(e.target.value)} placeholder={tr('Procurar')} aria-label={tr('Procurar pessoas')} className="min-w-0 flex-1 bg-transparent text-[16px] text-zinc-900 outline-none placeholder:text-zinc-500" />
              </label>
              {picked.length > 0 && (
                <div className="mt-3 flex gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {picked.map((p) => (
                    <button key={p.username} type="button" onClick={() => toggle(p)} aria-label={tr('Tirar {v0}', { v0: p.displayName })} className="relative flex w-[60px] shrink-0 flex-col items-center gap-1 active:scale-95">
                      <span className="relative">
                        <Avatar name={p.displayName} username={p.hasAvatar ? p.username : undefined} size={52} ring={false} />
                        <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800 text-white ring-2 ring-white"><Icon name="x" size={12} strokeWidth={3} /></span>
                      </span>
                      <span className="w-full truncate text-center text-[12px] text-zinc-700">{p.displayName.split(' ')[0]}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
              {!text.trim() && rows.length > 0 && <li className="px-3 pb-1 pt-3 text-[13px] font-bold text-zinc-500">{tr('Sugestões')}</li>}
              {rows.length === 0 && <li className="py-12 text-center text-zinc-500">{text.trim() ? tr('Ninguém com esse nome') : tr('Procura pelo nome ou @.')}</li>}
              {rows.map((p) => {
                const on = isPicked(p.username);
                return (
                  <li key={p.username}>
                    <button type="button" onClick={() => toggle(p)} aria-pressed={on} className="flex min-h-[60px] w-full items-center gap-3 rounded-2xl px-3 text-left active:bg-zinc-100">
                      <Avatar name={p.displayName} username={p.hasAvatar ? p.username : undefined} size={46} ring={false} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{p.displayName}</span>
                        <span className="block truncate text-sm text-zinc-500">@{p.username}</span>
                      </span>
                      <span className={`flex h-6 w-6 items-center justify-center rounded-full border-2 transition ${on ? 'border-brand bg-brand text-white' : 'border-zinc-300'}`} aria-hidden>{on && <Icon name="check" size={14} strokeWidth={3} />}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        <div className="shrink-0 border-t border-zinc-100 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
          {err && <p role="alert" className="mb-2 text-center text-sm text-red-600">{err}</p>}
          <div className="flex gap-2">
            {naming && <button type="button" onClick={() => setNaming(false)} className="h-12 rounded-full px-5 font-semibold text-zinc-700 active:bg-zinc-100">{tr('Voltar')}</button>}
            <button type="button" onClick={go} disabled={busy || picked.length === 0} className="h-12 flex-1 rounded-full bg-brand text-[16px] font-bold text-white transition active:scale-[0.98] disabled:opacity-40">{busy ? tr('A criar…') : label}</button>
          </div>
          {!addTo && !naming && picked.length === 1 && <p className="mt-2 text-center text-xs text-zinc-500">{tr('Escolhe mais pessoas para criar um grupo.')}</p>}
        </div>
      </div>
    </div>
  );
}
