import Icon from '../components/Icon';
import { tr, locale } from '../lib/i18n';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import GeleiraShelf from '../components/GeleiraShelf';
import GiftSheet from '../components/GiftSheet';
import { Page, btnPrimary, timeAgo } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

const labels: Record<string, string> = { welcome_bonus: 'Boas-vindas, malta!', transfer: 'Txills oferecidos', gift: 'Presente', invite: 'Convite', topup: 'Txills recarregados' };

export default function Wallet() {
  const { user } = useAuth();
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['wallet'], queryFn: api.wallet });
  // Vindo de um perfil ("Presentear"), o ecrã de presente abre já com a pessoa escolhida.
  const preset = (useLocation().state as { to?: string; name?: string } | null) ?? null;
  const [gifting, setGifting] = useState<boolean>(!!preset?.to);

  if (isError) {
    return (
      <Page title={tr('Carteira')}>
        <p role="alert">{tr('Ups, não consegui abrir a carteira')}</p>
        <button onClick={() => refetch()} className="mt-4 underline">{tr('Tentar outra vez')}</button>
      </Page>
    );
  }
  if (isLoading || !data) {
    return (
      <Page title={tr('Carteira')}>
        <div className="skel h-40 rounded-[28px]" role="status" aria-label={tr('A carregar')} />
      </Page>
    );
  }

  return (
    <Page title={tr('Carteira')}>
      <section className="rounded-[28px] bg-gradient-to-br from-brand to-brand-light p-6 text-white shadow-[0_10px_30px_rgba(214,51,79,0.35)]">
        <p className="font-light">{tr('Tens')}</p>
        <p className="text-5xl font-extrabold tracking-tight">
          {data.balance.toLocaleString(locale)} <span className="text-2xl font-bold">{tr('TXL')}</span>
        </p>
      </section>

      <button onClick={() => setGifting(true)} className={`${btnPrimary} mt-5 flex w-full items-center justify-center gap-2 py-4 text-lg`}>
        <Icon name="gift" size={20} /> {tr('Presentear alguém')}
      </button>

      <Link to="/invites" className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-zinc-100 font-semibold text-zinc-800 active:bg-zinc-200">
        <Icon name="user-plus" size={19} /> {tr('Ver os meus convites')}
      </Link>

      <GeleiraShelf username={user!.username} isMe flush />

      <section className="mt-8 rounded-[28px] bg-white p-5 shadow-[0_2px_16px_rgba(0,0,0,0.09)]">
        <h2 className="mb-2 text-xl font-bold">{tr('Movimentos')}</h2>
        {data.history.length === 0 && <p className="text-zinc-600">{tr('Ainda sem movimentos. Que tal brindar alguém?')}</p>}
        <ul className="divide-y divide-zinc-100">
          {data.history.map((h) => (
            <li key={h.id} className="flex items-center justify-between py-4">
              <div className="min-w-0">
                <p className="truncate font-medium">{labels[h.type] ?? h.type}{h.counterparty ? ` · ${h.counterparty.displayName}` : ''}</p>
                <p className="truncate text-sm text-zinc-500">{timeAgo(h.createdAt)}</p>
                {h.note && <p className="mt-0.5 line-clamp-2 break-words text-sm text-zinc-700"><span aria-hidden></span> {h.note}</p>}
              </div>
              <span className={`ml-3 text-lg font-extrabold ${h.amount > 0 ? 'text-green-700' : 'text-zinc-700'}`}>
                {h.amount > 0 ? '+' : ''}{h.amount}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {gifting && (
        <GiftSheet
          recipient={preset?.to ? { username: preset.to, displayName: preset.name ?? `@${preset.to}` } : undefined}
          onClose={() => setGifting(false)}
        />
      )}
    </Page>
  );
}
