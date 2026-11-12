import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../../components/Icon';
import { Badge, Empty, Kbd, PageHeader, ago, btn, btnGhost, useCan, when } from './bo';
import { modApi, type ModAction, type ModQueueItem, type ModReason, type ModReportType, type ModSort } from './ui/mod-api';
import { AuthorCard, DecideDialog, Field, MediaThumb, NsfwBadge, REASON, REASONS, REASON_PRESETS, RESOLUTION, SEVERE, Segmented, SeverityPill, TYPE, TYPE_ICON, TextHits, inputCls, selectCls, useDebounced, useToast } from './ui/mod-kit';

type Status = 'open' | 'actioned' | 'dismissed';
const TYPES: ModReportType[] = ['post', 'comment', 'story', 'story_comment', 'instant', 'message', 'user', 'venue', 'media'];
const SORTS: { value: ModSort; label: string }[] = [
  { value: 'severity', label: 'Mais graves primeiro' },
  { value: 'oldest', label: 'Mais antigas primeiro' },
  { value: 'newest', label: 'Mais recentes primeiro' },
  { value: 'reports', label: 'Mais denunciadas' },
];
const key = (i: { type: string; id: string }) => `${i.type}:${i.id}`;

const ACTIONS: Record<ModAction, { label: string; verb: string; kbd: string; cls: string }> = {
  dismiss: { label: 'Arquivar', verb: 'Arquivar', kbd: 'I', cls: `${btn} border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50` },
  warn: { label: 'Avisar o autor', verb: 'Enviar aviso', kbd: 'A', cls: `${btn} bg-sky-600 text-white hover:bg-sky-700` },
  remove: { label: 'Remover o conteúdo', verb: 'Remover', kbd: 'R', cls: `${btn} bg-amber-500 text-white hover:bg-amber-600` },
  suspend: { label: 'Suspender a conta', verb: 'Suspender', kbd: 'S', cls: `${btn} bg-red-700 text-white hover:bg-red-800` },
};
const canRemove = (t: ModReportType) => t !== 'user' && t !== 'venue';
const sensitive = (it: ModQueueItem) => it.reasons.some((r) => r === 'nudity' || r === 'minor' || r === 'violence') || (it.nsfw ?? 0) >= 0.5;

function MessageBody({ m }: { m: { kind: string; body: string; placeName: string | null; placeAddress: string | null; gifUrl: string | null } }) {
  return (
    <div className="px-4 py-3 text-[15px] leading-relaxed">
      {m.kind !== 'text' && <Badge>{m.kind === 'location' ? 'Sítio' : m.kind === 'gif' ? 'GIF' : m.kind}</Badge>}
      {m.body && <p className="mt-1 whitespace-pre-wrap break-words">{m.body}</p>}
      {m.placeName && <p className="mt-1 text-sm text-zinc-600">{m.placeName}{m.placeAddress ? ` · ${m.placeAddress}` : ''}</p>}
      {m.gifUrl && <img src={m.gifUrl} alt="GIF" className="mt-2 max-h-48 rounded-lg" />}
    </div>
  );
}

