// Testes do visor dos Zás em pilha (src/components/zas/zasDeck.ts): quantos cartões se desenham e se veem, a contagem
// «1 de N», a pose de cada cartão (o de cima, os que espreitam, o que sai), o deslizar, a largura certa da foto e o
// pré-carregamento das seguintes (sem repetir, a tentar outra vez quando falha).
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const D = await import(pathToFileURL(path.join(ROOT, 'src', 'components', 'zas', 'zasDeck.ts')).href);

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);
const tick = () => new Promise((r) => setTimeout(r, 0));

test('pilha: o de cima e até 2 a espreitar; o que acabou de sair fica desenhado (para sair e para voltar atrás)', () => {
  // 5 Zás, no primeiro: o de cima e 2 por trás, nada antes.
  assert.deepEqual(D.deckSlots(5, 0), [{ index: 2, depth: 2 }, { index: 1, depth: 1 }, { index: 0, depth: 0 }]);
  assert.equal(D.deckVisible(5, 0), 3);
  // A meio: o que saiu (-1) por cima de todos na ordem de desenho, depois os de trás e o de cima.
  assert.deepEqual(D.deckSlots(5, 2), [{ index: 4, depth: 2 }, { index: 3, depth: 1 }, { index: 2, depth: 0 }, { index: 1, depth: -1 }]);
  assert.equal(D.deckVisible(5, 2), 3);
  // No penúltimo e no último: menos cartões por trás.
  assert.equal(D.deckVisible(5, 3), 2);
  assert.equal(D.deckVisible(5, 4), 1);
  assert.deepEqual(D.deckSlots(5, 4).map((s) => s.depth), [0, -1]);
  // Um só Zás: um cartão; nenhum: nada; índices fora de sítio ficam nas pontas.
  assert.deepEqual(D.deckSlots(1, 0), [{ index: 0, depth: 0 }]);
  assert.deepEqual(D.deckSlots(0, 0), []);
  assert.deepEqual(D.deckSlots(3, 9).map((s) => s.index), [2, 1]);
  assert.deepEqual(D.deckSlots(3, -4).map((s) => s.index), [2, 1, 0]);
  // Nunca mais do que DECK_BEHIND por trás, por maior que seja a lista.
  for (let at = 0; at < 50; at++) assert.ok(D.deckVisible(50, at) <= 1 + D.DECK_BEHIND);
});

test('«1 de N»: conta a partir de 1, presa às pontas, e some com um só Zás', () => {
  assert.equal(D.deckCount(0, 4), '1 de 4');
  assert.equal(D.deckCount(3, 4), '4 de 4');
  assert.equal(D.deckCount(9, 4), '4 de 4');
  assert.equal(D.deckCount(-2, 4), '1 de 4');
  assert.equal(D.deckCount(0, 1), '');
  assert.equal(D.deckCount(0, 0), '');
});

test('pose: o de cima direito e inteiro; os de trás mais pequenos, mais acima e mais escuros; contínua entre lugares', () => {
  const W = 390, H = 368;
  const top = D.deckPose(0, W, H);
  assert.deepEqual(top, { translateX: 0, translateY: -0, scale: 1, rotate: 0, opacity: 1, shade: 0 });
  const b1 = D.deckPose(1, W, H), b2 = D.deckPose(2, W, H);
  assert.ok(b1.scale < 1 && b2.scale < b1.scale, 'mais pequenos para trás');
  assert.ok(b1.translateY < 0 && b2.translateY < b1.translateY, 'espreitam pelo topo');
  // O topo de cada um fica acima do topo do de cima (vê-se a ponta do cartão).
  for (const b of [b1, b2]) assert.ok(H / 2 + b.translateY - (H * b.scale) / 2 < 0);
  assert.ok(b1.shade > 0 && b2.shade > b1.shade, 'mais escuros para trás');
  assert.ok(b1.rotate !== 0 && Math.sign(b1.rotate) !== Math.sign(b2.rotate), 'rodam ao de leve, alternando');
  // A meio caminho (o dedo a arrastar, a animação): entre os dois lugares.
  const mid = D.deckPose(0.5, W, H);
  near(mid.scale, (top.scale + b1.scale) / 2);
  near(mid.translateY, (top.translateY + b1.translateY) / 2);
  // O seguinte a aparecer (d entre 2 e 3) vai ganhando opacidade no lugar 2.
  assert.equal(D.deckPose(3, W, H).opacity, 0);
  near(D.deckPose(2.5, W, H).opacity, 0.5);
  assert.equal(D.deckPose(2.5, W, H).scale, b2.scale);
  // O que sai: para a esquerda, fora do ecrã, a rodar.
  const out = D.deckPose(-1, W, H);
  assert.ok(out.translateX <= -W, 'sai do ecrã');
  assert.ok(out.rotate < 0);
  assert.ok(D.deckPose(-0.5, W, H).translateX > out.translateX && D.deckPose(-0.5, W, H).translateX < 0);
  // A sair continua opaco (não se vê o de trás através dele); só depois de fora desaparece.
  assert.equal(D.deckPose(-0.15, W, H).opacity, 1);
  assert.equal(D.deckPose(-0.99, W, H).opacity, 1);
  assert.equal(out.opacity, 0);
  // O espaço que os de trás pedem por cima do de cima.
  assert.equal(D.deckHeadroom(H), Math.ceil(-b2.translateY));
});

