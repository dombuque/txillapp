// Gera apps/web/src/pages/Legal.tsx (Termos e Política de Privacidade do site antigo) a partir do texto de referência,
// apps/mobile/src/lib/legalText.ts. O que está antes de `export function Terms()` (imports, Page) fica como está.
// Marcação: **negrito** → <b>, __itálico__ → <i>. Mantém as quebras de linha que o ficheiro já tem (CRLF ou LF).
//
// Uso (na raiz do repositório):
//   node apps/web/scripts/make-legal.mjs           gera de novo o Legal.tsx
//   node apps/web/scripts/make-legal.mjs --check   só diz se está igual (sai com 1 se não estiver)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SRC = resolve(root, 'apps/mobile/src/lib/legalText.ts');
const OUT = resolve(root, 'apps/web/src/pages/Legal.tsx');

const src = readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');

/** O array de secções `export const NOME: LegalBlock[][] = [...]` (é JSON válido). */
function grab(name) {
  const tag = `export const ${name}: LegalBlock[][] = `;
  const at = src.indexOf(tag);
  if (at < 0) throw new Error(`Não encontrei ${name} em legalText.ts`);
  const start = at + tag.length;
  const end = src.indexOf('\n];', start);
  return JSON.parse(src.slice(start, end + 2));
}

const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/__(.+?)__/g, '<i>$1</i>');

function block(b) {
  if (/[{}<>]/.test(b.t === 'ul' ? b.x.join('') : b.x)) throw new Error('Texto com { } < >: não pode ir tal e qual para JSX');
  if (b.t === 'ul') return `        <ul>\n${b.x.map((l) => `          <li>${inline(l)}</li>`).join('\n')}\n        </ul>`;
  return `        <${b.t}>${inline(b.x)}</${b.t}>`;
}

const page = (fn, title, sections) =>
  `export function ${fn}() {\n  return (\n    <Page title="${title}">\n` +
  sections.map((s) => `      <section>\n${s.map(block).join('\n')}\n      </section>`).join('\n') +
  `\n    </Page>\n  );\n}\n`;

const cur = readFileSync(OUT, 'utf8');
const crlf = cur.includes('\r\n');
const curLf = cur.replace(/\r\n/g, '\n');
const cut = curLf.indexOf('export function Terms()');
if (cut < 0) throw new Error('Não encontrei `export function Terms()` em Legal.tsx');
let out = `${curLf.slice(0, cut)}${page('Terms', 'Termos de Uso', grab('TERMS'))}\n${page('Privacy', 'Política de Privacidade', grab('PRIVACY'))}`;
if (crlf) out = out.replace(/\n/g, '\r\n');

if (process.argv.includes('--check')) {
  const same = out === cur;
  console.log(same ? 'Legal.tsx está igual a legalText.ts' : 'Legal.tsx está desatualizado: corre node apps/web/scripts/make-legal.mjs');
  process.exit(same ? 0 : 1);
}
writeFileSync(OUT, out);
console.log('Legal.tsx gerado de novo a partir de legalText.ts');
