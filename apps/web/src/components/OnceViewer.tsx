import { useEffect, useState } from 'react';
import { tr } from '../lib/i18n';
import { api } from '../lib/api';
import { firstTime } from '../lib/firstTime';
import Icon from './Icon';

type Content = Awaited<ReturnType<typeof api.chatOpen>>;

/**
 * Visualização única: abre a mensagem (texto, foto ou voz) em ecrã inteiro. Só se pode abrir uma vez: ao fechar, o conteúdo já não existe.
 * Abrir apaga-o do servidor, por isso este ecrã mostra-o apenas enquanto estiver aberto.
 */
export default function OnceViewer({ id, from, onClose }: { id: string; from: string; onClose: () => void }) {
  const [c, setC] = useState<Content | null>(null);
  const [err, setErr] = useState('');
  const [explain] = useState(() => firstTime('view-once-open')); // o aviso final só da primeira vez

  useEffect(() => {
    let alive = true;
    api.chatOpen(id).then((r) => alive && setC(r)).catch((e) => alive && setErr((e as Error).message));
    return () => { alive = false; };
  }, [id]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label={tr('Visualização única')} className="fixed inset-0 z-[85] flex flex-col bg-black text-white">
      <div className="flex items-center justify-between px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button type="button" onClick={onClose} aria-label={tr('Fechar')} className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 active:scale-90"><Icon name="x" size={24} /></button>
        <span className="flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-sm font-semibold"><Icon name="eye" size={16} /> {tr('Só podes ver uma vez')}</span>
        <span className="w-11" aria-hidden />
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center px-5">
        {!c && !err && <p className="text-white/80">{tr('A abrir…')}</p>}
        {err && (
          <div className="text-center">
            <Icon name="eye-off" size={44} className="mx-auto text-white/60" />
            <p className="mt-3 text-lg font-bold">{err}</p>
          </div>
        )}
        {c?.kind === 'image' && c.mediaUrl && <img src={c.mediaUrl} alt={`Foto de ${from}`} draggable={false} className="max-h-full max-w-full rounded-2xl object-contain" />}
        {c?.kind === 'voice' && c.mediaUrl && (
          <div className="w-full max-w-sm rounded-3xl bg-white/10 p-6 text-center">
            <Icon name="mic" size={40} className="mx-auto" />
            <audio src={c.mediaUrl} controls autoPlay className="mt-4 w-full" />
          </div>
        )}
        {c?.kind === 'text' && <p className="max-w-sm whitespace-pre-wrap break-words rounded-3xl bg-white/10 px-6 py-5 text-center text-[22px] font-semibold leading-snug">{c.body}</p>}
      </div>
      <p className="px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 text-center text-sm text-white/70">{explain ? tr('Ao fechar, esta mensagem desaparece para sempre.') : ''}</p>
    </div>
  );
}
