// Testes de "Os teus aparelhos" (src/lib/aparelhos.ts): ordem da lista, ícone e o texto de cada linha.
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const a = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'aparelhos.ts')).href);

const NOW = new Date(2026, 10, 11, 12, 0, 0).getTime();
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const row = (o) => ({ id: 'x', device: 'Windows · Chrome', firstSeen: iso(86400_000 * 3), lastUsed: iso(60_000 * 5), current: false, ...o });

test('este aparelho vem primeiro; os outros do mais recente para o mais antigo', () => {
  const list = [row({ id: 'velho', lastUsed: iso(86400_000 * 9) }), row({ id: 'eu', current: true, lastUsed: iso(86400_000 * 20) }), row({ id: 'novo', lastUsed: iso(60_000) })];
  assert.deepEqual(a.ordenarAparelhos(list).map((r) => r.id), ['eu', 'novo', 'velho']);
  assert.equal(list[0].id, 'velho', 'não mexe na lista original');
});

test('ícone: usa o que o servidor diz; nos servidores antigos adivinha pelo nome', () => {
  assert.equal(a.eTelemovel({ device: 'Windows · Chrome', mobile: false }), false);
  assert.equal(a.eTelemovel({ device: 'iPhone · Safari (app instalada)', mobile: true }), true);
  assert.equal(a.eTelemovel({ device: 'Chrome · Android' }), true);
  assert.equal(a.eTelemovel({ device: 'Safari · iOS' }), true);
  assert.equal(a.eTelemovel({ device: 'Firefox · Linux' }), false);
});

test('texto da linha: quando entrou e a última atividade', () => {
  assert.equal(a.detalheAparelho(row({ firstSeen: new Date(2026, 10, 2).toISOString(), lastUsed: iso(5 * 60_000) }), NOW), 'Entrou a 2 nov. · ativo há 5 min');
  assert.equal(a.detalheAparelho(row({ firstSeen: new Date(2025, 0, 15).toISOString(), current: true }), NOW), 'Entrou a 15 jan. 2025 · em uso agora');
  assert.equal(a.haQuanto(iso(30_000), NOW), 'agora');
  assert.equal(a.haQuanto(iso(3 * 3600_000), NOW), 'há 3 h');
  assert.equal(a.haQuanto(iso(86400_000 * 1.5), NOW), 'há 1 dia');
  assert.equal(a.haQuanto(iso(86400_000 * 4), NOW), 'há 4 dias');
});
