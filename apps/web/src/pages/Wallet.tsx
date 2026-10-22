import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { btnPrimary, inputCls, timeAgo } from '../components/ui';
import { api } from '../lib/api';

const labels = { welcome_bonus: 'Bónus de boas-vindas', transfer: 'Transferência', gift: 'Presente' } as const;

export default function Wallet() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['wallet'], queryFn: api.wallet });
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const keyRef = useRef(api.newKey());

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api.transfer(to.trim().replace(/^@/, ''), Number(amount), note || undefined, keyRef.current);
      keyRef.current = api.newKey(); // nova operação → nova chave
      setMsg({ ok: true, text: 'Transferência concluída.' });
      setTo('');
      setAmount('');
      setNote('');
      qc.invalidateQueries({ queryKey: ['wallet'] });
    } catch (x) {
      setMsg({ ok: false, text: (x as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (isLoading || !data) return <p className="p-8 text-center text-zinc-400">A carregar…</p>;
  return (
    <div className="space-y-5 p-4">
      <section className="rounded-3xl bg-zinc-900 p-6 text-white">
        <p className="text-sm text-zinc-300">Saldo</p>
        <p className="text-4xl font-black">{data.balance.toLocaleString('pt-PT')} TXL</p>
        <p className="mt-2 inline-block rounded-full bg-amber-400 px-3 py-0.5 text-xs font-bold text-zinc-900">
          DEMONSTRAÇÃO · sem valor real
        </p>
      </section>

      <form onSubmit={submit} className="space-y-3 rounded-3xl bg-white p-4 shadow-sm">
        <h2 className="font-bold">Enviar Txills</h2>
        <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="@utilizador" required className={inputCls} />
        <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min={1} step={1} placeholder="Montante" required className={inputCls} />
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={140} placeholder="Nota (opcional)" className={inputCls} />
        {msg && <p role={msg.ok ? 'status' : 'alert'} className={`text-sm ${msg.ok ? 'text-green-700' : 'text-red-600'}`}>{msg.text}</p>}
        <button disabled={busy} className={`${btnPrimary} w-full`}>Enviar</button>
      </form>

      <section className="rounded-3xl bg-white p-4 shadow-sm">
        <h2 className="mb-2 font-bold">Movimentos</h2>
        <ul className="divide-y divide-zinc-100">
          {data.history.map((h) => (
            <li key={h.id} className="flex items-center justify-between py-3">
              <div>
                <p className="font-medium">{labels[h.type]}{h.counterparty ? ` · ${h.counterparty.displayName}` : ''}</p>
                <p className="text-sm text-zinc-400">{timeAgo(h.createdAt)}{h.note ? ` · ${h.note}` : ''}</p>
              </div>
              <span className={`font-bold ${h.amount > 0 ? 'text-green-600' : 'text-zinc-700'}`}>
                {h.amount > 0 ? '+' : ''}{h.amount}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
