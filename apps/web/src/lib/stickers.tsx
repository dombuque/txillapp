import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { tr } from './i18n';

/**
 * Stickers do Txillapp: autocolantes minimalistas em SVG (fundo transparente, contorno branco de recorte e sombra suave).
 * Cada um junta um corpo de cor lisa, uma cara muito simples (olhos e boca), por vezes um adereço, e o texto. O servidor só guarda o id.
 */
type Eyes = 'dots' | 'happy' | 'closed' | 'wide' | 'heart' | 'star' | 'dizzy' | 'wink' | 'side' | 'angry' | 'none';
type Mouth = 'smile' | 'grin' | 'o' | 'flat' | 'sad' | 'tongue' | 'laugh' | 'smirk' | 'kiss' | 'none';
type Shape = 'round' | 'squircle' | 'blob' | 'drop';

export type StickerCat = 'reacoes' | 'dia' | 'comida' | 'festa' | 'amor' | 'malta' | 'desporto' | 'musica' | 'estudo' | 'terra';
export const STICKER_CATS: { id: StickerCat; label: string }[] = [
  { id: 'reacoes', label: tr('Reações') },
  { id: 'dia', label: tr('Dia a dia') },
  { id: 'comida', label: tr('Comes e bebes') },
  { id: 'festa', label: tr('Festa') },
  { id: 'amor', label: tr('Amor e amizade') },
  { id: 'malta', label: tr('Malta') },
  { id: 'desporto', label: tr('Desporto') },
  { id: 'musica', label: tr('Música e dança') },
  { id: 'estudo', label: tr('Estudo e trabalho') },
  { id: 'terra', label: tr('A nossa terra') },
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


const camera = (
  <g>
    <rect x="80" y="40" width="34" height="24" rx="6" fill={INK} />
    <rect x="90" y="35" width="14" height="7" rx="3" fill={INK} />
    <circle cx="97" cy="52" r="8" fill={C.sky} stroke={WHITE} strokeWidth="2.6" />
  </g>
);
const book = (
  <g>
    <rect x="80" y="34" width="30" height="34" rx="4" fill={C.blue} stroke={INK} strokeWidth="3" />
    <path d="M87 34v34M93 44h12M93 51h12" stroke={WHITE} strokeWidth="2.6" strokeLinecap="round" />
  </g>
);
const umbrella = (
  <g>
    <path d="M78 46a20 18 0 0 1 40 0z" fill={C.pink} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
    <path d="M98 46v20a4.5 4.5 0 0 1-9 0" fill="none" stroke={INK} strokeWidth="3.4" strokeLinecap="round" />
  </g>
);
const car = (
  <g>
    <path d="M78 58l6-12a6 6 0 0 1 5-3h16a6 6 0 0 1 5 3l6 12z" fill={C.red} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
    <rect x="76" y="56" width="42" height="11" rx="5" fill={C.red} stroke={INK} strokeWidth="3" />
    <circle cx="87" cy="68" r="5.5" fill={INK} />
    <circle cx="107" cy="68" r="5.5" fill={INK} />
  </g>
);
const house = (
  <g>
    <path d="M78 54l20-18 20 18v16H78z" fill={C.orange} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
    <rect x="93" y="58" width="10" height="12" rx="2" fill={INK} />
  </g>
);
const drum = (
  <g>
    <path d="M82 42h32v18a16 6 0 0 1-32 0z" fill={C.red} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
    <ellipse cx="98" cy="42" rx="16" ry="6" fill={C.cream} stroke={INK} strokeWidth="3" />
    <path d="M84 30l12 10M112 30L100 40" stroke={INK} strokeWidth="3.4" strokeLinecap="round" />
  </g>
);
const megaphone = (
  <g>
    <path d="M82 44l24-12v32l-24-12z" fill={C.yellow} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
    <rect x="76" y="42" width="8" height="14" rx="3" fill={INK} />
    <path d="M112 40q5 8 0 16M118 36q9 12 0 24" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" />
  </g>
);
const iceCream = (
  <g>
    <path d="M88 54h20l-10 24z" fill={C.orange} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
    <circle cx="98" cy="46" r="12" fill={C.pink} stroke={INK} strokeWidth="3" />
  </g>
);
const burger = (
  <g>
    <path d="M80 48a18 12 0 0 1 36 0z" fill={C.orange} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
    <rect x="80" y="50" width="36" height="6" rx="3" fill="#7a4a2b" stroke={INK} strokeWidth="2.6" />
    <rect x="80" y="58" width="36" height="7" rx="3.5" fill={C.orange} stroke={INK} strokeWidth="3" />
  </g>
);
const laptop = (
  <g>
    <rect x="82" y="36" width="32" height="22" rx="4" fill={C.gray} stroke={INK} strokeWidth="3" />
    <rect x="76" y="58" width="44" height="6" rx="3" fill={INK} />
  </g>
);
const guitar = (
  <g transform="rotate(-35 98 52)">
    <rect x="96" y="22" width="5" height="26" rx="2" fill={INK} />
    <ellipse cx="98.5" cy="58" rx="12" ry="13" fill={C.orange} stroke={INK} strokeWidth="3" />
    <circle cx="98.5" cy="58" r="3.6" fill={INK} />
  </g>
);
const bag = (
  <g>
    <rect x="82" y="44" width="28" height="26" rx="5" fill={C.violet} stroke={INK} strokeWidth="3" />
    <path d="M89 44v-5a7 7 0 0 1 14 0v5" fill="none" stroke={INK} strokeWidth="3.2" strokeLinecap="round" />
  </g>
);
const plane = (
  <g>
    <path d="M78 54l38-18-12 32-9-9-9 7z" fill={C.sky} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
  </g>
);
const rose = (
  <g>
    <path d="M97 48v22M97 60q8-6 12-4" fill="none" stroke={C.green} strokeWidth="3.4" strokeLinecap="round" />
    <circle cx="97" cy="40" r="10" fill={C.red} stroke={INK} strokeWidth="3" />
    <path d="M92 40q5 5 10-1" fill="none" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
  </g>
);
const medal = (
  <g>
    <path d="M88 22l8 16M108 22l-8 16" stroke={C.red} strokeWidth="6" strokeLinecap="round" />
    <circle cx="98" cy="48" r="12" fill={C.yellow} stroke={INK} strokeWidth="3" />
    <path d="M98 42v12" stroke={INK} strokeWidth="3.4" strokeLinecap="round" />
  </g>
);
const heartBig = <path d="M98 66c-16-10-22-17-22-25a11 11 0 0 1 22-3 11 11 0 0 1 22 3c0 8-6 15-22 25z" fill={C.pink} stroke={INK} strokeWidth="3" strokeLinejoin="round" />;
const bolt = <path d="M104 18L86 50h12l-5 22 22-34h-13z" fill={C.yellow} stroke={INK} strokeWidth="3" strokeLinejoin="round" />;
const cloud = <path d="M82 52a12 12 0 0 1 22-7 10 10 0 0 1 14 9 8 8 0 0 1-2 16H86a9 9 0 0 1-4-18z" fill={WHITE} stroke={INK} strokeWidth="3" strokeLinejoin="round" />;
const PROPS: Record<string, ReactNode> = {
  sunglasses, partyHat, crown, headphones, cap, flameTop, sweat, tears, zzz, sparkles, hearts, beer, coffee, pizza, phone, clock, pin, coins, ball, balloon, gift, mic, note, thumb, sun, moon, rain, star, bang, question, fork, cake, beard, ice, flag, trophy, kissMark,
  camera, book, umbrella, car, house, drum, megaphone, iceCream, burger, laptop, guitar, bag, plane, rose, medal, heartBig, bolt, cloud,
};

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
  // reacoes (mais)
  { id: 'ai-ai-ai', cat: 'reacoes', text: 'AI AI AI', color: C.lime, eyes: 'wide', mouth: 'flat', front: PROPS.sweat },
  { id: 'nao-acredito', cat: 'reacoes', text: 'NÃO ACREDITO', color: C.orange, shape: 'blob', eyes: 'wide', mouth: 'o' },
  { id: 'e-verdade', cat: 'reacoes', text: 'É VERDADE?', color: C.violet, shape: 'blob', eyes: 'side', mouth: 'flat', front: PROPS.question },
  { id: 'pronto', cat: 'reacoes', text: 'PRONTO', color: C.green, shape: 'squircle', eyes: 'closed', mouth: 'smile', cheeks: true },
  { id: 'calma', cat: 'reacoes', text: 'CALMA', color: C.green, eyes: 'closed', mouth: 'smile', cheeks: true },
  { id: 'epa', cat: 'reacoes', text: 'EPA!', color: C.blue, shape: 'blob', eyes: 'wide', mouth: 'o' },
  { id: 'pa', cat: 'reacoes', text: 'PÁ…', color: C.violet, shape: 'drop', eyes: 'dots', mouth: 'sad' },
  { id: 'olha-so', cat: 'reacoes', text: 'OLHA SÓ', color: C.violet, shape: 'squircle', eyes: 'wink', mouth: 'smirk' },
  { id: 'claro', cat: 'reacoes', text: 'CLARO', color: C.pink, eyes: 'wink', mouth: 'smirk' },
  { id: 'com-certeza', cat: 'reacoes', text: 'COM CERTEZA', color: C.orange, shape: 'squircle', eyes: 'happy', mouth: 'grin' },
  { id: 'talvez', cat: 'reacoes', text: 'TALVEZ', color: C.violet, eyes: 'side', mouth: 'flat', front: PROPS.question },
  { id: 'que-dizes', cat: 'reacoes', text: 'QUE DIZES?', color: C.violet, eyes: 'side', mouth: 'flat', front: PROPS.question },
  { id: 'ah-bom', cat: 'reacoes', text: 'AH BOM', color: C.orange, shape: 'blob', eyes: 'happy', mouth: 'smile', cheeks: true },
  { id: 'deixa-estar', cat: 'reacoes', text: 'DEIXA ESTAR', color: C.green, shape: 'squircle', eyes: 'closed', mouth: 'smile', cheeks: true },
  { id: 'e-isso', cat: 'reacoes', text: 'É ISSO', color: C.orange, shape: 'blob', eyes: 'happy', mouth: 'grin' },
  { id: 'exato', cat: 'reacoes', text: 'EXATO', color: C.teal, eyes: 'happy', mouth: 'grin' },
  { id: 'fixolas', cat: 'reacoes', text: 'FIXOLAS', color: C.green, eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.thumb },
  { id: 'ta-a-voar', cat: 'reacoes', text: 'TÁ A VOAR', color: C.violet, eyes: 'star', mouth: 'grin' },
  { id: 'brutal', cat: 'reacoes', text: 'BRUTAL', color: C.violet, shape: 'squircle', eyes: 'star', mouth: 'grin', front: PROPS.flameTop },
  { id: 'incrivel', cat: 'reacoes', text: 'INCRÍVEL', color: C.sky, eyes: 'wide', mouth: 'o', front: PROPS.sparkles },
  { id: 'loucura', cat: 'reacoes', text: 'LOUCURA', color: C.pink, shape: 'blob', eyes: 'dizzy', mouth: 'tongue' },
  { id: 'que-fixe', cat: 'reacoes', text: 'QUE FIXE', color: C.blue, shape: 'blob', eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.thumb },
  { id: 'ta-dificil', cat: 'reacoes', text: 'TÁ DIFÍCIL', color: C.yellow, shape: 'squircle', eyes: 'wide', mouth: 'flat', front: PROPS.sweat },
  { id: 'nem-por-isso', cat: 'reacoes', text: 'NEM POR ISSO', color: C.blue, shape: 'blob', eyes: 'wink', mouth: 'smirk' },
  { id: 'ta-bom', cat: 'reacoes', text: 'TÁ BOM', color: C.orange, shape: 'blob', eyes: 'happy', mouth: 'smile', cheeks: true },
  { id: 'ta-bem', cat: 'reacoes', text: 'TÁ BEM', color: C.sky, eyes: 'closed', mouth: 'smile', cheeks: true },
  { id: 'nada-a-ver', cat: 'reacoes', text: 'NADA A VER', color: C.yellow, shape: 'squircle', eyes: 'wink', mouth: 'smirk' },
  { id: 'deixa-la', cat: 'reacoes', text: 'DEIXA LÁ', color: C.sky, eyes: 'dots', mouth: 'sad' },
  { id: 'serio', cat: 'reacoes', text: 'SÉRIO?', color: C.orange, shape: 'squircle', eyes: 'wide', mouth: 'o' },
  { id: 'mentira', cat: 'reacoes', text: 'MENTIRA!', color: C.orange, eyes: 'wide', mouth: 'o', front: PROPS.bang },
  { id: 'eu-sabia', cat: 'reacoes', text: 'EU SABIA', color: C.violet, shape: 'squircle', eyes: 'wink', mouth: 'smirk' },
  { id: 'afinal', cat: 'reacoes', text: 'AFINAL…', color: C.violet, eyes: 'side', mouth: 'flat', front: PROPS.question },
  { id: 'outra-vez', cat: 'reacoes', text: 'OUTRA VEZ?', color: C.red, shape: 'blob', eyes: 'angry', mouth: 'grin' },
  { id: 'ja-chega', cat: 'reacoes', text: 'JÁ CHEGA', color: C.coral, shape: 'blob', eyes: 'angry', mouth: 'flat' },
  { id: 'respeita', cat: 'reacoes', text: 'RESPEITA', color: C.coral, shape: 'squircle', eyes: 'angry', mouth: 'flat', front: PROPS.bang },
  { id: 'que-medo', cat: 'reacoes', text: 'QUE MEDO', color: C.yellow, eyes: 'wide', mouth: 'flat', front: PROPS.sweat },
  { id: 'arre', cat: 'reacoes', text: 'ARRE', color: C.lime, shape: 'squircle', eyes: 'wide', mouth: 'flat', front: PROPS.sweat },
  { id: 'perdao', cat: 'reacoes', text: 'PERDÃO', color: C.blue, shape: 'drop', eyes: 'dots', mouth: 'sad' },
  { id: 'eu-nao', cat: 'reacoes', text: 'EU NÃO', color: C.coral, shape: 'squircle', eyes: 'closed', mouth: 'smile', cheeks: true },
  { id: 'quem-eu', cat: 'reacoes', text: 'QUEM, EU?', color: C.orange, shape: 'squircle', eyes: 'closed', mouth: 'smile', cheeks: true, front: PROPS.question },
  { id: 'acho-que-sim', cat: 'reacoes', text: 'ACHO QUE SIM', color: C.violet, shape: 'blob', eyes: 'side', mouth: 'flat', front: PROPS.question },
  { id: 'pode-ser', cat: 'reacoes', text: 'PODE SER', color: C.yellow, shape: 'squircle', eyes: 'wink', mouth: 'smirk' },
  { id: 'sou-eu', cat: 'reacoes', text: 'SOU EU', color: C.lime, eyes: 'happy', mouth: 'smile', cheeks: true },
  { id: 'eh-pa', cat: 'reacoes', text: 'EH PÁ', color: C.gray, eyes: 'dots', mouth: 'sad' },
  { id: 'que-pena', cat: 'reacoes', text: 'QUE PENA', color: C.violet, shape: 'drop', eyes: 'dots', mouth: 'sad' },
  { id: 'boa', cat: 'reacoes', text: 'BOA!', color: C.coral, shape: 'blob', eyes: 'star', mouth: 'grin', front: PROPS.thumb },
  { id: 'muito-bem', cat: 'reacoes', text: 'MUITO BEM', color: C.yellow, shape: 'squircle', eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.star },
  { id: 'ola', cat: 'reacoes', text: 'OLÁ!', color: C.orange, shape: 'squircle', eyes: 'happy', mouth: 'smile', cheeks: true },
  { id: 'adeus', cat: 'reacoes', text: 'ADEUS', color: C.coral, shape: 'squircle', eyes: 'wink', mouth: 'smile' },
  { id: 'ate-ja', cat: 'reacoes', text: 'ATÉ JÁ', color: C.pink, eyes: 'wink', mouth: 'smile' },
  { id: 'espera-ai', cat: 'reacoes', text: 'ESPERA AÍ', color: C.sky, eyes: 'side', mouth: 'flat', front: PROPS.clock },
  { id: 'ja-era', cat: 'reacoes', text: 'JÁ ERA', color: C.violet, shape: 'blob', eyes: 'dots', mouth: 'sad' },
  { id: 'sem-stress', cat: 'reacoes', text: 'SEM STRESS', color: C.sky, eyes: 'closed', mouth: 'smile', cheeks: true },
  { id: 'ouvi-isso', cat: 'reacoes', text: 'OUVI ISSO', color: C.lime, eyes: 'wink', mouth: 'smirk' },
  { id: 'nao-e-bem', cat: 'reacoes', text: 'NÃO É BEM', color: C.gray, shape: 'squircle', eyes: 'side', mouth: 'flat', front: PROPS.question },
  { id: 'foi-sem-querer', cat: 'reacoes', text: 'FOI SEM QUERER', color: C.orange, shape: 'blob', eyes: 'closed', mouth: 'smile', cheeks: true },
  { id: 'a-serio', cat: 'reacoes', text: 'A SÉRIO', color: C.orange, shape: 'blob', eyes: 'wide', mouth: 'flat', front: PROPS.sweat },
  { id: 'agora-sim', cat: 'reacoes', text: 'AGORA SIM', color: C.blue, shape: 'blob', eyes: 'happy', mouth: 'grin' },
  { id: 'que-vergonha', cat: 'reacoes', text: 'QUE VERGONHA', color: C.orange, shape: 'squircle', eyes: 'closed', mouth: 'smile', cheeks: true, front: PROPS.sweat },
  { id: 'estou-aqui', cat: 'reacoes', text: 'ESTOU AQUI', color: C.sky, eyes: 'happy', mouth: 'smile', cheeks: true },
  { id: 'mal-posso', cat: 'reacoes', text: 'MAL POSSO', color: C.lime, eyes: 'happy', mouth: 'laugh' },
  { id: 'sobrevivi', cat: 'reacoes', text: 'SOBREVIVI', color: C.lime, eyes: 'wide', mouth: 'flat', front: PROPS.sweat },
  { id: 'falhei', cat: 'reacoes', text: 'FALHEI', color: C.blue, eyes: 'dots', mouth: 'sad' },
  { id: 'acertei', cat: 'reacoes', text: 'ACERTEI', color: C.orange, shape: 'squircle', eyes: 'star', mouth: 'grin', front: PROPS.star },
  { id: 'perfeito', cat: 'reacoes', text: 'PERFEITO', color: C.sky, eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.sparkles },
  { id: 'legal', cat: 'reacoes', text: 'LEGAL', color: C.blue, shape: 'squircle', eyes: 'none', mouth: 'smirk', front: PROPS.sunglasses },
  { id: 'espetaculo', cat: 'reacoes', text: 'ESPETÁCULO', color: C.orange, shape: 'squircle', eyes: 'star', mouth: 'grin', front: PROPS.sparkles },
  { id: 'super', cat: 'reacoes', text: 'SUPER', color: C.coral, shape: 'blob', eyes: 'star', mouth: 'grin' },
  // dia (mais)
  { id: 'boa-tarde', cat: 'dia', text: 'BOA TARDE', color: C.coral, shape: 'squircle', eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.sun },
  { id: 'a-acordar', cat: 'dia', text: 'A ACORDAR', color: C.gray, shape: 'squircle', eyes: 'closed', mouth: 'o', front: PROPS.zzz },
  { id: 'segunda', cat: 'dia', text: 'SEGUNDA…', color: C.blue, shape: 'squircle', eyes: 'dots', mouth: 'sad' },
  { id: 'sextou', cat: 'dia', text: 'SEXTOU!', color: C.orange, eyes: 'star', mouth: 'grin', front: PROPS.partyHat },
  { id: 'fim-de-semana', cat: 'dia', text: 'FIM DE SEMANA', color: C.green, shape: 'squircle', eyes: 'closed', mouth: 'smile', cheeks: true, front: PROPS.sunglasses },
  { id: 'domingo', cat: 'dia', text: 'DOMINGO', color: C.sky, shape: 'squircle', eyes: 'closed', mouth: 'smile', cheeks: true },
  { id: 'que-frio', cat: 'dia', text: 'QUE FRIO', color: C.lime, shape: 'blob', eyes: 'wide', mouth: 'flat', front: PROPS.ice },
  { id: 'vento', cat: 'dia', text: 'VENTO', color: C.orange, eyes: 'wide', mouth: 'flat', front: PROPS.cloud },
  { id: 'sol-e-mar', cat: 'dia', text: 'SOL E MAR', color: C.lime, shape: 'blob', eyes: 'closed', mouth: 'smile', cheeks: true, front: PROPS.sun },
  { id: 'temporal', cat: 'dia', text: 'TEMPORAL', color: C.sky, shape: 'drop', eyes: 'dots', mouth: 'sad', front: PROPS.rain },
  { id: 'guarda-chuva', cat: 'dia', text: 'GUARDA-CHUVA', color: C.sky, eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.umbrella },
  { id: 'nuvens', cat: 'dia', text: 'NUVENS', color: C.lime, shape: 'blob', eyes: 'closed', mouth: 'smile', cheeks: true, front: PROPS.cloud },
  { id: 'transito', cat: 'dia', text: 'TRÂNSITO', color: C.coral, shape: 'squircle', eyes: 'angry', mouth: 'grin', front: PROPS.car },
  { id: 'no-carro', cat: 'dia', text: 'NO CARRO', color: C.green, eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.car },
  { id: 'no-autocarro', cat: 'dia', text: 'NO AUTOCARRO', color: C.blue, shape: 'squircle', eyes: 'dots', mouth: 'smile', front: PROPS.car },
  { id: 'vou-a-pe', cat: 'dia', text: 'VOU A PÉ', color: C.coral, eyes: 'dots', mouth: 'smile' },
  { id: 'de-viagem', cat: 'dia', text: 'DE VIAGEM', color: C.coral, shape: 'squircle', eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.plane },
  { id: 'boa-viagem', cat: 'dia', text: 'BOA VIAGEM', color: C.lime, shape: 'blob', eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.plane },
  { id: 'sai-de-casa', cat: 'dia', text: 'SAÍ DE CASA', color: C.green, shape: 'squircle', eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.house },
  { id: 'limpezas', cat: 'dia', text: 'LIMPEZAS', color: C.lime, shape: 'squircle', eyes: 'dots', mouth: 'smile', front: PROPS.sweat },
  { id: 'compras', cat: 'dia', text: 'COMPRAS', color: C.lime, shape: 'squircle', eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.bag },
  { id: 'no-mercado', cat: 'dia', text: 'NO MERCADO', color: C.sky, eyes: 'dots', mouth: 'smile', front: PROPS.bag },
  { id: 'promocao', cat: 'dia', text: 'PROMOÇÃO', color: C.violet, eyes: 'star', mouth: 'grin', front: PROPS.coins },
  { id: 'sem-bateria', cat: 'dia', text: 'SEM BATERIA', color: C.orange, shape: 'squircle', eyes: 'wide', mouth: 'flat', front: PROPS.bolt },
  { id: 'carregando', cat: 'dia', text: 'CARREGANDO', color: C.violet, eyes: 'closed', mouth: 'o', front: PROPS.bolt },
  { id: 'sem-rede', cat: 'dia', text: 'SEM REDE', color: C.blue, shape: 'drop', eyes: 'dots', mouth: 'sad', front: PROPS.phone },
  { id: 'sem-dados', cat: 'dia', text: 'SEM DADOS', color: C.orange, eyes: 'wide', mouth: 'flat', front: PROPS.phone },
  { id: 'mensagem-nova', cat: 'dia', text: 'MENSAGEM NOVA', color: C.pink, eyes: 'wide', mouth: 'o', front: PROPS.phone },
  { id: 'atende', cat: 'dia', text: 'ATENDE!', color: C.coral, shape: 'squircle', eyes: 'angry', mouth: 'grin', front: PROPS.phone },
  { id: 'estou-a-ver', cat: 'dia', text: 'ESTOU A VER', color: C.gray, eyes: 'side', mouth: 'flat', front: PROPS.question },
  { id: 'ja-leio', cat: 'dia', text: 'JÁ LEIO', color: C.sky, eyes: 'dots', mouth: 'smile', front: PROPS.book },
  { id: 'a-ler', cat: 'dia', text: 'A LER', color: C.teal, eyes: 'closed', mouth: 'smile', cheeks: true, front: PROPS.book },
  { id: 'foto', cat: 'dia', text: 'FOTO!', color: C.teal, eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.camera },
  { id: 'selfie', cat: 'dia', text: 'SELFIE', color: C.coral, eyes: 'wink', mouth: 'smile', front: PROPS.camera },
  { id: 'sorri', cat: 'dia', text: 'SORRI', color: C.pink, shape: 'blob', eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.camera },
  { id: 'novidade', cat: 'dia', text: 'NOVIDADE', color: C.sky, shape: 'squircle', eyes: 'wide', mouth: 'o', front: PROPS.megaphone },
  { id: 'atencao', cat: 'dia', text: 'ATENÇÃO', color: C.lime, eyes: 'wide', mouth: 'flat', front: PROPS.megaphone },
  { id: 'pressa', cat: 'dia', text: 'PRESSA', color: C.orange, eyes: 'wide', mouth: 'flat', front: PROPS.clock },
  { id: 'sem-tempo', cat: 'dia', text: 'SEM TEMPO', color: C.yellow, shape: 'squircle', eyes: 'wide', mouth: 'flat', front: PROPS.clock },
  { id: 'daqui-a-pouco', cat: 'dia', text: 'DAQUI A POUCO', color: C.orange, shape: 'blob', eyes: 'dots', mouth: 'smile', front: PROPS.clock },
  { id: 'ja-estou', cat: 'dia', text: 'JÁ ESTOU', color: C.pink, shape: 'blob', eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.pin },
  { id: 'onde-estas', cat: 'dia', text: 'ONDE ESTÁS?', color: C.gray, shape: 'squircle', eyes: 'side', mouth: 'flat', front: PROPS.pin },
  { id: 'e-aqui', cat: 'dia', text: 'É AQUI', color: C.blue, eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.pin },
  { id: 'estou-na-fila', cat: 'dia', text: 'ESTOU NA FILA', color: C.violet, shape: 'drop', eyes: 'dots', mouth: 'sad', front: PROPS.clock },
  { id: 'finalmente', cat: 'dia', text: 'FINALMENTE', color: C.pink, shape: 'blob', eyes: 'happy', mouth: 'laugh' },
  { id: 'todo-o-dia', cat: 'dia', text: 'TODO O DIA', color: C.gray, shape: 'blob', eyes: 'closed', mouth: 'o', front: PROPS.zzz },
  { id: 'dormi-bem', cat: 'dia', text: 'DORMI BEM', color: C.lime, shape: 'blob', eyes: 'closed', mouth: 'smile', cheeks: true, front: PROPS.zzz },
  { id: 'mal-dormi', cat: 'dia', text: 'MAL DORMI', color: C.gray, shape: 'squircle', eyes: 'closed', mouth: 'o', front: PROPS.zzz },
  { id: 'cafezinho', cat: 'dia', text: 'CAFEZINHO', color: C.lime, shape: 'blob', eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.coffee },
  { id: 'demais', cat: 'dia', text: 'DEMAIS', color: C.orange, shape: 'blob', eyes: 'wide', mouth: 'flat', front: PROPS.sweat },
  { id: 'hoje-nao', cat: 'dia', text: 'HOJE NÃO', color: C.gray, shape: 'drop', eyes: 'dots', mouth: 'sad' },
  { id: 'amanha', cat: 'dia', text: 'AMANHÃ', color: C.yellow, eyes: 'dots', mouth: 'smile' },
  { id: 'acabou-o-dia', cat: 'dia', text: 'ACABOU O DIA', color: C.gray, eyes: 'closed', mouth: 'o', front: PROPS.moon },
  { id: 'lua-cheia', cat: 'dia', text: 'LUA CHEIA', color: C.teal, eyes: 'closed', mouth: 'smile', cheeks: true, front: PROPS.moon },
  { id: 'por-do-sol', cat: 'dia', text: 'PÔR DO SOL', color: C.lime, shape: 'blob', eyes: 'closed', mouth: 'smile', cheeks: true, front: PROPS.sun },
  { id: 'madrugada', cat: 'dia', text: 'MADRUGADA', color: C.blue, eyes: 'closed', mouth: 'o', front: PROPS.moon },
  { id: 'feriado', cat: 'dia', text: 'FERIADO', color: C.violet, shape: 'squircle', eyes: 'star', mouth: 'grin', front: PROPS.partyHat },
  { id: 'ferias', cat: 'dia', text: 'FÉRIAS', color: C.green, eyes: 'closed', mouth: 'smile', cheeks: true, front: PROPS.sunglasses },
  { id: 'praia', cat: 'dia', text: 'PRAIA', color: C.blue, shape: 'squircle', eyes: 'none', mouth: 'smirk', front: PROPS.sun },
  // comida (mais)
  { id: 'hamburguer', cat: 'comida', text: 'HAMBÚRGUER', color: C.blue, shape: 'blob', eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.burger },
  { id: 'fast-food', cat: 'comida', text: 'FAST FOOD', color: C.coral, eyes: 'happy', mouth: 'grin', front: PROPS.burger },
  { id: 'sobremesa', cat: 'comida', text: 'SOBREMESA', color: C.coral, eyes: 'heart', mouth: 'smile', cheeks: true, front: PROPS.iceCream },
  { id: 'um-bolo', cat: 'comida', text: 'UM BOLO', color: C.red, eyes: 'heart', mouth: 'smile', cheeks: true, front: PROPS.cake },
  { id: 'bolinho', cat: 'comida', text: 'BOLINHO', color: C.lime, shape: 'blob', eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.cake },
  { id: 'matapa', cat: 'comida', text: 'MATAPA', color: C.sky, eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.fork },
  { id: 'xima', cat: 'comida', text: 'XIMA', color: C.lime, shape: 'blob', eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.fork },
  { id: 'caranguejo', cat: 'comida', text: 'CARANGUEJO', color: C.teal, shape: 'blob', eyes: 'happy', mouth: 'grin', front: PROPS.fork },
  { id: 'peixe-fresco', cat: 'comida', text: 'PEIXE FRESCO', color: C.orange, shape: 'squircle', eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.fork },
  { id: 'frango', cat: 'comida', text: 'FRANGO', color: C.teal, shape: 'squircle', eyes: 'happy', mouth: 'grin', front: PROPS.fork },
  { id: 'na-grelha', cat: 'comida', text: 'NA GRELHA', color: C.violet, shape: 'squircle', eyes: 'star', mouth: 'grin', front: PROPS.flameTop },
  { id: 'arroz', cat: 'comida', text: 'ARROZ', color: C.violet, eyes: 'dots', mouth: 'smile', front: PROPS.fork },
  { id: 'feijao', cat: 'comida', text: 'FEIJÃO', color: C.coral, eyes: 'dots', mouth: 'smile', front: PROPS.fork },
  { id: 'salada', cat: 'comida', text: 'SALADA', color: C.green, eyes: 'closed', mouth: 'smile', cheeks: true, front: PROPS.fork },
  { id: 'sopa', cat: 'comida', text: 'SOPA', color: C.lime, shape: 'blob', eyes: 'closed', mouth: 'smile', cheeks: true, front: PROPS.coffee },
  { id: 'lanche', cat: 'comida', text: 'LANCHE', color: C.blue, shape: 'blob', eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.burger },
  { id: 'pequeno-almoco', cat: 'comida', text: 'PEQUENO-ALMOÇO', color: C.orange, eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.coffee },
  { id: 'cha', cat: 'comida', text: 'CHÁ', color: C.teal, eyes: 'closed', mouth: 'smile', cheeks: true, front: PROPS.coffee },
  { id: 'cafe-com-leite', cat: 'comida', text: 'CAFÉ COM LEITE', color: C.orange, shape: 'squircle', eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.coffee },
  { id: 'sumo', cat: 'comida', text: 'SUMO', color: C.green, eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.ice },
  { id: 'agua', cat: 'comida', text: 'ÁGUA!', color: C.orange, shape: 'blob', eyes: 'wide', mouth: 'flat', front: PROPS.ice },
  { id: 'geladinha', cat: 'comida', text: 'GELADINHA', color: C.blue, shape: 'squircle', eyes: 'wink', mouth: 'smile', front: PROPS.beer },
  { id: 'mais-uma', cat: 'comida', text: 'MAIS UMA', color: C.orange, shape: 'squircle', eyes: 'happy', mouth: 'laugh', front: PROPS.beer },
  { id: 'ultima', cat: 'comida', text: 'ÚLTIMA!', color: C.sky, shape: 'squircle', eyes: 'wink', mouth: 'tongue', front: PROPS.beer },
  { id: 'salud', cat: 'comida', text: 'SALUD!', color: C.lime, shape: 'squircle', eyes: 'happy', mouth: 'laugh', front: PROPS.beer },
  { id: 'na-mesa', cat: 'comida', text: 'NA MESA', color: C.pink, shape: 'squircle', eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.fork },
  { id: 'que-cheiro', cat: 'comida', text: 'QUE CHEIRO', color: C.coral, shape: 'squircle', eyes: 'heart', mouth: 'smile', cheeks: true, front: PROPS.fork },
  { id: 'ta-uma-delicia', cat: 'comida', text: 'TÁ UMA DELÍCIA', color: C.pink, shape: 'blob', eyes: 'heart', mouth: 'smile', cheeks: true, front: PROPS.fork },
  { id: 'quero-mais', cat: 'comida', text: 'QUERO MAIS', color: C.sky, eyes: 'wink', mouth: 'tongue', front: PROPS.fork },
  { id: 'cheio', cat: 'comida', text: 'CHEIO', color: C.teal, eyes: 'closed', mouth: 'smile', cheeks: true, front: PROPS.fork },
  { id: 'sem-fome', cat: 'comida', text: 'SEM FOME', color: C.sky, eyes: 'dots', mouth: 'sad', front: PROPS.fork },
  { id: 'restos', cat: 'comida', text: 'RESTOS', color: C.sky, eyes: 'side', mouth: 'flat', front: PROPS.fork },
  { id: 'fez-se-tarde', cat: 'comida', text: 'FEZ-SE TARDE', color: C.lime, shape: 'squircle', eyes: 'wide', mouth: 'flat', front: PROPS.clock },
  { id: 'pizza-hoje', cat: 'comida', text: 'PIZZA HOJE', color: C.green, eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.pizza },
  { id: 'fatia', cat: 'comida', text: 'FATIA', color: C.blue, shape: 'squircle', eyes: 'happy', mouth: 'grin', front: PROPS.pizza },
  { id: 'conta', cat: 'comida', text: 'CONTA!', color: C.lime, eyes: 'wide', mouth: 'flat', front: PROPS.coins },
  { id: 'a-meias', cat: 'comida', text: 'A MEIAS', color: C.green, eyes: 'wink', mouth: 'smile', front: PROPS.coins },
  { id: 'pago-eu', cat: 'comida', text: 'PAGO EU', color: C.orange, eyes: 'wink', mouth: 'smirk', front: PROPS.coins },
  { id: 'e-teu', cat: 'comida', text: 'É TEU', color: C.orange, shape: 'blob', eyes: 'wink', mouth: 'smirk', front: PROPS.coins },
  { id: 'espetada', cat: 'comida', text: 'ESPETADA', color: C.lime, shape: 'blob', eyes: 'happy', mouth: 'grin', front: PROPS.fork },
  { id: 'picante', cat: 'comida', text: 'PICANTE', color: C.orange, eyes: 'wide', mouth: 'flat', front: PROPS.flameTop },
  { id: 'piri-piri', cat: 'comida', text: 'PIRI-PIRI', color: C.lime, shape: 'squircle', eyes: 'wide', mouth: 'flat', front: PROPS.flameTop },
  { id: 'com-limao', cat: 'comida', text: 'COM LIMÃO', color: C.teal, shape: 'blob', eyes: 'happy', mouth: 'smile', cheeks: true },
  { id: 'fruta', cat: 'comida', text: 'FRUTA', color: C.sky, shape: 'squircle', eyes: 'happy', mouth: 'smile', cheeks: true },
  { id: 'manga', cat: 'comida', text: 'MANGA', color: C.red, eyes: 'heart', mouth: 'smile', cheeks: true },
  { id: 'coco', cat: 'comida', text: 'COCO', color: C.teal, eyes: 'closed', mouth: 'smile', cheeks: true },
  { id: 'banana', cat: 'comida', text: 'BANANA', color: C.blue, eyes: 'happy', mouth: 'smile', cheeks: true },
  { id: 'sede-de-bola', cat: 'comida', text: 'SEDE DE BOLA', color: C.sky, eyes: 'wink', mouth: 'tongue', front: PROPS.beer },
  { id: 'brinde', cat: 'comida', text: 'BRINDE', color: C.sky, eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.beer },
  { id: 'na-geleira', cat: 'comida', text: 'NA GELEIRA', color: C.teal, eyes: 'none', mouth: 'smirk', front: PROPS.ice },
  // festa (mais)
  { id: 'festa-hoje', cat: 'festa', text: 'FESTA HOJE', color: C.orange, eyes: 'star', mouth: 'grin', front: PROPS.partyHat },
  { id: 'vem', cat: 'festa', text: 'VEM!', color: C.teal, eyes: 'happy', mouth: 'grin', front: PROPS.partyHat },
  { id: 'aniversario', cat: 'festa', text: 'ANIVERSÁRIO', color: C.pink, shape: 'blob', eyes: 'happy', mouth: 'laugh', front: PROPS.cake },
  { id: 'feliz-ano', cat: 'festa', text: 'FELIZ ANO', color: C.yellow, eyes: 'star', mouth: 'grin', front: PROPS.sparkles },
  { id: 'feliz-natal', cat: 'festa', text: 'FELIZ NATAL', color: C.violet, shape: 'squircle', eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.gift },
  { id: 'boas-festas', cat: 'festa', text: 'BOAS FESTAS', color: C.pink, shape: 'blob', eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.sparkles },
  { id: 'pascoa', cat: 'festa', text: 'PÁSCOA', color: C.blue, shape: 'blob', eyes: 'happy', mouth: 'smile', cheeks: true },
  { id: 'casamento', cat: 'festa', text: 'CASAMENTO', color: C.coral, shape: 'blob', eyes: 'heart', mouth: 'smile', cheeks: true, front: PROPS.hearts },
  { id: 'noivos', cat: 'festa', text: 'NOIVOS', color: C.coral, eyes: 'heart', mouth: 'smile', cheeks: true, front: PROPS.hearts },
  { id: 'parabens-2', cat: 'festa', text: 'PARABÉNS!', color: C.orange, eyes: 'happy', mouth: 'laugh', front: PROPS.balloon },
  { id: 'baloes', cat: 'festa', text: 'BALÕES', color: C.yellow, eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.balloon },
  { id: 'surpresa', cat: 'festa', text: 'SURPRESA!', color: C.yellow, eyes: 'wide', mouth: 'o', front: PROPS.gift },
  { id: 'um-presente', cat: 'festa', text: 'UM PRESENTE', color: C.coral, eyes: 'heart', mouth: 'smile', cheeks: true, front: PROPS.gift },
  { id: 'e-para-ti', cat: 'festa', text: 'É PARA TI', color: C.pink, shape: 'squircle', eyes: 'heart', mouth: 'smile', cheeks: true, front: PROPS.gift },
  { id: 'na-pista', cat: 'festa', text: 'NA PISTA', color: C.yellow, eyes: 'star', mouth: 'grin', front: PROPS.note },
  { id: 'dj-sobe', cat: 'festa', text: 'DJ, SOBE', color: C.coral, shape: 'blob', eyes: 'star', mouth: 'grin', front: PROPS.headphones },
  { id: 'mais-alto', cat: 'festa', text: 'MAIS ALTO', color: C.violet, shape: 'squircle', eyes: 'star', mouth: 'grin', front: PROPS.headphones },
  { id: 'musica-ja', cat: 'festa', text: 'MÚSICA JÁ', color: C.yellow, shape: 'squircle', eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.note },
  { id: 'karaoke', cat: 'festa', text: 'KARAOKE', color: C.lime, eyes: 'happy', mouth: 'laugh', front: PROPS.mic },
  { id: 'canta', cat: 'festa', text: 'CANTA!', color: C.yellow, eyes: 'happy', mouth: 'laugh', front: PROPS.mic },
  { id: 'palco', cat: 'festa', text: 'PALCO', color: C.green, shape: 'blob', eyes: 'none', mouth: 'smirk', front: PROPS.mic },
  { id: 'after', cat: 'festa', text: 'AFTER', color: C.blue, shape: 'squircle', eyes: 'closed', mouth: 'o', front: PROPS.moon },
  { id: 'ate-amanhecer', cat: 'festa', text: 'ATÉ AMANHECER', color: C.violet, shape: 'squircle', eyes: 'star', mouth: 'grin', front: PROPS.sun },
  { id: 'passeio', cat: 'festa', text: 'PASSEIO', color: C.yellow, eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.sun },
  { id: 'picnic', cat: 'festa', text: 'PICNIC', color: C.green, eyes: 'closed', mouth: 'smile', cheeks: true, front: PROPS.sun },
  { id: 'churrasco', cat: 'festa', text: 'CHURRASCO', color: C.violet, shape: 'squircle', eyes: 'star', mouth: 'grin', front: PROPS.flameTop },
  { id: 'mesa-cheia', cat: 'festa', text: 'MESA CHEIA', color: C.yellow, eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.fork },
  { id: 'brindemos', cat: 'festa', text: 'BRINDEMOS', color: C.pink, shape: 'blob', eyes: 'happy', mouth: 'laugh', front: PROPS.beer },
  { id: 'alegria', cat: 'festa', text: 'ALEGRIA', color: C.orange, shape: 'squircle', eyes: 'happy', mouth: 'laugh', front: PROPS.sparkles },
  { id: 'artificios', cat: 'festa', text: 'ARTIFÍCIOS', color: C.orange, eyes: 'wide', mouth: 'o', front: PROPS.sparkles },
  { id: 'primeiro-lugar', cat: 'festa', text: 'PRIMEIRO LUGAR', color: C.violet, shape: 'squircle', eyes: 'star', mouth: 'grin', front: PROPS.trophy },
  { id: 'medalha', cat: 'festa', text: 'MEDALHA', color: C.yellow, eyes: 'star', mouth: 'grin', front: PROPS.medal },
  { id: 'campeao', cat: 'festa', text: 'CAMPEÃO', color: C.yellow, eyes: 'star', mouth: 'grin', front: PROPS.trophy },
  { id: 'vitoria-2', cat: 'festa', text: 'VITÓRIA!', color: C.pink, shape: 'blob', eyes: 'happy', mouth: 'laugh', front: PROPS.trophy },
  { id: 'a-todos', cat: 'festa', text: 'A TODOS!', color: C.pink, shape: 'blob', eyes: 'happy', mouth: 'laugh', front: PROPS.partyHat },
  { id: 'o-melhor-dia', cat: 'festa', text: 'O MELHOR DIA', color: C.yellow, eyes: 'happy', mouth: 'laugh', front: PROPS.sparkles },
  { id: 'dia-especial', cat: 'festa', text: 'DIA ESPECIAL', color: C.coral, eyes: 'heart', mouth: 'smile', cheeks: true, front: PROPS.sparkles },
  { id: 'inesquecivel', cat: 'festa', text: 'INESQUECÍVEL', color: C.pink, eyes: 'heart', mouth: 'smile', cheeks: true, front: PROPS.star },
  { id: 'que-noite', cat: 'festa', text: 'QUE NOITE', color: C.violet, shape: 'squircle', eyes: 'none', mouth: 'smirk', front: PROPS.moon },
  // amor (mais)
  { id: 'gosto-de-ti', cat: 'amor', text: 'GOSTO DE TI', color: C.coral, shape: 'squircle', eyes: 'heart', mouth: 'smile', cheeks: true, front: PROPS.hearts },
  { id: 'amo-te', cat: 'amor', text: 'AMO-TE', color: C.red, shape: 'blob', eyes: 'heart', mouth: 'smile', cheeks: true, front: PROPS.heartBig },
  { id: 'beijoca', cat: 'amor', text: 'BEIJOCA', color: C.coral, shape: 'squircle', eyes: 'happy', mouth: 'kiss', cheeks: true, front: PROPS.kissMark },
  { id: 'um-abraco', cat: 'amor', text: 'UM ABRAÇO', color: C.coral, eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.hearts },
  { id: 'saudade', cat: 'amor', text: 'SAUDADE', color: C.violet, shape: 'drop', eyes: 'dots', mouth: 'sad', front: PROPS.hearts },
  { id: 'muita-saudade', cat: 'amor', text: 'MUITA SAUDADE', color: C.blue, shape: 'drop', eyes: 'dots', mouth: 'sad', front: PROPS.hearts },
  { id: 'pensei-em-ti', cat: 'amor', text: 'PENSEI EM TI', color: C.pink, shape: 'blob', eyes: 'closed', mouth: 'smile', cheeks: true, front: PROPS.hearts },
  { id: 'para-ti', cat: 'amor', text: 'PARA TI', color: C.coral, eyes: 'heart', mouth: 'smile', cheeks: true, front: PROPS.rose },
  { id: 'flores', cat: 'amor', text: 'FLORES', color: C.pink, shape: 'blob', eyes: 'heart', mouth: 'smile', cheeks: true, front: PROPS.rose },
  { id: 'rosa', cat: 'amor', text: 'ROSA', color: C.pink, shape: 'squircle', eyes: 'heart', mouth: 'smile', cheeks: true, front: PROPS.rose },
  { id: 'namorado', cat: 'amor', text: 'NAMORADO', color: C.red, eyes: 'heart', mouth: 'smile', cheeks: true, front: PROPS.heartBig },
  { id: 'namorada', cat: 'amor', text: 'NAMORADA', color: C.pink, shape: 'blob', eyes: 'heart', mouth: 'smile', cheeks: true, front: PROPS.heartBig },
  { id: 'meu-bem', cat: 'amor', text: 'MEU BEM', color: C.coral, shape: 'blob', eyes: 'heart', mouth: 'smile', cheeks: true, front: PROPS.hearts },
  { id: 'paixao', cat: 'amor', text: 'PAIXÃO', color: C.coral, eyes: 'heart', mouth: 'smile', cheeks: true, front: PROPS.flameTop },
  { id: 'encantado', cat: 'amor', text: 'ENCANTADO', color: C.red, shape: 'squircle', eyes: 'heart', mouth: 'smile', cheeks: true, front: PROPS.sparkles },
  { id: 'que-lindo', cat: 'amor', text: 'QUE LINDO', color: C.red, eyes: 'heart', mouth: 'smile', cheeks: true },
  { id: 'que-linda', cat: 'amor', text: 'QUE LINDA', color: C.pink, shape: 'blob', eyes: 'heart', mouth: 'smile', cheeks: true },
  { id: 'fofinho', cat: 'amor', text: 'FOFINHO', color: C.orange, eyes: 'closed', mouth: 'smile', cheeks: true },
  { id: 'fofinha', cat: 'amor', text: 'FOFINHA', color: C.pink, shape: 'blob', eyes: 'closed', mouth: 'smile', cheeks: true },
  { id: 'amigo', cat: 'amor', text: 'AMIGO', color: C.teal, shape: 'squircle', eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.hearts },
  { id: 'amiga', cat: 'amor', text: 'AMIGA', color: C.orange, shape: 'blob', eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.hearts },
  { id: 'melhor-amigo', cat: 'amor', text: 'MELHOR AMIGO', color: C.yellow, eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.star },
  { id: 'melhor-amiga', cat: 'amor', text: 'MELHOR AMIGA', color: C.violet, eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.star },
  { id: 'mana', cat: 'amor', text: 'MANA', color: C.teal, shape: 'squircle', eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.hearts },
  { id: 'mano', cat: 'amor', text: 'MANO', color: C.pink, shape: 'blob', eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.hearts },
  { id: 'familia', cat: 'amor', text: 'FAMÍLIA', color: C.coral, shape: 'blob', eyes: 'heart', mouth: 'smile', cheeks: true, front: PROPS.house },
  { id: 'mae', cat: 'amor', text: 'MÃE', color: C.red, shape: 'squircle', eyes: 'heart', mouth: 'smile', cheeks: true, front: PROPS.heartBig },
  { id: 'pai', cat: 'amor', text: 'PAI', color: C.red, shape: 'squircle', eyes: 'heart', mouth: 'smile', cheeks: true, front: PROPS.heartBig },
  { id: 'avo', cat: 'amor', text: 'AVÓ', color: C.red, shape: 'squircle', eyes: 'heart', mouth: 'smile', cheeks: true, front: PROPS.hearts },
  { id: 'avo-2', cat: 'amor', text: 'AVÔ', color: C.pink, shape: 'blob', eyes: 'heart', mouth: 'smile', cheeks: true, front: PROPS.hearts },
  { id: 'bebe', cat: 'amor', text: 'BEBÉ', color: C.yellow, shape: 'squircle', eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.balloon },
  { id: 'criancas', cat: 'amor', text: 'CRIANÇAS', color: C.yellow, eyes: 'happy', mouth: 'laugh', front: PROPS.balloon },
  { id: 'contigo', cat: 'amor', text: 'CONTIGO', color: C.pink, shape: 'blob', eyes: 'heart', mouth: 'smile', cheeks: true, front: PROPS.hearts },
  { id: 'fica', cat: 'amor', text: 'FICA', color: C.violet, shape: 'blob', eyes: 'dots', mouth: 'sad', front: PROPS.hearts },
  { id: 'volta', cat: 'amor', text: 'VOLTA', color: C.gray, shape: 'drop', eyes: 'dots', mouth: 'sad', front: PROPS.hearts },
  { id: 'desculpa-amor', cat: 'amor', text: 'DESCULPA, AMOR', color: C.sky, shape: 'drop', eyes: 'dots', mouth: 'sad', front: PROPS.hearts },
  { id: 'te-espero', cat: 'amor', text: 'TE ESPERO', color: C.red, shape: 'blob', eyes: 'heart', mouth: 'smile', cheeks: true, front: PROPS.clock },
  { id: 'sempre', cat: 'amor', text: 'SEMPRE', color: C.coral, eyes: 'heart', mouth: 'smile', cheeks: true },
  { id: 'para-sempre', cat: 'amor', text: 'PARA SEMPRE', color: C.coral, eyes: 'heart', mouth: 'smile', cheeks: true, front: PROPS.heartBig },
  { id: 'obrigada', cat: 'amor', text: 'OBRIGADA', color: C.pink, eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.hearts },
  { id: 'kanimambo', cat: 'amor', text: 'KANIMAMBO', color: C.teal, shape: 'blob', eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.hearts },
  { id: 'muito-obrigado', cat: 'amor', text: 'MUITO OBRIGADO', color: C.lime, shape: 'squircle', eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.sparkles },
  { id: 'de-nada', cat: 'amor', text: 'DE NADA', color: C.sky, shape: 'squircle', eyes: 'closed', mouth: 'smile', cheeks: true, front: PROPS.thumb },
  { id: 'coracao', cat: 'amor', text: 'CORAÇÃO', color: C.coral, eyes: 'heart', mouth: 'smile', cheeks: true, front: PROPS.heartBig },
  { id: 'bem-vindo', cat: 'amor', text: 'BEM-VINDO', color: C.orange, eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.hearts },
  // malta (mais)
  { id: 'mano-2', cat: 'malta', text: 'MANO!', color: C.yellow, eyes: 'happy', mouth: 'grin' },
  { id: 'mana-2', cat: 'malta', text: 'MANA!', color: C.violet, eyes: 'happy', mouth: 'grin' },
  { id: 'pa-2', cat: 'malta', text: 'PÁ!', color: C.sky, shape: 'squircle', eyes: 'wide', mouth: 'o' },
  { id: 'bue-fixe', cat: 'malta', text: 'BUÉ FIXE', color: C.yellow, eyes: 'star', mouth: 'grin', front: PROPS.thumb },
  { id: 'bue-de-bom', cat: 'malta', text: 'BUÉ DE BOM', color: C.coral, shape: 'blob', eyes: 'star', mouth: 'grin', front: PROPS.sparkles },
  { id: 'da-lhe', cat: 'malta', text: 'DÁ-LHE', color: C.coral, shape: 'blob', eyes: 'star', mouth: 'grin', front: PROPS.flameTop },
  { id: 'ta-no-ponto', cat: 'malta', text: 'TÁ NO PONTO', color: C.violet, shape: 'squircle', eyes: 'wink', mouth: 'smirk', front: PROPS.thumb },
  { id: 'malta-ja', cat: 'malta', text: 'MALTA JÁ', color: C.violet, shape: 'squircle', eyes: 'star', mouth: 'grin', front: PROPS.flag },
  { id: 'e-nosso', cat: 'malta', text: 'É NOSSO', color: C.teal, shape: 'blob', eyes: 'wink', mouth: 'smirk', front: PROPS.flag },
  { id: 'fica-bem', cat: 'malta', text: 'FICA BEM', color: C.pink, shape: 'blob', eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.thumb },
  { id: 'boa-malta', cat: 'malta', text: 'BOA, MALTA', color: C.lime, shape: 'squircle', eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.thumb },
  { id: 'gang', cat: 'malta', text: 'GANG', color: C.blue, shape: 'squircle', eyes: 'none', mouth: 'smirk', front: PROPS.sunglasses },
  { id: 'a-equipa', cat: 'malta', text: 'A EQUIPA', color: C.violet, eyes: 'star', mouth: 'grin', front: PROPS.flag },
  { id: 'la-vamos', cat: 'malta', text: 'LÁ VAMOS', color: C.orange, shape: 'blob', eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.flag },
  { id: 'chegou-a-malta', cat: 'malta', text: 'CHEGOU A MALTA', color: C.pink, shape: 'blob', eyes: 'happy', mouth: 'laugh', front: PROPS.partyHat },
  { id: 'ate-logo', cat: 'malta', text: 'ATÉ LOGO', color: C.blue, shape: 'blob', eyes: 'wink', mouth: 'smile' },
  { id: 'agora-e-que-e', cat: 'malta', text: 'AGORA É QUE É', color: C.coral, shape: 'blob', eyes: 'star', mouth: 'grin', front: PROPS.flameTop },
  { id: 'nao-falhes', cat: 'malta', text: 'NÃO FALHES', color: C.coral, shape: 'blob', eyes: 'angry', mouth: 'flat', front: PROPS.bang },
  { id: 'fala-serio', cat: 'malta', text: 'FALA SÉRIO', color: C.gray, shape: 'squircle', eyes: 'side', mouth: 'flat', front: PROPS.question },
  { id: 'nem-viu', cat: 'malta', text: 'NEM VIU', color: C.coral, eyes: 'wink', mouth: 'smirk' },
  { id: 'esta-a-ver', cat: 'malta', text: 'ESTÁ A VER', color: C.teal, shape: 'blob', eyes: 'wink', mouth: 'smirk' },
  { id: 'ja-sabes', cat: 'malta', text: 'JÁ SABES', color: C.blue, eyes: 'none', mouth: 'smirk', front: PROPS.sunglasses },
  { id: 'meu-chefe', cat: 'malta', text: 'MEU CHEFE', color: C.violet, shape: 'squircle', eyes: 'none', mouth: 'smirk', front: PROPS.crown },
  { id: 'rei-rainha', cat: 'malta', text: 'REI/RAINHA', color: C.sky, shape: 'squircle', eyes: 'wink', mouth: 'smirk', front: PROPS.crown },
  { id: 'lendario', cat: 'malta', text: 'LENDÁRIO', color: C.violet, eyes: 'star', mouth: 'grin', front: PROPS.crown },
  { id: 'grande', cat: 'malta', text: 'GRANDE!', color: C.violet, shape: 'squircle', eyes: 'star', mouth: 'grin', front: PROPS.star },
  { id: 'fera', cat: 'malta', text: 'FERA', color: C.violet, eyes: 'star', mouth: 'grin', front: PROPS.flameTop },
  { id: 'mestre', cat: 'malta', text: 'MESTRE', color: C.teal, eyes: 'none', mouth: 'smirk', front: PROPS.crown },
  { id: 'top', cat: 'malta', text: 'TOP!', color: C.yellow, eyes: 'star', mouth: 'grin', front: PROPS.star },
  { id: 'manda-vir', cat: 'malta', text: 'MANDA VIR', color: C.sky, shape: 'squircle', eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.beer },
  { id: 'e-para-ja', cat: 'malta', text: 'É PARA JÁ', color: C.yellow, eyes: 'star', mouth: 'grin', front: PROPS.clock },
  { id: 'vem-ca', cat: 'malta', text: 'VEM CÁ', color: C.green, eyes: 'wink', mouth: 'smile', front: PROPS.megaphone },
  { id: 'atencao-malta', cat: 'malta', text: 'ATENÇÃO, MALTA', color: C.orange, eyes: 'wide', mouth: 'flat', front: PROPS.megaphone },
  { id: 'agua-no-feijao', cat: 'malta', text: 'ÁGUA NO FEIJÃO', color: C.lime, shape: 'blob', eyes: 'wide', mouth: 'flat', front: PROPS.sweat },
  { id: 'estou-pronto', cat: 'malta', text: 'ESTOU PRONTO', color: C.violet, shape: 'squircle', eyes: 'star', mouth: 'grin', front: PROPS.flag },
  { id: 'ja-foi', cat: 'malta', text: 'JÁ FOI', color: C.blue, eyes: 'dots', mouth: 'sad', front: PROPS.sweat },
  { id: 'nem-de-perto', cat: 'malta', text: 'NEM DE PERTO', color: C.pink, shape: 'blob', eyes: 'wink', mouth: 'smirk' },
  { id: 'ta-controlado', cat: 'malta', text: 'TÁ CONTROLADO', color: C.green, shape: 'squircle', eyes: 'closed', mouth: 'smile', cheeks: true, front: PROPS.thumb },
  { id: 'e-tranquilo', cat: 'malta', text: 'É TRANQUILO', color: C.teal, eyes: 'closed', mouth: 'smile', cheeks: true },
  { id: 'tranquilo', cat: 'malta', text: 'TRANQUILO', color: C.lime, shape: 'blob', eyes: 'closed', mouth: 'smile', cheeks: true },
  { id: 'sem-problema', cat: 'malta', text: 'SEM PROBLEMA', color: C.lime, shape: 'blob', eyes: 'closed', mouth: 'smile', cheeks: true, front: PROPS.thumb },
  { id: 'tocou', cat: 'malta', text: 'TOCOU', color: C.violet, shape: 'squircle', eyes: 'star', mouth: 'grin', front: PROPS.bang },
  { id: 'acertou', cat: 'malta', text: 'ACERTOU!', color: C.yellow, eyes: 'star', mouth: 'grin', front: PROPS.star },
  { id: 'vamos-la', cat: 'malta', text: 'VAMOS LÁ', color: C.coral, shape: 'blob', eyes: 'star', mouth: 'grin', front: PROPS.flag },
  { id: 'bora-la', cat: 'malta', text: 'BORA LÁ', color: C.orange, eyes: 'star', mouth: 'grin', front: PROPS.flag },
  { id: 'sem-medo', cat: 'malta', text: 'SEM MEDO', color: C.violet, shape: 'squircle', eyes: 'none', mouth: 'smirk', front: PROPS.sunglasses },
  { id: 'nos-ca', cat: 'malta', text: 'NÓS CÁ', color: C.green, eyes: 'wink', mouth: 'smirk', front: PROPS.flag },
  { id: 'ja-sou-grande', cat: 'malta', text: 'JÁ SOU GRANDE', color: C.orange, shape: 'blob', eyes: 'wink', mouth: 'smirk', front: PROPS.crown },
  { id: 'deixa-comigo', cat: 'malta', text: 'DEIXA COMIGO', color: C.orange, eyes: 'wink', mouth: 'smirk', front: PROPS.thumb },
  { id: 'confia', cat: 'malta', text: 'CONFIA', color: C.yellow, eyes: 'wink', mouth: 'smirk', front: PROPS.thumb },
  { id: 'sou-do-bairro', cat: 'malta', text: 'SOU DO BAIRRO', color: C.teal, eyes: 'wink', mouth: 'smirk', front: PROPS.cap },
  { id: 'bairro', cat: 'malta', text: 'BAIRRO', color: C.green, shape: 'blob', eyes: 'none', mouth: 'smirk', front: PROPS.cap },
  { id: 'cidade', cat: 'malta', text: 'CIDADE', color: C.violet, shape: 'squircle', eyes: 'none', mouth: 'smirk', front: PROPS.house },
  { id: 'ta-tudo', cat: 'malta', text: 'TÁ TUDO', color: C.teal, eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.thumb },
  { id: 'e-dessas', cat: 'malta', text: 'É DESSAS', color: C.green, eyes: 'wink', mouth: 'smirk' },
  { id: 'coisa-boa', cat: 'malta', text: 'COISA BOA', color: C.pink, eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.sparkles },
  { id: 'filme', cat: 'malta', text: 'FILME!', color: C.violet, eyes: 'wide', mouth: 'o', front: PROPS.camera },
  { id: 'que-filme', cat: 'malta', text: 'QUE FILME', color: C.yellow, eyes: 'wide', mouth: 'o', front: PROPS.camera },
  { id: 'no-estilo', cat: 'malta', text: 'NO ESTILO', color: C.blue, shape: 'squircle', eyes: 'none', mouth: 'smirk', front: PROPS.sunglasses },
  // desporto (mais)
  { id: 'golo', cat: 'desporto', text: 'GOLO!', color: C.violet, shape: 'squircle', eyes: 'star', mouth: 'grin', front: PROPS.ball },
  { id: 'golaco', cat: 'desporto', text: 'GOLAÇO', color: C.orange, eyes: 'star', mouth: 'grin', front: PROPS.ball },
  { id: 'fora-de-jogo', cat: 'desporto', text: 'FORA DE JOGO', color: C.yellow, eyes: 'wide', mouth: 'flat', front: PROPS.flag },
  { id: 'penalti', cat: 'desporto', text: 'PENALTI', color: C.orange, shape: 'squircle', eyes: 'wide', mouth: 'flat', front: PROPS.ball },
  { id: 'cartao-amarelo', cat: 'desporto', text: 'CARTÃO AMARELO', color: C.lime, shape: 'squircle', eyes: 'wide', mouth: 'flat', front: PROPS.bang },
  { id: 'vermelho', cat: 'desporto', text: 'VERMELHO!', color: C.coral, shape: 'blob', eyes: 'angry', mouth: 'grin', front: PROPS.bang },
  { id: 'arbitro', cat: 'desporto', text: 'ÁRBITRO!', color: C.orange, eyes: 'angry', mouth: 'grin', front: PROPS.megaphone },
  { id: 'que-jogo', cat: 'desporto', text: 'QUE JOGO', color: C.coral, shape: 'squircle', eyes: 'wide', mouth: 'o', front: PROPS.ball },
  { id: 'joga-mais', cat: 'desporto', text: 'JOGA MAIS', color: C.coral, shape: 'blob', eyes: 'star', mouth: 'grin', front: PROPS.ball },
  { id: 'um-a-zero', cat: 'desporto', text: 'UM A ZERO', color: C.orange, shape: 'blob', eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.ball },
  { id: 'empate', cat: 'desporto', text: 'EMPATE', color: C.sky, eyes: 'side', mouth: 'flat', front: PROPS.ball },
  { id: 'perdemos', cat: 'desporto', text: 'PERDEMOS', color: C.violet, shape: 'drop', eyes: 'dots', mouth: 'sad', front: PROPS.ball },
  { id: 'ganhamos', cat: 'desporto', text: 'GANHÁMOS', color: C.lime, eyes: 'happy', mouth: 'laugh', front: PROPS.trophy },
  { id: 'final', cat: 'desporto', text: 'FINAL!', color: C.coral, shape: 'blob', eyes: 'star', mouth: 'grin', front: PROPS.trophy },
  { id: 'taca', cat: 'desporto', text: 'TAÇA', color: C.orange, shape: 'squircle', eyes: 'star', mouth: 'grin', front: PROPS.trophy },
  { id: 'campeoes', cat: 'desporto', text: 'CAMPEÕES', color: C.coral, shape: 'blob', eyes: 'star', mouth: 'grin', front: PROPS.trophy },
  { id: 'podio', cat: 'desporto', text: 'PÓDIO', color: C.coral, shape: 'blob', eyes: 'star', mouth: 'grin', front: PROPS.medal },
  { id: 'na-bancada', cat: 'desporto', text: 'NA BANCADA', color: C.orange, eyes: 'star', mouth: 'grin', front: PROPS.flag },
  { id: 'vamos-equipa', cat: 'desporto', text: 'VAMOS, EQUIPA', color: C.coral, shape: 'blob', eyes: 'star', mouth: 'grin', front: PROPS.flag },
  { id: 'forca', cat: 'desporto', text: 'FORÇA!', color: C.yellow, eyes: 'star', mouth: 'grin', front: PROPS.flameTop },
  { id: 'garra', cat: 'desporto', text: 'GARRA', color: C.coral, shape: 'squircle', eyes: 'angry', mouth: 'flat', front: PROPS.flameTop },
  { id: 'treino', cat: 'desporto', text: 'TREINO', color: C.orange, eyes: 'wide', mouth: 'flat', front: PROPS.sweat },
  { id: 'corrida', cat: 'desporto', text: 'CORRIDA', color: C.orange, eyes: 'wide', mouth: 'flat', front: PROPS.sweat },
  { id: 'a-correr', cat: 'desporto', text: 'A CORRER', color: C.orange, eyes: 'wide', mouth: 'flat', front: PROPS.sweat },
  { id: 'maratona', cat: 'desporto', text: 'MARATONA', color: C.blue, shape: 'blob', eyes: 'closed', mouth: 'o', front: PROPS.sweat },
  { id: 'ginasio', cat: 'desporto', text: 'GINÁSIO', color: C.violet, shape: 'squircle', eyes: 'star', mouth: 'grin', front: PROPS.sweat },
  { id: 'sem-desculpas', cat: 'desporto', text: 'SEM DESCULPAS', color: C.coral, eyes: 'angry', mouth: 'flat' },
  { id: 'alongamentos', cat: 'desporto', text: 'ALONGAMENTOS', color: C.teal, eyes: 'closed', mouth: 'smile', cheeks: true },
  { id: 'descanso', cat: 'desporto', text: 'DESCANSO', color: C.blue, eyes: 'closed', mouth: 'o', front: PROPS.zzz },
  { id: 'basquete', cat: 'desporto', text: 'BASQUETE', color: C.violet, shape: 'squircle', eyes: 'star', mouth: 'grin', front: PROPS.ball },
  { id: 'volei', cat: 'desporto', text: 'VÓLEI', color: C.coral, shape: 'blob', eyes: 'star', mouth: 'grin', front: PROPS.ball },
  { id: 'tenis', cat: 'desporto', text: 'TÉNIS', color: C.pink, shape: 'blob', eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.ball },
  { id: 'natacao', cat: 'desporto', text: 'NATAÇÃO', color: C.teal, shape: 'squircle', eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.ice },
  { id: 'a-nadar', cat: 'desporto', text: 'A NADAR', color: C.lime, shape: 'blob', eyes: 'closed', mouth: 'smile', cheeks: true, front: PROPS.ice },
  { id: 'ciclismo', cat: 'desporto', text: 'CICLISMO', color: C.teal, shape: 'blob', eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.car },
  { id: 'estadio', cat: 'desporto', text: 'ESTÁDIO', color: C.orange, eyes: 'star', mouth: 'grin', front: PROPS.flag },
  { id: 'jogo-hoje', cat: 'desporto', text: 'JOGO HOJE', color: C.orange, shape: 'squircle', eyes: 'star', mouth: 'grin', front: PROPS.ball },
  { id: 'bola-ao-centro', cat: 'desporto', text: 'BOLA AO CENTRO', color: C.orange, eyes: 'star', mouth: 'grin', front: PROPS.ball },
  { id: 'craque', cat: 'desporto', text: 'CRAQUE', color: C.pink, eyes: 'wink', mouth: 'smirk', front: PROPS.crown },
  { id: 'mvp', cat: 'desporto', text: 'MVP', color: C.green, shape: 'blob', eyes: 'none', mouth: 'smirk', front: PROPS.trophy },
  { id: 'destaque', cat: 'desporto', text: 'DESTAQUE', color: C.green, eyes: 'wink', mouth: 'smirk', front: PROPS.star },
  { id: 'torcedor', cat: 'desporto', text: 'TORCEDOR', color: C.violet, shape: 'squircle', eyes: 'star', mouth: 'grin', front: PROPS.flag },
  { id: 'e-derby', cat: 'desporto', text: 'É DERBY', color: C.lime, shape: 'blob', eyes: 'wide', mouth: 'flat', front: PROPS.flameTop },
  { id: 'classico', cat: 'desporto', text: 'CLÁSSICO', color: C.lime, eyes: 'wide', mouth: 'flat', front: PROPS.flameTop },
  // musica (mais)
  { id: 'som-2', cat: 'musica', text: 'SOM!', color: C.yellow, eyes: 'star', mouth: 'grin', front: PROPS.headphones },
  { id: 'a-ouvir', cat: 'musica', text: 'A OUVIR', color: C.green, eyes: 'closed', mouth: 'smile', cheeks: true, front: PROPS.headphones },
  { id: 'volume', cat: 'musica', text: 'VOLUME', color: C.yellow, eyes: 'star', mouth: 'grin', front: PROPS.headphones },
  { id: 'antes-de-dormir', cat: 'musica', text: 'ANTES DE DORMIR', color: C.violet, eyes: 'closed', mouth: 'o', front: PROPS.headphones },
  { id: 'playlist', cat: 'musica', text: 'PLAYLIST', color: C.green, shape: 'squircle', eyes: 'closed', mouth: 'smile', cheeks: true, front: PROPS.note },
  { id: 'novo-album', cat: 'musica', text: 'NOVO ÁLBUM', color: C.orange, shape: 'blob', eyes: 'wide', mouth: 'o', front: PROPS.note },
  { id: 'concerto', cat: 'musica', text: 'CONCERTO', color: C.orange, shape: 'squircle', eyes: 'star', mouth: 'grin', front: PROPS.mic },
  { id: 'show', cat: 'musica', text: 'SHOW!', color: C.violet, shape: 'squircle', eyes: 'star', mouth: 'grin', front: PROPS.mic },
  { id: 'palco-2', cat: 'musica', text: 'PALCO!', color: C.teal, eyes: 'none', mouth: 'smirk', front: PROPS.mic },
  { id: 'microfone-ligado', cat: 'musica', text: 'MICROFONE LIGADO', color: C.lime, shape: 'squircle', eyes: 'happy', mouth: 'laugh', front: PROPS.mic },
  { id: 'rap', cat: 'musica', text: 'RAP', color: C.green, shape: 'blob', eyes: 'none', mouth: 'smirk', front: PROPS.mic },
  { id: 'hip-hop', cat: 'musica', text: 'HIP-HOP', color: C.blue, shape: 'squircle', eyes: 'none', mouth: 'smirk', front: PROPS.headphones },
  { id: 'marrabenta', cat: 'musica', text: 'MARRABENTA', color: C.orange, shape: 'squircle', eyes: 'star', mouth: 'grin', front: PROPS.guitar },
  { id: 'pandza', cat: 'musica', text: 'PANDZA', color: C.violet, eyes: 'star', mouth: 'grin', front: PROPS.drum },
  { id: 'afrobeat', cat: 'musica', text: 'AFROBEAT', color: C.yellow, eyes: 'star', mouth: 'grin', front: PROPS.drum },
  { id: 'kizomba', cat: 'musica', text: 'KIZOMBA', color: C.pink, shape: 'squircle', eyes: 'heart', mouth: 'smile', cheeks: true, front: PROPS.hearts },
  { id: 'semba', cat: 'musica', text: 'SEMBA', color: C.pink, eyes: 'heart', mouth: 'smile', cheeks: true, front: PROPS.note },
  { id: 'passinho', cat: 'musica', text: 'PASSINHO', color: C.lime, shape: 'squircle', eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.note },
  { id: 'batida', cat: 'musica', text: 'BATIDA', color: C.orange, shape: 'squircle', eyes: 'star', mouth: 'grin', front: PROPS.drum },
  { id: 'tambor', cat: 'musica', text: 'TAMBOR', color: C.orange, shape: 'squircle', eyes: 'star', mouth: 'grin', front: PROPS.drum },
  { id: 'viola', cat: 'musica', text: 'VIOLA', color: C.lime, shape: 'blob', eyes: 'closed', mouth: 'smile', cheeks: true, front: PROPS.guitar },
  { id: 'guitarrada', cat: 'musica', text: 'GUITARRADA', color: C.coral, eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.guitar },
  { id: 'acustico', cat: 'musica', text: 'ACÚSTICO', color: C.teal, eyes: 'closed', mouth: 'smile', cheeks: true, front: PROPS.guitar },
  { id: 'cantar', cat: 'musica', text: 'CANTAR', color: C.orange, eyes: 'happy', mouth: 'laugh', front: PROPS.mic },
  { id: 'desafinei', cat: 'musica', text: 'DESAFINEI', color: C.orange, eyes: 'wide', mouth: 'flat', front: PROPS.note },
  { id: 'repete', cat: 'musica', text: 'REPETE!', color: C.violet, eyes: 'star', mouth: 'grin', front: PROPS.note },
  { id: 'ouve-isto', cat: 'musica', text: 'OUVE ISTO', color: C.coral, eyes: 'wide', mouth: 'o', front: PROPS.headphones },
  { id: 'e-hit', cat: 'musica', text: 'É HIT', color: C.violet, eyes: 'star', mouth: 'grin', front: PROPS.star },
  { id: 'dj-hoje', cat: 'musica', text: 'DJ HOJE', color: C.teal, eyes: 'none', mouth: 'smirk', front: PROPS.headphones },
  { id: 'set-de-verao', cat: 'musica', text: 'SET DE VERÃO', color: C.teal, eyes: 'none', mouth: 'smirk', front: PROPS.sun },
  { id: 'festival', cat: 'musica', text: 'FESTIVAL', color: C.violet, eyes: 'star', mouth: 'grin', front: PROPS.flag },
  { id: 'ensaio', cat: 'musica', text: 'ENSAIO', color: C.blue, shape: 'blob', eyes: 'dots', mouth: 'smile', front: PROPS.guitar },
  { id: 'toca', cat: 'musica', text: 'TOCA!', color: C.yellow, eyes: 'star', mouth: 'grin', front: PROPS.guitar },
  // estudo (mais)
  { id: 'a-estudar', cat: 'estudo', text: 'A ESTUDAR', color: C.sky, eyes: 'side', mouth: 'flat', front: PROPS.book },
  { id: 'exame', cat: 'estudo', text: 'EXAME', color: C.yellow, eyes: 'wide', mouth: 'flat', front: PROPS.book },
  { id: 'teste-hoje', cat: 'estudo', text: 'TESTE HOJE', color: C.lime, shape: 'blob', eyes: 'wide', mouth: 'flat', front: PROPS.book },
  { id: 'passei', cat: 'estudo', text: 'PASSEI!', color: C.violet, eyes: 'star', mouth: 'grin', front: PROPS.star },
  { id: 'reprovei', cat: 'estudo', text: 'REPROVEI', color: C.sky, eyes: 'dots', mouth: 'sad', front: PROPS.book },
  { id: 'nota-alta', cat: 'estudo', text: 'NOTA ALTA', color: C.yellow, eyes: 'star', mouth: 'grin', front: PROPS.star },
  { id: 'tpc', cat: 'estudo', text: 'TPC', color: C.violet, shape: 'drop', eyes: 'dots', mouth: 'sad', front: PROPS.book },
  { id: 'em-grupo', cat: 'estudo', text: 'EM GRUPO', color: C.violet, shape: 'drop', eyes: 'dots', mouth: 'sad', front: PROPS.laptop },
  { id: 'no-computador', cat: 'estudo', text: 'NO COMPUTADOR', color: C.teal, shape: 'blob', eyes: 'dots', mouth: 'smile', front: PROPS.laptop },
  { id: 'reuniao', cat: 'estudo', text: 'REUNIÃO', color: C.lime, shape: 'squircle', eyes: 'wide', mouth: 'flat', front: PROPS.clock },
  { id: 'em-reuniao', cat: 'estudo', text: 'EM REUNIÃO', color: C.pink, shape: 'blob', eyes: 'dots', mouth: 'smile', front: PROPS.clock },
  { id: 'email', cat: 'estudo', text: 'EMAIL', color: C.coral, eyes: 'dots', mouth: 'smile', front: PROPS.laptop },
  { id: 'prazo', cat: 'estudo', text: 'PRAZO', color: C.orange, eyes: 'wide', mouth: 'flat', front: PROPS.clock },
  { id: 'entreguei', cat: 'estudo', text: 'ENTREGUEI', color: C.yellow, eyes: 'star', mouth: 'grin', front: PROPS.star },
  { id: 'projeto', cat: 'estudo', text: 'PROJETO', color: C.gray, shape: 'blob', eyes: 'side', mouth: 'flat', front: PROPS.laptop },
  { id: 'ideia', cat: 'estudo', text: 'IDEIA!', color: C.orange, shape: 'squircle', eyes: 'wide', mouth: 'o', front: PROPS.bolt },
  { id: 'brainstorm', cat: 'estudo', text: 'BRAINSTORM', color: C.pink, eyes: 'wide', mouth: 'o', front: PROPS.bolt },
  { id: 'a-programar', cat: 'estudo', text: 'A PROGRAMAR', color: C.sky, eyes: 'side', mouth: 'flat', front: PROPS.laptop },
  { id: 'bug', cat: 'estudo', text: 'BUG', color: C.orange, eyes: 'wide', mouth: 'flat', front: PROPS.bolt },
  { id: 'funcionou', cat: 'estudo', text: 'FUNCIONOU!', color: C.coral, shape: 'blob', eyes: 'star', mouth: 'grin', front: PROPS.sparkles },
  { id: 'deploy', cat: 'estudo', text: 'DEPLOY', color: C.orange, shape: 'squircle', eyes: 'star', mouth: 'grin', front: PROPS.flag },
  { id: 'sexta-feira', cat: 'estudo', text: 'SEXTA-FEIRA', color: C.orange, eyes: 'star', mouth: 'grin', front: PROPS.partyHat },
  { id: 'turno-da-noite', cat: 'estudo', text: 'TURNO DA NOITE', color: C.blue, eyes: 'closed', mouth: 'o', front: PROPS.moon },
  { id: 'pausa', cat: 'estudo', text: 'PAUSA', color: C.green, shape: 'squircle', eyes: 'closed', mouth: 'smile', cheeks: true, front: PROPS.coffee },
  { id: 'cafe-da-manha', cat: 'estudo', text: 'CAFÉ DA MANHÃ', color: C.blue, shape: 'blob', eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.coffee },
  { id: 'hora-de-almoco', cat: 'estudo', text: 'HORA DE ALMOÇO', color: C.green, shape: 'squircle', eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.fork },
  { id: 'salario', cat: 'estudo', text: 'SALÁRIO', color: C.coral, shape: 'blob', eyes: 'star', mouth: 'grin', front: PROPS.coins },
  { id: 'aumento', cat: 'estudo', text: 'AUMENTO!', color: C.lime, shape: 'squircle', eyes: 'happy', mouth: 'laugh', front: PROPS.coins },
  { id: 'promocao-2', cat: 'estudo', text: 'PROMOÇÃO!', color: C.coral, shape: 'blob', eyes: 'star', mouth: 'grin', front: PROPS.trophy },
  { id: 'novo-emprego', cat: 'estudo', text: 'NOVO EMPREGO', color: C.orange, eyes: 'star', mouth: 'grin', front: PROPS.bag },
  { id: 'entrevista', cat: 'estudo', text: 'ENTREVISTA', color: C.yellow, shape: 'squircle', eyes: 'wide', mouth: 'flat', front: PROPS.sweat },
  { id: 'contratado', cat: 'estudo', text: 'CONTRATADO', color: C.coral, shape: 'blob', eyes: 'star', mouth: 'grin', front: PROPS.star },
  { id: 'livre', cat: 'estudo', text: 'LIVRE!', color: C.lime, shape: 'blob', eyes: 'closed', mouth: 'smile', cheeks: true, front: PROPS.sun },
  { id: 'ferias-ja', cat: 'estudo', text: 'FÉRIAS JÁ', color: C.sky, eyes: 'closed', mouth: 'smile', cheeks: true, front: PROPS.sunglasses },
  { id: 'estudo-noturno', cat: 'estudo', text: 'ESTUDO NOTURNO', color: C.violet, eyes: 'closed', mouth: 'o', front: PROPS.book },
  { id: 'biblioteca', cat: 'estudo', text: 'BIBLIOTECA', color: C.green, eyes: 'closed', mouth: 'smile', cheeks: true, front: PROPS.book },
  { id: 'leitura', cat: 'estudo', text: 'LEITURA', color: C.green, eyes: 'closed', mouth: 'smile', cheeks: true, front: PROPS.book },
  { id: 'aprendi', cat: 'estudo', text: 'APRENDI', color: C.teal, shape: 'blob', eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.sparkles },
  { id: 'aprendendo', cat: 'estudo', text: 'APRENDENDO', color: C.gray, eyes: 'side', mouth: 'flat', front: PROPS.book },
  // terra (mais)
  { id: 'mocambique', cat: 'terra', text: 'MOÇAMBIQUE', color: C.coral, shape: 'blob', eyes: 'star', mouth: 'grin', front: PROPS.flag },
  { id: 'maputo', cat: 'terra', text: 'MAPUTO', color: C.coral, eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.pin },
  { id: 'beira', cat: 'terra', text: 'BEIRA', color: C.teal, shape: 'blob', eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.pin },
  { id: 'nampula', cat: 'terra', text: 'NAMPULA', color: C.sky, eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.pin },
  { id: 'matola', cat: 'terra', text: 'MATOLA', color: C.sky, eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.pin },
  { id: 'xai-xai', cat: 'terra', text: 'XAI-XAI', color: C.sky, eyes: 'closed', mouth: 'smile', cheeks: true, front: PROPS.sun },
  { id: 'inhambane', cat: 'terra', text: 'INHAMBANE', color: C.lime, shape: 'blob', eyes: 'closed', mouth: 'smile', cheeks: true, front: PROPS.sun },
  { id: 'tofo', cat: 'terra', text: 'TOFO', color: C.teal, eyes: 'closed', mouth: 'smile', cheeks: true, front: PROPS.sun },
  { id: 'ponta-do-ouro', cat: 'terra', text: 'PONTA DO OURO', color: C.green, shape: 'squircle', eyes: 'closed', mouth: 'smile', cheeks: true, front: PROPS.sun },
  { id: 'pemba', cat: 'terra', text: 'PEMBA', color: C.sky, shape: 'squircle', eyes: 'closed', mouth: 'smile', cheeks: true, front: PROPS.sun },
  { id: 'quelimane', cat: 'terra', text: 'QUELIMANE', color: C.lime, eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.pin },
  { id: 'tete', cat: 'terra', text: 'TETE', color: C.sky, shape: 'squircle', eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.pin },
  { id: 'lichinga', cat: 'terra', text: 'LICHINGA', color: C.teal, shape: 'blob', eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.pin },
  { id: 'chimoio', cat: 'terra', text: 'CHIMOIO', color: C.coral, eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.pin },
  { id: 'manica', cat: 'terra', text: 'MANICA', color: C.teal, eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.pin },
  { id: 'gaza', cat: 'terra', text: 'GAZA', color: C.orange, shape: 'blob', eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.pin },
  { id: 'ilha', cat: 'terra', text: 'ILHA', color: C.green, eyes: 'closed', mouth: 'smile', cheeks: true, front: PROPS.pin },
  { id: 'lusofonia', cat: 'terra', text: 'LUSOFONIA', color: C.violet, eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.flag },
  { id: 'portugal', cat: 'terra', text: 'PORTUGAL', color: C.yellow, eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.flag },
  { id: 'lisboa', cat: 'terra', text: 'LISBOA', color: C.yellow, shape: 'squircle', eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.pin },
  { id: 'porto', cat: 'terra', text: 'PORTO', color: C.green, eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.pin },
  { id: 'brasil', cat: 'terra', text: 'BRASIL', color: C.orange, shape: 'squircle', eyes: 'star', mouth: 'grin', front: PROPS.flag },
  { id: 'angola', cat: 'terra', text: 'ANGOLA', color: C.violet, shape: 'squircle', eyes: 'star', mouth: 'grin', front: PROPS.flag },
  { id: 'cabo-verde', cat: 'terra', text: 'CABO VERDE', color: C.lime, shape: 'blob', eyes: 'closed', mouth: 'smile', cheeks: true, front: PROPS.sun },
  { id: 'guine', cat: 'terra', text: 'GUINÉ', color: C.violet, eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.flag },
  { id: 's-tome', cat: 'terra', text: 'S. TOMÉ', color: C.green, shape: 'squircle', eyes: 'closed', mouth: 'smile', cheeks: true, front: PROPS.sun },
  { id: 'timor', cat: 'terra', text: 'TIMOR', color: C.teal, shape: 'blob', eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.flag },
  { id: 'macau', cat: 'terra', text: 'MACAU', color: C.pink, shape: 'blob', eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.pin },
  { id: 'longe-de-casa', cat: 'terra', text: 'LONGE DE CASA', color: C.gray, eyes: 'dots', mouth: 'sad', front: PROPS.house },
  { id: 'vou-a-casa', cat: 'terra', text: 'VOU A CASA', color: C.pink, shape: 'blob', eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.house },
  { id: 'terra-mae', cat: 'terra', text: 'TERRA MÃE', color: C.red, shape: 'blob', eyes: 'heart', mouth: 'smile', cheeks: true, front: PROPS.heartBig },
  { id: 'orgulho', cat: 'terra', text: 'ORGULHO', color: C.yellow, eyes: 'star', mouth: 'grin', front: PROPS.flag },
  { id: 'made-in-moz', cat: 'terra', text: 'MADE IN MOZ', color: C.coral, eyes: 'wink', mouth: 'smirk', front: PROPS.flag },
  { id: 'na-minha-terra', cat: 'terra', text: 'NA MINHA TERRA', color: C.green, shape: 'squircle', eyes: 'closed', mouth: 'smile', cheeks: true, front: PROPS.house },
  { id: 'praia-da-terra', cat: 'terra', text: 'PRAIA DA TERRA', color: C.teal, eyes: 'closed', mouth: 'smile', cheeks: true, front: PROPS.sun },
  { id: 'boa-terra', cat: 'terra', text: 'BOA TERRA', color: C.green, eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.sparkles },
  { id: 'orgulho-local', cat: 'terra', text: 'ORGULHO LOCAL', color: C.pink, shape: 'blob', eyes: 'wink', mouth: 'smirk', front: PROPS.flag },
  { id: 'a-nossa-gente', cat: 'terra', text: 'A NOSSA GENTE', color: C.pink, eyes: 'heart', mouth: 'smile', cheeks: true, front: PROPS.hearts },
  { id: 'a-nossa-malta', cat: 'terra', text: 'A NOSSA MALTA', color: C.green, eyes: 'happy', mouth: 'smile', cheeks: true, front: PROPS.flag },
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
  const s = STICKERS.find((x) => x.id === id);
  if (!s) return <span className="text-sm text-zinc-500">Sticker</span>;
  const h = Math.round(size * (bare ? 0.98 : 1.12));
  const fs = s.text.length > 14 ? 11 : s.text.length > 11 ? 12.5 : s.text.length > 9 ? 14.5 : 17;
  const w = Math.min(118, Math.max(48, s.text.length * fs * 0.74 + 22));
  return (
    <svg role="img" aria-label={`Sticker: ${s.text}`} width={size} height={h} viewBox={bare ? '0 4 120 118' : '0 0 120 134'} className="shrink-0 overflow-visible">
      <g>
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
          <g>
            <rect x={60 - w / 2} y="103" width={w} height="25" rx="12.5" fill={INK} />
            <text x="60" y={115.5 + fs * 0.35} textAnchor="middle" fontSize={fs} fontWeight="900" letterSpacing="0.4" fill={WHITE} fontFamily="inherit">
              {s.text}
            </text>
          </g>
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
