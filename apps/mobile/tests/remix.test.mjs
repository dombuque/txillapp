// Testes do remix das tchekas (src/lib/remix.ts): o «Dueto» e o «Responder com tcheka". As ligações do estúdio, os textos,
// para onde leva cada coisa, a montagem lado a lado, o autocolante e o que os ecrãs ligam (sem React).
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const r = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'remix.ts')).href);
const read = (...p) => readFileSync(path.join(ROOT, 'src', ...p), 'utf8');

const P = '0190a5b2-1c3d-7e4f-8a9b-0c1d2e3f4a5b';
const C = '0190a5b2-1c3d-7e4f-8a9b-0c1d2e3f4a5c';
const ana = { username: 'ana', displayName: 'Ana' };
const rui = { username: 'rui', displayName: 'Rui' };

test('ligações do estúdio: /tcheka/nova?dueto= e ?resposta=, e a lista «Duetos e respostas»', () => {
  assert.equal(r.duetHref(P), `/tcheka/nova?dueto=${P}`);
  assert.equal(r.replyHref(C), `/tcheka/nova?resposta=${C}`);
  assert.equal(r.remixesHref(P), `/remixes/${P}`);
});

test('remixMode: que estúdio abre (ids inválidos não abrem nada; o dueto ganha à resposta)', () => {
  assert.deepEqual(r.remixMode({ dueto: P }), { kind: 'duet', postId: P });
  assert.deepEqual(r.remixMode({ resposta: C }), { kind: 'reply', commentId: C });
  assert.deepEqual(r.remixMode({ dueto: [P.toUpperCase()] }), { kind: 'duet', postId: P });
  assert.deepEqual(r.remixMode({ dueto: P, resposta: C }), { kind: 'duet', postId: P });
  assert.equal(r.remixMode({}), null);
  assert.equal(r.remixMode({ dueto: '../../x' }), null);
  assert.equal(r.remixMode({ resposta: 'abc' }), null);
});

test('remixLabel e remixTarget: «Dueto com @x», «Resposta a @y» e o original que já não se vê', () => {
  const duet = { postId: P, kind: 'duet', commentId: null, sticker: null, available: true, code: 'Ab3xK9q', author: ana, comment: null };
  assert.equal(r.remixLabel(duet), 'Dueto com @ana');
  assert.equal(r.remixTarget(duet), `/p/${P}`);
  const reply = { ...duet, kind: 'reply', commentId: C, sticker: { x: 0.1, y: 0.2 }, comment: { id: C, body: 'faz um tutorial', author: rui } };
  assert.equal(r.remixLabel(reply), 'Resposta a @rui');
  assert.equal(r.remixTarget(reply), `/p/${P}?comments=1&c=${C}`);
  // O comentário foi apagado: a resposta fica, com a etiqueta do original.
  assert.equal(r.remixLabel({ ...reply, commentId: null, comment: null }), 'Resposta numa tcheka de @ana');
  assert.equal(r.remixTarget({ ...reply, commentId: null, comment: null }), `/p/${P}`);
  // O original já não se vê (apagado, privado ou bloqueio): sem ligação.
  const gone = { ...duet, available: false, author: null, code: null };
  assert.equal(r.remixLabel(gone), 'Dueto com uma tcheka que já não está disponível');
  assert.equal(r.remixTarget(gone), null);
  assert.equal(r.remixLabel(null), null);
});

test('remixActions: dueto só nas tchekas e se o dono deixa; a lista quando já há algum', () => {
  const video = [{ kind: 'video' }];
  assert.deepEqual(r.remixActions({ media: video, canRemix: true, remixes: 0 }), { duet: true, list: false, count: 0, show: true });
  assert.deepEqual(r.remixActions({ media: video, canRemix: false, remixes: 3 }), { duet: false, list: true, count: 3, show: true });
  assert.equal(r.remixActions({ media: video, canRemix: false, remixes: 0 }).show, false);
  // Uma foto (ou carrossel) não dá dueto.
  assert.equal(r.remixActions({ media: [{ kind: 'image' }], canRemix: true }).duet, false);
  assert.equal(r.remixActions({ media: [{ kind: 'video' }, { kind: 'video' }], canRemix: true }).duet, false);
  // Servidor antigo (sem canRemix): nada.
  assert.equal(r.remixActions({ media: video }).show, false);
});

