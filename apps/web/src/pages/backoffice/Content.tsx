import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Icon from '../../components/Icon';
import { Badge, Empty, PageHeader, ago, btn, btnGhost, useCan, when } from './bo';
import { modApi, type ModContentItem } from './ui/mod-api';
import { AuthorCard, DecideDialog, Field, MediaThumb, NsfwBadge, REASON_PRESETS, Segmented, TextHits, inputCls, useDebounced, useToast } from './ui/mod-kit';

const TYPES = [
  { value: 'all', label: 'Tudo' },
  { value: 'post', label: 'Publicações' },
  { value: 'tcheka', label: 'Tchekas' },
  { value: 'story', label: 'Mimos' },
  { value: 'comment', label: 'Comentários' },
] as const;
const STATES = [
  { value: 'all', label: 'Tudo' },
  { value: 'visible', label: 'À vista' },
  { value: 'removed', label: 'Removidos' },
] as const;
const FLAGS = [
  { value: '', label: 'Sem filtro' },
  { value: 'nsfw', label: 'Modelo de fotos' },
  { value: 'text', label: 'Filtro de texto' },
] as const;

const label = (it: ModContentItem) => (it.type === 'comment' ? 'Comentário' : it.type === 'story' ? 'Mimo' : it.gift ? 'Presente' : it.tcheka ? 'Tcheka' : 'Publicação');
const STATE: Record<ModContentItem['state'], { text: string; tone: 'green' | 'red' | 'zinc' | 'amber' }> = {
  visible: { text: 'À vista', tone: 'green' },
  removed: { text: 'Removido pela equipa', tone: 'red' },
  deleted: { text: 'Apagado pelo autor', tone: 'zinc' },
  expired: { text: 'Expirado', tone: 'zinc' },
};

function Card({ it, canAct, onAct }: { it: ModContentItem; canAct: boolean; onAct: (a: 'remove' | 'restore', it: ModContentItem) => void }) {
  const [open, setOpen] = useState(false);
  const long = it.body.length > 220;
  return (
    <li className="flex flex-col rounded-2xl bg-white p-4 shadow-[0_1px_2px_rgba(15,18,25,0.06)] ring-1 ring-zinc-200/70">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <Badge tone="blue">{label(it)}</Badge>
        <Badge tone={STATE[it.state].tone}>{STATE[it.state].text}</Badge>
        {it.openReports > 0 && <Link to="/backoffice/reports"><Badge tone="amber">{it.openReports} {it.openReports === 1 ? 'denúncia' : 'denúncias'}</Badge></Link>}
        <span className="ml-auto text-zinc-400" title={when(it.createdAt)}>{ago(it.createdAt)}</span>
      </div>
      {it.media.length > 0 && (
        <div className="mt-3 flex gap-2 overflow-x-auto">
          {it.media.slice(0, 4).map((m) => <MediaThumb key={m.id} m={m} size={it.media.length === 1 ? 'wide' : 'md'} blur={it.nsfwFlagged} />)}
        </div>
      )}
      <p className={`mt-3 whitespace-pre-wrap break-words text-[14.5px] leading-relaxed text-zinc-800 ${!open && long ? 'line-clamp-5' : ''}`}>{it.body || <span className="text-zinc-400">(sem texto)</span>}</p>
      {long && <button type="button" onClick={() => setOpen((v) => !v)} className="mt-1 self-start text-xs font-semibold text-zinc-500 hover:text-zinc-800">{open ? 'Mostrar menos' : 'Mostrar tudo'}</button>}
      {(it.textHits.length > 0 || it.nsfw != null) && (
        <div className="mt-2 flex flex-wrap gap-1.5"><TextHits hits={it.textHits} /><NsfwBadge score={it.nsfw} /></div>
      )}
      {it.removal && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-900">
          <b>Removido</b> {ago(it.removal.at)}{it.removal.by ? ` por ${it.removal.by}` : ''}: {it.removal.reason}
        </p>
      )}
      <div className="mt-3 border-t border-zinc-100 pt-3"><AuthorCard a={it.author} compact /></div>
      {canAct && (it.state === 'visible' || it.state === 'removed') && (
        <div className="mt-3 flex gap-2">
          {it.state === 'visible'
            ? <button type="button" onClick={() => onAct('remove', it)} className={`${btn} flex-1 bg-amber-500 text-white hover:bg-amber-600`}><Icon name="trash" size={15} className="mr-1.5" />Remover</button>
            : <button type="button" onClick={() => onAct('restore', it)} className={`${btn} flex-1 border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50`}><Icon name="undo" size={15} className="mr-1.5" />Repor</button>}
        </div>
      )}
    </li>
  );
}

