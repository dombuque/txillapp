import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';

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
    await pool.query('UPDATE identity.users SET is_admin = true WHERE id = $1', [u.yb.id]);
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
    await api().get('/api/v1/admin/stats').set(auth(ya)).expect(403);
    await send(yb, [{ name: 'app_open' }, { name: 'perf', props: { metric: 'LCP', value: 2400 } }, { name: 'client_error', props: { message: 'boom' } }]).expect(204);
    await api().post('/api/v1/posts').set(auth(yb)).send({ body: 'para as estatísticas' }).expect(201);

    const s = (await api().get('/api/v1/admin/stats?days=7').set(auth(yb)).expect(200)).body;
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
