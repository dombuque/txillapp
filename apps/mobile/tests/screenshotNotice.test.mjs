// Testes das capturas de ecrã: a lógica pura (src/lib/screenshotNotice.ts: um pedido a cada 5 s, o texto e o ícone do
// aviso), a linha da lista de conversas (src/lib/inboxRow.ts) e, lendo o código, onde se bloqueia e onde se avisa
// (src/lib/screenCapture.ts, o visor dos Zás em src/components/Instants.tsx e os ecrãs das conversas).
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (f) => import(pathToFileURL(path.join(ROOT, 'src', 'lib', f)).href);
const src = (p) => readFileSync(path.join(ROOT, 'src', ...p.split('/')), 'utf8').replace(/\r\n/g, '\n');
const sn = await load('screenshotNotice.ts');
const row = await load('inboxRow.ts');

// ---------- 1. Um pedido a cada 5 s por conversa (ou por Zás) ----------

test('o primeiro aviso vai logo; outro na mesma conversa só passados 5 s', () => {
  const last = new Map();
  const t0 = 1_000_000;
  assert.equal(sn.SCREENSHOT_GAP_MS, 5000);
  assert.equal(sn.takeScreenshotSlot(last, 'u:ana', t0), true);
  assert.equal(sn.takeScreenshotSlot(last, 'u:ana', t0 + 1), false);
  assert.equal(sn.takeScreenshotSlot(last, 'u:ana', t0 + 4999), false);
  // As recusadas não empurram a janela: conta desde o último que foi.
  assert.equal(sn.takeScreenshotSlot(last, 'u:ana', t0 + 5000), true);
  assert.equal(sn.takeScreenshotSlot(last, 'u:ana', t0 + 9999), false);
  assert.equal(sn.takeScreenshotSlot(last, 'u:ana', t0 + 10_000), true);
});

test('cada conversa (e cada Zás) tem a sua conta', () => {
  const last = new Map();
  const t0 = 50_000;
  assert.equal(sn.takeScreenshotSlot(last, sn.screenshotKey.direct('ana'), t0), true);
  assert.equal(sn.takeScreenshotSlot(last, sn.screenshotKey.group('g1'), t0 + 1), true);
  assert.equal(sn.takeScreenshotSlot(last, sn.screenshotKey.zas('z1'), t0 + 2), true);
  assert.equal(sn.takeScreenshotSlot(last, sn.screenshotKey.zas('z2'), t0 + 3), true);
  assert.equal(sn.takeScreenshotSlot(last, sn.screenshotKey.direct('ANA'), t0 + 4), false, 'o @ não distingue maiúsculas');
  assert.equal(sn.takeScreenshotSlot(last, sn.screenshotKey.group('g1'), t0 + 5), false);
});

test('as chaves não chocam entre sítios', () => {
  assert.equal(sn.screenshotKey.direct('Ana'), 'u:ana');
  assert.equal(sn.screenshotKey.group('ana'), 'g:ana');
  assert.equal(sn.screenshotKey.zas('ana'), 'zas:ana');
});

test('um relógio que andou para trás não deixa a conversa calada', () => {
  const last = new Map([['u:ana', 100_000]]);
  assert.equal(sn.takeScreenshotSlot(last, 'u:ana', 90_000), true);
  assert.equal(last.get('u:ana'), 90_000);
  assert.equal(sn.takeScreenshotSlot(last, 'u:ana', 91_000), false);
});

test('o intervalo pode ser outro (o predefinido é 5 s)', () => {
  const last = new Map();
  assert.equal(sn.takeScreenshotSlot(last, 'k', 0, 1000), true);
  assert.equal(sn.takeScreenshotSlot(last, 'k', 999, 1000), false);
  assert.equal(sn.takeScreenshotSlot(last, 'k', 1000, 1000), true);
});

// ---------- 2. O aviso na conversa e na lista ----------

const shot = (o = {}) => ({ kind: 'system', fromMe: false, body: '', system: { type: 'screenshot', name: 'Ana' }, ...o });

