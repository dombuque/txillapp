import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { tr } from './i18n';

/**
 * Stickers do Txillapp: autocolantes minimalistas em SVG (fundo transparente, contorno branco de recorte e sombra suave).
 * Cada um junta um corpo de cor lisa, uma cara muito simples (olhos e boca), por vezes um adereço, e o texto. O servidor só guarda o id.
 */
type Eyes = 'dots' | 'happy' | 'closed' | 'wide' | 'heart' | 'star' | 'dizzy' | 'wink' | 'side' | 'angry' | 'none';
type Mouth = 'smile' | 'grin' | 'o' | 'flat' | 'sad' | 'tongue' | 'laugh' | 'smirk' | 'kiss' | 'none';
type Shape = 'round' | 'squircle' | 'blob' | 'drop';

export type StickerCat = 'reacoes' | 'dia' | 'comida' | 'festa' | 'amor' | 'malta';
export const STICKER_CATS: { id: StickerCat; label: string }[] = [
  { id: 'reacoes', label: tr('Reações') },
  { id: 'dia', label: tr('Dia a dia') },
  { id: 'comida', label: tr('Comes e bebes') },
  { id: 'festa', label: tr('Festa') },
  { id: 'amor', label: tr('Amor e amizade') },
  { id: 'malta', label: tr('Malta') },
];

interface Def {
  id: string;
  cat: StickerCat;
  text: string;
  /** Cor lisa do corpo. */
  color: string;
  shape?: Shape;
  eyes: Eyes;
  mouth: Mouth;
  cheeks?: boolean;
  /** Atrás do corpo (balões, brilhos…). */
  back?: ReactNode;
  /** Por cima da cara (óculos, chapéus, lágrimas…). */
  front?: ReactNode;
}

const INK = '#1f1b24';
const WHITE = '#fff';

// ── cores lisas
const C = { coral: '#ff6b6b', red: '#e5484d', orange: '#ff9f43', yellow: '#ffd23f', lime: '#a3e635', green: '#34c985', teal: '#2ec4b6', sky: '#4cc3ff', blue: '#4f7cff', violet: '#9b72ff', pink: '#ff8cc6', cream: '#ffe9c7', gray: '#c7c3d1' };

