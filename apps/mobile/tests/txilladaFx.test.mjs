// A Txillada moderna (docs/txillada-contrato.md): as reações a flutuar, «@fulano entrou» agrupado, os olás, quem está a
// ver, o ecrã inteiro (cover ou inteira com o fundo desfocado) e as ligações do chat que abrem a rota.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (p) => new URL(`../src/${p}`, import.meta.url).href;
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r/g, '');
const f = await import(src('lib/txilladaFx.ts'));
const links = await import(src('lib/chatLinks.ts'));

const ana = { username: 'ana', displayName: 'Ana', avatarUrl: '/a', verified: true, verifiedTier: 'paid' };
const rui = { username: 'rui', displayName: 'Rui', avatarUrl: null, verified: false, verifiedTier: null };
const p = (u) => ({ username: u, displayName: u.toUpperCase(), avatarUrl: null, verified: false, verifiedTier: null });

// ── eventos ──────────────────────────────────────────────────────────────────────────────────────────────────────────

test('eventos: reaction e joined bem formados passam (com o selo); os outros e de outra Txillada não', () => {
  const ev = f.parseFxEvent({ type: 'txillada.reaction', txilladaId: 't1', kind: 'fire', from: { ...ana, host: false }, to: { username: 'rui', verified: true, verifiedTier: 'official' } }, 't1');
  assert.equal(ev.kind, 'fire');
  assert.deepEqual(ev.from, { ...ana, host: false });
  assert.deepEqual(ev.to, { username: 'rui', verified: true, verifiedTier: 'official' });
  assert.equal(f.parseFxEvent({ type: 'txillada.reaction', txilladaId: 't1', kind: 'fire', from: ana }, 't2'), null, 'outra Txillada');
  assert.equal(f.parseFxEvent({ type: 'txillada.reaction', txilladaId: 't1', kind: 'bomba', from: ana }, 't1'), null, 'reação desconhecida');
  assert.equal(f.parseFxEvent({ type: 'txillada.reaction', txilladaId: 't1', kind: 'fire', from: {} }, 't1'), null);
  const j = f.parseFxEvent({ type: 'txillada.joined', txilladaId: 't1', user: { username: 'rui' } }, 't1');
  assert.deepEqual(j.user, { username: 'rui', displayName: 'rui', avatarUrl: null, verified: false, verifiedTier: null });
  assert.equal(f.parseFxEvent({ type: 'txillada.comment', txilladaId: 't1' }, 't1'), null);
});

// ── as reações a subir ───────────────────────────────────────────────────────────────────────────────────────────────

test('reações: um toque solta um leque de 3 (a abrir para a esquerda, com rotação e escala); reduzir movimento: 1 parado', () => {
  const b = f.fxBurst('heart', 42, 1000);
  assert.equal(b.length, 3);
  assert.ok(b.every((x) => x.emoji === '❤️' && x.at === 1000));
  assert.deepEqual(b.map((x) => x.delay), [0, 40, 80]);
  assert.ok(b[0].x > b[2].x, 'abre em leque para a esquerda');
  assert.ok(b.every((x) => x.x < 0 && x.x >= -80 && Math.abs(x.rot) <= 25 && x.scale >= 0.9 && x.scale <= 1.4));
  assert.deepEqual(f.fxBurst('heart', 42, 1000), b, 'a mesma semente dá o mesmo leque');
  const r = f.fxBurst('fire', 42, 1000, { reduce: true });
  assert.equal(r.length, 1);
  assert.deepEqual([r[0].x, r[0].rot, r[0].emoji], [0, 0, '🔥']);
  assert.equal(f.fxBurst('laugh', 1, 0, { n: 2 }).length, 2);
});

test('reações: no ar no máximo 28 (os mais antigos saem) e os que já chegaram lá acima saem', () => {
  let l = [];
  for (let i = 0; i < 12; i++) l = f.fxAdd(l, f.fxBurst('fire', i, 1000), 1000);
  assert.equal(l.length, f.FX_MAX);
  assert.equal(l.at(-1).id, '11-2', 'fica o mais recente');
  assert.equal(f.fxAlive(l, 1000), l, 'sem mudanças, a mesma lista (não desenha outra vez)');
  assert.equal(f.fxAlive(l, 1000 + 4000).length, 0);
});

test('reações: o meu ritmo (8/s) e o 👋 de quem vê 1 a cada 4 s (o anfitrião não tem este limite)', () => {
  let times = [];
  let ok = 0;
  for (let i = 0; i < 12; i++) { const g = f.reactGate(times, 1000 + i * 10, 'fire', null, false); times = g.times; if (g.ok) ok++; }
  assert.equal(ok, 8);
  assert.equal(f.reactGate(times, 2200, 'fire', null, false).ok, true, 'passado o segundo, volta');
  assert.equal(f.reactGate([], 5000, 'hello', 3000, false).ok, false);
  assert.equal(f.reactGate([], 7100, 'hello', 3000, false).ok, true);
  assert.equal(f.reactGate([], 5000, 'hello', 3000, true).ok, true, 'o anfitrião');
});

