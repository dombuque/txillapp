// Testes do selo de verificado na assinatura das fotos (src/lib/wordmark.ts e os três sítios da app que a gravam):
// - conta verificada: o @ e o selo ficam encostados à direita, o selo a seguir ao @, com 1,05 vezes a letra e uma folga;
// - conta não verificada (ou sem @): fica tudo como antes;
// - o desenho e as cores são os do VerifiedBadge, e a conta é igual à do servidor (api/src/media/signature.ts);
// - a TxillCam do site (TxCamera), o estúdio de tchekas e o editor do telemóvel (PhotoEditor) passam o selo de quem tem a sessão.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const w = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'wordmark.ts')).href);
const read = (...p) => readFileSync(path.join(ROOT, 'src', ...p), 'utf8').replace(/\r\n/g, '\n');
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} ≠ ${b}`);
const SIZES = [[1080, 1920], [1080, 1350], [600, 600], [1920, 1080], [375, 667]];

test('sem selo: a assinatura fica como antes (o @ acaba na margem, sem caixa do selo)', () => {
  for (const [W, H] of SIZES) {
    for (const seal of [undefined, null]) {
      const L = w.signLayout(W, H, true, seal);
      assert.equal(L.seal, null);
      assert.equal(L.textRight, L.right);
      assert.equal(L.right, W - Math.round(Math.min(W, H) * 0.04));
    }
    // Com selo mas sem @ (não há a quem o pôr ao lado): também nada.
    const bare = w.signLayout(W, H, false, 'verified');
    assert.equal(bare.seal, null);
    assert.equal(bare.textRight, bare.right);
  }
});

test('com selo: o selo encostado à direita, 1,05× a letra, a meio da letra; o @ acaba antes dele com uma folga', () => {
  for (const [W, H] of SIZES) {
    for (const tier of ['verified', 'official', 'paid']) {
      const L = w.signLayout(W, H, true, tier);
      const plain = w.signLayout(W, H, true);
      const b = L.seal;
      assert.ok(b, `${W}×${H} ${tier}`);
      assert.equal(b.tier, tier);
      close(b.size, L.userSize * 1.05, 'tamanho');
      close(b.k, b.size / 24, 'escala do path');
      close(b.x + b.size, L.right, 'encostado à direita');
      close(b.y + b.size / 2, L.userBaseline - L.userSize * 0.36, 'a meio da letra');
      const gap = b.x - L.textRight;
      close(gap, L.userSize * 0.15, 'folga');
      assert.ok(gap > 0 && gap < L.userSize * 0.3, 'pequena folga');
      // O selo não sai da foto nem desce muito abaixo da linha do @.
      assert.ok(b.y + b.size < H && b.y + b.size - L.userBaseline < L.userSize * 0.25);
      // O logótipo e a linha do @ não mexem.
      for (const k of ['s', 'x', 'y', 'right', 'userSize', 'userBaseline', 'blur']) assert.equal(L[k], plain[k], k);
    }
  }
});

test('sealOf: só contas verificadas levam selo, com o nível que trazem (verified, official ou paid)', () => {
  assert.equal(w.sealOf(null), null);
  assert.equal(w.sealOf(undefined), null);
  assert.equal(w.sealOf({ id: 'x', username: 'a', displayName: 'A' }), null); // respostas antigas, sem o campo
  assert.equal(w.sealOf({ verified: false, verifiedTier: 'official' }), null);
  assert.equal(w.sealOf({ verified: false, verifiedTier: 'paid' }), null);
  assert.equal(w.sealOf({ verified: true, verifiedTier: null }), 'verified');
  assert.equal(w.sealOf({ verified: true, verifiedTier: 'verified' }), 'verified');
  assert.equal(w.sealOf({ verified: true, verifiedTier: 'official' }), 'official');
  assert.equal(w.sealOf({ verified: true, verifiedTier: 'paid' }), 'paid');
  // Um nível que a app ainda não conhece: o selo do Txillapp de sempre.
  assert.equal(w.sealOf({ verified: true, verifiedTier: 'gold' }), 'verified');
});

test('as cores por nível: verificado e conta oficial a coral (vermelho do Txillapp); só a verificação paga é azul', () => {
  assert.equal(w.sealPaint('verified'), 'coral');
  assert.equal(w.sealPaint('official'), 'coral');
  assert.equal(w.sealPaint('paid'), 'blue');
  assert.equal(w.SEAL_BLUE, '#1d9bf0');
  assert.deepEqual([w.SEAL_CORAL.from, w.SEAL_CORAL.to], ['#ff6b81', '#d6334f']);
  assert.deepEqual(w.SEAL_LABEL, { verified: 'Perfil verificado', official: 'Conta oficial do Txillapp', paid: 'Verificado com subscrição' });
});

test('VerifiedBadge: o degradê coral para verified e official, o azul só para paid, e o texto do leitor de ecrã por nível', () => {
  const vb = read('components', 'VerifiedBadge.tsx');
  assert.match(vb, /const t: SealTier = tier === 'official' \|\| tier === 'paid' \? tier : 'verified';/);
  assert.match(vb, /const coral = sealPaint\(t\) === 'coral';/);
  assert.match(vb, /\{coral && \(\s*<Defs>\s*<LinearGradient id=\{id\} x1="0" y1="0" x2="1" y2="1">/);
  assert.match(vb, /<Path fill=\{coral \? `url\(#\$\{id\}\)` : '#1d9bf0'\} d=\{SEAL\} \/>/);
  assert.match(vb, /accessibilityLabel=\{SEAL_LABEL\[t\]\}/);
  // Um id por selo (na web os ids do SVG são da página toda).
  assert.match(vb, /const id = `seal\$\{useId\(\)/);
  assert.doesNotMatch(vb, /id="off"/);
});

test('os pintores da assinatura (TxillCam e estúdio pelo stampTxillapp, editor Skia) pintam pela mesma regra: coral salvo na verificação paga', () => {
  for (const f of ['TxCamera.tsx', 'PhotoEditor.tsx']) {
    const s = read('components', f);
    assert.match(s, /if \(sealPaint\(b\.tier\) === 'coral'\) \{\s*const o = SEAL_CORAL;/, f);
    assert.doesNotMatch(s, /b\.tier === 'official'/, f);
  }
});

test('o desenho e as cores do selo são os do VerifiedBadge', () => {
  const vb = read('components', 'VerifiedBadge.tsx');
  assert.equal(vb.match(/const SEAL =\s*'([^']+)'/)[1], w.SEAL_PATH);
  assert.match(vb, new RegExp(`strokeWidth=\\{${w.SEAL_CHECK_WIDTH}\\}[^>]*d="${w.SEAL_CHECK}"`));
  assert.match(vb, /viewBox="0 0 24 24"/);
  assert.equal(w.SEAL_BOX, 24);
  assert.match(vb, new RegExp(`'${w.SEAL_BLUE}'`));
  assert.match(vb, new RegExp(`stopColor="${w.SEAL_CORAL.from}"`));
  assert.match(vb, new RegExp(`stopColor="${w.SEAL_CORAL.to}"`));
  assert.match(vb, /x1="0" y1="0" x2="1" y2="1"/);
  // A roseta vai de 1,75 a 22,25 (o degradê da oficial cobre essa caixa, como o objectBoundingBox do SVG).
  assert.match(w.SEAL_PATH, /^M22\.25 12/);
  assert.deepEqual([w.SEAL_CORAL.x0, w.SEAL_CORAL.y0, w.SEAL_CORAL.x1, w.SEAL_CORAL.y1], [1.75, 1.75, 22.25, 22.25]);
});

test('o servidor desenha o mesmo selo com a mesma conta (api/src/media/signature.ts)', () => {
  const api = readFileSync(path.join(ROOT, '..', 'api', 'src', 'media', 'signature.ts'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(api.match(/export const SEAL_PATH =\s*'([^']+)'/)[1], w.SEAL_PATH);
  assert.equal(api.match(/const SEAL_CHECK = '([^']+)'/)[1], w.SEAL_CHECK);
  assert.equal(api.match(/const SEAL_BLUE = '([^']+)'/)[1], w.SEAL_BLUE);
  assert.match(api, new RegExp(`const SEAL_CORAL = \\['${w.SEAL_CORAL.from}', '${w.SEAL_CORAL.to}'\\]`));
  assert.match(api, new RegExp(`const SEAL_SCALE = ${w.SEAL_SCALE}, SEAL_GAP = ${w.SEAL_GAP}, SEAL_LIFT = ${w.SEAL_LIFT};`));
  // A mesma regra de cor e os mesmos níveis.
  const paint = (src) => src.match(/export const sealPaint = (\(tier: SealTier\)[^;]+);/)[1];
  assert.equal(paint(api), paint(read('lib', 'wordmark.ts')));
  assert.match(api, /export type SealTier = 'verified' \| 'official' \| 'paid';/);
  assert.match(read('lib', 'wordmark.ts'), /export type SealTier = 'verified' \| 'official' \| 'paid';/);
  assert.match(api, /fill="\$\{sealPaint\(b\.tier\) === 'blue' \? SEAL_BLUE : 'url\(#seal-coral\)'\}"/);
  // O corpo da conta é o mesmo, tirando os nomes das constantes (BOX / WORDMARK_BOX, 24 / SEAL_BOX).
  const body = (src, re) => {
    const at = src.search(re);
    return src.slice(src.indexOf('{', src.indexOf(')', at)) + 1, src.indexOf('\n}\n', at)).replace(/\s+/g, ' ').trim();
  };
  const app = read('lib', 'wordmark.ts');
  const norm = (s) => s.replace(/WORDMARK_BOX/g, 'BOX').replace(/SEAL_BOX/g, '24');
  assert.equal(norm(body(api, /export function signLayout\(/)), norm(body(app, /export function signLayout\(/)));
});

test('TxillCam (site): a assinatura leva o selo de quem tem a sessão e o @ acaba antes dele', () => {
  const cam = read('components', 'TxCamera.tsx');
  assert.match(cam, /export function stampTxillapp\(g: CanvasRenderingContext2D, W: number, H: number, username\?: string \| null, seal\?: SealTier \| null\)/);
  assert.match(cam, /const L = signLayout\(W, H, !!username, seal\);/);
  assert.match(cam, /g\.fillText\(`@\$\{username\}`, L\.textRight, L\.userBaseline\);/);
  assert.match(cam, /g\.fill\(new Path2D\(SEAL_PATH\)\);/);
  assert.match(cam, /g\.stroke\(new Path2D\(SEAL_CHECK\)\);/);
  assert.match(cam, /createLinearGradient\(o\.x0, o\.y0, o\.x1, o\.y1\)/);
  assert.match(cam, /const \{ user \} = useAuth\(\);/);
  assert.match(cam, /stampTxillapp\(g, w, h, user\?\.username, sealOf\(user\)\)/);
});

test('estúdio de tchekas: o vídeo leva o selo de quem tem a sessão', () => {
  const st = read('components', 'TchekaStudio.tsx');
  assert.match(st, /const \{ user \} = useAuth\(\);\n  const username = user\?\.username;\n  const seal = sealOf\(user\);/);
  assert.match(st, /stampTxillapp\(g, W, H, username, seal\);/);
});

test('editor do telemóvel (Skia): o selo vai na pré-visualização e na foto final', () => {
  const pe = read('components', 'PhotoEditor.tsx');
  assert.match(pe, /const seal = sealOf\(user\);/);
  assert.match(pe, /drawEdit\(c, pv, edit, pw, ph, previewFont, username, seal, sign\);/);
  assert.match(pe, /\}, \[pv, edit, pw, ph, previewFont, username, seal, sign\]\);/);
  assert.match(pe, /drawEdit\(surface\.getCanvas\(\), img, edit, outW, outH, signFont\(.*\), username, seal, sign\);/);
  assert.match(pe, /const L = signLayout\(W, H, !!username && !!font, seal\);/);
  assert.match(pe, /L\.textRight - font\.getTextWidth\(t\)/);
  assert.match(pe, /Skia\.Path\.MakeFromSVGString\(SEAL_PATH\)/);
  assert.match(pe, /Skia\.Path\.MakeFromSVGString\(SEAL_CHECK\)/);
  assert.match(pe, /MakeLinearGradient\(\{ x: o\.x0, y: o\.y0 \}, \{ x: o\.x1, y: o\.y1 \}/);
});

test('a sessão traz o selo: PublicUser da app com verified / verifiedTier (opcionais)', () => {
  const api = read('lib', 'api.ts');
  assert.match(api, /verified\?: boolean; verifiedTier\?: 'verified' \| 'official' \| 'paid' \| null;/);
});
