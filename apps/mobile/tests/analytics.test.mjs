// Testes das estatísticas de uso (src/lib/analytics.ts): fila, lotes, sessão, nomes dos ecrãs, guardar sem rede e
// respeitar "Ajudar a melhorar o Txillapp". E as ligações (lib/analyticsRuntime.tsx, app/_layout.tsx e lib/api*.ts).
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const m = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'analytics.ts')).href);
const src = (p) => readFileSync(path.join(ROOT, 'src', ...p.split('/')), 'utf8');

/** Um ambiente de mentira: relógio e temporizadores à mão, envios registados, armazenamento em memória. */
function fake({ result = 'ok', stored = [] } = {}) {
  const env = {
    clock: 1_800_000_000_000,
    timers: [],
    sent: [],
    saved: null,
    result,
    store: stored,
    n: 0,
  };
  const a = m.createAnalytics({
    platform: 'android',
    version: '1.25.3',
    now: () => env.clock,
    setTimer: (fn, ms) => {
      const t = { fn, ms };
      env.timers.push(t);
      return t;
    },
    clearTimer: (t) => {
      env.timers = env.timers.filter((x) => x !== t);
    },
    random: () => `sessao${String(++env.n).padStart(4, '0')}`,
    send: async (batch, urgent) => {
      env.sent.push({ batch, urgent });
      return typeof env.result === 'function' ? env.result(batch) : env.result;
    },
    save: (items) => {
      env.saved = items;
    },
    load: () => env.store,
  });
  /** Corre os temporizadores pendentes (como se tivessem passado). */
  env.tick = async () => {
    const ts = env.timers.splice(0);
    for (const t of ts) t.fn();
    await a.flush();
  };
  return { a, env };
}
const names = (sent) => sent.flatMap((s) => s.batch.events.map((e) => e.name));

test('a lista de eventos é a mesma que a API aceita (lista fechada)', () => {
  const api = readFileSync(path.join(ROOT, '..', 'api', 'src', 'analytics', 'analytics.service.ts'), 'utf8');
  const block = api.slice(api.indexOf('EVENT_NAMES = ['), api.indexOf('] as const'));
  const fromApi = [...block.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  assert.deepEqual([...m.EVENT_NAMES], fromApi);
  assert.equal(fromApi.length, 20);
});

test('nomes dos ecrãs: do expo-router, sem grupos nem index, e com o parâmetro em vez do valor', () => {
  assert.equal(m.routeName([]), '/');
  assert.equal(m.routeName(['(tabs)']), '/');
  assert.equal(m.routeName(['(tabs)', 'index']), '/');
  assert.equal(m.routeName(['(tabs)', 'messages']), '/messages');
  assert.equal(m.routeName(['u', '[username]']), '/u/[username]');
  assert.equal(m.routeName(['u', '[username]', 'connections']), '/u/[username]/connections');
  assert.equal(m.routeName(['messages', 'g', '[id]']), '/messages/g/[id]');
  assert.equal(m.routeName(['stories', 'new']), '/stories/new');
  // Plano B, pelo endereço: nunca o nome de alguém nem um id.
  assert.equal(m.pathName('/u/ana.silva'), '/u/[username]');
  assert.equal(m.pathName('/u/ana/connections'), '/u/[username]/connections');
  assert.equal(m.pathName('/p/0190f0aa-1111-7000-8000-000000000000?ref=x'), '/p/[id]');
  assert.equal(m.pathName('/messages/joao'), '/messages/[username]');
  assert.equal(m.pathName('/stories/new'), '/stories/new');
  assert.equal(m.pathName('/t/praia'), '/t/[tag]');
  assert.equal(m.pathName('/settings/'), '/settings');
  assert.equal(m.pathName('/'), '/');
});

test('nada de dados pessoais: sem textos, posições, nomes nem objetos; mensagens de erro limpas', () => {
  const p = m.cleanProps({ body: 'olá amor', text: 'x', caption: 'x', q: 'procura', lat: -25.96, lng: 32.57, location: 'Maputo', username: 'ana', email: 'a@b.pt', nested: { a: 1 }, list: [1], fn: () => 1, nan: NaN, n: 3.14159, ok: true, kind: 'text', 'chave estranha': 1 });
  assert.deepEqual(p, { n: 3.142, ok: true, kind: 'text' });
  assert.equal(m.cleanProps({}), undefined);
  assert.equal(Object.keys(m.cleanProps(Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, i])))).length, 12);
  assert.equal(m.cleanProps({ kind: 'x'.repeat(500) }).kind.length, 100);
  const msg = m.scrub('Falhou para ana@mail.com em https://txillapp.com/u/ana?x=1 (@ana_silva) id 0190f0aa-1111-7000-8000-000000000000 em -25.9692,32.5732 tel 841234567');
  assert.doesNotMatch(msg, /ana@mail|txillapp\.com|ana_silva|0190f0aa|25\.9692|841234567/);
  assert.match(msg, /^Falhou para <email> em <url>/);
  assert.ok(m.scrub('x'.repeat(400)).length <= 150);
});

