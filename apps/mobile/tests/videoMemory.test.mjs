// Testes da memória dos vídeos (src/lib/videoMemory.ts). No Android a app fechava com OutOfMemoryError parada no Início:
// o feed montava uma dúzia de leitores do expo-video, cada um a guardar até 50 s de vídeo no heap Java (os valores do
// media3, sem `bufferOptions`). Agora só o vídeo à vista tem leitor e todos os leitores têm um teto de memória.
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const v = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'videoMemory.ts')).href);
const src = (p) => readFileSync(path.join(ROOT, 'src', ...p.split('/')), 'utf8');
const MB = 1024 * 1024;

test('todos os perfis têm teto de bytes e de tempo, e o teto de bytes ganha', () => {
  for (const [k, o] of Object.entries(v.VIDEO_BUFFER)) {
    assert.ok(o.maxBufferBytes > 0 && o.maxBufferBytes <= 24 * MB, `${k}: teto de bytes`);
    assert.ok(o.preferredForwardBufferDuration > 0 && o.preferredForwardBufferDuration <= 20, `${k}: segundos à frente`);
    assert.ok(o.minBufferForPlayback <= o.preferredForwardBufferDuration, `${k}: arranque cabe no buffer`);
    assert.equal(o.prioritizeTimeOverSizeThreshold, false, `${k}: o tempo não pode passar por cima do teto`);
  }
  // O feed e as conversas podem ter vários leitores ao mesmo tempo: tetos pequenos.
  assert.ok(v.VIDEO_BUFFER.feed.maxBufferBytes <= 8 * MB);
  assert.ok(v.VIDEO_BUFFER.chat.maxBufferBytes <= 8 * MB);
  // A lista das tchekas tem até 3 montadas: 3 × teto bem abaixo do heap de 192 MB.
  assert.ok(3 * v.VIDEO_BUFFER.reel.maxBufferBytes <= 48 * MB);
});

test('limitBuffer põe uma cópia do perfil no leitor e não rebenta com um leitor libertado', () => {
  const p = {};
  v.limitBuffer(p, 'feed');
  assert.deepEqual(p.bufferOptions, v.VIDEO_BUFFER.feed);
  assert.notEqual(p.bufferOptions, v.VIDEO_BUFFER.feed, 'cópia, não o objeto partilhado');
  const dead = { set bufferOptions(_) { throw new Error('NativeSharedObjectNotFoundException'); } };
  assert.doesNotThrow(() => v.limitBuffer(dead, 'reel'));
});

test('no feed só o vídeo à vista e em cena no carrossel tem leitor', () => {
  assert.equal(v.feedVideoLive({ active: true, inView: true }), true);
  assert.equal(v.feedVideoLive({ active: false, inView: true }), false, 'outra foto do carrossel');
  assert.equal(v.feedVideoLive({ active: true, inView: false }), false, 'post fora do ecrã (ou outro separador)');
  assert.equal(v.feedVideoLive({ active: false, inView: false }), false);
});

test('CarouselVideo: o leitor só se cria no componente vivo; o parado mostra só a capa', () => {
  const s = src('components/CarouselVideo.tsx');
  assert.match(s, /feedVideoLive\(props\) \? <NativeVideoLive \{\.\.\.props\} \/> : <NativeVideoIdle \{\.\.\.props\} \/>/);
  const idle = s.slice(s.indexOf('function NativeVideoIdle'), s.indexOf('function NativeVideoLive'));
  assert.ok(idle.length > 0);
  assert.doesNotMatch(idle, /useVideoPlayer|VideoView/, 'sem leitor fora de vista');
  const live = s.slice(s.indexOf('function NativeVideoLive'));
  assert.match(live, /useVideoPlayer\(src, \(p\) => \{ limitBuffer\(p, 'feed'\);/);
});

test('conversa: o vídeo da bolha só cria o leitor depois do toque', () => {
  const s = src('components/ChatBubbles.tsx');
  assert.match(s, /autoPlay \? <NativeChatVideo url=\{url\} autoPlay inModal=\{inModal\} \/> : <LazyChatVideo url=\{url\} inModal=\{inModal\} \/>/);
  const lazy = s.slice(s.indexOf('function LazyChatVideo'), s.indexOf('function NativeChatVideo'));
  assert.match(lazy, /if \(on\) return <NativeChatVideo/);
  assert.doesNotMatch(lazy.replace(/<NativeChatVideo[^>]*>/, ''), /useVideoPlayer/);
});

test('cada useVideoPlayer da app põe um teto de memória logo no setup', () => {
  const files = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = path.join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(f)) files.push(p);
    }
  };
  walk(path.join(ROOT, 'src'));
  let n = 0;
  for (const f of files) {
    const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(/useVideoPlayer\(([^\n]*)/g)) {
      if (/^\s*$/.test(m[1]) || m[1].startsWith('source')) continue;
      n++;
      // O setup pode continuar na linha seguinte (reels.tsx).
      const at = s.indexOf(m[0]);
      const head = s.slice(at, at + 200);
      assert.match(head, /limitBuffer\((p|x), ('(feed|reel|chat|full)'|inModal \? 'full' : 'chat')\)/, path.relative(ROOT, f));
    }
  }
  assert.ok(n >= 8, `encontrou ${n} leitores`);
});

test('carrossel no telemóvel: só a foto à vista e as vizinhas ficam montadas (bitmaps no heap nativo)', async () => {
  const li = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'listImage.ts')).href);
  const w = li.carouselWindowProps('android');
  assert.ok(w.windowSize <= 3 && w.initialNumToRender <= 2 && w.maxToRenderPerBatch <= 2);
  assert.deepEqual(li.carouselWindowProps('ios'), w);
  assert.deepEqual(li.carouselWindowProps('web'), {}, 'na web fica como estava');
  const s = src('components/PostCard.tsx');
  assert.match(s, /getItemLayout=\{\(_, index\) => \(\{ length: width, offset: width \* index, index \}\)\}\s*\{\.\.\.carouselWindowProps\(Platform\.OS\)\}/);
});

test('tchekas: só a que está em cena e as vizinhas têm o Reel (e o leitor) montado', () => {
  assert.equal(v.reelMounted(5, 5), true);
  assert.equal(v.reelMounted(4, 5), true);
  assert.equal(v.reelMounted(6, 5), true);
  assert.equal(v.reelMounted(3, 5), false);
  assert.equal(v.reelMounted(7, 5), false);
  for (const f of ['app/(tabs)/reels.tsx', 'app/r/[id].tsx', 'components/ExploreViewer.tsx']) {
    const s = src(f);
    assert.match(s, /reelMounted\(index, active\)\s*\?\s*<Reel /, f);
    assert.match(s, /extraData=\{`[^`]*\$\{active\}/, `${f}: a lista volta a desenhar quando muda a ativa`);
  }
});