test('o aviso da captura: o texto do servidor, com a câmara; o das temporárias continua com o relógio', () => {
  const m = shot({ body: 'Ana fez uma captura de ecrã.' });
  assert.equal(sn.isScreenshotNotice(m), true);
  assert.equal(sn.systemIcon(m), 'camera');
  assert.equal(sn.systemText(m), 'Ana fez uma captura de ecrã.');
  assert.equal(sn.systemText(shot({ fromMe: true, body: 'Fizeste uma captura de ecrã.' })), 'Fizeste uma captura de ecrã.');
  const ttl = { kind: 'system', fromMe: true, body: 'Ligaste as mensagens temporárias: 7 dias.', system: { type: 'ttl', ttl: 604800 } };
  assert.equal(sn.isScreenshotNotice(ttl), false);
  assert.equal(sn.systemIcon(ttl), 'clock');
  assert.equal(sn.systemText(ttl), 'Ligaste as mensagens temporárias: 7 dias.');
  // Sem `system` (servidor antigo): relógio, como até aqui.
  assert.equal(sn.systemIcon({ kind: 'system', body: 'x' }), 'clock');
  assert.equal(sn.systemIcon({ kind: 'system', body: 'x', system: null }), 'clock');
});

test('sem texto do servidor, a captura escreve-se aqui (minha, de alguém com nome, sem nome)', () => {
  assert.equal(sn.systemText(shot()), 'Ana fez uma captura de ecrã.');
  assert.equal(sn.systemText(shot({ fromMe: true })), 'Fizeste uma captura de ecrã.');
  assert.equal(sn.systemText(shot({ system: { type: 'screenshot', name: '  ' } })), 'Alguém fez uma captura de ecrã.');
  assert.equal(sn.systemText(shot({ body: '   ' })), 'Ana fez uma captura de ecrã.');
  assert.equal(sn.systemText({ kind: 'system', body: null, system: { type: 'ttl', ttl: null } }), '');
});

test('na lista dos TxillGroups o aviso não leva o nome à frente (o texto já diz quem foi)', () => {
  assert.equal(row.groupSenderPrefix({ fromMe: false, kind: 'system', senderName: 'Ana' }), '');
  assert.equal(row.groupSenderPrefix({ fromMe: false, kind: 'text', senderName: 'Ana' }), 'Ana: ');
  assert.equal(row.groupSenderPrefix({ fromMe: true, kind: 'text', senderName: 'Eu' }), '');
  assert.equal(row.groupSenderPrefix({ fromMe: false, kind: 'text', senderName: null }), '');
  const s = src('app/(tabs)/messages.tsx');
  assert.match(s, /\$\{groupSenderPrefix\(g\.lastMessage\)\}\$\{what\(g\.lastMessage, true\)\}/);
  assert.match(s, /if \(m\.kind === 'system'\) return systemText\(m\);/);
});

