// Depois de `expo export --platform web`: põe em todas as páginas o manifesto (PWA), os ícones e o ecrã inteiro no telemóvel.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = process.argv[2] ?? 'dist';
const base = process.argv[3] ?? ''; // '' = na raiz do site (txillapp.com)
// Versão desta build: o hash dos nomes dos chunks (mudam quando o código muda). Vai para o service worker (nome da
// cache: assim cada versão é um service worker novo e o telemóvel atualiza), para o HTML (a app sabe qual tem) e para
// /version.json (para a app perguntar se há versão nova sem recarregar).
const chunksDir = join(dir, '_expo', 'static', 'js', 'web');
const build = (process.env.BUILD_ID || createHash('md5').update((existsSync(chunksDir) ? readdirSync(chunksDir) : []).sort().join('\n')).digest('hex')).slice(0, 12);
const swPath = join(dir, 'sw.js');
if (existsSync(swPath)) writeFileSync(swPath, readFileSync(swPath, 'utf8').replace('__TX_BUILD__', build));
// A versão (Semantic Versioning, em app.json) é o que as pessoas veem; o build é só o identificador desta exportação.
const version = (() => {
  for (const p of [join(dir, '..', 'app.json'), fileURLToPath(new URL('../app.json', import.meta.url))]) {
    try { return String(JSON.parse(readFileSync(p, 'utf8')).expo.version); } catch { /* tenta o próximo */ }
  }
  return '0.0.0';
})();
writeFileSync(join(dir, 'version.json'), JSON.stringify({ version, build }));
// Sem viewport-fit=cover (como o site antigo): a página começa por baixo da zona do sistema do iPhone e não aparece o desfoque no topo.
const tags = [
  '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, interactive-widget=resizes-content"/>',
  '<meta name="theme-color" content="#ffffff"/>',
  '<meta name="apple-mobile-web-app-capable" content="yes"/>',
  '<meta name="mobile-web-app-capable" content="yes"/>',
  '<meta name="apple-mobile-web-app-status-bar-style" content="default"/>',
  '<meta name="apple-mobile-web-app-title" content="Txillapp"/>',
  `<link rel="manifest" href="${base}/manifest.webmanifest"/>`,
  `<link rel="apple-touch-icon" href="${base}/apple-touch-icon.png"/>`,
  `<link rel="icon" href="${base}/favicon.ico" sizes="any"/>`,
  `<link rel="icon" type="image/svg+xml" href="${base}/favicon.svg"/>`,
  '<meta name="description" content="A rede da malta: partilha momentos, faz showoff e oferece Txills."/>',
  '<meta property="og:type" content="website"/>',
  '<meta property="og:site_name" content="Txillapp"/>',
  '<meta property="og:title" content="Txillapp"/>',
  '<meta property="og:description" content="A rede da malta: partilha momentos, faz showoff e oferece Txills."/>',
  '<meta property="og:image" content="https://txillapp.com/og-image.png"/>',
  `<script>window.__TX_BUILD="${build}";window.__TX_VERSION="${version}"</script>`,
  `<script src="${base}/boot.js"></script>`,
  `<script src="${base}/register-sw.js" defer></script>`,
  '<style>html,body{background:#fff;overscroll-behavior:none;-webkit-tap-highlight-color:transparent}</style>',
].join('');

let n = 0;
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.html')) {
      let s = readFileSync(p, 'utf8');
      s = s.replace(/<meta name="viewport"[^>]*>/, '').replace('</head>', `${tags}</head>`);
      writeFileSync(p, s);
      n++;
    }
  }
})(dir);
console.log(`cabeçalho PWA posto em ${n} páginas · versão ${version} · build ${build}`);
