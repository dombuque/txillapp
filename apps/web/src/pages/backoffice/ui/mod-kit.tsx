import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import Icon, { type IconName } from '../../../components/Icon';
import { api } from '../../../lib/api';
import { Badge, btnDanger, btnGhost, btnPrimary } from '../bo';
import type { ModAuthorCtx, ModMedia, ModReason, ModReportType, ModTextHit } from './mod-api';

/** Peças da área «Conteúdo e moderação» do backoffice: etiquetas, filtros, pré-visualizações e a janela de decisão. */

export const REASON: Record<ModReason, string> = { spam: 'Spam', harassment: 'Assédio', hate: 'Ódio', nudity: 'Nudez', violence: 'Violência', scam: 'Burla', impersonation: 'Falsa identidade', minor: 'Menores', other: 'Outro' };
export const REASONS = Object.keys(REASON) as ModReason[];
export const TYPE: Record<ModReportType, string> = { post: 'Publicação', comment: 'Comentário', story: 'Mimo', message: 'Mensagem', user: 'Conta', venue: 'Local', media: 'Foto (automático)' };
export const TYPE_ICON: Record<ModReportType, IconName> = { post: 'image', comment: 'comment', story: 'sparkles', message: 'messages', user: 'user', venue: 'store', media: 'eye' };
export const RESOLUTION: Record<string, string> = { dismiss: 'Arquivada', remove: 'Conteúdo removido', warn: 'Autor avisado', suspend: 'Conta suspensa' };
export const SEVERE = new Set<ModReason>(['minor', 'violence', 'hate', 'nudity']);

/** Gravidade (0–130): crítica ≥ 85, alta ≥ 55, média ≥ 30, baixa. */
export function severityOf(n: number): { label: string; tone: 'red' | 'amber' | 'blue' | 'zinc'; bar: string } {
  if (n >= 85) return { label: 'Crítica', tone: 'red', bar: 'bg-red-600' };
  if (n >= 55) return { label: 'Alta', tone: 'amber', bar: 'bg-amber-500' };
  if (n >= 30) return { label: 'Média', tone: 'blue', bar: 'bg-sky-500' };
  return { label: 'Baixa', tone: 'zinc', bar: 'bg-zinc-400' };
}

export function SeverityPill({ value }: { value: number }) {
  const s = severityOf(value);
  return (
    <span className="inline-flex items-center gap-1.5" title={`Gravidade ${value}`}>
      <span className="flex h-1.5 w-10 overflow-hidden rounded-full bg-zinc-200" aria-hidden>
        <span className={`${s.bar} h-full`} style={{ width: `${Math.min(100, Math.round((value / 130) * 100))}%` }} />
      </span>
      <Badge tone={s.tone}>{s.label}</Badge>
    </span>
  );
}

/** Botões de escolha (um só valor), que deslizam na horizontal no telemóvel. */
export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; count?: number }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold transition ${value === o.value ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-50'}`}
        >
          {o.label}
          {o.count != null && o.count > 0 && <span className={`rounded-full px-1.5 text-[11px] ${value === o.value ? 'bg-white/20' : 'bg-zinc-100 text-zinc-600'}`}>{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export const inputCls = 'h-9 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10';
export const selectCls = 'h-9 rounded-lg border border-zinc-300 bg-white px-2.5 text-sm outline-none focus:border-zinc-900';

/** Um campo com etiqueta pequena por cima (filtros). */
export function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`flex min-w-0 flex-col gap-1 text-[11px] font-bold uppercase tracking-wide text-zinc-500 ${className}`}>
      {label}
      <span className="normal-case tracking-normal">{children}</span>
    </label>
  );
}

/** Texto que espera um pouco antes de mudar (pesquisas). */
export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** A pontuação do modelo de fotos (0–1) em percentagem, a vermelho a partir do limite. */
export function NsfwBadge({ score, threshold = 0.5 }: { score: number | null; threshold?: number }) {
  if (score == null) return null;
  return <Badge tone={score >= threshold ? 'red' : 'zinc'}>Fotos {Math.round(score * 100)}%</Badge>;
}

export function TextHits({ hits }: { hits: ModTextHit[] }) {
  if (!hits.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {hits.map((h) => (
        <span key={h.term} className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900 ring-1 ring-amber-200" title={`Filtro de texto: ${h.label}`}>
          {h.label} · «{h.term}»
        </span>
      ))}
    </span>
  );
}

