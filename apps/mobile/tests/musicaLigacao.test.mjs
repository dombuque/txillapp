// Música por ligação (Spotify, YouTube, Audiomack, Boomplay, Deezer, Apple Music): o cartão com o leitor oficial.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const m = await import(new URL('../src/lib/musicLink.ts', import.meta.url).href);
const read = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

test('reconhece as ligações das plataformas enquanto se cola', () => {
  for (const u of ['https://open.spotify.com/track/abc', 'https://youtu.be/xyz', 'https://www.youtube.com/watch?v=x', 'https://music.youtube.com/watch?v=x', 'https://audiomack.com/a/song/b', 'https://www.boomplay.com/songs/1', 'https://www.deezer.com/track/1', 'https://music.apple.com/pt/album/x/1']) assert.equal(m.looksLikeMusicLink(u), true, u);
  for (const u of ['amapiano', 'https://evil.example/track', 'spotify']) assert.equal(m.looksLikeMusicLink(u), false, u);
  assert.equal(m.providerName('spotify'), 'Spotify');
  assert.equal(m.isLinkMusic({ kind: 'link' }), true);
  assert.equal(m.isLinkMusic({ kind: 'clip' }), false);
  assert.equal(m.linkPlayerHeight('youtube', 'video', 320), 180);
  assert.equal(m.linkPlayerHeight('spotify', 'track', 320), 152);
});

test('envia só a ligação; o cartão aparece onde a música aparece; o seletor só deixa colar em notas, mimos e publicações sem vídeo', () => {
  assert.match(read('lib/api.music.ts'), /if \(t\.kind === 'link'\) return \{ kind: 'link' as const, url: t\.link \?\? t\.landing \?\? '' \};/);
  assert.match(read('components/PostMusic.tsx'), /isLinkMusic\(p\.track\) \? <MusicLinkCard track=\{p\.track\} pill dark \/> : <MusicBadgeAudio/);
  assert.match(read('app/stories/[username].tsx'), /isLinkMusic\(p\.track\) \? <MusicLinkCard/);
  assert.match(read('components/Notes.tsx'), /<MusicPicker hint=\{body\} allowLink/);
  assert.match(read('app/(tabs)/new.tsx'), /allowLink=\{!assets\.some\(\(a\) => a\.video\)\}/);
  assert.match(read('components/MusicPicker.tsx'), /const pastedLink = allowLink && looksLikeMusicLink\(term\) \? term\.trim\(\) : '';/);
});
