// Guardar e partilhar um Zás leva sempre a assinatura do Txillapp (o logótipo e o @ do dono): a imagem vem do servidor,
// GET /instants/:id/download, no telemóvel e na web. E só os meus Zás têm «Guardar», «Descarregar» e «Partilhar».
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const zas = read('src/components/zas/zasImage.ts');
const instants = read('src/components/Instants.tsx');

test('no telemóvel o Zás guarda-se pelo endpoint assinado (não pela foto crua)', () => {
  assert.match(zas, /`\/instants\/\$\{it\.id\}\/download`/);
  assert.match(zas, /saveToGallery\(downloadPath\(it\), fileName\(it\)\)/);
  assert.doesNotMatch(zas, /saveUrlToGallery/);
});

test('na web, guardar, descarregar e partilhar usam o ficheiro assinado, com a sessão', () => {
  assert.match(zas, /fetchAuthed\(downloadPath\(it\)\)/);
  // Nada de desenhar a foto crua num canvas, nem de abrir a foto sem assinatura quando falha.
  assert.doesNotMatch(zas, /createImageBitmap|getContext\(|window\.open\(it\.url/);
  const share = zas.slice(zas.indexOf('export async function shareZas'));
  assert.match(share, /signedFile\(it\)/);
  const save = zas.slice(zas.indexOf('export async function saveZas'), zas.indexOf('export async function shareZas'));
  assert.match(save, /signedFile\(it\)/);
});

test('«Guardar», «Descarregar» e «Partilhar» só nos meus Zás', () => {
  // O visor: o botão de guardar fica no ramo `own`, antes do ramo dos Zás dos outros (reações e resposta).
  const bar = instants.indexOf('{own ? (', instants.indexOf('function InstantViewer'));
  const save = instants.indexOf('saveZas(cur)', bar);
  const others = instants.indexOf('<ReactBar', bar);
  assert.ok(bar > 0 && save > bar && others > save, 'o guardar do visor está fora do ramo dos meus Zás');
  // O menu com guardar/partilhar é o da grelha de «Os meus Zás» (`menu`); mais nenhum sítio chama saveZas/shareZas.
  const calls = [...instants.matchAll(/(saveZas|shareZas)\((\w+)/g)].map((m) => m[2]);
  assert.ok(calls.length >= 4);
  assert.deepEqual([...new Set(calls)].sort(), ['cur', 'menu']);
});
