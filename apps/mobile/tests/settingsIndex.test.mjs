// Testes das Definições (src/lib/settingsIndex.ts e os ecrãs em src/app/settings): os grupos e os seus ecrãs, a pesquisa
// "Procurar nas definições" (nomes, sinónimos, sem acentos), as âncoras que a pesquisa usa, as ligações antigas
// (/settings?s=notificacoes, /settings#privacidade…) e a acessibilidade da linha partilhada.
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const m = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'settingsIndex.ts')).href);
const read = (...p) => readFileSync(path.join(ROOT, 'src', ...p), 'utf8');
const APP = path.join(ROOT, 'src', 'app');
const SETTINGS = path.join(APP, 'settings');
const COMPONENTS = path.join(ROOT, 'src', 'components', 'settings');

/** Há um ecrã (expo-router) para este caminho? */
function routeExists(p) {
  const clean = p.split('?')[0].replace(/^\//, '');
  return [`${clean}.tsx`, path.join(clean, 'index.tsx')].some((f) => existsSync(path.join(APP, f)));
}

test('cada grupo tem o seu ecrã em app/settings/<grupo>.tsx, título, subtítulo de uma linha e um ícone que existe', () => {
  const icons = read('icons', 'tx.ts');
  assert.equal(m.SETTINGS_GROUPS.length, 9);
  assert.deepEqual(m.SETTINGS_GROUPS.map((g) => g.id), ['conta', 'privacidade', 'notificacoes', 'conteudo', 'mensagens', 'pagamentos', 'aparencia', 'seguranca', 'ajuda']);
  for (const g of m.SETTINGS_GROUPS) {
    assert.ok(existsSync(path.join(SETTINGS, `${g.id}.tsx`)), `ecrã de ${g.id}`);
    assert.ok(g.title && g.subtitle && g.subtitle.length <= 40, `subtítulo curto em ${g.id}`);
    assert.ok(icons.includes(`"${g.icon}":`), `ícone ${g.icon}`);
    assert.equal(m.groupPath(g.id), `/settings/${g.id}`);
    // Cada ecrã usa a página das Definições (cabeçalho com "voltar").
    assert.match(readFileSync(path.join(SETTINGS, `${g.id}.tsx`), 'utf8'), /<SettingsPage title=/, g.id);
  }
  assert.equal(m.groupPath('inicio'), '/settings');
  // O início e a disposição (duas colunas no computador, ecrãs empilhados no telemóvel).
  assert.ok(existsSync(path.join(SETTINGS, 'index.tsx')));
  const layout = readFileSync(path.join(SETTINGS, '_layout.tsx'), 'utf8');
  assert.match(layout, /useDesktop\(\)/);
  assert.match(layout, /<Stack /);
  assert.match(layout, /<SettingsHome pane \/>/);
  assert.match(layout, /<Slot \/>/);
  // O ecrã único antigo saiu (senão /settings teria duas rotas).
  assert.ok(!existsSync(path.join(APP, 'settings.tsx')));
});

test('as opções têm ids únicos, grupos que existem e, quando são um ecrã próprio, esse ecrã existe', () => {
  const ids = m.SETTINGS_ENTRIES.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, 'ids repetidos');
  const groups = new Set([...m.SETTINGS_GROUPS.map((g) => g.id), 'inicio']);
  for (const e of m.SETTINGS_ENTRIES) {
    assert.ok(groups.has(e.group), `${e.id}: grupo ${e.group}`);
    assert.ok(e.title && Array.isArray(e.keywords) && e.keywords.length > 0, `${e.id}: título e sinónimos`);
    if (e.to) assert.ok(routeExists(e.to), `${e.id}: o ecrã ${e.to} existe`);
  }
});

