// As folhas das Definições (components/settings/sheets.tsx, usePrivacy.ts e app/settings/privacidade.tsx): quando o
// servidor recusa uma mudança diz-se porquê (antes o interruptor voltava atrás calado), os botões das listas não aceitam
// dois toques, e em "Alterar senha" o "seguinte" do teclado passa de campo em campo.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(path.join(ROOT, 'src', ...p), 'utf8');
const sheets = read('components', 'settings', 'sheets.tsx');

test('usePrivacy: se o servidor recusar, volta atrás e avisa', () => {
  const src = read('components', 'settings', 'usePrivacy.ts');
  const c = src.slice(src.indexOf('} catch'));
  assert.match(c, /qc\.setQueryData\(\['privacy'\], prev\)/);
  assert.match(c, /Alert\.alert\('Não deu'/);
});

test('respostas aos mimos: o erro não fica por apanhar', () => {
  const src = read('app', 'settings', 'privacidade.tsx');
  assert.doesNotMatch(src, /onPick=\{async \(v\) => qc\.setQueryData\(\['story-settings'\]/);
  assert.match(src, /async function saveStoryReplies[\s\S]*?catch \(e\)[\s\S]*?Alert\.alert/);
});

test('PersonRow (Mostrar, Desbloquear): um toque só e o erro é dito', () => {
  const row = sheets.slice(sheets.indexOf('export function PersonRow'), sheets.indexOf('/** Como te identificas'));
  assert.match(row, /if \(busy\) return;/);
  assert.match(row, /disabled=\{busy\}/);
  assert.match(row, /Alert\.alert\('Não deu'/);
});

test('Alterar senha: seguinte → seguinte → ir, e sem dois envios', () => {
  const pw = sheets.slice(sheets.indexOf('export function PasswordSheet'), sheets.indexOf('export function DeleteSheet'));
  assert.match(pw, /onSubmitEditing=\{\(\) => nextRef\.current\?\.focus\(\)\}/);
  assert.match(pw, /onSubmitEditing=\{\(\) => againRef\.current\?\.focus\(\)\}/);
  assert.match(pw, /returnKeyType="go" onSubmitEditing=\{\(\) => void submit\(\)\}/);
  assert.match(pw, /if \(busy \|\| !cur \|\| !next\) return;/);
});

test('Eliminar conta: o @ confirma-se com espaços à volta e não há segundo pedido', () => {
  const del = sheets.slice(sheets.indexOf('export function DeleteSheet'));
  assert.match(del, /confirm\.trim\(\)\.replace\(\/\^@\/, ''\)/);
  assert.match(del, /if \(busy \|\| !can\) return;/);
});
