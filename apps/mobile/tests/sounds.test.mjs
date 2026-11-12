// Testes dos sons das tchekas (src/lib/sounds.ts, src/lib/api.sounds.ts e os ecrãs): ids, ligações, textos, a definição
// «Deixar usar o meu som», a página /som/[id] e «Sons em alta» no Explorar.
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const s = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'sounds.ts')).href);
const read = (...p) => readFileSync(path.join(ROOT, 'src', ...p), 'utf8').replace(/\r\n/g, '\n');
const UUID = '0190d3c4-0000-7000-8000-000000000001';

test('os ids dos sons: uuid (original), cat:<faixa> e local:<uuid>; o resto não abre', () => {
  assert.equal(s.isSoundId(UUID), true);
  assert.equal(s.isSoundId('cat:ccmixter:16626'), true);
  assert.equal(s.isSoundId(`local:${UUID}`), true);
  assert.equal(s.isSoundId(`cat:local:${UUID}`), false);
  assert.equal(s.isSoundId('../etc/passwd'), false);
  assert.equal(s.isSoundId(''), false);
  assert.equal(s.isSoundId(null), false);
});

test('o som de uma faixa do seletor: catálogo, artistas, som original; clipes e licenciadas não têm', () => {
  assert.equal(s.soundIdOfTrack({ id: 'ccmixter:1', source: 'ccmixter' }), 'cat:ccmixter:1');
  assert.equal(s.soundIdOfTrack({ id: `local:${UUID}`, source: 'local' }), `local:${UUID}`);
  assert.equal(s.soundIdOfTrack({ id: UUID, source: 'local' }), `local:${UUID}`);
  assert.equal(s.soundIdOfTrack({ id: `sound:${UUID}`, kind: 'sound', soundId: UUID }), UUID);
  assert.equal(s.soundIdOfTrack({ id: `clip:${UUID}`, kind: 'clip' }), null);
  assert.equal(s.soundIdOfTrack({ id: 'x', kind: 'licensed' }), null);
  assert.equal(s.soundIdOfTrack(null), null);
});

test('as ligações: a página do som e o estúdio com o som escolhido', () => {
  assert.equal(s.soundHref('cat:ccmixter:1'), '/som/cat%3Accmixter%3A1');
  assert.equal(s.studioHref(UUID), `/tcheka/nova?som=${UUID}`);
  assert.equal(s.studioHref('cat:a:b'), '/tcheka/nova?som=cat%3Aa%3Ab');
});

test('os textos: usos à portuguesa, a linha do som, porque não se pode usar', () => {
  assert.equal(s.usesLine(0), 'Ainda sem tchekas');
  assert.equal(s.usesLine(1), '1 tcheka');
  assert.equal(s.usesLine(1250), '1,2 mil tchekas');
  assert.equal(s.usesLine(4_400_000), '4,4 M tchekas');
  assert.equal(s.soundMeta({ kind: 'original', author: { displayName: 'Ana' }, durationMs: 15_000 }), 'Ana · 0:15');
  assert.equal(s.soundMeta({ kind: 'catalog', artist: 'Artista', durationMs: 173_000 }), 'Artista · 2:53');
  assert.equal(s.soundMeta({ kind: 'catalog', durationMs: null }), '');
  assert.equal(s.postSoundLine({ title: 'Som original · @ana', kind: 'original' }), '♪ Som original · @ana');
  assert.equal(s.postSoundLine({ title: 'Xitende', kind: 'local', artist: 'Mano' }), '♪ Xitende · Mano');
  assert.equal(s.postSoundLine(null), '');
  assert.match(s.unavailableText('held'), /em análise/);
  assert.match(s.unavailableText('off'), /não deixa/);
  assert.match(s.unavailableText('private'), /conta privada/);
  assert.equal(s.unavailableText(undefined), null);
});

test('a grelha junta as páginas sem repetir tchekas', () => {
  assert.deepEqual(s.mergePages([{ items: [{ id: 'a' }, { id: 'b' }] }, { items: [{ id: 'b' }, { id: 'c' }] }]).map((x) => x.id), ['a', 'b', 'c']);
  assert.deepEqual(s.mergePages(undefined), []);
});

test('«Deixar usar o meu som»: ligado por omissão; numa conta privada ou de menor fica desligado e não se muda', () => {
  assert.deepEqual(s.reuseSetting({ reuse: true, effective: true, private: false, minor: false }).on, true);
  assert.equal(s.reuseSetting({ reuse: false, effective: false, private: false, minor: false }).on, false);
  const priv = s.reuseSetting({ reuse: true, effective: false, private: true, minor: false });
  assert.equal(priv.on, false);
  assert.equal(priv.disabled, true);
  assert.match(priv.description, /privada/);
  assert.equal(s.reuseSetting({ reuse: true, effective: false, private: false, minor: true }).disabled, true);
  assert.equal(s.reuseSetting(null).disabled, true);
});

test('o cliente fala com o contrato: /sounds/:id, /tchekas, /trending, /report e as definições', () => {
  const api = read('lib', 'api.sounds.ts');
  for (const p of ['/sounds/me/settings', '/sounds/trending', '/tchekas?sort=', '/report']) assert.ok(api.includes(p), p);
  assert.match(api, /encodeURIComponent\(id\)/);
  assert.match(read('lib', 'api.ts'), /sound\?: import\('\.\/api\.sounds'\)\.PostSound \| null/);
});

test('a página do som: capa, título, autor com o selo, usos, ouvir, «Usar este som» e a grelha', () => {
  const page = read('app', 'som', '[id].tsx');
  assert.match(page, /Usar este som/);
  assert.match(page, /studioHref\(s\.id\)/);
  assert.match(page, /NameWithBadge/);
  assert.match(page, /usesLine\(s\.uses\)/);
  assert.match(page, /playTrack\(/);
  assert.match(page, /stopTrack\(/);
  assert.match(page, /Mais vistas/);
  assert.match(page, /Recentes/);
  assert.match(page, /Tem música protegida/);
  assert.match(page, /disabled=\{!s\.canUse\}/);
  assert.match(read('app', '_layout.tsx'), /name="som\/\[id\]"/);
});

test('«Sons em alta» no Explorar e a definição em Conteúdo', () => {
  assert.match(read('app', 'search.tsx'), /<TrendingSounds \/>/);
  assert.match(read('components', 'TrendingSounds.tsx'), /Sons em alta/);
  const settings = read('app', 'settings', 'conteudo.tsx');
  assert.match(settings, /anchor="soundReuse"/);
  assert.match(settings, /Deixar usar o meu som/);
  assert.match(read('lib', 'settingsIndex.ts'), /id: 'soundReuse', group: 'conteudo'/);
});
