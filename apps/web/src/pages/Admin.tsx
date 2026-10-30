import Icon from '../components/Icon';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import StackPage from '../components/StackPage';
import { api, type ReportQueueItem } from '../lib/api';

const REASON: Record<string, string> = {
  spam: 'Spam', harassment: 'Assédio', hate: 'Ódio', nudity: 'Nudez', violence: 'Violência', scam: 'Burla', impersonation: 'Falsa identidade', minor: 'Menores', other: 'Outro',
};
const TYPE: Record<string, string> = { post: 'Publicação', comment: 'Comentário', story: 'Story', user: 'Conta', message: 'Mensagem', media: 'Foto (automático)' };

function Row({ item, onDone }: { item: ReportQueueItem; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function act(action: 'dismiss' | 'remove' | 'suspend') {
    if (action === 'suspend' && !window.confirm(`Suspender a conta de @${item.owner?.username}? Perde as sessões e não volta a entrar.`)) return;
    if (action === 'remove' && !window.confirm('Remover este conteúdo?')) return;
    setBusy(true);
    setErr('');
    try {
      await api.adminResolve(item.type, item.id, action);
      onDone();
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  }
  const btn = 'h-10 flex-1 rounded-full text-sm font-bold transition active:scale-95 disabled:opacity-40';
  return (
    <li className="rounded-2xl border border-zinc-200 p-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="rounded-full bg-zinc-900 px-2.5 py-0.5 font-bold text-white">{TYPE[item.type]}</span>
        <span className="font-bold text-brand">{item.reports} {item.reports === 1 ? 'denúncia' : 'denúncias'}</span>
        <span className="text-zinc-500">· {item.reasons.map((r) => REASON[r] ?? r).join(', ')}</span>
      </div>
      {item.owner && (
        <p className="mt-2 text-sm">
          de <Link to={`/u/${item.owner.username}`} className="font-semibold underline">@{item.owner.username}</Link>
          {item.owner.status !== 'active' && <span className="ml-1 text-red-600">({item.owner.status})</span>}
          {item.owner.strikes > 0 && <span className="ml-1 text-amber-700">· {item.owner.strikes} ação(ões) anteriores</span>}
        </p>
      )}
      {item.imageUrl && <img src={item.imageUrl} alt="Foto assinalada" className="mt-2 max-h-64 w-full rounded-xl bg-zinc-100 object-contain" />}
      <p className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-zinc-50 px-3 py-2 text-[15px] text-zinc-800">{item.preview || '(sem texto)'}</p>
      {err && <p role="alert" className="mt-2 text-sm text-red-600">{err}</p>}
      <div className="mt-3 flex gap-2">
        <button disabled={busy} onClick={() => act('dismiss')} className={`${btn} bg-zinc-100 text-zinc-800`}>Ignorar</button>
        {item.type !== 'user' && <button disabled={busy} onClick={() => act('remove')} className={`${btn} bg-amber-500 text-white`}>Remover</button>}
        <button disabled={busy || !item.owner} onClick={() => act('suspend')} className={`${btn} bg-red-700 text-white`}>Suspender</button>
      </div>
    </li>
  );
}

/** Fila de moderação: só para contas de moderação. */
export default function Admin() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-reports'], queryFn: () => api.adminQueue(), retry: false });
  return (
    <StackPage title="Moderação">
      <div className="px-4 pt-4">
        {q.isError && <p role="alert" className="py-10 text-center text-zinc-600">Sem acesso</p>}
        {q.isLoading && <p className="py-10 text-center text-zinc-500">A carregar…</p>}
        {q.isSuccess && q.data.length === 0 && (
          <div className="py-16 text-center">
            <p className="text-zinc-300" aria-hidden><Icon name="sparkles" size={44} className="mx-auto" /></p>
            <p className="mt-3 text-xl font-bold">Fila vazia</p>
            <p className="text-zinc-600">Não há denúncias por analisar.</p>
          </div>
        )}
        <ul className="space-y-3">
          {q.data?.map((item) => (
            <Row key={`${item.type}:${item.id}`} item={item} onDone={() => qc.invalidateQueries({ queryKey: ['admin-reports'] })} />
          ))}
        </ul>
      </div>
    </StackPage>
  );
}
