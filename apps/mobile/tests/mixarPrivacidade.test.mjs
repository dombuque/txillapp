// Privacidade do Mixar (0179, docs/mixar-contrato.md «Privacidade (0179)»): as três opções em Definições › Privacidade ›
// Mixar (e na pesquisa das definições), o resumo da semana sem «Partilhar» quando o outro não deixa, e os textos.
// Correr em apps/mobile:  node --test tests/mixarPrivacidade.test.mjs
import { test } from 'node:test';
import './fixtures/alias.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(path.join(ROOT, 'src', ...p), 'utf8').replace(/\r\n/g, '\n');
const x = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'mixarControlo.ts')).href);

test('Privacidade › Mixar: os três interruptores, cada um com o seu campo, e só com um servidor que os manda', () => {
  const s = read('app', 'settings', 'privacidade.tsx');
  for (const [field, title] of [
    ['mixarPresence', 'Mostrar que estou a ver contigo'],
    ['mixarSuggestable', 'Aparecer nas sugestões de Mixar'],
    ['mixarWeekInclude', 'Deixar que o resumo da semana me inclua'],
  ]) {
    const re = new RegExp(String.raw`\{p\?\.${field} !== undefined \? <SettingRow anchor="${field}"[^\n]*title=\{t\('${title}'\)\}[^\n]*toggle=\{\{ on: p\.${field}, onChange: \(v\) => void save\(\{ ${field}: v \}\) \}\}`);
    assert.match(s, re, field);
  }
  // A secção aparece também sem os temas privados (servidor que só tem 0179).
  assert.match(s, /\{mixarPrivate\.data \|\| p\?\.mixarPresence !== undefined \? \(\n\s*<SettingsSection title="Mixar">/);
  const api = read('lib', 'api.ts');
  for (const f of ['mixarPresence', 'mixarSuggestable', 'mixarWeekInclude']) assert.match(api, new RegExp(String.raw`  ${f}\?: boolean;`));
});

test('a pesquisa das definições encontra as três opções do Mixar', () => {
  const idx = read('lib', 'settingsIndex.ts');
  for (const id of ['mixarPresence', 'mixarSuggestable', 'mixarWeekInclude']) assert.match(idx, new RegExp(String.raw`\{ id: '${id}', group: 'privacidade'`));
  assert.match(idx, /id: 'mixarPresence'[^\n]*t\('ver juntos'\)/);
  assert.match(idx, /id: 'mixarSuggestable'[^\n]*t\('faz um mixar com'\)/);
  assert.match(idx, /id: 'mixarWeekInclude'[^\n]*t\('resumo da semana do mixar'\)/);
});

test('resumo da semana: com shareable false não há botões, só a frase com o nome', () => {
  const c = read('components', 'mixar', 'MixarWeekCard.tsx');
  assert.match(c, /if \(blockedBy\) return <Text[^\n]*\{weekNotShareableText\(blockedBy\)\}<\/Text>;\n  return \(/);
  assert.equal((c.match(/blockedBy=\{w\.data\.shareable === false \? them\.name : null\}/g) ?? []).length, 2);
  assert.equal(x.weekNotShareableText('Ana'), 'Ana não deixa partilhar o resumo da semana do vosso Mixar. Continuam a vê-lo aqui.');
});

test('partilhar: o 403 do outro (code) tem o seu texto; o do email continua igual', () => {
  assert.equal(x.shareErrorText({ status: 403, code: 'mixar_week_not_shareable' }), 'A outra pessoa não deixa partilhar o resumo da semana do vosso Mixar.');
  assert.equal(x.shareErrorText({ status: 403 }), 'Confirma o teu email para partilhar.');
});