// ── adereços (coordenadas no quadro 120 x 134; o corpo está centrado em 60,56)
const sunglasses = (
  <g>
    <rect x="31" y="43" width="26" height="16" rx="7" fill={INK} />
    <rect x="63" y="43" width="26" height="16" rx="7" fill={INK} />
    <path d="M57 49h6" stroke={INK} strokeWidth="3.5" />
    <path d="M36 47l7-2" stroke={WHITE} strokeWidth="2.4" strokeLinecap="round" opacity=".55" />
    <path d="M68 47l7-2" stroke={WHITE} strokeWidth="2.4" strokeLinecap="round" opacity=".55" />
  </g>
);
const partyHat = (
  <g>
    <path d="M60 4 44 28h32z" fill={C.pink} />
    <path d="M52 17h16M48 23h24" stroke={WHITE} strokeWidth="3" strokeLinecap="round" />
    <circle cx="60" cy="5" r="4.5" fill={C.yellow} />
  </g>
);
const crown = <path d="M38 24l-3-17 11 8 14-13 14 13 11-8-3 17z" fill={C.yellow} stroke={INK} strokeWidth="3" strokeLinejoin="round" />;
const headphones = (
  <g>
    <path d="M28 54a32 32 0 0 1 64 0" fill="none" stroke={INK} strokeWidth="5" strokeLinecap="round" />
    <rect x="21" y="48" width="12" height="22" rx="6" fill={C.violet} stroke={INK} strokeWidth="3" />
    <rect x="87" y="48" width="12" height="22" rx="6" fill={C.violet} stroke={INK} strokeWidth="3" />
  </g>
);
const cap = (
  <g>
    <path d="M30 34a30 26 0 0 1 60 0z" fill={C.blue} />
    <path d="M26 34h54a10 4 0 0 1 10 6H26z" fill={C.blue} stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
    <circle cx="60" cy="10" r="3" fill={INK} />
  </g>
);
const flameTop = (
  <g transform="translate(60 10)">
    <path d="M0-14c3 6 11 9 11 19a11 11 0 0 1-22 0c0-5 3-7 5-10 1 3 2 4 4 4 0-6-1-9 2-13z" fill={C.orange} />
    <path d="M0 0c2 3 5 4 5 8a5 5 0 0 1-10 0c0-3 3-4 5-8z" fill={C.yellow} />
  </g>
);
const sweat = <path d="M92 28c5 7 8 11 8 16a8 8 0 0 1-16 0c0-5 3-9 8-16z" fill={C.sky} stroke={WHITE} strokeWidth="2.5" strokeLinejoin="round" />;
const tears = (
  <g fill={C.sky} stroke={WHITE} strokeWidth="2" strokeLinejoin="round">
    <path d="M38 62c4 5 6 8 6 12a6 6 0 0 1-12 0c0-4 2-7 6-12z" />
    <path d="M82 62c4 5 6 8 6 12a6 6 0 0 1-12 0c0-4 2-7 6-12z" />
  </g>
);
const zzz = (
  <g fill={WHITE} stroke={INK} strokeWidth="3" strokeLinejoin="round" fontWeight="900" fontFamily="inherit" paintOrder="stroke">
    <text x="84" y="26" fontSize="20">Z</text>
    <text x="98" y="14" fontSize="14">z</text>
  </g>
);
const sparkles = (
  <g fill={C.yellow} stroke={WHITE} strokeWidth="2" strokeLinejoin="round">
    <path d="M96 20l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" />
    <path d="M22 28l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" />
  </g>
);
const hearts = (
  <g fill={C.red} stroke={WHITE} strokeWidth="2" strokeLinejoin="round">
    <path d="M96 38c-8-5-12-9-12-14a7 7 0 0 1 12-3 7 7 0 0 1 12 3c0 5-4 9-12 14z" />
    <path d="M22 30c-6-4-9-7-9-11a5 5 0 0 1 9-2 5 5 0 0 1 9 2c0 4-3 7-9 11z" />
  </g>
);
const beer = (
  <g transform="rotate(12 96 52)">
    <rect x="84" y="36" width="20" height="30" rx="4" fill={C.yellow} stroke={INK} strokeWidth="3" />
    <path d="M104 42h5a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4h-5" fill="none" stroke={INK} strokeWidth="3" />
    <path d="M82 38q3-10 11-7 5-6 12 0 7 1 3 9z" fill={WHITE} stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
  </g>
);
const coffee = (
  <g>
    <path d="M82 40h24v15a11 11 0 0 1-11 11h-2a11 11 0 0 1-11-11z" fill={WHITE} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
    <path d="M106 45h4a5 5 0 0 1 0 12h-4" fill="none" stroke={INK} strokeWidth="3" />
    <path d="M90 33q-3-4 0-8M98 33q-3-4 0-8" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" />
  </g>
);
const pizza = (
  <g transform="rotate(-12 96 52)">
    <path d="M82 34l30 4-19 34z" fill={C.yellow} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
    <circle cx="95" cy="46" r="3.6" fill={C.red} />
    <circle cx="101" cy="55" r="3" fill={C.red} />
  </g>
);
const phone = (
  <g transform="rotate(14 98 52)">
    <rect x="88" y="34" width="20" height="34" rx="5" fill={INK} />
    <rect x="91.5" y="39" width="13" height="22" rx="2" fill={C.sky} />
  </g>
);
const clock = (
  <g transform="translate(97 48)">
    <circle r="15" fill={WHITE} stroke={INK} strokeWidth="3.5" />
    <path d="M0-8V0l6 4" fill="none" stroke={INK} strokeWidth="3.2" strokeLinecap="round" />
  </g>
);
const pin = (
  <g transform="translate(97 46)">
    <path d="M0 22C-12 8-13 2-13-4a13 13 0 0 1 26 0c0 6-1 12-13 26z" fill={C.red} stroke={WHITE} strokeWidth="3" strokeLinejoin="round" />
    <circle cy="-4" r="5" fill={WHITE} />
  </g>
);
const coins = (
  <g>
    <circle cx="96" cy="46" r="13" fill={C.yellow} stroke={INK} strokeWidth="3.2" />
    <text x="96" y="52" textAnchor="middle" fontSize="17" fontWeight="900" fill={INK} fontFamily="inherit">$</text>
    <circle cx="20" cy="40" r="8" fill={C.yellow} stroke={INK} strokeWidth="3" />
  </g>
);
const ball = (
  <g transform="translate(97 50)">
    <circle r="14" fill={WHITE} stroke={INK} strokeWidth="3.4" />
    <path d="M0-6l6 4-2 7h-8l-2-7z" fill={INK} />
  </g>
);
const balloon = (
  <g>
    <path d="M98 30c-12 0-17 9-15 18 2 8 9 12 15 12s13-4 15-12c2-9-3-18-15-18z" fill={C.pink} stroke={WHITE} strokeWidth="2.5" />
    <path d="M98 60q-3 12 3 22" fill="none" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
  </g>
);
const gift = (
  <g>
    <rect x="80" y="46" width="30" height="22" rx="3" fill={C.violet} stroke={INK} strokeWidth="3" />
    <rect x="76" y="40" width="38" height="9" rx="3" fill={C.pink} stroke={INK} strokeWidth="3" />
    <path d="M95 40v28" stroke={INK} strokeWidth="3" />
  </g>
);
const mic = (
  <g transform="rotate(18 98 50)">
    <rect x="91" y="30" width="14" height="22" rx="7" fill={INK} />
    <path d="M91 40h14" stroke={WHITE} strokeWidth="2" opacity=".5" />
    <path d="M98 52v18" stroke={INK} strokeWidth="4" strokeLinecap="round" />
  </g>
);
const note = (
  <g fill={WHITE} stroke={INK} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round">
    <path d="M92 44V22l16-4v22" fill="none" />
    <circle cx="86" cy="46" r="6" />
    <circle cx="102" cy="42" r="6" />
  </g>
);
const thumb = (
  <g transform="translate(97 52)">
    <path d="M-10 4h6l7-14c3 0 5 2 4 6l-1 5h8c3 0 5 3 4 6l-3 11c-1 3-3 4-6 4h-12c-2 0-3-1-3-3z" fill={C.yellow} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
  </g>
);
const sun = (
  <g transform="translate(98 28)">
    <circle r="9" fill={C.yellow} stroke={INK} strokeWidth="2.6" />
    <path d="M0-16v-4M0 16v4M-16 0h-4M16 0h4M-11-11l-3-3M11 11l3 3M11-11l3-3M-11 11l-3 3" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
  </g>
);
const moon = <path d="M100 18a17 17 0 1 0 9 30 14 14 0 0 1-9-30z" fill={C.yellow} stroke={INK} strokeWidth="3" strokeLinejoin="round" />;
const rain = (
  <g>
    <path d="M80 30a12 12 0 0 1 22-6 10 10 0 0 1 14 9H80z" fill={C.gray} stroke={INK} strokeWidth="2.8" strokeLinejoin="round" />
    <path d="M86 40l-3 8M96 40l-3 8M106 40l-3 8" stroke={C.sky} strokeWidth="3.2" strokeLinecap="round" />
  </g>
);
const star = <path d="M98 22l5 11 12 1-9 8 3 12-11-6-11 6 3-12-9-8 12-1z" fill={C.yellow} stroke={INK} strokeWidth="3" strokeLinejoin="round" />;
const bang = (
  <g>
    <path d="M94 16l12 2-2 20-8 1z" fill={C.red} stroke={WHITE} strokeWidth="2.5" strokeLinejoin="round" />
    <circle cx="100" cy="48" r="5" fill={C.red} stroke={WHITE} strokeWidth="2.5" />
  </g>
);
const question = (
  <g fill={WHITE} stroke={INK} strokeWidth="3">
    <circle cx="94" cy="26" r="13" />
    <text x="94" y="33" textAnchor="middle" fontSize="19" fontWeight="900" fill={INK} stroke="none" fontFamily="inherit">?</text>
  </g>
);
const fork = (
  <g transform="rotate(20 98 54)" fill="none" stroke={INK} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M90 32v14a6 6 0 0 0 12 0V32M96 32v40" />
  </g>
);
const cake = (
  <g>
    <path d="M80 70h32V52a16 12 0 0 0-32 0z" fill={C.pink} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
    <path d="M80 60q8 6 16 0t16 0" fill="none" stroke={WHITE} strokeWidth="3.4" />
    <circle cx="96" cy="38" r="5" fill={C.red} stroke={INK} strokeWidth="2.4" />
  </g>
);
const beard = (
  <g>
    <path d="M36 66c0 22 10 30 24 30s24-8 24-30c-6 8-14 11-24 11S42 74 36 66z" fill={WHITE} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
  </g>
);
const ice = (
  <g stroke={C.sky} strokeWidth="3.6" strokeLinecap="round">
    <path d="M98 22v16M90 30h16M92 24l12 12M104 24L92 36" />
  </g>
);
const flag = (
  <g>
    <path d="M90 76V26" stroke={INK} strokeWidth="3.6" strokeLinecap="round" />
    <path d="M90 28h22l-6 9 6 9H90z" fill={C.green} stroke={INK} strokeWidth="2.8" strokeLinejoin="round" />
  </g>
);
const trophy = (
  <g>
    <path d="M84 26h28v14a14 14 0 0 1-28 0z" fill={C.yellow} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
    <path d="M84 30h-7a6 6 0 0 0 7 10M112 30h7a6 6 0 0 1-7 10" fill="none" stroke={INK} strokeWidth="3" />
    <path d="M98 54v8M90 66h16" stroke={INK} strokeWidth="3.6" strokeLinecap="round" />
  </g>
);
const kissMark = (
  <g fill={C.red} stroke={WHITE} strokeWidth="2" strokeLinejoin="round">
    <path d="M96 40c-8-5-12-9-12-14a7 7 0 0 1 12-3 7 7 0 0 1 12 3c0 5-4 9-12 14z" />
  </g>
);

