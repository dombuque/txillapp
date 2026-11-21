// Uniformização (fundações): os tokens de lib/theme.ts, o Button e companhia em components/ui, a pergunta de sim/não
// (lib/confirm) que abre sempre a caixa da app (AlertHost, agora também no APK), a folha (Sheet) com um só título e uma só
// pega, e os nomes antigos de ícones (present, flip-camera, send) que continuam a funcionar.
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import './fixtures/alias.mjs'; // o alias @/ (os módulos usam t() de @/lib/i18n)
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(path.join(ROOT, 'src', ...p), 'utf8').replace(/\r\n/g, '\n');
const load = (...p) => import(pathToFileURL(path.join(ROOT, 'src', ...p)).href);

const theme = await load('lib', 'theme.ts');
const { confirmButtons } = await load('lib', 'confirmButtons.ts');
const { ICON_ALIAS, iconFor } = await load('lib', 'iconAlias.ts');
const { TX } = await load('icons', 'tx.ts');

test('tema: perigo, cinzentos novos, superfícies escuras, letra, raios, alturas e ícones por papel', () => {
  const { colors, dark, type, typo, radius, buttonHeight, iconSize } = theme;
  assert.equal(colors.danger, '#b91c1c');
  assert.equal(colors.dangerSoft, '#fef2f2');
  assert.equal(colors.zinc50, '#fafafa');
  assert.equal(colors.zinc400, '#a1a1aa');
  for (const k of ['bg', 'raised', 'line', 'text', 'sub']) assert.ok(dark[k], `dark.${k}`);
  assert.deepEqual(type.title, { fontSize: 20, fontWeight: '800' });
  assert.deepEqual(type.sheetTitle, { fontSize: 18, fontWeight: '800' });
  assert.equal(typo, type);
  assert.equal(radius.pill, 999);
  assert.deepEqual({ ...buttonHeight }, { lg: 52, md: 44, sm: 36 });
  assert.equal(iconSize.action, 24);
  assert.equal(iconSize.rail, 28);
  assert.equal(iconSize.menu, 22);
  assert.equal(iconSize.field, 18);
  assert.equal(iconSize.sheetClose, 20);
  assert.equal(iconSize.screenClose, 24);
});

test('Button: alturas 52/44/36, pílula, letra 16/700 (14 no sm) e o sm chega aos 44 de toque', () => {
  const { buttonLook, colors } = theme;
  const lg = buttonLook('primary', 'lg');
  assert.equal(lg.height, 52);
  assert.equal(lg.radius, 999);
  assert.equal(lg.fontSize, 16);
  assert.equal(lg.fontWeight, '700');
  assert.equal(lg.bg, colors.brand);
  assert.equal(lg.fg, '#ffffff');
  assert.equal(lg.hitSlop, 0);
  assert.equal(buttonLook('primary', 'md').height, 44);
  const sm = buttonLook('secondary', 'sm');
  assert.equal(sm.height, 36);
  assert.equal(sm.fontSize, 14);
  assert.equal(sm.hitSlop, 4);
  assert.equal(sm.bg, colors.zinc100);
  assert.equal(sm.fg, colors.zinc900);
  assert.equal(buttonLook('ghost').bg, 'transparent');
  assert.deepEqual([buttonLook('danger').bg, buttonLook('danger').fg], [colors.dangerSoft, colors.danger]);
  assert.deepEqual([buttonLook('dangerSolid').bg, buttonLook('dangerSolid').fg], [colors.danger, '#ffffff']);
  // Em superfície escura o secundário e o fantasma ficam claros.
  assert.equal(buttonLook('ghost', 'lg', true).fg, '#ffffff');
  assert.notEqual(buttonLook('secondary', 'lg', true).bg, colors.zinc100);
});

