import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import sharp from 'sharp';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';

interface U { token: string; id: string; username: string }

/**
 * docs/fontes-contrato.md: quem pode o quê com as letras (cópias guardadas, editar a letra de outra pessoa) e o que
 * acontece às publicações, mimos e Zás com letra quando a conta é apagada.
 */
describe('fontes ao publicar: permissões e conta apagada (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  let jpeg: Buffer;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  let me: U;
  let friend: U;
  let stranger: U;

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  async function upload(x: U, purpose: 'public' | 'chat' = 'public'): Promise<string> {
    const up = await api().post('/api/v1/media/uploads').set(auth(x)).send({ mime: 'image/jpeg', size: jpeg.length, purpose }).expect(201);
    await api().put(up.body.uploadUrl).set('Content-Type', 'image/jpeg').send(jpeg).expect(200);
    if (purpose === 'chat') await api().post(`/api/v1/media/${up.body.assetId}/complete`).set(auth(x)).send({}).expect(200);
    return up.body.assetId as string;
  }
  const text = (o: Record<string, unknown> = {}) => ({ kind: 'text', text: 'Bom dia malta', font: 'cartaz', color: '#ffd60a', bg: 'solid', align: 'center', x: 0.5, y: 0.5, s: 0.6, r: -5, ...o });

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'f'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    me = await signup('fpm');
    friend = await signup('fpf');
    stranger = await signup('fps');
    await pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2), ($2, $1) ON CONFLICT DO NOTHING', [me.id, friend.id]);
    jpeg = await sharp({ create: { width: 400, height: 400, channels: 3, background: { r: 90, g: 90, b: 90 } } }).jpeg({ quality: 90 }).toBuffer();
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('só quem fez guarda a cópia de um mimo com textos ou de um Zás com letra (os outros: 403; sem sessão: 401)', async () => {
    const m1 = await upload(me);
    const story = (await api().post('/api/v1/stories').set(auth(me)).send({ mediaId: m1, stickers: [text()] }).expect(201)).body;
    await api().get(`/api/v1/stories/${story.id}/download`).set(auth(friend)).expect(403);
    await api().get(`/api/v1/stories/${story.id}/download`).set(auth(stranger)).expect(403);
    await api().get(`/api/v1/stories/${story.id}/download`).expect(401);
    await api().get(`/api/v1/stories/${story.id}/download`).set(auth(me)).expect(200);

    const z1 = await upload(me, 'chat');
    const zas = (await api().post('/api/v1/instants').set(auth(me)).send({ mediaId: z1, caption: 'cheguei', captionFont: 'praia' }).expect(201)).body;
    expect(zas.captionFont).toBe('praia');
    await api().get(`/api/v1/instants/${zas.id}/download`).set(auth(friend)).expect(403);
    await api().get(`/api/v1/instants/${zas.id}/download`).expect(401);
    await api().get(`/api/v1/instants/${zas.id}/download`).set(auth(me)).expect(200);
  });

  it('ninguém muda a letra da publicação de outra pessoa (404) e a letra fica como estava', async () => {
    const post = (await api().post('/api/v1/posts').set(auth(me)).send({ body: 'só texto', textFont: 'cartaz' }).expect(201)).body;
    expect(post.textFont).toBe('cartaz');
    await api().patch(`/api/v1/posts/${post.id}`).set(auth(friend)).send({ body: 'só texto', textFont: 'praia' }).expect(404);
    await api().patch(`/api/v1/posts/${post.id}`).send({ textFont: 'praia' }).expect(401);
    // Um id desconhecido dá 400 antes de qualquer outra coisa, mesmo a quem não é dono.
    await api().patch(`/api/v1/posts/${post.id}`).set(auth(friend)).send({ textFont: 'comic' }).expect(400);
    expect((await api().get(`/api/v1/posts/${post.id}`).set(auth(friend)).expect(200)).body.textFont).toBe('cartaz');
  });

  it('a citação de outra pessoa leva a letra de quem cita; a original fica com a sua', async () => {
    const orig = (await api().post('/api/v1/posts').set(auth(me)).send({ body: 'original', textFont: 'retro' }).expect(201)).body;
    const quote = (await api().post(`/api/v1/posts/${orig.id}/repost`).set(auth(friend)).send({ body: 'a minha citação', textFont: 'mao' }).expect(201)).body;
    const seen = (await api().get(`/api/v1/posts/${quote.id}`).set(auth(stranger)).expect(200)).body;
    expect(seen.textFont).toBe('mao');
    expect(seen.repostOf.textFont).toBe('retro');
    await api().post(`/api/v1/posts/${orig.id}/repost`).set(auth(stranger)).send({ body: 'outra', textFont: 'nada' }).expect(400);
  });

  it('um texto guardado com uma letra que deixou de existir lê-se como clássica (no visor e na cópia), não desaparece', async () => {
    const m3 = await upload(me);
    const story = (await api().post('/api/v1/stories').set(auth(me)).send({ mediaId: m3, stickers: [text({ font: 'retro', text: 'letra antiga' })] }).expect(201)).body;
    await pool.query(`UPDATE content.stories SET stickers = jsonb_set(stickers, '{0,font}', '"gotica"') WHERE id = $1`, [story.id]);
    const seen = (await api().get(`/api/v1/stories/user/${me.username}`).set(auth(friend)).expect(200)).body as { id: string; stickers: { kind?: string; font?: string; text?: string }[] }[];
    expect(seen.find((s) => s.id === story.id)?.stickers).toEqual([text({ font: 'classica', text: 'letra antiga' })]);
    await api().get(`/api/v1/stories/${story.id}/download`).set(auth(me)).expect(200);
  });

  it('conta apagada: a publicação com letra, o mimo com textos e o Zás com letra deixam de se ver', async () => {
    const x = await signup('fpx');
    await pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2), ($2, $1) ON CONFLICT DO NOTHING', [x.id, friend.id]);
    const post = (await api().post('/api/v1/posts').set(auth(x)).send({ body: 'adeus', textFont: 'grito' }).expect(201)).body;
    const m2 = await upload(x);
    const z2 = await upload(x, 'chat');
    const story = (await api().post('/api/v1/stories').set(auth(x)).send({ mediaId: m2, stickers: [text({ font: 'futuro' })] }).expect(201)).body;
    const zas = (await api().post('/api/v1/instants').set(auth(x)).send({ mediaId: z2, caption: 'até já', captionFont: 'maquina' }).expect(201)).body;
    // Antes: o amigo vê tudo, com as letras.
    expect((await api().get(`/api/v1/posts/${post.id}`).set(auth(friend)).expect(200)).body.textFont).toBe('grito');
    const before = (await api().get(`/api/v1/stories/user/${x.username}`).set(auth(friend)).expect(200)).body as { id: string; stickers: { font?: string }[] }[];
    expect(before.find((s) => s.id === story.id)?.stickers[0].font).toBe('futuro');
    const feedBefore = (await api().get('/api/v1/instants/feed').set(auth(friend)).expect(200)).body as unknown;
    expect(JSON.stringify(feedBefore)).toContain(zas.id);

    await api().post('/api/v1/auth/delete-account').set(auth(x)).send({ confirmUsername: x.username, password: PASSWORD }).expect(204);

    await api().get(`/api/v1/posts/${post.id}`).set(auth(friend)).expect(404);
    const after = await api().get(`/api/v1/stories/user/${x.username}`).set(auth(friend));
    if (after.status === 200) expect((after.body as { id: string }[]).some((s) => s.id === story.id)).toBe(false);
    else expect(after.status).toBe(404);
    expect(JSON.stringify((await api().get('/api/v1/instants/feed').set(auth(friend)).expect(200)).body)).not.toContain(zas.id);
    // A sessão da conta apagada já não serve para guardar cópias.
    const dl = await api().get(`/api/v1/stories/${story.id}/download`).set(auth(x));
    expect([401, 403, 404]).toContain(dl.status);
  });
});
