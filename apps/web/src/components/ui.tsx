import type { ReactNode } from 'react';

/** Logótipo "txilapp" desenhado em vectores: traço grosso e arredondado, tal como no desenho original. */
export const Wordmark = ({ className = 'h-8' }: { className?: string }) => (
  <svg
    viewBox="-4 -2 142 52"
    role="img"
    aria-label="txilapp"
    className={`w-auto ${className}`}
    fill="none"
    stroke="currentColor"
    strokeWidth={7}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {/* t */}
    <path d="M7 5V27Q7 34 14 34M0 14H14" />
    {/* x */}
    <path d="M20 14Q27 24 34 34M34 14Q27 24 20 34" />
    {/* i */}
    <path d="M42 14V34" />
    <circle cx="42" cy="4.5" r="2.2" fill="currentColor" strokeWidth={3.5} />
    {/* l */}
    <path d="M51 3V34" />
    {/* a */}
    <circle cx="67" cy="24" r="9.5" />
    <path d="M76.5 14V34" />
    {/* p */}
    <circle cx="96" cy="24" r="9.5" />
    <path d="M86.5 14V46" />
    {/* p */}
    <circle cx="125" cy="24" r="9.5" />
    <path d="M115.5 14V46" />
  </svg>
);

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const initials = name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <span
      style={{ width: size, height: size }}
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-violet-100 text-sm font-bold text-violet-700 ring-[1.5px] ring-rose-500 ring-offset-2"
    >
      {initials}
    </span>
  );
}

export function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'Agora';
  if (s < 3600) return `Há ${Math.floor(s / 60)}min`;
  if (s < 86400) return `Há ${Math.floor(s / 3600)}h`;
  return `Há ${Math.floor(s / 86400)}d`;
}

/** Folha inferior (bottom sheet) acessível. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[85dvh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-white p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} aria-label="Fechar" className="rounded-full px-3 py-1 text-xl text-zinc-500">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const btnPrimary =
  'rounded-xl bg-zinc-900 px-4 py-2.5 font-semibold text-white disabled:opacity-50 hover:bg-zinc-700';
export const inputCls =
  'w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-violet-500';