test('cada opção sem ecrã próprio tem a sua âncora no ecrã do grupo (é para lá que a pesquisa leva)', () => {
  const shared = readdirSync(COMPONENTS).filter((f) => f.endsWith('.tsx')).map((f) => readFileSync(path.join(COMPONENTS, f), 'utf8'));
  for (const e of m.SETTINGS_ENTRIES.filter((x) => !x.to)) {
    if (e.id.startsWith('notify-')) continue; // ver o teste seguinte
    const screen = e.group === 'inicio' ? read('components', 'settings', 'SettingsHome.tsx') : readFileSync(path.join(SETTINGS, `${e.group}.tsx`), 'utf8');
    const here = screen.includes(`anchor="${e.id}"`);
    // Ou numa peça partilhada (components/settings) que esse ecrã importa.
    const viaShared = shared.some((src) => src.includes(`anchor="${e.id}"`) && [...src.matchAll(/export function (\w+)/g)].some((x) => screen.includes(`<${x[1]}`)));
    assert.ok(here || viaShared, `âncora de ${e.id} em ${e.group}`);
  }
  // As categorias de notificações: uma âncora por categoria.
  assert.match(read('components', 'settings', 'device.tsx'), /anchor=\{notifyEntryId\(c\)\}/);
  assert.match(readFileSync(path.join(SETTINGS, 'notificacoes.tsx'), 'utf8'), /<NotifyPrefs \/>/);
  for (const cat of Object.keys(m.NOTIFY_LABELS)) assert.ok(m.settingsEntry(m.notifyEntryId(cat)), cat);
});

test('pesquisa: pelo nome, por sinónimos, sem acentos nem maiúsculas', () => {
  const first = (q) => m.searchSettings(q)[0]?.id;
  assert.equal(first('privado'), 'accountType');
  assert.equal(first('Perfil privado'), 'accountType');
  assert.equal(first('senha'), 'password');
  assert.equal(first('palavra-passe'), 'password');
  assert.equal(first('apagar conta'), 'deleteAccount');
  assert.equal(first('eliminar'), 'deleteAccount');
  assert.equal(first('bloqueados'), 'blocked');
  assert.equal(first('bloq'), 'blocked');
  assert.equal(first('modo escuro'), 'theme');
  assert.equal(first('visto por ultimo'), 'presence');
  assert.equal(first('ip'), 'relay');
  assert.equal(first('exportar'), 'exportData');
  assert.equal(first('recarregar txills'), 'orders');
  assert.equal(first('sair'), 'logout');
  assert.equal(first('estatisticas de uso'), 'analytics');
  assert.equal(first('Brindes e reações'), 'notify-reactions');
  // Lembretes de regresso: pelo nome e por sinónimos, no ecrã das Notificações.
  assert.equal(first('lembretes quando nao passo por ca'), 'notify-comeback');
  assert.equal(first('lembretes'), 'notify-comeback');
  assert.equal(m.settingsEntry('notify-comeback').group, 'notificacoes');
  // Sem acentos e em maiúsculas: o grupo vem primeiro.
  assert.deepEqual(m.searchSettings('NOTIFICAÇÕES')[0], { kind: 'group', id: 'notificacoes', title: 'Notificações', where: '', path: '/settings/notificacoes' });
  assert.equal(m.searchSettings('notificacoes')[0].id, 'notificacoes');
  assert.equal(m.searchSettings('seguranca')[0].path, '/settings/seguranca');
  // Vazio ou sem nada parecido.
  assert.deepEqual(m.searchSettings(''), []);
  assert.deepEqual(m.searchSettings('   '), []);
  assert.deepEqual(m.searchSettings('xyzzy'), []);
  // Limite e opções escondidas neste aparelho.
  assert.ok(m.searchSettings('quem', { limit: 3 }).length <= 3);
  assert.ok(m.searchSettings('instalar').some((h) => h.id === 'installApp'));
  assert.ok(!m.searchSettings('instalar', { hidden: ['installApp'] }).some((h) => h.id === 'installApp'));
});

test('pesquisa: cada resultado leva direto à opção (ecrã próprio ou o grupo com a linha assinalada)', () => {
  const hit = (q, id) => m.searchSettings(q).find((h) => h.id === id);
  assert.equal(hit('privado', 'accountType').path, '/settings/privacidade?o=accountType');
  assert.equal(hit('privado', 'accountType').where, 'Privacidade');
  assert.equal(hit('guardados', 'saved').path, '/saved');
  assert.equal(hit('algoritmo', 'algorithm').path, '/reels/filtros');
  assert.equal(hit('sair', 'logout').path, '/settings?o=logout');
  assert.equal(hit('sair', 'logout').where, 'Definições');
  assert.equal(hit('aparelhos', 'devices').path, '/settings/seguranca?o=devices');
  for (const e of m.SETTINGS_ENTRIES) {
    const p = m.entryPath(e);
    assert.ok(p.startsWith('/'), e.id);
    if (!e.to) assert.ok(p.endsWith(`?o=${e.id}`), e.id);
  }
});

