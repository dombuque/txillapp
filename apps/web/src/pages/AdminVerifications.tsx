import { useQuery, useQueryClient } from '@tanstack/react-query';
import { tr } from '../lib/i18n';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { LoadingBlock } from '../components/Loading';
import StackPage from '../components/StackPage';
import { api, type VerificationItem } from '../lib/api';

function Row({ item, onDone }: { item: VerificationItem; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [reason, setReason] = useState('');
  const [rejecting, setRejecting] = useState(false);

  async function decide(action: 'approve' | 'reject', tier?: 'verified' | 'official') {
    setBusy(true);
    setErr('');
    try {
      await api.verificationDecide(item.id, action, reason.trim() || undefined, tier);
      onDone();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }
  const btn = 'h-10 flex-1 rounded-full text-sm font-bold transition active:scale-95 disabled:opacity-40';
  return (
    <li className="rounded-2xl border border-zinc-200 p-4">
      <p className="text-sm text-zinc-500">{item.kind === 'business' ? 'Negócio ou marca' : 'Pessoa'} · {item.user.followers} {tr('seguidores')}</p>
      <p className="mt-1 font-bold">{item.fullName}</p>
      <Link to={`/u/${item.user.username}`} className="text-sm font-semibold text-brand underline">@{item.user.username}</Link>
      {item.user.bio && <p className="mt-1 text-sm text-zinc-600">{item.user.bio}</p>}
      <p className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-zinc-50 p-3 text-sm">{item.proof}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {item.docUrl && <a href={item.docUrl} target="_blank" rel="noreferrer" className="block"><img src={item.docUrl} alt={tr('Documento')} className="h-36 w-full rounded-xl object-cover" /><span className="mt-1 block text-center text-xs text-zinc-500">{tr('Documento')}</span></a>}
        {item.selfieUrl && <a href={item.selfieUrl} target="_blank" rel="noreferrer" className="block"><img src={item.selfieUrl} alt={tr('Selfie')} className="h-36 w-full rounded-xl object-cover" /><span className="mt-1 block text-center text-xs text-zinc-500">{tr('Selfie')}</span></a>}
      </div>
      {rejecting && (
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder={tr('Motivo (a pessoa vai ver)')} aria-label={tr('Motivo da recusa')} className="mt-3 h-11 w-full rounded-xl border border-zinc-300 px-3 text-[16px]" />
      )}
      {err && <p role="alert" className="mt-2 text-sm text-red-600">{err}</p>}
      <div className="mt-3 flex gap-2">
        {rejecting ? (
          <>
            <button disabled={busy} onClick={() => setRejecting(false)} className={`${btn} bg-zinc-100 text-zinc-800`}>{tr('Voltar')}</button>
            <button disabled={busy || !reason.trim()} onClick={() => decide('reject')} className={`${btn} bg-red-700 text-white`}>{tr('Recusar')}</button>
          </>
        ) : (
          <>
            <button disabled={busy} onClick={() => setRejecting(true)} className={`${btn} bg-zinc-100 text-zinc-800`}>{tr('Recusar')}</button>
            <button disabled={busy} onClick={() => decide('approve', 'verified')} className={`${btn} bg-sky-600 text-white`}>{tr('Verificar')}</button>
            <button disabled={busy} onClick={() => window.confirm('Dar o selo de conta oficial do Txillapp?') && decide('approve', 'official')} className={`${btn} bg-brand text-white`}>{tr('Oficial')}</button>
          </>
        )}
      </div>
    </li>
  );
}

/** Fila de pedidos de verificação (só moderação): ver o documento e a selfie, e aprovar ou recusar. */
export default function AdminVerifications() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-verifications'], queryFn: () => api.adminVerifications(), refetchOnWindowFocus: true });
  return (
    <StackPage title={tr('Pedidos de verificação')}>
      <div className="px-4 pt-4">
        {q.isLoading && <LoadingBlock />}
        {q.isError && <p role="alert" className="text-center text-red-600">{tr('Não foi possível carregar.')}</p>}
        {q.data && q.data.length === 0 && <p className="mt-10 text-center text-zinc-500">{tr('Sem pedidos por rever.')}</p>}
        <ul className="space-y-3">
          {q.data?.map((i) => <Row key={i.id} item={i} onDone={() => void qc.invalidateQueries({ queryKey: ['admin-verifications'] })} />)}
        </ul>
      </div>
    </StackPage>
  );
}
