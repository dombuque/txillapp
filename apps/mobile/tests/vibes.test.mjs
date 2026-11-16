// A moeda chama-se «vibes» (antes «Txills»): o ajudante src/lib/vibes.ts (singular, plural e a forma curta «vib») e uma
// varredura da app e do site para não ficar nenhum «Txills» à vista (as marcas Txillapp, Txillada, TxillGroups, SuperTxill...
// ficam; os nomes internos como `acceptsTxills` ou a chave `txills` da API também).
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MOBILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.resolve(MOBILE, '..', 'web');
const v = await import(pathToFileURL(path.join(MOBILE, 'src', 'lib', 'vibes.ts')).href);

test('formatVibes: «50 vibes», «1 vibe», «0 vibes» e, curta, «50 vib»', () => {
  assert.equal(v.formatVibes(50), '50 vibes');
  assert.equal(v.formatVibes(1), '1 vibe');
  assert.equal(v.formatVibes(0), '0 vibes');
  assert.equal(v.formatVibes(2), '2 vibes');
  assert.equal(v.formatVibes(50, { short: true }), '50 vib');
  assert.equal(v.formatVibes(1, { short: true }), '1 vib', 'a forma curta não muda no singular');
  assert.equal(v.formatVibes(1000), '1000 vibes');
  assert.equal(v.formatVibes(12500), '12 500 vibes', 'o espaço que não quebra só a partir de 5 algarismos');
  assert.equal(v.formatVibes(1_000_000, { short: true }), '1 000 000 vib');
});

test('formatVibes: arredonda, nunca mostra negativos nem NaN', () => {
  assert.equal(v.formatVibes(0.6), '1 vibe');
  assert.equal(v.formatVibes(49.6), '50 vibes');
  assert.equal(v.formatVibes(-5), '0 vibes');
  assert.equal(v.formatVibes(Number.NaN), '0 vibes');
  assert.equal(v.fmtVibesNumber(Number.POSITIVE_INFINITY), '0');
});

test('vibesWord: só a palavra (para as etiquetas debaixo do número)', () => {
  assert.equal(v.vibesWord(1), 'vibe');
  assert.equal(v.vibesWord(7), 'vibes');
  assert.equal(v.vibesWord(7, { short: true }), 'vib');
  assert.deepEqual([v.VIBE, v.VIBES, v.VIB], ['vibe', 'vibes', 'vib']);
  assert.equal(v.fmtVibesNumber(9999), '9999');
});

test('a Txillada usa o mesmo ajudante (os nomes antigos continuam a funcionar)', () => {
  const src = readFileSync(path.join(MOBILE, 'src', 'lib', 'txillada.ts'), 'utf8');
  assert.match(src, /import \{ fmtVibesNumber, formatVibes \} from '@\/lib\/vibes';/);
  assert.match(src, /export const fmtTxills = fmtVibesNumber;/);
  assert.match(src, /export const txillsLabel = \(n: number\): string => formatVibes\(n\);/);
});

const files = (dir) => readdirSync(dir).flatMap((n) => {
  const p = path.join(dir, n);
  if (statSync(p).isDirectory()) return n === 'node_modules' ? [] : files(p);
  return /\.(tsx?|mjs|js)$/.test(n) ? [p] : [];
});
// Os comentários não se veem: fora com eles (o «//» dos endereços tem «:» antes e fica).
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, '')).replace(/(^|[\s;{}(),])\/\/.*$/gm, '$1');
// O nome antigo: «Txill(s)» e «TXILLS» sozinhos (não «SuperTxill» nem `acceptsTxills`; «TXILL» é o texto da marca no
// estúdio) e o símbolo «TXL».
const OLD = /\bTxills?\b|\bTXILLS\b|\bTXL\b/;
// O que pode ficar: a nota dos Termos que diz o nome antigo, o verbo «txillar» em inglês e os autocolantes da marca.
const ALLOWED = [/antes «Txills»/, /Antes chamavam-se Txills: é a mesma moeda/, /'Txill with the crew'/, /label: 'Txill' \}/, /case 'txill': return 'Txill';/];

test('nenhum «Txills» (nem «TXL» ou «TXILLS») à vista na app nem no site', () => {
  const hits = [];
  for (const root of [path.join(MOBILE, 'src'), path.join(WEB, 'src')]) {
    for (const f of files(root)) {
      code(readFileSync(f, 'utf8')).split('\n').forEach((line, i) => {
        if (!OLD.test(line)) return;
        if (ALLOWED.some((re) => re.test(line))) return;
        // A moeda na API continua a ser «TXL» (o campo `currency`), mas isso não se mostra.
        if (/currency\s*[:=]+\s*'TXL'/.test(line)) return;
        hits.push(`${path.relative(path.resolve(MOBILE, '..'), f)}:${i + 1}: ${line.trim().slice(0, 140)}`);
      });
    }
  }
  assert.deepEqual(hits, [], `ainda há o nome antigo à vista:\n${hits.join('\n')}`);
});

test('a varredura apanha mesmo o nome antigo (e deixa as marcas)', () => {
  const bad = code(`const a = 'Tens 50 Txills';\n// os Txills num comentário\nconst b = 'SuperTxill, Txillada, TxillGroups, Txillapp';\nconst c = v.acceptsTxills;`);
  const lines = bad.split('\n').filter((l) => OLD.test(l));
  assert.deepEqual(lines, ["const a = 'Tens 50 Txills';"]);
  assert.equal(code('/* um\nTxills\n*/ x').split('\n').length, 3, 'os comentários de várias linhas não mudam os números das linhas');
  assert.ok(!OLD.test("newText(0, 1, 'TXILL')"), '«TXILL» é o texto da marca no estúdio');
  assert.ok(OLD.test('<Text>TXILLS</Text>') && OLD.test('50 TXL') && OLD.test('1 Txill'));
});
