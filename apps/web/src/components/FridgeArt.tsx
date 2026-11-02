import { useId } from 'react';

/** Quão gelada está a geleira, consoante quantos gostos tem (0 a 4). */
export const frostLevel = (count: number) => (count <= 0 ? 0 : count <= 4 ? 1 : count <= 10 ? 2 : count <= 20 ? 3 : 4);
export const FROST_LABEL = ['Ainda quentinha', 'A arrefecer', 'Fresquinha', 'Bem gelada', 'Congelada!'] as const;

const ITEM_COLORS = ['#fb7185', '#fbbf24', '#34d399', '#60a5fa', '#c084fc', '#fb923c', '#f472b6', '#2dd4bf'];

/**
 * A geleira desenhada: um frigorífico com porta de cima (congelador) e de baixo, puxadores, ímanes e pés.
 * Quanto mais gostos, mais gelada: geada nos cantos, pingentes de gelo, cristais e brilhos. Aberta, mostra o interior
 * com prateleiras (e a porta aberta ao lado), com tantos "produtos" quantos gostos (até 8).
 */
export default function FridgeArt({ count, open = false, size = 96 }: { count: number; open?: boolean; size?: number }) {
  const id = useId().replace(/:/g, '');
  const level = frostLevel(count);
  const edge = ['#a9c9d9', '#8fd0ee', '#6fc4ea', '#4fb4e6', '#2fa3e0'][level];
  const body = level >= 3 ? `url(#c${id})` : `url(#b${id})`;
  const dots = Math.min(count, 8);
  const h = Math.round(size * 1.3);
  return (
    <svg width={size} height={h} viewBox="0 0 100 130" role="img" aria-label={`Geleira: ${FROST_LABEL[level]}`} className="shrink-0 overflow-visible">
      <defs>
        <linearGradient id={`b${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#e4f1f8" />
        </linearGradient>
        <linearGradient id={`c${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f2fbff" />
          <stop offset="1" stopColor="#bfe6f8" />
        </linearGradient>
        <linearGradient id={`i${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f4fcff" />
          <stop offset="1" stopColor="#cdeefb" />
        </linearGradient>
      </defs>

      {/* sombra no chão */}
      <ellipse cx="50" cy="124" rx="34" ry="4" fill="#0e7490" opacity="0.12" />
      {/* pés */}
      <rect x="20" y="118" width="9" height="6" rx="2" fill="#7b9aab" />
      <rect x="71" y="118" width="9" height="6" rx="2" fill="#7b9aab" />

      {/* corpo */}
      <rect x="14" y="6" width="72" height="114" rx="11" fill={body} stroke={edge} strokeWidth="3" />

      {open ? (
        <>
          {/* interior */}
          <rect x="20" y="12" width="60" height="102" rx="7" fill={`url(#i${id})`} stroke={edge} strokeWidth="1.5" />
          {[38, 62, 86].map((y) => <rect key={y} x="20" y={y} width="60" height="4.5" fill="#fff" stroke="#9fd6ee" strokeWidth="1" />)}
          {Array.from({ length: dots }).map((_, i) => {
            const shelf = [34, 58, 82][Math.floor(i / 3) % 3];
            const x = 28 + (i % 3) * 18;
            return <circle key={i} cx={x} cy={shelf - 5} r="6" fill={ITEM_COLORS[i % ITEM_COLORS.length]} stroke="#fff" strokeWidth="1.5" />;
          })}
          {/* porta aberta, de lado */}
          <path d="M14 6 L-6 14 L-6 112 L14 120 Z" fill="#fff" stroke={edge} strokeWidth="3" strokeLinejoin="round" />
          <path d="M-6 52 L14 54" stroke={edge} strokeWidth="2.5" />
          <rect x="-2" y="26" width="3.5" height="16" rx="1.7" fill="#9ab8c8" />
          <rect x="-2" y="64" width="3.5" height="22" rx="1.7" fill="#9ab8c8" />
          {/* luz */}
          <circle cx="50" cy="19" r="3" fill="#fde68a" />
        </>
      ) : (
        <>
          {/* porta do congelador e porta de baixo */}
          <path d="M14 46 H86" stroke={edge} strokeWidth="3" />
          {/* puxadores */}
          <rect x="72" y="22" width="4.5" height="18" rx="2.2" fill="#8aa7b8" />
          <rect x="72" y="58" width="4.5" height="30" rx="2.2" fill="#8aa7b8" />
          {/* ímanes */}
          <circle cx="30" cy="68" r="4.5" fill="#fb7185" />
          <rect x="26" y="80" width="9" height="7" rx="2" fill="#fbbf24" transform="rotate(-8 30 83)" />
          <circle cx="48" cy="96" r="4" fill="#34d399" />
          {/* brilho de vidro */}
          <path d="M22 14 Q24 10 34 10" stroke="#fff" strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.9" />
        </>
      )}

      {/* geada: cresce com o nível */}
      {level >= 1 && (
        <g fill="#fff" opacity="0.95">
          <path d="M14 14 Q14 6 22 6 H30 Q22 8 20 16 Q14 20 14 14Z" />
          <path d="M86 14 Q86 6 78 6 H70 Q78 8 80 16 Q86 20 86 14Z" />
        </g>
      )}
      {level >= 2 && (
        <g fill="#fff" opacity="0.95">
          <path d="M14 112 Q14 120 22 120 H32 Q22 116 20 108 Q14 106 14 112Z" />
          <path d="M86 112 Q86 120 78 120 H68 Q78 116 80 108 Q86 106 86 112Z" />
          {/* pingentes de gelo por baixo do congelador (só com a porta fechada) */}
          {!open && [24, 36, 58, 66].map((x, i) => <path key={x} d={`M${x} 48 l3 ${10 + (i % 2) * 5} l3 -${10 + (i % 2) * 5}Z`} fill="#dff3fb" stroke="#9fd6ee" strokeWidth="0.8" />)}
        </g>
      )}
      {level >= 3 && !open && (
        <g stroke="#7ccbf0" strokeWidth="1.6" strokeLinecap="round" fill="none">
          {/* cristais de gelo na porta */}
          {[[34, 28], [58, 74], [38, 104]].map(([x, y]) => (
            <g key={`${x}${y}`} transform={`translate(${x} ${y})`}>
              <path d="M0 -6V6M-5.2 -3L5.2 3M-5.2 3L5.2 -3" />
            </g>
          ))}
        </g>
      )}
      {level >= 4 && !open && (
        <>
          <path d="M14 6 H86 Q86 14 80 16 Q50 12 20 16 Q14 14 14 6Z" fill="#fff" opacity="0.95" />
          {[20, 30, 42, 52, 62, 72, 80].map((x, i) => <path key={x} d={`M${x} 15 l2.2 ${7 + (i % 3) * 4} l2.2 -${7 + (i % 3) * 4}Z`} fill="#e9f8ff" stroke="#a8dcf3" strokeWidth="0.7" />)}
          <g fill="#fff">
            <path d="M92 28 l1.6 4 4 1.6 -4 1.6 -1.6 4 -1.6 -4 -4 -1.6 4 -1.6z" />
            <path d="M6 70 l1.2 3 3 1.2 -3 1.2 -1.2 3 -1.2 -3 -3 -1.2 3 -1.2z" />
          </g>
        </>
      )}
    </svg>
  );
}