test('a conversa desenha o aviso com o texto e o ícone certos', () => {
  const list = src('components/ChatList.tsx');
  assert.match(list, /<SystemNotice text=\{systemText\(item\)\} icon=\{systemIcon\(item\)\} \/>/);
  const notice = src('components/ChatTemporary.tsx');
  assert.match(notice, /export function SystemNotice\(\{ text, icon = 'clock' \}/);
  assert.match(notice, /<Icon name=\{icon\}/);
  // O tipo do aviso aceita a captura (com quem a fez).
  assert.match(src('lib/api.ts'), /system\?: \{ type: 'ttl'; ttl: number \| null \} \| \{ type: 'screenshot'; name: string \} \| null;/);
});

// ---------- 3. Onde se bloqueia e onde se avisa ----------

test('o módulo nativo só se usa no Android e no iPhone (na web é um objeto vazio)', () => {
  const s = src('lib/screenCapture.ts');
  assert.match(s, /export const captureNative = Platform\.OS === 'android' \|\| Platform\.OS === 'ios';/);
  // Cada chamada ao expo-screen-capture fica atrás do captureNative.
  for (const fn of ['blockCapture', 'allowCapture', 'onScreenshot']) {
    const body = s.slice(s.indexOf(`export ${fn === 'onScreenshot' ? 'function' : 'async function'} ${fn}`));
    assert.match(body.slice(0, 200), /if \(!captureNative\) return/, `${fn} sai logo na web`);
  }
  assert.match(s, /if \(!captureNative \|\| !focused \|\| !key\) return;/);
  // Só com a app à frente, e no máximo um pedido a cada 5 s por chave.
  assert.match(s, /if \(AppState\.currentState === 'active'\) listener\(\);/);
  assert.match(s, /if \(!takeScreenshotSlot\(lastSent, key, Date\.now\(\)\)\) return false;/);
  // Nunca pede licenças de fotos (no Android < 14 o aviso precisava de ler a galeria; o Play não deixa).
  assert.doesNotMatch(s, /requestPermissionsAsync|usePermissions|getPermissionsAsync/);
});

test('Zás: bloqueia só nos dos outros, e o visor só aparece com o bloqueio posto', () => {
  const s = src('components/Instants.tsx');
  const v = s.slice(s.indexOf('function InstantViewer('), s.indexOf('const st = StyleSheet.create'));
  assert.match(v, /const guard = !own && captureNative;/);
  assert.match(v, /blockCapture\(ZAS_CAPTURE_KEY\)\.then\(\(\) => \{ if \(live\) setSecured\(true\); \}\)/);
  assert.match(v, /void allowCapture\(ZAS_CAPTURE_KEY\);/);
  // No Android o Modal (Dialog) só copia a FLAG_SECURE ao ser criado: espera pelo bloqueio.
  assert.match(v, /useState\(\(\) => !\(guard && Platform\.OS === 'android'\)\)/);
  assert.match(v, /<Modal visible=\{secured\} animationType="fade"/);
  // Ir para a câmara ou para a grelha dos meus (ou acabar e ir para a câmara) tira o bloqueio antes.
  assert.match(v, /onPress=\{\(\) => leave\(onGrid\)\}/);
  assert.match(v, /onPress=\{\(\) => leave\(onCamera\)\}/);
  assert.match(v, /const finish = \(\) => \(onFinish \? leave\(onFinish\) : onClose\(\)\);/);
  assert.doesNotMatch(v, /onFinish \?\? onClose/);
  assert.match(v, /void allowCapture\(ZAS_CAPTURE_KEY\)\.then\(fn\);/);
  // O aviso vai com o id do Zás que está por cima.
  assert.match(v, /topId\.current = cur\?\.id;/);
  assert.match(v, /sendScreenshotNotice\(screenshotKey\.zas\(id\), \(\) => instantsApi\.screenshot\(id\)\)/);
  // Os meus Zás, a grelha e a câmara não bloqueiam nada.
  const part = (a, b) => s.slice(s.indexOf(a), s.indexOf(b));
  for (const [name, body] of [
    ['InstantsDock', part('export function InstantsDock(', 'function StackThumb(')],
    ['InstantsHub', part('export function InstantsHub(', 'function MyInstants(')],
    ['MyInstants', part('function MyInstants(', 'function WhoSheet(')],
  ]) {
    assert.ok(body.length > 200, name);
    assert.doesNotMatch(body, /blockCapture|onScreenshot|preventScreenCapture|ScreenCapture\./, `${name} fica livre`);
  }
  assert.match(s, /<InstantViewer\n\s+items=\{items\.map[^\n]*\n\s+own\n/);
});

test('as conversas avisam com o ecrã focado: a dois e nos TxillGroups (só quem é membro)', () => {
  const d = src('app/messages/[username].tsx');
  assert.match(d, /useScreenshotNotice\(username && first && !first\.blocked \? screenshotKey\.direct\(username\) : null, \(\) => api\.chatScreenshot\(username\)\);/);
  const g = src('app/messages/g/[id].tsx');
  assert.match(g, /useScreenshotNotice\(id && group\?\.myRole \? screenshotKey\.group\(id\) : null, \(\) => gruposApi\.screenshot\(id\)\);/);
  assert.match(src('lib/screenCapture.ts'), /const focused = useIsFocused\(\);/);
});

test('os pedidos à API', () => {
  assert.match(src('lib/api.ts'), /chatScreenshot: \(username: string\): Promise<unknown> => raw\(`\/chat\/with\/\$\{encodeURIComponent\(username\)\}\/screenshot`, post\(\{\}\)\)/);
  assert.match(src('lib/api.grupos.ts'), /screenshot: \(id: string\): Promise<unknown> => raw\(`\/chat\/groups\/\$\{id\}\/screenshot`, post\(\{\}\)\)/);
  assert.match(src('lib/api.geleira.ts'), /screenshot: \(id: string\): Promise<unknown> => raw\(`\/instants\/\$\{id\}\/screenshot`, post\(\{\}\)\)/);
});
