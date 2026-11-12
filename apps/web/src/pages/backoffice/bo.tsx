import { useState, type ReactNode } from 'react';

/** Peças comuns do backoffice (ecrã de computador, textos em português de Portugal). */

export const ago = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  if (s < 86400 * 30) return `há ${Math.floor(s / 86400)} d`;
  return new Date(iso).toLocaleDateString('pt-PT');
};
export const when = (iso: string) => new Date(iso).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' });

export function Badge({ tone = 'zinc', children }: { tone?: 'zinc' | 'green' | 'red' | 'amber' | 'blue'; children: ReactNode }) {
  const c = { zinc: 'bg-zinc-100 text-zinc-700', green: 'bg-emerald-100 text-emerald-800', red: 'bg-red-100 text-red-800', amber: 'bg-amber-100 text-amber-900', blue: 'bg-sky-100 text-sky-800' }[tone];
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${c}`}>{children}</span>;
}
export const statusBadge = (s: string) => <Badge tone={s === 'active' ? 'green' : s === 'suspended' ? 'red' : 'zinc'}>{s === 'active' ? 'ativa' : s === 'suspended' ? 'suspensa' : 'eliminada'}</Badge>;

export const Card = ({ title, children, right }: { title?: string; children: ReactNode; right?: ReactNode }) => (
  <section className="rounded-2xl bg-white p-5 shadow-[0_1px_2px_rgba(15,18,25,0.06)] ring-1 ring-zinc-200/70">
    {(title || right) && (
      <div className="mb-3 flex items-center justify-between">
        {title && <h2 className="text-base font-bold text-zinc-900">{title}</h2>}
        {right}
      </div>
    )}
    {children}
  </section>
);

export const btn = 'inline-flex h-9 items-center justify-center rounded-lg px-4 text-sm font-semibold transition disabled:opacity-40';
export const btnPrimary = `${btn} bg-zinc-900 text-white hover:bg-zinc-700`;
export const btnGhost = `${btn} border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50`;
export const btnDanger = `${btn} bg-red-700 text-white hover:bg-red-800`;
export const th = 'px-3 py-2 text-left text-xs font-bold uppercase tracking-wide text-zinc-500';
export const td = 'px-3 py-2.5 align-top text-sm text-zinc-800';

/** Janela para pedir o motivo (obrigatório) antes de uma ação que fica no registo. Com `children`, o que mais se escolhe (por cima do motivo); `ready` a false desliga o botão. */
export function ReasonDialog({ title, help, confirm, danger, onCancel, onConfirm, children, ready = true }: { title: string; help?: string; confirm: string; danger?: boolean; onCancel: () => void; onConfirm: (reason: string) => Promise<void>; children?: ReactNode; ready?: boolean }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function go() {
    setBusy(true);
    setErr('');
    try {
      await onConfirm(reason.trim());
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div role="dialog" aria-modal="true" aria-label={title} data-swipe="off" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold">{title}</h3>
        {help && <p className="mt-1 text-sm text-zinc-600">{help}</p>}
        {children}
        <label className="mt-4 block text-sm font-semibold text-zinc-700">
          Motivo (fica no registo)
          <textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={300} className="mt-1 w-full rounded-lg border border-zinc-300 p-2.5 text-sm outline-none focus:border-zinc-900" />
        </label>
        {err && <p role="alert" className="mt-2 text-sm text-red-600">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className={btnGhost}>Cancelar</button>
          <button type="button" disabled={busy || !ready || reason.trim().length < 3} onClick={() => void go()} className={danger ? btnDanger : btnPrimary}>{busy ? 'A guardar…' : confirm}</button>
        </div>
      </div>
    </div>
  );
}

/* ───── Quem sou (equipas e permissões), partilhado pelo backoffice ───── */
import { createContext, useContext } from 'react';
import type { BoMe } from '../../lib/api';

export const StaffContext = createContext<BoMe | null>(null);
export const useStaff = () => useContext(StaffContext);
export const useCan = (perm: string) => !!useStaff()?.permissions.includes(perm);

/** Cabeçalho de página: título, descrição e ações à direita. */
export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[26px] font-extrabold leading-tight tracking-tight text-zinc-900">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[15px] text-zinc-500">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Estado vazio com um pequeno desenho. */
export function Empty({ title, text }: { title: string; text?: string }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-zinc-300 bg-white/60 px-6 py-14 text-center">
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 text-zinc-400" aria-hidden>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg>
      </span>
      <p className="font-bold text-zinc-800">{title}</p>
      {text && <p className="mt-1 max-w-sm text-sm text-zinc-500">{text}</p>}
    </div>
  );
}

/** Pequena etiqueta de tecla (atalhos). */
export const Kbd = ({ children }: { children: ReactNode }) => <kbd className="rounded border border-zinc-300 bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-zinc-600">{children}</kbd>;

export const TEAM_TONE: Record<string, 'zinc' | 'green' | 'red' | 'amber' | 'blue'> = { administracao: 'red', moderacao: 'amber', suporte: 'blue', verificacao: 'green', financas: 'zinc', crescimento: 'green', auditoria: 'zinc' };