test('ligações antigas: /settings?s=…, ?section=…, /settings#… e nomes em inglês abrem o ecrã novo', () => {
  const t = m.legacySettingsTarget;
  assert.equal(t({ s: 'notificacoes' }), '/settings/notificacoes');
  assert.equal(t({ s: 'notificações' }), '/settings/notificacoes');
  assert.equal(t({ section: 'notifications' }), '/settings/notificacoes');
  assert.equal(t({ secao: 'privacidade' }), '/settings/privacidade');
  assert.equal(t({ s: 'privacy' }), '/settings/privacidade');
  assert.equal(t({ s: 'privacidade-da-conta' }), '/settings/privacidade');
  assert.equal(t({ s: 'interacoes' }), '/settings/privacidade');
  assert.equal(t({ s: 'mimos' }), '/settings/privacidade');
  assert.equal(t({ s: 'o-que-me-pode-notificar' }), '/settings/notificacoes');
  assert.equal(t({ s: 'seguranca' }), '/settings/seguranca');
  assert.equal(t({ tab: 'conta' }), '/settings/conta');
  assert.equal(t({ s: 'carteira' }), '/settings/pagamentos');
  assert.equal(t({ s: 'idioma' }), '/settings/aparencia');
  assert.equal(t({ s: 'apoio-e-informacoes' }), '/settings/ajuda');
  assert.equal(t({ s: ['mensagens'] }), '/settings/mensagens');
  assert.equal(t({}, '#notificacoes'), '/settings/notificacoes');
  assert.equal(t({}, '#privacy'), '/settings/privacidade');
  // Uma opção concreta: o grupo com a linha assinalada.
  assert.equal(t({ s: 'blocked' }), '/settings/privacidade?o=blocked');
  assert.equal(t({ s: 'accountType' }), '/settings/privacidade?o=accountType');
  assert.equal(t({}, '#deleteAccount'), '/settings/conta?o=deleteAccount');
  assert.equal(t({ s: 'logout' }), '/settings?o=logout');
  // O início fica no início (sem voltas); o que não se conhece também.
  assert.equal(t({}), null);
  assert.equal(t({}, ''), null);
  assert.equal(t({ s: 'inicio' }), null);
  assert.equal(t({ s: 'xyz' }), null);
  assert.equal(t({ o: 'blocked' }), null, '?o= é a âncora do próprio ecrã, não uma ligação antiga');
  // /settings/<nome antigo> (a rota [grupo]).
  assert.equal(m.settingsTargetFor('notifications'), '/settings/notificacoes');
  assert.equal(m.settingsTargetFor('privacy'), '/settings/privacidade');
  assert.equal(m.settingsTargetFor('nada-disto'), null);
  // Cada destino é um ecrã que existe.
  for (const k of Object.keys({ conta: 1, privacidade: 1, notifications: 1, wallet: 1, help: 1, theme: 1, devices: 1, feed: 1, calls: 1 })) {
    assert.ok(routeExists(m.settingsTargetFor(k)), k);
  }
});

