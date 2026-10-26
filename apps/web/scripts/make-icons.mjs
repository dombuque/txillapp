// Gera os ícones da app (PNG) a partir do desenho em SVG: node scripts/make-icons.mjs
import sharp from 'sharp';
import { writeFileSync } from 'fs';

const BRAND = '#d6334f';
// O logótipo "txillapp" (o mesmo da app), a branco sobre o coral, com o ponto do "i" em amarelo.
// Fica dentro da zona segura (80%) para os ícones "maskable".
const logo = `
  <g transform="translate(76 192) scale(2.3)" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">
    <path d="M7 5V27Q7 34 14 34M0 14H14"/>
    <path d="M20 14Q27 24 34 34M34 14Q27 24 20 34"/>
    <path d="M42 14V34"/>
    <circle cx="42" cy="3.5" r="4.6" stroke-width="0" fill="#ffd166"/>
    <path d="M51 3V34"/><path d="M61 3V34"/>
    <circle cx="77" cy="24" r="9.5"/><path d="M86.5 14V34"/>
    <circle cx="106" cy="24" r="9.5"/><path d="M96.5 14V46"/>
    <circle cx="135" cy="24" r="9.5"/><path d="M125.5 14V46"/>
  </g>`;
const art = (bg) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${bg}${logo}</svg>`;

const rounded = art(`<rect width="512" height="512" rx="112" fill="${BRAND}"/>`);
const full = art(`<rect width="512" height="512" fill="${BRAND}"/>`);

writeFileSync('public/icon.svg', rounded);
await sharp(Buffer.from(rounded)).resize(192, 192).png().toFile('public/icon-192.png');
await sharp(Buffer.from(rounded)).resize(512, 512).png().toFile('public/icon-512.png');
// Maskable: fundo até às bordas (o sistema recorta). Android adapta; iOS usa o apple-touch-icon.
await sharp(Buffer.from(full)).resize(512, 512).png().toFile('public/icon-maskable-512.png');
await sharp(Buffer.from(full)).resize(180, 180).png().toFile('public/apple-touch-icon.png');
console.log('ícones gerados');