/** O conteúdo denunciado: fotos (desfocadas quando o motivo é sensível), texto e, nas mensagens, a cópia guardada na denúncia. */
function Preview({ item }: { item: ModQueueItem }) {
  return (
    <div className="space-y-3">
      {item.media.length > 0 && (
        <div className={item.media.length === 1 ? '' : 'grid grid-cols-2 gap-2 sm:grid-cols-3'}>
          {item.media.map((m) => <MediaThumb key={m.id} m={m} size={item.media.length === 1 ? 'lg' : 'md'} blur={sensitive(item)} />)}
        </div>
      )}
      {item.type === 'message' && item.reported ? (
        <div className="rounded-xl border border-zinc-200">
          <p className="flex flex-wrap items-center justify-between gap-x-2 border-b border-zinc-100 px-4 py-2 text-xs font-semibold text-zinc-500">
            <span>Cópia guardada na denúncia</span>
            <span className="font-normal">fica até 180 dias depois da decisão</span>
          </p>
          <MessageBody m={item.reported} />
          {item.current && (
            <div className="border-t border-dashed border-zinc-200 bg-zinc-50/60">
              <p className="px-4 pt-2 text-xs font-semibold text-zinc-500">{item.current.deleted ? 'Agora: a mensagem foi apagada' : 'Agora (foi editada depois da denúncia)'}</p>
              {!item.current.deleted && <MessageBody m={{ ...item.current, kind: item.current.kind ?? 'text', gifUrl: null }} />}
            </div>
          )}
        </div>
      ) : (
        <p className="whitespace-pre-wrap break-words rounded-xl border border-zinc-200 px-4 py-3 text-[15px] leading-relaxed text-zinc-800">
          {item.preview || <span className="text-zinc-400">{item.media.length ? '(só imagem)' : '(sem texto)'}</span>}
        </p>
      )}
      {(item.textHits.length > 0 || item.nsfw != null) && (
        <div className="flex flex-wrap items-center gap-2">
          <TextHits hits={item.textHits} />
          <NsfwBadge score={item.nsfw} />
        </div>
      )}
    </div>
  );
}

const REMOVED: Record<string, string> = { moderation: 'Já removido pela equipa', author: 'Apagado pelo autor', expired: 'Já expirou', gone: 'Já não existe' };
const HISTORY: Record<string, string> = {
  'backoffice.suspend': 'Conta suspensa', 'moderation.suspend': 'Conta suspensa (queixa)', 'backoffice.reactivate': 'Conta reativada',
  'moderation.warn': 'Avisado', 'moderation.remove': 'Conteúdo removido (queixa)', 'moderation.content_remove': 'Conteúdo removido', 'moderation.content_restore': 'Conteúdo reposto',
};

