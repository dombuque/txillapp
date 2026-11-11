import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import webpush from 'web-push';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { PushService, type PushPayload } from '../push/push.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';

interface U { token: string; id: string; username: string }
interface Item { id: string; kind: string; read: boolean; data: Record<string, unknown>; actor: { username: string }; cheer?: { count: number; actors: { username: string; displayName: string }[] } }

describe('"A malta brindou-te": avisos de brindes agrupados e push com travão (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  const u: Record<string, U> = {};
  const keys = webpush.generateVAPIDKeys();
  // O push é simulado: guarda o que seria enviado.
  const sent: { userId: string; p: PushPayload }[] = [];

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  const newPost = async (x: U, body = 'Bora txilar') => (await api().post('/api/v1/posts').set(auth(x)).send({ body }).expect(201)).body.id as string;
  const cheerPost = (x: U, postId: string) => api().post(`/api/v1/posts/${postId}/cheers`).set(auth(x)).expect(200);
  const cheerComment = (x: U, commentId: string) => api().post(`/api/v1/comments/${commentId}/cheers`).set(auth(x)).expect(200);
  const list = async (x: U) => (await api().get('/api/v1/notifications').set(auth(x)).expect(200)).body.items as Item[];
  const cheersOf = async (x: U, targetId: string) => (await list(x)).filter((n) => n.kind === 'cheer' && n.data.targetId === targetId);
  const pushesTo = (x: U) => sent.filter((s) => s.userId === x.id && s.p.tag?.startsWith('cheer:'));
  /** O push sai em segundo plano: espera até não haver novidades. */
  const settle = async () => {
    let before = -1;
    while (before !== sent.length) {
      before = sent.length;
      await new Promise((r) => setTimeout(r, 250));
    }
  };

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(
      loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'b'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test', VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey }),
    );
    await app.init();
    jest.spyOn(app.get(PushService), 'send').mockImplementation(async (userId: string, p: PushPayload) => {
      sent.push({ userId, p });
    });
    for (const n of ['bra', 'brb', 'brc', 'brd', 'bre', 'brf', 'brg']) u[n] = await signup(n);
  }, 60_000);

  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
    await pool.end();
  });

  it('brindar avisa; vários brindes juntam-se numa linha que sobe ao topo com o último a brindar e a contagem', async () => {
    const { bra, brb, brc, brd, bre } = u;
    const post = await newPost(bra);
    await cheerPost(brb, post);
    let rows = await cheersOf(bra, post);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ read: false, actor: { username: brb.username }, data: { target: 'post', targetId: post, postId: post }, cheer: { count: 1, actors: [{ username: brb.username }] } });
    expect((await api().get('/api/v1/notifications/unread-count').set(auth(bra)).expect(200)).body.count).toBe(1);

    // Outra coisa acontece entretanto; os brindes seguintes sobem a linha ao topo outra vez.
    await api().post(`/api/v1/users/${bra.username}/follow`).set(auth(brd)).expect(200);
    await api().post('/api/v1/notifications/read').set(auth(bra)).expect(204);
    await cheerPost(brc, post);
    await cheerPost(brd, post);
    await cheerPost(bre, post);
    const all = await list(bra);
    rows = all.filter((n) => n.kind === 'cheer' && n.data.targetId === post);
    expect(rows).toHaveLength(1);
    expect(all[0].id).toBe(rows[0].id); // no topo
    expect(rows[0]).toMatchObject({ read: false, actor: { username: bre.username }, cheer: { count: 4 } });
    expect(rows[0].cheer!.actors.map((a) => a.username)).toEqual([bre.username, brd.username]);

    // Tirar o brinde não apaga o aviso, mas já não conta; voltar a pôr não avisa outra vez (nem sobe a linha).
    await cheerPost(bre, post); // tira
    rows = await cheersOf(bra, post);
    expect(rows).toHaveLength(1);
    expect(rows[0].cheer).toMatchObject({ count: 3, actors: [{ username: brd.username }, { username: brc.username }] });
    await api().post('/api/v1/notifications/read').set(auth(bra)).expect(204);
    await cheerPost(bre, post); // põe outra vez
    rows = await cheersOf(bra, post);
    expect(rows[0]).toMatchObject({ read: true, cheer: { count: 4 } });

    // Passadas 24 h, um brinde novo abre outra linha (e a antiga fica).
    await pool.query(`UPDATE social.notifications SET data = jsonb_set(data, '{since}', to_jsonb(now() - interval '25 hours')) WHERE id = $1`, [rows[0].id]);
    await pool.query(`UPDATE social.cheer_notices SET created_at = now() - interval '25 hours' WHERE target_id = $1`, [post]);
    await cheerPost(u.brf, post);
    rows = await cheersOf(bra, post);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ actor: { username: u.brf.username }, cheer: { count: 1 } });
    expect(rows[1].cheer!.count).toBe(4);
  });

  it('não há aviso ao brindar o que é meu', async () => {
    const { brb } = u;
    const post = await newPost(brb);
    await cheerPost(brb, post);
    const c = (await api().post(`/api/v1/posts/${post}/comments`).set(auth(brb)).send({ body: 'o meu comentário' }).expect(201)).body.id as string;
    await cheerComment(brb, c);
    await settle();
    expect((await list(brb)).filter((n) => n.kind === 'cheer')).toHaveLength(0);
    expect(pushesTo(brb)).toHaveLength(0);
  });

  it('o bloqueio impede o aviso, e esconde o que já lá estava', async () => {
    const { brc, brd, bre } = u;
    const post = await newPost(brc);
    // Bloqueado não brinda (nem vê a publicação) e não há aviso.
    await api().put(`/api/v1/blocks/${brd.username}`).set(auth(brc)).expect(200);
    await api().post(`/api/v1/posts/${post}/cheers`).set(auth(brd)).expect(404);
    expect(await cheersOf(brc, post)).toHaveLength(0);
    await api().delete(`/api/v1/blocks/${brd.username}`).set(auth(brc)).expect(200);

    // Comentário de alguém que bloqueou quem brinda (a publicação é de outra pessoa): brinda, mas o autor não é avisado.
    const c = (await api().post(`/api/v1/posts/${post}/comments`).set(auth(bre)).send({ body: 'comentário' }).expect(201)).body.id as string;
    await api().put(`/api/v1/blocks/${brd.username}`).set(auth(bre)).expect(200);
    await cheerComment(brd, c);
    expect((await list(bre)).filter((n) => n.kind === 'cheer')).toHaveLength(0);
    await api().delete(`/api/v1/blocks/${brd.username}`).set(auth(bre)).expect(200);

    // Já avisado e depois bloqueado: o aviso some da lista; quem foi bloqueado deixa de contar nos agrupados.
    await cheerPost(brd, post);
    await cheerPost(bre, post);
    expect((await cheersOf(brc, post))[0].cheer!.count).toBe(2);
    await api().put(`/api/v1/blocks/${bre.username}`).set(auth(brc)).expect(200);
    expect(await cheersOf(brc, post)).toHaveLength(0); // o último a brindar está bloqueado
    await api().delete(`/api/v1/blocks/${bre.username}`).set(auth(brc)).expect(200);
    await api().put(`/api/v1/blocks/${brd.username}`).set(auth(brc)).expect(200);
    const rows = await cheersOf(brc, post);
    expect(rows[0].cheer).toMatchObject({ count: 1, actors: [{ username: bre.username }] });
    await api().delete(`/api/v1/blocks/${brd.username}`).set(auth(brc)).expect(200);
  });

  it('com a categoria "Reações" desligada não há aviso (nem push)', async () => {
    const { brd, bre } = u;
    await api().put('/api/v1/notifications/settings').set(auth(brd)).send({ off: ['reactions'] }).expect(204);
    const post = await newPost(brd);
    await cheerPost(bre, post);
    await settle();
    expect(await cheersOf(brd, post)).toHaveLength(0);
    expect(pushesTo(brd)).toHaveLength(0);
    await api().put('/api/v1/notifications/settings').set(auth(brd)).send({ off: [] }).expect(204);
  });

  it('brindar um comentário: "brindou o teu comentário", abre o comentário', async () => {
    const { bra, brb, brc } = u;
    const post = await newPost(bra);
    const c = (await api().post(`/api/v1/posts/${post}/comments`).set(auth(brb)).send({ body: 'que noite!' }).expect(201)).body.id as string;
    await cheerComment(brc, c);
    await cheerComment(bra, c); // o dono da publicação também brinda o comentário de outro
    await settle();
    const rows = await cheersOf(brb, c);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ data: { target: 'comment', targetId: c, postId: post, commentId: c }, actor: { username: bra.username }, cheer: { count: 2 } });
    // O dono da publicação não recebe aviso pelo brinde ao comentário.
    expect(await cheersOf(bra, c)).toHaveLength(0);
    const p = pushesTo(brb);
    expect(p).toHaveLength(1);
    expect(p[0].p).toMatchObject({ title: 'brc Teste', body: 'brindou o teu comentário', url: `/p/${post}?comments=1&c=${c}`, tag: `cheer:${c}`, category: 'reactions' });
    expect(JSON.stringify(p[0].p)).not.toContain('que noite');
  });

  it('push com travão: o primeiro avisa, depois 1 a cada 30 min com a contagem, e no máximo 6 por dia', async () => {
    const { brf, bra, brb, brc, brd, bre, brg } = u;
    const post = await newPost(brf, 'texto secreto da publicação');
    await cheerPost(bra, post);
    await settle();
    expect(pushesTo(brf)).toHaveLength(1);
    expect(pushesTo(brf)[0].p).toMatchObject({ title: 'bra Teste', body: 'brindou a tua publicação', url: `/p/${post}`, tag: `cheer:${post}`, category: 'reactions' });

    // Dentro dos 30 min: mais brindes não geram push.
    await cheerPost(brb, post);
    await cheerPost(brc, post);
    await settle();
    expect(pushesTo(brf)).toHaveLength(1);

    // Passados 30 min, o próximo brinde avisa com a contagem do que entrou desde o último aviso (2 + este).
    // (O relógio anda para trás para todos: o último aviso e os brindes que já lá estavam.)
    await pool.query(`UPDATE social.cheer_pushes SET sent_at = sent_at - interval '31 minutes' WHERE user_id = $1`, [brf.id]);
    await pool.query(`UPDATE social.cheer_notices SET created_at = created_at - interval '31 minutes' WHERE target_id = $1`, [post]);
    await pool.query(`UPDATE social.notifications SET data = jsonb_set(data, '{since}', to_jsonb(now() - interval '40 minutes')) WHERE kind = 'cheer' AND data->>'targetId' = $1`, [post]);
    await cheerPost(brd, post);
    await settle();
    expect(pushesTo(brf)).toHaveLength(2);
    expect(pushesTo(brf)[1].p).toMatchObject({ title: 'A malta brindou-te', body: '+3 brindes na tua publicação', url: `/p/${post}` });
    for (const s of pushesTo(brf)) expect(JSON.stringify(s.p)).not.toContain('secreto');

    // No máximo 6 por dia, mesmo em publicações diferentes (cada primeiro brinde avisaria).
    for (let i = 0; i < 6; i++) {
      const p = await newPost(brf, `post ${i}`);
      await cheerPost(i % 2 ? bre : brg, p);
      await settle();
    }
    expect(pushesTo(brf)).toHaveLength(6);
    expect((await list(brf)).filter((n) => n.kind === 'cheer')).toHaveLength(7); // os avisos na lista continuam todos
  });
});
