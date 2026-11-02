import { useId } from 'react';

/**
 * Nível da geleira: não é "quão gelada", é quão recheada e variada está. Conta os gostos e quantos tipos diferentes tem
 * (vibes, bebidas, comidas, sítios): para subir de nível é preciso ter mais e de mais tipos.
 */
export const geleiraLevel = (count: number, kinds: number) =>
  count <= 0 ? 0 : count >= 21 && kinds >= 4 ? 4 : count >= 11 && kinds >= 3 ? 3 : count >= 5 && kinds >= 2 ? 2 : 1;
export const LEVEL_LABEL = ['Geleira vazia', 'Primeiras compras', 'Bem abastecida', 'Cheia de sabor', 'Lenda da malta'] as const;
/** Quanto falta para o nível seguinte, numa frase (vazio no último). */
export function nextLevelHint(count: number, kinds: number): string {
  const l = geleiraLevel(count, kinds);
  if (l === 0) return 'Põe o primeiro gosto para começar.';
  if (l === 1) return 'Chega aos 5 gostos, de 2 tipos, para ficar bem abastecida.';
  if (l === 2) return 'Chega aos 11 gostos, de 3 tipos, para ficar cheia de sabor.';
  if (l === 3) return 'Chega aos 21 gostos, dos 4 tipos, para ser lenda da malta.';
  return 'Nível máximo. A malta vê que sabes viver!';
}

const ITEM_COLORS = ['#fb7185', '#fbbf24', '#34d399', '#60a5fa', '#c084fc', '#fb923c', '#f472b6', '#2dd4bf'];

/** Posições e cores dos ímanes na porta (aparecem à medida que a geleira sobe de nível). */
const MAGNETS: { x: number; y: number; c: string; r: number; shape: 'dot' | 'sq' | 'heart' | 'star' }[] = [
  { x: 30, y: 68, c: '#fb7185', r: 0, shape: 'dot' },
  { x: 33, y: 84, c: '#fbbf24', r: -8, shape: 'sq' },
  { x: 50, y: 98, c: '#34d399', r: 0, shape: 'dot' },
  { x: 52, y: 70, c: '#60a5fa', r: 10, shape: 'sq' },
  { x: 28, y: 100, c: '#c084fc', r: 0, shape: 'heart' },
  { x: 54, y: 84, c: '#f59e0b', r: 0, shape: 'star' },
];
const MAGNET_COUNT = [0, 1, 3, 5, 6];

function Magnet({ m }: { m: (typeof MAGNETS)[number] }) {
  if (m.shape === 'sq') return <rect x={m.x - 4.5} y={m.y - 3.5} width="9" height="7" rx="2" fill={m.c} transform={`rotate(${m.r} ${m.x} ${m.y})`} />;
  if (m.shape === 'heart') return <path d={`M${m.x} ${m.y + 5} C${m.x - 9} ${m.y - 1} ${m.x - 4} ${m.y - 7} ${m.x} ${m.y - 3} C${m.x + 4} ${m.y - 7} ${m.x + 9} ${m.y - 1} ${m.x} ${m.y + 5}Z`} fill={m.c} />;
  if (m.shape === 'star') return <path d={`M${m.x} ${m.y - 5} l1.6 3.4 3.7.5 -2.7 2.6 .7 3.7 -3.3-1.8 -3.3 1.8 .7-3.7 -2.7-2.6 3.7-.5z`} fill={m.c} />;
  return <circle cx={m.x} cy={m.y} r="4.5" fill={m.c} />;
}

/**
 * A geleira desenhada: um frigorífico com porta de cima e de baixo, puxadores, pés e ímanes. Quanto mais recheada e variada,
 * mais ímanes, mais cor e mais brilho: no topo (lenda da malta) ganha uma coroa e faíscas. Aberta, mostra o interior com
 * prateleiras e tantos "produtos" quantos gostos (até 8).
 */