// ── os stickers (os ids antigos mantêm-se: mensagens já enviadas continuam a aparecer)
export const STICKERS: Def[] = [
  // Reações
  { id: 'bora', cat: 'reacoes', text: 'BORA!', color: C.coral, eyes: 'wide', mouth: 'grin', front: flameTop },
  { id: 'fixe', cat: 'reacoes', text: 'TÁ FIXE', color: C.green, eyes: 'happy', mouth: 'grin', front: thumb },
  { id: 'ok', cat: 'reacoes', text: 'OK', color: C.gray, shape: 'squircle', eyes: 'dots', mouth: 'smile' },
  { id: 'rir', cat: 'reacoes', text: 'AHAHAH', color: C.yellow, eyes: 'happy', mouth: 'laugh' },
  { id: 'morri', cat: 'reacoes', text: 'MORRI', color: C.yellow, shape: 'blob', eyes: 'closed', mouth: 'laugh', front: tears },
  { id: 'uau', cat: 'reacoes', text: 'UAU!', color: C.violet, eyes: 'wide', mouth: 'o', back: sparkles },
  { id: 'ups', cat: 'reacoes', text: 'UPS…', color: C.orange, eyes: 'wide', mouth: 'flat', front: sweat },
  { id: 'hmm', cat: 'reacoes', text: 'HMMM', color: C.sky, shape: 'squircle', eyes: 'side', mouth: 'flat', front: question },
  { id: 'snif', cat: 'reacoes', text: 'SNIF', color: C.sky, shape: 'drop', eyes: 'dots', mouth: 'sad', front: tears },
  { id: 'grr', cat: 'reacoes', text: 'GRRR', color: C.red, eyes: 'angry', mouth: 'grin', front: bang },
  { id: 'rei', cat: 'reacoes', text: 'LENDA', color: C.yellow, eyes: 'wink', mouth: 'smirk', front: crown },
  { id: 'estrela', cat: 'reacoes', text: 'ESTRELA', color: C.pink, shape: 'blob', eyes: 'star', mouth: 'smile', back: star },
  { id: 'cool', cat: 'reacoes', text: 'COOL', color: C.teal, eyes: 'none', mouth: 'smirk', front: sunglasses },
  { id: 'sim', cat: 'reacoes', text: 'SIM!', color: C.green, shape: 'squircle', eyes: 'happy', mouth: 'smile', cheeks: true },
  { id: 'nao', cat: 'reacoes', text: 'NÃO!', color: C.red, shape: 'squircle', eyes: 'angry', mouth: 'flat' },
  { id: 'choque', cat: 'reacoes', text: 'CHOQUE', color: C.lime, shape: 'blob', eyes: 'wide', mouth: 'o', front: bang },
  { id: 'tonto', cat: 'reacoes', text: 'TONTO', color: C.violet, eyes: 'dizzy', mouth: 'tongue' },
  { id: 'vergonha', cat: 'reacoes', text: 'VERGONHA', color: C.pink, eyes: 'closed', mouth: 'smile', cheeks: true, front: sweat },

  // Dia a dia
  { id: 'bom-dia', cat: 'dia', text: 'BOM DIA', color: C.yellow, eyes: 'happy', mouth: 'smile', cheeks: true, front: sun },
  { id: 'dormir', cat: 'dia', text: 'BOA NOITE', color: C.violet, shape: 'squircle', eyes: 'closed', mouth: 'smile', front: zzz, back: moon },
  { id: 'ja-vou', cat: 'dia', text: 'JÁ VOU', color: C.sky, eyes: 'wide', mouth: 'o', front: clock },
  { id: 'a-caminho', cat: 'dia', text: 'A CAMINHO', color: C.violet, eyes: 'dots', mouth: 'smile', front: pin },
  { id: 'cheguei', cat: 'dia', text: 'CHEGUEI', color: C.green, eyes: 'happy', mouth: 'grin', front: flag },
  { id: 'em-casa', cat: 'dia', text: 'EM CASA', color: C.orange, shape: 'squircle', eyes: 'closed', mouth: 'smile', cheeks: true },
  { id: 'liga-me', cat: 'dia', text: 'LIGA-ME', color: C.blue, eyes: 'dots', mouth: 'o', front: phone },
  { id: 'ocupado', cat: 'dia', text: 'OCUPADO', color: C.gray, shape: 'squircle', eyes: 'wide', mouth: 'flat', front: clock },
  { id: 'obrigado', cat: 'dia', text: 'OBRIGADO', color: C.pink, eyes: 'happy', mouth: 'smile', cheeks: true, back: sparkles },
  { id: 'desculpa', cat: 'dia', text: 'DESCULPA', color: C.orange, shape: 'drop', eyes: 'dots', mouth: 'sad', front: sweat },
  { id: 'saudades', cat: 'dia', text: 'SAUDADES', color: C.coral, eyes: 'dots', mouth: 'sad', front: hearts },
  { id: 'trabalho', cat: 'dia', text: 'A TRABALHAR', color: C.teal, shape: 'squircle', eyes: 'dots', mouth: 'flat', front: coffee },
  { id: 'chuva', cat: 'dia', text: 'CHUVA', color: C.sky, shape: 'drop', eyes: 'dots', mouth: 'sad', front: rain },
  { id: 'calor', cat: 'dia', text: 'QUE CALOR', color: C.orange, eyes: 'wide', mouth: 'tongue', front: sweat, back: sun },
  { id: 'atrasado', cat: 'dia', text: 'ATRASADO', color: C.red, shape: 'blob', eyes: 'wide', mouth: 'o', front: clock },
  { id: 'cansado', cat: 'dia', text: 'CANSADO', color: C.gray, shape: 'blob', eyes: 'closed', mouth: 'flat', front: zzz },
  { id: 'que-sono', cat: 'dia', text: 'QUE SONO', color: C.violet, eyes: 'closed', mouth: 'o', front: zzz },

  // Comes e bebes
  { id: 'fome', cat: 'comida', text: 'TÔ COM FOME', color: C.orange, eyes: 'wide', mouth: 'tongue', front: fork },
  { id: 'pizza', cat: 'comida', text: 'PIZZA?', color: C.yellow, eyes: 'happy', mouth: 'tongue', front: pizza },
  { id: 'gelada', cat: 'comida', text: 'UMA GELADA', color: C.yellow, eyes: 'happy', mouth: 'grin', front: beer },
  { id: 'cafe', cat: 'comida', text: 'CAFÉ?', color: C.cream, shape: 'squircle', eyes: 'happy', mouth: 'smile', front: coffee },
  { id: 'saude', cat: 'comida', text: 'SAÚDE!', color: C.yellow, eyes: 'happy', mouth: 'laugh', front: beer },
  { id: 'paga', cat: 'comida', text: 'PAGAS TU!', color: C.orange, eyes: 'wink', mouth: 'tongue', front: coins },
  { id: 'almoco', cat: 'comida', text: 'ALMOÇO?', color: C.green, shape: 'squircle', eyes: 'happy', mouth: 'smile', front: fork },
  { id: 'jantar', cat: 'comida', text: 'JANTAR?', color: C.violet, eyes: 'wide', mouth: 'smile', front: fork },
  { id: 'sede', cat: 'comida', text: 'COM SEDE', color: C.sky, shape: 'drop', eyes: 'wide', mouth: 'tongue', front: beer },
  { id: 'docinho', cat: 'comida', text: 'DOCINHO', color: C.pink, eyes: 'heart', mouth: 'tongue', front: cake },
  { id: 'brasa', cat: 'comida', text: 'NA BRASA', color: C.red, shape: 'blob', eyes: 'happy', mouth: 'grin', front: flameTop },
  { id: 'cerveja-gelada', cat: 'comida', text: 'BEM GELADA', color: C.teal, eyes: 'wink', mouth: 'smirk', front: ice },
  { id: 'cafe-forte', cat: 'comida', text: 'CAFÉ FORTE', color: C.coral, eyes: 'wide', mouth: 'grin', front: coffee },

  // Festa
  { id: 'festa', cat: 'festa', text: 'FESTA!', color: C.violet, eyes: 'happy', mouth: 'laugh', front: note },
  { id: 'parabens', cat: 'festa', text: 'PARABÉNS', color: C.pink, eyes: 'happy', mouth: 'laugh', front: partyHat },
  { id: 'sair', cat: 'festa', text: 'VAMOS SAIR', color: C.blue, eyes: 'wink', mouth: 'grin', front: note },
  { id: 'som', cat: 'festa', text: 'AUMENTA O SOM', color: C.violet, eyes: 'closed', mouth: 'grin', front: headphones },
  { id: 'jogo', cat: 'festa', text: 'HOJE HÁ JOGO', color: C.green, eyes: 'wide', mouth: 'grin', front: ball },
  { id: 'vitoria', cat: 'festa', text: 'GANHÁMOS!', color: C.yellow, eyes: 'happy', mouth: 'laugh', front: trophy },
  { id: 'dj', cat: 'festa', text: 'DJ NA CASA', color: C.coral, eyes: 'none', mouth: 'smirk', front: headphones },
  { id: 'dancar', cat: 'festa', text: 'DANÇA!', color: C.pink, shape: 'blob', eyes: 'happy', mouth: 'grin', front: note },
  { id: 'balao', cat: 'festa', text: 'FESTA JÁ', color: C.sky, eyes: 'happy', mouth: 'smile', back: balloon },
  { id: 'presente', cat: 'festa', text: 'PRESENTE!', color: C.violet, shape: 'squircle', eyes: 'happy', mouth: 'grin', front: gift },
  { id: 'microfone', cat: 'festa', text: 'MICROFONE', color: C.teal, eyes: 'closed', mouth: 'laugh', front: mic },
  { id: 'bone', cat: 'festa', text: 'BORA SAIR', color: C.blue, eyes: 'dots', mouth: 'smirk', front: cap },

  // Amor e amizade
  { id: 'amor', cat: 'amor', text: 'ADORO', color: C.coral, eyes: 'heart', mouth: 'smile', back: hearts },
  { id: 'beijinho', cat: 'amor', text: 'BEIJINHO', color: C.pink, eyes: 'closed', mouth: 'kiss', cheeks: true, front: kissMark },
  { id: 'abraco', cat: 'amor', text: 'ABRAÇO', color: C.orange, shape: 'blob', eyes: 'closed', mouth: 'smile', cheeks: true, back: hearts },
  { id: 'meu-mano', cat: 'amor', text: 'MEU MANO', color: C.blue, eyes: 'none', mouth: 'smirk', front: sunglasses },
  { id: 'crush', cat: 'amor', text: 'CRUSH', color: C.pink, shape: 'drop', eyes: 'heart', mouth: 'o', cheeks: true },
  { id: 'ciumes', cat: 'amor', text: 'CIÚMES', color: C.lime, eyes: 'side', mouth: 'flat' },
  { id: 'meu-amor', cat: 'amor', text: 'MEU AMOR', color: C.red, shape: 'squircle', eyes: 'heart', mouth: 'grin', front: hearts },
  { id: 'parceiro', cat: 'amor', text: 'PARCEIRO', color: C.teal, eyes: 'wink', mouth: 'grin', front: thumb },
  { id: 'miss-you', cat: 'amor', text: 'ESTOU CONTIGO', color: C.violet, shape: 'blob', eyes: 'closed', mouth: 'smile', cheeks: true },
  { id: 'obrigadao', cat: 'amor', text: 'VALEU!', color: C.green, eyes: 'happy', mouth: 'grin', front: thumb },

  // Malta
  { id: 'malta', cat: 'malta', text: 'MALTA!', color: C.coral, shape: 'squircle', eyes: 'happy', mouth: 'laugh', front: partyHat },
  { id: 'maningue', cat: 'malta', text: 'MANINGUE FIXE', color: C.green, eyes: 'wide', mouth: 'grin', front: thumb },
  { id: 'txilar', cat: 'malta', text: 'TXILAR', color: C.sky, eyes: 'closed', mouth: 'smile', cheeks: true, front: sunglasses },
  { id: 'paulada', cat: 'malta', text: 'PAULADA!', color: C.violet, shape: 'blob', eyes: 'wide', mouth: 'laugh', front: beer, back: sparkles },
  { id: 'madala', cat: 'malta', text: 'MADALA', color: C.gray, eyes: 'dots', mouth: 'smile', front: beard },
  { id: 'gelado', cat: 'malta', text: 'GELADO', color: C.teal, shape: 'squircle', eyes: 'wink', mouth: 'smirk', front: ice },
  { id: 'bora-malta', cat: 'malta', text: 'BORA MALTA', color: C.orange, eyes: 'happy', mouth: 'grin', front: flag },
  { id: 'chefe', cat: 'malta', text: 'O CHEFE', color: C.yellow, shape: 'blob', eyes: 'none', mouth: 'smirk', front: sunglasses, back: crown },
];

