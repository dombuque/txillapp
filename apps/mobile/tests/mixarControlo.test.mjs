// Testes do controlo e do resumo do Mixar (src/lib/mixarControlo.ts, docs/mixar-contrato.md «Controlo e resumo»): as
// secções da folha dos temas, «Menos disto», os temas privados, o cartão da semana à segunda-feira, os números e os textos,
// e as entradas nos ecrãs (menu do item, cabeçalho, Descoberta, Definições › Privacidade).
// Correr em apps/mobile:  node --test tests/mixarControlo.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const x = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'mixarControlo.ts')).href);
const read = (...p) => readFileSync(path.join(ROOT, 'src', ...p), 'utf8').replace(/\r\n/g, '\n');
const T = (topic, label) => ({ topic, label });

test('topicSections: tirados (meus e do outro), com menos e os outros, sem repetir', () => {
  const t = {
    mine: [{ ...T('humor', 'Humor'), mode: 'off' }, { ...T('musica', 'Música'), mode: 'less' }],
    theirsOff: [T('fe', 'Fé'), T('humor', 'Humor')],
    lessAuthors: 2,
    all: [T('comida', 'Comida'), T('fe', 'Fé'), T('humor', 'Humor'), T('moda', 'Moda'), T('musica', 'Música')],
  };
  const s = x.topicSections(t, { common: [T('musica', 'Música'), T('comida', 'Comida')], onlyMe: [], onlyThem: [T('moda', 'Moda')] }, 'Ana');
  assert.deepEqual(s.off.map((r) => [r.topic, r.action, r.button]), [['humor', 'restore', 'Voltar a pôr'], ['fe', 'none', '']]);
  assert.equal(s.off[1].line, 'Ana tirou do vosso Mixar');
  assert.deepEqual(s.less.map((r) => [r.topic, r.action]), [['musica', 'normal']]);
  assert.deepEqual(s.rest.map((r) => [r.topic, r.line]), [['comida', 'Em comum'], ['moda', 'Do gosto de Ana']]);
  assert.ok(s.rest.every((r) => r.action === 'off' && r.button === 'Tirar'));
  assert.deepEqual(x.topicSections(null, null, 'Ana'), { off: [], less: [], rest: [] });
});

test('«Menos disto»: o aviso com o tema e o @, ou só o @', () => {
  assert.equal(x.lessToast({ topic: T('humor', 'Humor'), author: { username: 'riso_mz' } }), 'Vais ver menos de Humor e de @riso_mz neste Mixar');
  assert.equal(x.lessToast({ topic: null, author: { username: 'riso_mz' } }), 'Vais ver menos de @riso_mz neste Mixar');
  assert.equal(x.offActionText('Humor'), 'Não quero «Humor» no nosso Mixar');
});

test('temas privados: ligar e desligar sem repetir; a contagem', () => {
  assert.deepEqual(x.togglePrivate(['fe'], 'humor', true), ['fe', 'humor']);
  assert.deepEqual(x.togglePrivate(['fe', 'humor'], 'fe', true), ['humor', 'fe']);
  assert.deepEqual(x.togglePrivate(['fe', 'humor'], 'fe', false), ['humor']);
  assert.equal(x.privateCountLabel(0), 'Nenhum');
  assert.equal(x.privateCountLabel(1), '1 tema');
  assert.equal(x.privateCountLabel(4), '4 temas');
});

test('o cartão da semana entra no fim do feed só à segunda-feira (antes de «Volta amanhã»)', () => {
  assert.equal(x.isMonday('2026-11-16'), true);
  assert.equal(x.isMonday('2026-11-17'), false);
  assert.equal(x.isMonday(''), false);
  assert.equal(x.isMonday(undefined), false);
  const pages = [{ kind: 'challenge', key: 'c' }, { kind: 'item', key: 'i:1' }, { kind: 'end', key: 'end' }];
  assert.deepEqual(x.withWeekPage(pages, true).map((p) => p.kind), ['challenge', 'item', 'week', 'end']);
  assert.deepEqual(x.withWeekPage(pages, false).map((p) => p.kind), ['challenge', 'item', 'end']);
  // Ainda há mais para carregar (sem a página do fim): não entra.
  assert.deepEqual(x.withWeekPage(pages.slice(0, 2), true).map((p) => p.kind), ['challenge', 'item']);
});

test('os números do cartão (os mesmos da imagem do servidor) e a frase de baixo', () => {
  assert.deepEqual(x.weekStats({ streak: 4, challenge: { offered: 6, played: 5, matches: 3 }, videos: 23 }).map((s) => [s.value, s.label]), [
    ['4', 'dias de série'], ['3 de 5', 'acertos no Mixa Challenge'], ['23', 'vídeos vistos esta semana'],
  ]);
  assert.deepEqual(x.weekStats({ streak: 1, challenge: { offered: 1, played: 0, matches: 0 }, videos: 1 }).map((s) => s.label), ['dia de série', 'desafios jogados', 'vídeo visto esta semana']);
  assert.match(x.weekLine({ together: 0, challenge: { played: 3, matches: 3 } }, 'Ana'), /sempre o mesmo/);
  assert.equal(x.weekLine({ together: 5, challenge: { played: 3, matches: 1 } }, 'Ana'), 'Viram 5 vídeos os dois.');
  assert.equal(x.shareDoneText('zas'), 'Está no teu Zás');
  assert.equal(x.shareDoneText('story'), 'Está nos teus mimos');
  assert.equal(x.shareErrorText({ status: 403 }), 'Confirma o teu email para partilhar.');
});

test('os textos novos: sem travessões nem emojis', () => {
  const files = [['lib', 'mixarControlo.ts'], ['components', 'mixar', 'MixarControloSheets.tsx'], ['components', 'mixar', 'MixarWeekCard.tsx'], ['app', 'settings', 'mixar-temas.tsx']];
  for (const f of files) {
    const src = read(...f);
    assert.doesNotMatch(src, /[—–]/, f.join('/'));
    assert.doesNotMatch(src, /\p{Extended_Pictographic}/u, f.join('/'));
  }
});

test('as entradas: menu do item e resumo no Mixar, links na Descoberta e nas Definições', () => {
  const screen = read('app', 'mixar', '[id].tsx');
  assert.match(screen, /setItemMenu\(it\)/);
  assert.match(screen, /accessibilityLabel="Resumo da semana"/);
  assert.match(screen, /withWeekPage\(/);
  assert.match(screen, /router\.push\('\/settings\/mixar-temas'/);
  assert.match(read('components', 'mixar', 'MixarPages.tsx'), /Afinar os temas do Mixar/);
  assert.match(read('app', 'settings', 'privacidade.tsx'), /to="\/settings\/mixar-temas"/);
  // O selo de quem é verificado no cartão.
  assert.match(read('components', 'mixar', 'MixarWeekCard.tsx'), /<NameWithBadge name=\{them\.name\} who=\{partner\}/);
});
