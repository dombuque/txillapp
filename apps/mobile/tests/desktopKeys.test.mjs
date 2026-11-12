// Funções de computador (src/lib/desktopKeys.ts, src/lib/deskPolish.ts e quem as usa): atalhos globais, teclas dos visores,
// botão direito, o Sheet em modo de computador, sem deslizar com o rato, e nada a mudar no telemóvel.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const k = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'desktopKeys.ts')).href);
const pol = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'deskPolish.ts')).href);
// Sem os \r do Windows (autocrlf): as regras abaixo procuram quebras de linha.
const read = (p) => readFileSync(path.join(ROOT, 'src', p), 'utf8').replace(/\r\n/g, '\n');

const ctx = (o = {}) => ({ typing: false, overlay: false, path: '/', ...o });
const key = (keyName, o = {}) => ({ key: keyName, ...o });
const act = (e, c = ctx(), chordAt = null, now = 10_000) => k.shortcutFor(e, c, chordAt, now).action;

test('atalhos: «/» e Ctrl/Cmd+K pesquisam, «n» nova publicação, «?» ajuda', () => {
  assert.equal(act(key('/')), 'search');
  assert.equal(act(key('k', { ctrlKey: true })), 'search');
  assert.equal(act(key('K', { metaKey: true })), 'search');
  assert.equal(act(key('n')), 'new');
  assert.equal(act(key('?', { shiftKey: true })), 'help');
  assert.equal(act(key('x')), null);
});

test('atalhos: «g» e depois «h», «m», «p», «n» (só dentro do tempo)', () => {
  const g = k.shortcutFor(key('g'), ctx(), null, 1000);
  assert.equal(g.action, null);
  assert.equal(g.chordAt, 1000);
  assert.equal(act(key('h'), ctx(), 1000, 1500), 'home');
  assert.equal(act(key('m'), ctx(), 1000, 1500), 'messages');
  assert.equal(act(key('p'), ctx(), 1000, 1500), 'profile');
  assert.equal(act(key('n'), ctx(), 1000, 1500), 'notifications');
  // Fora do tempo, o «n» volta a ser «nova publicação» e o «h» não faz nada.
  assert.equal(act(key('n'), ctx(), 1000, 1000 + k.CHORD_MS + 1), 'new');
  assert.equal(act(key('h'), ctx(), 1000, 1000 + k.CHORD_MS + 1), null);
  // Outra tecla desarma o «g».
  assert.equal(k.shortcutFor(key('x'), ctx(), 1000, 1200).chordAt, null);
  assert.equal(k.ROUTE_OF.home, '/');
  assert.equal(k.ROUTE_OF.messages, '/messages');
  assert.equal(k.ROUTE_OF.profile, '/profile');
});

test('atalhos: nunca a escrever, nunca com uma folha aberta, nunca com Alt ou outras combinações', () => {
  for (const e of [key('/'), key('n'), key('g'), key('?'), key('k', { ctrlKey: true })]) {
    assert.equal(act(e, ctx({ typing: true })), null, `${e.key} a escrever`);
    assert.equal(act(e, ctx({ overlay: true })), null, `${e.key} com folha aberta`);
  }
  assert.equal(act(key('n', { altKey: true })), null);
  assert.equal(act(key('n', { ctrlKey: true })), null); // Ctrl+N é do browser (janela nova)
  assert.equal(act(key('/', { metaKey: true })), null);
});

test('atalhos: nas Mensagens o Ctrl/Cmd+K é da equipa das Mensagens (procurar conversas); «/» continua a pesquisar', () => {
  assert.equal(act(key('k', { ctrlKey: true }), ctx({ path: '/messages' })), null);
  assert.equal(act(key('k', { metaKey: true }), ctx({ path: '/messages/ana' })), null);
  assert.equal(act(key('/'), ctx({ path: '/messages' })), 'search');
  assert.equal(k.inMessages('/messages'), true);
  assert.equal(k.inMessages('/messagesx'), false);
  // O componente não faz preventDefault quando não há ação (o Ctrl+K chega às Mensagens).
  const sc = read('components/DesktopShortcuts.tsx');
  assert.match(sc, /if \(!r\.action\) return;\n\s+e\.preventDefault\(\);/);
});

