// Testes dos brindes à geleira (src/lib/geleiraCheers.ts): os textos da contagem e dos botões e a atualização otimista.
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const c = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'geleiraCheers.ts')).href);

test('cheersCount: singular só com 1, plural no resto', () => {
  assert.equal(c.cheersCount(0), '0 brindes');
  assert.equal(c.cheersCount(1), '1 brinde');
  assert.equal(c.cheersCount(2), '2 brindes');
  assert.equal(c.cheersCount(12), '12 brindes');
});

test('cheersCount: lixo do servidor vira 0 (nunca negativo nem com casas decimais)', () => {
  assert.equal(c.cheersCount(-3), '0 brindes');
  assert.equal(c.cheersCount(Number.NaN), '0 brindes');
  assert.equal(c.cheersCount(undefined), '0 brindes');
  assert.equal(c.cheersCount('7'), '0 brindes');
  assert.equal(c.cheersCount(2.9), '2 brindes');
});

test('cheerButtonText: "Brindar" ou "Brindaste", com a contagem a seguir quando há brindes', () => {
  assert.equal(c.cheerButtonText(0), 'Brindar');
  assert.equal(c.cheerButtonText(undefined), 'Brindar');
  assert.equal(c.cheerButtonText(1), 'Brindar · 1');
  assert.equal(c.cheerButtonText(12), 'Brindar · 12');
  assert.equal(c.cheerButtonText(12, true), 'Brindaste · 12');
  assert.equal(c.cheerButtonText(-4, true), 'Brindaste');
});

test('cheerButtonText: com a lista à vista a contagem vai no botão ao lado (não se repete)', () => {
  assert.equal(c.cheerButtonText(12, false, true), 'Brindar');
  assert.equal(c.cheerButtonText(12, true, true), 'Brindaste');
});

test('canListCheers: o dono sempre; o visitante só com cheersListable=true; servidor antigo nunca', () => {
  assert.equal(c.canListCheers({ cheers: 3 }, true), true);
  assert.equal(c.canListCheers({ cheers: 3, cheersListable: false }, true), true);
  assert.equal(c.canListCheers({ cheers: 3 }, false), false);
  assert.equal(c.canListCheers({ cheers: 3, cheersListable: false }, false), false);
  assert.equal(c.canListCheers({ cheers: 3, cheersListable: true }, false), true);
  assert.equal(c.canListCheers({ cheersListable: true }, false), false);
  assert.equal(c.canListCheers(undefined, true), false);
});

test('cheerersTitle: a minha geleira ou a de outra pessoa', () => {
  assert.equal(c.cheerersTitle(true, 'Ana Sousa'), 'Quem brindou a tua geleira');
  assert.equal(c.cheerersTitle(false, 'Ana Sousa'), 'Quem brindou a geleira de Ana Sousa');
  assert.equal(c.cheerersTitle(false, ' '), 'Quem brindou a geleira');
});

test('cheersBadge: vazio sem brindes, o número até 99, "99+" acima', () => {
  assert.equal(c.cheersBadge(0), '');
  assert.equal(c.cheersBadge(undefined), '');
  assert.equal(c.cheersBadge(-2), '');
  assert.equal(c.cheersBadge(1), '1');
  assert.equal(c.cheersBadge(99), '99');
  assert.equal(c.cheersBadge(100), '99+');
  assert.equal(c.cheersBadge(5000), '99+');
});

test('geleiraToggleLabel: abrir/fechar e os brindes, se houver', () => {
  assert.equal(c.geleiraToggleLabel(false, 0), 'Abrir a geleira');
  assert.equal(c.geleiraToggleLabel(false, undefined), 'Abrir a geleira');
  assert.equal(c.geleiraToggleLabel(false, 12), 'Abrir a geleira, 12 brindes');
  assert.equal(c.geleiraToggleLabel(true, 1), 'Fechar a geleira, 1 brinde');
});

test('cheerA11yLabel: brindar diz de quem é a geleira; tirar é "Tirar o brinde"', () => {
  assert.equal(c.cheerA11yLabel(false, 'Ana Sousa'), 'Brindar a geleira de Ana Sousa');
  assert.equal(c.cheerA11yLabel(false, '  '), 'Brindar a geleira');
  assert.equal(c.cheerA11yLabel(true, 'Ana Sousa'), 'Tirar o brinde');
});

test('ownerCheersA11yLabel: a contagem e o que faz', () => {
  assert.equal(c.ownerCheersA11yLabel(1), '1 brinde, ver quem brindou');
  assert.equal(c.ownerCheersA11yLabel(5), '5 brindes, ver quem brindou');
});

test('canCheer: só quando o servidor manda a contagem (servidor antigo → sem botão)', () => {
  assert.equal(c.canCheer(undefined), false);
  assert.equal(c.canCheer(null), false);
  assert.equal(c.canCheer({ points: 3, level: 1 }), false);
  assert.equal(c.canCheer({ cheers: Number.NaN }), false);
  assert.equal(c.canCheer({ cheers: 0 }), true);
  assert.equal(c.canCheer({ cheers: 4, cheered: true }), true);
});

test('toggleCheer: brindar soma 1, tirar tira 1, e o resto do nível fica igual', () => {
  const lv = { points: 20, level: 2, title: 'Fresca', cheers: 4, cheered: false };
  const on = c.toggleCheer(lv);
  assert.deepEqual(on, { ...lv, cheers: 5, cheered: true });
  assert.notEqual(on, lv, 'objeto novo');
  assert.equal(lv.cheers, 4, 'não mexe no original');
  assert.deepEqual(c.toggleCheer(on), lv);
});

test('toggleCheer: nunca desce abaixo de 0 e aguenta campos em falta', () => {
  assert.deepEqual(c.toggleCheer({ cheers: 0, cheered: true }), { cheers: 0, cheered: false });
  assert.deepEqual(c.toggleCheer({}), { cheers: 1, cheered: true });
});

test('applyCheer: a resposta do servidor manda (mesmo se outra pessoa brindou entretanto)', () => {
  const lv = { points: 20, level: 2, cheers: 5, cheered: true };
  assert.deepEqual(c.applyCheer(lv, { cheered: true, cheers: 9 }), { ...lv, cheers: 9, cheered: true });
  assert.deepEqual(c.applyCheer(lv, { cheered: false, cheers: -1 }), { ...lv, cheers: 0, cheered: false });
});