/** «Conteúdo»: pesquisar publicações, tchekas, mimos e comentários; ver o que o modelo de fotos e o filtro de texto assinalaram; remover e repor. */
export default function BackofficeContent() {
  const qc = useQueryClient();
  const toast = useToast();
  const canAct = useCan('content.moderate');
  const [params] = useSearchParams();
  const [type, setType] = useState<string>('all');
  const [state, setState] = useState<string>('all');
  const [flag, setFlag] = useState<string>('');
  const [q, setQ] = useState('');
  const [author, setAuthor] = useState(params.get('author') ?? '');
  const [tag, setTag] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const f = { type, state, flag: flag || undefined, q: useDebounced(q.trim()) || undefined, author: useDebounced(author.trim()) || undefined, tag: useDebounced(tag.trim()) || undefined, from: from || undefined, to: to || undefined };
  const [pending, setPending] = useState<{ action: 'remove' | 'restore'; it: ModContentItem } | null>(null);

  const list = useInfiniteQuery({
    queryKey: ['mod-content', f],
    queryFn: ({ pageParam }) => modApi.content(f, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  const rules = list.data?.pages[0]?.rules ?? [];
  const threshold = list.data?.pages[0]?.nsfwThreshold ?? 0.5;
  const filtered = !!(f.q || f.author || f.tag || f.from || f.to || f.flag || type !== 'all' || state !== 'all');
  const clear = () => { setType('all'); setState('all'); setFlag(''); setQ(''); setAuthor(''); setTag(''); setFrom(''); setTo(''); };

  async function act(reason: string, notify: boolean) {
    if (!pending) return;
    const { action, it } = pending;
    if (action === 'remove') {
      await modApi.remove(it.type, it.id, reason, notify);
      toast.show(`${label(it)} removido${notify ? '; o autor foi avisado' : ''}`);
    } else {
      const r = await modApi.restore(it.type, it.id, reason, notify);
      toast.show(r.expired ? 'Reposto, mas o mimo já tinha passado das 24 horas' : `${label(it)} reposto${notify ? '; o autor foi avisado' : ''}`);
    }
    setPending(null);
    void qc.invalidateQueries({ queryKey: ['mod-content'] });
    void qc.invalidateQueries({ queryKey: ['mod-queue'] });
  }

  return (
    <>
      <PageHeader title="Conteúdo" description="Pesquisa o que se publica, revê o que o modelo de fotos e o filtro de texto assinalaram, e remove ou repõe com um motivo. O autor é avisado e tudo fica na auditoria." />
      <div className="mb-4 space-y-3 rounded-2xl bg-white p-3 ring-1 ring-zinc-200/70 sm:p-4">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <Segmented label="Tipo" value={type} onChange={setType} options={TYPES.map((t) => ({ ...t }))} />
          <div className="flex flex-wrap gap-2">
            <Segmented label="Estado" value={state} onChange={setState} options={STATES.map((t) => ({ ...t }))} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          <Field label="Texto" className="col-span-2 md:col-span-1 xl:col-span-2"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Palavras no texto" className={inputCls} /></Field>
          <Field label="Autor"><input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="@utilizador" className={inputCls} /></Field>
          <Field label="Hashtag"><input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="#tema" className={inputCls} /></Field>
          <Field label="Desde"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} /></Field>
          <Field label="Até"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} /></Field>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wide text-zinc-500">Assinalados</span>
          <Segmented label="Assinalados" value={flag} onChange={setFlag} options={FLAGS.map((t) => ({ ...t }))} />
          {filtered && <button type="button" onClick={clear} className="ml-auto text-xs font-semibold text-zinc-500 underline">Limpar filtros</button>}
        </div>
        {flag === 'nsfw' && <p className="text-xs text-zinc-500">Fotos e capas que o modelo local deu com pelo menos {Math.round(threshold * 100)}% de probabilidade de nudez (as acima do limite de recusa nunca chegam a ser publicadas).</p>}
        {flag === 'text' && rules.length > 0 && <p className="text-xs text-zinc-500">O filtro de texto procura termos de: {rules.map((r) => r.label.toLowerCase()).join(', ')}. Só assinala, não bloqueia.</p>}
      </div>

      {list.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="h-56 animate-pulse rounded-2xl bg-white" />)}</div>
      ) : list.isError ? (
        <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">Não foi possível pesquisar. {(list.error as Error).message}</p>
      ) : rows.length === 0 ? (
        <Empty title="Nada encontrado" text={filtered ? 'Experimenta outros filtros.' : 'Ainda não há conteúdo.'} />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((it) => <Card key={`${it.type}:${it.id}`} it={it} canAct={canAct} onAct={(action, x) => setPending({ action, it: x })} />)}
        </ul>
      )}
      {list.hasNextPage && <button type="button" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()} className={`${btnGhost} mt-4`}>{list.isFetchingNextPage ? 'A carregar…' : 'Mostrar mais'}</button>}

      {pending && (
        <DecideDialog
          title={pending.action === 'remove' ? `Remover ${label(pending.it).toLowerCase()}` : `Repor ${label(pending.it).toLowerCase()}`}
          help={pending.action === 'remove'
            ? pending.it.type === 'comment' ? 'O comentário sai com as respostas; fica uma cópia durante 180 dias para o poderes repor.' : 'Deixa de se ver para todos. Podes repor mais tarde.'
            : 'Volta a ficar à vista, como estava.'}
          confirm={pending.action === 'remove' ? 'Remover' : 'Repor'}
          danger={pending.action === 'remove'}
          presets={pending.action === 'remove' ? REASON_PRESETS : ['Revisto: não viola as regras', 'Removido por engano']}
          notifyOption="Avisar o autor (vê o motivo na app)"
          onCancel={() => setPending(null)}
          onConfirm={act}
        />
      )}
      {toast.node}
    </>
  );
}
