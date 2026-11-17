// Uniformização, Frente B (feed, publicações, tchekas, perfil, pesquisa, notificações e Mixar):
// - dar vibes: sempre o ícone `gift` e o verbo «Oferecer» (o `present` e o «Presentear» saíram);
// - o «⋯» sem traço à mão; a fila de ações a 24 e o carril das tchekas a 28;
// - o selo de verificado nas pessoas da folha de partilha, nas citações e nos duetos;
// - a moldura 9:16 do «Partilhar no mimo» e o editor de texto não encolhem com o teclado (lib/useStableFrame);
// - segurar numa publicação do feed ou num quadrado do perfil abre o mesmo menu do «⋯».
// Correr em apps/mobile:  node --test tests/uniformB.test.mjs
import { test } from 'node:test';
import './fixtures/alias.mjs'; // o alias @/ (os módulos usam t() de @/lib/i18n)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(path.join(ROOT, 'src', ...p), 'utf8').replace(/\r\n/g, '\n');
const card = read('components', 'PostCard.tsx');

test('oferecer vibes: ícone gift e verbo «Oferecer» nas publicações, tchekas e comentários', () => {
  for (const f of [['components', 'PostCard.tsx'], ['components', 'PostSheets.tsx'], ['components', 'CommentsSheet.tsx'], ['components', 'reel', 'HoldMenu.tsx'], ['components', 'ProfileView.tsx']]) {
    const s = read(...f);
    assert.doesNotMatch(s, /icon="present"|icon: 'present'|name="present"/, f.join('/'));
    assert.doesNotMatch(s, /'Presentear|"Presentear|>Presentear|`Presentear/, f.join('/'));
  }
  assert.match(card, /<BarBtn hot={hot} label=\{t\('Oferecer'\)\} a11y=\{t\('Oferecer vibes'\)\} icon="gift"/);
  assert.match(card, /icon: 'gift' as const, label: post\.gifts === 1 \? t\('presente'\) : t\('presentes'\)/);
  assert.match(read('components', 'PostSheets.tsx'), /<Sheet title=\{t\('Oferecer vibes a \{name\}', \{ name \}\)\}/);
  assert.match(read('components', 'reel', 'HoldMenu.tsx'), /'Oferecer vibes'\)/);
});

test('tamanhos de ícone por papel: fila de ações 24, carril 28, «⋯» sem traço à mão', () => {
  assert.match(card, /<Icon name=\{icon\} size=\{24\} color=\{color\} \/>/);
  assert.match(card, /<Icon name="more" size=\{24\} \/>/);
  const reels = read('app', '(tabs)', 'reels.tsx');
  for (const ic of ['repeat', 'share']) assert.match(reels, new RegExp(`<Icon name="${ic}" size=\\{28\\}`), ic);
  for (const f of [['components', 'PostCard.tsx'], ['components', 'ProfileView.tsx'], ['components', 'CommentsSheet.tsx'], ['components', 'reel', 'HoldMenu.tsx']]) {
    assert.doesNotMatch(read(...f), /<Icon name="more"[^>]*strokeWidth/, f.join('/'));
  }
  assert.match(read('components', 'remix', 'RemixRecorder.tsx'), /<Icon name="cam-flip"/);
});

