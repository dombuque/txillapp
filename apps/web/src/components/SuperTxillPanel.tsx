import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/api';
import { tr } from '../lib/i18n';
import BotAvatar from './BotAvatar';
import Icon from './Icon';

const IDEAS = ['Como convido malta para o Txillapp?', 'Dá-me uma ideia para uma nota', 'Explica-me o que são os Txills', 'O que posso fazer num fim de semana de chuva?'];

/**
 * O SuperTxill, aberto a partir da barra de pesquisa (como a Meta IA no Instagram): um ecrã próprio, sem ser uma conversa com ninguém.
 * A pergunta fica guardada e a resposta chega em segundo plano: podes fechar e ver depois.
 */
export default function SuperTxillPanel({ initial, onClose }: { initial?: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const sent = useRef(false);
  const q = useQuery({
    queryKey: ['supertxill'],
    queryFn: api.aiThread,
    refetchInterval: (query) => (query.state.data?.pending ? 1500 : false),
  });
  const msgs = q.data?.messages ?? [];
  const pending = !!q.data?.pending;

  async function ask(question: string) {
    const t = question.trim();
    if (!t || busy) return;
    setBusy(true);
    setErr('');
    try {
      await api.aiAsk(t);
      setText('');
      await qc.invalidateQueries({ queryKey: ['supertxill'] });
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  }
  // Vindo da pesquisa com uma pergunta escrita: envia logo, uma só vez.
  useEffect(() => {
    if (initial && !sent.current) {
      sent.current = true;
      void ask(initial);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs.length, pending]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  async function clear() {
    await api.aiClear().catch(() => undefined);
    await qc.invalidateQueries({ queryKey: ['supertxill'] });
  }

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="SuperTxill" className="fixed inset-0 z-[85] mx-auto flex max-w-xl flex-col bg-white">
      <header className="flex shrink-0 items-center gap-3 border-b border-zinc-100 px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button type="button" onClick={onClose} aria-label={tr('Voltar')} className="flex h-11 w-11 items-center justify-center rounded-full active:bg-zinc-100"><Icon name="chevron-left" size={26} /></button>
        <BotAvatar size={40} />
        <div className="min-w-0 flex-1">
          <p className="text-[18px] font-extrabold leading-tight">SuperTxill</p>
          <p className="truncate text-xs text-zinc-500">{pending ? tr('a pensar…') : tr('Pergunta-me o que quiseres')}</p>
        </div>
        {msgs.length > 0 && <button type="button" onClick={() => void clear()} aria-label={tr('Apagar a conversa')} className="flex h-11 w-11 items-center justify-center rounded-full text-zinc-500 active:bg-zinc-100"><Icon name="trash" size={20} /></button>}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4" style={{ touchAction: 'pan-y' }}>
        {q.isSuccess && msgs.length === 0 && (
          <div className="mx-auto mt-8 max-w-sm text-center">
            <span className="mx-auto block w-fit"><BotAvatar size={64} /></span>
            <p className="mt-4 text-xl font-extrabold">{tr('Fala, malta!')}</p>
            <p className="mt-1 text-[15px] text-zinc-600">{tr('Pergunta-me como se faz uma coisa na app, pede-me uma legenda ou uma ideia para o fim de semana.')}</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {IDEAS.map((i) => <button key={i} type="button" onClick={() => void ask(i)} className="rounded-full bg-zinc-100 px-4 py-2 text-[14px] font-semibold text-zinc-800 active:bg-zinc-200">{i}</button>)}
            </div>
          </div>
        )}
        <ul className="space-y-2">
          {msgs.map((m) => (
            <li key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <p className={`max-w-[84%] whitespace-pre-wrap break-words rounded-[20px] px-4 py-2.5 text-[16px] leading-snug ${m.role === 'user' ? 'rounded-br-md bg-brand text-white' : 'rounded-bl-md bg-zinc-100 text-zinc-900'}`}>{m.body}</p>
            </li>
          ))}
          {pending && (
            <li className="flex justify-start" aria-label={tr('a pensar…')}>
              <span className="flex items-center gap-1 rounded-[20px] rounded-bl-md bg-zinc-100 px-4 py-3.5">
                {[0, 1, 2].map((d) => <span key={d} className="h-2 w-2 animate-bounce rounded-full bg-zinc-400" style={{ animationDelay: `${d * 120}ms` }} />)}
              </span>
            </li>
          )}
        </ul>
        <div ref={end} />
      </div>

      <form onSubmit={(e: FormEvent) => { e.preventDefault(); void ask(text); }} className="shrink-0 border-t border-zinc-100 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
        {err && <p role="alert" className="px-2 pb-1 text-center text-sm text-red-600">{err}</p>}
        <div className="flex items-end gap-2 rounded-[26px] bg-zinc-100 p-1.5">
          <textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer: fine)').matches) { e.preventDefault(); void ask(text); } }} rows={1} maxLength={1000} placeholder={tr('Pergunta ao SuperTxill…')} aria-label={tr('Pergunta')} className="max-h-32 min-h-10 min-w-0 flex-1 resize-none bg-transparent px-3 py-2 text-[16px] outline-none placeholder:text-zinc-500" />
          <button type="submit" disabled={!text.trim() || busy} aria-label={tr('Enviar')} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-white transition active:scale-90 disabled:opacity-40"><Icon name="send" size={18} /></button>
        </div>
        <p className="mt-1.5 text-center text-[11px] text-zinc-400">{tr('O SuperTxill pode errar. Confirma o que for importante.')}</p>
      </form>
    </div>,
    document.body,
  );
}