test('sessão: a mesma enquanto houver atividade; nova ao fim de 30 min parado', () => {
  let n = 0;
  const id = () => `s${++n}xxxxxxxx`;
  const a = m.nextSession(null, 1000, id);
  assert.equal(a.fresh, true);
  const b = m.nextSession(a.session, 1000 + 29 * 60_000, id);
  assert.equal(b.fresh, false);
  assert.equal(b.session.id, a.session.id);
  const c = m.nextSession(b.session, b.session.last + 31 * 60_000, id);
  assert.equal(c.fresh, true);
  assert.notEqual(c.session.id, a.session.id);
  // Relógio que andou para trás muito: sessão nova, por segurança.
  assert.equal(m.nextSession(c.session, c.session.last - 3_600_000, id).fresh, true);
  assert.match(m.randomId(), /^[A-Za-z0-9_-]{8,64}$/);
});

test('respeita a escolha: sem saber, espera; ligado, envia; desligado, apaga tudo e não volta a guardar', async () => {
  const { a, env } = fake();
  a.setUser('u1');
  a.track('app_open');
  a.track('screen_view', { path: '/' });
  await env.tick();
  assert.equal(env.sent.length, 0, 'sem saber a escolha da pessoa nada sai do aparelho');
  assert.equal(a.state().queue.length, 2);

  a.setConsent('on');
  await a.flush();
  assert.deepEqual(names(env.sent), ['app_open', 'screen_view']);
  assert.equal(a.state().queue.length, 0);

  a.track('cheer');
  a.setConsent('off');
  assert.equal(a.state().queue.length, 0);
  assert.deepEqual(env.saved, [], 'o que estava guardado no aparelho também sai');
  a.track('follow');
  a.screenView('/u/[username]');
  a.error(new Error('boom'));
  await env.tick();
  assert.equal(a.state().queue.length, 0);
  assert.equal(env.sent.length, 1);
});

test('lotes: a cada 15 s, logo aos 20 eventos, no máximo 40 por pedido, e com plataforma, versão e "há quanto tempo"', async () => {
  const { a, env } = fake();
  a.setUser('u1');
  a.setConsent('on');
  a.track('app_open');
  assert.equal(env.timers.length, 1);
  assert.equal(env.timers[0].ms, m.FLUSH_EVERY_MS);
  env.clock += 5000;
  await env.tick();
  assert.equal(env.sent.length, 1);
  const body = env.sent[0].batch;
  assert.equal(body.platform, 'android');
  assert.equal(body.appVersion, '1.25.3');
  assert.match(body.sessionId, /^[A-Za-z0-9_-]{8,64}$/);
  assert.deepEqual(body.events, [{ name: 'app_open', ago: 5000 }]);

  for (let i = 0; i < 19; i++) a.track('screen_view', { path: `/x${i}` });
  assert.equal(env.sent.length, 1, 'ainda não chegou aos 20');
  a.track('screen_view', { path: '/x19' });
  await a.flush();
  assert.equal(env.sent.length, 2, 'aos 20 envia logo');
  assert.equal(env.sent[1].batch.events.length, 20);

  // Com muitos eventos à espera (ex.: estava sem rede), cada pedido leva no máximo 40.
  const { a: b, env: e2 } = fake();
  b.setUser('u1');
  for (let i = 0; i < 95; i++) b.track('screen_view');
  b.setConsent('on');
  await b.flush();
  assert.deepEqual(e2.sent.map((s) => s.batch.events.length), [40, 40, 15]);
});

test('sem rede: guarda no aparelho (até 200, os mais antigos saem), tenta mais tarde com espera crescente e envia depois', async () => {
  const { a, env } = fake({ result: 'retry' });
  a.setUser('u1');
  a.setConsent('on');
  for (let i = 0; i < 250; i++) a.track('screen_view', { i });
  await a.flush();
  assert.equal(a.state().queue.length, m.MAX_STORED);
  assert.equal(a.state().queue[0].props.i, 50, 'saem os mais antigos');
  assert.equal(env.saved.length, m.MAX_STORED, 'ficou guardado no aparelho');
  assert.equal(env.timers.length, 1);
  const first = env.timers[0].ms;
  await env.tick();
  assert.ok(env.timers[0].ms > first, 'espera mais da segunda vez');

  env.result = 'ok';
  await env.tick();
  assert.equal(a.state().queue.length, 0);
  assert.deepEqual(env.saved, []);
  assert.equal(names(env.sent.slice(-5)).length > 0, true);
});

