// Testes do cartão do convite (src/lib/inviteCard.ts): a frase, os itens da Geleira (sem álcool para menores), o texto de
// partilha, o progresso e o desenho do cartão.
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const c = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'inviteCard.ts')).href);
const { qrMatrix } = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'qr.ts')).href);
const STICKERS = JSON.parse(readFileSync(path.join(ROOT, 'src', 'assets', 'stickers.json'), 'utf8')).items;

test('as frases são as três pedidas, em calão da malta, e cada uma tem o seu Gelinho na biblioteca', () => {
  assert.deepEqual([...c.INVITE_PHRASES], ['Bora txilar no Txillapp, malta!', 'A tua malta já cá está', 'Traz a tua vibe']);
  assert.equal(c.PHRASE_STICKERS.length, c.INVITE_PHRASES.length);
  for (const id of c.PHRASE_STICKERS) {
    const s = STICKERS.find((x) => x.id === id);
    assert.ok(s, `sticker ${id} existe`);
    assert.match(s.svg, /#9bd8ff/, `${id} é o Gelinho (a geleira azul)`);
  }
});

test('phraseIndexOf: sempre a mesma frase para o mesmo código, dentro da lista; bate certo com o servidor', () => {
  for (const code of ['ABCD2345', 'ZZZK9QWE', '', 'X']) {
    const i = c.phraseIndexOf(code);
    assert.ok(Number.isInteger(i) && i >= 0 && i < c.INVITE_PHRASES.length);
    assert.equal(c.phraseIndexOf(code), i);
  }
  // A mesma conta do servidor (api/src/invites/card.ts): h = h*31 + código da letra, sem sinal, módulo 3.
  let h = 0;
  for (const ch of 'ABCD2345') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  assert.equal(c.phraseIndexOf('ABCD2345'), h % 3);
  assert.equal(c.phraseIndexOf(undefined), 0);
});

test('nextPhrase: anda em roda e aguenta lixo', () => {
  assert.equal(c.nextPhrase(0), 1);
  assert.equal(c.nextPhrase(1), 2);
  assert.equal(c.nextPhrase(2), 0);
  assert.equal(c.nextPhrase(-1), 0);
  assert.equal(c.nextPhrase(Number.NaN), 1);
});

const GELEIRA = [
  { name: '2M', kind: 'bebida', alcoholic: true, favorite: true },
  { name: 'Matapa', kind: 'comida' },
  { name: 'Sumo de manga', kind: 'bebida' },
  { name: 'Xima', kind: 'comida' },
  { name: 'Praia do Tofo', kind: 'sitio' },
  { name: 'Marrabenta', kind: 'vibe' },
];

test('pickCardItems: nunca álcool se quem convida for menor ou se não se sabe a idade', () => {
  for (const adult of [false, undefined, null, 'true', 1]) {
    const got = c.pickCardItems(GELEIRA, { adult }).map((i) => i.name);
    assert.ok(!got.includes('2M'), `adult=${adult}: sem álcool`);
    assert.equal(got.length, 4);
  }
  assert.ok(c.pickCardItems(GELEIRA, { adult: true }).map((i) => i.name).includes('2M'));
});

test('pickCardItems: tipos diferentes primeiro, pela ordem que chega, no máximo 4', () => {
  assert.deepEqual(c.pickCardItems(GELEIRA, { adult: true }).map((i) => i.name), ['2M', 'Matapa', 'Praia do Tofo', 'Marrabenta']);
  assert.deepEqual(c.pickCardItems(GELEIRA, { adult: false }).map((i) => i.name), ['Matapa', 'Sumo de manga', 'Praia do Tofo', 'Marrabenta']);
  assert.deepEqual(c.pickCardItems(GELEIRA, { adult: false, max: 3 }).map((i) => i.name), ['Matapa', 'Sumo de manga', 'Praia do Tofo']);
  // Só um tipo: enche com o resto, sem repetir.
  assert.deepEqual(c.pickCardItems([{ name: 'A', kind: 'comida' }, { name: 'B', kind: 'comida' }]).map((i) => i.name), ['A', 'B']);
  assert.equal(c.pickCardItems(GELEIRA, { adult: true, max: 9 }).length, 4);
});

test('pickCardItems: nomes repetidos ou vazios ficam de fora; lista em falta dá vazio', () => {
  const got = c.pickCardItems([{ name: 'Xima', kind: 'comida' }, { name: ' xima ', kind: 'comida' }, { name: '', kind: 'vibe' }, { name: '   ', kind: 'vibe' }]);
  assert.deepEqual(got.map((i) => i.name), ['Xima']);
  assert.deepEqual(c.pickCardItems(undefined), []);
  assert.deepEqual(c.pickCardItems(null, { adult: true }), []);
});

test('inviteShareText: a frase, o prémio, o código e a ligação sozinha na última linha', () => {
  const t = c.inviteShareText({ link: 'https://txillapp.com/c/ABCD2345', code: 'ABCD2345', reward: 50, phrase: 0 });
  assert.equal(t, 'Bora txilar no Txillapp, malta! Entra com o meu convite e ganhas 50 Txills logo à entrada. Código: ABCD2345\nhttps://txillapp.com/c/ABCD2345');
  assert.equal(t.split('\n').pop(), 'https://txillapp.com/c/ABCD2345');
  // Sem prémio não promete Txills; frase fora da lista volta à roda.
  const s = c.inviteShareText({ link: 'L', code: 'C', reward: 0, phrase: 4 });
  assert.equal(s, 'A tua malta já cá está Entra com o meu convite. Código: C\nL');
  assert.ok(!/Txills/.test(c.inviteShareText({ link: 'L', code: 'C', reward: Number.NaN })));
});

test('whatsappUrl: a app no telemóvel, wa.me no browser, com o texto codificado', () => {
  assert.equal(c.whatsappUrl('olá & adeus\nhttps://x/c/A', true), 'whatsapp://send?text=ol%C3%A1%20%26%20adeus%0Ahttps%3A%2F%2Fx%2Fc%2FA');
  assert.ok(c.whatsappUrl('a', false).startsWith('https://wa.me/?text='));
});

test('inviteProgress: «entraram 3, 1 já te deu Txills» e as variantes', () => {
  assert.equal(c.inviteProgress({ invited: 3, paid: 1 }), 'Entraram 3, 1 já te deu Txills');
  assert.equal(c.inviteProgress({ invited: 3, paid: 2 }), 'Entraram 3, 2 já te deram Txills');
  assert.equal(c.inviteProgress({ invited: 3, paid: 0 }), 'Entraram 3, ainda nenhum te deu Txills');
  assert.equal(c.inviteProgress({ invited: 1, paid: 0 }), 'Entrou 1, ainda não te deu Txills');
  assert.equal(c.inviteProgress({ invited: 1, paid: 1 }), 'Entrou 1 e já te deu Txills');
  assert.equal(c.inviteProgress({ invited: 0, paid: 0 }), 'Ainda ninguém entrou com o teu convite');
  assert.equal(c.inviteProgress(undefined), 'Ainda ninguém entrou com o teu convite');
  // Lixo do servidor: nunca «mais pagos do que entraram», nem negativos.
  assert.equal(c.inviteProgress({ invited: 2, paid: 9 }), 'Entraram 2, 2 já te deram Txills');
  assert.equal(c.inviteProgress({ invited: -4, paid: -1 }), 'Ainda ninguém entrou com o teu convite');
});

test('fitText e initialsOf', () => {
  assert.equal(c.fitText('Amélia', 10), 'Amélia');
  assert.equal(c.fitText('Dércio Langa da Silva Machava', 12), 'Dércio Lang…');
  assert.equal([...c.fitText('😀😀😀😀😀', 3)].length, 3);
  assert.equal(c.initialsOf('amélia mussa da silva'), 'AM');
  assert.equal(c.initialsOf(''), 'T');
});

test('stickerParts: tira o invólucro, guarda a caixa e corta scripts e ligações', () => {
  const s = STICKERS.find((x) => x.id === 'vem-ca').svg;
  const p = c.stickerParts(s);
  assert.equal(p.vb.length, 4);
  assert.ok(!p.body.includes('<svg') && !p.body.includes('aria-label'));
  const bad = c.stickerParts('<svg viewBox="0 0 10 10"><script>alert(1)</script><a href="https://x"><rect onclick="x()" width="1"/></a></svg>');
  assert.ok(!/script|href|onclick/.test(bad.body));
  assert.equal(c.stickerParts('<svg><rect/></svg>'), null);
  assert.equal(c.stickerParts(null), null);
});

const input = (over = {}) => ({
  format: 'post', code: 'ABCD2345', displayName: 'Amélia Mussa', items: ['Matapa', 'Sumo de manga', 'Praia'], reward: 50, phrase: 0,
  stickerSvg: STICKERS.find((x) => x.id === 'vem-ca').svg, qr: qrMatrix('https://txillapp.com/c/ABCD2345'), hasAvatar: true, ...over,
});

test('cardLayout: 1080×1350 para conversas e 1080×1920 para o Status; tudo dentro do cartão', () => {
  for (const format of ['post', 'status']) {
    const l = c.cardLayout(input({ format }));
    assert.deepEqual([l.width, l.height], format === 'post' ? [1080, 1350] : [1080, 1920]);
    assert.ok(l.svg.startsWith('<svg') && l.svg.endsWith('</svg>'));
    assert.ok(!/<text/.test(l.svg), 'o fundo não leva letras (a Skia e o canvas pintam-nas)');
    for (const t of l.texts) {
      assert.ok(t.x >= 0 && t.x <= l.width && t.y > 0 && t.y < l.height, `«${t.text}» dentro do cartão`);
      assert.ok(t.size >= 20, 'letras legíveis');
    }
    assert.ok(l.avatar.cy - l.avatar.r > 0);
  }
});

test('cardLayout: leva o nome, a frase, os itens e o código; o QR e o Gelinho vão no fundo', () => {
  const l = c.cardLayout(input());
  const all = l.texts.map((t) => t.text);
  for (const s of ['Amélia Mussa', 'convidou-te para o Txillapp', 'Bora txilar no Txillapp, malta!', 'Na geleira', 'Matapa', 'Sumo de manga', 'Praia', 'ABCD2345', '+50 Txills para ti · txillapp.com']) assert.ok(all.includes(s), s);
  assert.match(l.svg, /#9bd8ff/); // o Gelinho
  assert.match(l.svg, /M\d+ \d+h1v1h-1z/); // o QR
  assert.match(l.label, /Amélia Mussa/);
  assert.match(l.label, /Código ABCD2345/);
  // Com foto, sem iniciais; sem foto, as iniciais no círculo.
  assert.ok(!all.includes('AM'));
  assert.ok(c.cardLayout(input({ hasAvatar: false })).texts.some((t) => t.text === 'AM'));
});

test('cardLayout: sem itens não há «Na geleira»; sem QR nem sticker continua a dar', () => {
  const l = c.cardLayout(input({ items: [], qr: null, stickerSvg: null }));
  assert.ok(!l.texts.some((t) => t.text === 'Na geleira'));
  assert.ok(!/h1v1h-1z/.test(l.svg));
  assert.ok(!/#9bd8ff/.test(l.svg));
});

test('cardLayout: nomes enormes cortam-se; letras perigosas não partem o SVG com texto', () => {
  const l = c.cardLayout(input({ displayName: 'Zé <b>"& Langa da Silva Machava Cossa Mondlane' }));
  const name = l.texts.find((t) => t.weight === 800 && t.text.startsWith('Zé'));
  assert.ok([...name.text].length <= 24 && name.text.endsWith('…'));
  const svg = c.cardSvgWithText(l);
  assert.ok(!svg.includes('<b>') && svg.includes('&lt;b&gt;&quot;&amp;'));
});

test('cardLayout: as pastilhas da geleira não passam da largura (no máximo duas linhas)', () => {
  const l = c.cardLayout(input({ items: ['Um nome mesmo muito comprido', 'Outro nome muito comprido', 'Mais um nome comprido', 'E o quarto nome comprido'] }));
  const rects = [...l.svg.matchAll(/<rect x="([\d.]+)" y="(\d+)" width="(\d+)" height="70"/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]), w: Number(m[3]) }));
  assert.ok(rects.length >= 2 && rects.length <= 4);
  for (const r of rects) assert.ok(r.x >= 60 && r.x + r.w <= 1020, 'dentro das margens');
  assert.ok(new Set(rects.map((r) => r.y)).size <= 2);
});
