import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { PushService } from '../push/push.service';
import { TXILLAPP_GIF_ORIGIN, TXILLAPP_GIF_SIZE, gifSchema, readGif } from './gif';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';

interface U { token: string; id: string; username: string }

/** O GIF do Txillapp como a app o manda (o item «Txillapp» do painel dos GIFs). */
const brand = (over: Record<string, unknown> = {}) => ({
  id: 'logo', source: 'txillapp', w: TXILLAPP_GIF_SIZE.w, h: TXILLAPP_GIF_SIZE.h,
  url: `${TXILLAPP_GIF_ORIGIN}/marca/txillapp-animado.webp`, still: `${TXILLAPP_GIF_ORIGIN}/marca/txillapp-final.png`, title: 'Txillapp', ...over,
});

describe('gifSchema e readGif: a fonte «txillapp» (unidade)', () => {
  it('aceita só os ids e os ficheiros da lista; medidas, título e classificação são os nossos', () => {
    expect(gifSchema.parse(brand({ w: 999, h: 999, title: 'outro', rating: 'r' }))).toEqual({
      id: 'logo', w: 480, h: 211, url: 'https://txillapp.com/marca/txillapp-animado.webp', still: 'https://txillapp.com/marca/txillapp-final.png', title: 'Txillapp', rating: 'g', source: 'txillapp',
    });
    expect(gifSchema.parse(brand({ id: 'logo-branco', url: 'https://txillapp.com/marca/txillapp-animado-branco.gif', still: undefined })).url).toBe('https://txillapp.com/marca/txillapp-animado-branco.gif');
    for (const bad of [
      brand({ id: 'outro' }),
      brand({ id: 'logo', url: 'https://txillapp.com/marca/txillapp-animado-branco.webp' }), // o ficheiro de outro id
      brand({ url: 'https://evil.example/marca/txillapp-animado.webp' }),
      brand({ url: 'http://txillapp.com/marca/txillapp-animado.webp' }),
      brand({ url: 'https://txillapp.com/marca/txillapp-animado.webp?x=1' }),
      brand({ url: 'https://txillapp.com.evil.example/marca/txillapp-animado.webp' }),
      brand({ still: 'https://media2.giphy.com/media/abcd/200w_s.gif' }),
      brand({ source: 'outra' }),
      // Um GIF do GIPHY com a fonte do Txillapp, e o do Txillapp sem a fonte: não.
      brand({ id: 'abcd1234', url: 'https://media2.giphy.com/media/abcd1234/200w.gif', still: undefined }),
      { ...brand(), source: undefined },
    ]) expect(gifSchema.safeParse(bad).success).toBe(false);
  });

  it('readGif: só o que está na lista; o que vem do GIPHY continua igual', () => {
    expect(readGif({ ...brand(), rating: 'r', w: 10 })).toMatchObject({ id: 'logo', w: 480, h: 211, rating: 'g', source: 'txillapp' });
    expect(readGif(brand({ id: 'nao' }))).toBeNull();
    expect(readGif(brand({ url: 'https://txillapp.com/marca/outro.webp' }))).toBeNull();
    expect(readGif({ id: 'abcd1234', w: 200, h: 150, url: 'https://media2.giphy.com/media/abcd1234/200w.gif', source: 'outra' })).toBeNull();
    expect(readGif({ id: 'abcd1234', w: 200, h: 150, url: 'https://media2.giphy.com/media/abcd1234/200w.gif', rating: 'g' })).toEqual({ id: 'abcd1234', w: 200, h: 150, url: 'https://media2.giphy.com/media/abcd1234/200w.gif', rating: 'g' });
  });
});

/**
 * O GIF do Txillapp (o logótipo animado, servido pelo nosso site) numa mensagem, num comentário e numa nota: não se pergunta
 * nada ao GIPHY, fica 'g' e chega aos menores. Um id ou um url fora da lista: 400.
 */