test('selo de verificado: folha de partilha, citações, duetos e «Visto por» do Mixar', () => {
  const share = read('components', 'ShareSheet.tsx');
  assert.match(share, /interface Target extends Badged/);
  assert.match(share, /verified: c\.verified, verifiedTier: c\.verifiedTier/);
  assert.match(share, /<NameWithBadge name=\{x\.name\} who=\{x\} center/);
  assert.match(read('components', 'QuoteThread.tsx'), /<NameWithBadge name=\{`a citar \$\{quoted\.author\.displayName\}`\} who=\{quoted\.author\}/);
  assert.match(read('app', 'remixes', '[id].tsx'), /<NameWithBadge name=\{`@\$\{item\.author\.username\}`\} who=\{item\.author\}/);
  assert.match(read('components', 'mixar', 'MixarBits.tsx'), /<NameWithBadge name=\{line\} who=\{text \? null : partner\}/);
  assert.match(read('components', 'CommentsSheet.tsx'), /<InlineBadge who=\{post\.author\} fontSize=\{14\} \/> \{t\('desativou os comentários/);
});

test('teclado: a moldura do mimo e o editor de texto ficam do tamanho de antes; sem KeyboardAvoidingView', async () => {
  const share = read('components', 'ShareSheet.tsx');
  assert.match(share, /const \{ screen, lift \} = useStableFrame\(capFocus \|\| !!textEdit\);/);
  assert.match(share, /Math\.min\(screen\.h - insets\.top - insets\.bottom - 260, 640\)/);
  const tl = read('components', 'TextLayers.tsx');
  assert.doesNotMatch(tl, /<KeyboardAvoidingView|import \{[^}]*KeyboardAvoidingView/);
  assert.match(tl, /useStableFrame\(true\)/);
  const hook = read('lib', 'useStableFrame.ts');
  assert.match(hook, /stableScreen\(still\.current, \{ w: win\.width, h: win\.height \}, typing \|\| kb > 0\)/);
  // A conta de quanto sobe o painel (pura, no próprio ficheiro).
  const m = hook.match(/export function liftFor\(screenH: number, visibleBottom: number\): number \{([\s\S]*?)\n\}/);
  assert.ok(m);
  const liftFor = new Function('screenH', 'visibleBottom', m[1]);
  assert.equal(liftFor(800, 800), 0);
  assert.equal(liftFor(800, 500), 300);
  assert.equal(liftFor(800, 900), 0);
});

test('segurar abre o menu do «⋯»: no cartão (texto e fotos) e nos quadrados do perfil', () => {
  assert.match(card, /const hold = desktop \? undefined : \(\) => \{[^\n]*openMenu\(null\); \};/);
  assert.match(card, /onPress=\{goPost\}\n\s+onLongPress=\{hold\}/);
  assert.equal((card.match(/onLongPress=\{hold\}/g) ?? []).length, 3);
  assert.match(card, /onLongPress=\{onHold\}/);
  const pv = read('components', 'ProfileView.tsx');
  assert.match(pv, /onLongPress=\{onHold \? \(\) => onHold\(post\) : undefined\}/);
  assert.match(pv, /<PostMenuSheet\n\s+post=\{heldShown\}/);
});

test('listas: perfil, Explorar, hashtag e local com puxar para atualizar e a carregar sozinhas', () => {
  for (const f of [['components', 'ProfileView.tsx'], ['app', 'search.tsx'], ['app', 't', '[tag].tsx'], ['app', 'place', '[name].tsx']]) {
    const s = read(...f);
    assert.match(s, /usePullToRefresh\(/, f.join('/'));
    assert.match(s, /<PullView pull=\{pull\}>/, f.join('/'));
    assert.match(s, /<LoadMore onLoad=/, f.join('/'));
  }
});

test('Mixar: sem emojis no texto e confirmações na caixa da app', async () => {
  const x = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'mixar.ts')).href);
  assert.equal(x.challengeView({ id: 'c', options: [], myPick: 'p1', theirPicked: true, theirPick: 'p1', match: true }, 'Ana').line, 'Escolheram o mesmo!');
  assert.doesNotMatch(read('components', 'mixar', 'MixarPages.tsx'), /🎉/);
  for (const f of [['app', 'mixar', '[id].tsx'], ['components', 'mixar', 'MixarSocial.tsx'], ['components', 'mixar', 'useOpenMixar.ts'], ['components', 'mixar', 'useGroupMixar.ts']]) {
    assert.doesNotMatch(read(...f), /Alert\.alert/, f.join('/'));
  }
});
