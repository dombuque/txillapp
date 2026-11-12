// Testes do programa de artistas moçambicanos (src/lib/artists.ts e a ligação nos ecrãs): estados, trecho, ligações,
// «♪ Título · Artista», o que vai para o servidor e os avisos da equipa.
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const a = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'artists.ts')).href);
const read = (...p) => readFileSync(path.join(ROOT, 'src', ...p), 'utf8');

test('o estado do pedido de artista, numa frase', () => {
  assert.equal(a.artistStatusText(null).title, 'Sou artista');
  assert.equal(a.artistStatusText('pending').title, 'Pedido em análise');
  assert.match(a.artistStatusText('approved').sub, /etiqueta «Artista»/);
  assert.match(a.artistStatusText('revoked').sub, /suporte@txillapp\.com/);
});

test('o estado de uma faixa: a denúncia de direitos passa à frente (menos se já foi tirada)', () => {
  assert.deepEqual(a.trackStatusLabel('approved'), { label: 'Disponível', tone: 'green' });
  assert.deepEqual(a.trackStatusLabel('approved', true), { label: 'Escondida por denúncia', tone: 'red' });
  assert.equal(a.trackStatusLabel('removed', true).label, 'Tirada pela equipa');
  assert.equal(a.trackStatusLabel('withdrawn').label, 'Retirada');
  assert.equal(a.trackStatusLabel('pending').label, 'Em análise');
});

test('«♪ Título · Artista» e a ligação ao perfil só nas faixas dos artistas', () => {
  assert.equal(a.trackLine({ title: 'Xitende', artist: 'Mano Txill' }), '♪ Xitende · Mano Txill');
  assert.equal(a.trackLine({ title: 'Xitende', artist: '' }), '♪ Xitende');
  assert.equal(a.artistHref({ source: 'local', artistUsername: 'mano.txill' }), '/u/mano.txill');
  assert.equal(a.artistHref({ source: 'openverse', artistUsername: 'mano' }), null);
  assert.equal(a.artistHref({ source: 'local', artistUsername: '../x' }), null);
  assert.equal(a.artistHref({ source: 'local', artistUsername: null }), null);
  assert.equal(a.isLocalTrack({ source: 'local' }), true);
  assert.equal(a.isLocalTrack({}), false);
});

test('o trecho: ler minutos:segundos e ver se cabe na música', () => {
  assert.equal(a.parseMmss('1:05'), 65_000);
  assert.equal(a.parseMmss('0.30'), 30_000);
  assert.equal(a.parseMmss('90'), 90_000);
  assert.equal(a.parseMmss('1:75'), null);
  assert.equal(a.parseMmss('abc'), null);
  assert.equal(a.mmss(65_000), '1:05');
  assert.equal(a.previewProblem(30_000, 30_000, 200_000), null);
  assert.match(a.previewProblem(null, 30_000), /começa/);
  assert.match(a.previewProblem(0, 5_000), /entre 10 e 60/);
  assert.match(a.previewProblem(0, 61_000), /entre 10 e 60/);
  assert.match(a.previewProblem(190_000, 30_000, 200_000), /passa do fim da música \(3:20\)/);
  // Sem saber ainda a duração (o servidor confirma), só se veem os limites do trecho.
  assert.equal(a.previewProblem(190_000, 30_000, null), null);
});

test('ligações do pedido: só https, e o tipo adivinha-se pelo endereço', () => {
  assert.equal(a.linkProblem('https://instagram.com/x'), null);
  assert.match(a.linkProblem('http://instagram.com/x'), /https/);
  assert.equal(a.linkProblem('isto não é'), 'Ligação inválida');
  assert.equal(a.linkProblem(''), null);
  assert.equal(a.guessLinkKind('https://www.instagram.com/manotxill'), 'instagram');
  assert.equal(a.guessLinkKind('https://open.spotify.com/artist/1'), 'spotify');
  assert.equal(a.guessLinkKind('https://music.apple.com/mz/artist/1'), 'apple_music');
  assert.equal(a.guessLinkKind('https://youtu.be/abc'), 'youtube');
  assert.equal(a.guessLinkKind('https://audiomack.com/mano'), 'audiomack');
  assert.equal(a.guessLinkKind('https://manotxill.co.mz'), 'site');
});