test('arranque: recupera o que ficou guardado (só o que é válido e com menos de 3 dias) e envia', async () => {
  const now = 1_800_000_000_000;
  const stored = [
    { name: 'app_open', t: now - 60_000, s: 'sessaoantiga1', u: 'u1' },
    { name: 'cheer', t: now - 2 * 86_400_000, s: 'sessaoantiga1', u: null, props: { target: 'post', body: 'segredo' } },
    { name: 'cheer', t: now - 4 * 86_400_000, s: 'sessaoantiga1', u: 'u1' }, // velho demais
    { name: 'compra_secreta', t: now, s: 'sessaoantiga1', u: 'u1' }, // fora da lista
    { name: 'app_open', t: now, s: 'curta', u: 'u1' }, // sessão inválida
    'lixo',
    null,
  ];
  const { a, env } = fake({ stored });
  await a.restore();
  assert.equal(a.state().queue.length, 2);
  assert.deepEqual(a.state().queue[1].props, { target: 'post' }, 'props limpos outra vez');
  a.setUser('u1');
  a.setConsent('on');
  await a.flush();
  assert.equal(env.sent.length, 1);
  assert.deepEqual(env.sent[0].batch.events.map((e) => [e.name, e.ago]), [['app_open', 60_000], ['cheer', 2 * 86_400_000]]);
  assert.equal(env.sent[0].batch.sessionId, 'sessaoantiga1', 'cada lote vai com a sessão dos seus eventos');
  assert.deepEqual(m.sanitizeStored('{}', now), []);
});

test('várias contas no aparelho: eventos de outra conta não vão com esta; os de antes de entrar vão', async () => {
  const { a, env } = fake();
  a.track('app_open'); // antes de entrar (u = null)
  a.setUser('u1');
  a.track('cheer');
  a.setUser('u2'); // mudou de conta antes de enviar
  a.track('follow');
  a.setConsent('on');
  await a.flush();
  assert.deepEqual(names(env.sent), ['app_open', 'follow']);
  assert.equal(a.state().queue.length, 0);
});

test('respostas do servidor: 400 deita fora (não repete), erro de rede ou exceção tenta mais tarde', async () => {
  const { a, env } = fake({ result: 'drop' });
  a.setUser('u1');
  a.setConsent('on');
  a.track('app_open');
  await a.flush();
  assert.equal(a.state().queue.length, 0);
  env.result = () => {
    throw new Error('sem rede');
  };
  a.track('cheer');
  await a.flush();
  assert.equal(a.state().queue.length, 1);
  assert.equal(a.state().failures, 1);
});

test('segundo plano: envia já e marca como urgente (na web vai com keepalive); voltar depois de 30 min é uma abertura nova', async () => {
  const { a, env } = fake();
  a.setUser('u1');
  a.setConsent('on');
  a.track('app_open');
  a.backgrounded();
  await a.flush();
  assert.equal(env.sent[0].urgent, true);
  const s1 = env.sent[0].batch.sessionId;

  env.clock += 10 * 60_000;
  assert.equal(a.resumed(), false, '10 min: a mesma visita');
  env.clock += 31 * 60_000;
  assert.equal(a.resumed(), true);
  await a.flush();
  const last = env.sent.at(-1).batch;
  assert.deepEqual(last.events.map((e) => e.name), ['app_open']);
  assert.equal(last.events[0].props.resume, true);
  assert.notEqual(last.sessionId, s1, 'sessão nova');
});

test('ecrãs só quando mudam; o mesmo erro no máximo 3 vezes por sessão, com o ecrã onde estava', async () => {
  const { a } = fake();
  a.screenView('/');
  a.screenView('/');
  a.screenView('/u/[username]');
  for (let i = 0; i < 6; i++) a.error(new Error(`Cannot read property of undefined`));
  a.error('outra coisa');
  const q = a.state().queue;
  assert.deepEqual(q.filter((e) => e.name === 'screen_view').map((e) => e.props.path), ['/', '/u/[username]']);
  const errs = q.filter((e) => e.name === 'client_error');
  assert.equal(errs.length, 4);
  assert.deepEqual(errs[0].props, { message: 'Cannot read property of undefined', kind: 'error', where: '/u/[username]' });
});

