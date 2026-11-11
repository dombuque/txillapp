// Testes do lembrete "As tuas notificações estão desligadas" (src/lib/pushReminder.ts): quando mostrar, as pausas
// crescentes depois de cada "Agora não", o limite de um por dia e o que o botão faz por estado e plataforma.
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const r = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'pushReminder.ts')).href);

const DAY = r.DAY;
const T0 = Date.UTC(2026, 10, 11, 10, 0, 0);
/** Uma pessoa que já abriu a app 3 vezes e nunca viu o lembrete. */
const mem = (o = {}) => ({ ...r.EMPTY_MEMORY, sessions: 3, ...o });
/** Tudo a favor: desligadas, acolhimento feito, nas Mensagens, nada aberto. */
const ctx = (o = {}) => ({ now: T0, status: 'undetermined', trigger: 'inbox', path: '/messages', onboardingDone: true, allCategoriesOff: false, busy: false, ...o });
const why = (m, c) => r.decideReminder(m, c).why;

test('com tudo a favor, mostra', () => {
  assert.deepEqual(r.decideReminder(mem(), ctx()), { show: true, why: 'show' });
});

test('nunca na primeira sessão nem antes do acolhimento das permissões', () => {
  assert.equal(why(mem({ sessions: 0 }), ctx()), 'first-session');
  assert.equal(why(mem({ sessions: 1 }), ctx()), 'first-session');
  assert.equal(why(mem({ sessions: 2 }), ctx()), 'show');
  assert.equal(why(mem(), ctx({ onboardingDone: false })), 'onboarding');
  // A primeira abertura conta como sessão 1: o lembrete só pode vir na seguinte.
  const first = r.startSession(r.EMPTY_MEMORY, T0);
  assert.equal(first.memory.sessions, 1);
  assert.equal(first.returned, false);
  assert.equal(why(first.memory, ctx()), 'first-session');
  assert.equal(why(r.startSession(first.memory, T0 + 60_000).memory, ctx()), 'show');
});

test('não mostra se já estão ligadas, sem suporte, desligadas de propósito ou com todas as categorias desligadas', () => {
  for (const s of ['granted', 'unsupported', 'off-by-choice']) assert.equal(why(mem(), ctx({ status: s })), 'on-or-unsupported', s);
  for (const s of ['undetermined', 'denied', 'blocked', 'needs-install']) assert.equal(why(mem(), ctx({ status: s })), 'show', s);
  assert.equal(why(mem(), ctx({ allCategoriesOff: true })), 'categories-off');
  assert.equal(r.allCategoriesOff({ categories: ['messages', 'follows'], off: ['follows', 'messages'] }), true);
  assert.equal(r.allCategoriesOff({ categories: ['messages', 'follows'], off: ['follows'] }), false);
  assert.equal(r.allCategoriesOff({ categories: [], off: [] }), false);
  assert.equal(r.allCategoriesOff(null), false);
});

test('nunca por cima de outra coisa nem fora dos ecrãs certos', () => {
  assert.equal(why(mem(), ctx({ busy: true })), 'busy');
  // depois de enviar: só na conversa com essa pessoa
  assert.equal(r.screenAllows('sent', '/messages/ana'), true);
  assert.equal(r.screenAllows('sent', '/messages/ana/'), true);
  assert.equal(r.screenAllows('sent', '/messages/new'), false);
  assert.equal(r.screenAllows('sent', '/messages/g/123'), false);
  assert.equal(r.screenAllows('sent', '/messages'), false);
  // ao abrir as Mensagens: só na lista
  assert.equal(r.screenAllows('inbox', '/messages'), true);
  assert.equal(r.screenAllows('inbox', '/'), false);
  // ao voltar: Início ou Mensagens; nunca na câmara, numa chamada, num perfil…
  assert.equal(r.screenAllows('return', '/'), true);
  assert.equal(r.screenAllows('return', '/messages'), true);
  for (const p of ['/new', '/call/abc', '/messages/ana', '/reels', '/settings', '/stories/new']) assert.equal(r.screenAllows('return', p), false, p);
  assert.equal(why(mem(), ctx({ trigger: 'return', path: '/new' })), 'screen');
});

test('no máximo uma vez por dia', () => {
  const m = mem({ shownAt: T0 });
  assert.equal(why(m, ctx({ now: T0 + 1 })), 'today');
  assert.equal(why(m, ctx({ now: T0 + DAY - 1 })), 'today');
  assert.equal(why(m, ctx({ now: T0 + DAY })), 'show');
  assert.equal(why(r.markShown(mem(), T0), ctx({ now: T0 + 5 * 60_000 })), 'today');
});

