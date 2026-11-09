// Gera src/components/nearby/leafletInline.ts e leafletCss.ts: o Leaflet (JS + CSS do npm) e o mapRuntime.ts como texto,
// para a página do mapa dentro da WebView da app (sem CDN). Correr de novo depois de atualizar o leaflet
// ou de mudar src/components/nearby/mapRuntime.ts:  node scripts/make-leaflet-inline.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const require = createRequire(join(root, 'package.json'));
const ts = require('typescript');

const leafletDir = dirname(require.resolve('leaflet/package.json'));
const js = readFileSync(join(leafletDir, 'dist', 'leaflet.js'), 'utf8');
const css = readFileSync(join(leafletDir, 'dist', 'leaflet.css'), 'utf8');
const version = JSON.parse(readFileSync(join(leafletDir, 'package.json'), 'utf8')).version;

const src = readFileSync(join(root, 'src', 'components', 'nearby', 'mapRuntime.ts'), 'utf8');
const out = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.ESNext, removeComments: true } }).outputText;
const runtime = out
  .split('\n')
  .filter((l) => !/^export \{\s*\};?\s*$/.test(l))
  .map((l) => l.replace(/^export (function|const|let|var|class) /, '$1 '))
  .join('\n');

// "</script" dentro de uma <script> fecharia a etiqueta antes do tempo.
const safe = (s) => JSON.stringify(s).replace(/<\/(script)/gi, '<\\/$1');
const file = `// GERADO por scripts/make-leaflet-inline.mjs (Leaflet ${version}): não editar à mão.
/* eslint-disable */
export const LEAFLET_VERSION = ${JSON.stringify(version)};
export const LEAFLET_JS: string = ${safe(js)};
/** O mapRuntime.ts em JavaScript simples (define a função createNearbyMap). */
export const RUNTIME_JS: string = ${safe(runtime)};
`;
writeFileSync(join(root, 'src', 'components', 'nearby', 'leafletInline.ts'), file);
// O CSS à parte: o site só precisa dele (o JS vem do npm).
writeFileSync(join(root, 'src', 'components', 'nearby', 'leafletCss.ts'), `// GERADO por scripts/make-leaflet-inline.mjs (Leaflet ${version}): não editar à mão.
/* eslint-disable */
export const LEAFLET_CSS: string = ${safe(css)};
`);
console.log(`leafletInline.ts: ${(file.length / 1024).toFixed(0)} KB (Leaflet ${version})`);
