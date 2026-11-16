// Criar volta ao modo onde estava (e o preparar da Txillada ao que se tinha escrito) quando a app recarrega ao voltar à
// vista ou o ecrã volta a montar (src/lib/createKeep.ts, app/(tabs)/new.tsx, components/txillada/TxilladaPrep.tsx).
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const k = await import(new URL('../src/lib/createKeep.ts', import.meta.url).href);
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8').replace(/\r/g, '');
const NOW = 1_800_000_000_000;

test('o modo guardado volta durante 30 minutos; depois (ou estragado, ou desconhecido) abre no Mimo', () => {
  assert.equal(k.decodeMode(k.encodeKeep('txillada', NOW), NOW + 5_000), 'txillada');
  assert.equal(k.decodeMode(k.encodeKeep('tcheka', NOW), NOW + k.KEEP_MS), 'tcheka');
  assert.equal(k.decodeMode(k.encodeKeep('txillada', NOW), NOW + k.KEEP_MS + 1), null, 'velho demais');
  assert.equal(k.decodeMode(k.encodeKeep('txillada', NOW + 10 * 60_000), NOW), null, 'do futuro (relógio mudou)');
  for (const raw of [null, undefined, '', '{', 'null', '"txillada"', JSON.stringify({ v: 'txillada' }), k.encodeKeep('camera', NOW), k.encodeKeep(3, NOW)]) {
    assert.equal(k.decodeMode(raw, NOW), null, String(raw));
  }
  for (const m of ['mimo', 'post', 'tcheka', 'zas', 'txillada']) assert.equal(k.decodeMode(k.encodeKeep(m, NOW), NOW), m);
});

test('o rascunho do preparar volta limpo: só os tipos e os limites que o ecrã aceita', () => {
  const f = { title: 'Bom dia Maputo', kind: 'paid', closeOnly: false, price: '50', fund: true, goal: '500', purpose: 'Livros para a escola' };
  assert.deepEqual(k.decodePrep(k.encodeKeep(f, NOW), NOW + 60_000), f);
  const bad = k.decodePrep(k.encodeKeep({ title: 'x'.repeat(200), kind: 'vip', closeOnly: 'sim', price: '12a34567', fund: 1, goal: '-99999999', purpose: 7 }, NOW), NOW);
  assert.deepEqual(bad, { title: 'x'.repeat(80), kind: 'public', closeOnly: false, price: '1234', fund: false, goal: '9999999', purpose: '' });
  assert.equal(k.decodePrep(k.encodeKeep(f, NOW), NOW + k.KEEP_MS + 1), null);
  assert.equal(k.decodePrep('nada', NOW), null);
  assert.equal(k.decodePrep(k.encodeKeep('texto', NOW), NOW), null);
  assert.equal(k.prepIsEmpty(k.EMPTY_PREP), true);
  assert.equal(k.prepIsEmpty({ ...k.EMPTY_PREP, kind: 'friends' }), false);
  assert.equal(k.prepIsEmpty({ ...k.EMPTY_PREP, goal: '10' }), false);
});

test('cada conta tem o seu rascunho; sem localStorage (telemóvel) fica na memória', () => {
  assert.notEqual(k.keyFor(k.PREP_KEY, 'zeca'), k.keyFor(k.PREP_KEY, 'ana'));
  assert.equal(k.keyFor(k.MODE_KEY, null), `${k.MODE_KEY}:-`);
  assert.equal(globalThis.localStorage, undefined);
  k.keepWrite('t-mem', 'um');
  assert.equal(k.keepRead('t-mem'), 'um');
  k.keepWrite('t-mem', null);
  assert.equal(k.keepRead('t-mem'), null);
  // Com localStorage (site): guarda lá e sobrevive a recarregar (a memória perde-se, o localStorage não).
  const box = new Map();
  globalThis.localStorage = { getItem: (x) => box.get(x) ?? null, setItem: (x, v) => box.set(x, String(v)), removeItem: (x) => box.delete(x) };
  try {
    k.keepWrite('t-ls', 'dois');
    assert.equal(box.get('t-ls'), 'dois');
    assert.equal(k.keepRead('t-ls'), 'dois');
    globalThis.localStorage = { getItem: () => { throw new Error('bloqueado'); }, setItem: () => { throw new Error('cheio'); }, removeItem: () => {} };
    k.keepWrite('t-ls2', 'três');
    assert.equal(k.keepRead('t-ls2'), 'três', 'bloqueado: fica a memória, sem lançar erros');
  } finally {
    delete globalThis.localStorage;
  }
});

test('a Txillada só sai do modo quando a configuração chegou e diz desligada', () => {
  assert.equal(k.dropTxillada('txillada', false, false), false, 'a configuração ainda não chegou (logo depois de recarregar)');
  assert.equal(k.dropTxillada('txillada', true, true), false);
  assert.equal(k.dropTxillada('txillada', false, true), true);
  assert.equal(k.dropTxillada('mimo', false, true), false);
});

test('Criar e o preparar usam o que ficou guardado', () => {
  const s = read('app/(tabs)/new.tsx');
  assert.match(s, /useState\(\(\) => decodeMode\(keepRead\(modeKey\), Date\.now\(\)\) \?\? 'mimo'\)/);
  assert.match(s, /keepWrite\(modeKey, encodeKeep\(kindSel, Date\.now\(\)\)\)/);
  assert.match(s, /dropTxillada\(kindSel, txilladaOn, txilladaKnown\)/);
  assert.doesNotMatch(s, /if \(!txilladaOn && kindSel === 'txillada'\) setKindSel\('mimo'\)/, 'já não sai da Txillada enquanto a configuração carrega');
  const prep = read('components/txillada/TxilladaPrep.tsx');
  assert.match(prep, /decodePrep\(keepRead\(prepKey\), Date\.now\(\)\) \?\? EMPTY_PREP/);
  assert.match(prep, /keepWrite\(prepKey, prepIsEmpty\(f\) \? null : encodeKeep\(f, Date\.now\(\)\)\)/);
  assert.match(prep, /keyFor\(PREP_KEY, user\?\.username\)/);
});
