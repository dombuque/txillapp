// Testes das regras e textos do "À tua volta" (src/lib/nearbyView.ts): que tipos se pedem, o que cada filtro mostra,
// datas dos eventos, estados vazios, problemas de localização e erros ao carregar.
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const v = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'nearbyView.ts')).href);
const RADII = [5, 10, 20, 30];

test('kindsToFetch: pede tudo de uma vez (trocar de filtro não volta a pedir); só eventos quando o "quando" não é hoje', () => {
  for (const f of ['all', 'venues', 'events', 'people', 'posts', 'groups']) assert.deepEqual(v.kindsToFetch(f, 'today'), v.ALL_KINDS);
  assert.deepEqual(v.kindsToFetch('events', 'week'), ['events']);
  assert.deepEqual(v.kindsToFetch('events', 'now'), ['events']);
  assert.deepEqual(v.ALL_KINDS.slice().sort(), ['events', 'groups', 'people', 'posts', 'venues']);
});

test('shownKinds: cada filtro mostra só o seu tipo; "Tudo" mostra os cinco', () => {
  assert.deepEqual([...v.shownKinds('all')].sort(), ['event', 'group', 'person', 'post', 'venue']);
  assert.deepEqual([...v.shownKinds('people')], ['person']);
  assert.deepEqual([...v.shownKinds('venues')], ['venue']);
  assert.deepEqual([...v.shownKinds('events')], ['event']);
  assert.deepEqual([...v.shownKinds('posts')], ['post']);
  assert.deepEqual([...v.shownKinds('groups')], ['group']);
});

test('kmLabel: metros abaixo de 1 km (de 50 em 50, mínimo 50 m) e km com vírgula', () => {
  assert.equal(v.kmLabel(0), 'a 50 m');
  assert.equal(v.kmLabel(0.32), 'a 300 m');
  assert.equal(v.kmLabel(0.98), 'a 1 km');
  assert.equal(v.kmLabel(0.97), 'a 950 m');
  assert.equal(v.kmLabel(1), 'a 1 km');
  assert.equal(v.kmLabel(2.35), 'a 2,4 km');
});

test('eventWhen: sem hora de fim conta como a decorrer durante 4 h (como no servidor)', () => {
  const now = new Date(2026, 10, 14, 22, 0);
  const at = (h, m = 0, d = 14) => new Date(2026, 10, d, h, m).toISOString();
  assert.equal(v.eventWhen(at(21), null, now), 'A decorrer · 21:00');
  assert.equal(v.eventWhen(at(17), null, now), 'Hoje · 17:00'); // acabou às 21:00
  assert.equal(v.eventWhen(at(21), at(23), now), 'A decorrer · 21:00 até 23:00');
  assert.equal(v.eventWhen(at(20), at(21), now), 'Hoje · 20:00 até 21:00');
  assert.equal(v.eventWhen(at(23), null, now), 'Hoje · 23:00');
  assert.equal(v.eventWhen(at(18, 30, 15), null, now), 'Amanhã · 18:30');
  assert.equal(v.eventWhen(at(22, 0, 21), null, now), 'sáb, 21 nov · 22:00');
  assert.equal(v.eventWhen('lixo', null, now), '');
  // Fim inválido: ignora-se (e usa-se a regra das 4 h).
  assert.equal(v.eventWhen(at(21), 'lixo', now), 'A decorrer · 21:00');
});

test('emptyHint: a malta explica porque está vazio (e os menores sabem que é só a partir dos 18)', () => {
  const p = v.emptyHint({ filter: 'people', when: 'today', radius: 10, radii: RADII, canEnable: true });
  assert.equal(p.title, 'Ninguém da malta por perto');
  assert.match(p.sub, /Aparecer em À tua volta/);
  assert.match(p.sub, /3 horas/);
  assert.deepEqual(p.action, { label: 'Ver até 20 km', radius: 20 });
  const m = v.emptyHint({ filter: 'people', when: 'today', radius: 10, radii: RADII, canEnable: false });
  assert.equal(m.title, 'Só a partir dos 18 anos');
  assert.equal(m.action, undefined);
});

test('emptyHint: eventos de hoje ou a decorrer sugerem a semana; na semana sugere ver mais longe', () => {
  const t = v.emptyHint({ filter: 'events', when: 'today', radius: 10, radii: RADII, canEnable: true });
  assert.equal(t.title, 'Sem eventos hoje por perto');
  assert.deepEqual(t.action, { label: 'Ver esta semana', when: 'week' });
  assert.equal(v.emptyHint({ filter: 'events', when: 'now', radius: 10, radii: RADII, canEnable: true }).title, 'Nenhum evento a decorrer por perto');
  const w = v.emptyHint({ filter: 'events', when: 'week', radius: 30, radii: RADII, canEnable: true });
  assert.equal(w.title, 'Sem eventos esta semana por perto');
  assert.equal(w.action, undefined); // já no raio maior
});

test('emptyHint: no raio maior não há botão de "ver mais longe" e o texto não o sugere', () => {
  for (const filter of ['all', 'venues', 'posts', 'groups', 'people']) {
    const h = v.emptyHint({ filter, when: 'today', radius: 30, radii: RADII, canEnable: true });
    assert.equal(h.action, undefined, filter);
    assert.doesNotMatch(h.sub, /mais longe/, filter);
  }
  assert.equal(v.emptyHint({ filter: 'all', when: 'today', radius: 5, radii: RADII, canEnable: true }).action.radius, 10);
  assert.equal(v.emptyHint({ filter: 'posts', when: 'today', radius: 5, radii: RADII, canEnable: true }).title, 'Sem publicações por perto');
});

test('locateProblemText: "Abrir definições" só na app e só quando está bloqueado; no browser recusar = bloquear', () => {
  assert.equal(v.locateProblemText('blocked', false).settings, true);
  assert.equal(v.locateProblemText('blocked', true).settings, false);
  assert.match(v.locateProblemText('blocked', true).text, /cadeado/);
  assert.match(v.locateProblemText('denied', true).text, /cadeado/);
  assert.equal(v.locateProblemText('denied', false).settings, false);
  assert.match(v.locateProblemText('off', false).text, /Liga a localização/);
  assert.match(v.locateProblemText('failed', false).text, /Não consegui saber onde estás/);
  for (const p of ['blocked', 'denied', 'off', 'failed']) assert.match(v.locateProblemText(p, false).text, /cidade/);
});

test('loadErrorText: sem rede, demasiados pedidos ou erro do servidor', () => {
  assert.match(v.loadErrorText(null), /sem ligação/);
  assert.match(v.loadErrorText(0), /sem ligação/);
  assert.match(v.loadErrorText(429), /muitas procuras/);
  assert.match(v.loadErrorText(500), /nosso lado/);
});