/** O detalhe de uma queixa: conteúdo, quem denunciou, o historial do autor e as ações. */
function Detail({ item, status, onAct, onBack }: { item: ModQueueItem; status: Status; onAct: (a: ModAction, items: ModQueueItem[]) => void; onBack?: () => void }) {
  const canDecide = useCan('reports.decide');
  const canSuspend = useCan('users.suspend');
  const d = useQuery({ queryKey: ['mod-detail', item.type, item.id], queryFn: () => modApi.detail(item.type, item.id), staleTime: 15_000 });
  const allowed = (a: ModAction) =>
    canDecide && status === 'open' && (a === 'remove' ? canRemove(item.type) : a === 'suspend' ? canSuspend && !!item.owner && item.owner.status === 'active' : a === 'warn' ? !!item.owner : true);
  // Atalhos: I arquivar, A avisar, R remover, S suspender (fora dos campos de texto e das janelas).
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,textarea,select') || document.querySelector('[data-mod-dialog]') || e.ctrlKey || e.metaKey || e.altKey) return;
      const a = ({ i: 'dismiss', a: 'warn', r: 'remove', s: 'suspend' } as Record<string, ModAction>)[e.key];
      if (a && allowed(a)) { e.preventDefault(); onAct(a, [item]); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  return (
    <article className="rounded-2xl bg-white p-4 shadow-[0_1px_2px_rgba(15,18,25,0.06)] ring-1 ring-zinc-200/70 sm:p-6">
      {onBack && <button type="button" onClick={onBack} className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-zinc-600"><Icon name="chevron-left" size={16} /> Voltar à fila</button>}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone="blue">{TYPE[item.type]}</Badge>
        <SeverityPill value={item.severity} />
        {item.reasons.map((r) => <Badge key={r} tone={SEVERE.has(r) ? 'red' : 'amber'}>{REASON[r] ?? r}</Badge>)}
        <span className="font-bold text-brand">{item.reports} {item.reports === 1 ? 'denúncia' : 'denúncias'}</span>
        {item.automatic && <Badge>verificação automática</Badge>}
        <span className="ml-auto text-xs text-zinc-500">a primeira {ago(item.firstAt)}</span>
      </div>
      {item.removed && <p className="mt-3 rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-700">{REMOVED[item.removed]}</p>}
      {status !== 'open' && item.resolution && (
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          <b>{RESOLUTION[item.resolution] ?? item.resolution}</b>{item.decidedBy ? ` por ${item.decidedBy}` : ''}{item.resolvedAt ? ` · ${when(item.resolvedAt)}` : ''}{item.resolutionNote ? ` — ${item.resolutionNote}` : ''}
        </p>
      )}

      <div className="mt-4"><AuthorCard a={item.owner} /></div>
      <div className="mt-4"><Preview item={item} /></div>
      <div className="mt-2 flex flex-wrap gap-3 text-sm">
        {item.owner && <Link to={`/backoffice/content?author=${encodeURIComponent(item.owner.username)}`} className="font-semibold text-zinc-700 underline-offset-2 hover:underline">Ver o conteúdo do autor</Link>}
        {item.type === 'venue' && <Link to="/backoffice/venues" className="font-semibold text-zinc-700 underline-offset-2 hover:underline">Abrir em Locais</Link>}
      </div>

      {status === 'open' && (
        canDecide ? (
          <div className="mt-5 flex flex-wrap gap-2">
            {(Object.keys(ACTIONS) as ModAction[]).filter(allowed).map((a) => (
              <button key={a} type="button" onClick={() => onAct(a, [item])} className={ACTIONS[a].cls}>
                {ACTIONS[a].label} <span className="ml-2 hidden opacity-80 sm:inline"><Kbd>{ACTIONS[a].kbd}</Kbd></span>
              </button>
            ))}
          </div>
        ) : <p className="mt-4 text-sm text-zinc-500">A tua equipa só pode ler as queixas.</p>
      )}

      <section className="mt-6 grid gap-5 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-500">Quem denunciou</h3>
          <ul className="space-y-1.5 text-sm">
            {d.data?.reports.map((r) => (
              <li key={r.id} className="rounded-lg bg-zinc-50 px-3 py-2">
                <span className="font-semibold">{r.reporter ? `@${r.reporter}` : 'Verificação automática'}</span> · {REASON[r.reason] ?? r.reason} <span className="text-xs text-zinc-500">· {ago(r.at)}</span>
                {r.note && <p className="mt-0.5 break-words text-zinc-600">«{r.note}»</p>}
              </li>
            ))}
            {d.isLoading && <li className="h-10 animate-pulse rounded-lg bg-zinc-100" />}
          </ul>
        </div>
        <div>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-500">Historial do autor</h3>
          <ul className="space-y-1.5 text-sm">
            {d.data?.history.map((h, i) => (
              <li key={i} className="rounded-lg bg-zinc-50 px-3 py-2">
                <span className="font-semibold">{HISTORY[h.action] ?? h.action}</span> <span className="text-xs text-zinc-500">· {when(h.at)}</span>
                {h.reason && <p className="mt-0.5 break-words text-zinc-600">{h.reason}</p>}
              </li>
            ))}
            {d.data?.past.slice(0, 8).map((p) => (
              <li key={key(p)} className="flex flex-wrap items-center gap-1.5 rounded-lg px-3 py-1.5 ring-1 ring-zinc-100">
                <Badge>{TYPE[p.type] ?? p.type}</Badge>
                <span className="text-zinc-700">{p.reports}× {p.reasons.map((r) => REASON[r] ?? r).join(', ')}</span>
                <span className="ml-auto text-xs text-zinc-500">{p.status === 'open' ? 'por decidir' : RESOLUTION[p.resolution ?? ''] ?? p.status} · {ago(p.at)}</span>
              </li>
            ))}
            {d.isSuccess && !d.data.history.length && !d.data.past.length && <li className="text-zinc-500">Sem queixas nem ações anteriores.</li>}
          </ul>
        </div>
      </section>
    </article>
  );
}

function Row({ it, active, checked, onOpen, onCheck, selectable }: { it: ModQueueItem; active: boolean; checked: boolean; onOpen: () => void; onCheck: (v: boolean) => void; selectable: boolean }) {
  const s = it.media[0];
  const dot = it.severity >= 85 ? 'bg-red-600' : it.severity >= 55 ? 'bg-amber-500' : it.severity >= 30 ? 'bg-sky-500' : 'bg-zinc-400';
  return (
    <li className={`flex gap-2 rounded-xl p-2.5 ring-1 transition ${active ? 'bg-white shadow-sm ring-zinc-900' : 'bg-white/80 ring-zinc-200 hover:bg-white'}`}>
      {selectable && <input type="checkbox" checked={checked} onChange={(e) => onCheck(e.target.checked)} aria-label="Selecionar" className="mt-1 h-4 w-4 shrink-0 accent-zinc-900" />}
      <button type="button" onClick={onOpen} aria-current={active} className="flex min-w-0 flex-1 gap-2.5 text-left">
        {s && <MediaThumb m={s} size="sm" blur={sensitive(it)} />}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-xs">
            <Icon name={TYPE_ICON[it.type]} size={13} className="text-zinc-500" />
            <span className="font-semibold text-zinc-700">{TYPE[it.type]}</span>
            <span className="font-bold text-brand">{it.reports}×</span>
            <span className="ml-auto shrink-0 text-zinc-400">{ago(it.firstAt)}</span>
          </span>
          <span className="mt-1 line-clamp-2 block break-words text-sm text-zinc-800">{it.preview || (it.media.length ? '(foto)' : '(sem texto)')}</span>
          <span className="mt-1 flex items-center gap-2">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden />
            <span className="truncate text-xs text-zinc-500">{it.reasons.map((r) => REASON[r] ?? r).join(', ')}{it.owner ? ` · @${it.owner.username}` : ''}</span>
            {it.resolution && <span className="ml-auto shrink-0 text-[11px] font-semibold text-zinc-500">{RESOLUTION[it.resolution] ?? it.resolution}</span>}
          </span>
        </span>
      </button>
    </li>
  );
}

/** A fila de queixas: filtros, ordenação, seleção em lote, pré-visualização e decisões com motivo (tudo na auditoria). */
export default function BackofficeReports() {
  const qc = useQueryClient();
  const toast = useToast();
  const canDecide = useCan('reports.decide');
  const canSuspend = useCan('users.suspend');
  const [status, setStatus] = useState<Status>('open');
  const [type, setType] = useState<'' | ModReportType>('');
  const [reason, setReason] = useState<'' | ModReason>('');
  const [sort, setSort] = useState<ModSort>('severity');
  const [text, setText] = useState('');
  const q = useDebounced(text.trim());
  const [selKey, setSelKey] = useState('');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pending, setPending] = useState<{ action: ModAction; items: ModQueueItem[] } | null>(null);

  const list = useQuery({
    queryKey: ['mod-queue', status, type, reason, sort, q],
    queryFn: () => modApi.queue({ status, type: type || undefined, reason: reason || undefined, sort, q: q || undefined }),
    refetchInterval: status === 'open' ? 60_000 : false,
  });
  const items = useMemo(() => list.data?.items ?? [], [list.data]);
  const cur = items.find((i) => key(i) === selKey) ?? items[0];
  const counts = list.data?.counts ?? {};
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  useEffect(() => { setChecked(new Set()); }, [status, type, reason, q]);

  // J/K para andar na fila, X para selecionar.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,textarea,select') || document.querySelector('[data-mod-dialog]') || e.ctrlKey || e.metaKey) return;
      const i = cur ? items.indexOf(cur) : -1;
      if (e.key === 'j' && items[i + 1]) setSelKey(key(items[i + 1]));
      if (e.key === 'k' && i > 0) setSelKey(key(items[i - 1]));
      if (e.key === 'x' && cur && status === 'open') setChecked((s) => { const n = new Set(s); if (n.has(key(cur))) n.delete(key(cur)); else n.add(key(cur)); return n; });
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [items, cur, status]);

  const chosen = items.filter((i) => checked.has(key(i)));
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['mod-queue'] });
    void qc.invalidateQueries({ queryKey: ['mod-detail'] });
    void qc.invalidateQueries({ queryKey: ['bo-overview'] });
  };
  async function decide(action: ModAction, its: ModQueueItem[], note: string, notify: boolean) {
    const r = await modApi.decide(its.map((i) => ({ type: i.type, id: i.id })), action, note, notify);
    if (r.done.length === 0 && r.failed.length) throw new Error(r.failed[0].error);
    setPending(null);
    setChecked(new Set());
    setMobileOpen(false);
    // Passa à seguinte da fila.
    const start = items.indexOf(its[0]);
    const next = items.find((i, n) => n > start && !r.done.some((x) => key(x) === key(i)));
    setSelKey(next ? key(next) : '');
    toast.show(
      r.failed.length ? `${r.done.length} decididas; ${r.failed.length} falharam: ${r.failed[0].error}` : `${r.done.length === 1 ? 'Feito' : `${r.done.length} decididas`}: ${RESOLUTION[action]}`,
      r.failed.length ? 'err' : 'ok',
    );
    refresh();
  }
  const bulkAllowed = (a: ModAction) =>
    chosen.length > 0 && (a === 'remove' ? chosen.every((i) => canRemove(i.type)) : a === 'suspend' ? canSuspend && chosen.every((i) => i.owner) : a === 'warn' ? chosen.every((i) => i.owner) : true);

  return (
    <>
      <PageHeader title="Queixas" description="Decide com um motivo escrito: o autor é avisado e tudo fica na auditoria. Atalhos: J/K andar, X selecionar, I arquivar, A avisar, R remover, S suspender." />
      <div role="tablist" aria-label="Estado" className="mb-4 flex flex-wrap gap-2">
        {([['open', 'Por decidir', total], ['actioned', 'Com ação'], ['dismissed', 'Arquivadas']] as [Status, string, number?][]).map(([k, l, c]) => (
          <button key={k} type="button" role="tab" aria-selected={status === k} onClick={() => { setStatus(k); setSort(k === 'open' ? 'severity' : 'newest'); setSelKey(''); }} className={`h-9 rounded-lg px-4 text-sm font-semibold ${status === k ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-50'}`}>
            {l}{c ? ` (${c})` : ''}
          </button>
        ))}
      </div>

      <div className="mb-4 space-y-3 rounded-2xl bg-white p-3 ring-1 ring-zinc-200/70 sm:p-4">
        <Segmented label="Tipo" value={type} onChange={setType} options={[{ value: '' as const, label: 'Todos', count: status === 'open' ? total : undefined }, ...TYPES.map((t) => ({ value: t, label: TYPE[t], count: status === 'open' ? counts[t] : undefined }))]} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_180px_220px]">
          <Field label="Autor" className="col-span-2 sm:col-span-1"><input value={text} onChange={(e) => setText(e.target.value)} placeholder="@ ou nome" className={inputCls} /></Field>
          <Field label="Motivo">
            <select value={reason} onChange={(e) => setReason(e.target.value as ModReason | '')} className={`${selectCls} w-full`}>
              <option value="">Todos</option>
              {REASONS.map((r) => <option key={r} value={r}>{REASON[r]}</option>)}
            </select>
          </Field>
          <Field label="Ordenar">
            <select value={sort} onChange={(e) => setSort(e.target.value as ModSort)} className={`${selectCls} w-full`}>
              {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </Field>
        </div>
      </div>

      {status === 'open' && canDecide && chosen.length > 0 && (
        <div className="sticky top-2 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-zinc-900 px-3 py-2 text-sm text-white shadow-lg">
          <span className="font-semibold">{chosen.length} selecionada{chosen.length === 1 ? '' : 's'}</span>
          <button type="button" onClick={() => setChecked(new Set())} className="text-zinc-300 underline">limpar</button>
          <span className="ml-auto flex flex-wrap gap-1.5">
            {(['dismiss', 'warn', 'remove', 'suspend'] as ModAction[]).filter(bulkAllowed).map((a) => (
              <button key={a} type="button" onClick={() => setPending({ action: a, items: chosen })} className="h-8 rounded-lg bg-white/10 px-3 font-semibold hover:bg-white/20">{ACTIONS[a].verb}</button>
            ))}
          </span>
        </div>
      )}

      {list.isLoading ? (
        <div className="grid gap-2">{[0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-white" />)}</div>
      ) : list.isError ? (
        <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">Não foi possível carregar a fila. {(list.error as Error).message}</p>
      ) : items.length === 0 ? (
        <Empty title={status === 'open' ? 'Fila vazia' : 'Nada por aqui'} text={status === 'open' ? 'Não há queixas por decidir com estes filtros.' : 'Sem queixas decididas com estes filtros.'} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
          <div>
            {status === 'open' && canDecide && (
              <label className="mb-2 flex items-center gap-2 px-1 text-xs font-semibold text-zinc-600">
                <input type="checkbox" checked={chosen.length === items.length} onChange={(e) => setChecked(e.target.checked ? new Set(items.map(key)) : new Set())} className="h-4 w-4 accent-zinc-900" />
                Selecionar todas ({items.length})
              </label>
            )}
            <ul className="space-y-2 lg:max-h-[calc(100vh-17rem)] lg:overflow-y-auto lg:pr-1" aria-label="Queixas">
              {items.map((it) => (
                <Row
                  key={key(it)}
                  it={it}
                  active={cur === it}
                  checked={checked.has(key(it))}
                  selectable={status === 'open' && canDecide}
                  onCheck={(v) => setChecked((s) => { const n = new Set(s); if (v) n.add(key(it)); else n.delete(key(it)); return n; })}
                  onOpen={() => { setSelKey(key(it)); setMobileOpen(true); }}
                />
              ))}
            </ul>
          </div>
          {cur && <div className="hidden lg:block"><Detail item={cur} status={status} onAct={(action, its) => setPending({ action, items: its })} /></div>}
        </div>
      )}

      {/* Telemóvel e ecrãs estreitos: o detalhe abre por cima da lista. */}
      {mobileOpen && cur && (
        <div className="fixed inset-0 z-40 overflow-y-auto bg-[#f5f6f8] p-3 lg:hidden" role="dialog" aria-modal="true" aria-label="Queixa">
          <Detail item={cur} status={status} onBack={() => setMobileOpen(false)} onAct={(action, its) => setPending({ action, items: its })} />
        </div>
      )}

      {pending && (
        <DecideDialog
          title={`${ACTIONS[pending.action].verb}${pending.items.length > 1 ? ` (${pending.items.length} queixas)` : ''}`}
          help={
            pending.action === 'dismiss' ? 'Fecha as denúncias sem ação. O autor não é avisado.'
            : pending.action === 'remove' ? 'O conteúdo deixa de se ver. Publicações, comentários e mimos podem ser repostos em «Conteúdo»; mensagens e fotos automáticas não.'
            : pending.action === 'warn' ? 'O autor recebe um aviso da equipa do Txillapp com o motivo. O conteúdo fica.'
            : <>{pending.items.length > 1 ? 'A conta de cada autor' : `A conta de @${pending.items[0].owner?.username}`} fica suspensa e perde as sessões.</>
          }
          confirm={ACTIONS[pending.action].verb}
          danger={pending.action === 'suspend' || pending.action === 'remove'}
          reasonRequired={pending.action !== 'dismiss'}
          presets={pending.action === 'dismiss' ? ['Não viola as regras', 'Denúncia repetida', 'Já tratado'] : REASON_PRESETS}
          notifyOption={pending.action === 'remove' || pending.action === 'warn' ? 'Avisar o autor (vê o motivo na app)' : undefined}
          onCancel={() => setPending(null)}
          onConfirm={(note, notify) => decide(pending.action, pending.items, note, notify)}
        />
      )}
      {toast.node}
      <p className="mt-6 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
        A gravidade junta o motivo mais grave (menores, violência, ódio, nudez…) e quantas pessoas denunciaram.
        <button type="button" className={`${btnGhost} h-7 px-2 text-xs`} onClick={refresh}>Atualizar</button>
      </p>
    </>
  );
}
