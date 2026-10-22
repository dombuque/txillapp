import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { Page, btnPrimary, lineInput, timeAgo } from '../components/ui';
import { ApiError, api } from '../lib/api';

const labels = { welcome_bonus: 'Boas-vindas, malta! 🎉', transfer: 'Transferência 💸', gift: 'Presente 🎁' } as const;

export default function Wallet() {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['wallet'], queryFn: api.wallet });
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const keyRef = useRef(api.newKey());

  async function submit(e: FormEvent) {
    e.preventDefault();
    const n = Number(amount);
    if (!to.trim() || !Number.isInteger(n) || n < 1) return setMsg({ ok: false, text: 'Diz-me para quem e quantos Txills (números inteiros) 🤓' });
    setBusy(true);
    setMsg(null);
    try {
      await api.transfer(to.trim().replace(/^@/, ''), n, note || undefined, keyRef.current);
      keyRef.current = api.newKey(); // nova operação → nova chave
      setMsg({ ok: true, text: 'Feito! O teu amigo já está mais rico 🤑' });
      setTo('');
      setAmount('');
      setNote('');
      qc.invalidateQueries({ queryKey: ['wallet'] });
    } catch (x) {
      const text =
        x instanceof ApiError && x.message === 'Saldo insuficiente'
          ? 'Ups, o teu saldo não chega 😬'
          : x instanceof ApiError && x.status === 404
            ? 'Esse utilizador não existe. Confirma o @ 🕵️'
            : (x as Error).message;
      setMsg({ ok: false, text });
    } finally {
      setBusy(false);
    }
  }

  if (isError) {
    return (
      <Page title="Carteira 👛">
        <p role="alert">Ups, não consegui abrir a carteira 😅</p>
        <button onClick={() => refetch()} className="mt-4 underline">Tentar outra vez</button>
      </Page>
    );
  }
  if (isLoading || !data) {
    return (
      <Page title="Carteira 👛">
        <div className="h-40 animate-pulse rounded-[28px] bg-zinc-200" aria-label="A carregar" />
      </Page>
    );
  }

  return (
    <Page title="Carteira 👛" sub="O teu dinheirinho de brincar">
      <section className="rounded-[28px] bg-gradient-to-br from-brand to-rose-400 p-6 text-white shadow-[0_10px_30px_rgba(228,68,96,0.35)]">
        <p className="font-light">Tens</p>
        <p className="text-5xl font-extrabold tracking-tight">
          {data.balance.toLocaleString('pt-PT')} <span className="text-2xl font-bold">TXL</span>
        </p>
        <p className="mt-3 inline-block rounded-full bg-white/25 px-3 py-1 text-sm font-semibold">
          Txills de brincadeira 🎭 sem valor real
        </p>
      </section>

      <form onSubmit={submit} className="mt-8 space-y-5" noValidate>
        <h2 className="text-xl font-bold">Mandar Txills a um amigo 💸</h2>
        <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="@utilizador" aria-label="Utilizador" autoCapitalize="none" className={lineInput} />
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" placeholder="Quanto?" aria-label="Montante" className={lineInput} />
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={140} placeholder="Uma mensagem (opcional)" aria-label="Mensagem" className={lineInput} />
        <p role={msg?.ok ? 'status' : 'alert'} className={`min-h-6 text-center ${msg?.ok ? 'text-green-700' : 'text-red-600'}`}>{msg?.text}</p>
        <button disabled={busy} className={`${btnPrimary} w-full py-5 text-lg`}>{busy ? 'A enviar… 🚀' : 'Enviar'}</button>
      </form>

      <section className="mt-10">
        <h2 className="mb-2 text-xl font-bold">Movimentos</h2>
        {data.history.length === 0 && <p className="text-zinc-600">Ainda sem movimentos. Que tal brindar alguém? 🍻</p>}
        <ul className="divide-y divide-zinc-300/70">
          {data.history.map((h) => (
            <li key={h.id} className="flex items-center justify-between py-4">
              <div className="min-w-0">
                <p className="truncate font-medium">{labels[h.type]}{h.counterparty ? ` · ${h.counterparty.displayName}` : ''}</p>
                <p className="truncate text-sm text-zinc-500">{timeAgo(h.createdAt)}{h.note ? ` · ${h.note}` : ''}</p>
              </div>
              <span className={`ml-3 text-lg font-extrabold ${h.amount > 0 ? 'text-green-600' : 'text-zinc-700'}`}>
                {h.amount > 0 ? '+' : ''}{h.amount}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </Page>
  );
}