test('os números para o artista: só totais', () => {
  assert.equal(a.usesLine(0, 0), 'Ainda ninguém a usou');
  assert.equal(a.usesLine(1, 1), 'Usada 1 vez por 1 pessoa');
  assert.equal(a.usesLine(12, 9), 'Usada 12 vezes por 9 pessoas');
});

test('os avisos da equipa (music_review): texto, motivo e destino', () => {
  assert.match(a.musicReviewVerb({ what: 'artist', decision: 'approved' }).text, /aprovou o teu pedido de artista/);
  assert.equal(a.musicReviewVerb({ what: 'artist', decision: 'rejected', reason: 'Falta a ligação' }).sub, 'Motivo: Falta a ligação');
  assert.match(a.musicReviewVerb({ what: 'track', decision: 'approved', title: 'Xitende' }).text, /aprovou «Xitende»/);
  assert.match(a.musicReviewVerb({ what: 'track', decision: 'removed', title: 'X', reason: 'Direitos' }).text, /tirou «X»/);
  assert.match(a.musicReviewVerb({ what: 'track', decision: 'restored' }).text, /repôs a tua música/);
  assert.equal(a.musicReviewTarget({ what: 'artist', decision: 'rejected' }), '/artista');
  assert.equal(a.musicReviewTarget({ what: 'artist', decision: 'approved' }), '/artista/gerir');
  assert.equal(a.musicReviewTarget({ what: 'track', decision: 'approved' }), '/artista/gerir');
  // A lista de notificações conhece o tipo novo.
  const n = read('app', 'notifications.tsx');
  assert.match(n, /case 'music_review': return musicReviewVerb/);
  assert.match(n, /case 'music_review': return musicReviewTarget/);
});

test('o que vai para o servidor: de uma faixa de artista só o id (o servidor busca o resto)', () => {
  const src = read('lib', 'api.music.ts');
  assert.match(src, /t\.source === 'local' \? \{ source: 'local' as const, id: t\.id \}/);
});

test('o seletor só mostra os «Artistas de Moçambique» em mimos e tchekas (o que a licença autoriza)', () => {
  assert.match(read('app', 'stories', 'new.tsx'), /<MusicPicker[^>]*allowLocal/);
  assert.match(read('components', 'TchekaStudio.tsx'), /<MusicPicker allowLocal/);
  assert.match(read('app', '(tabs)', 'new.tsx'), /allowLocal=\{assets\.length === 1 && assets\[0\]\.video\}/);
  assert.doesNotMatch(read('components', 'Notes.tsx'), /allowLocal/);
  const picker = read('components', 'MusicPicker.tsx');
  assert.match(picker, /allowLocal = false/);
  // As faixas dos artistas não vão para as favoritas (o servidor só guarda faixas do catálogo aberto).
  assert.match(picker, /t\.kind !== 'clip' && t\.source !== 'local'/);
});

test('ecrãs: Sou artista nas Definições e na pesquisa, o perfil com a etiqueta «Artista» (sem o selo de verificado)', () => {
  assert.match(read('app', 'settings', 'conta.tsx'), /anchor="artist"[^\n]*to="\/artista"/);
  assert.match(read('lib', 'settingsIndex.ts'), /id: 'artist', group: 'conta', title: 'Sou artista'/);
  const pv = read('components', 'ProfileView.tsx');
  assert.match(pv, /\{p\.artist \? <ArtistTag \/> : null\}/);
  assert.doesNotMatch(read('components', 'ArtistUi.tsx'), /VerifiedBadge/);
  const up = read('app', 'artista', 'carregar.tsx');
  assert.match(up, /licenseVersion: me\.data\.license\.version, acceptLicense: true/);
  assert.match(up, /uploadMedia\(audio\.uri, audio\.mime, 'music'\)/);
  assert.match(read('app', 'help.tsx'), /Como ponho a minha música no Txillapp\?/);
});