// ── corpo
function body(shape: Shape, color: string) {
  switch (shape) {
    case 'squircle':
      return <rect x="22" y="18" width="76" height="76" rx="30" fill={color} />;
    case 'blob':
      return <path d="M60 16c22 0 40 14 40 38 0 26-16 42-40 42S20 80 20 54c0-23 18-38 40-38z" fill={color} />;
    case 'drop':
      return <path d="M60 10C74 30 98 44 98 66a38 36 0 0 1-76 0c0-22 24-36 38-56z" fill={color} />;
    default:
      return <circle cx="60" cy="56" r="39" fill={color} />;
  }
}

// ── cara
function eyes(kind: Eyes) {
  const line = { fill: 'none', stroke: INK, strokeWidth: 4.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (kind) {
    case 'none':
      return null;
    case 'happy':
      return <g {...line}><path d="M39 52q7-9 14 0M67 52q7-9 14 0" /></g>;
    case 'closed':
      return <g {...line}><path d="M39 50q7 8 14 0M67 50q7 8 14 0" /></g>;
    case 'wink':
      return <g><circle cx="46" cy="50" r="4.8" fill={INK} /><path d="M67 52q7-9 14 0" {...line} /></g>;
    case 'wide':
      return <g><circle cx="46" cy="49" r="9" fill={WHITE} /><circle cx="46" cy="50" r="4.6" fill={INK} /><circle cx="74" cy="49" r="9" fill={WHITE} /><circle cx="74" cy="50" r="4.6" fill={INK} /></g>;
    case 'side':
      return <g><circle cx="46" cy="50" r="8" fill={WHITE} /><circle cx="49" cy="50" r="4.2" fill={INK} /><circle cx="74" cy="50" r="8" fill={WHITE} /><circle cx="77" cy="50" r="4.2" fill={INK} /></g>;
    case 'heart':
      return (
        <g fill={C.red}>
          <path d="M46 60c-8-5-11-8-11-12a5.5 5.5 0 0 1 11-1 5.5 5.5 0 0 1 11 1c0 4-3 7-11 12z" />
          <path d="M74 60c-8-5-11-8-11-12a5.5 5.5 0 0 1 11-1 5.5 5.5 0 0 1 11 1c0 4-3 7-11 12z" />
        </g>
      );
    case 'star':
      return (
        <g fill={INK}>
          <path d="M46 42l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z" />
          <path d="M74 42l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z" />
        </g>
      );
    case 'dizzy':
      return <g {...line}><path d="M40 44l12 12M52 44L40 56M68 44l12 12M80 44L68 56" /></g>;
    case 'angry':
      return (
        <g>
          <path d="M37 40l17 6M83 40L66 46" {...line} />
          <circle cx="46" cy="52" r="4.4" fill={INK} />
          <circle cx="74" cy="52" r="4.4" fill={INK} />
        </g>
      );
    default:
      return <g fill={INK}><circle cx="46" cy="50" r="4.8" /><circle cx="74" cy="50" r="4.8" /></g>;
  }
}

function mouth(kind: Mouth) {
  const line = { fill: 'none', stroke: INK, strokeWidth: 4.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (kind) {
    case 'none':
      return null;
    case 'grin':
      return <path d="M44 66h32a16 14 0 0 1-32 0z" fill={INK} />;
    case 'laugh':
      return (
        <g>
          <path d="M42 64h36a18 17 0 0 1-36 0z" fill={INK} />
          <path d="M51 76q9-7 18 0q-9 6-18 0z" fill={C.coral} />
        </g>
      );
    case 'o':
      return <ellipse cx="60" cy="72" rx="6.5" ry="8" fill={INK} />;
    case 'flat':
      return <path d="M50 72h20" {...line} />;
    case 'sad':
      return <path d="M49 76q11-10 22 0" {...line} />;
    case 'smirk':
      return <path d="M50 70q8 7 20-1" {...line} />;
    case 'kiss':
      return <path d="M54 68q6-5 12 0q-6 9-12 0z" fill={C.red} />;
    case 'tongue':
      return (
        <g>
          <path d="M46 68q14 12 28 0" {...line} />
          <path d="M56 74v6a4 4 0 0 0 8 0v-6" fill={C.coral} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
        </g>
      );
    default:
      return <path d="M47 67q13 12 26 0" {...line} />;
  }
}

/** O sticker: recorte com fundo transparente (corpo liso, cara simples, adereço e texto) com contorno branco e sombra suave. */
export function Sticker({ id, size = 132, bare = false }: { id: string; size?: number; bare?: boolean }) {
  const uid = useId().replace(/:/g, '');
  const s = STICKERS.find((x) => x.id === id);
  if (!s) return <span className="text-sm text-zinc-500">Sticker</span>;
  const h = Math.round(size * (bare ? 0.98 : 1.12));
  return (
    <svg role="img" aria-label={`Sticker: ${s.text}`} width={size} height={h} viewBox={bare ? '0 4 120 118' : '0 0 120 134'} className="shrink-0 overflow-visible">
      <defs>
        <filter id={`f${uid}`} x="-20%" y="-20%" width="140%" height="140%">
          <feMorphology in="SourceAlpha" operator="dilate" radius="3.4" result="grow" />
          <feFlood floodColor="#fff" result="white" />
          <feComposite in="white" in2="grow" operator="in" result="edge" />
          <feDropShadow in="edge" dx="0" dy="2.5" stdDeviation="2.4" floodColor="#000" floodOpacity="0.26" result="shadow" />
          <feMerge><feMergeNode in="shadow" /><feMergeNode in="edge" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <g filter={`url(#f${uid})`}>
        {s.back}
        {body(s.shape ?? 'round', s.color)}
        {/* um brilho pequeno, só para dar volume sem degradês */}
        <path d="M36 36q4-8 14-10" fill="none" stroke={WHITE} strokeWidth="4.5" strokeLinecap="round" opacity=".45" />
        {s.cheeks && (
          <g fill={C.coral} opacity=".55">
            <ellipse cx="35" cy="64" rx="6.5" ry="4.2" />
            <ellipse cx="85" cy="64" rx="6.5" ry="4.2" />
          </g>
        )}
        {eyes(s.eyes)}
        {mouth(s.mouth)}
        {s.front}
        {!bare && (
          <text x="60" y="122" textAnchor="middle" fontSize={s.text.length > 12 ? 12.5 : s.text.length > 9 ? 15 : 19} fontWeight="900" letterSpacing="0.4" fill={WHITE} stroke={INK} strokeWidth="5" strokeLinejoin="round" paintOrder="stroke" fontFamily="inherit">
            {s.text}
          </text>
        )}
      </g>
    </svg>
  );
}

/** Sticker que se toca: abre-o em grande (toca fora para fechar). */
export function StickerButton({ id, size = 132, className = '' }: { id: string; size?: number; className?: string }) {
  const [big, setBig] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setBig(true)} aria-label={tr('Ver sticker em grande')} className={`block transition active:scale-95 ${className}`}>
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

const RECENT_KEY = 'tx_stickers_recent';
function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => STICKERS.some((s) => s.id === x)).slice(0, 8) : [];
  } catch {
    return [];
  }
}