test('isTypingTarget: campos de texto sim; botões, caixas e o resto não', () => {
  const el = (tagName, type = null, extra = {}) => ({ tagName, getAttribute: (n) => (n === 'type' ? type : null), ...extra });
  assert.equal(k.isTypingTarget(el('INPUT')), true);
  assert.equal(k.isTypingTarget(el('INPUT', 'search')), true);
  assert.equal(k.isTypingTarget(el('TEXTAREA')), true);
  assert.equal(k.isTypingTarget(el('DIV', null, { isContentEditable: true })), true);
  assert.equal(k.isTypingTarget(el('INPUT', 'checkbox')), false);
  assert.equal(k.isTypingTarget(el('DIV')), false);
  assert.equal(k.isTypingTarget(null), false);
});

test('visores: ←/→ anterior e seguinte, ↑/↓ (tchekas), espaço pausa, Esc fecha; com Ctrl/Cmd não', () => {
  assert.equal(k.viewerKey(key('ArrowLeft')), 'prev');
  assert.equal(k.viewerKey(key('ArrowRight')), 'next');
  assert.equal(k.viewerKey(key('ArrowUp')), 'up');
  assert.equal(k.viewerKey(key('ArrowDown')), 'down');
  assert.equal(k.viewerKey(key(' ')), 'pause');
  assert.equal(k.viewerKey(key('Escape')), 'close');
  assert.equal(k.viewerKey(key('ArrowLeft', { metaKey: true })), null); // Cmd+← é o voltar do browser
  assert.equal(k.viewerKey(key('a')), null);
});

test('roda nas tchekas: um passo por gesto e uma pausa para o trackpad não saltar várias', () => {
  const st = { acc: 0, until: 0 };
  assert.equal(k.wheelStep(st, 10, 0), 0); // pouco
  assert.equal(k.wheelStep(st, 40, 10), 1); // chega ao limite: seguinte
  assert.equal(k.wheelStep(st, 120, 100), 0); // ainda na pausa (inércia do trackpad)
  assert.equal(k.wheelStep(st, -120, 2000), -1); // depois da pausa: anterior
});

test('menu pendente: por baixo do botão, alinhado à direita; para cima ou para dentro quando não cabe', () => {
  const view = { w: 1440, h: 900 };
  const size = { w: 300, h: 260 };
  // «⋯» no meio da página: por baixo, com a direita do menu na direita do botão.
  assert.deepEqual(k.menuPosition({ x: 900, y: 200, w: 40, h: 40 }, size, view), { left: 640, top: 246 });
  // Perto do fundo: abre para cima.
  assert.deepEqual(k.menuPosition({ x: 900, y: 800, w: 40, h: 40 }, size, view), { left: 640, top: 534 });
  // Botão direito junto à esquerda (âncora de 0×0): não sai da janela.
  const p = k.menuPosition({ x: 20, y: 100, w: 0, h: 0 }, size, view);
  assert.ok(p.left >= 8 && p.left + size.w <= view.w - 8, JSON.stringify(p));
  // Janela baixa: o menu fica dentro, encostado à margem.
  const q = k.menuPosition({ x: 600, y: 100, w: 40, h: 40 }, { w: 300, h: 500 }, { w: 1024, h: 520 });
  assert.ok(q.top >= 8 && q.top + 500 <= 520, JSON.stringify(q));
});

