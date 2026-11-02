import { useId, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Stickers do Txillapp: autocolantes desenhados na app (SVG, fundo transparente, contorno branco como um recorte).
 * O servidor só guarda o id. Todos partilham a mesma mascote (a cara redonda) com expressões e adereços diferentes.
 */
type Eyes = 'open' | 'happy' | 'wink' | 'closed' | 'wide' | 'heart' | 'dizzy';
type Mouth = 'smile' | 'grin' | 'o' | 'flat' | 'tongue' | 'sad' | 'laugh';

interface Def {
  id: string;
  text: string;
  from: string;
  to: string;
  eyes: Eyes;
  mouth: Mouth;
  prop: JSX.Element | null;
  /** Adereço desenhado por cima da cara (chapéu, óculos…). */
  hat?: JSX.Element;
}

const W = '#fff';
const INK = '#2a1a1f';

const flame = (
  <g transform="translate(60 14)">
    <path d="M0-16c3 6 11 9 11 19a11 11 0 0 1-22 0c0-5 3-7 5-10 1 3 2 4 4 4 0-6-1-9 2-13z" fill="#ffb02e" stroke="#e8481f" strokeWidth="3" strokeLinejoin="round" />
    <path d="M0 0c2 3 5 4 5 8a5 5 0 0 1-10 0c0-3 3-4 5-8z" fill="#fff3b0" />
  </g>
);
const check = <path d="M86 26l7 7 13-14" fill="none" stroke="#fff" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />;
const checkBadge = (<g><circle cx="96" cy="28" r="15" fill="#10b981" stroke={W} strokeWidth="3" />{check}</g>);
const clock = (
  <g transform="translate(97 28)"><circle r="15" fill="#fff" stroke="#2563eb" strokeWidth="4" /><path d="M0-8V0l6 4" fill="none" stroke="#2563eb" strokeWidth="3.5" strokeLinecap="round" /></g>
);
const pin = (
  <g transform="translate(96 26)"><path d="M0 18C-12 4-13-2-13-7a13 13 0 0 1 26 0c0 5-1 11-13 25z" fill="#ef4444" stroke={W} strokeWidth="3" strokeLinejoin="round" /><circle cy="-7" r="5" fill="#fff" /></g>
);
const coins = (
  <g><circle cx="94" cy="30" r="13" fill="#fbbf24" stroke="#b45309" strokeWidth="3.5" /><text x="94" y="36" textAnchor="middle" fontSize="17" fontWeight="900" fill="#b45309">$</text>
    <circle cx="22" cy="34" r="9" fill="#fcd34d" stroke="#b45309" strokeWidth="3" /></g>
);
const cheers = (
  <g>
    <g transform="rotate(-16 36 30)"><path d="M26 14h20l-2 24a8 8 0 0 1-16 0z" fill="#fde68a" stroke="#b45309" strokeWidth="3" strokeLinejoin="round" /><path d="M27 18h18" stroke="#fff" strokeWidth="5" strokeLinecap="round" /></g>
    <g transform="rotate(16 84 30)"><path d="M74 14h20l-2 24a8 8 0 0 1-16 0z" fill="#fde68a" stroke="#b45309" strokeWidth="3" strokeLinejoin="round" /><path d="M75 18h18" stroke="#fff" strokeWidth="5" strokeLinecap="round" /></g>
    <path d="M58 6l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="#fff" />
  </g>
);
const hearts = (
  <g fill="#ef4444" stroke={W} strokeWidth="2.5" strokeLinejoin="round">
    <path d="M96 40c-9-6-14-11-14-17a8 8 0 0 1 14-4 8 8 0 0 1 14 4c0 6-5 11-14 17z" />
    <path d="M24 30c-6-4-9-7-9-11a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 4-3 7-9 11z" />
  </g>
);
const sparkles = (
  <g fill="#fff" stroke="#f472b6" strokeWidth="2" strokeLinejoin="round">
    <path d="M94 14l4 11 11 4-11 4-4 11-4-11-11-4 11-4z" />
    <path d="M24 22l2.5 6.5 6.5 2.5-6.5 2.5L24 40l-2.5-6.5L15 31l6.5-2.5z" />
  </g>
);
const party = (
  <g>
    <path d="M60 2L44 26h32z" fill="#f472b6" stroke="#be185d" strokeWidth="3" strokeLinejoin="round" />
    <path d="M51 16h18M47 22h26" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
    <circle cx="60" cy="3" r="4.5" fill="#fde047" stroke="#ca8a04" strokeWidth="2" />
    <g fill="#38bdf8"><rect x="90" y="18" width="7" height="7" rx="1.5" transform="rotate(20 93 21)" /><rect x="20" y="26" width="7" height="7" rx="1.5" fill="#fbbf24" transform="rotate(-20 23 29)" /></g>
  </g>
);
const sweat = (
  <path d="M94 18c5 7 8 11 8 16a8 8 0 0 1-16 0c0-5 3-9 8-16z" fill="#7dd3fc" stroke="#0284c7" strokeWidth="3" strokeLinejoin="round" />
);
const moon = (
  <g>
    <path d="M100 14a17 17 0 1 0 9 30 14 14 0 0 1-9-30z" fill="#fde68a" stroke="#b45309" strokeWidth="3" strokeLinejoin="round" />
    <text x="24" y="30" fontSize="17" fontWeight="900" fill="#fff" stroke="#4338ca" strokeWidth="3" paintOrder="stroke">Z</text>
    <text x="36" y="18" fontSize="12" fontWeight="900" fill="#fff" stroke="#4338ca" strokeWidth="2.5" paintOrder="stroke">z</text>
  </g>
);
const fork = (
  <g transform="rotate(20 94 30)" fill="none" stroke="#7c2d12" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M86 10v14a6 6 0 0 0 12 0V10M92 10v38" /><path d="M92 24v24" />
  </g>
);
const note = (
  <g fill="#fff" stroke="#6b21a8" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round">
    <path d="M92 40V16l16-4v24" fill="none" /><circle cx="86" cy="40" r="6" /><circle cx="102" cy="36" r="6" />
    <path d="M22 28l8-2v14" fill="none" /><circle cx="19" cy="40" r="5" />
  </g>
);
const sun = (
  <g stroke="#ca8a04" strokeWidth="3.5" strokeLinecap="round"><path d="M96 8v6M110 22h-6M82 22h6M106 12l-4 4M86 12l4 4" /></g>
);
const thumb = (
  <g transform="translate(96 30)"><path d="M-10 4h6l7-14c3 0 5 2 4 6l-1 5h8c3 0 5 3 4 6l-3 11c-1 3-3 4-6 4h-12c-2 0-3-1-3-3z" fill="#fde68a" stroke="#b45309" strokeWidth="3" strokeLinejoin="round" /></g>
);

export const STICKERS: Def[] = [
  { id: 'bora', text: 'BORA!', from: '#ff8a5b', to: '#e5334f', eyes: 'wide', mouth: 'grin', prop: null, hat: flame },
  { id: 'fixe', text: 'TÁ FIXE', from: '#6ee7b7', to: '#10b981', eyes: 'happy', mouth: 'grin', prop: thumb },
  { id: 'ja-vou', text: 'JÁ VOU', from: '#93c5fd', to: '#3b82f6', eyes: 'wide', mouth: 'o', prop: clock },
  { id: 'a-caminho', text: 'A CAMINHO', from: '#c4b5fd', to: '#7c3aed', eyes: 'open', mouth: 'smile', prop: pin },
  { id: 'paga', text: 'PAGAS TU!', from: '#fcd34d', to: '#f59e0b', eyes: 'wink', mouth: 'tongue', prop: coins },
  { id: 'saude', text: 'SAÚDE!', from: '#fde68a', to: '#f59e0b', eyes: 'happy', mouth: 'laugh', prop: null, hat: cheers },
  { id: 'saudades', text: 'SAUDADES', from: '#fda4af', to: '#e11d48', eyes: 'open', mouth: 'sad', prop: hearts },
  { id: 'obrigado', text: 'OBRIGADO', from: '#f9a8d4', to: '#d946ef', eyes: 'happy', mouth: 'smile', prop: sparkles },
  { id: 'parabens', text: 'PARABÉNS', from: '#fbcfe8', to: '#ec4899', eyes: 'happy', mouth: 'laugh', prop: null, hat: party },
  { id: 'ups', text: 'UPS…', from: '#fdba74', to: '#f97316', eyes: 'wide', mouth: 'flat', prop: sweat },
  { id: 'dormir', text: 'BOA NOITE', from: '#a5b4fc', to: '#4f46e5', eyes: 'closed', mouth: 'smile', prop: moon },
  { id: 'fome', text: 'TÔ COM FOME', from: '#fdba74', to: '#ea580c', eyes: 'wide', mouth: 'tongue', prop: fork },
  { id: 'festa', text: 'FESTA!', from: '#d8b4fe', to: '#9333ea', eyes: 'happy', mouth: 'laugh', prop: note },
  { id: 'amor', text: 'ADORO', from: '#fca5a5', to: '#ef4444', eyes: 'heart', mouth: 'smile', prop: hearts },
  { id: 'rir', text: 'AHAHAH', from: '#fde047', to: '#eab308', eyes: 'happy', mouth: 'laugh', prop: sun },
  { id: 'ok', text: 'OK', from: '#cbd5e1', to: '#64748b', eyes: 'open', mouth: 'smile', prop: checkBadge },
];

function eyes(kind: Eyes) {
  const stroke = { fill: 'none', stroke: INK, strokeWidth: 4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (kind) {
    case 'happy':
      return <g {...stroke}><path d="M42 50q6-8 12 0M66 50q6-8 12 0" /></g>;
    case 'closed':
      return <g {...stroke}><path d="M42 48q6 7 12 0M66 48q6 7 12 0" /></g>;
    case 'wink':
      return <g><circle cx="48" cy="49" r="4.5" fill={INK} /><path d="M66 50q6-8 12 0" {...stroke} /></g>;
    case 'wide':
      return <g><circle cx="48" cy="48" r="8" fill="#fff" stroke={INK} strokeWidth="3" /><circle cx="48" cy="49" r="4" fill={INK} /><circle cx="72" cy="48" r="8" fill="#fff" stroke={INK} strokeWidth="3" /><circle cx="72" cy="49" r="4" fill={INK} /></g>;
    case 'heart':
      return <g fill="#ef4444" stroke={INK} strokeWidth="2.5" strokeLinejoin="round"><path d="M48 58c-8-5-11-8-11-12a5 5 0 0 1 11-1 5 5 0 0 1 11 1c0 4-3 7-11 12z" transform="translate(0 -4) scale(1)" /><path d="M72 58c-8-5-11-8-11-12a5 5 0 0 1 11-1 5 5 0 0 1 11 1c0 4-3 7-11 12z" transform="translate(0 -4)" /></g>;
    case 'dizzy':
      return <g {...stroke}><path d="M43 44l10 10M53 44L43 54M67 44l10 10M77 44L67 54" /></g>;
    default:
      return <g><circle cx="48" cy="49" r="4.5" fill={INK} /><circle cx="72" cy="49" r="4.5" fill={INK} /><circle cx="49.5" cy="47.5" r="1.4" fill="#fff" /><circle cx="73.5" cy="47.5" r="1.4" fill="#fff" /></g>;
  }
}

function mouth(kind: Mouth) {
  const stroke = { fill: 'none', stroke: INK, strokeWidth: 4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (kind) {
    case 'grin':
      return <path d="M44 62q16 18 32 0z" fill="#7f1d1d" stroke={INK} strokeWidth="3.5" strokeLinejoin="round" />;
    case 'laugh':
      return <g><path d="M42 61q18 24 36 0z" fill="#7f1d1d" stroke={INK} strokeWidth="3.5" strokeLinejoin="round" /><path d="M50 72q10-7 20 0q-10 6-20 0z" fill="#fb7185" /></g>;
    case 'o':
      return <ellipse cx="60" cy="68" rx="6" ry="7.5" fill="#7f1d1d" stroke={INK} strokeWidth="3.5" />;
    case 'flat':
      return <path d="M50 68h20" {...stroke} />;
    case 'sad':
      return <path d="M49 72q11-10 22 0" {...stroke} />;
    case 'tongue':
      return <g><path d="M46 63q14 12 28 0" {...stroke} /><path d="M56 69v6a4 4 0 0 0 8 0v-6" fill="#fb7185" stroke={INK} strokeWidth="3" strokeLinejoin="round" /></g>;
    default:
      return <path d="M47 63q13 12 26 0" {...stroke} />;
  }
}

/** O sticker: recorte com fundo transparente (a mascote, o adereço, o texto) com contorno branco e sombra suave. */
export function Sticker({ id, size = 132 }: { id: string; size?: number }) {
  const uid = useId().replace(/:/g, '');
  const s = STICKERS.find((x) => x.id === id);
  if (!s) return <span className="text-sm text-zinc-500">Sticker</span>;
  const h = Math.round(size * 1.12);
  return (
    <svg role="img" aria-label={`Sticker: ${s.text}`} width={size} height={h} viewBox="0 0 120 134" className="shrink-0 overflow-visible">
      <defs>
        <linearGradient id={`g${uid}`} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor={s.from} />
          <stop offset="1" stopColor={s.to} />
        </linearGradient>
        <radialGradient id={`s${uid}`} cx="0.35" cy="0.25" r="0.6">
          <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <filter id={`f${uid}`} x="-20%" y="-20%" width="140%" height="140%">
          <feMorphology in="SourceAlpha" operator="dilate" radius="3.2" result="grow" />
          <feFlood floodColor="#fff" result="white" />
          <feComposite in="white" in2="grow" operator="in" result="edge" />
          <feDropShadow in="edge" dx="0" dy="2.5" stdDeviation="2.5" floodColor="#000" floodOpacity="0.28" result="shadow" />
          <feMerge><feMergeNode in="shadow" /><feMergeNode in="edge" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <g filter={`url(#${uid ? `f${uid}` : ''})`}>
        {s.prop}
        <circle cx="60" cy="56" r="38" fill={`url(#g${uid})`} stroke={INK} strokeWidth="3.5" />
        <ellipse cx="46" cy="36" rx="16" ry="9" fill={`url(#s${uid})`} />
        <circle cx="38" cy="66" r="6" fill="#fff" opacity="0.28" />
        <circle cx="82" cy="66" r="6" fill="#fff" opacity="0.28" />
        {eyes(s.eyes)}
        {mouth(s.mouth)}
        {s.hat}
        <text x="60" y="120" textAnchor="middle" fontSize={s.text.length > 9 ? 15 : 19} fontWeight="900" letterSpacing="0.5" fill="#fff" stroke={INK} strokeWidth="5" strokeLinejoin="round" paintOrder="stroke" fontFamily="inherit">{s.text}</text>
      </g>
    </svg>
  );
}

/** Sticker que se toca: abre-o em grande (toca fora para fechar). */
export function StickerButton({ id, size = 132, className = '' }: { id: string; size?: number; className?: string }) {
  const [big, setBig] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setBig(true)} aria-label="Ver sticker em grande" className={`block transition active:scale-95 ${className}`}>
        <Sticker id={id} size={size} />
      </button>
      {big &&
        createPortal(
          <div className="fixed inset-0 z-[95] flex animate-[rise_.2s_ease-out] items-center justify-center bg-black/70" onClick={() => setBig(false)} role="dialog" aria-modal="true" aria-label="Sticker">
            <Sticker id={id} size={Math.min(320, window.innerWidth - 48)} />
          </div>,
          document.body,
        )}
    </>
  );
}
