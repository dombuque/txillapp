// As pontas da uniformização: o HoldMenu com ActionRow e «Cancelar», o SearchField com acessórios, o Button `gradient` e o
// passar o rato, os botões feitos à mão que passaram a Button, os erros em showToast, o menu de quem vê a Txillada, as cores
// por tokens e a conta do teclado partilhada (lib/keyboardMath).
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import './fixtures/alias.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(path.join(ROOT, 'src', ...p), 'utf8').replace(/\r\n/g, '\n');
const load = (...p) => import(pathToFileURL(path.join(ROOT, 'src', ...p)).href);
const theme = await load('lib', 'theme.ts');
const km = await load('lib', 'keyboardMath.ts');

test('HoldMenu das tchekas: linhas com ActionRow na folha escura e «Cancelar», com os atalhos e a velocidade de antes', () => {
  const m = read('components', 'reel', 'HoldMenu.tsx');
  assert.match(m, /<Sheet onClose=\{onClose\} dark variant="dialog" title=\{t\('Opções'\)\} cancel>/);
  for (const id of ['captions', 'gift', 'more']) assert.match(m, new RegExp(`<ActionRow [^\\n]*onPick\\('${id}'\\)`), id);
  for (const id of ['not-interested', 'report', 'save']) assert.match(m, new RegExp(`tile\\('${id}'`), id);
  assert.match(m, /SPEEDS\.map/);
  assert.doesNotMatch(m, /'#2a2a2d'/, 'o cinzento da folha escura vem do tema');
});

test('SearchField: acessórios à direita (right) depois do X; a pesquisa e as Mensagens usam-no', () => {
  const f = read('components', 'ui', 'SearchField.tsx');
  assert.match(f, /right\?: ReactNode;/);
  assert.match(f, /\) : null\}\n      \{right\}\n    <\/View>/, 'o X primeiro, depois os acessórios');
  assert.match(f, /export function SearchFieldButton\(/);
  const s = read('app', 'search.tsx');
  assert.match(s, /<SearchField\n/);
  assert.match(s, /<SearchFieldButton onPress=\{\(\) => router\.push\('\/qr' as never\)\} label=\{t\('Ler um QR'\)\}>/);
  assert.match(s, /<SearchFieldButton onPress=\{\(\) => router\.push\('\/supertxill' as never\)\} label=\{t\('Abrir o SuperTxill'\)\}>/);
  assert.doesNotMatch(s, /<TextInput /);
  assert.doesNotMatch(read('app', '(tabs)', 'messages.tsx'), /<TextInput\n/);
});

