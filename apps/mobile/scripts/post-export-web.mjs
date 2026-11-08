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
// Indexação (Google e outros motores de busca): cada página pública tem título, descrição, ligação canónica e
// cartão para as redes; as páginas da app (atrás da sessão) ficam fora dos resultados.
const SITE = 'https://txillapp.com';
const HOME_DESC = 'Partilha fotos e vídeos, cria Tchekas e Mimos, conversa em tempo real e descobre os melhores sítios para txillar. Grátis, no telemóvel e no computador.';
const PAGES = {
  'index.html': { path: '/', title: 'Txillapp · A rede social da malta', desc: HOME_DESC, index: true },
  'register.html': { path: '/register', title: 'Criar conta · Txillapp', desc: 'Cria a tua conta no Txillapp em menos de um minuto e junta-te à malta: fotos, vídeos, Tchekas, Mimos e conversas.', index: true },
  'terms.html': { path: '/terms', title: 'Termos de Utilização · Txillapp', desc: 'As regras do Txillapp: a tua conta, o que publicas, os Txills e o que não é permitido na comunidade.', index: true },
  'privacy.html': { path: '/privacy', title: 'Política de Privacidade · Txillapp', desc: 'Que dados o Txillapp recolhe, para que servem, quanto tempo ficam guardados e como controlas a tua privacidade.', index: true },
  'login.html': { path: '/login', title: 'Entrar · Txillapp', desc: 'Entra no Txillapp e volta à tua malta.', index: false },
};
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const JSONLD = JSON.stringify({
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'Organization', '@id': `${SITE}/#org`, name: 'Txillapp', url: `${SITE}/`, logo: `${SITE}/icon-512.png` },
    { '@type': 'WebSite', '@id': `${SITE}/#site`, name: 'Txillapp', url: `${SITE}/`, inLanguage: 'pt', description: HOME_DESC, publisher: { '@id': `${SITE}/#org` } },
  ],
});
const seoTags = (page) => {
  const t = [
    `<title>${esc(page.title)}</title>`,
    `<meta name="description" content="${esc(page.desc)}"/>`,
    `<meta name="robots" content="${page.index ? 'index, follow, max-image-preview:large' : 'noindex, follow'}"/>`,
    '<meta property="og:type" content="website"/>',
    '<meta property="og:site_name" content="Txillapp"/>',
    '<meta property="og:locale" content="pt_PT"/>',
    `<meta property="og:title" content="${esc(page.title)}"/>`,
    `<meta property="og:description" content="${esc(page.desc)}"/>`,
    `<meta property="og:image" content="${SITE}/og-image.png"/>`,
    '<meta property="og:image:width" content="1200"/>',
    '<meta property="og:image:height" content="630"/>',
    '<meta property="og:image:alt" content="Txillapp, a rede social da malta"/>',
    '<meta name="twitter:card" content="summary_large_image"/>',
    `<meta name="twitter:title" content="${esc(page.title)}"/>`,
    `<meta name="twitter:description" content="${esc(page.desc)}"/>`,
    `<meta name="twitter:image" content="${SITE}/og-image.png"/>`,
  ];
  if (page.index) t.push(`<link rel="canonical" href="${SITE}${page.path}"/>`, `<meta property="og:url" content="${SITE}${page.path}"/>`);
  if (page.path === '/') t.push(`<script type="application/ld+json">${JSONLD}</script>`);
  return t.join('');
};
// Sem viewport-fit=cover (como o site antigo): a página começa por baixo da zona do sistema do iPhone e não aparece o desfoque no topo.
// A versão vai em <meta> (lida pelo boot.js): nada de scripts embutidos, para a política de conteúdo (CSP) os poder proibir.
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
  `<meta name="tx-build" content="${build}"/>`,
  `<meta name="tx-version" content="${version}"/>`,
  `<script src="${base}/boot.js"></script>`,
  `<script src="${base}/register-sw.js" defer></script>`,
  '<style>html,body{background:#fff;overscroll-behavior:none;-webkit-tap-highlight-color:transparent}img,video{-webkit-touch-callout:none;-webkit-user-drag:none}img{-webkit-user-select:none;user-select:none}</style>',
].join('');
// Para quem não corre JavaScript (alguns robôs): o essencial da página de entrada, com as ligações principais.
const NOSCRIPT_HOME = `<noscript><main style="font-family:system-ui,sans-serif;max-width:640px;margin:48px auto;padding:0 20px;color:#18181b"><h1>Txillapp, a rede social da malta</h1><p>${esc(HOME_DESC)}</p><p><a href="/register">Criar conta</a> · <a href="/login?entrar=1">Entrar</a> · <a href="/terms">Termos</a> · <a href="/privacy">Privacidade</a></p></main></noscript>`;

let n = 0;
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.html')) {
      const rel = p.slice(dir.length + 1).replace(/\\/g, '/');
      const page = PAGES[rel] ?? { path: '/' + rel.replace(/\.html$/, ''), title: 'Txillapp', desc: HOME_DESC, index: false };
      let s = readFileSync(p, 'utf8');
      s = s
        .replace(/<html lang="[^"]*"/, '<html lang="pt"')
        .replace(/<meta name="viewport"[^>]*>/, '')
        .replace(/<title>[^<]*<\/title>/, '')
        .replace('</head>', `${seoTags(page)}${tags}</head>`);
      if (rel === 'index.html') s = s.replace(/<body([^>]*)>/, `<body$1>${NOSCRIPT_HOME}`);
      writeFileSync(p, s);
      n++;
    }
  }
})(dir);

// robots.txt e sitemap.xml: só as páginas públicas; a API fica de fora, menos as imagens (para aparecerem nas pesquisas).
writeFileSync(join(dir, 'robots.txt'), [
  'User-agent: *',
  'Allow: /',
  'Disallow: /api/',
  'Allow: /api/v1/media/',
  'Allow: /api/v1/avatars/',
  'Disallow: /app/',
  '',
  `Sitemap: ${SITE}/sitemap.xml`,
  '',
].join('\n'));
const today = new Date().toISOString().slice(0, 10);
const urls = Object.values(PAGES).filter((p) => p.index).map((p) => `  <url><loc>${SITE}${p.path}</loc><lastmod>${today}</lastmod><changefreq>${p.path === '/' ? 'daily' : 'monthly'}</changefreq><priority>${p.path === '/' ? '1.0' : '0.6'}</priority></url>`);
writeFileSync(join(dir, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
console.log(`cabeçalho PWA posto em ${n} páginas · versão ${version} · build ${build}`);