describe('GIF do Txillapp em mensagens, comentários e notas (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  let fetchSpy: jest.SpyInstance;
  let pushSpy: jest.SpyInstance;
  const run = Date.now().toString(36);
  let n = 0;
  const giphyCalls: string[] = [];
  const api = () => request(app.getHttpServer());
  const auth = (x: { token: string }) => ({ Authorization: `Bearer ${x.token}` });

  async function signup(name: string, birthDate = '1990-06-15'): Promise<U> {
    const username = `${name}${run}${n++}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').set('X-Forwarded-For', `10.9.6.${(n % 250) + 1}`)
      .send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: 'password-bem-longa-1', birthDate, acceptTerms: true }).expect(201);
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  const follow = (who: U, whom: U) => pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [who.id, whom.id]);
  const mutual = async (a: U, b: U) => { await follow(a, b); await follow(b, a); };

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'k'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test', GIPHY_API_KEY: 'chave-de-teste-789' }));
    await app.init();
    // O GIPHY não pode ser chamado para o GIF do Txillapp: qualquer pedido fica registado (e falha).
    const real = global.fetch;
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.hostname !== 'api.giphy.com') return real(input, init);
      giphyCalls.push(url.pathname);
      return new Response('não devia', { status: 500 });
    });
    pushSpy = jest.spyOn(app.get(PushService), 'send').mockImplementation(async () => 0);
  }, 60_000);

  afterAll(async () => {
    fetchSpy.mockRestore();
    pushSpy.mockRestore();
    await app.close();
    await pool.end();
  });

  it('mensagem: o adulto envia, o menor vê o GIF (classificação g, sem GIPHY); id ou url fora da lista dá 400', async () => {
    const adult = await signup('tga');
    const minor = await signup('tgm', '2011-04-04');
    await mutual(adult, minor);
    await api().post(`/api/v1/chat/with/${minor.username}`).set(auth(adult)).send({ kind: 'gif', gif: brand({ rating: 'r' }) }).expect(201);
    // Gravado com a classificação 'g' (a 'r' da app não conta) e a fonte.
    expect((await pool.query(`SELECT gif ->> 'rating' AS r, gif ->> 'source' AS s FROM social.messages WHERE sender_id = $1`, [adult.id])).rows).toEqual([{ r: 'g', s: 'txillapp' }]);
    const items = (await api().get(`/api/v1/chat/with/${adult.username}`).set(auth(minor)).expect(200)).body.items as { kind: string; gif: Record<string, unknown> | null; gifHidden?: boolean }[];
    const got = items.find((m) => m.kind === 'gif')!;
    expect(got.gifHidden).toBeUndefined();
    expect(got.gif).toEqual({ id: 'logo', w: 480, h: 211, url: 'https://txillapp.com/marca/txillapp-animado.webp', still: 'https://txillapp.com/marca/txillapp-final.png', title: 'Txillapp', rating: 'g', source: 'txillapp' });
    const last = ((await api().get('/api/v1/chat/conversations').set(auth(minor)).expect(200)).body as { username: string; lastMessage: Record<string, unknown> }[]).find((c) => c.username === adult.username)!.lastMessage;
    expect(last.gifHidden).toBeUndefined();

    await api().post(`/api/v1/chat/with/${minor.username}`).set(auth(adult)).send({ kind: 'gif', gif: brand({ id: 'logo-falso' }) }).expect(400);
    await api().post(`/api/v1/chat/with/${minor.username}`).set(auth(adult)).send({ kind: 'gif', gif: brand({ url: 'https://evil.example/marca/txillapp-animado.webp' }) }).expect(400);
    // Também quem é menor envia o GIF do Txillapp.
    await api().post(`/api/v1/chat/with/${adult.username}`).set(auth(minor)).send({ kind: 'gif', gif: brand({ id: 'logo-branco', url: 'https://txillapp.com/marca/txillapp-animado-branco.webp', still: undefined }) }).expect(201);
    expect(giphyCalls).toEqual([]);
  });

  it('comentário: com o GIF do Txillapp chega ao menor; id inválido dá 400', async () => {
    const owner = await signup('tgo');
    const minor = await signup('tgn', '2010-09-09');
    const post = (await api().post('/api/v1/posts').set(auth(owner)).send({ body: 'post com o GIF da marca' }).expect(201)).body.id as string;
    await api().post(`/api/v1/posts/${post}/comments`).set(auth(owner)).send({ gif: brand() }).expect(201);
    await api().post(`/api/v1/posts/${post}/comments`).set(auth(owner)).send({ body: 'olha', gif: brand({ id: 'nada' }) }).expect(400);
    await api().post(`/api/v1/posts/${post}/comments`).set(auth(owner)).send({ gif: brand({ url: 'https://txillapp.com/marca/txillapp-animado-fundo.webp' }) }).expect(400);
    const items = (await api().get(`/api/v1/posts/${post}/comments`).set(auth(minor)).expect(200)).body.items as { gif: Record<string, unknown> | null; gifHidden?: boolean }[];
    expect(items).toHaveLength(1);
    expect(items[0].gifHidden).toBeFalsy();
    expect(items[0].gif).toMatchObject({ id: 'logo', source: 'txillapp', rating: 'g', url: 'https://txillapp.com/marca/txillapp-animado.webp' });
    expect(giphyCalls).toEqual([]);
  });

  it('nota: o GIF do Txillapp fica com «g» e o menor vê-o; id inválido dá 400', async () => {
    const author = await signup('tgt');
    const minor = await signup('tgv', '2011-01-01');
    await follow(minor, author);
    await api().put('/api/v1/notes/me').set(auth(author)).send({ gif: brand({ id: 'logo-x' }) }).expect(400);
    await api().put('/api/v1/notes/me').set(auth(author)).send({ gif: brand({ id: 'logo-fundo', url: 'https://txillapp.com/marca/txillapp-animado-fundo.gif', still: 'https://txillapp.com/marca/txillapp-final-fundo.png' }) }).expect(204);
    expect((await pool.query(`SELECT gif ->> 'rating' AS r, gif ->> 'source' AS s FROM social.notes WHERE user_id = $1`, [author.id])).rows[0]).toEqual({ r: 'g', s: 'txillapp' });
    const note = ((await api().get('/api/v1/notes').set(auth(minor)).expect(200)).body.items as { username: string; gif: Record<string, unknown> | null }[]).find((z) => z.username === author.username);
    expect(note?.gif).toMatchObject({ id: 'logo-fundo', source: 'txillapp', rating: 'g', url: 'https://txillapp.com/marca/txillapp-animado-fundo.gif' });
    expect(giphyCalls).toEqual([]);
  });
});