test('as pausas depois de cada "Agora não" crescem: 3, 7, 14 e depois 30 dias', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 12].map(r.snoozeDays), [0, 3, 7, 14, 30, 30, 30]);
  let m = mem();
  let now = T0;
  const gaps = [];
  for (let i = 0; i < 6; i++) {
    assert.equal(why(m, ctx({ now })), 'show');
    m = r.markShown(m, now);
    m = r.markDismissed(m, now);
    const next = r.nextAllowedAt(m);
    gaps.push((next - now) / DAY);
    assert.equal(why(m, ctx({ now: next - 1 })), 'snoozed');
    now = next;
  }
  assert.deepEqual(gaps, [3, 7, 14, 30, 30, 30]);
});

test('ligar as notificações recomeça as pausas do início', () => {
  let m = r.markDismissed(r.markDismissed(mem(), T0), T0);
  assert.equal(r.snoozeDays(m.dismissals), 7);
  m = r.markEnabled(m);
  assert.equal(m.dismissals, 0);
  assert.equal(m.dismissedAt, null);
  assert.equal(why(m, ctx({ now: T0 + 1 })), 'show');
});

test('voltar à app depois de 1 dia ou mais', () => {
  const m = mem({ activeAt: T0 });
  assert.equal(r.markActive(m, T0 + DAY - 1).returned, false);
  assert.equal(r.markActive(m, T0 + DAY).returned, true);
  assert.equal(r.markActive(m, T0 + DAY).memory.activeAt, T0 + DAY);
  assert.equal(r.startSession(m, T0 + 2 * DAY).returned, true);
  assert.equal(r.startSession(m, T0 + 3_600_000).returned, false);
  assert.equal(r.markActive(r.EMPTY_MEMORY, T0).returned, false); // sem registo não conta como regresso
  assert.equal(r.markAway(m, T0 + 50).activeAt, T0 + 50);
});

test('o que se guarda: lê lixo sem rebentar e volta a ler o que escreveu', () => {
  for (const raw of [null, '', 'lixo', '[]', 'null', '{"sessions":"3","shownAt":-5,"dismissals":null}']) {
    const m = r.parseMemory(raw);
    assert.equal(typeof m.sessions, 'number');
    assert.equal(m.shownAt, null);
    assert.equal(m.dismissals, 0);
  }
  const m = { sessions: 4, shownAt: T0, dismissals: 2, dismissedAt: T0 - DAY, activeAt: T0 };
  assert.deepEqual(r.parseMemory(r.serializeMemory(m)), m);
  assert.match(r.REMINDER_KEY, /^[A-Za-z0-9._-]+$/); // o cofre do telemóvel só aceita estas letras
});

test('estado no nativo: granted, undetermined, denied e blocked (canAskAgain=false); regista outra vez sem código', () => {
  assert.deepEqual(r.nativeStatus({ granted: true, status: 'granted', canAskAgain: true, hasToken: true }), { status: 'granted', resync: false });
  assert.deepEqual(r.nativeStatus({ granted: true, status: 'granted', canAskAgain: true, hasToken: false }), { status: 'granted', resync: true });
  assert.equal(r.nativeStatus({ granted: false, status: 'undetermined', canAskAgain: true, hasToken: false }).status, 'undetermined');
  assert.equal(r.nativeStatus({ granted: false, status: 'denied', canAskAgain: true, hasToken: false }).status, 'denied');
  assert.equal(r.nativeStatus({ granted: false, status: 'denied', canAskAgain: false, hasToken: false }).status, 'blocked');
});

test('estado na web: licença, suporte, iPhone sem a app no ecrã principal e a escolha do interruptor', () => {
  const w = (o) => r.webStatus({ ios: false, standalone: false, supported: true, permission: 'default', subscribed: false, choice: null, ...o });
  assert.deepEqual(w({ ios: true, supported: false }), { status: 'needs-install', resync: false });
  assert.equal(w({ ios: true, standalone: true, supported: false }).status, 'unsupported'); // iOS antigo
  assert.equal(w({ ios: true, standalone: true, permission: 'granted', subscribed: true }).status, 'granted');
  assert.equal(w({ supported: false }).status, 'unsupported');
  assert.equal(w({ permission: 'denied' }).status, 'blocked');
  assert.equal(w({}).status, 'undetermined');
  assert.deepEqual(w({ permission: 'granted', subscribed: true }), { status: 'granted', resync: false });
  // licença dada mas a subscrição desapareceu: se tinha ligado, refaz-se em silêncio
  assert.deepEqual(w({ permission: 'granted', choice: 'on' }), { status: 'undetermined', resync: true });
  assert.deepEqual(w({ permission: 'granted', choice: null }), { status: 'undetermined', resync: false });
  // desligou de propósito no interruptor: nem lembra nem refaz
  assert.deepEqual(w({ permission: 'granted', choice: 'off' }), { status: 'off-by-choice', resync: false });
});

