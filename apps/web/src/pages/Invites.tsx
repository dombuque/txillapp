import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import Icon from '../components/Icon';
import { LoadingBlock } from '../components/Loading';
import StackPage from '../components/StackPage';
import { api } from '../lib/api';
import { tr } from '../lib/i18n';

/** Convida a tua malta: o teu código e ligação, quantos entraram e o que já ganhaste. Os dois ganham Txills quando a pessoa fica ativa. */
export default function Invites() {
  const q = useQuery({ queryKey: ['invites'], queryFn: api.invites, staleTime: 30_000 });
  const [copied, setCopied] = useState(false);
  const d = q.data;

  async function share() {
    if (!d) return;
    const text = tr('Entra no Txillapp com o meu convite e ganhamos Txills os dois:');
    try {
      if (navigator.share) return void (await navigator.share({ title: 'Txillapp', text, url: d.link }));
    } catch {
      return; // cancelado
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(`${text} ${d.link}`)}`, '_blank', 'noopener');
  }
  async function copy() {
    if (!d) return;
    try {
      await navigator.clipboard.writeText(d.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* sem permissão para copiar */
    }
  }

  const stat = (n: number, label: string) => (
    <div className="rounded-2xl bg-zinc-50 px-3 py-3 text-center ring-1 ring-zinc-100">
      <p className="text-2xl font-extrabold tabular-nums">{n}</p>
      <p className="text-[13px] leading-tight text-zinc-600">{label}</p>
    </div>
  );

  return (
    <StackPage title={tr('Convida a tua malta')}>
      <div className="px-4 pb-10 pt-4">
        {q.isLoading && <LoadingBlock className="py-10" />}
        {q.isError && <p role="alert" className="py-10 text-center text-zinc-600">{tr('Não consegui abrir os convites.')}</p>}
        {d && (
          <>
            <section className="rounded-[26px] bg-gradient-to-br from-brand to-[#ff8a5b] px-5 py-6 text-center text-white shadow-[0_6px_18px_rgba(214,51,79,0.35)]">
              <p className="text-[15px] font-semibold opacity-90">{tr('O teu código')}</p>
              <p className="mt-1 text-[38px] font-black tracking-[0.18em]">{d.code}</p>
              <p className="mx-auto mt-2 max-w-xs text-[15px] leading-snug opacity-95">
                {tr('Quando quem convidas ficar ativo, os dois ganham {v0} Txills.', { v0: d.rules.reward })}
              </p>
              <div className="mt-4 flex gap-2">
                <button type="button" onClick={() => void share()} className="flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-white font-bold text-brand active:scale-[0.98]"><Icon name="share" size={20} /> {tr('Convidar')}</button>
                <button type="button" onClick={() => void copy()} className="flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-white/20 font-bold active:scale-[0.98]"><Icon name="link" size={20} /> {copied ? tr('Copiada!') : tr('Copiar ligação')}</button>
              </div>
            </section>

            {d.note && <p role="note" className="mt-4 rounded-2xl bg-amber-50 px-4 py-3 text-[15px] text-amber-900">{d.note}</p>}

            <div className="mt-5 grid grid-cols-3 gap-2">
              {stat(d.stats.invited, tr('Entraram'))}
              {stat(d.stats.active, tr('Ficaram ativos'))}
              {stat(d.stats.earned, tr('Txills ganhos'))}
            </div>
            {d.stats.pending > 0 && <p className="mt-2 text-center text-[13px] text-zinc-500">{tr('{n} em espera: o teu prémio chega {d} dias depois de a pessoa ficar ativa.', { n: d.stats.pending, d: d.rules.holdDays })}</p>}

            <h2 className="mb-2 mt-7 text-lg font-extrabold">{tr('Como funciona')}</h2>
            <ul className="space-y-2 text-[15px] leading-snug text-zinc-700">
              <li className="flex gap-2"><Icon name="check-circle" size={18} className="mt-0.5 shrink-0 text-emerald-600" /> {tr('A pessoa entra pela tua ligação ou com o teu código.')}</li>
              <li className="flex gap-2"><Icon name="check-circle" size={18} className="mt-0.5 shrink-0 text-emerald-600" /> {tr('Ela ganha {v0} Txills quando a conta ficar ativa: confirma o email, publica algo ou segue 3 pessoas, e volta ao Txillapp noutro dia.', { v0: d.rules.reward })}</li>
              <li className="flex gap-2"><Icon name="check-circle" size={18} className="mt-0.5 shrink-0 text-emerald-600" /> {tr('Tu ganhas {v0} Txills passados {d} dias, se ela continuar por cá.', { v0: d.rules.reward, d: d.rules.holdDays })}</li>
              <li className="flex gap-2"><Icon name="info" size={18} className="mt-0.5 shrink-0 text-zinc-500" /> {tr('Até {a} convites por dia e {b} no total. Depois disso o convite continua a funcionar, mas sem Txills.', { a: d.rules.perDay, b: d.rules.maxPaid })}</li>
              <li className="flex gap-2"><Icon name="info" size={18} className="mt-0.5 shrink-0 text-zinc-500" /> {tr('Contas repetidas (no mesmo aparelho ou com o mesmo email), contas automáticas, emails temporários e registos em massa não contam. Os Txills são pontos da app.')}</li>
            </ul>
          </>
        )}
      </div>
    </StackPage>
  );
}