test('o início trata as ligações antigas e /settings/aparelhos tem ecrã próprio, igual aos grupos', () => {
  const index = readFileSync(path.join(SETTINGS, 'index.tsx'), 'utf8');
  assert.match(index, /legacySettingsTarget\(params, hash\)/);
  assert.match(index, /window\.location\.hash/);
  assert.match(index, /<Redirect href=\{target/);
  const fallback = readFileSync(path.join(SETTINGS, '[grupo].tsx'), 'utf8');
  // O ecrã próprio (settings/aparelhos.tsx) passa à frente de [grupo]: sem lista antiga duplicada aqui.
  assert.doesNotMatch(fallback, /=== 'aparelhos'|DevicesList/);
  assert.match(fallback, /settingsTargetFor\(/);
  const devices = readFileSync(path.join(SETTINGS, 'aparelhos.tsx'), 'utf8');
  assert.match(devices, /<SettingsPage title="Os teus aparelhos">/);
  assert.match(devices, /<SettingsSection /);
  assert.doesNotMatch(devices, /StackPage/, 'no computador abre na coluna da direita, sem cabeçalho próprio');
  assert.match(readFileSync(path.join(SETTINGS, 'seguranca.tsx'), 'utf8'), /to="\/settings\/aparelhos"/);
});

test('quem abre as Definições aponta para ecrãs e âncoras que existem', () => {
  const files = (dir) => readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    // lib/api*.ts têm os caminhos da API (/settings/privacy), não os dos ecrãs.
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) && !/^api[.]/.test(n) ? [p] : [];
  });
  const groups = new Set(m.SETTINGS_GROUPS.map((g) => g.id));
  let seen = 0;
  for (const f of files(path.join(ROOT, 'src'))) {
    // Sem os comentários (que citam as ligações antigas de propósito).
    const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    for (const x of src.matchAll(/['"`](\/settings(?:\/[a-z]+)?)(\?[^'"`]*)?(#[^'"`]*)?['"`]/g)) {
      seen++;
      const [, p, q, h] = x;
      const where = `${path.relative(ROOT, f)}: ${x[0]}`;
      assert.ok(!h, `sem âncoras # (${where})`);
      const g = p.split('/')[2];
      if (g) assert.ok(groups.has(g) || g === 'aparelhos', `grupo que existe (${where})`);
      if (q) {
        const o = new URLSearchParams(q.slice(1)).get('o');
        assert.ok(o && m.settingsEntry(o), `?o= de uma opção que existe (${where})`);
        assert.ok(!/[?&](s|section|secao)=/.test(q), `sem parâmetros antigos (${where})`);
      }
    }
  }
  assert.ok(seen >= 3);
  assert.match(read('app', 'stories', '[username].tsx'), /'\/settings\/privacidade\?o=storyReplies'/);
  // A barra lateral do computador fica assinalada em qualquer ecrã das Definições.
  assert.match(read('components', 'DesktopShell.tsx'), /path\.startsWith\('\/settings\/'\)/);
});

test('acessibilidade: interruptores com role e estado, toque de 44 pt ou mais, sem Switch solto', () => {
  const row = read('components', 'settings', 'SettingRow.tsx');
  assert.match(row, /accessibilityRole="switch"/);
  assert.match(row, /accessibilityState=\{\{ checked: toggle\.on, disabled: !!toggle\.disabled \}\}/);
  // Na web (react-native-web) o estado só chega ao leitor de ecrã pelos aria-*.
  assert.match(row, /aria-checked=\{toggle\.on\}/);
  assert.match(row, /accessibilityLabel=\{title\}/);
  const min = (src, k) => Number(src.match(new RegExp(`\\b${k}: \\{ minHeight: (\\d+)`))?.[1] ?? 0);
  assert.ok(min(row, 'row') >= 44, 'linha');
  const home = read('components', 'settings', 'SettingsHome.tsx');
  for (const k of ['me', 'search', 'group']) assert.ok(min(home, k) >= 44, k);
  assert.match(home, /clear: \{ width: 44, height: 44/);
  assert.match(home, /accessibilityLabel="Procurar nas definições"/);
  // Todos os interruptores passam pela linha partilhada (com role e estado): nada de <Switch> nos ecrãs.
  const screens = [...readdirSync(SETTINGS).map((f) => path.join(SETTINGS, f)), ...readdirSync(COMPONENTS).map((f) => path.join(COMPONENTS, f))];
  for (const f of screens) assert.ok(!/<Switch\b/.test(readFileSync(f, 'utf8')), path.basename(f));
  // O texto cresce com o tamanho de letra do sistema: nada de allowFontScaling={false} nem alturas fixas nas linhas.
  for (const f of screens) assert.ok(!/allowFontScaling=\{false\}/.test(readFileSync(f, 'utf8')), path.basename(f));
  assert.ok(!/\brow: \{[^}]*\bheight:/.test(row));
});
