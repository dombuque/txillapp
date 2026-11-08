// Gera os stickers animados dos mimos (desenho próprio, em SVG) e a arte de todos os stickers para a API:
//   node scripts/make-mimo-stickers.mjs
// Escreve src/assets/mimo-stickers.json (app) e ../api/src/stories/sticker-art.ts (a API grava-os nas cópias guardadas).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const INK = '#1f1b24';
const O = `stroke="${INK}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"`;
const T = 'font-family="sans-serif" font-weight="900" text-anchor="middle"';
const svg = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">${inner}</svg>`;

/** Os stickers dos mimos: id, nome, animação e o desenho (grelha 100×100, traço escuro como os do chat). */
const ITEMS = [
  ['m-fogo', 'Fogo', 'flicker',
    `<path d="M50 8c4 14 20 22 20 42a20 20 0 0 1-40 0c0-9 4-15 9-20c0 6 3 10 8 12c-3-12 0-24 3-34z" fill="#ff7a1a" ${O}/>` +
    `<path d="M50 44c3 8 10 11 10 20a10 10 0 0 1-20 0c0-6 4-9 6-13c0 3 2 5 4 6c-1-5-1-9 0-13z" fill="#ffd23f" ${O}/>`],
  ['m-coracao', 'Coração', 'pulse',
    `<path d="M50 88C30 72 12 58 12 38a19 19 0 0 1 38-3a19 19 0 0 1 38 3c0 20-18 34-38 50z" fill="#ff5c6c" ${O}/>` +
    `<path d="M26 36c1-7 6-12 12-12" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity="0.8"/>`],
  ['m-brinde', 'Brinde', 'wiggle',
    `<g transform="rotate(-15 38 60)"><path d="M26 34h24v40a6 6 0 0 1-6 6H32a6 6 0 0 1-6-6z" fill="#ffb020" ${O}/><path d="M26 44h-6a6 6 0 0 0-6 6v10a6 6 0 0 0 6 6h6" fill="none" ${O}/><path d="M22 34c-2-8 6-13 12-9c3-7 16-7 20 0c6-4 14 1 12 9z" fill="#fff8e6" ${O}/><path d="M33 46v22M41 46v22" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity="0.7"/></g>` +
    `<g transform="rotate(15 62 60)"><path d="M50 34h24v40a6 6 0 0 1-6 6H56a6 6 0 0 1-6-6z" fill="#ffb020" ${O}/><path d="M74 44h6a6 6 0 0 1 6 6v10a6 6 0 0 1-6 6h-6" fill="none" ${O}/><path d="M46 34c-2-8 6-13 12-9c3-7 16-7 20 0c6-4 14 1 12 9z" fill="#fff8e6" ${O}/></g>` +
    `<path d="M50 8v9M38 14l5 6M62 14l-5 6" fill="none" stroke="#ffd23f" stroke-width="4" stroke-linecap="round"/>`],
  ['m-estrela', 'Estrela', 'twinkle',
    `<path d="M50 8l12 26 28 3-21 19 6 28-25-14-25 14 6-28L10 37l28-3z" fill="#ffd23f" ${O}/>` +
    `<path d="M40 36l-4 10" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity="0.8"/>`],
  ['m-disco', 'Bola de espelhos', 'swing',
    `<path d="M50 4v12" fill="none" ${O}/><circle cx="50" cy="52" r="36" fill="#c7d2fe" ${O}/>` +
    `<g stroke="#fff" stroke-width="2.5" opacity="0.9" fill="none"><path d="M14 52h72M18 38h64M18 66h64M26 26h48M26 78h48M50 16v72M34 20v64M66 20v64M22 30v44M78 30v44"/></g>` +
    `<circle cx="38" cy="38" r="6" fill="#fff" opacity="0.9"/>`],
  ['m-nota', 'Nota musical', 'float',
    `<path d="M40 22v46M76 13v44" fill="none" ${O}/><path d="M40 22l36-9v12l-36 9z" fill="#ff5c6c" ${O}/>` +
    `<ellipse cx="30" cy="70" rx="12" ry="9" fill="#ff5c6c" ${O}/><ellipse cx="66" cy="59" rx="12" ry="9" fill="#ff5c6c" ${O}/>`],
  ['m-sol', 'Sol', 'spin',
    `<path d="M50 6v12M50 82v12M6 50h12M82 50h12M19 19l8 8M73 73l8 8M19 81l8-8M73 27l8-8" fill="none" stroke="#ffb020" stroke-width="5" stroke-linecap="round"/>` +
    `<circle cx="50" cy="50" r="22" fill="#ffd23f" ${O}/>`],
  ['m-lua', 'Lua', 'float',
    `<path d="M60 8a42 42 0 1 0 32 66A34 34 0 0 1 60 8z" fill="#ffd23f" ${O}/>` +
    `<path d="M78 22l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill="#fff" ${O}/>`],
  ['m-cem', '100', 'bounce',
    `<rect x="10" y="30" width="80" height="40" rx="20" fill="#ff5c6c" ${O}/>` +
    `<text x="50" y="60" ${T} font-size="28" fill="#fff">100</text>` +
    `<path d="M30 78h40M36 86h28" fill="none" stroke="#ff5c6c" stroke-width="4" stroke-linecap="round"/>`],
  ['m-txilla', 'Txilla', 'pulse',
    `<g transform="rotate(-8 50 50)"><rect x="6" y="32" width="88" height="36" rx="10" fill="#ff5c6c" ${O}/><text x="50" y="58" ${T} font-size="20" fill="#fff" letter-spacing="1">TXILLA</text></g>`],
  ['m-hoje', 'Hoje', 'shake',
    `<g transform="rotate(6 50 50)"><rect x="12" y="32" width="76" height="36" rx="8" fill="#ffd23f" ${O}/><text x="50" y="58" ${T} font-size="22" fill="${INK}">HOJE</text></g>`],
  ['m-confete', 'Confete', 'pop',
    `<path d="M12 88L38 46l16 16z" fill="#ff5c6c" ${O}/><path d="M22 72l12 12M30 60l12 12" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity="0.8"/>` +
    `<g ${O}><rect x="56" y="18" width="10" height="6" rx="1" fill="#38bdf8" transform="rotate(20 61 21)"/><rect x="72" y="36" width="10" height="6" rx="1" fill="#ffd23f" transform="rotate(-30 77 39)"/><rect x="48" y="36" width="8" height="6" rx="1" fill="#10b981" transform="rotate(40 52 39)"/><circle cx="80" cy="18" r="4" fill="#ff5c6c"/><circle cx="66" cy="52" r="4" fill="#a78bfa"/><circle cx="88" cy="56" r="3.5" fill="#38bdf8"/><rect x="36" y="20" width="8" height="5" rx="1" fill="#a78bfa" transform="rotate(-15 40 22)"/></g>`],
  ['m-coroa', 'Coroa', 'bounce',
    `<path d="M14 72L10 30l22 18 18-28 18 28 22-18-4 42z" fill="#ffd23f" ${O}/><rect x="14" y="72" width="72" height="12" rx="3" fill="#ffb020" ${O}/>` +
    `<circle cx="50" cy="56" r="5" fill="#ff5c6c" ${O}/><circle cx="30" cy="60" r="4" fill="#38bdf8" ${O}/><circle cx="70" cy="60" r="4" fill="#38bdf8" ${O}/>`],
  ['m-brilho', 'Brilho', 'twinkle',
    `<path d="M36 14l6 18 18 6-18 6-6 18-6-18-18-6 18-6z" fill="#ffd23f" ${O}/>` +
    `<path d="M72 50l4 11 11 4-11 4-4 11-4-11-11-4 11-4z" fill="#fff" ${O}/>` +
    `<path d="M30 70l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill="#ff5c6c" ${O}/>`],
  ['m-cocktail', 'Cocktail', 'wiggle',
    `<path d="M18 18h64L54 52v26h14v8H32v-8h14V52z" fill="#bae6fd" ${O}/><path d="M26 24h48L50 48z" fill="#ff5c6c" ${O}/>` +
    `<circle cx="74" cy="24" r="9" fill="#ffd23f" ${O}/><circle cx="74" cy="24" r="4" fill="#fff8e6"/>` +
    `<path d="M40 10l18 32" fill="none" stroke="#10b981" stroke-width="4" stroke-linecap="round"/>`],
  ['m-olhos', 'Olhos', 'wiggle',
    `<ellipse cx="34" cy="50" rx="16" ry="22" fill="#fff" ${O}/><ellipse cx="66" cy="50" rx="16" ry="22" fill="#fff" ${O}/>` +
    `<circle cx="38" cy="54" r="8" fill="${INK}"/><circle cx="70" cy="54" r="8" fill="${INK}"/><circle cx="41" cy="51" r="2.5" fill="#fff"/><circle cx="73" cy="51" r="2.5" fill="#fff"/>`],
  ['m-bola', 'Bola', 'spin',
    `<circle cx="50" cy="50" r="38" fill="#fff" ${O}/><path d="M50 30l14 10-5 16H41l-5-16z" fill="${INK}"/>` +
    `<path d="M50 30V14M64 40l15-6M59 56l9 13M41 56l-9 13M36 40l-15-6" fill="none" ${O}/>`],
  ['m-pin', 'Estou aqui', 'bounce',
    `<path d="M50 8a28 28 0 0 0-28 28c0 20 28 56 28 56s28-36 28-56A28 28 0 0 0 50 8z" fill="#ff5c6c" ${O}/><circle cx="50" cy="36" r="11" fill="#fff" ${O}/>`],
  ['m-pizza', 'Pizza', 'wiggle',
    `<path d="M50 90L14 24c22-12 50-12 72 0z" fill="#ffd23f" ${O}/><path d="M14 24c22-12 50-12 72 0l-4 8c-20-10-44-10-64 0z" fill="#ffb020" ${O}/>` +
    `<circle cx="44" cy="40" r="6" fill="#ff5c6c" ${O}/><circle cx="60" cy="48" r="6" fill="#ff5c6c" ${O}/><circle cx="50" cy="62" r="5" fill="#ff5c6c" ${O}/>`],
  ['m-cafe', 'Café', 'float',
    `<path d="M20 40h50v24a16 16 0 0 1-16 16H36a16 16 0 0 1-16-16z" fill="#fff" ${O}/><path d="M70 46h6a8 8 0 0 1 0 16h-6" fill="none" ${O}/>` +
    `<rect x="14" y="82" width="62" height="6" rx="3" fill="${INK}"/><path d="M34 30c-4-6 4-8 0-14M48 30c-4-6 4-8 0-14" fill="none" stroke="#9ca3af" stroke-width="3" stroke-linecap="round"/>`],
];

