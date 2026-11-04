import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type ReportQueueItem } from '../../lib/api';
import { Badge, ago, btn, btnGhost, when } from './bo';

const REASON: Record<string, string> = { spam: 'Spam', harassment: 'Assédio', hate: 'Ódio', nudity: 'Nudez', violence: 'Violência', scam: 'Burla', impersonation: 'Falsa identidade', minor: 'Menores', other: 'Outro' };
const TYPE: Record<string, string> = { post: 'Publicação', comment: 'Comentário', story: 'Story', user: 'Conta', message: 'Mensagem', media: 'Foto (automático)' };
const RESOLUTION: Record<string, string> = { dismiss: 'Ignorada', remove: 'Conteúdo removido', suspend: 'Conta suspensa' };

/** Uma queixa por decidir: o conteúdo, quem denunciou e porquê; decide-se com um motivo escrito. */
function OpenItem({ item, onDone }: { item: ReportQueueItem; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function act(action: 'dismiss' | 'remove' | 'suspend') {
    if (action === 'suspend' && !window.confirm(`Suspender a conta de @${item.owner?.username}? Perde as sessões e não volta a entrar.`)) return;
    if (action === 'remove' && !window.confirm('Remover este conteúdo?')) return;
    setBusy(true);
    setErr('');
    try {
      await api.adminResolve(item.type, item.id, action, note.trim() || undefined);
      onDone();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <li className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone="blue">{TYPE[item.type]}</Badge>
        <span className="font-bold text-brand">{item.reports} {item.reports === 1 ? 'denúncia' : 'denúncias'}</span>
        <span className="text-zinc-600">· {item.reasons.map((r) => REASON[r] ?? r).join(', ')}</span>
        <span className="ml-auto text-xs text-zinc-500">a mais antiga {ago(item.firstAt)}</span>
      </div>
      {item.owner && (
        <p className="mt-2 text-sm">
          De <Link to={`/backoffice/users?q=${encodeURIComponent(item.owner.username)}`} className="font-semibold underline">@{item.owner.username}</Link>
          {item.owner.status !== 'active' && <span className="ml-1 text-red-600">({item.owner.status})</span>}
          {item.owner.strikes > 0 && <span className="ml-1 text-amber-700">· {item.owner.strikes} ação(ões) anteriores</span>}
        </p>
      )}
      {item.imageUrl && <img src={item.imageUrl} alt="Foto assinalada" className="mt-3 max-h-72 rounded-xl bg-zinc-100 object-contain" />}
      <p className="mt-3 whitespace-pre-wrap break-words rounded-xl bg-zinc-50 px-3 py-2 text-[15px]">{item.preview || '(sem texto)'}</p>
      <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Motivo da decisão (opcional, fica no registo)" aria-label="Motivo" className="mt-3 h-10 w-full rounded-lg border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900" />
      {err && <p role="alert" className="mt-2 text-sm text-red-600">{err}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button disabled={busy} onClick={() => void act('dismiss')} className={`${btn} border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50`}>Ignorar</button>
        {item.type !== 'user' && <button disabled={busy} onClick={() => void act('remove')} className={`${btn} bg-amber-500 text-white hover:bg-amber-600`}>Remover o conteúdo</button>}
        <button disabled={busy || !item.owner} onClick={() => void act('suspend')} className={`${btn} bg-red-700 text-white hover:bg-red-800`}>Suspender a conta</button>
      </div>
    </li>
  );
}

function Decided({ status }: { status: 'actioned' | 'dismissed' }) {
  const q = useInfiniteQuery({
    queryKey: ['bo-decided', status],
    queryFn: ({ pageParam }) => api.boDecided(status, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <>
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={`${r.type}:${r.id}`} className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{TYPE[r.type] ?? r.type}</Badge>
              <Badge tone={r.resolution === 'dismiss' ? 'zinc' : 'red'}>{RESOLUTION[r.resolution] ?? r.resolution}</Badge>
              <span className="text-zinc-600">{r.reports} {r.reports === 1 ? 'denúncia' : 'denúncias'} · {r.reasons.map((x) => REASON[x] ?? x).join(', ')}</span>
              <span className="ml-auto text-xs text-zinc-500">{when(r.resolvedAt)}{r.decidedBy ? ` · por @${r.decidedBy}` : ''}</span>
            </div>
            {r.owner && <p className="mt-1 text-zinc-600">De @{r.owner}</p>}
            {r.preview && <p className="mt-2 line-clamp-2 break-words rounded-lg bg-zinc-50 px-3 py-1.5">{r.preview}</p>}
            {r.note && <p className="mt-2 text-zinc-700"><span className="font-semibold">Motivo:</span> {r.note}</p>}
          </li>
        ))}
      </ul>
      {q.isSuccess && rows.length === 0 && <p className="py-10 text-center text-zinc-500">Ainda nada por aqui.</p>}
      {q.hasNextPage && <button type="button" onClick={() => void q.fetchNextPage()} className={`${btnGhost} mt-4`}>Mostrar mais</button>}
    </>
  );
}

export default function BackofficeReports() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'open' | 'actioned' | 'dismissed'>('open');
  const open = useQuery({ queryKey: ['admin-reports'], queryFn: () => api.adminQueue(), retry: false });
  const tabBtn = (k: typeof tab, label: string, n?: number) => (
    <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`h-9 rounded-lg px-4 text-sm font-semibold ${tab === k ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-50'}`}>
      {label}{n ? ` (${n})` : ''}
    </button>
  );
  return (
    <>
      <h1 className="text-2xl font-extrabold">Queixas</h1>
      <div role="tablist" className="mt-4 flex gap-2">
        {tabBtn('open', 'Por decidir', open.data?.length)}
        {tabBtn('actioned', 'Com ação')}
        {tabBtn('dismissed', 'Ignoradas')}
      </div>
      <div className="mt-5">
        {tab === 'open' && (
          <>
            {open.isLoading && <p className="text-zinc-500">A carregar…</p>}
            {open.isSuccess && open.data.length === 0 && <p className="py-10 text-center text-zinc-500">Fila vazia: não há queixas por decidir.</p>}
            <ul className="space-y-4">
              {open.data?.map((item) => <OpenItem key={`${item.type}:${item.id}`} item={item} onDone={() => { void qc.invalidateQueries({ queryKey: ['admin-reports'] }); void qc.invalidateQueries({ queryKey: ['bo-decided'] }); void qc.invalidateQueries({ queryKey: ['bo-overview'] }); }} />)}
            </ul>
          </>
        )}
        {tab === 'actioned' && <Decided status="actioned" />}
        {tab === 'dismissed' && <Decided status="dismissed" />}
      </div>
    </>
  );
}