/** Seletor de stickers: recentes e separadores por categoria. */
export function StickerPicker({ onPick, onClose }: { onPick: (id: string) => void; onClose?: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  // Tocar fora do seletor fecha-o (o botão que o abre trata do seu próprio toque).
  useEffect(() => {
    if (!onClose) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (box.current?.contains(t) || t?.closest('[data-sticker-toggle]')) return;
      onClose();
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [onClose]);
  const [cat, setCat] = useState<StickerCat | 'recentes'>(() => (readRecent().length ? 'recentes' : 'reacoes'));
  const [recent, setRecent] = useState<string[]>(readRecent);
  const tabs: { id: StickerCat | 'recentes'; label: string }[] = [...(recent.length ? [{ id: 'recentes' as const, label: tr('Recentes') }] : []), ...STICKER_CATS];
  const list = cat === 'recentes' ? recent.map((id) => STICKERS.find((s) => s.id === id)!).filter(Boolean) : STICKERS.filter((s) => s.cat === cat);
  function pick(id: string) {
    const next = [id, ...recent.filter((x) => x !== id)].slice(0, 8);
    setRecent(next);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      /* sem armazenamento: só não guarda os recentes */
    }
    onPick(id);
  }
  return (
    <div ref={box} className="mx-3 mt-2 overflow-hidden rounded-2xl bg-zinc-50" aria-label="Stickers">
      <div role="tablist" className="flex gap-1 overflow-x-auto px-2 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={cat === t.id} onClick={() => setCat(t.id)} className={`h-8 shrink-0 rounded-full px-3 text-[13px] font-semibold transition ${cat === t.id ? 'bg-brand text-white' : 'bg-white text-zinc-700 active:bg-zinc-100'}`}>{t.label}</button>
        ))}
      </div>
      <div className="grid max-h-56 grid-cols-4 gap-1 overflow-y-auto p-2">
        {list.map((st) => (
          <button key={st.id} type="button" onClick={() => pick(st.id)} aria-label={`Enviar sticker ${st.text}`} className="flex justify-center rounded-2xl p-1 active:scale-90"><Sticker id={st.id} size={72} /></button>
        ))}
      </div>
    </div>
  );
}

/** Reações a stories: a mesma mascote dos stickers, sem texto. Guardam-se como :nome: (os emojis antigos continuam a aparecer). */
export const REACTIONS: { id: string; label: string; art: string }[] = [
  { id: ':rir:', label: tr('Rir'), art: 'rir' },
  { id: ':uau:', label: tr('Uau'), art: 'uau' },
  { id: ':amor:', label: tr('Adorar'), art: 'amor' },
  { id: ':snif:', label: tr('Triste'), art: 'snif' },
  { id: ':palmas:', label: tr('Fixe'), art: 'fixe' },
  { id: ':fogo:', label: tr('Bora'), art: 'bora' },
  { id: ':brinde:', label: tr('Brindar'), art: 'saude' },
];

export function Reaction({ body, size = 40 }: { body: string; size?: number }) {
  const r = REACTIONS.find((x) => x.id === body);
  if (!r) return <span style={{ fontSize: size * 0.85, lineHeight: 1 }}>{body}</span>;
  return <Sticker id={r.art} size={size} bare />;
}

/** Texto simples de uma reação (para listas de mensagens). */
export const reactionText = (body: string) => REACTIONS.find((x) => x.id === body)?.label ?? body;
