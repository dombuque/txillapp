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
  <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
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

/** Janela para pedir o motivo (obrigatório) antes de uma ação que fica no registo. */
export function ReasonDialog({ title, help, confirm, danger, onCancel, onConfirm }: { title: string; help?: string; confirm: string; danger?: boolean; onCancel: () => void; onConfirm: (reason: string) => Promise<void> }) {
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
        <label className="mt-4 block text-sm font-semibold text-zinc-700">
          Motivo (fica no registo)
          <textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={300} className="mt-1 w-full rounded-lg border border-zinc-300 p-2.5 text-sm outline-none focus:border-zinc-900" />
        </label>
        {err && <p role="alert" className="mt-2 text-sm text-red-600">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className={btnGhost}>Cancelar</button>
          <button type="button" disabled={busy || reason.trim().length < 3} onClick={() => void go()} className={danger ? btnDanger : btnPrimary}>{busy ? 'A guardar…' : confirm}</button>
        </div>
      </div>
    </div>
  );
}
