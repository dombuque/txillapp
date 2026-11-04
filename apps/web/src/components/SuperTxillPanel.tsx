import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { tr } from '../lib/i18n';
import BotAvatar from './BotAvatar';
import FollowButton from './FollowButton';
import Icon from './Icon';
import { Avatar } from './ui';

/**
 * O SuperTxill: a inteligência do Txillapp, aberta a partir da barra de pesquisa. Não é um chat nem uma conta.
 * É um modelo nosso, treinado e calculado só com dados do Txillapp (quem segues, os teus gostos da geleira), sem fontes externas.
 */
export default function SuperTxillPanel({ onClose }: { onClose: () => void }) {
  const q = useQuery({ queryKey: ['supertxill-for-you'], queryFn: api.aiForYou, staleTime: 60_000 });
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  const list = q.data ?? [];

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="SuperTxill" className="fixed inset-0 z-[85] mx-auto flex max-w-xl flex-col bg-white">
      <header className="flex shrink-0 items-center gap-3 border-b border-zinc-100 px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button type="button" onClick={onClose} aria-label={tr('Voltar')} className="flex h-11 w-11 items-center justify-center rounded-full active:bg-zinc-100"><Icon name="chevron-left" size={26} /></button>
        <BotAvatar size={40} />
        <div className="min-w-0 flex-1">
          <p className="text-[18px] font-extrabold leading-tight">SuperTxill</p>
          <p className="truncate text-xs text-zinc-500">{tr('Escolhido para ti, com o que se passa no Txillapp')}</p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        <h2 className="text-lg font-extrabold">{tr('Malta para ti')}</h2>
        {q.isLoading && <p className="mt-6 text-center text-zinc-500">{tr('A pensar…')}</p>}
        {q.isError && <p role="alert" className="mt-6 text-center text-zinc-500">{tr('Não consegui ver agora. Tenta daqui a pouco.')}</p>}
        {q.isSuccess && list.length === 0 && (
          <p className="mt-6 text-center text-[15px] text-zinc-600">{tr('Ainda não tenho malta para te mostrar. Segue algumas pessoas e põe gostos na tua geleira, e eu aprendo contigo.')}</p>
        )}
        <ul className="mt-2">
          {list.map((p) => (
            <li key={p.username} className="flex items-center gap-3 py-2.5">
              <Link to={`/u/${p.username}`} onClick={onClose} className="flex min-w-0 flex-1 items-center gap-3">
                <Avatar name={p.displayName} username={p.username} size={48} presence />
                <span className="min-w-0">
                  <span className="block truncate font-semibold leading-tight">{p.displayName} {p.isPrivate && <Icon name="lock" size={14} className="inline align-[-2px] text-zinc-500" />}</span>
                  <span className="block truncate text-sm text-zinc-500">{p.reason}</span>
                </span>
              </Link>
              <div className="w-[104px] shrink-0">
                <FollowButton username={p.username} following={false} requested={p.requested} isPrivate={p.isPrivate} />
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-6 rounded-2xl bg-zinc-50 p-3.5 text-[13px] leading-snug text-zinc-600">
          {tr('Isto é calculado pelo Txillapp, só com dados do Txillapp: quem segues e os gostos da tua geleira. Nada sai para fora. Só aparecem pessoas que aceitam ser sugeridas. Podes desligar o uso da geleira nas Definições.')}
        </p>
      </div>
    </div>,
    document.body,
  );
}
