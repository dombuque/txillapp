import type { ReactNode } from 'react';

const BRAND = '#e44460';

/** Logótipo "txilapp" desenhado em vectores: traço grosso e arredondado, tal como no desenho original. */
export const Wordmark = ({ className = 'h-8', accent = false }: { className?: string; accent?: boolean }) => (
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
    <circle cx="42" cy="4.5" r="2.2" strokeWidth={3.5} fill={accent ? BRAND : 'currentColor'} stroke={accent ? BRAND : 'currentColor'} />
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
      style={{ width: size, height: size, fontSize: Math.max(11, size * 0.3) }}
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-rose-50 font-bold text-brand ring-[1.5px] ring-brand ring-offset-2"
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

/** Folha inferior (bottom sheet) acessível, com pega de arrastar visual. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="animate-[rise_.25s_ease-out] max-h-[85dvh] w-full max-w-xl overflow-y-auto rounded-t-[28px] bg-white px-6 pb-8 pt-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-zinc-300" aria-hidden />
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">{title}</h2>
          <button onClick={onClose} aria-label="Fechar" className="rounded-full px-3 py-1 text-2xl text-zinc-400">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Ecrã de página com fundo cinzento e título grande, para os ecrãs fora do feed. */
export function Page({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <div className="px-5 pb-6 pt-2">
      <h1 className="text-[32px] font-extrabold leading-tight">{title}</h1>
      {sub && <p className="mt-1 text-lg font-light text-zinc-600">{sub}</p>}
      <div className="mt-6">{children}</div>
    </div>
  );
}

export const btnPrimary =
  'rounded-full bg-brand px-4 py-3.5 font-semibold text-white transition active:scale-[0.97] disabled:opacity-50 hover:brightness-95';
export const btnGhost =
  'rounded-full border border-zinc-300 bg-white px-6 py-3 font-semibold text-zinc-800 transition active:scale-[0.97]';
export const lineInput =
  'w-full border-0 border-b border-zinc-400 bg-transparent py-3 text-lg text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-brand';
export const pillInput =
  'w-full rounded-full bg-zinc-100 px-4 py-3 text-base outline-none placeholder:text-zinc-400 focus:ring-2 focus:ring-brand';
