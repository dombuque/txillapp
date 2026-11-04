import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type ReportQueueItem } from '../../lib/api';
import { Badge, Empty, Kbd, PageHeader, ago, btn, btnGhost, useCan, when } from './bo';

const REASON: Record<string, string> = { spam: 'Spam', harassment: 'Assédio', hate: 'Ódio', nudity: 'Nudez', violence: 'Violência', scam: 'Burla', impersonation: 'Falsa identidade', minor: 'Menores', other: 'Outro' };
const TYPE: Record<string, string> = { post: 'Publicação', comment: 'Comentário', story: 'Story', user: 'Conta', message: 'Mensagem', media: 'Foto (automático)' };
const RESOLUTION: Record<string, string> = { dismiss: 'Ignorada', remove: 'Conteúdo removido', suspend: 'Conta suspensa' };
const SEVERE = new Set(['minor', 'nudity', 'violence', 'hate']);

/** O detalhe de uma queixa: conteúdo, quem denunciou e porquê; decide-se com um motivo escrito (ou com atalhos). */
function Detail({ item, canDecide, onDone, noteRef }: { item: ReportQueueItem; canDecide: boolean; onDone: () => void; noteRef: React.RefObject<HTMLInputElement> }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { setNote(''); setErr(''); }, [item.type, item.id]);

  async function act(action: 'dismiss' | 'remove' | 'suspend') {
    if (!canDecide || busy) return;
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
  // Atalhos: i = ignorar, r = remover, s = suspender (fora dos campos de texto).
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input,textarea,select') || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'i') void act('dismiss');
      else if (e.key === 'r' && item.type !== 'user') void act('remove');
      else if (e.key === 's' && item.owner) void act('suspend');
      else if (e.key === 'n') { e.preventDefault(); noteRef.current?.focus(); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  return (
    <div className="rounded-2xl bg-white p-6 shadow-[0_1px_2px_rgba(15,18,25,0.06)] ring-1 ring-zinc-200/70">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone="blue">{TYPE[item.type]}</Badge>
        {item.reasons.map((r) => <Badge key={r} tone={SEVERE.has(r) ? 'red' : 'amber'}>{REASON[r] ?? r}</Badge>)}
        <span className="font-bold text-brand">{item.reports} {item.reports === 1 ? 'denúncia' : 'denúncias'}</span>
        <span className="ml-auto text-xs text-zinc-500">a mais antiga {ago(item.firstAt)}</span>
      </div>
      {item.owner && (
        <div className="mt-4 flex items-center gap-3 rounded-xl bg-zinc-50 px-4 py-3 text-sm">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-200 font-bold text-zinc-600">{item.owner.username[0].toUpperCase()}</span>
          <span className="min-w-0 flex-1">
            <Link to={`/backoffice/users?q=${encodeURIComponent(item.owner.username)}`} className="font-semibold underline-offset-2 hover:underline">@{item.owner.username}</Link>
            <span className="block text-xs text-zinc-500">{item.owner.displayName}{item.owner.strikes > 0 ? ` · ${item.owner.strikes} ação(ões) anteriores` : ' · sem ações anteriores'}</span>
          </span>
          {item.owner.status !== 'active' && <Badge tone="red">{item.owner.status}</Badge>}
        </div>
      )}
      {item.imageUrl && <img src={item.imageUrl} alt="Foto assinalada" className="mt-4 max-h-80 rounded-xl bg-zinc-100 object-contain" />}
      <p className="mt-4 whitespace-pre-wrap break-words rounded-xl border border-zinc-200 px-4 py-3 text-[15px] leading-relaxed">{item.preview || '(sem texto)'}</p>
      {canDecide ? (
        <>
          <input ref={noteRef} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Motivo da decisão (opcional, fica no registo)" aria-label="Motivo" className="mt-4 h-10 w-full rounded-lg border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900" />
          {err && <p role="alert" className="mt-2 text-sm text-red-600">{err}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            <button disabled={busy} onClick={() => void act('dismiss')} className={`${btn} border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50`}>Ignorar <span className="ml-2"><Kbd>I</Kbd></span></button>
            {item.type !== 'user' && <button disabled={busy} onClick={() => void act('remove')} className={`${btn} bg-amber-500 text-white hover:bg-amber-600`}>Remover o conteúdo <span className="ml-2 opacity-80"><Kbd>R</Kbd></span></button>}
            <button disabled={busy || !item.owner} onClick={() => void act('suspend')} className={`${btn} bg-red-700 text-white hover:bg-red-800`}>Suspender a conta <span className="ml-2 opacity-80"><Kbd>S</Kbd></span></button>
          </div>
        </>
      ) : <p className="mt-4 text-sm text-zinc-500">A tua equipa só pode ler as queixas.</p>}
    </div>
  );
}

/** A fila: lista à esquerda (j/k para andar) e o detalhe à direita. */
function OpenQueue() {
  const qc = useQueryClient();
  const canDecide = useCan('reports.decide');
  const q = useQuery({ queryKey: ['admin-reports'], queryFn: () => api.adminQueue(), retry: false });
  const [sel, setSel] = useState(0);
  const noteRef = useRef<HTMLInputElement>(null);
  const items = q.data ?? [];
  const cur = items[Math.min(sel, Math.max(0, items.length - 1))];
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,textarea,select') || e.ctrlKey || e.metaKey) return;
      if (e.key === 'j') setSel((i) => Math.min(items.length - 1, i + 1));
      if (e.key === 'k') setSel((i) => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [items.length]);

  if (q.isLoading) return <p className="text-zinc-500">A carregar…</p>;
  if (items.length === 0) return <Empty title="Fila vazia" text="Não há queixas por decidir. Bom trabalho." />;
  return (
    <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
      <ul className="space-y-2 lg:max-h-[calc(100vh-14rem)] lg:overflow-y-auto lg:pr-1" aria-label="Queixas por decidir">
        {items.map((it, i) => (
          <li key={`${it.type}:${it.id}`}>
            <button type="button" onClick={() => setSel(i)} aria-current={cur === it} className={`w-full rounded-xl p-3 text-left ring-1 transition ${cur === it ? 'bg-white ring-zinc-900 shadow-sm' : 'bg-white/70 ring-zinc-200 hover:bg-white'}`}>
              <div className="flex items-center gap-2 text-xs"><Badge tone="blue">{TYPE[it.type]}</Badge><span className="font-bold text-brand">{it.reports}×</span><span className="ml-auto text-zinc-400">{ago(it.firstAt)}</span></div>
              <p className="mt-1.5 line-clamp-2 text-sm text-zinc-700">{it.preview || (it.imageUrl ? '(foto)' : '(sem texto)')}</p>
              <p className="mt-1 truncate text-xs text-zinc-500">{it.reasons.map((r) => REASON[r] ?? r).join(', ')}{it.owner ? ` · @${it.owner.username}` : ''}</p>
            </button>
          </li>
        ))}
      </ul>
      {cur && <Detail item={cur} canDecide={canDecide} noteRef={noteRef} onDone={() => { void qc.invalidateQueries({ queryKey: ['admin-reports'] }); void qc.invalidateQueries({ queryKey: ['bo-decided'] }); void qc.invalidateQueries({ queryKey: ['bo-overview'] }); }} />}
    </div>
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
          <li key={`${r.type}:${r.id}`} className="rounded-2xl bg-white p-4 text-sm ring-1 ring-zinc-200/70">
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
      {q.isSuccess && rows.length === 0 && <Empty title="Ainda nada por aqui" />}
      {q.hasNextPage && <button type="button" onClick={() => void q.fetchNextPage()} className={`${btnGhost} mt-4`}>Mostrar mais</button>}
    </>
  );
}

export default function BackofficeReports() {
  const [tab, setTab] = useState<'open' | 'actioned' | 'dismissed'>('open');
  const open = useQuery({ queryKey: ['admin-reports'], queryFn: () => api.adminQueue(), retry: false });
  const tabBtn = (k: typeof tab, label: string, n?: number) => (
    <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`h-9 rounded-lg px-4 text-sm font-semibold ${tab === k ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-50'}`}>
      {label}{n ? ` (${n})` : ''}
    </button>
  );
  return (
    <>
      <PageHeader title="Queixas" description="Decide com um motivo escrito. Atalhos na fila: J/K para andar, I ignorar, R remover, S suspender, N para escrever o motivo." />
      <div role="tablist" className="mb-5 flex gap-2">
        {tabBtn('open', 'Por decidir', open.data?.length)}
        {tabBtn('actioned', 'Com ação')}
        {tabBtn('dismissed', 'Ignoradas')}
      </div>
      {tab === 'open' && <OpenQueue />}
      {tab === 'actioned' && <Decided status="actioned" />}
      {tab === 'dismissed' && <Decided status="dismissed" />}
    </>
  );
}