test('o botão "Ligar notificações" por estado e plataforma', () => {
  const a = r.reminderAction;
  assert.equal(a('undetermined', 'android'), 'ask');
  assert.equal(a('undetermined', 'ios'), 'ask');
  assert.equal(a('undetermined', 'web'), 'ask');
  assert.equal(a('denied', 'android'), 'ask');
  assert.equal(a('blocked', 'android'), 'settings');
  assert.equal(a('blocked', 'ios'), 'settings');
  assert.equal(a('blocked', 'web'), 'browser-steps');
  assert.equal(a('needs-install', 'web'), 'install');
  for (const s of ['granted', 'unsupported', 'off-by-choice']) assert.equal(a(s, 'web'), 'none');
});

test('os passos certos para cada browser', () => {
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
  const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1';
  const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36';
  const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';
  const MAC_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
  const WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 Edg/131.0';
  assert.equal(r.webKind(IPHONE, { standalone: true }), 'ios-pwa');
  assert.equal(r.webKind(IPHONE, { standalone: false }), 'ios-browser');
  assert.equal(r.webKind(MAC_SAFARI, { standalone: false, touchMac: true }), 'ios-browser'); // iPad a fingir que é Mac
  assert.equal(r.webKind(ANDROID, { standalone: false }), 'android');
  assert.equal(r.webKind(ANDROID, { standalone: true }), 'android-pwa');
  assert.equal(r.webKind(MAC_SAFARI, { standalone: false }), 'mac-safari');
  assert.equal(r.webKind(MAC_CHROME, { standalone: false }), 'desktop');
  assert.equal(r.webKind(WIN, { standalone: false }), 'desktop');
  assert.equal(r.isIosSafari(IPHONE), true);
  assert.equal(r.isIosSafari(IPHONE_CHROME), false);

  for (const k of ['ios-pwa', 'ios-browser', 'android', 'android-pwa', 'mac-safari', 'desktop']) {
    const s = r.blockedSteps(k);
    assert.ok(s.length >= 2 && s.every((x) => typeof x === 'string' && x.endsWith('.')), k);
  }
  assert.match(r.blockedSteps('ios-pwa').join(' '), /Definições do iPhone/);
  assert.match(r.blockedSteps('android').join(' '), /cadeado/);
  assert.match(r.blockedSteps('desktop').join(' '), /cadeado/);
  // instalar no iPhone: no Safari, Partilhar › Adicionar ao ecrã principal; noutro browser, primeiro abrir no Safari
  assert.match(r.installSteps(true).join(' '), /Partilhar.*Adicionar ao ecrã principal/);
  assert.match(r.installSteps(false)[0], /Safari/);
  assert.equal(r.installSteps(false).length, r.installSteps(true).length + 1);
  assert.match(r.INSTALL_NOTE, /só funcionam com o Txillapp no ecrã principal/);
});

test('os textos da folha', () => {
  assert.equal(r.REMINDER_TITLE, 'As tuas notificações estão desligadas');
  assert.equal(r.REMINDER_BUTTON, 'Ligar notificações');
  assert.equal(r.REMINDER_LATER, 'Agora não');
  assert.equal(r.SETTINGS_BANNER, 'As notificações estão desligadas neste aparelho');
  assert.equal(r.reminderText('Ana'), 'Não percas quando Ana responder.');
  assert.equal(r.reminderText('  '), 'Não percas mensagens, chamadas e quem brinda o que publicas.');
  assert.equal(r.reminderText(undefined), 'Não percas mensagens, chamadas e quem brinda o que publicas.');
});

test('a folha rola e os botões ficam fora da parte que rola (nunca escondidos em ecrãs pequenos)', () => {
  const src = readFileSync(path.join(ROOT, 'src', 'components', 'PushReminder.tsx'), 'utf8');
  const sheet = src.slice(src.indexOf('export function PushReminderSheet'), src.indexOf('/* ───────────── o anfitrião'));
  const scrollEnd = sheet.indexOf('</SheetScroll>');
  assert.ok(scrollEnd > 0, 'o conteúdo está dentro de SheetScroll (ScrollView)');
  const primary = sheet.indexOf('void press()');
  assert.ok(primary > scrollEnd, 'o botão principal vem depois da parte que rola');
  assert.match(src, /wrap: \{ flexShrink: 1/);
  assert.match(src, /scroll: \{ flexGrow: 0, flexShrink: 1/);
  // áreas de toque de 44 pt ou mais
  for (const k of ['primary', 'later', 'bannerBtn']) {
    const m = src.match(new RegExp(`\\b${k}: \\{ minHeight: (\\d+)`));
    assert.ok(m && Number(m[1]) >= 44, k);
  }
});