test('nunca rebenta: armazenamento estragado, props esquisitos, nomes fora da lista e `track` antes de a app arrancar', async () => {
  const a = m.createAnalytics({
    platform: 'web',
    send: async () => 'ok',
    save: () => {
      throw new Error('disco cheio');
    },
    load: () => {
      throw new Error('ilegível');
    },
    setTimer: () => 1,
    clearTimer: () => undefined,
  });
  const circular = {};
  circular.self = circular;
  assert.doesNotThrow(() => a.track('screen_view', circular));
  assert.doesNotThrow(() => a.track('nao_existe'));
  await assert.doesNotReject(a.restore());
  a.setUser('u1');
  a.setConsent('on');
  await assert.doesNotReject(a.flush());
  assert.doesNotThrow(() => a.error(undefined));
  assert.doesNotThrow(() => a.persistNow());

  // Chamado de lib/api*.ts antes de o motor estar ligado: espera e segue quando liga.
  m.track('cheer', { target: 'post' });
  const { a: live } = fake();
  m.installAnalytics(live);
  assert.deepEqual(live.state().queue.map((e) => e.name), ['cheer']);
  m.track('follow');
  assert.equal(live.state().queue.length, 2);

  // trackOk: só regista quando corre bem; o erro segue para quem chamou.
  await m.trackOk(Promise.resolve({ cheered: false }), 'cheer', (r) => r.cheered && { target: 'post' });
  await m.trackOk(Promise.resolve({ cheered: true }), 'cheer', (r) => r.cheered && { target: 'post' });
  await assert.rejects(m.trackOk(Promise.reject(new Error('403')), 'follow'));
  assert.deepEqual(live.state().queue.map((e) => e.name), ['cheer', 'follow', 'cheer']);
  // A pesquisa (corre a cada tecla) conta no máximo uma a cada 10 s.
  m.trackThrottled('search', 10_000);
  m.trackThrottled('search', 10_000);
  assert.equal(live.state().queue.filter((e) => e.name === 'search').length, 1);
});

test('ligações: um só ouvinte de navegação no layout raiz, ErrorBoundary e erros globais, e as ações na camada de API', () => {
  const layout = src('app/_layout.tsx');
  assert.equal(layout.match(/<AnalyticsLive /g)?.length, 1);
  assert.match(layout, /startAnalytics\(\)/);
  assert.match(layout, /reportRenderError\(error\)/);
  const rt = src('lib/analyticsRuntime.tsx');
  assert.match(rt, /ErrorUtils/);
  assert.match(rt, /'unhandledrejection'/);
  assert.match(rt, /useSegments\(\)/);
  assert.match(rt, /keepalive: true/);
  assert.match(rt, /shareAnalytics/);
  assert.ok(rt.includes('metric: `first_screen_${platform}`'), 'perf: primeiro ecrã útil, por plataforma');

  const api = src('lib/api.ts') + src('lib/api.compose.ts') + src('lib/api.extra.ts') + src('lib/api.grupos.ts') + src('lib/api.music.ts');
  for (const e of ['post_create', 'story_create', 'comment', 'cheer', 'follow', 'repost', 'share', 'message_send', 'search', 'story_view', 'post_open']) assert.match(api, new RegExp(`'${e}'`), e);
  assert.match(src('lib/nativePush.ts'), /track\('push_enabled'/);
  assert.match(src('lib/push.ts'), /track\('push_enabled'/);
  assert.match(src('lib/push.ts'), /track\('install_accepted'/);

  // Nenhum evento leva o texto escrito pela pessoa nem a posição (só o feitio).
  const calls = [...api.matchAll(/trackOk\([\s\S]*?\)\s*,\s*'[a-z_]+'[^\n]*/g)].map((x) => x[0]);
  for (const c of calls) assert.doesNotMatch(c.slice(c.lastIndexOf("'")), /\b(body|caption|lat|lng|q|username)\s*[:,}]/, c);

  // Os ecrãs das outras equipas ficam como estavam.
  const others = [src('components/PostCard.tsx'), src('app/notifications.tsx'), src('app/invites.tsx'), ...readdirSync(path.join(ROOT, 'src', 'app', 'v'), { recursive: true }).filter((f) => /\.tsx?$/.test(f)).map((f) => src(`app/v/${f.replace(/\\/g, '/')}`))];
  for (const s of others) assert.doesNotMatch(s, /lib\/analytics/);
});
