// «Poupar megas» (lib/dataSaverRules): fotos mais leves, vídeos do feed só ao toque e sem pré-descargas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const r = await import(new URL('../src/lib/dataSaverRules.ts', import.meta.url).href);
const read = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

test('o modo: desligado, só nos dados móveis (ou «Poupar dados» do browser) e sempre', () => {
  const wifi = { cellular: false, saveData: false };
  const cell = { cellular: true, saveData: false };
  assert.equal(r.saverActive('off', cell), false);
  assert.equal(r.saverActive('mobile', wifi), false);
  assert.equal(r.saverActive('mobile', cell), true);
  assert.equal(r.saverActive('mobile', { cellular: false, saveData: true }), true);
  assert.equal(r.saverActive('always', wifi), true);
  assert.equal(r.readMode('lixo'), 'off');
  assert.equal(r.readMode('mobile'), 'mobile');
});

test('as larguras das fotos: até 480 nos cartões, até 720 no ecrã inteiro, nunca maiores', () => {
  assert.equal(r.savedWidth(1600), 720);
  assert.equal(r.savedWidth(1080), 720);
  assert.equal(r.savedWidth(720), 480);
  assert.equal(r.savedWidth(480), 480);
  assert.equal(r.savedWidth(256), 256);
});

test('o aviso dos dados móveis: uma só vez, com o modo desligado', () => {
  assert.equal(r.shouldHintSaver('off', { cellular: true, saveData: false }, false), true);
  assert.equal(r.shouldHintSaver('off', { cellular: true, saveData: false }, true), false);
  assert.equal(r.shouldHintSaver('mobile', { cellular: true, saveData: false }, false), false);
  assert.equal(r.shouldHintSaver('off', { cellular: false, saveData: false }, false), false);
});

test('a app usa o modo: sized(), vídeos do feed, tchekas vizinhas, mimo seguinte e Definições', () => {
  assert.match(read('lib/config.ts'), /const w = isSaving\(\) \? savedWidth\(width\) : width;/);
  const v = read('components/CarouselVideo.tsx');
  assert.match(v, /if \(saving && !viewer && tapped !== src\) \{/);
  assert.match(read('app/(tabs)/reels.tsx'), /useVideoPlayer\(saving && !active \? null : abs\(m\.url\) \?\? ''/);
  assert.match(read('app/stories/[username].tsx'), /first\.mediaKind !== 'video' && !isSaving\(\)/);
  assert.match(read('app/settings/conteudo.tsx'), /anchor="dataSaver"/);
  assert.match(read('app/_layout.tsx'), /^startDataSaver\(\);/m);
});