test('zoom da foto em grande: à volta do cursor, entre 1× e 5×, sem a borda entrar no visor', () => {
  const photo = { w: 800, h: 600 };
  const view = { w: 1440, h: 700 };
  const z1 = k.rectZoomAt({ scale: 1, x: 0, y: 0 }, 2, 100, 50, photo, view);
  assert.equal(z1.scale, 2);
  assert.ok(Math.abs(z1.x) <= (800 * 2 - 1440) / 2 + 1e-9);
  assert.ok(Math.abs(z1.y) <= (600 * 2 - 700) / 2 + 1e-9);
  assert.equal(k.rectZoomAt(z1, 100, 0, 0, photo, view).scale, 5);
  assert.deepEqual(k.rectZoomAt(z1, 0.1, 0, 0, photo, view), { scale: 1, x: 0, y: 0 });
});

test('grelhas: 3 colunas no telemóvel; mais no computador com a coluna larga', () => {
  assert.equal(k.gridColumns(900, false), 3);
  assert.equal(k.gridColumns(560, true), 3);
  assert.equal(k.gridColumns(880, true), 4);
  assert.equal(k.gridColumns(1200, true), 5);
  assert.equal(k.tabArrow(key('ArrowLeft')), -1);
  assert.equal(k.tabArrow(key('ArrowRight')), 1);
  assert.equal(k.tabArrow(key('ArrowRight', { altKey: true })), null);
});

