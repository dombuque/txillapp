import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { ApiError, api, type GiftVisibility } from '../lib/api';
import { Sheet, btnGhost, btnPrimary, fieldInput } from './ui';

const AMOUNTS = [5, 10, 50, 100];

const OPTIONS: { value: GiftVisibility; emoji: string; title: string; text: string }[] = [
  { value: 'silent', emoji: '🤫', title: 'Discreto', text: 'Só o presente. Sem mensagem, sem post.' },
  { value: 'private', emoji: '💌', title: 'No privado', text: 'Uma mensagem que só a pessoa vê.' },
  { value: 'public', emoji: '📣', title: 'No feed', text: 'Post "presenteou" para a malta ver.' },
];

/**
 * O mesmo ecrã de presente em qualquer sítio (publicação, perfil, carteira).
 * Escolhe-se como o dar (discreto, no privado, no feed) e, mesmo depois de enviado, pode-se publicar.
 */
export default function GiftSheet({
  recipient, postId, onClose,
}: {
  /** Destinatário já conhecido (publicação ou perfil). Sem ele, pede-se o @. */
  recipient?: { username: string; displayName: string };
  /** Presente dado a partir de uma publicação (conta no "presentes" dessa publicação). */
  postId?: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState(10);
  const [custom, setCustom] = useState('');
  const [note, setNote] = useState('');
  const [visibility, setVisibility] = useState<GiftVisibility>('silent');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState<{ transactionId: string; published: boolean; note: string } | null>(null);
  const [publishing, setPublishing] = useState(false);
  const keyRef = useRef(api.newKey()); // mesma chave em retentativas = sem presente duplicado
  const fresh = () => (keyRef.current = api.newKey());

  const target = recipient?.username ?? to.trim().replace(/^@/, '');
  const name = recipient?.displayName ?? (target ? `@${target}` : 'alguém');

  async function send() {
    const n = custom ? Number(custom) : amount;
    if (!target) return setErr('Diz-me para quem 🕵️');
    if (!Number.isInteger(n) || n < 1) return setErr('O número de Txills tem de ser inteiro 🤓');
    setBusy(true);
    setErr('');
    try {
      const text = visibility === 'silent' ? '' : note.trim();
      const r = postId
        ? await api.gift(postId, n, keyRef.current, text, visibility)
        : await api.giftUser({ toUsername: target, amount: n, note: text, visibility }, keyRef.current);
      setSent({ transactionId: r.transactionId, published: visibility === 'public', note: text });
      for (const key of ['wallet', 'feed', 'profile-posts']) qc.invalidateQueries({ queryKey: [key] });
    } catch (x) {
      const m = (x as Error).message;
      setErr(m === 'Saldo insuficiente' ? 'Ups, o teu saldo não chega 😬' : x instanceof ApiError && x.status === 404 ? 'Essa pessoa não existe. Confirma o @ 🕵️' : m);
    } finally {
      setBusy(false);
    }
  }

  /** Decidir publicar DEPOIS de ter enviado. */
  async function publishNow() {
    if (!sent) return;
    setPublishing(true);
    try {
      await api.publishGift(sent.transactionId, sent.note || undefined);
      setSent({ ...sent, published: true });
      for (const key of ['feed', 'profile-posts']) qc.invalidateQueries({ queryKey: [key] });
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setPublishing(false);
    }
  }

  if (sent) {
    return (
      <Sheet title="Presente enviado 🎁" onClose={onClose}>
        <p className="py-3 text-center text-lg">Mandaste {custom || amount} Txills a {name}! Que generoso 😍</p>
        {sent.published ? (
          <p role="status" className="pb-2 text-center text-green-700">📣 Já está no feed.</p>
        ) : (
          <button onClick={publishNow} disabled={publishing} className={`${btnGhost} mt-2 w-full`}>
            {publishing ? 'A publicar…' : '📣 Publicar no feed agora'}
          </button>
        )}
        <p role="alert" className="mt-2 min-h-5 text-center text-sm text-red-600">{err}</p>
        <button onClick={onClose} className={`${btnPrimary} mt-2 w-full`}>Feito</button>
      </Sheet>
    );
  }

  return (
    <Sheet title={`Presentear ${name} 🎁`} onClose={onClose}>
      <div className="space-y-4">
        {!recipient && (
          <input value={to} onChange={(e) => { setTo(e.target.value); fresh(); }} placeholder="@utilizador" aria-label="Utilizador" autoCapitalize="none" autoCorrect="off" className={fieldInput} />
        )}

        <div>
          <div className="flex gap-2" role="radiogroup" aria-label="Quantidade de Txills">
            {AMOUNTS.map((v) => (
              <button
                key={v}
                role="radio"
                aria-checked={!custom && amount === v}
                onClick={() => { setAmount(v); setCustom(''); fresh(); }}
                className={`h-11 flex-1 rounded-full border font-semibold transition active:scale-95 ${!custom && amount === v ? 'border-brand bg-brand text-white' : 'border-zinc-300'}`}
              >
                {v}
              </button>
            ))}
          </div>
          <input value={custom} onChange={(e) => { setCustom(e.target.value.replace(/\D/g, '')); fresh(); }} inputMode="numeric" placeholder="Ou outro valor…" aria-label="Outro valor" className={`${fieldInput} mt-2`} />
        </div>

        <div role="radiogroup" aria-label="Como dar o presente" className="grid grid-cols-3 gap-2">
          {OPTIONS.map((o) => (
            <button
              key={o.value}
              role="radio"
              aria-checked={visibility === o.value}
              onClick={() => { setVisibility(o.value); fresh(); }}
              className={`flex flex-col items-start rounded-2xl border-2 p-2.5 text-left transition active:scale-[0.98] ${visibility === o.value ? 'border-brand bg-rose-50' : 'border-zinc-200'}`}
            >
              <span className="text-xl" aria-hidden>{o.emoji}</span>
              <span className="mt-0.5 text-sm font-bold">{o.title}</span>
              <span className="mt-0.5 text-[11px] leading-3.5 text-zinc-600">{o.text}</span>
            </button>
          ))}
        </div>

        {visibility !== 'silent' && (
          <textarea
            value={note}
            onChange={(e) => { setNote(e.target.value); fresh(); }}
            maxLength={280}
            rows={2}
            placeholder={visibility === 'private' ? 'Uma mensagem só para a pessoa… 💌' : 'Escreve algo para o post… 📣'}
            aria-label="Mensagem"
            className={`${fieldInput} resize-none`}
          />
        )}

        <p role="alert" className="min-h-5 text-center text-sm text-red-600">{err}</p>
        <button disabled={busy} onClick={send} className={`${btnPrimary} w-full py-4 text-lg`}>
          {busy ? 'A enviar… 🚀' : `Mandar ${custom || amount} Txills`}
        </button>
      </div>
    </Sheet>
  );
}
