import Icon from './Icon';
import { useState } from 'react';
import { api, type ReportReason, type ReportType } from '../lib/api';
import { Sheet } from './ui';

const REASONS: { value: ReportReason; label: string; text: string }[] = [
  { value: 'spam', label: 'Spam', text: 'Publicidade, repetição ou ligações suspeitas.' },
  { value: 'harassment', label: 'Assédio ou bullying', text: 'Ataques, ameaças ou perseguição.' },
  { value: 'hate', label: 'Discurso de ódio', text: 'Discriminação ou ataques a um grupo.' },
  { value: 'nudity', label: 'Nudez ou conteúdo sexual', text: 'Conteúdo impróprio.' },
  { value: 'violence', label: 'Violência', text: 'Violência explícita ou apelo à violência.' },
  { value: 'scam', label: 'Burla ou fraude', text: 'Tentativa de enganar ou roubar.' },
  { value: 'impersonation', label: 'Faz-se passar por outra pessoa', text: 'Conta ou conteúdo falso.' },
  { value: 'minor', label: 'Envolve menores', text: 'Conteúdo que põe crianças em risco.' },
  { value: 'other', label: 'Outro motivo', text: 'Algo que não está na lista.' },
];

/** Denunciar uma publicação, comentário, mensagem ou conta. Fica para a moderação analisar; a outra pessoa não é avisada. */
export default function ReportSheet({ type, id, onClose, layer }: { type: Exclude<ReportType, 'media'>; id: string; onClose: () => void; layer?: string }) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');

  async function send() {
    if (!reason) return;
    setBusy(true);
    setErr('');
    try {
      await api.report(type, id, reason, note.trim() || undefined);
      setDone(true);
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Sheet title="Denúncia enviada" onClose={onClose} layer={layer}>
        <p className="py-4 text-center text-zinc-300" aria-hidden><Icon name="check-circle" size={44} className="mx-auto" /></p>
        <p className="text-center text-lg font-semibold">Obrigado por avisares</p>
        <p className="mb-5 mt-1 text-center text-zinc-600">Vamos analisar. A outra pessoa não sabe que foste tu. Se quiseres, podes também bloqueá-la no perfil.</p>
        <button onClick={onClose} className="h-12 w-full rounded-full bg-brand font-bold text-white active:scale-[0.98]">Fechar</button>
      </Sheet>
    );
  }

  return (
    <Sheet title="Porque queres denunciar?" onClose={onClose} layer={layer}>
      <div role="radiogroup" aria-label="Motivo" className="space-y-2">
        {REASONS.map((r) => (
          <button
            key={r.value}
            role="radio"
            aria-checked={reason === r.value}
            onClick={() => setReason(r.value)}
            className={`flex w-full items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left transition active:scale-[0.99] ${reason === r.value ? 'border-brand bg-rose-50' : 'border-zinc-200'}`}
          >
            <span className="min-w-0 flex-1">
              <span className="block font-bold">{r.label}</span>
              <span className="block text-sm text-zinc-600">{r.text}</span>
            </span>
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${reason === r.value ? 'border-brand bg-brand text-sm text-white' : 'border-zinc-300'}`} aria-hidden>{reason === r.value && <Icon name="check" size={14} strokeWidth={3} />}</span>
          </button>
        ))}
      </div>
      {reason && (
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          rows={2}
          placeholder="Queres acrescentar algo? (opcional)"
          aria-label="Nota"
          className="mt-3 w-full resize-none rounded-2xl bg-zinc-100 px-4 py-3 text-[16px] outline-none focus:ring-2 focus:ring-brand/50"
        />
      )}
      {err && <p role="alert" className="mt-2 text-center text-sm text-red-600">{err}</p>}
      <button disabled={!reason || busy} onClick={send} className="mt-4 h-12 w-full rounded-full bg-brand font-bold text-white transition active:scale-[0.98] disabled:opacity-40">
        {busy ? 'A enviar…' : 'Enviar denúncia'}
      </button>
    </Sheet>
  );
}