test('Button: o PontoLoader a carregar (nunca «Um momento…»), desligado a 45%, papel de botão', () => {
  const b = read('components', 'ui', 'Button.tsx');
  assert.match(b, /\{loading \? \(\n\s+<PontoLoader /);
  assert.doesNotMatch(b, /'Um momento/);
  assert.match(b, /disabled && !loading && \{ opacity: disabledOpacity \}/);
  assert.equal(theme.disabledOpacity, 0.45);
  assert.match(b, /accessibilityRole="button"/);
  assert.match(b, /accessibilityState=\{\{ disabled: off, busy: loading \}\}/);
});

test('IconButton: rótulo obrigatório, 44 de toque no mínimo e as variantes clara/escura/vidro', () => {
  const s = read('components', 'ui', 'IconButton.tsx');
  assert.match(s, /\n  label: string;\n/, 'label não é opcional');
  assert.match(s, /export type IconButtonVariant = 'light' \| 'soft' \| 'dark' \| 'glass';/);
  assert.match(s, /const slop = Math\.max\(0, Math\.ceil\(\(minTouch - size\) \/ 2\)\);/);
  assert.match(s, /accessibilityRole="button"\n\s+accessibilityLabel=\{label\}/);
  assert.equal(theme.minTouch, 44);
});

test('confirm: «Cancelar» primeiro, depois o botão que confirma (vermelho se for perigoso)', () => {
  const calls = [];
  const b = confirmButtons({ title: 'Apagar o rascunho?', confirm: 'Apagar', danger: true }, (ok) => calls.push(ok));
  assert.deepEqual(b.map((x) => [x.text, x.style]), [['Cancelar', 'cancel'], ['Apagar', 'destructive']]);
  b[0].onPress();
  b[1].onPress();
  assert.deepEqual(calls, [false, true]);
  const plain = confirmButtons({ title: 'Sair?' }, () => undefined);
  assert.deepEqual(plain.map((x) => [x.text, x.style]), [['Cancelar', 'cancel'], ['Confirmar', 'default']]);
});

test('confirm: abre a caixa da app e responde uma vez só (fechar ou outra caixa por cima dá «não»)', () => {
  const c = read('lib', 'confirm.ts');
  assert.match(c, /export function confirm\(o: ConfirmOptions\): Promise<boolean>/);
  assert.match(c, /openAlert\(o\.title, o\.message, confirmButtons\(o, done\), \(\) => done\(false\)\);/);
  assert.match(c, /if \(settled\) return;/);
  const h = read('lib', 'alertHost.ts');
  assert.match(h, /prev\?\.onDismiss\?\.\(\);/);
});

test('AlertHost também no APK: o Alert.alert abre a caixa da app em todas as plataformas', () => {
  const h = read('lib', 'alertHost.ts');
  const fn = h.slice(h.indexOf('export function installAlert'), h.indexOf('export const installWebAlert'));
  assert.doesNotMatch(fn, /Platform\.OS/, 'sem o «só na web»');
  assert.match(fn, /Alert\.alert = \(title: string, message\?: string, buttons\?: AlertButton\[\]\) => openAlert\(title, message, buttons\);/);
  const layout = read('app', '_layout.tsx');
  assert.match(layout, /\ninstallAlert\(\);/);
  assert.match(layout, /<AlertHost \/>/);
  const host = read('components', 'AlertHost.tsx');
  assert.match(host, /kind=\{b\.style === 'destructive' \? 'dangerSolid' : b\.style === 'cancel' \? 'secondary' : 'primary'\}/);
});

test('ícones: present → gift, flip-camera → cam-flip, send ≡ messages; os destinos existem', () => {
  assert.equal(iconFor('present'), 'gift');
  assert.equal(iconFor('flip-camera'), 'cam-flip');
  assert.equal(iconFor('send'), 'messages');
  assert.equal(iconFor('x'), 'x');
  for (const to of Object.values(ICON_ALIAS)) assert.ok(TX[to], `${to} existe em tx.ts`);
  // Os nomes antigos continuam a ser IconName válidos (não partem quem ainda os usa).
  for (const from of Object.keys(ICON_ALIAS)) assert.ok(TX[from], `${from} continua em tx.ts`);
  assert.match(read('components', 'Icon.tsx'), /const shown = iconFor\(name\);/);
});

test('Sheet: título 18/800 à esquerda, pega 40×5, «Cancelar» no fim (só no telemóvel) e linhas escuras na folha escura', () => {
  const s = read('components', 'Sheet.tsx');
  assert.match(s, /title: \{ fontSize: 18, fontWeight: '800', color: colors\.zinc900 \}/);
  assert.match(s, /handle: \{ alignSelf: 'center', width: 40, height: 5,/);
  assert.match(s, /cancel\?: boolean \| string/);
  assert.match(s, /\{cancel && mode === 'bottom' \? \(/);
  assert.match(s, /<Button label=\{typeof cancel === 'string' \? cancel : t\('Cancelar'\)\} kind="secondary" dark=\{dark\} block onPress=\{close\} \/>/);
  assert.match(s, /export const useSheetDark = \(\) => useContext\(DarkCtx\);/);
  assert.equal((s.match(/<DarkCtx\.Provider value=\{dark\}>/g) ?? []).length, 3);
});

test('ActionRow: o MenuRow promovido (ícone 22 num círculo de 40, título 16/600, 52 de altura, perigo a vermelho)', () => {
  const a = read('components', 'ui', 'ActionRow.tsx');
  assert.match(a, /icon: \{ width: 40, height: 40, borderRadius: 20,/);
  assert.match(a, /title: \{ fontSize: 16, fontWeight: '600'/);
  assert.match(a, /minHeight: 52/);
  assert.match(a, /const fg = danger \? \(onDark \? '#fca5a5' : colors\.danger\)/);
  const p = read('components', 'PostSheets.tsx');
  assert.match(p, /import \{ ActionRow as MenuRow \} from '\.\/ui\/ActionRow';/);
  assert.match(p, /export \{ MenuRow \};/);
  assert.doesNotMatch(p, /export function MenuRow\(/);
});

test('estados: EmptyState com botão e escuro (Empty continua), ErrorState com «Tentar outra vez»', () => {
  const e = read('components', 'Empty.tsx');
  assert.match(e, /export function EmptyState\(\{ icon, title, text, action, dark = false, style \}: EmptyStateProps\)/);
  assert.match(e, /export const Empty = EmptyState;/);
  assert.match(e, /box: \{ marginHorizontal: 32, marginTop: 48,/);
  const er = read('components', 'ui', 'ErrorState.tsx');
  assert.match(er, /retryLabel = t\('Tentar outra vez'\)/);
  assert.match(er, /t\('Ups, não consegui carregar \{what\}', \{ what \}\)/);
  assert.match(er, /'Verifica a ligação e tenta outra vez\.'/);
  assert.match(er, /kind: 'secondary'/);
});

test('componentes de components/ui existem: Chip, SegmentedTabs, SearchField, SendButton; PageLoader e ListSkeleton', () => {
  for (const f of ['Button', 'IconButton', 'ActionRow', 'ErrorState', 'EmptyState', 'Chip', 'SegmentedTabs', 'SearchField', 'SendButton']) {
    assert.ok(existsSync(path.join(ROOT, 'src', 'components', 'ui', `${f}.tsx`)), f);
  }
  assert.match(read('components', 'ui', 'Chip.tsx'), /chip: \{ height: 36, borderRadius: 999,/);
  assert.match(read('components', 'ui', 'SearchField.tsx'), /accessibilityLabel=\{t\('Limpar a pesquisa'\)\}/);
  assert.match(read('components', 'ui', 'SearchField.tsx'), /box: \{ height: 44, borderRadius: 999,/);
  assert.match(read('components', 'ui', 'SegmentedTabs.tsx'), /accessibilityRole="tab"/);
  assert.match(read('components', 'ui', 'SendButton.tsx'), /<Icon name="arrow-up" size=\{22\} color="#fff"/);
  const p = read('components', 'PontoLoader.tsx');
  assert.match(p, /export function PageLoader\(/);
  assert.match(p, /export function ListSkeleton\(/);
});

test('StackPage: dark e center; BackButton aceita a cor', () => {
  const s = read('components', 'StackPage.tsx');
  assert.match(s, /\{ title, children, right, dark = false, center = false \}/);
  assert.match(s, /<BackButton onPress=\{back\} color=\{dark \? D\.text : colors\.zinc900\} \/>/);
  assert.match(read('components', 'BackButton.tsx'), /color = colors\.zinc900/);
});

test('carregamento: nenhum ficheiro importa a roda do sistema (ActivityIndicator vem sempre do PontoLoader)', async () => {
  const { readdirSync, statSync } = await import('node:fs');
  const walk = (d) => readdirSync(d).flatMap((n) => { const p = path.join(d, n); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : []; });
  const bad = walk(path.join(ROOT, 'src')).filter((p) => /import \{[^}]*\bActivityIndicator\b[^}]*\} from 'react-native'/.test(readFileSync(p, 'utf8')));
  assert.deepEqual(bad.map((p) => path.relative(ROOT, p)), []);
});

test('rascunhos e chamadas: apagar deixa «Desfazer»; limpar o histórico pergunta antes', () => {
  const d = read('app', 'drafts.tsx');
  assert.match(d, /showToast\(t\('Rascunho apagado'\), \{\n\s+label: t\('Desfazer'\),/);
  assert.match(d, /void restoreDraft\(d\)/);
  assert.match(read('lib', 'drafts.ts'), /export async function restoreDraft\(d: DraftItem\)/);
  const c = read('app', 'calls.tsx');
  assert.match(c, /showToast\(t\('Chamada apagada do registo'\), \{ label: t\('Desfazer'\)/);
  assert.match(c, /if \(undone\) return;\n\s+callsApi\.remove\(c\.id\)/);
  assert.match(c, /await confirm\(\{ title: t\('Limpar o histórico\?'\)[\s\S]*?danger: true \}\)/);
  assert.doesNotMatch(c, /Alert\.alert/);
  // O nome no topo do menu da chamada leva o selo; o menu tem «Cancelar».
  assert.match(c, /<Sheet onClose=\{\(\) => setHeld\(null\)\} cancel>/);
  assert.match(c, /<NameWithBadge name=\{held\.peer\.displayName\} who=\{held\.peer\}/);
});

test('AlertHost: dois botões curtos lado a lado; textos compridos um por cima do outro, a ação em cima', async () => {
  const a = await import(new URL('../src/lib/alertLayout.ts', import.meta.url).href);
  assert.equal(a.alertInRow(['Cancelar', 'Apagar']), true);
  assert.equal(a.alertInRow(['Continuar a editar', 'Descartar']), false);
  assert.equal(a.alertInRow(['Sim']), false);
  assert.equal(a.alertInRow(['A', 'B', 'C']), false);
  const host = read('components', 'AlertHost.tsx');
  assert.match(host, /\[\.\.\.r\.buttons\.filter\(\(b\) => b\.style !== 'cancel'\), \.\.\.r\.buttons\.filter\(\(b\) => b\.style === 'cancel'\)\]/);
});
