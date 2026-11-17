import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { PushService } from '../push/push.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';

interface U { token: string; id: string; username: string }
interface C { id: string; body: string; gif: Record<string, unknown> | null; gifHidden?: boolean }

const gif = (id: string, rating?: string) => ({ id, w: 200, h: 150, url: `https://media2.giphy.com/media/${id}/200w.gif`, ...(rating ? { rating } : {}) });
const giphy = (id: string, rating: string) => ({
  type: 'gif', id, title: `GIF ${id}`, rating,
  images: { fixed_width: { url: `https://media2.giphy.com/media/${id}/200w.gif`, width: '200', height: '150' } },
});

/**
 * Comentários com GIF: a classificação é a que o GIPHY dá (confirmada pelo id ao comentar; a da app não conta) e fica
 * guardada com o GIF; a menores e a quem não tem data de nascimento, um GIF acima de «g» (ou sem classificação) vem como
 * `gif: null` e `gifHidden: true` (a app mostra «GIF escondido»), nas listas, nas respostas e no comentário sozinho.
 */
describe('Comentários: GIF com a classificação do GIPHY e escondido a menores (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  let fetchSpy: jest.SpyInstance;
  let pushSpy: jest.SpyInstance;
  const run = Date.now().toString(36);
  let n = 0;
  const api = () => request(app.getHttpServer());
  const auth = (x: { token: string }) => ({ Authorization: `Bearer ${x.token}` });
  const ratings: Record<string, string> = {};
  const failing = new Set<string>();
  const byId: string[] = [];

  async function signup(name: string, birthDate: string | null = '1990-06-15'): Promise<U> {
    const username = `${name}${run}${n++}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').set('X-Forwarded-For', `10.9.7.${(n % 250) + 1}`)
      .send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: 'password-bem-longa-1', birthDate: birthDate ?? '1990-06-15', acceptTerms: true }).expect(201);
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
    if (birthDate === null) await pool.query('UPDATE identity.users SET birth_date = NULL WHERE id = $1', [r.body.user.id]);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  const comment = (x: U, post: string, b: Record<string, unknown>) => api().post(`/api/v1/posts/${post}/comments`).set(auth(x)).send(b);
  const list = async (x: U, post: string) => (await api().get(`/api/v1/posts/${post}/comments`).set(auth(x)).expect(200)).body.items as C[];
  const replies = async (x: U, id: string) => (await api().get(`/api/v1/comments/${id}/replies`).set(auth(x)).expect(200)).body.items as C[];
  const stored = async (id: string) => (await pool.query(`SELECT gif ->> 'rating' AS r FROM content.comments WHERE id = $1`, [id])).rows[0]?.r ?? null;

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'c'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test', GIPHY_API_KEY: 'chave-de-teste-789' }));
    await app.init();
    // O GIPHY é simulado: nada sai da máquina nos testes.
    const real = global.fetch;
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.hostname !== 'api.giphy.com') return real(input, init);
      const path = url.pathname.replace('/v1/gifs/', '');
      if (path === 'search' || path === 'trending') return new Response(JSON.stringify({ data: [], pagination: { total_count: 0, count: 0, offset: 0 } }), { status: 200 });
      byId.push(path);
      if (failing.has(path)) return new Response('erro', { status: 500 });
      if (!(path in ratings)) return new Response(JSON.stringify({ data: [], meta: { status: 404, msg: 'Not Found' } }), { status: 404 });
      return new Response(JSON.stringify({ data: giphy(path, ratings[path]), meta: { status: 200 } }), { status: 200 });
    });
    pushSpy = jest.spyOn(app.get(PushService), 'send').mockImplementation(async () => 0);
  }, 60_000);

  afterAll(async () => {
    fetchSpy.mockRestore();
    pushSpy.mockRestore();
    await app.close();
    await pool.end();
  });

  it('ao comentar, guarda a classificação do GIPHY (não a da app); um GIF que já não existe dá 400 e nada fica', async () => {
    const owner = await signup('cga');
    const a = await signup('cgb');
    const post = (await api().post('/api/v1/posts').set(auth(owner)).send({ body: 'post com GIFs' }).expect(201)).body.id as string;
    ratings[`CForte${run}`] = 'pg-13';
    const c = (await comment(a, post, { body: 'olha', gif: gif(`CForte${run}`, 'g') }).expect(201)).body as C;
    expect(await stored(c.id)).toBe('pg-13');
    expect(c.gif).toMatchObject({ id: `CForte${run}`, rating: 'pg-13' });
    expect(byId.filter((x) => x === `CForte${run}`)).toHaveLength(1);
    // Numa resposta, o mesmo id vem da cache.
    const r = (await comment(owner, post, { parentId: c.id, gif: gif(`CForte${run}`) }).expect(201)).body as C;
    expect(await stored(r.id)).toBe('pg-13');
    expect(byId.filter((x) => x === `CForte${run}`)).toHaveLength(1);

    const before = (await pool.query('SELECT count(*)::int AS n FROM content.comments WHERE post_id = $1', [post])).rows[0].n;
    expect(JSON.stringify((await comment(a, post, { body: 'x', gif: gif(`CNaoHa${run}`, 'g') }).expect(400)).body)).toContain('já não existe no GIPHY');
    expect((await pool.query('SELECT count(*)::int AS n FROM content.comments WHERE post_id = $1', [post])).rows[0].n).toBe(before);

    // GIPHY em baixo: um adulto fica com o GIF sem classificação.
    failing.add(`CFalha${run}`);
    const f = (await comment(a, post, { gif: gif(`CFalha${run}`, 'g') }).expect(201)).body as C;
    expect(await stored(f.id)).toBeNull();
  });

  it('a menores e a quem não tem data de nascimento, o GIF acima de «g» (ou sem classificação) vem escondido: lista, respostas e o comentário sozinho', async () => {
    const owner = await signup('cha');
    const adult = await signup('chx');
    const minor = await signup('chm', '2011-04-04');
    const noBirth = await signup('chn', null);
    const post = (await api().post('/api/v1/posts').set(auth(owner)).send({ body: 'post público' }).expect(201)).body.id as string;
    Object.assign(ratings, { [`CPg${run}`]: 'pg', [`CLeve${run}`]: 'g', [`CErre${run}`]: 'r' });
    const strong = (await comment(adult, post, { body: 'com texto', gif: gif(`CPg${run}`) }).expect(201)).body as C;
    const light = (await comment(adult, post, { gif: gif(`CLeve${run}`) }).expect(201)).body as C;
    const reply = (await comment(owner, post, { parentId: strong.id, gif: gif(`CErre${run}`) }).expect(201)).body as C;
    // Um comentário antigo, de antes da classificação: sem `rating` no GIF.
    const old = (await comment(adult, post, { body: 'antigo', gif: gif(`CLeve${run}`) }).expect(201)).body as C;
    await pool.query(`UPDATE content.comments SET gif = gif - 'rating' WHERE id = $1`, [old.id]);

    // O adulto vê tudo, com a classificação.
    const seen = await list(adult, post);
    expect(seen.find((c) => c.id === strong.id)).toMatchObject({ gif: expect.objectContaining({ rating: 'pg' }) });
    expect(seen.find((c) => c.id === strong.id)).not.toHaveProperty('gifHidden');
    expect(seen.find((c) => c.id === old.id)?.gif).toMatchObject({ id: `CLeve${run}` });
    expect((await replies(adult, strong.id))[0]).toMatchObject({ id: reply.id, gif: expect.objectContaining({ rating: 'r' }) });

    for (const v of [minor, noBirth]) {
      const items = await list(v, post);
      // Sem o GIF (nem o endereço), com gifHidden; o texto do comentário continua.
      expect(items.find((c) => c.id === strong.id)).toMatchObject({ body: 'com texto', gif: null, gifHidden: true });
      expect(items.find((c) => c.id === old.id)).toMatchObject({ body: 'antigo', gif: null, gifHidden: true });
      expect(items.find((c) => c.id === light.id)).toMatchObject({ gif: expect.objectContaining({ rating: 'g' }) });
      expect(items.find((c) => c.id === light.id)).not.toHaveProperty('gifHidden');
      expect((await replies(v, strong.id))[0]).toMatchObject({ id: reply.id, gif: null, gifHidden: true });
      expect((await api().get(`/api/v1/comments/${strong.id}`).set(auth(v)).expect(200)).body).toMatchObject({ gif: null, gifHidden: true });
      expect(JSON.stringify(items)).not.toContain(`CPg${run}`);
    }

    // Editar o texto não mexe no GIF nem na classificação; a um menor continua escondido.
    expect((await api().patch(`/api/v1/comments/${strong.id}`).set(auth(adult)).send({ body: 'editado' }).expect(200)).body).toMatchObject({ gif: expect.objectContaining({ rating: 'pg' }) });
    expect((await list(minor, post)).find((c) => c.id === strong.id)).toMatchObject({ body: 'editado', gif: null, gifHidden: true });
  });

  it('quem é menor e comenta um GIF acima de «g» (que não lhe aparece na grelha) também o vê escondido', async () => {
    const owner = await signup('cia');
    const minor = await signup('cim', '2010-10-10');
    const post = (await api().post('/api/v1/posts').set(auth(owner)).send({ body: 'outro' }).expect(201)).body.id as string;
    ratings[`CMenor${run}`] = 'pg-13';
    const c = (await comment(minor, post, { body: 'ups', gif: gif(`CMenor${run}`, 'g') }).expect(201)).body as C;
    expect(c).toMatchObject({ body: 'ups', gif: null, gifHidden: true });
    expect(await stored(c.id)).toBe('pg-13');
    expect((await list(owner, post)).find((x) => x.id === c.id)?.gif).toMatchObject({ rating: 'pg-13' });
  });
});
