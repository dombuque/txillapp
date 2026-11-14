// Testes do fim de tcheka na app:
// - a música gravada no vídeo (`musicBaked`): o vídeo toca com o som dele e a música não toca outra vez por cima
//   (src/lib/musicLook.ts, musicPlayback, usado pelo PostCard e pelo selo da música);
// - guardar a tcheka com a assinatura e o cartão do fim (src/lib/tchekaDownload.ts, GET /posts/:id/download), no menu ⋯ e
//   na folha de partilha;
// - o estúdio avisa a API de que a música já vai no vídeo (`musicInFile`), para não ficar a dobrar.
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const look = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'musicLook.ts')).href);
const dl = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'tchekaDownload.ts')).href);
const read = (...f) => readFileSync(path.join(ROOT, 'src', ...f), 'utf8').replace(/\r\n/g, '\n');

const track = { id: 'ccmixter:1', title: 'Batida', artist: 'Teste', url: '/a.mp3' };

test('música à parte: só sem musicBaked (o vídeo fica calado e a música toca no leitor da app)', () => {
  assert.deepEqual(look.musicPlayback({ music: track }), { apart: true, muteVideo: true });
  assert.deepEqual(look.musicPlayback({ music: track, musicBaked: false }), { apart: true, muteVideo: true });
});

test('música gravada no vídeo: o vídeo toca com o som dele e a música não toca outra vez', () => {
  assert.deepEqual(look.musicPlayback({ music: track, musicBaked: true }), { apart: false, muteVideo: false });
  // Um som retirado cala o vídeo na mesma.
  assert.deepEqual(look.musicPlayback({ music: track, musicBaked: true, soundRemoved: 'rights' }), { apart: false, muteVideo: true });
});

test('sem música, ou num dueto/resposta: nada toca à parte', () => {
  assert.deepEqual(look.musicPlayback({}), { apart: false, muteVideo: false });
  assert.deepEqual(look.musicPlayback({ music: null, musicBaked: true }), { apart: false, muteVideo: false });
  assert.deepEqual(look.musicPlayback({ music: track, remixOf: { kind: 'duet' } }), { apart: false, muteVideo: false });
});

test('PostCard: o vídeo e o selo seguem musicPlayback (o selo com a música gravada é só o crédito)', () => {
  const card = read('components', 'PostCard.tsx');
  assert.match(card, /mute=\{musicPlayback\(post\)\.muteVideo\}/);
  assert.match(card, /play=\{musicPlayback\(post\)\.apart\}/);
  assert.doesNotMatch(card, /mute=\{\(!!post\.music && !post\.remixOf\)/);
  const badge = read('components', 'PostMusic.tsx');
  assert.match(badge, /export function MusicBadge\(\{ track, visible, waves = false, play = true, soundTo = null \}/);
  assert.match(badge, /if \(!play\) return <MusicCredit/);
  // O crédito não chama o leitor de música (nada de useAutoTrack nele).
  const credit = badge.slice(badge.indexOf('function MusicCredit'), badge.indexOf('function MusicBadgePlaying'));
  assert.ok(credit.length > 100);
  assert.doesNotMatch(credit, /useAutoTrack|playTrack/);
});

test('o tipo Post traz musicBaked (opcional: servidores antigos não mandam)', () => {
  assert.match(read('lib', 'api.ts'), /\n  musicBaked\?: boolean;/);
});

test('guardar: só publicações com vídeo; um repost simples guarda o original', () => {
  const tcheka = { id: 'p1', code: 'Ab3xK9q', kind: 'post', media: [{ kind: 'video' }] };
  const fotos = { id: 'p2', code: 'Zz', kind: 'post', media: [{ kind: 'image' }] };
  const carrossel = { id: 'p3', kind: 'post', media: [{ kind: 'image' }, { kind: 'video' }] };
  assert.equal(dl.canDownload(tcheka), true);
  assert.equal(dl.canDownload(fotos), false);
  assert.equal(dl.canDownload(carrossel), true);
  assert.equal(dl.canDownload({ id: 't', kind: 'post', media: [] }), false);
  assert.equal(dl.canDownload(null), false);
  const repost = { id: 'r1', kind: 'repost', media: [], repostOf: tcheka };
  assert.equal(dl.downloadTarget(repost), tcheka);
  assert.equal(dl.downloadPath(tcheka), '/posts/p1/download');
  assert.equal(dl.downloadName(tcheka), 'txillapp-tcheka-Ab3xK9q.mp4');
  assert.equal(dl.downloadName({ id: '../x?y', media: [] }), 'txillapp-tcheka-xy.mp4');
});

test('o menu ⋯ e a folha de partilha têm «Guardar o vídeo» (no site «Descarregar») pelo endpoint novo', () => {
  const menu = read('components', 'PostSheets.tsx');
  assert.match(menu, /canDownload\(post\) \? <MenuRow icon=\{<Icon name="download"/);
  assert.match(menu, /await saveTcheka\(post\)/);
  const share = read('components', 'ShareSheet.tsx');
  assert.match(share, /canDownload\(post\) \? action\('download'/);
  assert.match(share, /await saveTcheka\(post\)/);
  const save = read('lib', 'saveTcheka.ts');
  assert.match(save, /saveToGallery\(downloadPath\(t\), downloadName\(t\)\)/);
  // No telemóvel vai para a galeria; no site, saveToGallery.web descarrega (ou abre a partilha do sistema).
  assert.match(read('lib', 'saveToGallery.ts'), /MediaLibrary\.saveToLibraryAsync/);
  assert.match(read('lib', 'saveToGallery.web.ts'), /a\.download = name/);
});

test('o estúdio diz à API que a música já vai no vídeo (musicInFile)', () => {
  const n = read('app', '(tabs)', 'new.tsx');
  assert.match(n, /\(sp\.music \|\| sp\.soundId\) && assets\.some\(\(a\) => a\.studio\) \? \{ musicInFile: true \}/);
  assert.match(read('lib', 'api.compose.ts'), /musicInFile\?: boolean/);
});