test('Button: variante gradient (o degradê coral) e passar o rato na web; entrar e criar conta com ela', () => {
  const { buttonLook, brandGradient, colors } = theme;
  assert.deepEqual([...brandGradient], [colors.brand, colors.brandLight]);
  assert.equal(buttonLook('gradient').fg, '#ffffff');
  assert.equal(buttonLook('primary').hoverBg, null);
  assert.equal(buttonLook('primary').hoverOpacity, 0.92);
  assert.equal(buttonLook('secondary').hoverBg, colors.zinc200);
  assert.equal(buttonLook('ghost').hoverBg, colors.zinc100);
  const b = read('components', 'ui', 'Button.tsx');
  assert.match(b, /\{kind === 'gradient' \? <LinearGradient colors=\{brandGradient\}/);
  assert.match(b, /const hovered = !!\(s as \{ hovered\?: boolean \}\)\.hovered && !off;/);
  assert.match(read('app', 'login.tsx'), /<Button label=\{t\('Entrar'\)\} kind="gradient"/);
  assert.match(read('app', 'register.tsx'), /<Button label=\{step\.cta\} kind="gradient"/);
});

test('botões feitos à mão que ficaram passam a Button: Nova publicação, Perto, Artistas e Destaques', () => {
  const nw = read('app', '(tabs)', 'new.tsx');
  assert.match(nw, /<Button label=\{t\('Publicar'\)\} size="sm" onPress=\{\(\) => void submit\(\)\} loading=\{busy\}/);
  assert.match(nw, /<Button label=\{t\('Guardar rascunho'\)\}/);
  assert.match(nw, /<Button label=\{t\('Descartar'\)\} kind="danger"/);
  assert.doesNotMatch(nw, /styles\.(publish|primary)Text/);
  const perto = read('app', 'perto.tsx');
  assert.doesNotMatch(perto, /st\.(primaryText|secondaryText|visBtnText|emptyPrimaryText)/);
  const artistUi = read('components', 'ArtistUi.tsx');
  assert.doesNotMatch(artistUi, /export function (Primary|Ghost)\(/);
  for (const f of ['index.tsx', 'carregar.tsx', 'gerir.tsx']) assert.match(read('app', 'artista', f), /<Button label=/, f);
  const vb = read('components', 'boost', 'VenueBoost.tsx');
  assert.equal((vb.match(/<Button label=\{price/g) ?? []).length, 2, 'os dois «Bombar»');
  assert.doesNotMatch(vb, /Alert\.alert|window\.confirm|\bconfirm\(`/);
  assert.match(read('components', 'boost', 'SponsoredCard.tsx'), /<Button label=\{t\('Ver o evento'\)\} size="md" onPress=\{open\}/);
});

test('erros das ações em showToast e confirmações na caixa da app: Artistas e página do som', () => {
  for (const f of [['app', 'artista', 'index.tsx'], ['app', 'artista', 'gerir.tsx']]) {
    const s = read(...f);
    assert.doesNotMatch(s, /Alert\./, f.join('/'));
    assert.match(s, /await confirm\(\{ title: /, f.join('/'));
    assert.match(s, /showToast\(/, f.join('/'));
    assert.match(s, /<ErrorState what=/, f.join('/'));
  }
  const som = read('app', 'som', '[id].tsx');
  assert.doesNotMatch(som, /Alert\.alert\(t\('Não deu'\)/);
  assert.match(som, /\.catch\(\(e\) => showToast\(failText\(e\)\)\)/);
  assert.match(som, /await confirm\(\{ title: RETIRE_SOUND_TITLE\(\), message: RETIRE_SOUND_TEXT\(\), confirm: t\('Retirar'\), danger: true \}\)/);
});

test('Txillada: o que o anfitrião faz com quem está a ver é uma folha escura com ActionRow e «Cancelar» (não um Alert)', () => {
  const s = read('app', 'txillada', '[id].tsx');
  const fn = s.slice(s.indexOf('function viewerActions('), s.indexOf('/** Quem vê: pedir para entrar'));
  assert.doesNotMatch(fn, /Alert/);
  assert.match(s, /<Panel title=\{`@\$\{person\.username\}`\} onClose=\{onClose\} cancel>/);
  assert.match(s, /<ActionRow icon="logout" title=\{t\('Expulsar @\{username\}', \{ username: person\.username \}\)\} danger onPress=\{onBan\} \/>/);
  assert.match(s, /act === 'invite' \? <ActionRow icon="user-plus" title=\{t\('Convidar para transmitir'\)\}/);
  assert.match(s, /act === 'requested' \? <ActionRow icon="check" title=\{t\('Aceitar o pedido para entrar'\)\}/);
});

test('cores: vermelhos por tokens (danger e dangerBright em fundos escuros) e sem os cinzentos à mão nos componentes', () => {
  assert.equal(theme.colors.dangerBright, '#ef4444');
  assert.match(read('components', 'calls', 'CallOverlay.tsx'), /const RED = colors\.dangerBright;/);
  for (const f of [['components', 'NativeCamera.tsx'], ['components', 'TxCamera.tsx'], ['components', 'SuperTxillPanel.tsx']]) {
    assert.doesNotMatch(read(...f), /'#ef4444'|'#dc2626'/, f.join('/'));
  }
  for (const f of [['components', 'settings', 'SettingRow.tsx'], ['components', 'Lines.tsx'], ['components', 'TrackCard.tsx'], ['components', 'ProfileView.tsx'], ['app', '(tabs)', 'new.tsx']]) {
    const s = read(...f);
    assert.doesNotMatch(s, /colors\.red600/, f.join('/'));
    assert.doesNotMatch(s, /'#(18181b|f4f4f5|fafafa|a1a1aa)'|"#(18181b|f4f4f5|fafafa|a1a1aa)"/, f.join('/'));
  }
});

test('teclado: os mimos, os Zás e a Txillada usam a mesma conta (lib/keyboardMath visibleBottom)', () => {
  assert.match(read('lib', 'keyboardFrame.ts'), /import \{ visibleBottom, type VisibleBox \} from '@\/lib\/keyboardMath';/);
  assert.match(read('lib', 'txilladaChat.ts'), /import \{ visibleBottom \} from '@\/lib\/keyboardMath';/);
  // Web: o fundo da zona visível (nunca abaixo do ecrã de agora); sem ela, o ecrã de agora.
  assert.equal(km.visibleBottom({ web: true, vv: { top: 0, height: 415 }, nowH: 797, screenH: 797, kb: 0 }), 415);
  assert.equal(km.visibleBottom({ web: true, vv: { top: 120, height: 415 }, nowH: 797, screenH: 797, kb: 0 }), 535);
  assert.equal(km.visibleBottom({ web: true, vv: null, nowH: 500, screenH: 797, kb: 0 }), 500);
  // Nativo: o teclado ou o que a janela encolheu (o maior), nunca os dois somados.
  assert.equal(km.visibleBottom({ web: false, vv: null, nowH: 800, screenH: 800, kb: 300 }), 500);
  assert.equal(km.visibleBottom({ web: false, vv: null, nowH: 500, screenH: 800, kb: 300 }), 500, 'o Android já encolheu a janela');
  assert.equal(km.visibleBottom({ web: false, vv: null, nowH: 600, screenH: 800, kb: 300 }), 500);
  assert.equal(km.visibleBottom({ web: false, vv: null, nowH: 0, screenH: 800, kb: 0 }), 800, 'ainda por medir');
});
