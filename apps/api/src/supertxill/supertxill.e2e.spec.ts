import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { MSG } from './constants';
import { SuperTxillService } from './supertxill.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';

interface U { token: string; id: string; username: string }

describe('SuperTxill: a IA na barra de pesquisa, em segundo plano, com limites (integração, IA simulada)', () => {
  let app: INestApplication;
  let pool: Pool;
  let bot: SuperTxillService;
  const run = Date.now().toString(36);
  let n = 0;
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  const thread = async (x: U) => (await pool.query('SELECT role, body FROM social.ai_messages WHERE user_id = $1 ORDER BY id', [x.id])).rows as { role: string; body: string }[];
  const waitFor = async (x: U, count: number) => {
    for (let i = 0; i < 40; i++) {
      const t = await thread(x);
      if (t.length >= count) return t;
      await new Promise((r) => setTimeout(r, 150));
    }
    return thread(x);
  };

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}${n++}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').set('X-Forwarded-For', `10.9.0.${(n % 250) + 1}`).send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: 'password-bem-longa-1', birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }

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

  it('o SuperTxill não é uma conta (nem aparece nas conversas); pergunta, resposta em segundo plano, só com o que a pessoa lhe perguntou; histórico e apagar', async () => {
    const a = await signup('sta');
    expect((await pool.query("SELECT 1 FROM identity.users WHERE username = 'supertxill'")).rowCount).toBe(0);
    await api().post('/api/v1/chat/with/supertxill').set(auth(a)).send({ kind: 'text', body: 'olá' }).expect(404);
    expect((await api().get('/api/v1/chat/conversations').set(auth(a)).expect(200)).body).toEqual([]);

    const seen: { role: string; content: string }[][] = [];
    bot.llm = async (h) => { seen.push(h); return 'Fixe! Experimenta uma nota curta.'; };
    const r = await api().post('/api/v1/supertxill/ask').set(auth(a)).send({ text: 'Dá-me uma ideia para uma nota' }).expect(201);
    expect(r.body.id).toBeTruthy();
    // Logo a seguir: pergunta guardada e a resposta a caminho.
    const first = (await api().get('/api/v1/supertxill').set(auth(a)).expect(200)).body;
    expect(first.messages[0]).toMatchObject({ role: 'user', body: 'Dá-me uma ideia para uma nota' });
    expect(first.enabled).toBe(true);
    const t = await waitFor(a, 2);
    expect(t.map((m) => m.body)).toContain('Fixe! Experimenta uma nota curta.');
    expect(seen[0]).toEqual([{ role: 'user', content: 'Dá-me uma ideia para uma nota' }]);
    const done = (await api().get('/api/v1/supertxill').set(auth(a)).expect(200)).body;
    expect(done.pending).toBe(false);
    // Cada pessoa só vê o seu histórico.
    const b = await signup('stb');
    expect((await api().get('/api/v1/supertxill').set(auth(b)).expect(200)).body.messages).toEqual([]);
    // Apagar.
    await api().post('/api/v1/supertxill/clear').set(auth(a)).expect(204);
    expect((await thread(a)).length).toBe(0);
  });

  it('limite diário (resposta simpática, sem chamar a IA); o texto ofensivo não entra; o resultado da IA passa pelo filtro; se falhar, mensagem segura', async () => {
    const a = await signup('stc');
    let calls = 0;
    bot.llm = async () => { calls++; return 'ok'; };
    for (let i = 0; i < 3; i++) {
      await api().post('/api/v1/supertxill/ask').set(auth(a)).send({ text: `pergunta ${i}` }).expect(201);
      await waitFor(a, (i + 1) * 2);
    }
    expect(calls).toBe(3);
    await api().post('/api/v1/supertxill/ask').set(auth(a)).send({ text: 'mais uma' }).expect(201);
    expect((await waitFor(a, 8)).map((m) => m.body)).toContain(MSG.daily);
    expect(calls).toBe(3);
    // Pergunta ofensiva: nem chega a ser guardada.
    const x = await signup('std');
    await api().post('/api/v1/supertxill/ask').set(auth(x)).send({ text: "vou matar-te seu filho da puta" }).expect(422);
    // Resposta ofensiva da IA: substituída.
    bot.llm = async () => 'vou matar-te seu filho da puta';
    await api().post('/api/v1/supertxill/ask').set(auth(x)).send({ text: 'diz algo' }).expect(201);
    expect((await waitFor(x, 2)).map((m) => m.body)).toEqual(['diz algo', MSG.refused]);
    // A IA falha.
    const y = await signup('ste');
    bot.llm = async () => { throw new Error('rede em baixo'); };
    await api().post('/api/v1/supertxill/ask').set(auth(y)).send({ text: 'olá' }).expect(201);
    expect((await waitFor(y, 2)).map((m) => m.body)).toContain(MSG.error);
    // Sem sessão não entra.
    await api().get('/api/v1/supertxill').expect(401);
    await api().post('/api/v1/supertxill/ask').send({ text: 'x' }).expect(401);
  });
});