test('textos: contagem, «Respondeu com uma tcheka» e os avisos', () => {
  assert.equal(r.remixCount(1), '1 dueto ou resposta');
  assert.equal(r.remixCount(3), '3 duetos e respostas');
  assert.equal(r.tchekaRepliesLabel(1), 'Respondeu com uma tcheka');
  assert.equal(r.tchekaRepliesLabel(4), '4 tchekas responderam');
  assert.equal(r.remixVerb({ remixKind: 'duet', role: 'post' }), 'fez um dueto com a tua tcheka');
  assert.equal(r.remixVerb({ remixKind: 'reply', role: 'comment' }), 'respondeu ao teu comentário com uma tcheka');
  assert.equal(r.remixVerb({ remixKind: 'reply', role: 'post' }), 'respondeu com uma tcheka a um comentário na tua publicação');
  assert.equal(r.remixNoticeTarget({ postId: P }), `/p/${P}`);
  assert.equal(r.remixNoticeTarget({}), null);
});

test('duetLimitMs: o tempo do original, até 60 s', () => {
  assert.equal(r.duetLimitMs(15_000), 15_000);
  assert.equal(r.duetLimitMs(90_000), 60_000);
  assert.equal(r.duetLimitMs(null), 60_000);
  assert.equal(r.duetLimitMs(0), 60_000);
});

test('duetLayout: duas metades 9:16 lado a lado, ao meio do vídeo 1080×1920 (câmara à esquerda, original à direita)', () => {
  const { left, right } = r.duetLayout(1080, 1920);
  assert.deepEqual(left, { x: 0, y: 480, w: 540, h: 960 });
  assert.deepEqual(right, { x: 540, y: 480, w: 540, h: 960 });
  // As duas cabem no vídeo e não se tocam.
  assert.ok(left.x + left.w <= right.x && right.x + right.w <= 1080 && left.y >= 0 && left.y + left.h <= 1920);
});

test('coverRect: enche a caixa sem deformar, cortando ao centro', () => {
  const box = { x: 540, y: 480, w: 540, h: 960 };
  const wide = r.coverRect(1920, 1080, box); // vídeo deitado numa caixa em pé: corta os lados
  assert.equal(wide.h, 960);
  assert.ok(Math.abs(wide.w / wide.h - 16 / 9) < 1e-9);
  assert.ok(Math.abs(wide.x + wide.w / 2 - (box.x + box.w / 2)) < 1e-9);
  const tall = r.coverRect(720, 1280, box); // já 9:16: fica igual à caixa
  assert.deepEqual(tall, box);
  assert.deepEqual(r.coverRect(0, 0, box), box); // sem dimensões ainda
});

test('clampSticker: o autocolante fica sempre todo dentro do vídeo', () => {
  assert.deepEqual(r.clampSticker(0.2, 0.3, 0.5, 0.1), { x: 0.2, y: 0.3 });
  assert.deepEqual(r.clampSticker(0.9, 0.95, 0.5, 0.1), { x: 0.5, y: 0.9 });
  assert.deepEqual(r.clampSticker(-1, -1, 0.5, 0.1), { x: 0, y: 0 });
  assert.deepEqual(r.clampSticker(NaN, 0.5, 0.5, 0.1), { x: 0, y: 0.5 });
  // Mais largo do que o vídeo: encosta à esquerda.
  assert.deepEqual(r.clampSticker(0.5, 0.5, 1.2, 0.1), { x: 0, y: 0.5 });
});

