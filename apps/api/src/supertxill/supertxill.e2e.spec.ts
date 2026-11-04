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

  it('"Para ti": recomenda quem malta parecida com a pessoa segue, sem expor nomes, e respeita não-sugerível e bloqueios', async () => {
    const me = await signup('ml0');
    const peer = await signup('ml1'); // segue o mesmo que eu
    const star = await signup('ml2'); // seguido pelo peer, ainda não por mim
    const hidden = await signup('ml3'); // seguido pelo peer mas não aceita ser sugerido
    const common = await signup('ml4'); // seguido por mim e pelo peer
    const follow = (a: U, b: U) => api().post(`/api/v1/users/${b.username}/follow`).set(auth(a)).expect((r) => { if (r.status >= 400) throw new Error(`follow ${r.status}`); });
    await follow(me, common);
    await follow(peer, common);
    await follow(peer, star);
    await follow(peer, hidden);
    await pool.query('UPDATE identity.users SET suggestable = false WHERE id = $1', [hidden.id]);
    const list = (await api().get('/api/v1/supertxill/for-you').set(auth(me)).expect(200)).body as { username: string; reason: string }[];
    const names = list.map((x) => x.username);
    expect(names).toContain(star.username);
    expect(names).not.toContain(hidden.username);
    expect(names).not.toContain(common.username);
    expect(names).not.toContain(me.username);
    expect(names.indexOf(star.username)).toBeLessThan(names.indexOf(peer.username) === -1 ? 999 : names.indexOf(peer.username) + 1);
    expect(list.find((x) => x.username === star.username)!.reason).not.toContain(peer.username);
    await api().put(`/api/v1/blocks/${star.username}`).set(auth(me)).expect((r) => { if (r.status >= 400) throw new Error(`block ${r.status}`); });
    const after = ((await api().get('/api/v1/supertxill/for-you').set(auth(me)).expect(200)).body as { username: string }[]).map((x) => x.username);
    expect(after).not.toContain(star.username);
    await api().get('/api/v1/supertxill/for-you').expect(401);
  });

  it('preferências de notificações: desligar uma categoria deixa de criar essas notificações; os pedidos de seguir ficam sempre', async () => {
    const a = await signup('nf0');
    const b = await signup('nf1');
    const c = await signup('nf2');
    const d = (await api().get('/api/v1/notifications/settings').set(auth(a)).expect(200)).body;
    expect(d.off).toEqual([]);
    expect(d.categories).toContain('comments');
    await api().put('/api/v1/notifications/settings').set(auth(a)).send({ off: ['follows', 'gifts'] }).expect(204);
    await api().put('/api/v1/notifications/settings').set(auth(a)).send({ off: ['coisa-inventada'] }).expect(400);
    await api().post(`/api/v1/users/${a.username}/follow`).set(auth(b)).expect((r) => { if (r.status >= 400) throw new Error(`follow ${r.status}`); });
    expect((await pool.query("SELECT 1 FROM social.notifications WHERE user_id = $1 AND kind = 'follow'", [a.id])).rowCount).toBe(0);
    await api().put('/api/v1/notifications/settings').set(auth(a)).send({ off: [] }).expect(204);
    await api().post(`/api/v1/users/${a.username}/follow`).set(auth(c)).expect((r) => { if (r.status >= 400) throw new Error(`follow ${r.status}`); });
    expect((await pool.query("SELECT 1 FROM social.notifications WHERE user_id = $1 AND kind = 'follow'", [a.id])).rowCount).toBe(1);
    await api().get('/api/v1/notifications/settings').expect(401);
  });

  it('editar publicação (só o autor, filtro, marcada como editada) e comentários desativados por publicação e por story', async () => {
    const a = await signup('ed0');
    const b = await signup('ed1');
    const post = (await api().post('/api/v1/posts').set(auth(a)).set('Idempotency-Key', `ed-${run}`).send({ body: 'olá #um' }).expect(201)).body;
    const e = (await api().patch(`/api/v1/posts/${post.id}`).set(auth(a)).send({ body: 'olá editado #dois' }).expect(200)).body;
    expect(e.body).toBe('olá editado #dois');
    expect(e.editedAt).toBeTruthy();
    expect((await pool.query('SELECT tag FROM content.post_tags WHERE post_id = $1', [post.id])).rows.map((r) => r.tag)).toEqual(['dois']);
    await api().patch(`/api/v1/posts/${post.id}`).set(auth(b)).send({ body: 'roubado' }).expect(404);
    await api().patch(`/api/v1/posts/${post.id}`).set(auth(a)).send({ body: 'vou matar-te seu filho da puta' }).expect(422);
    await api().patch(`/api/v1/posts/${post.id}`).set(auth(a)).send({ body: '  ' }).expect(400);
    // Comentários.
    await api().post(`/api/v1/posts/${post.id}/comments`).set(auth(b)).send({ body: 'fixe' }).expect(201);
    const off = (await api().patch(`/api/v1/posts/${post.id}`).set(auth(a)).send({ commentsOff: true }).expect(200)).body;
    expect(off.commentsOff).toBe(true);
    expect(off.canComment).toBe(false);
    await api().post(`/api/v1/posts/${post.id}/comments`).set(auth(b)).send({ body: 'outra' }).expect(403);
    await api().patch(`/api/v1/posts/${post.id}`).set(auth(a)).send({ commentsOff: false }).expect(200);
    await api().post(`/api/v1/posts/${post.id}/comments`).set(auth(b)).send({ body: 'agora sim' }).expect(201);
  });
});
