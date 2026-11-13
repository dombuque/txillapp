import 'reflect-metadata';
import http from 'http';
import { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import { Pool } from 'pg';
import request from 'supertest';
import { SearchStatsService } from '../analytics/search-stats.service';
import { ChatEvents } from '../chat/chat.events';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const REDIS = process.env.TEST_REDIS_URL;
const PASSWORD = 'password-bem-longa-1';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface U { token: string; id: string; username: string }
interface Stream { events: { type: string; [k: string]: unknown }[]; close: () => void }

/**
 * Duas instâncias da API na mesma base de dados e no mesmo Redis (docs/escala.md), como as réplicas atrás do nginx:
 * o que acontece numa chega a quem está ligado à outra. Só corre com TEST_REDIS_URL
 * (ex.: redis://localhost:6380 com `docker run -d --name t-redis -p 6380:6379 redis:7-alpine`).
 */
(REDIS ? describe : describe.skip)('duas instâncias com o mesmo Redis (integração)', () => {
  let A: INestApplication;
  let B: INestApplication;
  let pool: Pool;
  const port: Record<'A' | 'B', number> = { A: 0, B: 0 };
  const run = Date.now().toString(36);
  const u: Record<string, U> = {};
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  const env = () => loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'z'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test', REDIS_URL: REDIS!, ROLE: 'web' });
  const at = (app: INestApplication) => request(app.getHttpServer());

  /** Abre o canal em tempo real (SSE) de `x` na instância dada, como a app. */
  async function stream(which: 'A' | 'B', x: U): Promise<Stream> {
    const events: Stream['events'] = [];
    let buf = '';
    const req = http.get({ port: port[which], path: '/api/v1/chat/stream', headers: { ...auth(x), Accept: 'text/event-stream' } }, (res) => {
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        buf += chunk;
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) if (line.startsWith('data:')) events.push(JSON.parse(line.slice(5)));
      });
    });
    req.on('error', () => undefined);
    await sleep(300); // ligado
    return { events, close: () => req.destroy() };
  }
  /** Espera até `ok` (ou desiste ao fim de ~3 s). */
  async function until(ok: () => boolean | Promise<boolean>) {
    for (let i = 0; i < 30; i++) {
      if (await ok()) return true;
      await sleep(100);
    }
    return false;
  }

  beforeAll(async () => {
    const r = new Redis(REDIS!);
    await r.flushdb(); // o Redis dos testes é só deste teste (os limites de pedidos de corridas anteriores saem)
    await r.quit();
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    A = await createApp(env());
    await A.listen(0);
    B = await createApp(env());
    await B.listen(0);
    port.A = (A.getHttpServer().address() as { port: number }).port;
    port.B = (B.getHttpServer().address() as { port: number }).port;
    for (const [n, app] of [['ra', A], ['rb', B], ['rc', A]] as const) {
      const username = `${n}${run}`.slice(0, 28);
      const res = await at(app).post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${n.toUpperCase()} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
      u[n] = { token: res.body.accessToken, id: res.body.user.id, username };
    }
    // Todos se seguem (as chamadas, por omissão, só entre quem se segue um ao outro).
    for (const x of Object.values(u)) for (const y of Object.values(u)) if (x !== y) await pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [x.id, y.id]);
  }, 60_000);

  afterAll(async () => {
    await A?.close();
    await B?.close();
    await pool?.end();
  });

  it('uma mensagem enviada na instância A chega pelo SSE a quem está ligado à instância B (e o eco aos aparelhos de quem enviou)', async () => {
    const { ra, rb } = u;
    const bOnB = await stream('B', rb);
    const aOnB = await stream('B', ra); // o outro aparelho de quem envia, ligado à outra instância
    try {
      await at(A).post(`/api/v1/chat/with/${rb.username}`).set(auth(ra)).send({ body: 'olá da instância A' }).expect(201);
      expect(await until(() => bOnB.events.some((e) => e.type === 'message' && e.from === ra.username))).toBe(true);
      expect(await until(() => aOnB.events.some((e) => e.type === 'message' && e.self === true && e.from === rb.username))).toBe(true);
      // Uma vez só (a instância B não recebe o evento duas vezes).
      await sleep(200);
      expect(bOnB.events.filter((e) => e.type === 'message').length).toBe(1);
    } finally {
      bOnB.close();
      aOnB.close();
    }
  });

  it('quem está ligado, a conversa à vista e «a escrever» num post valem nas duas instâncias', async () => {
    const { ra, rb, rc } = u;
    const online = async (app: INestApplication) => (await at(app).post('/api/v1/presence/online').set(auth(rc)).send({ usernames: [rb.username] }).expect(200)).body.online as string[];
    expect(await online(A)).toEqual([]);
    const s = await stream('B', rb);
    expect(await until(async () => (await online(A)).length === 1)).toBe(true);
    s.close();
    expect(await until(async () => (await online(A)).length === 0)).toBe(true);

    // rb tem a conversa com ra aberta (avisou a instância B): a instância A sabe e não manda aviso para o telemóvel.
    await at(B).put('/api/v1/chat/active').set(auth(rb)).send({ key: `u:${ra.username}` }).expect(204);
    expect(await A.get(ChatEvents).isActive(rb.id, `u:${ra.username}`)).toBe(true);
    await at(A).put('/api/v1/chat/active').set(auth(rb)).send({ key: null }).expect(204);
    expect(await B.get(ChatEvents).isActive(rb.id, `u:${ra.username}`)).toBe(false);

    // rc escreve um comentário (sinal na A); rb, a ver o post na B, vê-o.
    const post = (await at(A).post('/api/v1/posts').set(auth(ra)).send({ body: 'comentem nas duas instâncias' }).expect(201)).body;
    await at(A).post('/api/v1/presence/typing').set(auth(rc)).send({ postId: post.id }).expect(204);
    expect((await at(B).get(`/api/v1/presence/typing?postId=${post.id}`).set(auth(rb)).expect(200)).body.names).toEqual(['RC']);
  });

  it('chamadas: liga na A, toca na B; atende na B, a A sabe; desliga na A, a B sabe', async () => {
    const { ra, rb } = u;
    const caller = await stream('A', ra);
    const callee = await stream('B', rb);
    try {
      const c = (await at(A).post('/api/v1/calls').set(auth(ra)).send({ username: rb.username, video: false }).expect(201)).body;
      expect(await until(() => callee.events.some((e) => e.type === 'call' && e.event === 'ring' && e.callId === c.id))).toBe(true);
      await at(B).post(`/api/v1/calls/${c.id}/accept`).set(auth(rb)).expect(200);
      expect(await until(() => caller.events.some((e) => e.type === 'call' && e.event === 'accepted' && e.callId === c.id))).toBe(true);
      await at(A).post(`/api/v1/calls/${c.id}/end`).set(auth(ra)).expect(200);
      expect(await until(() => callee.events.some((e) => e.type === 'call' && e.event === 'ended' && e.callId === c.id && e.reason === 'ended'))).toBe(true);
    } finally {
      caller.close();
      callee.close();
    }
  });

  it('pesquisas: as letras a chegar a instâncias diferentes contam só o termo final, uma vez por dia', async () => {
    const { rc } = u;
    const word = `praia${run.replace(/\d/g, (d) => 'abcdefghij'[Number(d)])}`;
    const sa = A.get(SearchStatsService);
    const sb = B.get(SearchStatsService);
    const count = async () => (await pool.query(`SELECT term, searches FROM analytics.search_terms WHERE term LIKE $1 ORDER BY term`, [`${word.slice(0, 3)}%${word.slice(5)}%`])).rows;
    sa.note(rc.id, word.slice(0, 3), false); // «pra» na A
    await sleep(50);
    sb.note(rc.id, word.slice(0, 4), false); // «prai» na B
    await sleep(50);
    sa.note(rc.id, word, false); // o termo inteiro, outra vez na A
    await sleep(50);
    await Promise.all([sa.flush(), sb.flush()]);
    expect(await count()).toEqual([{ term: word, searches: 1 }]);
    // A mesma pessoa, o mesmo termo, no mesmo dia, na outra instância: não conta outra vez.
    sb.note(rc.id, word, false);
    await sleep(50);
    await sb.flush();
    expect(await count()).toEqual([{ term: word, searches: 1 }]);
  });

  it('os limites de pedidos contam nas duas instâncias juntas (Redis)', async () => {
    // POST /auth/delete-account/preview: 20 por minuto. 21 pedidos alternados A, B, A…: o 21.º já é recusado.
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      const r = await at(i % 2 ? B : A).post('/api/v1/auth/delete-account/preview').send({ token: 'x'.repeat(40) });
      statuses.push(r.status);
    }
    expect(statuses.slice(0, 20).every((s) => s !== 429)).toBe(true);
    expect(statuses[20]).toBe(429);
  });
});
