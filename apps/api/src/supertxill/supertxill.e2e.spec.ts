import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { MSG, SUPERTXILL_ID, SUPERTXILL_USERNAME } from './constants';
import { SuperTxillService } from './supertxill.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';

interface U { token: string; id: string; username: string }

describe('SuperTxill: a IA do chat, em segundo plano, com limites (integração, IA simulada)', () => {
  let app: INestApplication;
  let pool: Pool;
  let bot: SuperTxillService;
  const run = Date.now().toString(36);
  let n = 0;
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}${n++}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').set('X-Forwarded-For', `10.9.0.${(n % 250) + 1}`).send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: 'password-bem-longa-1', birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  const thread = async (x: U) =>
    (await pool.query(
      `SELECT m.body, (m.sender_id = $1) AS "fromMe" FROM social.messages m JOIN social.conversations c ON c.id = m.conversation_id
        WHERE c.user_a = LEAST($1::uuid, $2::uuid) AND c.user_b = GREATEST($1::uuid, $2::uuid) AND m.deleted_at IS NULL ORDER BY m.id`,
      [x.id, SUPERTXILL_ID],
    )).rows as { body: string; fromMe: boolean }[];
  const waitFor = async (x: U, count: number) => {
    for (let i = 0; i < 40; i++) {
      const t = await thread(x);
      if (t.length >= count) return t;
      await new Promise((r) => setTimeout(r, 150));
    }
    return thread(x);
  };

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'e'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test', ANTHROPIC_API_KEY: 'x'.repeat(30), SUPERTXILL_DAILY_LIMIT: '3' }));
    await app.init();
    bot = app.get(SuperTxillService);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('todas as pessoas têm o SuperTxill na lista, com boas-vindas (não como pedido); responde em segundo plano só com a conversa da pessoa', async () => {
    const a = await signup('sta');
    const list = (await api().get('/api/v1/chat/conversations').set(auth(a)).expect(200)).body as { username: string; unread: number; request: boolean; lastMessage: { fromMe: boolean } }[];
    const b = list.find((c) => c.username === SUPERTXILL_USERNAME);
    expect(b).toMatchObject({ unread: 1, request: false });
    expect(b?.lastMessage.fromMe).toBe(false);

    const seen: { role: string; content: string }[][] = [];
    bot.llm = async (h) => { seen.push(h); return 'Fixe! Experimenta uma nota curta.'; };
    const sent = await api().post(`/api/v1/chat/with/${SUPERTXILL_USERNAME}`).set(auth(a)).send({ kind: 'text', body: 'Dá-me uma ideia para uma nota' }).expect(201);
    expect(sent.body.id).toBeTruthy();
    const t = await waitFor(a, 3); // boas-vindas + pergunta + resposta
    expect(t.map((m) => m.body)).toContain('Fixe! Experimenta uma nota curta.');
    // A IA só recebeu a conversa desta pessoa, a começar por uma mensagem dela.
    expect(seen[0][0].role).toBe('user');
    expect(JSON.stringify(seen)).not.toContain('Boas');
  });

  it('só texto; o limite diário trava (resposta simpática, sem chamar a IA); outra pessoa não é afetada', async () => {
    const a = await signup('stb');
    const b = await signup('stc');
    let calls = 0;
    bot.llm = async () => { calls++; return 'ok'; };
    // Foto, voz e afins não vão para a IA.
    await api().post(`/api/v1/chat/with/${SUPERTXILL_USERNAME}`).set(auth(a)).send({ kind: 'sticker', body: 'rir' }).expect(400);
    for (let i = 0; i < 3; i++) {
      await api().post(`/api/v1/chat/with/${SUPERTXILL_USERNAME}`).set(auth(a)).send({ kind: 'text', body: `pergunta ${i}` }).expect(201);
      await waitFor(a, (i + 1) * 2);
    }
    expect(calls).toBe(3);
    await api().post(`/api/v1/chat/with/${SUPERTXILL_USERNAME}`).set(auth(a)).send({ kind: 'text', body: 'mais uma' }).expect(201);
    const t = await waitFor(a, 8);
    expect(t.map((m) => m.body)).toContain(MSG.daily);
    expect(calls).toBe(3);
    await api().post(`/api/v1/chat/with/${SUPERTXILL_USERNAME}`).set(auth(b)).send({ kind: 'text', body: 'olá' }).expect(201);
    await waitFor(b, 2);
    expect(calls).toBe(4);
  });

  it('se a IA falhar ou devolver algo que as regras da app não deixam, a pessoa recebe uma mensagem segura; o SuperTxill não se denuncia nem se bloqueia por engano; ninguém lhe responde por outros', async () => {
    const a = await signup('std');
    bot.llm = async () => { throw new Error('rede em baixo'); };
    await api().post(`/api/v1/chat/with/${SUPERTXILL_USERNAME}`).set(auth(a)).send({ kind: 'text', body: 'olá' }).expect(201);
    expect((await waitFor(a, 2)).map((m) => m.body)).toContain(MSG.error);
    // A resposta da IA passa pelas mesmas regras de texto da app.
    const x = await signup('ste');
    bot.llm = async () => 'vou matar-te seu filho da puta';
    await api().post(`/api/v1/chat/with/${SUPERTXILL_USERNAME}`).set(auth(x)).send({ kind: 'text', body: 'diz algo' }).expect(201);
    const t = await waitFor(x, 2);
    expect(t.map((m) => m.body)).not.toContain('vou matar-te seu filho da puta');
    // Ninguém pode entrar na conta do SuperTxill: não tem senha.
    const cred = await pool.query("SELECT 1 FROM identity.credentials c JOIN identity.users u ON u.id = c.user_id WHERE u.username = 'supertxill'");
    expect(cred.rowCount).toBe(0);
  });
});