test('deslizar: para a esquerda passa ao seguinte, para a direita volta, pouco volta ao sítio; um gesto rápido conta', () => {
  assert.equal(D.swipeStep(-120, -0.1, 390), 1);
  assert.equal(D.swipeStep(120, 0.1, 390), -1);
  assert.equal(D.swipeStep(-20, -0.05, 390), 0);
  assert.equal(D.swipeStep(30, 0.1, 390), 0);
  assert.equal(D.swipeStep(-30, -0.9, 390), 1);
  assert.equal(D.swipeStep(30, 0.9, 390), -1);
  assert.equal(D.swipeStep(-5, -2, 390), 0, 'um toque com tremor não é deslizar');
});

test('largura da foto: a do cartão vezes a densidade (até 2,5×), subida para 480/720/1080', () => {
  assert.equal(D.zasPhotoWidth(277, 3), 720);
  assert.equal(D.zasPhotoWidth(277, 2), 720);
  assert.equal(D.zasPhotoWidth(277, 1), 480);
  assert.equal(D.zasPhotoWidth(420, 2), 1080);
  assert.equal(D.zasPhotoWidth(900, 3), 1080);
  assert.equal(D.zasPhotoWidth(0, 0), 480);
});

test('endereço da foto: o URL assinado do chat leva ?w= (e troca o que já tinha); outros ficam como estão', () => {
  const u = 'https://txillapp.com/api/v1/chat/media/abc?exp=1&sig=x';
  assert.equal(D.zasPhotoUrl(u, 720), `${u}&w=720`);
  assert.equal(D.zasPhotoUrl(`${u}&w=480`, 1080), `${u}&w=1080`);
  assert.equal(D.zasPhotoUrl('/api/v1/chat/media/abc', 480), '/api/v1/chat/media/abc?w=480');
  assert.equal(D.zasPhotoUrl('blob:xyz', 720), 'blob:xyz');
  assert.equal(D.zasPhotoUrl('/api/v1/media/abc?w=480', 720), '/api/v1/media/abc?w=480');
});

test('pré-carregar: a de cima e as 3 seguintes, a cada avanço', () => {
  const urls = ['a', 'b', 'c', 'd', 'e', 'f'];
  assert.deepEqual(D.prefetchTargets(urls, 0), ['a', 'b', 'c', 'd']);
  assert.deepEqual(D.prefetchTargets(urls, 1), ['b', 'c', 'd', 'e']);
  assert.deepEqual(D.prefetchTargets(urls, 4), ['e', 'f']);
  assert.deepEqual(D.prefetchTargets(urls, 0, 1), ['a', 'b']);
  assert.deepEqual(D.prefetchTargets(['a', 'a', 'b'], 0), ['a', 'b']);
  assert.deepEqual(D.prefetchTargets([], 0), []);
});

test('pré-carregador: cada foto uma vez; a que falha pode vir outra vez; não cresce sem fim', async () => {
  const calls = [];
  let fail = new Set(['x']);
  const p = D.createPrefetcher(async (u) => {
    calls.push(u);
    if (fail.has(u)) throw new Error('rede');
  }, 3);
  // Abrir o visor e avançar: a janela anda, as que já vieram não se pedem outra vez.
  const urls = ['a', 'b', 'c', 'd', 'e'];
  p.want(D.prefetchTargets(urls, 0));
  p.want(D.prefetchTargets(urls, 0)); // a mesma janela outra vez, ainda a carregar: nada de novo
  await tick(); await tick();
  p.want(D.prefetchTargets(urls, 1));
  await tick(); await tick();
  assert.deepEqual(calls, ['a', 'b', 'c', 'd', 'e']);
  assert.equal(p.requested, 5);
  assert.ok(p.has('e') && p.has('d'));
  assert.ok(!p.has('a'), 'guarda só as últimas 3');
  // Falhou: fica de fora e pode ser pedida outra vez.
  p.want(['x']);
  await tick(); await tick();
  assert.equal(p.has('x'), false);
  fail = new Set();
  p.want(['x']);
  await tick(); await tick();
  assert.equal(p.has('x'), true);
  assert.deepEqual(calls.filter((u) => u === 'x').length, 2);
});
