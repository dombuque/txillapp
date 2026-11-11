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
interface Item { username: string; displayName: string; hasAvatar: boolean; verified?: boolean; reason?: string }

describe('sugestões de @menções por proximidade (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  const u: Record<string, U> = {};
  let seq = 0; // cada conta "vem" de um IP diferente: o registo tem limite por IP

  async function signup(name: string, displayName = `${name} Teste`): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').set('X-Forwarded-For', `10.77.${Math.floor(++seq / 250)}.${seq % 250}`).send({ email: `${username}@example.com`, username, displayName, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  const follow = (a: U, b: U) => api().post(`/api/v1/users/${b.username}/follow`).set(auth(a)).expect(200);
  const dm = (a: U, b: U, body: string) => api().post(`/api/v1/chat/with/${b.username}`).set(auth(a)).send({ body }).expect(201);
  async function suggest(x: U, q = '', extra = ''): Promise<Item[]> {
    const r = await api().get(`/api/v1/mentions/suggest?q=${encodeURIComponent(q)}${extra}`).set(auth(x)).expect(200);
    return r.body.items;
  }
  const names = (items: Item[]) => items.map((i) => i.username);

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'm'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    for (const n of ['nsv', 'nschat', 'nsfan', 'nsblk', 'nsblk2', 'nsauthor', 'nscom', 'nsg1', 'nsg2', 'nsout']) u[n] = await signup(n);
    u.nsang = await signup('nsang', `Ângela Quíntia${run}`);
    const { nsv, nschat, nsfan, nsblk, nsblk2 } = u;

    // nschat: conversa a dois, nos dois sentidos. nsfan: só me segue.
    await dm(nsv, nschat, 'olá, vens logo?');
    await dm(nschat, nsv, 'vou sim!');
    await follow(nsfan, nsv);
    // Visitei os perfis de nsblk e nsblk2 (dava pontos), mas há bloqueio: eu bloqueei nsblk, nsblk2 bloqueou-me.
    await pool.query('INSERT INTO social.profile_views (profile_id, viewer_id) VALUES ($1, $3), ($2, $3) ON CONFLICT DO NOTHING', [nsblk.id, nsblk2.id, nsv.id]);
    await follow(nsblk, nsv);
    await api().put(`/api/v1/blocks/${nsblk.username}`).set(auth(nsv)).expect(200);
    await api().put(`/api/v1/blocks/${nsv.username}`).set(auth(nsblk2)).expect(200);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('só "@": a conversa nos dois sentidos vem antes de quem só me segue; eu e os bloqueados nunca', async () => {
    const { nsv, nschat, nsfan, nsblk, nsblk2 } = u;
    const items = await suggest(nsv);
    const list = names(items);
    expect(list).toContain(nschat.username);
    expect(list).toContain(nsfan.username);
    expect(list.indexOf(nschat.username)).toBeLessThan(list.indexOf(nsfan.username));
    expect(items.find((i) => i.username === nschat.username)?.reason).toBe('conversa');
    expect(items.find((i) => i.username === nsfan.username)?.reason).toBe('segue-te');
    expect(list).not.toContain(nsv.username);
    expect(list).not.toContain(nsblk.username);
    expect(list).not.toContain(nsblk2.username);
    // Nem escrevendo o nome deles (a pesquisa geral também os deixa de fora).
    expect(names(await suggest(nsv, nsblk.username))).not.toContain(nsblk.username);
    expect(names(await suggest(nsv, nsblk2.username))).not.toContain(nsblk2.username);
    expect(names(await suggest(nsv, nsv.username))).not.toContain(nsv.username);
  });

  it('filtra pelo início de qualquer palavra do nome, sem maiúsculas nem acentos', async () => {
    const { nsv, nsang } = u;
    await follow(nsv, nsang);
    for (const q of ['angel', 'ÂNGELA', 'ângela', `quintia${run}`, `Quín`]) {
      const items = await suggest(nsv, q);
      expect(names(items)).toContain(nsang.username);
    }
    // Pelo início do @ também.
    expect(names(await suggest(nsv, nsang.username.slice(0, 6)))[0]).toBe(nsang.username);
  });

  it('contexto publicação: o autor e quem comentou sobem para o topo', async () => {
    const { nsv, nsauthor, nscom, nschat } = u;
    const p = (await api().post('/api/v1/posts').set(auth(nsauthor)).send({ body: 'quem vem ao jantar?' }).expect(201)).body;
    await api().post(`/api/v1/posts/${p.id}/comments`).set(auth(nscom)).send({ body: 'eu!' }).expect(201);
    const items = await suggest(nsv, '', `&context=post&id=${p.id}`);
    expect(names(items).slice(0, 2)).toEqual([nsauthor.username, nscom.username]);
    expect(items[0].reason).toBe('neste-post');
    expect(items[1].reason).toBe('neste-post');
    expect(names(items)).toContain(nschat.username); // os próximos continuam lá, só que a seguir
    // Sem contexto, o autor (um desconhecido) nem aparece.
    expect(names(await suggest(nsv))).not.toContain(nsauthor.username);
  });

  it('contexto grupo: só membros, primeiro os mais ativos no grupo; quem não é membro não vê nada', async () => {
    const { nsv, nsg1, nsg2, nschat, nsout } = u;
    const group = (await api().post('/api/v1/chat/groups').set(auth(nsv)).send({ name: `Sugestões ${run}`, members: [nsg1.username, nsg2.username] }).expect(201)).body.id as string;
    for (const body of ['bora', 'bora lá', 'a que horas?']) await api().post(`/api/v1/chat/groups/${group}/messages`).set(auth(nsg2)).send({ body }).expect(201);
    const items = await suggest(nsv, '', `&context=group&id=${group}`);
    expect(names(items)).toEqual([nsg2.username, nsg1.username]);
    expect(items.every((i) => i.reason === 'no-grupo')).toBe(true);
    // Nem a pessoa com quem mais converso, nem a pesquisa geral: fora do grupo não há sugestões.
    expect(await suggest(nsv, nschat.username, `&context=group&id=${group}`)).toEqual([]);
    expect(await suggest(nsout, '', `&context=group&id=${group}`)).toEqual([]);
  });

  it('nunca mais de 8: nem pela proximidade, nem completando com a pesquisa geral', async () => {
    const { nsv } = u;
    const fans: U[] = [];
    const strangers: U[] = [];
    for (let i = 0; i < 10; i++) fans.push(await signup(`nsf${i}`));
    for (let i = 0; i < 10; i++) strangers.push(await signup(`nsl${i}`, `Lima${run} ${i}`));
    for (const f of fans) await follow(f, nsv);
    expect(await suggest(nsv)).toHaveLength(8);
    const lima = await suggest(nsv, `lima${run}`);
    expect(lima).toHaveLength(8);
    expect(names(lima).every((n) => strangers.some((s) => s.username === n))).toBe(true);
    await api().get('/api/v1/mentions/suggest?context=post&id=nao-e-um-id').set(auth(nsv)).expect(400);
  }, 60_000);
});