const mimo = { items: ITEMS.map(([id, text, anim, inner]) => ({ id, text, anim, svg: svg(inner) })) };
const mimoOut = resolve(here, '../src/assets/mimo-stickers.json');
writeFileSync(mimoOut, JSON.stringify(mimo));

// A arte de todos (chat + mimos) para a API: só o viewBox e o conteúdo, que ela encaixa na foto ou no vídeo guardado.
const chat = JSON.parse(readFileSync(resolve(here, '../src/assets/stickers.json'), 'utf8'));
const art = {};
for (const it of [...mimo.items, ...chat.items]) {
  const m = /<svg([^>]*)>([\s\S]*)<\/svg>/.exec(it.svg);
  const vb = /viewBox="([^"]+)"/.exec(m[1])?.[1] ?? '0 0 100 100';
  art[it.id] = { vb, body: m[2] };
}
const ts = `// GERADO por apps/mobile/scripts/make-mimo-stickers.mjs: não editar à mão.
// A arte dos stickers (do chat e dos mimos), para a API os gravar nas cópias que as pessoas guardam.
export const STICKER_ART: Record<string, { vb: string; body: string }> = ${JSON.stringify(art)};
`;
const apiOut = resolve(here, '../../api/src/stories/sticker-art.ts');
writeFileSync(apiOut, ts);
console.log(`${mimo.items.length} stickers animados -> ${mimoOut}\n${Object.keys(art).length} desenhos -> ${apiOut}`);
