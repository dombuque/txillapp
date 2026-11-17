import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';

interface U { token: string; id: string; username: string }

/**
 * Envio sem rede (app: lib/chatPending, migração 0175): a app repete o envio com o mesmo `clientId` quando a resposta se
 * perdeu, e o servidor devolve a mensagem que já existe em vez de criar outra. Conversas a dois e TxillGroups.
 */
describe('mensagens repetidas com o mesmo clientId (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  const u: Record<string, U> = {};

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  const sendTo = (from: U, to: U, b: Record<string, unknown>) => api().post(`/api/v1/chat/with/${to.username}`).set(auth(from)).send(b);
  const countWith = async (from: U, body: string) => Number((await pool.query('SELECT count(*) FROM social.messages WHERE sender_id = $1 AND body = $2', [from.id, body])).rows[0].count);

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'c'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    for (const n of ['ra', 'rb', 'rc']) u[n] = await signup(n);
    const ids = Object.values(u).map((x) => x.id);
    for (const a of ids) for (const b of ids) if (a !== b) await pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [a, b]);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('a dois: o mesmo clientId devolve a mesma mensagem (não duplica); outro clientId é outra mensagem', async () => {
    const { ra, rb } = u;
    const clientId = randomUUID();
    const first = (await sendTo(ra, rb, { body: 'olá sem rede', clientId }).expect(201)).body;
    const again = (await sendTo(ra, rb, { body: 'olá sem rede', clientId }).expect(201)).body;
    expect(again).toEqual(first);
    expect(await countWith(ra, 'olá sem rede')).toBe(1);
    const thread = (await api().get(`/api/v1/chat/with/${rb.username}`).set(auth(ra)).expect(200)).body.items as { id: string; body: string }[];
    expect(thread.filter((m) => m.body === 'olá sem rede')).toHaveLength(1);
    // Outra mensagem (outro clientId) com o mesmo texto: entra.
    const other = (await sendTo(ra, rb, { body: 'olá sem rede', clientId: randomUUID() }).expect(201)).body;
    expect(other.id).not.toBe(first.id);
    // Sem clientId (versões antigas da app): como antes, cada envio é uma mensagem.
    await sendTo(ra, rb, { body: 'olá sem rede' }).expect(201);
    expect(await countWith(ra, 'olá sem rede')).toBe(3);
  });

  it('dois pedidos iguais ao mesmo tempo: uma só mensagem, o mesmo id para os dois', async () => {
    const { ra, rb } = u;
    const clientId = randomUUID();
    const [a, b] = await Promise.all([sendTo(ra, rb, { body: 'ao mesmo tempo', clientId }), sendTo(ra, rb, { body: 'ao mesmo tempo', clientId })]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.id).toBe(b.body.id);
    expect(await countWith(ra, 'ao mesmo tempo')).toBe(1);
  });

  it('a repetição de uma que já entrou devolve-a mesmo que agora as regras digam que não (ex.: bloqueado depois)', async () => {
    const { rc, rb } = u;
    const clientId = randomUUID();
    const first = (await sendTo(rc, rb, { kind: 'sticker', body: 'brinde', clientId }).expect(201)).body;
    await api().put(`/api/v1/blocks/${rc.username}`).set(auth(rb)).expect(200);
    expect((await sendTo(rc, rb, { kind: 'sticker', body: 'brinde', clientId }).expect(201)).body.id).toBe(first.id);
    // Uma nova é recusada (403: a app mostra «Não enviada»).
    await sendTo(rc, rb, { body: 'nova', clientId: randomUUID() }).expect(403);
    await api().delete(`/api/v1/blocks/${rc.username}`).set(auth(rb)).expect(200);
  });

  it('o clientId é de quem envia: o mesmo uuid de outra pessoa não choca', async () => {
    const { ra, rb } = u;
    const clientId = randomUUID();
    const a = (await sendTo(ra, rb, { body: 'mesmo uuid', clientId }).expect(201)).body;
    const b = (await sendTo(rb, ra, { body: 'mesmo uuid', clientId }).expect(201)).body;
    expect(a.id).not.toBe(b.id);
  });

  it('clientId que não é uuid: 400', async () => {
    const { ra, rb } = u;
    await sendTo(ra, rb, { body: 'x', clientId: 'nao-e-uuid' }).expect(400);
  });

  it('TxillGroups: o mesmo clientId devolve a mesma mensagem (texto e GIF), também ao mesmo tempo', async () => {
    const { ra, rb, rc } = u;
    const groupId = (await api().post('/api/v1/chat/groups').set(auth(ra)).send({ name: 'Malta sem rede', members: [rb.username, rc.username] }).expect(201)).body.id as string;
    const gsend = (b: Record<string, unknown>) => api().post(`/api/v1/chat/groups/${groupId}/messages`).set(auth(ra)).send(b);
    const clientId = randomUUID();
    const first = (await gsend({ body: 'no grupo sem rede', clientId }).expect(201)).body;
    expect((await gsend({ body: 'no grupo sem rede', clientId }).expect(201)).body).toEqual(first);
    const [x, y] = await Promise.all([gsend({ body: 'grupo ao mesmo tempo', clientId: clientId.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')) }), gsend({ body: 'grupo ao mesmo tempo', clientId: clientId.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')) })]);
    expect(x.status).toBe(201);
    expect(y.status).toBe(201);
    expect(x.body.id).toBe(y.body.id);
    const items = (await api().get(`/api/v1/chat/groups/${groupId}`).set(auth(rb)).expect(200)).body.items as { id: string; body: string }[];
    expect(items.filter((m) => m.body === 'no grupo sem rede')).toHaveLength(1);
    expect(items.filter((m) => m.body === 'grupo ao mesmo tempo')).toHaveLength(1);
    // Um GIF repetido também.
    const gif = { id: 'abc123', w: 200, h: 150, url: 'https://media.giphy.com/media/abc123/giphy.gif' };
    const gid = randomUUID();
    const g1 = (await gsend({ kind: 'gif', gif, clientId: gid }).expect(201)).body;
    expect((await gsend({ kind: 'gif', gif, clientId: gid }).expect(201)).body.id).toBe(g1.id);
    expect(Number((await pool.query('SELECT count(*) FROM social.messages WHERE group_id = $1 AND kind = $2', [groupId, 'gif'])).rows[0].count)).toBe(1);
  });
});