test('stickerText: uma linha curta; stickers e GIF viram uma palavra', () => {
  assert.equal(r.stickerText('faz\n  um   tutorial'), 'faz um tutorial');
  assert.equal(r.stickerText(''), 'GIF');
  assert.equal(r.stickerText('[sticker:saude]'), 'Sticker');
  const long = r.stickerText('a'.repeat(200), 90);
  assert.equal(long.length, 90);
  assert.ok(long.endsWith('…'));
});

test('os ecrãs ligam o remix: rota do estúdio, lista, botões, etiqueta, autocolante, comentários, avisos e definições', () => {
  assert.ok(existsSync(path.join(ROOT, 'src', 'app', 'tcheka', 'nova.tsx')));
  assert.match(read('app', 'tcheka', 'nova.tsx'), /remixStudioFor\(/);
  assert.ok(existsSync(path.join(ROOT, 'src', 'app', 'remixes', '[id].tsx')));
  // O dueto no nativo diz que ainda só está no site; no web grava com canvas e MediaRecorder.
  assert.match(read('components', 'remix', 'DuetStudio.tsx'), /O dueto ainda só está no site/);
  const rec = read('components', 'remix', 'RemixRecorder.tsx');
  assert.match(rec, /captureStream/);
  assert.match(rec, /new MediaRecorder/);
  assert.match(rec, /createMediaElementSource/);
  assert.match(rec, /stampTxillapp/);
  // Reels: o botão Remix no lado, a etiqueta e o autocolante.
  const reels = read('app', '(tabs)', 'reels.tsx');
  // O botão Remix vive no slot das ações do lado da equipa «ver» (entre Partilhar e o disco).
  assert.match(reels, /<ReelExtraActions post=\{post\}/);
  assert.match(read('components', 'reel', 'ReelExtraActions.tsx'), /<RemixButton /);
  assert.match(reels, /<RemixTag /);
  assert.match(reels, /<ReplyStickerOverlay /);
  // Cartão: a etiqueta, o autocolante e «Duetos e respostas» quando aberta.
  const card = read('components', 'PostCard.tsx');
  assert.match(card, /<RemixTag /);
  assert.match(card, /<RemixesLink /);
  // Comentários: «Responder com tcheka» e «Respondeu com uma tcheka».
  const cs = read('components', 'CommentsSheet.tsx');
  assert.match(cs, /Responder com tcheka/);
  assert.match(cs, /tchekaRepliesLabel/);
  // Avisos e definições.
  assert.match(read('app', 'notifications.tsx'), /case 'remix'/);
  assert.match(read('app', 'settings', 'conteudo.tsx'), /anchor="remix"/);
  assert.match(read('app', 'settings', 'conteudo.tsx'), /remixAllowed/);
  const idx = read('lib', 'settingsIndex.ts');
  assert.match(idx, /id: 'remix', group: 'conteudo'/);
  assert.match(idx, /remixes: \['Duetos e respostas'/);
  // A publicação leva o remix e, num dueto sem som, music: null.
  assert.match(read('lib', 'api.compose.ts'), /remixOf\?: RemixInput/);
});

test('«Retirar o dueto» (0140): só o autor do original, só em duetos, com aviso a quem o fez', () => {
  assert.equal(r.takedownTitle, 'Retirar este dueto?');
  assert.match(r.takedownText('ana'), /@ana recebe um aviso/);
  assert.match(r.takedownText('ana'), /Não dá para desfazer/);
  assert.match(r.takedownText(null), /quem o fez/);
  assert.equal(r.takedownVerb().text, 'pediu para retirar o teu dueto');
  const menu = read('components', 'PostSheets.tsx').replace(/\r\n/g, '\n');
  assert.match(menu, /post\.remixOf\?\.kind === 'duet' && post\.remixOf\.canTakeDown \? <MenuRow[^\n]*title="Retirar o dueto"/);
  assert.match(menu, /api\.takeDownDuet\(post\.id\)/);
  assert.match(read('lib', 'api.ts'), /\/duet-takedown`, post\(\{\}\)\)/);
});
