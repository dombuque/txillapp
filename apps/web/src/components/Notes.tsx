import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type Note } from '../lib/api';
import { useAuth } from '../lib/auth';
import Icon from './Icon';
import { Avatar, Sheet, fieldInput, timeAgo } from './ui';

const LIMIT = 60;

/** O balão da nota, por cima da foto: texto curto em 3 linhas, com o "bico" a apontar para a pessoa. */
function Bubble({ text, dim = false }: { text: string; dim?: boolean }) {
  return (
    <span className={`relative mb-1.5 block max-w-[84px] rounded-[14px] bg-white px-2 py-1.5 text-center text-[11px] font-medium leading-[1.15] shadow-[0_1px_6px_rgba(0,0,0,0.18)] ring-1 ring-zinc-100 ${dim ? 'text-zinc-500' : 'text-zinc-800'}`}>
      <span className="line-clamp-3 break-words">{text}</span>
      <span aria-hidden className="absolute -bottom-1 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 bg-white" />
    </span>
  );
}

/**
 * Notas, como no Instagram: uma frase de até 60 caracteres por cima da tua foto, durante 24 horas.
 * Só as vêem os teus seguidores. Não se editam. Tocar numa nota de outra pessoa deixa-te responder.
 */
export default function NotesStrip() {
  const { user } = useAuth();
  const q = useQuery({ queryKey: ['notes'], queryFn: api.notes, staleTime: 60_000, refetchInterval: 120_000 });
  const [editing, setEditing] = useState(false);
  const [viewing, setViewing] = useState<Note | null>(null);
  const mine = q.data?.mine ?? null;
  const items = q.data?.items ?? [];
  if (!user) return null;

  return (
    <>
      <div className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-2 pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Notas">
        <button onClick={() => setEditing(true)} aria-label={mine ? 'A tua nota' : 'Deixar uma nota'} className="flex w-[84px] shrink-0 flex-col items-center active:scale-95">
          <span className="flex h-[54px] items-end"><Bubble text={mine ? mine.body : 'Deixa uma nota'} dim={!mine} /></span>
          <span className="relative">
            <Avatar name={user.displayName} username={user.username} size={64} ring={false} />
            {!mine && (
              <span className="absolute -bottom-0.5 -right-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-brand text-white ring-2 ring-white"><Icon name="plus" size={14} strokeWidth={3} /></span>
            )}
          </span>
          <span className="mt-1 w-full truncate text-center text-[12px] text-zinc-600">A tua nota</span>
        </button>
        {items.map((n) => (
          <button key={n.username} onClick={() => setViewing(n)} aria-label={`Nota de ${n.displayName}: ${n.body}`} className="flex w-[84px] shrink-0 flex-col items-center active:scale-95">
            <span className="flex h-[54px] items-end"><Bubble text={n.body} /></span>
            <Avatar name={n.displayName} username={n.hasAvatar ? n.username : undefined} size={64} ring={false} />
            <span className="mt-1 w-full truncate text-center text-[12px] text-zinc-600">{n.displayName.split(' ')[0]}</span>
          </button>
        ))}
      </div>
      {editing && <NoteEditor current={mine} onClose={() => setEditing(false)} />}
      {viewing && <NoteView note={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

/** Publicar a minha nota, ou apagá-la. Não se edita: apaga-se e escreve-se outra. */
function NoteEditor({ current, onClose }: { current: Note | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function run(job: () => Promise<unknown>) {
    setBusy(true);
    setErr('');
    try {
      await job();
      await qc.invalidateQueries({ queryKey: ['notes'] });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Sheet title="A tua nota" onClose={onClose}>
      {current ? (
        <>
          <p className="mx-auto max-w-xs break-words rounded-[18px] bg-zinc-100 px-4 py-3 text-center text-[17px] font-medium leading-snug">{current.body}</p>
          <p className="mt-2 text-center text-xs text-zinc-500">{timeAgo(current.createdAt)} · visível para os teus seguidores. Uma nota não se edita: apaga-a para publicar outra.</p>
          {err && <p role="alert" className="mt-2 text-center text-sm text-red-600">{err}</p>}
          <button disabled={busy} onClick={() => setConfirmDelete(true)} className="mt-3 h-12 w-full rounded-full font-semibold text-red-700 active:bg-red-50">Apagar nota</button>
        </>
      ) : (
        <>
          <label className="block">
            <textarea value={body} onChange={(e) => setBody(e.target.value.replace(/\n/g, ' ').slice(0, LIMIT))} rows={2} autoFocus placeholder="O que se passa?" aria-label="Nota" className={`${fieldInput} resize-none`} />
            <span className={`mt-1 block text-right text-xs ${body.length >= LIMIT ? 'text-brand' : 'text-zinc-500'}`}>{body.length}/{LIMIT}</span>
          </label>
          <p className="mt-1 text-xs text-zinc-500">Fica 24 horas por cima da tua foto, para os teus seguidores. Quem vê pode responder-te por mensagem.</p>
          {err && <p role="alert" className="mt-2 text-center text-sm text-red-600">{err}</p>}
          <button disabled={busy || !body.trim()} onClick={() => run(() => api.setNote(body.trim()))} className="mt-3 h-12 w-full rounded-full bg-brand font-bold text-white transition active:scale-[0.98] disabled:opacity-40">Partilhar nota</button>
        </>
      )}
      {confirmDelete && (
        <Sheet title="Apagar a nota?" onClose={() => setConfirmDelete(false)} layer="z-[60]">
          <p className="mb-4 text-zinc-600">A nota desaparece já para toda a gente. Podes escrever outra quando quiseres.</p>
          <button disabled={busy} onClick={() => run(() => api.deleteNote())} className="h-12 w-full rounded-full bg-red-700 font-bold text-white active:scale-[0.98] disabled:opacity-50">Apagar</button>
          <button onClick={() => setConfirmDelete(false)} className="mt-2 h-12 w-full rounded-full font-semibold text-zinc-700 active:bg-zinc-100">Cancelar</button>
        </Sheet>
      )}
    </Sheet>
  );
}

/** A nota de outra pessoa: ler e responder (a resposta vai como mensagem). */
function NoteView({ note, onClose }: { note: Note; onClose: () => void }) {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function reply() {
    if (!text.trim()) return;
    setBusy(true);
    setErr('');
    try {
      await api.replyNote(note.username, text.trim());
      onClose();
      navigate(`/messages/${note.username}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Sheet title={note.displayName} onClose={onClose}>
      <div className="flex flex-col items-center text-center">
        <Avatar name={note.displayName} username={note.hasAvatar ? note.username : undefined} size={72} ring={false} />
        <p className="mt-3 max-w-xs break-words rounded-[18px] bg-zinc-100 px-4 py-3 text-[17px] font-medium leading-snug">{note.body}</p>
        <p className="mt-1.5 text-xs text-zinc-500">{timeAgo(note.createdAt)}</p>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); void reply(); }} className="mt-4 flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={400} placeholder="Responder à nota…" aria-label="Responder à nota" className={fieldInput} />
        <button disabled={busy || !text.trim()} className="h-[50px] shrink-0 rounded-full bg-brand px-5 font-bold text-white active:scale-95 disabled:opacity-40">Enviar</button>
      </form>
      {err && <p role="alert" className="mt-2 text-center text-sm text-red-600">{err}</p>}
      <button onClick={() => { onClose(); navigate(`/messages/${note.username}`); }} className="mt-2 h-11 w-full rounded-full font-semibold text-zinc-700 active:bg-zinc-100">Abrir a conversa</button>
    </Sheet>
  );
}
