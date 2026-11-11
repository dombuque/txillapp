import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { staffLogin } from '../staff/staff-test';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';

interface U { token: string; id: string; username: string }

describe('estatísticas de utilização e métricas (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  const u: Record<string, U> = {};
  let staff = '';
  const sauth = () => ({ Authorization: `Bearer ${staff}` });
  const METRICS = 'm'.repeat(24);

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: name, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  const send = (x: U, events: object[], session = `sess_${run}_a`) => api().post('/api/v1/analytics/events').set(auth(x)).send({ sessionId: session, platform: 'pwa', events });

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'a'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test', METRICS_TOKEN: METRICS }));
    await app.init();
    for (const n of ['ya', 'yb']) u[n] = await signup(n);
    staff = (await staffLogin(app, 'yb')).token;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  const mine = async (x: U) => (await pool.query('SELECT name, props, platform FROM analytics.events WHERE user_id = $1 ORDER BY id', [x.id])).rows;

  it('guarda eventos permitidos (limpos e curtos), recusa nomes desconhecidos e exige sessão', async () => {
    const { ya } = u;
    await api().post('/api/v1/analytics/events').send({ sessionId: 'abcdefgh', events: [{ name: 'app_open' }] }).expect(401);
    await send(ya, [{ name: 'app_open' }, { name: 'screen_view', props: { path: '/', nested: { x: 1 }, longo: 'x'.repeat(500), n: 3.14159265 } }, { name: 'perf', props: { metric: 'LCP', value: 1800 } }]).expect(204);
    await send(ya, [{ name: 'compra_secreta' }]).expect(400); // lista fechada
    await send(ya, []).expect(400);
    await api().post('/api/v1/analytics/events').set(auth(ya)).send({ sessionId: 'curto', events: [{ name: 'app_open' }] }).expect(400);

    const ev = await mine(ya);
    expect(ev.map((e) => e.name)).toEqual(['app_open', 'screen_view', 'perf']);
    expect(ev[0].platform).toBe('pwa');
    expect(ev[1].props.nested).toBeUndefined(); // objetos aninhados caem
    expect(ev[1].props.longo).toHaveLength(200); // texto cortado
    expect(ev[1].props.n).toBe(3.142);
  });

  it('cada pessoa pode desligar as estatísticas; apagar a conta apaga os eventos', async () => {
    const { ya } = u;
    expect((await api().get('/api/v1/settings/privacy').set(auth(ya)).expect(200)).body.shareAnalytics).toBe(true);
    await api().patch('/api/v1/settings/privacy').set(auth(ya)).send({ shareAnalytics: false }).expect(200);
    const before = (await mine(ya)).length;
    await send(ya, [{ name: 'app_open' }]).expect(204);
    expect((await mine(ya)).length).toBe(before); // nada guardado
    await api().patch('/api/v1/settings/privacy').set(auth(ya)).send({ shareAnalytics: true }).expect(200);
    await send(ya, [{ name: 'app_open' }]).expect(204);
    expect((await mine(ya)).length).toBe(before + 1);
  });

  it('painel: só moderação; devolve números coerentes (ativos, funil, séries sem buracos, desempenho)', async () => {
    const { ya, yb } = u;
    await api().get('/api/v1/admin/stats').set(auth(ya)).expect(401);
    await send(yb, [{ name: 'app_open' }, { name: 'perf', props: { metric: 'LCP', value: 2400 } }, { name: 'client_error', props: { message: 'boom' } }]).expect(204);
    await api().post('/api/v1/posts').set(auth(yb)).send({ body: 'para as estatísticas' }).expect(201);

    const s = (await api().get('/api/v1/admin/stats?days=7').set(sauth()).expect(200)).body;
    expect(s.days).toBe(7);
    expect(s.series.posts).toHaveLength(7); // um valor por dia, mesmo sem dados
    expect(s.series.posts[6].value).toBeGreaterThanOrEqual(1);
    expect(s.active.dau).toBeGreaterThanOrEqual(2);
    expect(s.active.mau).toBeGreaterThanOrEqual(s.active.dau);
    expect(s.funnel.signed).toBeGreaterThanOrEqual(2);
    expect(s.funnel.posted).toBeGreaterThanOrEqual(1);
    expect(s.perf.find((p: { metric: string }) => p.metric === 'LCP').p75).toBeGreaterThan(0);
    expect(s.errors.map((e: { message: string }) => e.message)).toContain('boom');
    expect(s.platform.find((p: { platform: string }) => p.platform === 'pwa').users).toBeGreaterThanOrEqual(2);
  });

  it('a app (Android, iPhone e web) manda a plataforma e a versão; a mesma pessoa na app e no site conta uma vez', async () => {
    const yc = await signup('yc');
    const from = (platform: string, events: object[], extra: object = {}) =>
      api().post('/api/v1/analytics/events').set(auth(yc)).send({ sessionId: `sess_${run}_${platform}`, platform, events, ...extra });
    const before = (await api().get('/api/v1/admin/stats?days=7').set(sauth()).expect(200)).body;

    await from('android', [{ name: 'app_open' }, { name: 'screen_view', props: { path: '/u/[username]' } }], { appVersion: '1.25.3' }).expect(204);
    await from('ios', [{ name: 'app_open' }], { appVersion: '1.25.3' }).expect(204);
    await from('web', [{ name: 'app_open', props: { standalone: true } }], { appVersion: '1.25.3' }).expect(204);
    await from('pwa', [{ name: 'app_open' }]).expect(204); // o site antigo, sem versão
    // Guardados no aparelho sem rede: até 3 dias atrás entram com a hora certa; mais do que isso é recusado.
    await from('android', [{ name: 'cheer', props: { target: 'post' }, ago: 2 * 86_400_000 }], { appVersion: '1.25.3' }).expect(204);
    await from('android', [{ name: 'cheer', ago: 4 * 86_400_000 }], { appVersion: '1.25.3' }).expect(400);
    await from('windows', [{ name: 'app_open' }]).expect(400); // plataforma desconhecida
    await from('android', [{ name: 'app_open' }], { appVersion: '1.0 <b>' }).expect(400); // versão com lixo
    // Lotes até 40 eventos (a app manda no máximo 40 de cada vez).
    await from('web', Array.from({ length: 40 }, () => ({ name: 'screen_view', props: { path: '/' } })), { appVersion: '1.25.3' }).expect(204);
    await from('web', Array.from({ length: 41 }, () => ({ name: 'screen_view' })), { appVersion: '1.25.3' }).expect(400);

    const ev = (await pool.query(`SELECT name, platform, app_version, extract(epoch FROM now() - at) AS age FROM analytics.events WHERE user_id = $1 ORDER BY id`, [yc.id])).rows;
    expect(ev.filter((e) => e.name === 'app_open').map((e) => [e.platform, e.app_version])).toEqual([['android', '1.25.3'], ['ios', '1.25.3'], ['web', '1.25.3'], ['pwa', null]]);
    const old = ev.find((e) => e.name === 'cheer');
    expect(Number(old.age)).toBeGreaterThan(2 * 86_400 - 60);
    expect(Number(old.age)).toBeLessThan(2 * 86_400 + 60);

    const s = (await api().get('/api/v1/admin/stats?days=7').set(sauth()).expect(200)).body;
    expect(s.active.dau).toBe(before.active.dau + 1); // quatro plataformas, uma pessoa
    for (const p of ['android', 'ios', 'web']) expect(s.platform.find((x: { platform: string }) => x.platform === p).users).toBeGreaterThanOrEqual(1);
    expect(s.versions).toContainEqual({ platform: 'android', version: '1.25.3', users: expect.any(Number) });
    expect(s.versions.every((v: { version: string | null }) => v.version)).toBe(true);
    expect(s.screens.map((x: { path: string }) => x.path)).toContain('/u/[username]');
  });

  it('métricas Prometheus: só com o token certo; rotas em padrão, nunca ids reais', async () => {
    await api().get('/api/v1/metrics').expect(401);
    await api().get('/api/v1/metrics').set('Authorization', 'Bearer errado-errado-errado-1').expect(401);
    await api().get('/api/v1/health/ready').expect(200);
    await api().get('/api/v1/posts/00000000-0000-7000-8000-000000000000').set(auth(u.ya)).expect(404);
    const m = await api().get('/api/v1/metrics').set('Authorization', `Bearer ${METRICS}`).expect(200);
    expect(m.headers['content-type']).toMatch(/text\/plain/);
    expect(m.text).toMatch(/http_request_duration_seconds_count\{[^}]*route="\/api\/v1\/health\/ready"/);
    expect(m.text).toMatch(/route="\/api\/v1\/posts\/:id"/);
    expect(m.text).not.toContain('00000000-0000-7000'); // nenhum id nas etiquetas
    expect(m.text).toMatch(/process_cpu_user_seconds_total/);
  });
});
