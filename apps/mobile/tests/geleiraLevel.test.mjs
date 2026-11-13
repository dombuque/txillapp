// Testes do «Como subo?» do nível da geleira (src/lib/geleiraLevel.ts).
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const L = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'geleiraLevel.ts')).href);

const detail = (o = {}) => ({
  days: 90,
  geladas: { points: 8, paid: 2, received: 1 },
  brindes: { points: 3, people: 3 },
  sitios: { points: 4, places: 2, visits: 2 },
  rodadas: { points: 3, joined: 1, paid: 1 },
  gostos: { points: 5, max: 8, groups: 3, rated: 4 },
  people: 5,
  weeks: 4,
  needs: { points: 17, people: 0, weeks: 0 },
  falling: false,
  ...o,
});

test('levelRows: as cinco origens pela ordem, com ícone, pontos e nota', () => {
  const rows = L.levelRows(detail());
  assert.deepEqual(rows.map((r) => [r.key, r.icon, r.points]), [['geladas', 'soda', 8], ['brindes', 'cheers', 3], ['sitios', 'map-pin', 4], ['rodadas', 'users', 3], ['gostos', 'snowflake', 5]]);
  assert.equal(rows[0].note, '2 pagas · 1 recebida');
  assert.equal(rows[1].note, 'de 3 amigos');
  assert.equal(rows[2].note, '2 locais · 2 check-ins');
  assert.equal(rows[3].note, '1 entrada · 1 paga');
  assert.equal(rows[4].note, '3 grupos · 4 com nota (máx. 8)');
});

test('levelRows: sem nada ainda, a nota diz como começar; lixo vira 0', () => {
  const rows = L.levelRows(detail({ geladas: { points: 0, paid: 0, received: 0 }, brindes: { points: 'x', people: -1 }, sitios: { points: 0, places: 0, visits: 0 }, rodadas: { points: 0, joined: 0, paid: 0 } }));
  assert.match(rows[0].note, /Paga ou recebe/);
  assert.equal(rows[1].points, 0);
  assert.match(rows[1].note, /amigos que te seguem/);
  assert.match(rows[2].note, /QR/);
  assert.match(rows[3].note, /rodada/);
});

test('levelBar: a do servidor; sem ela, pelos pontos dentro do nível', () => {
  assert.equal(L.levelBar(undefined), 0);
  assert.equal(L.levelBar({ level: 1, points: 20, progress: 0.3 }), 0.3);
  assert.equal(L.levelBar({ level: 1, points: 20, progress: 7 }), 1);
  assert.equal(L.levelBar({ level: 2, points: 70 }), 0.5);
  assert.equal(L.levelBar({ level: 4, points: 999 }), 1);
});

test('stepNeeds e needsText', () => {
  assert.equal(L.stepNeeds(0), '0 pontos');
  assert.equal(L.stepNeeds(1), '1+ pontos');
  assert.equal(L.stepNeeds(3), '100+ pontos · 5 pessoas · 6 semanas');
  assert.equal(L.needsText(null), null);
  assert.equal(L.needsText({ points: 0, people: 0, weeks: 0 }), null);
  assert.equal(L.needsText({ points: 6, people: 2, weeks: 0 }), 'Faltam 6 pontos e 2 pessoas');
  assert.equal(L.needsText({ points: 1, people: 0, weeks: 0 }), 'Falta 1 ponto');
});

test('a regra diz que o álcool e os Txills não contam', () => {
  assert.match(L.LEVEL_RULES, /álcool não conta/);
  assert.match(L.LEVEL_RULES, /Txills também não/);
  assert.match(L.LEVEL_RULES, /90 dias/);
});

test('a frase antiga («Bebidas com álcool e vibes de festa valem mais») já não existe em lado nenhum da app', () => {
  const hits = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name) && /vibes de festa valem mais|valem mais/.test(fs.readFileSync(p, 'utf8'))) hits.push(path.relative(ROOT, p));
    }
  };
  walk(path.join(ROOT, 'src'));
  assert.deepEqual(hits, []);
});
