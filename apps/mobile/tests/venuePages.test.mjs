// A página de um local (/v/[slug]) e Gerir (/v/[slug]/gerir): o rascunho do perfil não se perde quando o local chega
// outra vez do servidor (lib/draftSync), o "Sobre" não aparece duas vezes, os avisos de análise não se contradizem, sem
// rede não se diz "não existe" nem "só os gestores", e o @ do convite só se apaga quando o convite foi enviado.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { resyncDraft } = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'draftSync.ts')).href);
const read = (...p) => readFileSync(path.join(ROOT, 'src', ...p), 'utf8');

test('resyncDraft: sem mexer, passa para a versão nova; com algo escrito, fica o que se escreveu', () => {
  const base = { name: 'Bar X', hours: '' };
  const incoming = { name: 'Bar X', hours: '18h às 2h' };
  assert.deepEqual(resyncDraft({ ...base }, base, incoming), incoming);
  const typed = { name: 'Bar X da Polana', hours: '' };
  assert.equal(resyncDraft(typed, base, incoming), typed);
  assert.equal(resyncDraft(true, true, false), false);
  assert.equal(resyncDraft(false, true, true), false);
  assert.equal(resyncDraft(null, null, { lat: 1 }).lat, 1);
});

test('Gerir → Perfil: o efeito que segue o local usa resyncDraft (não apaga o que se escreveu)', () => {
  const src = read('app', 'v', '[slug]', 'gerir.tsx');
  const eff = src.slice(src.indexOf('const base = useRef('), src.indexOf('}, [v]);'));
  assert.match(eff, /setF\(\(cur\) => resyncDraft\(cur, prev\.f, next\.f\)\)/);
  assert.match(eff, /setPlace\(\(cur\) => resyncDraft\(cur, prev\.place, next\.place\)\)/);
  assert.doesNotMatch(eff, /setF\(\{ name: v\.name/);
});

test('Gerir → Gestores: o @ do convite só se limpa se o convite foi enviado, e sem o @ à frente', () => {
  const src = read('app', 'v', '[slug]', 'gerir.tsx');
  assert.match(src, /\.then\(\(sent\) => \{ if \(sent\) setUsername\(''\); \}\)/);
  assert.match(src, /username\.trim\(\)\.replace\(\/\^@\/, ''\)/);
});

test('Gerir: sem rede há "Tentar outra vez" (no ecrã e no painel), não "Só os gestores entram aqui"', () => {
  const src = read('app', 'v', '[slug]', 'gerir.tsx');
  assert.match(src, /Não consegui abrir o local/);
  assert.match(src, /Não consegui carregar o painel/);
});

test('página do local: o Sobre não se repete, os avisos de análise não se contradizem e 404 ≠ sem rede', () => {
  const src = read('app', 'v', '[slug].tsx');
  assert.match(src, /v\.about && tab !== 'about'/);
  assert.match(src, /!v\.verified && v\.mine && \(!v\.reviewStatus \|\| v\.reviewStatus === 'approved'\)/);
  assert.match(src, /q\.error\.status === 404 \?/);
  assert.match(src, /Não consegui abrir este local/);
});
