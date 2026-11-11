import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';

interface U { token: string; id: string; username: string }
interface Strip {
  mine: unknown;
  items: { username: string }[];
  people: { username: string; displayName: string; hasAvatar: boolean; lastAt: string }[];
}

describe('Notas: pessoas das conversas na faixa (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: 'password-bem-longa-1', birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }

  const send = (a: U, b: U, body: string) => api().post(`/api/v1/chat/with/${b.username}`).set(auth(a)).send({ body }).expect(201);
  const strip = async (x: U) => (await api().get('/api/v1/notes').set(auth(x)).expect(200)).body as Strip;
  /** Põe todas as mensagens da conversa entre os dois há `minutes` minutos (para controlar a ordem). */
  const age = (a: U, b: U, minutes: number) =>
    pool.query(
      `UPDATE social.messages SET created_at = now() - make_interval(mins => $3)
        WHERE conversation_id = (SELECT id FROM social.conversations WHERE user_a = LEAST($1::uuid, $2::uuid) AND user_b = GREATEST($1::uuid, $2::uuid))`,
      [a.id, b.id, minutes],
    );

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'e'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('entram só as conversas a dois sentidos, sem bloqueio, sem escondidas, sem quem já tem nota; da mais antiga para a mais recente', async () => {
    const me = await signup('npme');
    const old = await signup('npold'); // conversámos há mais tempo
    const recent = await signup('nprec'); // conversámos há pouco
    const silent = await signup('npsil'); // só eu escrevi
    const asker = await signup('npask'); // pedido de mensagem a que não respondi
    const blocked = await signup('npblk');
    const hidden = await signup('nphid');
    const noted = await signup('npnot'); // tem nota que eu vejo
    const gone = await signup('npgon'); // conta suspensa

    for (const o of [old, recent, blocked, hidden, noted, gone]) {
      await send(me, o, 'olá');
      await send(o, me, 'olá de volta');
    }
    await send(me, silent, 'estás aí?');
    await send(asker, me, 'posso falar contigo?');

    await age(me, old, 120);
    await age(me, recent, 10);
    await age(me, blocked, 60);
    await age(me, hidden, 60);
    await age(me, noted, 60);
    await age(me, gone, 60);

    await pool.query('INSERT INTO social.blocks (blocker_id, blocked_id) VALUES ($1, $2)', [blocked.id, me.id]); // bloqueado por ele: conta na mesma
    await api().post(`/api/v1/chat/with/${hidden.username}/decline`).set(auth(me)).expect(204); // escondida por mim
    await pool.query("UPDATE identity.users SET status = 'suspended' WHERE id = $1", [gone.id]);
    await pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2)', [me.id, noted.id]);
    await api().put('/api/v1/notes/me').set(auth(noted)).send({ body: 'Já tenho nota' }).expect(204);

    const s = await strip(me);
    // Quem tem nota visível vai nas notas e não se repete nas pessoas.
    expect(s.items.map((n) => n.username)).toContain(noted.username);
    expect(s.people.map((p) => p.username)).toEqual([old.username, recent.username]);
    expect(s.people[0]).toMatchObject({ displayName: 'npold Teste', hasAvatar: false });
    expect(new Date(s.people[0].lastAt).getTime()).toBeLessThan(new Date(s.people[1].lastAt).getTime());

    // Do outro lado: quem só recebeu (sem responder) também não me vê, e o pedido não respondido também não.
    expect((await strip(silent)).people).toEqual([]);
    expect((await strip(asker)).people).toEqual([]);
    // O bloqueio vale nos dois sentidos.
    expect((await strip(blocked)).people).toEqual([]);

    // Se eu apagar a conversa do meu lado, a pessoa sai até voltar a haver mensagens.
    await api().delete(`/api/v1/chat/with/${old.username}`).set(auth(me)).expect(200);
    expect((await strip(me)).people.map((p) => p.username)).toEqual([recent.username]);
    await send(old, me, 'voltei');
    expect((await strip(me)).people.map((p) => p.username)).toEqual([recent.username, old.username]);
  });
});
