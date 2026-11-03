// Logótipo do Txillapp para o grupo do WhatsApp: o mesmo logótipo (palavra txillapp), grande e centrado, 1024x1024.
// O WhatsApp corta em círculo, por isso a palavra fica dentro da área segura. Duas versões: fundo coral e fundo branco.
const path = require('path');
const sharp = require('sharp');

const group = (ink, dot) => `
  <g transform="translate(60.8 190.1) scale(2.7)" fill="none" stroke="${ink}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">
    <path d="M7 5V27Q7 34 14 34M0 14H14"/>
    <path d="M20 14Q27 24 34 34M34 14Q27 24 20 34"/>
    <path d="M42 14V34"/>
    <circle cx="42" cy="3.5" r="4.2" stroke-width="0" fill="${dot}"/>
    <path d="M51 3V34"/><path d="M61 3V34"/>
    <circle cx="77" cy="24" r="9.5"/><path d="M86.5 14V34"/>
    <circle cx="106" cy="24" r="9.5"/><path d="M96.5 14V46"/>
    <circle cx="135" cy="24" r="9.5"/><path d="M125.5 14V46"/>
  </g>`;
const svg = (bg, ink, dot) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="${bg}"/>${group(ink, dot)}</svg>`;

const out = path.join(__dirname, '..', 'store');
const make = (name, s) => sharp(Buffer.from(s), { density: 384 }).resize(1024, 1024).flatten({ background: '#fff' }).png().toFile(path.join(out, name)).then((i) => console.log(name, i.width + 'x' + i.height));
Promise.all([
  make('logo-whatsapp-coral.png', svg('#d6334f', '#ffffff', '#18181b')),
  make('logo-whatsapp-branco.png', svg('#ffffff', '#18181b', '#d6334f')),
]);