export default function FridgeArt({ count, kinds = 1, open = false, invite = false, size = 96 }: { count: number; kinds?: number; open?: boolean; invite?: boolean; size?: number }) {
  const id = useId().replace(/:/g, '');
  const level = geleiraLevel(count, kinds);
  const edge = ['#a9c9d9', '#8fd0ee', '#6fc4ea', '#f08aa0', '#e8a317'][level];
  const dots = Math.min(count, 8);
  const h = Math.round(size * 1.3);
  return (
    <svg width={size} height={h} viewBox="0 0 100 130" role="img" aria-label={`Geleira: ${LEVEL_LABEL[level]}`} className="shrink-0 overflow-visible">
      <defs>
        <linearGradient id={`b${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor={level >= 3 ? '#fdeef1' : '#e4f1f8'} />
        </linearGradient>
        <linearGradient id={`i${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fffdf2" />
          <stop offset="1" stopColor="#e2f3fb" />
        </linearGradient>
        <radialGradient id={`g${id}`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={level >= 4 ? '#fde68a' : '#fbcfe8'} stopOpacity="0.85" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* brilho atrás, a partir do nível 3 */}
      {level >= 3 && <ellipse cx="50" cy="66" rx="62" ry="72" fill={`url(#g${id})`} />}

      <ellipse cx="50" cy="124" rx="34" ry="4" fill="#0e7490" opacity="0.12" />
      <rect x="20" y="118" width="9" height="6" rx="2" fill="#7b9aab" />
      <rect x="71" y="118" width="9" height="6" rx="2" fill="#7b9aab" />

      <rect x="14" y="6" width="72" height="114" rx="11" fill={`url(#b${id})`} stroke={edge} strokeWidth={level >= 3 ? 3.4 : 3} />

      {open ? (
        <>
          <rect x="20" y="12" width="60" height="102" rx="7" fill={`url(#i${id})`} stroke={edge} strokeWidth="1.5" />
          {[38, 62, 86].map((y) => <rect key={y} x="20" y={y} width="60" height="4.5" fill="#fff" stroke="#9fd6ee" strokeWidth="1" />)}
          {Array.from({ length: dots }).map((_, i) => {
            const shelf = [34, 58, 82][Math.floor(i / 3) % 3];
            return <circle key={i} cx={28 + (i % 3) * 18} cy={shelf - 5} r="6" fill={ITEM_COLORS[i % ITEM_COLORS.length]} stroke="#fff" strokeWidth="1.5" />;
          })}
          <path d="M14 6 L-6 14 L-6 112 L14 120 Z" fill="#fff" stroke={edge} strokeWidth="3" strokeLinejoin="round" />
          <path d="M-6 52 L14 54" stroke={edge} strokeWidth="2.5" />
          <rect x="-2" y="26" width="3.5" height="16" rx="1.7" fill="#9ab8c8" />
          <rect x="-2" y="64" width="3.5" height="22" rx="1.7" fill="#9ab8c8" />
          <circle cx="50" cy="19" r="3" fill="#fde68a" />
        </>
      ) : (
        <>
          <path d="M14 46 H86" stroke={edge} strokeWidth="3" />
          <rect x="72" y="22" width="4.5" height="18" rx="2.2" fill="#8aa7b8" />
          <rect x="72" y="58" width="4.5" height="30" rx="2.2" fill="#8aa7b8" />
          {MAGNETS.slice(0, MAGNET_COUNT[level]).map((m, i) => <Magnet key={i} m={m} />)}
          {invite && (
            <>
              {/* porta entreaberta: uma frincha de luz no lado da dobradiça */}
              <rect x="10.5" y="14" width="4.5" height="98" rx="2" fill="#fde68a" className="animate-pulse" />
              <rect x="8" y="14" width="3" height="98" rx="1.5" fill="#fde68a" opacity="0.5" className="animate-pulse" />
              {/* seta desenhada a mostrar que se puxa a porta */}
              <g className="animate-pulse" fill="none" stroke="#0ea5e9" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M90 54 C101 66 99 84 84 92" />
                <path d="M83.5 82 L84 92 L94 90" />
              </g>
            </>
          )}
          <path d="M22 14 Q24 10 34 10" stroke="#fff" strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.9" />
        </>
      )}

      {/* topo da escala: coroa e faíscas */}
      {level >= 4 && (
        <>
          <g transform="translate(50 4)">
            <path d="M-15 0 l-3 -15 9 6 9 -12 9 12 9 -6 -3 15z" fill="#fde047" stroke="#b45309" strokeWidth="2.4" strokeLinejoin="round" />
          </g>
          <g fill="#fbbf24">
            <path d="M94 34 l1.8 4.4 4.4 1.8 -4.4 1.8 -1.8 4.4 -1.8 -4.4 -4.4 -1.8 4.4 -1.8z" />
            <path d="M5 78 l1.4 3.4 3.4 1.4 -3.4 1.4 -1.4 3.4 -1.4 -3.4 -3.4 -1.4 3.4 -1.4z" />
          </g>
        </>
      )}
    </svg>
  );
}