/** Uma foto ou capa de vídeo. As fotos assinaladas pela verificação automática pedem-se com a sessão da equipa (e ficam na auditoria). */
export function MediaThumb({ m, size = 'md', blur = false }: { m: ModMedia; size?: 'sm' | 'md' | 'lg' | 'wide'; blur?: boolean }) {
  const [src, setSrc] = useState(m.review ? '' : m.url);
  const [failed, setFailed] = useState(false);
  const [show, setShow] = useState(!blur);
  useEffect(() => {
    if (!m.review) return;
    let live = true;
    let made = '';
    api.boReviewImage(m.url).then((u) => { made = u; if (live) setSrc(u); }).catch(() => live && setFailed(true));
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [m.url, m.review]);
  const box = size === 'sm' ? 'h-14 w-14' : size === 'md' ? 'h-28 w-28' : size === 'wide' ? 'h-52 w-full' : 'h-auto max-h-[420px] w-full';
  if (failed) return <div className={`${size === 'lg' ? 'h-40 w-full' : box} flex items-center justify-center rounded-xl bg-zinc-100 p-2 text-center text-xs text-zinc-500`}>Já não está disponível</div>;
  if (!src) return <div className={`${size === 'lg' ? 'h-40 w-full' : box} animate-pulse rounded-xl bg-zinc-100`} aria-label="A carregar" />;
  return (
    <span className={`relative block shrink-0 overflow-hidden rounded-xl bg-zinc-100 ${size === 'lg' ? 'w-full' : box}`}>
      <img src={src} alt={m.video ? 'Capa do vídeo' : 'Foto'} loading="lazy" onError={() => setFailed(true)} className={`${size === 'lg' ? 'max-h-[420px] w-full object-contain' : 'h-full w-full object-cover'} ${show ? '' : 'scale-110 blur-xl'}`} />
      {m.video && <span className="absolute bottom-1.5 left-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-white">VÍDEO</span>}
      {m.nsfw != null && m.nsfw >= 0.5 && <span className="absolute right-1.5 top-1.5 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">{Math.round(m.nsfw * 100)}%</span>}
      {!show && (
        <button type="button" onClick={() => setShow(true)} className="absolute inset-0 flex items-center justify-center bg-black/30 text-xs font-semibold text-white">
          <span className="flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1"><Icon name="eye" size={14} /> Ver</span>
        </button>
      )}
    </span>
  );
}

/** Quem publicou: @, estado e o historial (queixas, ações, avisos, remoções e suspensões). */
export function AuthorCard({ a, compact = false }: { a: ({ id: string; username: string; displayName: string; status: string } & ModAuthorCtx) | null; compact?: boolean }) {
  if (!a) return <p className="text-sm text-zinc-500">Autor desconhecido</p>;
  const stats: [string, number | undefined, boolean][] = [
    ['queixas', a.reportedItems, (a.reportedItems ?? 0) > 2],
    ['com ação', a.actioned, (a.actioned ?? 0) > 0],
    ['avisos', a.warnings, (a.warnings ?? 0) > 0],
    ['remoções', a.removals, (a.removals ?? 0) > 0],
    ['suspensões', a.suspensions, (a.suspensions ?? 0) > 0],
  ];
  return (
    <div className={`flex items-center gap-3 ${compact ? '' : 'rounded-xl bg-zinc-50 px-3 py-2.5'}`}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-sm font-bold text-zinc-600">{a.username[0]?.toUpperCase()}</span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2">
          <Link to={`/backoffice/users/${a.id}`} className="truncate font-semibold text-zinc-900 underline-offset-2 hover:underline">@{a.username}</Link>
          {a.status !== 'active' && <Badge tone="red">{a.status === 'suspended' ? 'suspensa' : a.status === 'deleted' ? 'eliminada' : a.status}</Badge>}
        </span>
        <span className="mt-0.5 flex flex-wrap gap-x-2.5 gap-y-0.5 text-xs text-zinc-500">
          {stats.filter(([, v]) => v != null).map(([k, v, hot]) => <span key={k} className={hot ? 'font-semibold text-red-700' : ''}>{v} {k}</span>)}
        </span>
      </span>
    </div>
  );
}

/** Janela de decisão: o motivo (obrigatório, vai para o registo) e se o autor é avisado. */
export function DecideDialog({ title, help, confirm, danger, notifyOption, reasonRequired = true, presets = [], onCancel, onConfirm }: {
  title: string; help?: ReactNode; confirm: string; danger?: boolean; notifyOption?: string; reasonRequired?: boolean; presets?: string[];
  onCancel: () => void; onConfirm: (reason: string, notify: boolean) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onCancel]);
  async function go() {
    setBusy(true);
    setErr('');
    try {
      await onConfirm(reason.trim(), notify);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }
  const ok = !reasonRequired || reason.trim().length >= 3;
  return (
    <div role="dialog" aria-modal="true" aria-label={title} data-swipe="off" data-mod-dialog className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/50 sm:items-center sm:p-4" onClick={onCancel}>
      <div className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl sm:p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-zinc-900">{title}</h3>
        {help && <div className="mt-1 text-sm text-zinc-600">{help}</div>}
        {presets.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <button key={p} type="button" onClick={() => setReason(p)} className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-200">{p}</button>
            ))}
          </div>
        )}
        <label className="mt-3 block text-sm font-semibold text-zinc-700">
          Motivo {reasonRequired ? '(fica no registo)' : '(opcional, fica no registo)'}
          <textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={300} className="mt-1 w-full rounded-lg border border-zinc-300 p-2.5 text-[15px] outline-none focus:border-zinc-900" />
        </label>
        {notifyOption && (
          <label className="mt-2 flex items-start gap-2 text-sm text-zinc-700">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="mt-0.5 h-4 w-4 accent-zinc-900" />
            <span>{notifyOption}</span>
          </label>
        )}
        {err && <p role="alert" className="mt-2 text-sm text-red-600">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className={btnGhost}>Cancelar</button>
          <button type="button" disabled={busy || !ok} onClick={() => void go()} className={danger ? btnDanger : btnPrimary}>{busy ? 'A guardar…' : confirm}</button>
        </div>
      </div>
    </div>
  );
}

/** Aviso pequeno no canto (resultado de uma ação). */
export function useToast() {
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 4000);
    return () => clearTimeout(t);
  }, [msg]);
  const node = msg ? (
    <div role="status" className={`fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full px-4 py-2 text-sm font-semibold text-white shadow-lg ${msg.tone === 'ok' ? 'bg-zinc-900' : 'bg-red-700'}`}>{msg.text}</div>
  ) : null;
  return { show: (text: string, tone: 'ok' | 'err' = 'ok') => setMsg({ text, tone }), node };
}

/** Motivos prontos a usar (também o que o autor lê quando é avisado). */
export const REASON_PRESETS = [
  'Nudez ou conteúdo sexual',
  'Violência ou conteúdo chocante',
  'Discurso de ódio',
  'Assédio ou insultos',
  'Burla ou spam',
  'Envolve menores',
  'Falsa identidade',
];
