import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../../../components/Icon';
import { useCan, when } from '../bo';
import { finApi, LEDGER_LABEL } from './fin-api';
import { Loading, money, Status, Txl } from './fin-ui';

const KIND: Record<string, string> = { user_wallet: 'Carteira', venue_wallet: 'Carteira do local', group_pot: 'Cofre de grupo', system_issuance: 'Emissão' };

/** O detalhe de um movimento do livro (janela; no telemóvel ocupa o ecrã). */
export function TxDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const canUsers = useCan('users.view');
  const q = useQuery({ queryKey: ['fin-tx', id], queryFn: () => finApi.tx(id) });
  const t = q.data;
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label="Detalhe do movimento" data-swipe="off" className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/50 sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:max-w-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <header className="sticky top-0 flex items-center justify-between border-b border-zinc-100 bg-white px-5 py-3">
          <h3 className="font-bold">Movimento</h3>
          <button type="button" onClick={onClose} aria-label="Fechar" className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100"><Icon name="x" size={18} /></button>
        </header>
        <div className="p-5">
          {!t && <Loading error={q.error} />}
          {t && (
            <>
              <p className="text-sm font-semibold text-zinc-500">{LEDGER_LABEL[t.type] ?? t.type}</p>
              <p className="mt-1 text-4xl font-extrabold tracking-tight"><Txl v={t.amount} /></p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-zinc-600">
                <span>{when(t.createdAt)}</span>
                {t.balanced ? <Status tone="good">equilibrado</Status> : <Status tone="bad">desequilibrado</Status>}
                {t.actor && <span>por {canUsers && !t.actor.staff ? <Link className="font-semibold underline" to={`/backoffice/users/${t.actor.id}`}>@{t.actor.username}</Link> : <b>{t.actor.staff ? t.actor.displayName : `@${t.actor.username}`}</b>}{t.actor.staff && ' (equipa)'}</span>}
              </div>

              <h4 className="mb-2 mt-6 text-xs font-bold uppercase tracking-wide text-zinc-500">Pernas</h4>
              <ul className="divide-y divide-zinc-100 rounded-xl ring-1 ring-zinc-200">
                {t.legs.map((l) => (
                  <li key={l.account} className="flex items-center gap-3 px-4 py-3">
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${l.amount < 0 ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`} aria-hidden>
                      <Icon name={l.amount < 0 ? 'arrow-up' : 'download'} size={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">
                        {l.userId && canUsers ? <Link className="hover:underline" to={`/backoffice/users/${l.userId}`}>{l.label}</Link> : l.label}
                      </span>
                      <span className="block text-xs text-zinc-500">{KIND[l.kind] ?? l.kind}{l.kind !== 'system_issuance' && <> · saldo atual <Txl v={l.balance} /></>}</span>
                    </span>
                    <span className={`font-bold tabular-nums ${l.amount < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{l.amount > 0 ? '+' : '−'}{Math.abs(l.amount).toLocaleString('pt-PT')}</span>
                  </li>
                ))}
              </ul>

              {t.order && (
                <div className="mt-4 rounded-xl bg-zinc-50 p-4 text-sm">
                  <p className="font-semibold">Compra de Txills</p>
                  <p className="mt-1 text-zinc-600">Pacote {t.order.packageId} · {money(t.order.amountMinor, t.order.currency)} · {t.order.provider === 'sandbox' ? 'pagamento de teste' : t.order.provider} · {t.order.status}</p>
                </div>
              )}
              {t.campaign && (
                <div className="mt-4 rounded-xl bg-zinc-50 p-4 text-sm">
                  <p className="font-semibold">Campanha Bombar de {t.campaign.venue.name}</p>
                  <p className="mt-1 text-zinc-600">Pacote {t.campaign.package} · {when(t.campaign.startsAt)} → {when(t.campaign.endsAt)} · preço <Txl v={t.campaign.price} />{t.campaign.refunded ? <> · devolvidos <Txl v={t.campaign.refunded} /></> : null} · {t.campaign.status}</p>
                </div>
              )}

              <h4 className="mb-2 mt-6 text-xs font-bold uppercase tracking-wide text-zinc-500">Dados guardados</h4>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-zinc-500">Id</dt><dd className="break-all font-mono text-xs">{t.id}</dd>
                <dt className="text-zinc-500">Chave</dt><dd className="break-all font-mono text-xs">{t.idempotencyKey}</dd>
              </dl>
              {Object.keys(t.metadata ?? {}).length > 0 && <pre className="mt-2 overflow-x-auto rounded-lg bg-zinc-900 p-3 text-xs text-zinc-100">{JSON.stringify(t.metadata, null, 2)}</pre>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
