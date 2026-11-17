// O visor dos mimos: o mimo num cartão 9:16 e a barra de responder/brindar/partilhar por baixo, fora da imagem, para nunca
// tapar a assinatura «txillapp @…» gravada no canto de baixo à direita (src/lib/storyFrame.ts).
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import './fixtures/alias.mjs'; // o alias @/ (os módulos usam t() de @/lib/i18n)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import './aliasHooks.mjs';

const f = await import(new URL('../src/lib/storyFrame.ts', import.meta.url).href);
const w = await import(new URL('../src/lib/wordmark.ts', import.meta.url).href);
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8').replace(/\r/g, '');

// Telemóveis (com e sem entalhe), ecrãs baixos, o PWA no iPhone, tablet e computador.
const SCREENS = [
  { w: 390, h: 844, top: 47, bottom: 34 }, // iPhone 14
  { w: 430, h: 932, top: 59, bottom: 34 }, // iPhone Pro Max
  { w: 375, h: 667, top: 20, bottom: 0 }, // iPhone SE
  { w: 320, h: 568, top: 20, bottom: 0 }, // iPhone 5 / ecrã muito baixo
  { w: 412, h: 915, top: 32, bottom: 24 }, // Android alto
  { w: 360, h: 640, top: 24, bottom: 48 }, // Android baixo com botões
  { w: 390, h: 664, top: 47, bottom: 34 }, // Safari com as barras à vista
  { w: 1440, h: 900, top: 0, bottom: 0, wide: true },
  { w: 1280, h: 620, top: 0, bottom: 0, wide: true },
  { w: 820, h: 1180, top: 24, bottom: 20, wide: true },
];

test('o cartão é 9:16, cabe no ecrã e a barra fica por baixo dele, dentro da zona segura', () => {
  for (const s of SCREENS) {
    const fr = f.storyFrame(s);
    const tag = JSON.stringify(s);
    assert.ok(fr.cardW > 150, tag);
    assert.ok(Math.abs(fr.cardW / fr.cardH - 9 / 16) < 0.01, `${tag} forma ${fr.cardW}×${fr.cardH}`);
    assert.ok(fr.cardLeft >= 0 && fr.cardLeft + fr.cardW <= s.w, tag);
    assert.ok(fr.cardTop >= (s.wide ? 0 : s.top), `${tag} por baixo da barra de estado`);
    assert.equal(fr.barTop, fr.cardTop + fr.cardH, `${tag} a barra começa onde o cartão acaba`);
    assert.ok(fr.barTop + fr.barH <= s.h - (s.wide ? 0 : s.bottom), `${tag} a barra fica acima da zona do gesto`);
  }
  // No telemóvel o cartão ocupa a largura toda quando há altura; num ecrã baixo encolhe (e fica ao meio).
  assert.equal(f.storyFrame(SCREENS[0]).cardW, 390);
  const low = f.storyFrame(SCREENS[3]);
  assert.ok(low.cardW < 320 && low.cardLeft > 0);
  assert.ok(f.storyFrame(SCREENS[7]).cardW <= f.WIDE_MAX_W);
});

test('a caixa da assinatura é a mesma conta da signLayout (servidor e câmara)', () => {
  for (const [W, H] of [[1080, 1920], [720, 1280], [1080, 1080], [1920, 1080]]) {
    const L = w.signLayout(W, H, true, 'verified');
    const r = f.signatureRect(W, H, 'txillapp');
    assert.ok(Math.abs(r.x + r.w - L.right) <= 1, 'lado direito');
    assert.ok(r.y <= L.y + 1, 'o topo do logótipo');
    assert.ok(r.y + r.h >= L.userBaseline, 'a linha do @');
    assert.ok(r.x <= L.x + 1, 'a esquerda do logótipo');
    assert.ok(r.x + r.w <= W && r.y + r.h <= H);
  }
  // Um @ comprido passa para a esquerda do logótipo.
  assert.ok(f.signatureRect(1080, 1920, 'um_nome_mesmo_muito_comprido').x < f.signatureRect(1080, 1920, 'ana').x);
});

test('a assinatura fica inteira dentro do cartão (também nos cantos redondos) e nada a tapa', () => {
  for (const s of SCREENS) {
    const fr = f.storyFrame(s);
    for (const ratio of [9 / 16, 0.57, 0.55, 3 / 4, 4 / 5, 1, 16 / 9, 0.45]) {
      const fit = f.mimoFit(ratio, fr.cardW, fr.cardH);
      const shown = f.shownRect(ratio, fr.cardW, fr.cardH, fit);
      for (const u of ['ana', 'txillapp_oficial']) {
        const sig = f.signatureInCard(shown, u);
        const tag = `${JSON.stringify(s)} forma ${ratio.toFixed(3)} ${fit}`;
        // Toda dentro do cartão, sem o canto redondo a comer o fim do @ ou o selo.
        for (const [x, y] of [[sig.x, sig.y], [sig.x + sig.w, sig.y], [sig.x, sig.y + sig.h], [sig.x + sig.w, sig.y + sig.h]]) {
          assert.ok(f.insideRounded(x, y, fr.cardW, fr.cardH, fr.radius), `${tag}: (${x.toFixed(1)}, ${y.toFixed(1)}) fora`);
        }
        // O cabeçalho fica em cima, a legenda acima da reserva, a barra fora do cartão.
        assert.ok(sig.y >= f.HEADER_H + 46, `${tag}: o cabeçalho (com a música) tapava`);
        const cap = f.captionSpot(fr.cardW, fr.cardH, ratio);
        if (cap.maxHeight) assert.ok(fr.cardH - cap.bottom - cap.maxHeight >= shown.y + shown.h, `${tag}: a legenda subia para a foto`);
        else assert.ok(fr.cardH - cap.bottom <= sig.y, `${tag}: a legenda tapava`);
        assert.ok(fr.cardTop + sig.y + sig.h <= fr.barTop, `${tag}: a barra tapava`);
      }
    }
  }
});

