import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { getStorageToken } from '@nestjs/throttler';
import { readFileSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { uuidv7 } from '../common/uuid7';
import { REPOST_BLOCKED, REPOST_BLOCKED_CODE } from './posts.service';

/**
 * «Deixar repostar as minhas publicações» (0156): a definição (GET/PUT /posts/me/repost-settings), o 403 de
 * `POST /posts/:id/repost` (simples e com comentário) quando quem publicou não deixa, o próprio autor que reposta sempre as
 * suas, as contas privadas (quem as segue reposta; o repost só o vê quem vê o original), as citações (conta também o autor
 * do original citado), os posts de um sítio, o `canRepost` em todas as listas, a migração e a exportação.
 */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';

interface U { token: string; id: string; username: string }
interface P { id: string; code: string; kind: string; body: string; canRepost: boolean; repostOf?: P | null }

describe('repostar: «Deixar repostar as minhas publicações»', () => {
  let app: INestApplication;
  let pool: Pool;
  let ana: U, beto: U, carla: U, xico: U, priv: U, gestor: U;
  const run = Date.now().toString(36);
  const word = `drp${run}`;
  const api = () => request(app.getHttpServer());
  const as = (u: U) => ({ Authorization: `Bearer ${u.token}` });
  const getPost = async (u: U, id: string) => (await api().get(`/api/v1/posts/${id}`).set(as(u)).expect(200)).body as P;
  const settings = async (u: U) => (await api().get('/api/v1/posts/me/repost-settings').set(as(u)).expect(200)).body;
  const setAllow = async (u: U, allow: boolean) => (await api().put('/api/v1/posts/me/repost-settings').set(as(u)).send({ allow }).expect(200)).body;
  const rp = (u: U, id: string, body?: string) => api().post(`/api/v1/posts/${id}/repost`).set(as(u)).send(body ? { body } : {});
  const follow = (a: U, b: U) => pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [a.id, b.id]);
  const resetThrottle = () => {
    const s = app.get(getStorageToken()) as { storage: Map<string, unknown>; hitExpirations?: Map<string, unknown> };
    s.storage.clear();
    s.hitExpirations?.clear();
  };
  /** O 403 com a mensagem clara. */
  const blocked = async (u: U, id: string, body?: string) => {
    const r = await rp(u, id, body).expect(403);
    expect(r.body.message).toBe(REPOST_BLOCKED);
    expect(r.body.code).toBe(REPOST_BLOCKED_CODE);
  };

  async function register(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  const post = async (u: U, body: string) => {
    resetThrottle();
    return (await api().post('/api/v1/posts').set(as(u)).send({ body }).expect(201)).body as P;
  };

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'r'.repeat(40), NODE_ENV: 'test', IMAGE_MODERATION: 'off' }));
    await app.init();
    ana = await register('drana');
    beto = await register('drbeto');
    carla = await register('drcarla');
    xico = await register('drxico');
    priv = await register('drpriv');
    gestor = await register('drgest');
    await follow(beto, ana);
    await follow(beto, carla);
    await follow(xico, beto);
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  beforeEach(() => resetThrottle());

  it('a definição: ligada por omissão; desligar e voltar a ligar; 400 e 401', async () => {
    expect(await settings(ana)).toEqual({ allow: true, private: false });
    expect(await setAllow(ana, false)).toEqual({ allow: false, private: false });
    expect(await settings(ana)).toEqual({ allow: false, private: false });
    expect(await setAllow(ana, true)).toEqual({ allow: true, private: false });
    await api().put('/api/v1/posts/me/repost-settings').set(as(ana)).send({ allow: 'sim' }).expect(400);
    await api().put('/api/v1/posts/me/repost-settings').set(as(ana)).send({}).expect(400);
    await api().get('/api/v1/posts/me/repost-settings').expect(401);
    await api().put('/api/v1/posts/me/repost-settings').send({ allow: false }).expect(401);
    // Uma conta privada criada depois da migração começa ligada (a migração só desligou as que já eram privadas).
    await api().patch('/api/v1/users/me').set(as(priv)).send({ isPrivate: true }).expect(200);
    expect(await settings(priv)).toEqual({ allow: true, private: true });
  });

  let anaPost: P;

  it('ligada: os outros repostam (simples e com comentário); desligada: 403 com a mensagem e canRepost falso; o dono sempre', async () => {
    anaPost = await post(ana, `para repostar ${word} #${word}`);
    expect((await getPost(beto, anaPost.id)).canRepost).toBe(true);
    const simple = (await rp(beto, anaPost.id).expect(201)).body as P;
    expect(simple).toMatchObject({ kind: 'repost', body: '', canRepost: true, repostOf: { id: anaPost.id, canRepost: true } });
    const quote = (await rp(beto, anaPost.id, 'boa!').expect(201)).body as P;
    expect(quote).toMatchObject({ body: 'boa!', repostOf: { id: anaPost.id } });

    await setAllow(ana, false);
    try {
      expect((await getPost(beto, anaPost.id)).canRepost).toBe(false);
      await blocked(xico, anaPost.id);
      await blocked(xico, anaPost.id, 'com comentário');
      await blocked(beto, anaPost.id, 'outra vez');
      // Os reposts que já existem ficam (e continuam a ver-se), mas o original já não se reposta por eles.
      const seen = await getPost(xico, simple.id);
      expect(seen).toMatchObject({ canRepost: false, repostOf: { id: anaPost.id, canRepost: false } });
      expect((await getPost(xico, quote.id)).canRepost).toBe(false);
      // A própria Ana: canRepost e reposta (e cita) as suas.
      expect((await getPost(ana, anaPost.id)).canRepost).toBe(true);
      const own = (await rp(ana, anaPost.id).expect(201)).body as P;
      expect(own.repostOf?.id).toBe(anaPost.id);
      await rp(ana, anaPost.id, 'a minha').expect(201);
      await api().delete(`/api/v1/posts/${anaPost.id}/repost`).set(as(ana)).expect(200);
      // Desfazer o repost simples continua a dar.
      expect((await api().delete(`/api/v1/posts/${anaPost.id}/repost`).set(as(beto)).expect(200)).body.reposted).toBe(false);
    } finally {
      await setAllow(ana, true);
    }
    await rp(xico, anaPost.id).expect(201);
    await rp(beto, '00000000-0000-7000-8000-00000000dead').expect(404);
  });

  it('conta privada: quem a segue reposta (se ela deixar); o repost só o vê quem pode ver o original', async () => {
    await pool.query('UPDATE identity.users SET is_private = false WHERE id = $1', [priv.id]);
    const p = await post(priv, `só para os meus ${word}privado`);
    await pool.query('UPDATE identity.users SET is_private = true WHERE id = $1', [priv.id]);
    await rp(beto, p.id).expect(404); // sem seguir nem se vê
    await follow(beto, priv);
    expect((await getPost(beto, p.id)).canRepost).toBe(true);
    const simple = (await rp(beto, p.id).expect(201)).body as P;
    expect(simple.repostOf?.id).toBe(p.id);
    const quote = (await rp(beto, p.id, `olhem isto ${word}privado`).expect(201)).body as P;
    expect(quote.repostOf?.id).toBe(p.id);

    // O Xico segue o Beto mas não a conta privada: não vê nenhum dos dois reposts (nem no feed, nem no perfil, nem na pesquisa).
    await api().get(`/api/v1/posts/${simple.id}`).set(as(xico)).expect(404);
    await api().get(`/api/v1/posts/${quote.id}`).set(as(xico)).expect(404);
    const feed = (await api().get('/api/v1/feed?limit=50').set(as(xico)).expect(200)).body.items as P[];
    expect(feed.some((x) => x.id === simple.id || x.id === quote.id || x.repostOf?.id === p.id)).toBe(false);
    const tab = (await api().get(`/api/v1/users/${beto.username}/posts?tab=reposts`).set(as(xico)).expect(200)).body.items as P[];
    expect(tab.some((x) => x.id === simple.id || x.id === quote.id)).toBe(false);
    const found = (await api().get(`/api/v1/search?q=${word}privado`).set(as(xico)).expect(200)).body.posts as P[];
    expect(found).toEqual([]);
    // Quem segue os dois vê-os.
    const betoTab = (await api().get(`/api/v1/users/${beto.username}/posts?tab=reposts`).set(as(beto)).expect(200)).body.items as P[];
    expect(betoTab.map((x) => x.id)).toEqual(expect.arrayContaining([simple.id, quote.id]));
    // A pré-visualização pública (sem conta): o repost simples não se vê; a citação mostra só o texto de quem citou.
    await api().get(`/api/v1/public/posts/${simple.code}`).expect(404);
    const pub = (await api().get(`/api/v1/public/posts/${quote.code}`).expect(200)).body;
    expect(pub).toMatchObject({ body: `olhem isto ${word}privado`, repostedBy: null, author: { username: beto.username } });
    expect(JSON.stringify(pub)).not.toContain('só para os meus');

    // Desligada: nem quem a segue reposta.
    await setAllow(priv, false);
    expect((await getPost(beto, p.id)).canRepost).toBe(false);
    await blocked(beto, p.id);
    await blocked(beto, p.id, 'e agora?');
    // O próprio dono reposta e cita a sua publicação.
    expect((await getPost(priv, p.id)).canRepost).toBe(true);
    await rp(priv, p.id).expect(201);
    await rp(priv, p.id, 'hoje é aonde?').expect(201);
  });

  it('citação: conta também o autor do original citado (no canRepost e no 403); repost simples de uma citação', async () => {
    const quote = (await rp(carla, anaPost.id, `vejam ${word}`).expect(201)).body as P;
    const rep = (await rp(beto, quote.id).expect(201)).body as P;
    expect((await getPost(xico, quote.id)).canRepost).toBe(true);
    await setAllow(ana, false);
    try {
      const q = await getPost(xico, quote.id);
      expect(q).toMatchObject({ canRepost: false, repostOf: { id: anaPost.id, canRepost: false } });
      await blocked(xico, quote.id);
      await blocked(xico, quote.id, 'citar a citação');
      // A Carla não reposta a sua citação: levava outra vez a publicação da Ana, que não deixa.
      await blocked(carla, quote.id);
      // A Ana (a autora do original) pode, porque a Carla deixa.
      expect((await getPost(ana, quote.id)).canRepost).toBe(true);
      await rp(ana, quote.id).expect(201);
      // O repost simples da citação: o que se repostava é a citação, que já não se pode.
      const r = await getPost(xico, rep.id);
      expect(r).toMatchObject({ canRepost: false, repostOf: { id: quote.id, canRepost: false, repostOf: { id: anaPost.id, canRepost: false } } });
    } finally {
      await setAllow(ana, true);
    }
    // A Carla desliga: a citação dela não se reposta, o original da Ana sim.
    await setAllow(carla, false);
    try {
      expect((await getPost(xico, quote.id)).canRepost).toBe(false);
      expect((await getPost(xico, rep.id)).repostOf).toMatchObject({ canRepost: false, repostOf: { canRepost: true } });
      await blocked(xico, quote.id);
      expect((await getPost(xico, anaPost.id)).canRepost).toBe(true);
    } finally {
      await setAllow(carla, true);
    }
    await rp(xico, quote.id).expect(201);
  });

  it('num post de um sítio vale a conta de quem o publicou', async () => {
    const venueId = uuidv7();
    await pool.query(`INSERT INTO content.venues (id, slug, name, kind, owner_id, check_token) VALUES ($1, $2, 'Bar do Repost', 'bar', $3, 'tok')`, [venueId, `bar-dr-${run}`, gestor.id]);
    const p = await post(gestor, 'noite de marrabenta');
    await pool.query('UPDATE content.posts SET venue_id = $2 WHERE id = $1', [p.id, venueId]);
    expect((await getPost(beto, p.id)).canRepost).toBe(true);
    await setAllow(gestor, false);
    expect((await getPost(beto, p.id)).canRepost).toBe(false);
    await blocked(beto, p.id);
    expect((await getPost(gestor, p.id)).canRepost).toBe(true);
    await rp(gestor, p.id).expect(201);
  });

  it('canRepost é o mesmo em todas as listas e bate com o repost (ligada: 201; desligada: 403)', async () => {
    const yes = await post(ana, `deixa ${word}lista #${word}lista`);
    const no = await post(carla, `não deixa ${word}lista #${word}lista`);
    await setAllow(carla, false);
    try {
      await api().put(`/api/v1/posts/${yes.id}/save`).set(as(beto)).expect(200);
      await api().put(`/api/v1/posts/${no.id}/save`).set(as(beto)).expect(200);
      const lists: Record<string, P[]> = {
        feed: (await api().get('/api/v1/feed?limit=40').set(as(beto)).expect(200)).body.items,
        cronologico: (await api().get('/api/v1/posts?limit=50').set(as(beto)).expect(200)).body.items,
        perfilAna: (await api().get(`/api/v1/users/${ana.username}/posts`).set(as(beto)).expect(200)).body.items,
        perfilCarla: (await api().get(`/api/v1/users/${carla.username}/posts`).set(as(beto)).expect(200)).body.items,
        pesquisa: (await api().get(`/api/v1/search?q=${word}lista`).set(as(beto)).expect(200)).body.posts,
        hashtag: (await api().get(`/api/v1/tags/${word}lista`).set(as(beto)).expect(200)).body.items,
        guardadas: (await api().get('/api/v1/feed/saved').set(as(beto)).expect(200)).body.items,
        codigo: [
          (await api().get(`/api/v1/posts/code/${yes.code}`).set(as(beto)).expect(200)).body,
          (await api().get(`/api/v1/posts/code/${no.code}`).set(as(beto)).expect(200)).body,
        ],
      };
      const expected = new Map([[yes.id, true], [no.id, false]]);
      for (const [name, items] of Object.entries(lists)) {
        for (const [id, can] of expected) {
          if (name === 'perfilAna' && id === no.id) continue;
          if (name === 'perfilCarla' && id === yes.id) continue;
          const p = items.find((x) => x.id === id);
          expect({ list: name, id, present: !!p }).toEqual({ list: name, id, present: true });
          expect({ list: name, id, canRepost: p!.canRepost }).toEqual({ list: name, id, canRepost: can });
        }
      }
      await rp(beto, yes.id).expect(201);
      await blocked(beto, no.id);
    } finally {
      await setAllow(carla, true);
    }
  });

  it('a migração: as contas que já eram privadas ficam desligadas, as públicas ligadas', async () => {
    const sql = readFileSync(join(__dirname, '../../migrations/0156_deixar_repostar.sql'), 'utf8');
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('UPDATE identity.users SET is_private = true WHERE id = $1', [priv.id]);
      await c.query('ALTER TABLE identity.users DROP COLUMN allow_reposts');
      await c.query(sql);
      const rows = (await c.query('SELECT id, allow_reposts FROM identity.users WHERE id = ANY($1)', [[priv.id, ana.id]])).rows;
      const of = new Map(rows.map((r) => [r.id as string, r.allow_reposts as boolean]));
      expect(of.get(priv.id)).toBe(false);
      expect(of.get(ana.id)).toBe(true);
      // Voltar a correr não mexe nas escolhas (a coluna já existe).
      await c.query('UPDATE identity.users SET allow_reposts = true WHERE id = $1', [priv.id]);
      await c.query(sql);
      expect((await c.query('SELECT allow_reposts FROM identity.users WHERE id = $1', [priv.id])).rows[0].allow_reposts).toBe(true);
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });

  it('a exportação leva a definição', async () => {
    await setAllow(gestor, false);
    expect((await api().get('/api/v1/me/export').set(as(gestor)).expect(200)).body.allowReposts).toBe(false);
    expect((await api().get('/api/v1/me/export').set(as(beto)).expect(200)).body.allowReposts).toBe(true);
  });
});