// ── «@fulano entrou» ────────────────────────────────────────────────────────────────────────────────────────────────

test('entrou: o texto agrupado', () => {
  assert.equal(f.joinedText([]), '');
  assert.equal(f.joinedText([p('a')]), '@a entrou');
  assert.equal(f.joinedText([p('a'), p('b')]), '@a e @b entraram');
  assert.equal(f.joinedText([p('a'), p('b'), p('c')]), '@a, @b e @c entraram');
  assert.equal(f.joinedText([p('a'), p('b'), p('c'), p('d'), p('e')]), '@a, @b e mais 3 entraram');
  const parts = f.joinedParts([ana]);
  assert.deepEqual(parts[0], { t: 'user', u: { username: 'ana', verified: true, verifiedTier: 'paid' } }, 'o @ leva o selo');
});

test('entrou: em fila, agrupa quem entra junto, sem repetir e sem mim; um aviso de cada vez, 3 s', () => {
  let s = f.joinInit();
  s = f.joinAdd(s, p('a'), 0, 'eu');
  s = f.joinAdd(s, p('a'), 100, 'eu');
  s = f.joinAdd(s, p('eu'), 100, 'eu');
  s = f.joinAdd(s, p('b'), 300, 'eu');
  assert.equal(s.buf.length, 2, 'sem repetidos e sem mim');
  assert.equal(f.joinStep(s, 500).shown, null, 'espera um bocadinho');
  s = f.joinStep(s, f.JOIN_WAIT_MS);
  assert.deepEqual(s.shown.users.map((u) => u.username), ['a', 'b']);
  assert.equal(s.buf.length, 0);
  for (const u of ['c', 'd', 'e', 'f']) s = f.joinAdd(s, p(u), 1500, 'eu');
  s = f.joinStep(s, 2500);
  assert.deepEqual(s.shown.users.map((u) => u.username), ['a', 'b'], 'o aviso à vista fica até ao fim');
  s = f.joinStep(s, f.JOIN_WAIT_MS + f.JOIN_SHOW_MS);
  assert.equal(f.joinedText(s.shown.users), '@c, @d e mais 2 entraram');
  s = f.joinStep(s, 20_000);
  assert.equal(s.shown, null);
  assert.equal(f.joinBusy(s), false);
});

// ── os olás ──────────────────────────────────────────────────────────────────────────────────────────────────────────

test('olás: do anfitrião em grande; a alguém e de quem vê em balão; os outros emojis sem balão', () => {
  const r = (o) => ({ type: 'txillada.reaction', txilladaId: 't1', kind: 'hello', from: { ...ana, host: false }, to: null, ...o });
  assert.deepEqual([f.helloOf(r({ from: { ...ana, host: true } }), 'x', 0).text, f.helloOf(r({ from: { ...ana, host: true } }), 'x', 0).big], ['@ana diz olá a todos 👋', true]);
  assert.equal(f.helloOf(r({ from: { ...ana, host: true }, to: { username: 'rui', verified: true, verifiedTier: 'verified' } }), 'x', 0).text, '@ana: Olá @rui 👋');
  const h = f.helloOf(r({}), 'x', 0);
  assert.deepEqual([h.text, h.big], ['@ana: Olá 👋', false]);
  assert.equal(h.parts[0].u.verified, true, 'o selo vai no @');
  assert.equal(f.helloOf(r({ kind: 'fire' }), 'x', 0), null);
});

test('olás: no máximo 3 balões e uma saudação em grande; saem com o tempo', () => {
  const mk = (id, big = false) => ({ id, at: 0, parts: [], text: id, avatar: rui, big });
  let l = [];
  for (const id of ['a', 'b', 'c', 'd']) l = f.helloAdd(l, mk(id), 0);
  assert.deepEqual(l.map((x) => x.id), ['b', 'c', 'd']);
  l = f.helloAdd(l, mk('G', true), 0);
  l = f.helloAdd(l, mk('H', true), 0);
  assert.deepEqual(l.map((x) => x.id), ['H', 'b', 'c', 'd']);
  assert.equal(f.helloAlive(l, f.HELLO_MS + 1).length, 0);
});

// ── quem está a ver ──────────────────────────────────────────────────────────────────────────────────────────────────