test('os comentários a flutuar ficam à esquerda, na metade de baixo, acima da legenda e longe da assinatura', () => {
  for (const s of SCREENS) {
    const fr = f.storyFrame(s);
    for (const ratio of [null, 9 / 16, 0.57, 3 / 4, 4 / 5, 1, 16 / 9, 0.45]) {
      const fit = f.mimoFit(ratio, fr.cardW, fr.cardH);
      const shown = ratio ? f.shownRect(ratio, fr.cardW, fr.cardH, fit) : { x: 0, y: 0, w: fr.cardW, h: fr.cardH };
      for (const capH of [0, 33, 56, 92]) {
        const col = f.floatColumn(fr.cardW, fr.cardH, ratio, capH);
        const tag = `${JSON.stringify(s)} forma ${ratio} legenda ${capH}`;
        const colBottomY = fr.cardH - col.bottom;
        // Largura até 62% do cartão, encostada à esquerda, na metade de baixo e por baixo do cabeçalho (com a música).
        assert.ok(col.left >= 8 && col.width <= fr.cardW * f.FLOAT_MAX_W && col.left + col.width < fr.cardW, tag);
        assert.ok(col.top >= f.HEADER_H + 46, `${tag}: o cabeçalho`);
        // Na metade de baixo, a não ser que a assinatura (foto deitada) ou a legenda obriguem a subir para caberem dois.
        if (col.top < fr.cardH / 2 - 1) assert.ok(col.height <= 2 * f.FLOAT_BUBBLE_H + f.FLOAT_GAP, `${tag}: subiu sem precisar`);
        assert.ok(col.top + col.height <= colBottomY + 0.5, `${tag}: a coluna passa do fundo`);
        // Os balões que cabem (cada um no máximo FLOAT_BUBBLE_H) ficam dentro da coluna.
        assert.ok(col.max * f.FLOAT_BUBBLE_H + Math.max(0, col.max - 1) * f.FLOAT_GAP <= col.height, `${tag}: ${col.max} balões não cabem`);
        // Nunca chega à assinatura (nem com um @ comprido) nem à legenda.
        for (const u of ['ana', 'txillapp_oficial', 'um_nome_bem_comprido']) assert.ok(colBottomY <= f.signatureInCard(shown, u).y, `${tag}: tapava a assinatura de @${u}`);
        if (capH) assert.ok(colBottomY <= fr.cardH - f.captionSpot(fr.cardW, fr.cardH, ratio).bottom - capH, `${tag}: tapava a legenda`);
      }
      // Sem legenda há sempre lugar para dois balões, pelo menos.
      assert.ok(f.floatColumn(fr.cardW, fr.cardH, ratio, 0).max >= 2, `${JSON.stringify(s)} forma ${ratio}: pouco lugar`);
    }
  }
});

test('a foto só enche (cover) quando quase não corta; de outra forma aparece inteira', () => {
  const fr = f.storyFrame(SCREENS[0]);
  assert.equal(f.mimoFit(9 / 16, fr.cardW, fr.cardH), 'cover');
  assert.equal(f.mimoFit(1080 / 1918, fr.cardW, fr.cardH), 'cover');
  for (const r of [3 / 4, 4 / 5, 1, 16 / 9, 0.46]) assert.equal(f.mimoFit(r, fr.cardW, fr.cardH), 'contain', String(r));
  assert.equal(f.mimoFit(null, fr.cardW, fr.cardH), 'contain');
  // Sem saber a forma, a legenda fica acima da assinatura de uma media que enche o cartão.
  assert.ok(f.captionSpot(fr.cardW, fr.cardH, null).bottom >= fr.cardW * 0.145);
});

test('o visor usa o cartão, a barra por baixo dele e o vídeo inteiro', () => {
  const v = read('app/stories/[username].tsx');
  assert.match(v, /const frame = storyFrame\(/);
  assert.match(v, /contentFit=\{mimoFit\(/);
  // A barra vive fora do cartão (irmã dele), presa ao fim do cartão; a escrever só sobe para cima do teclado.
  assert.match(v, /const restBottom = stage\.h - \(frame\.barTop \+ frame\.barH\);/);
  assert.match(v, /<View style=\{\[st\.bar, \{ left: frame\.cardLeft, width: frame\.cardW, minHeight: frame\.barH, bottom: replyBottom \}\]\}/);
  assert.match(v, /<View style=\{\[st\.card, \{ left: frame\.cardLeft, top: frame\.cardTop, width: frame\.cardW, height: frame\.cardH, borderRadius: frame\.radius \}\]\}>/);
  // O cartão não salta nem encolhe com o teclado: o tamanho fica o de antes enquanto ele está aberto (lib/keyboardFrame).
  assert.match(v, /still\.current = heldSize\(still\.current, \{ w: root\.w \|\| width, h: rootH \}, keyboardOpen\);/);
  assert.match(v, /contentFit="contain" nativeControls=\{false\}/);
  assert.match(v, /objectFit: 'contain'/);
  // A legenda fica acima da assinatura.
  assert.match(v, /captionSpot\(frame\.cardW, frame\.cardH, /);
  // O brinde da barra: o ícone da marca, aceso na cor quente, e os copos no meio do mimo.
  const p = read('components/StoryParts.tsx');
  assert.match(p, /<Icon name="cheers" size=\{26\} color=\{cheered \? colors\.brandWarm : '#fff'\}/);
  assert.match(v, /<CheersPour n=\{burst\}/);
});
