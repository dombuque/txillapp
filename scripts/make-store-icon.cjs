// Ícone de 1024x1024 para a App Store: quadrado inteiro, sem cantos arredondados e SEM transparência (a Apple aplica a máscara).
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = path.join(__dirname, '..');
let svg = fs.readFileSync(path.join(root, 'apps/web/public/icon.svg'), 'utf8');
svg = svg
  .replace(/<rect width="512" height="512" rx="112" fill="#fff"\/>/, '<rect width="512" height="512" fill="#fff"/>')
  .replace(/<rect x="2" y="2" width="508" height="508" rx="110"[^>]*\/>/, '');

sharp(Buffer.from(svg), { density: 384 })
  .resize(1024, 1024)
  .flatten({ background: '#ffffff' })
  .removeAlpha()
  .png()
  .toFile(path.join(root, 'store/icon-1024.png'))
  .then((i) => console.log('icon-1024.png', i.width + 'x' + i.height, 'canais:', i.channels));
