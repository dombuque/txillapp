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
  assert.match(read('app/stories/[username].tsx'), /isLinkMusic\(tr\) \? <MusicLinkCard track=\{tr\} pill dark \/>/);
  assert.match(read('components/Notes.tsx'), /<MusicPicker hint=\{body\} allowLink/);
  assert.match(read('app/(tabs)/new.tsx'), /allowLink=\{!assets\.some\(\(a\) => a\.video\)\}/);
  assert.match(read('components/MusicPicker.tsx'), /const pastedLink = allowLink && looksLikeMusicLink\(term\) \? term\.trim\(\) : '';/);
});

test('o seletor: botão «Colar» no campo (sem frase a explicar); só aceita ligações de música', () => {
  const p = read('components/MusicPicker.tsx');
  assert.match(p, /const text = \(await Clipboard\.getStringAsync\(\)\)\.trim\(\);/);
  assert.match(p, /if \(looksLikeMusicLink\(text\)\) \{ setErr\(''\); setTerm\(text\); \}/);
  assert.doesNotMatch(p, /Também podes colar a ligação/);
});

test('mimo com música do Spotify: o leitor compacto oficial toca sozinho e pára com o mimo', () => {
  assert.equal(m.spotifyUri('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC'), 'spotify:track:4uLU6hMCjMI75M1A2tKUQC');
  assert.equal(m.spotifyUri('https://evil.example/track/x'), null);
  const p = read('components/SpotifyAutoPlayer.tsx');
  assert.match(p, /c\.addListener\('ready',function\(\)\{c\.play\(\);\}\);/);
  assert.match(p, /mediaPlaybackRequiresUserAction=\{false\}/);
  assert.match(p, /window\.tx && window\.tx\.pause\(\)/);
  assert.match(read('app/stories/[username].tsx'), /tr\.provider === 'spotify' && tr\.link && tr\.embedUrl\) return <SpotifyAutoPlayer/);
});

test('as usadas recentemente (neste aparelho) e as guardadas; os seguidores guardam e copiam', async () => {
  const r = await import(new URL('../src/lib/musicLinkRecentRules.ts', import.meta.url).href);
  const a = { id: 'link:spotify:a', kind: 'link' }; const b = { id: 'link:youtube:b', kind: 'link' };
  assert.deepEqual(r.pushRecentLink([a], b).map((x) => x.id), ['link:youtube:b', 'link:spotify:a']);
  assert.deepEqual(r.pushRecentLink([a, b], b).map((x) => x.id), ['link:youtube:b', 'link:spotify:a']);
  assert.equal(r.pushRecentLink(Array.from({ length: 20 }, (_, i) => ({ id: `link:x:${i}`, kind: 'link' })), a).length, r.RECENT_LINKS_MAX);
  assert.deepEqual(r.readRecentLinks('lixo'), []);
  assert.deepEqual(r.readRecentLinks(JSON.stringify([{ id: 'x', kind: 'music' }, a])), [a]);
  const p = read('components/MusicPicker.tsx');
  assert.match(p, /if \(isLinkMusic\(t\)\) void rememberLink\(t\);/);
  assert.match(p, /\{t\('Usadas recentemente'\)\}/);
  assert.match(p, /if \(isLinkMusic\(track\)\) return pick\(track\);/);
  const l = read('components/MusicLink.tsx');
  assert.match(l, /saved \? musicApi\.removeFavorite\(track\.id\) : musicApi\.addFavorite\(track\)/);
  assert.match(l, /Clipboard\.setStringAsync\(track\.link \?\? track\.landing \?\? ''\)/);
});
