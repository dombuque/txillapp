import { useQuery, useQueryClient } from '@tanstack/react-query';
import { tr } from '../../lib/i18n';
import { useState } from 'react';
import { LoadingBlock } from '../../components/Loading';
import { PageHeader } from './bo';
import { api, type VerificationItem } from '../../lib/api';
import { TIERS, TierPicker, type Tier } from './ui/contas-ui';

const DOC_LABELS = { id_card: 'BI ou cartão de eleitor', passport: 'Passaporte', driver_licence: 'Carta de condução', residence: 'DIRE (residente)', other: 'Outro documento oficial' } as const;

function Row({ item, onDone }: { item: VerificationItem; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [reason, setReason] = useState('');
  const [rejecting, setRejecting] = useState(false);
  // Aprovar: primeiro escolhe-se o nível do selo (vermelho do Txillapp por defeito; azul só na verificação paga).
  const [approving, setApproving] = useState(false);
  const [tier, setTier] = useState<Tier>('verified');

  async function decide(action: 'approve' | 'reject', tier?: Tier) {
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
    <li className="rounded-2xl border border-zinc-200 bg-white p-5">
      <p className="text-sm text-zinc-500">{item.kind === 'business' ? tr('Negócio ou marca') : tr('Pessoa')} · {item.user.followers} {tr('seguidores')}</p>
      <p className="mt-1 font-bold">{item.fullName}</p>
      <span className="text-sm font-semibold text-brand">@{item.user.username}</span>
      {item.user.bio && <p className="mt-1 text-sm text-zinc-600">{item.user.bio}</p>}
      <p className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-zinc-50 p-3 text-sm">{item.proof}</p>
      <p className="mt-3 text-sm font-semibold">{tr('Documento')}: {item.docType ? tr(DOC_LABELS[item.docType]) : tr('(não indicado)')}</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {([[item.docUrl, 'Documento (frente)'], [item.docBackUrl, 'Documento (verso)'], [item.faceUrl, 'Leitura da cara'], [item.selfieUrl, 'Selfie com o documento']] as const).map(([url, label]) =>
          url ? (
            <a key={label} href={url} target="_blank" rel="noreferrer" className="block">
              <img src={url} alt={tr(label)} className="h-36 w-full rounded-xl object-cover" />
              <span className="mt-1 block text-center text-xs text-zinc-500">{tr(label)}</span>
            </a>
          ) : null,
        )}
      </div>
      {rejecting && (
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder={tr('Motivo (a pessoa vai ver)')} aria-label={tr('Motivo da recusa')} className="mt-3 h-11 w-full rounded-xl border border-zinc-300 px-3 text-[16px]" />
      )}
      {approving && <TierPicker name={`tier-${item.id}`} value={tier} onChange={(t) => t && setTier(t)} />}
      {err && <p role="alert" className="mt-2 text-sm text-red-600">{err}</p>}
      <div className="mt-3 flex gap-2">
        {approving ? (
          <>
            <button disabled={busy} onClick={() => setApproving(false)} className={`${btn} bg-zinc-100 text-zinc-800`}>{tr('Voltar')}</button>
            <button
              disabled={busy}
              onClick={() => (tier === 'verified' || window.confirm(`Dar o selo «${TIERS.find((t) => t.id === tier)?.label}»?`)) && decide('approve', tier)}
              className={`${btn} bg-zinc-900 text-white`}
            >
              {tr('Aprovar')}
            </button>
          </>
        ) : rejecting ? (
          <>
            <button disabled={busy} onClick={() => setRejecting(false)} className={`${btn} bg-zinc-100 text-zinc-800`}>{tr('Voltar')}</button>
            <button disabled={busy || !reason.trim()} onClick={() => decide('reject')} className={`${btn} bg-red-700 text-white`}>{tr('Recusar')}</button>
          </>
        ) : (
          <>
            <button disabled={busy} onClick={() => setRejecting(true)} className={`${btn} bg-zinc-100 text-zinc-800`}>{tr('Recusar')}</button>
            <button disabled={busy} onClick={() => setApproving(true)} className={`${btn} bg-brand text-white`}>{tr('Verificar…')}</button>
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
    <>
      <PageHeader title={tr('Pedidos de selo')} description="Compara o documento, a leitura da cara e a selfie com o documento, lê a justificação e decide. Recusar exige um motivo, que a pessoa vai ver." />
      <div>
        {q.isLoading && <LoadingBlock />}
        {q.isError && <p role="alert" className="text-center text-red-600">{tr('Não foi possível carregar.')}</p>}
        {q.data && q.data.length === 0 && <p className="mt-10 text-center text-zinc-500">{tr('Sem pedidos por rever.')}</p>}
        <ul className="grid grid-cols-2 gap-4">
          {q.data?.map((i) => <Row key={i.id} item={i} onDone={() => void qc.invalidateQueries({ queryKey: ['admin-verifications'] })} />)}
        </ul>
      </div>
    </>
  );
}
