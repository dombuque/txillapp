import { useVisualViewport, visibleStyle } from '../lib/useVisualViewport';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';

const BRAND = '#d6334f';

/** Logótipo "txillapp": traço grosso e arredondado, com o ponto do i a coral. */
export const Wordmark = ({ className = 'h-8', loading = false }: { className?: string; loading?: boolean }) => (
  <svg
    viewBox="-4 -3 154 54"
    role="img"
    aria-label="txillapp"
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
    <circle cx="42" cy="3.5" r="4.2" strokeWidth={0} fill={BRAND} className={loading ? 'ponto-i' : undefined} />
    {/* l l */}
    <path d="M51 3V34" />
    <path d="M61 3V34" />
    {/* a */}
    <circle cx="77" cy="24" r="9.5" />
    <path d="M86.5 14V34" />
    {/* p */}
    <circle cx="106" cy="24" r="9.5" />
    <path d="M96.5 14V46" />
    {/* p */}
    <circle cx="135" cy="24" r="9.5" />
    <path d="M125.5 14V46" />
  </svg>
);

/** Versão das fotos de perfil: ao mudar a minha, todas as que estão no ecrã são pedidas de novo. */
let avatarVersion = Date.now();
const avatarListeners = new Set<() => void>();
export const bumpAvatars = () => {
  avatarVersion = Date.now();
  avatarListeners.forEach((l) => l());
};
const useAvatarVersion = () =>
  useSyncExternalStore(
    (cb) => {
      avatarListeners.add(cb);
      return () => avatarListeners.delete(cb);
    },
    () => avatarVersion,
  );

/**
 * Foto de perfil. Com `username` tenta a foto (o servidor responde 204 se a pessoa não tiver) e, sem foto,
 * mostra as iniciais. Imagens com texto alternativo vazio: o nome já está escrito ao lado.
 */
export function Avatar({ name, username, size = 40, ring = true }: { name: string; username?: string; size?: number; ring?: boolean }) {
  const version = useAvatarVersion();
  const [failed, setFailed] = useState<string | null>(null);
  const src = username ? `/api/v1/avatars/${encodeURIComponent(username)}?v=${version}` : null;
  const initials = name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <span
      style={{ width: size, height: size, fontSize: Math.max(11, size * 0.3) }}
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-rose-50 font-bold text-brand ${ring ? 'ring-[1.5px] ring-brand ring-offset-2' : ''}`}
    >
      {src && failed !== src ? <img src={src} alt="" onError={() => setFailed(src)} className="h-full w-full object-cover" draggable={false} /> : initials}
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
export function Sheet({ title, onClose, children, layer = 'z-50' }: { title: string; onClose: () => void; children: ReactNode; layer?: string }) {
  // Esc fecha (teclado/acessibilidade).
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  // iPhone: com o teclado aberto a folha sobe e fica na zona visível (o que escreves nunca fica tapado).
  const vv = useVisualViewport();
  return (
    <div className={`fixed inset-0 ${layer} flex items-end justify-center bg-black/40`} style={visibleStyle(vv)} onClick={onClose} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="animate-[rise_.25s_ease-out] max-h-[85dvh] w-full max-w-xl overflow-y-auto rounded-t-[28px] bg-white px-6 pb-8 pt-3"
        style={vv ? { maxHeight: Math.round(vv.height * 0.94) } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-zinc-300" aria-hidden />
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">{title}</h2>
          <button onClick={onClose} aria-label="Fechar" className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-2xl text-zinc-600">
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
  'rounded-full bg-brand px-4 py-3.5 font-bold text-white transition active:scale-[0.97] disabled:opacity-50 hover:brightness-95';
export const btnGhost =
  'rounded-full border border-zinc-300 bg-white px-6 py-3 font-semibold text-zinc-800 transition active:scale-[0.97]';
/** Botão compacto (perfil): altura de 36 px, cantos suaves, como nas redes sociais. */
export const btnSmall =
  'h-9 whitespace-nowrap rounded-xl bg-zinc-100 px-4 text-sm font-semibold text-zinc-900 transition active:scale-[0.97] hover:bg-zinc-200';
export const lineInput =
  'w-full border-0 border-b border-zinc-400 bg-transparent py-3 text-lg text-zinc-900 outline-none placeholder:text-zinc-500 focus:border-brand';
export const fieldInput =
  'w-full rounded-2xl bg-zinc-100 px-4 py-3.5 text-base text-zinc-900 outline-none placeholder:text-zinc-500 focus:ring-2 focus:ring-brand';
export const pillInput =
  'w-full rounded-full bg-zinc-100 px-4 py-3 text-base outline-none placeholder:text-zinc-500 focus:ring-2 focus:ring-brand';
