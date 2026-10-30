// Gera os ícones da app (PNG) a partir do desenho em SVG: node scripts/make-icons.mjs
import sharp from 'sharp';
import { writeFileSync } from 'fs';

const BRAND = '#d6334f';
const INK = '#18181b'; // o mesmo "preto" do texto da app (zinc-900)
// O logótipo "txillapp" é um só em todo o lado: letras escuras e o ponto do "i" a coral, sobre fundo branco.
// Fica dentro da zona segura (80%) para os ícones "maskable".
const logo = `
  <g transform="translate(76 192) scale(2.3)" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">
    <path d="M7 5V27Q7 34 14 34M0 14H14"/>
    <path d="M20 14Q27 24 34 34M34 14Q27 24 20 34"/>
    <path d="M42 14V34"/>
    <circle cx="42" cy="3.5" r="4.2" stroke-width="0" fill="${BRAND}"/>
    <path d="M51 3V34"/><path d="M61 3V34"/>
    <circle cx="77" cy="24" r="9.5"/><path d="M86.5 14V34"/>
    <circle cx="106" cy="24" r="9.5"/><path d="M96.5 14V46"/>
    <circle cx="135" cy="24" r="9.5"/><path d="M125.5 14V46"/>
  </g>`;
const art = (bg) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${bg}${logo}</svg>`;

const rounded = art(`<rect width="512" height="512" rx="112" fill="#fff"/><rect x="2" y="2" width="508" height="508" rx="110" fill="none" stroke="#e4e4e7" stroke-width="4"/>`);
const full = art(`<rect width="512" height="512" fill="#fff"/>`);

writeFileSync('public/icon.svg', rounded);
await sharp(Buffer.from(rounded)).resize(192, 192).png().toFile('public/icon-192.png');
await sharp(Buffer.from(rounded)).resize(512, 512).png().toFile('public/icon-512.png');
// Maskable: fundo até às bordas (o sistema recorta). Android adapta; iOS usa o apple-touch-icon.
await sharp(Buffer.from(full)).resize(512, 512).png().toFile('public/icon-maskable-512.png');
await sharp(Buffer.from(full)).resize(180, 180).png().toFile('public/apple-touch-icon.png');

// Favicon: o separador do navegador é minúsculo, por isso usa o monograma "tx" do logótipo, no mesmo preto e com o ponto coral.
const mono = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#fff"/><rect x="3" y="3" width="506" height="506" rx="109" fill="none" stroke="#d4d4d8" stroke-width="6"/>
  <g transform="translate(112 118) scale(8)" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">
    <path d="M7 5V27Q7 34 14 34M0 14H14"/><path d="M20 14Q27 24 34 34M34 14Q27 24 20 34"/>
    <circle cx="43" cy="9" r="4.6" stroke-width="0" fill="${BRAND}"/>
  </g></svg>`;
writeFileSync('public/favicon.svg', mono);
const png = (n) => sharp(Buffer.from(mono)).resize(n, n).png().toBuffer();
writeFileSync('public/favicon-32.png', await png(32));
// favicon.ico com o PNG de 48 px lá dentro (formato aceite por todos os navegadores atuais).
const p48 = await png(48);
const head = Buffer.alloc(22);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);
head[6] = 48; head[7] = 48; head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12);
head.writeUInt32LE(p48.length, 14); head.writeUInt32LE(22, 18);
writeFileSync('public/favicon.ico', Buffer.concat([head, p48]));
console.log('ícones gerados');