test('a ver: 3 avatares empilhados e o número (o maior entre a lista e o contador); quem entra vai para a frente', () => {
  const items = ['a', 'b', 'c', 'd', 'e'].map(p);
  assert.deepEqual(f.viewerStack(items, 2, 3).shown.map((u) => u.username), ['a', 'b', 'c']);
  assert.equal(f.viewerStack(items, 2, 3).count, 5);
  assert.equal(f.viewerStack(items, 9, 3).more, 6);
  assert.equal(f.viewerStack([], 0).count, 0);
  assert.deepEqual(f.withJoined(items, p('c')).map((u) => u.username), ['c', 'a', 'b', 'd', 'e']);
});

// ── o ecrã inteiro ──────────────────────────────────────────────────────────────────────────────────────────────────

test('ecrã inteiro: cover quando a imagem tem a forma do ecrã; deitada num telemóvel fica inteira (fundo desfocado)', () => {
  assert.equal(f.videoFit(720, 1280, 390, 844), 'cover', '9:16 num iPhone');
  assert.equal(f.videoFit(1280, 720, 390, 844), 'contain', '16:9 deitado num telemóvel: não se corta quase tudo');
  assert.equal(f.videoFit(640, 480, 390, 844), 'contain', '4:3 deitado');
  assert.equal(f.videoFit(720, 1280, 1440, 900), 'contain', 'ao alto num computador: ao centro em altura total');
  assert.equal(f.videoFit(1280, 720, 1440, 900), 'cover');
  assert.equal(f.videoFit(0, 0, 390, 844), 'cover', 'sem medidas ainda');
});

test('ecrã inteiro: no telemóvel a largura toda com as margens seguras; no computador uma coluna ao centro', () => {
  const m = f.liveLayout({ w: 390, h: 844, top: 47, bottom: 34, wide: false });
  assert.deepEqual([m.colLeft, m.colW, m.padTop, m.padBottom], [0, 390, 53, 40]);
  assert.ok(m.floatW >= 200 && m.floatW <= 300);
  const d = f.liveLayout({ w: 1440, h: 900, top: 0, bottom: 0, wide: true });
  assert.equal(d.colW, 506);
  assert.equal(d.colLeft, (1440 - 506) / 2);
  assert.equal(f.liveLayout({ w: 390, h: 844, top: 0, bottom: 0, wide: false }).padTop, 16, 'sem entalhe, uma margem mínima');
});

test('o ecrã da Txillada: fixo à janela no site (100dvh), vídeo de ponta a ponta, sem o cartão 9:16 dos mimos', () => {
  const s = read('src/app/txillada/[id].tsx');
  assert.match(s, /height: '100dvh'/);
  assert.match(s, /position: 'fixed'/);
  assert.match(s, /<TxilladaVideo track=\{tx\.video\} mirror=\{host && tx\.front\} fit=\{host \? 'cover' : 'auto'\} style=\{StyleSheet\.absoluteFill\} \/>/);
  assert.doesNotMatch(s, /storyFrame/);
  assert.match(s, /<ReactionBar onReact=\{react\} \/>/);
  assert.match(s, /<HelloAllButton /);
  assert.match(s, /<ViewersStack /);
  const v = read('src/components/txillada/TxilladaVideo.web.tsx');
  assert.match(v, /position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%'/, 'o <video> em absolute (o Safari não resolvia height: 100% num flex)');
  assert.match(v, /el\.style\.objectFit = next/);
  assert.match(v, /filter: 'blur\(28px\)/);
});

test('captura: ao alto, 720p a ~2 Mbps com simulcast; virar a câmara no browser não volta ao 1280×720 deitado', () => {
  const room = read('src/lib/txilladaRoom.ts');
  assert.match(room, /maxBitrate: 2_000_000/);
  assert.match(room, /videoSimulcastLayers: \[lk\.VideoPresets\.h360\]/);
  assert.match(room, /pixelDensity: 'screen'/);
  assert.match(room, /await ensurePortrait\(video, front\)/);
  const web = read('src/lib/txilladaLive.web.ts');
  assert.match(web, /restartTrack\(\{ facingMode: front \? 'user' : 'environment', resolution: captureResolution \}\)/);
  assert.match(web, /export async function ensurePortrait/);
  assert.match(read('src/lib/txilladaLive.ts'), /export async function ensurePortrait/);
});

// ── as ligações ──────────────────────────────────────────────────────────────────────────────────────────────────────

test('ligações: txillapp.com/txillada/<id> no chat abre a rota da app (ecrã inteiro), não o browser por cima', () => {
  assert.equal(links.chatUrl('https://txillapp.com/txillada/0193a-b').path, '/txillada/0193a-b');
  assert.equal(links.chatUrl('https://www.txillapp.com/txillada/abc?x=1').path, '/txillada/abc?x=1');
});