test('dicas (title) só nos botões sem texto à vista e sem title próprio', () => {
  const el = (attrs, text = '') => ({ getAttribute: (n) => attrs[n] ?? null, textContent: text });
  assert.equal(pol.tipFor(el({ 'aria-label': 'Fechar' })), 'Fechar');
  assert.equal(pol.tipFor(el({ 'aria-label': 'Fechar' }, 'Fechar')), null);
  assert.equal(pol.tipFor(el({ 'aria-label': 'Fechar', title: 'Fechar (Esc)' })), null);
  assert.equal(pol.tipFor(el({})), null);
  assert.match(pol.POLISH_CSS, /cursor:pointer/);
  assert.match(pol.POLISH_CSS, /:focus-visible\{outline:2px solid #d6334f/);
  assert.match(read('lib/deskPolish.ts'), /\(hover: hover\) and \(pointer: fine\)/);
});

test('Sheet: no telemóvel é sempre a folha de baixo; no computador janela, menu pendente (com âncora) ou painel', () => {
  const s = read('components/Sheet.tsx');
  assert.match(s, /export const sheetMode = \(desktop: boolean, variant: SheetVariant = 'dialog', anchor: Rect \| null = null\): SheetMode =>\n\s+!desktop \? 'bottom' : variant === 'menu' && !anchor \? 'dialog' : variant;/);
  // O arrastar para baixo (pan) só existe no telemóvel; o «voltar» do browser (webBack) continua a fechar em todas as formas.
  assert.match(s, /\{\.\.\.\(desktop \? \{\} : pan\.panHandlers\)\}/);
  assert.equal((s.match(/onWebBack=\{/g) ?? []).length, 3);
  assert.match(s, /onWebBack=\{iosWeb \? onClose : close\}/);
  // No computador o que não cabe rola (a mesma ideia da equipa das Mensagens).
  assert.match(s, /mode !== 'bottom' && !full \? <ScrollView style=\{styles\.deskScroll\}/);
  // A folha recomeça o contexto das listas (senão a FlatList dos comentários, aberta a partir do feed, ficava sem scroll na web).
  assert.match(s, /<ListReset><ModeCtx\.Provider value=\{mode\}>/);
  assert.match(read('components/ListReset.web.tsx'), /<VirtualizedListContextResetter>\{children\}<\/VirtualizedListContextResetter>/);
  // Os comentários abrem no painel à direita; os «⋯» como menu pendente.
  assert.match(read('components/CommentsSheet.tsx'), /<Sheet title="Comentários" onClose=\{onClose\} full plain variant="panel" dim=\{dim\}>/);
  assert.match(read('components/PostSheets.tsx'), /<Sheet title="Publicação" onClose=\{onClose\} variant="menu" anchor=\{anchor\}>/);
  assert.match(read('components/ProfileView.tsx'), /variant="menu" anchor=\{desktop \? menuAt : null\}/);
});

test('botão direito numa publicação abre o mesmo menu do «⋯» (só no computador; o do browser fica nas ligações e no texto)', () => {
  const pc = read('components/PostCard.tsx');
  assert.match(pc, /\{\.\.\.\(desktop \? \{\n[^\n]*\n\s+onMouseEnter: \(\) => setHot\(true\),\n\s+onMouseLeave: \(\) => setHot\(false\),/);
  assert.match(pc, /onContextMenu: \(e[^\n]*\n\s+if \(contextMenuIsBrowser\(e\.target\)\) return;\n\s+e\.preventDefault\(\);/);
  assert.match(pc, /openMenu\(\{ x, y, w: 0, h: 0 \}\)/);
  assert.match(pc, /onPress=\{\(e\) => openMenu\(anchorOf\(e\)\)\}/);
  assert.match(pc, /<PostMenuSheet post=\{post\} mine=\{mine\} anchor=\{desktop \? menuAt : null\}/);
  // Setas no carrossel ao passar o rato e ←/→ com o rato por cima.
  assert.match(pc, /\{desktop && over && media\.length > 1 \? \(/);
  assert.match(pc, /if \(e\.key === 'ArrowLeft'\) \{ e\.preventDefault\(\); goTo\(cur\.current\.i - 1\); \}/);
});

test('sem deslizar com o rato: perfil (useWebPager), mimos, Zás e foto em grande não se arrastam com rato', () => {
  assert.match(read('components/SwipePager.tsx'), /if \(window\.matchMedia\?\.\('\(hover: hover\) and \(pointer: fine\)'\)\.matches && !navigator\.maxTouchPoints\) return;/);
  assert.match(read('app/stories/[username].tsx'), /\{\.\.\.\(mouse \? \{\} : pan\.panHandlers\)\}/);
  assert.match(read('components/Instants.tsx'), /<Animated\.View \{\.\.\.\(mouse \? \{\} : pan\.panHandlers\)\}/);
  assert.match(read('components/PhotoViewer.tsx'), /\{\.\.\.\(mouse \? \{\} : pan\.panHandlers\)\}/);
  // O deslizar entre menus (lib/swipeTabs) já só existe abaixo de 1024 px e com toques.
  assert.match(read('lib/swipeTabs.ts'), /window\.innerWidth < 1024/);
});

test('mimos e tchekas: teclas ligadas aos visores (e pausadas com o espaço)', () => {
  const sv = read('app/stories/[username].tsx');
  assert.match(sv, /useViewerKeys\(true, \{\n\s+prev: \(\) => \{ setSeePost\(false\); prev\(\); \},\n\s+next: \(\) => \{ setSeePost\(false\); next\(\); \},\n\s+pause: \(\) => setKbPaused\(\(v\) => !v\),\n\s+close: \(\) => close\(\),/);
  assert.match(sv, /const held = holding \|\| kbPaused;/);
  assert.match(read('app/(tabs)/reels.tsx'), /const desk = useDeskReels\(focused, \(\) => activeRef\.current, goTo\);/);
  assert.match(read('app/r/[id].tsx'), /const desk = useDeskReels\(focused,/);
  const hooks = read('lib/desktopHooks.ts');
  assert.match(hooks, /const mouse = on && finePointer\(\);/);
});

test('telemóvel: as formas novas só com useDesktop / rato; a folha de baixo e os gestos ficam iguais', () => {
  const s = read('components/Sheet.tsx');
  assert.match(s, /const mode = sheetMode\(desktop, variant, anchor\);/);
  assert.match(s, /const desktop = useDesktop\(\);/);
  assert.match(read('lib/desktopKeys.ts'), /\(hover: hover\) and \(pointer: fine\)/);
  // O DesktopShell (e com ele os atalhos) só existe no computador com sessão.
  assert.match(read('app/_layout.tsx'), /const shell = desktop && !!user && !outside;/);
  assert.match(read('components/DesktopShell.tsx'), /<DesktopShortcuts \/>/);
});
