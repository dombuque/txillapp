import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { staffLogin } from '../staff/staff-test';
import type { BodyPartDetector, ImageClassifier } from '../moderation/image-moderation.service';
import { MediaService } from './media.service';
import { UnusedMediaService } from './unused-media.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

/** Modelos de mentira: o último byte da imagem diz se é «nudez» (1) ou não (0). Nenhum teste depende dos modelos reais. */
const classifier: ImageClassifier = { nsfwScore: async (img) => (img[img.length - 1] === 1 ? 0.9 : 0.05) };
const detector: BodyPartDetector = { detect: async (img) => (img[img.length - 1] === 1 ? [{ label: 'FEMALE_GENITALIA_EXPOSED', score: 0.9, box: [1, 1, 3, 3] }] : []) };
let n = 0;
const photo = (nude: boolean) => Buffer.concat([PNG, Buffer.from(`#${++n}#`), Buffer.from([nude ? 1 : 0])]);

interface U { token: string; id: string; username: string }

describe('publicações guardadas com o pedido de revisão (publicadas sozinhas quando a foto é aprovada)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  let staff = '';
  let me: U;
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  const sauth = () => ({ Authorization: `Bearer ${staff}` });

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: name, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  /** Envia uma foto; devolve o id (e o código: 200 pronta, 422 recusada). */
  async function send(x: U, nude: boolean, purpose = 'public', expectCode = nude ? 422 : 200) {
    const bytes = photo(nude);
    const r = await api().post('/api/v1/media/uploads').set(auth(x)).send({ mime: 'image/png', size: bytes.length, purpose }).expect(201);
    await api().put(r.body.uploadUrl).set('Content-Type', 'image/png').send(bytes).expect(expectCode);
    return r.body.assetId as string;
  }
  const decide = (id: string, action: 'dismiss' | 'remove') =>
    api().post('/api/v1/admin/mod/queue/decide').set(sauth()).send({ items: [{ type: 'media', id }], action, ...(action === 'remove' ? { note: 'Mostra nudez' } : {}) }).expect(200);
  const held = async (id: string) => (await pool.query('SELECT status, result_id, error FROM content.held_publications WHERE media_id = $1 ORDER BY created_at DESC LIMIT 1', [id])).rows[0];
  /** O último aviso da moderação ao dono (a publicação e o aviso correm depois da decisão). */
  async function lastNotice(x: U, kind: string, after: Date) {
    for (let i = 0; i < 40; i++) {
      const r = (await pool.query('SELECT data FROM social.notifications WHERE user_id = $1 AND kind = $2 AND created_at >= $3 ORDER BY created_at DESC LIMIT 1', [x.id, kind, after])).rows[0];
      if (r) return r.data as Record<string, string>;
      await new Promise((ok) => setTimeout(ok, 100));
    }
    return null;
  }

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(
      loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'h'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test', IMAGE_MODERATION: 'local' }),
      { imageClassifier: classifier, bodyDetector: detector },
    );
    await app.init();
    me = await signup('hp');
    staff = (await staffLogin(app, 'hpmod')).token;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('publicação com duas fotos: o rascunho fica guardado, os outros ficheiros escapam à limpeza, e aprovada publica-se sozinha com o aviso', async () => {
    const ok = await send(me, false);
    const bad = await send(me, true);
    // Rascunho mal feito (sem a foto em revisão, ou fora das regras do endpoint): nem se pede a revisão.
    await api().post(`/api/v1/media/${bad}/appeal`).set(auth(me)).send({ draft: { kind: 'post', payload: { body: 'x', mediaIds: [ok] } } }).expect(400);
    await api().post(`/api/v1/media/${bad}/appeal`).set(auth(me)).send({ draft: { kind: 'post', payload: { body: 'x'.repeat(2001), mediaIds: [ok, bad] } } }).expect(400);
    await api().post(`/api/v1/media/${bad}/appeal`).set(auth(me)).send({ draft: { kind: 'nada', payload: {} } }).expect(400);
    expect((await pool.query('SELECT appealed_at FROM content.media_assets WHERE id = $1', [bad])).rows[0].appealed_at).toBeNull();

    const r = await api().post(`/api/v1/media/${bad}/appeal`).set(auth(me)).send({ draft: { kind: 'post', payload: { body: 'praia com a família', mediaIds: [ok, bad] } } }).expect(200);
    expect(r.body).toEqual({ status: 'rejected', appeal: 'pending', held: true });
    expect((await api().get(`/api/v1/media/${bad}/status`).set(auth(me)).expect(200)).body).toMatchObject({ status: 'rejected', appeal: 'pending', held: { status: 'held', kind: 'post' } });

    // A outra foto do rascunho conta como em uso: a limpeza das 48 h não a apaga.
    await pool.query(`UPDATE content.media_assets SET created_at = now() - interval '3 days' WHERE id = $1`, [ok]);
    await app.get(UnusedMediaService).run();
    expect((await pool.query('SELECT status FROM content.media_assets WHERE id = $1', [ok])).rows[0].status).toBe('ready');

    const t = new Date();
    await decide(bad, 'dismiss');
    const note = await lastNotice(me, 'content_restored', t);
    expect(note).toMatchObject({ type: 'media', reason: 'Revimos a tua foto: não tem nudez. A tua publicação já está no ar.' });
    const h = await held(bad);
    expect(h.status).toBe('published');
    expect(note!.postId).toBe(h.result_id);
    const post = (await pool.query('SELECT body, author_id FROM content.posts WHERE id = $1', [h.result_id])).rows[0];
    expect(post).toEqual({ body: 'praia com a família', author_id: me.id });
    const media = (await pool.query('SELECT media_id FROM content.post_media WHERE post_id = $1 ORDER BY position', [h.result_id])).rows.map((x) => x.media_id);
    expect(media).toEqual([ok, bad]);
    expect((await api().get(`/api/v1/media/${bad}/status`).set(auth(me)).expect(200)).body).toMatchObject({ status: 'ready', held: { status: 'published', kind: 'post', id: h.result_id } });
  });

  it('mimo e Zás: publicados na aprovação; o Zás conta as 24 horas a partir daí', async () => {
    const m = await send(me, true);
    await api().post(`/api/v1/media/${m}/appeal`).set(auth(me)).send({ draft: { kind: 'story', payload: { mediaId: m, caption: 'o meu mimo', audience: 'all' } } }).expect(200);
    const z = await send(me, true, 'chat'); // as fotos do Zás são do chat
    await api().post(`/api/v1/media/${z}/appeal`).set(auth(me)).send({ draft: { kind: 'instant', payload: { mediaId: z, caption: 'zás' } } }).expect(200);
    // O Zás foi «criado» há dois dias (o pedido ficou à espera); publicado agora, dura 24 horas a partir de agora.
    await pool.query(`UPDATE content.held_publications SET created_at = now() - interval '2 days' WHERE media_id = $1`, [z]);

    const t = new Date();
    await decide(m, 'dismiss');
    expect(await lastNotice(me, 'content_restored', t)).toMatchObject({ reason: 'Revimos a tua foto: não tem nudez. O teu mimo já está no ar.' });
    const story = (await pool.query('SELECT caption, media_id FROM content.stories WHERE id = $1', [(await held(m)).result_id])).rows[0];
    expect(story).toEqual({ caption: 'o meu mimo', media_id: m });

    const t2 = new Date();
    await decide(z, 'dismiss');
    expect(await lastNotice(me, 'content_restored', t2)).toMatchObject({ reason: 'Revimos a tua foto: não tem nudez. O teu Zás já foi enviado.' });
    const zas = (await pool.query(`SELECT caption, expires_at > now() + interval '23 hours' AS fresh FROM social.instants WHERE id = $1`, [(await held(z)).result_id])).rows[0];
    expect(zas).toEqual({ caption: 'zás', fresh: true });
  });

  it('remover a foto descarta a publicação guardada e o aviso diz que foi recusada', async () => {
    const bad = await send(me, true, 'chat');
    await api().post(`/api/v1/media/${bad}/appeal`).set(auth(me)).send({ draft: { kind: 'instant', payload: { mediaId: bad, caption: 'olá' } } }).expect(200);
    const t = new Date();
    await decide(bad, 'remove');
    const note = await lastNotice(me, 'content_removed', t);
    expect(note).toMatchObject({ type: 'media', reason: 'A moderação reviu a tua foto e manteve a recusa: parece mostrar nudez. A publicação guardada foi descartada.' });
    expect((await held(bad)).status).toBe('discarded');
    expect((await pool.query('SELECT count(*)::int AS n FROM social.instants WHERE media_id = $1', [bad])).rows[0].n).toBe(0);
  });

  it('validade de 7 dias: o rascunho descarta-se (e os outros ficheiros deixam de contar); a foto aprovada depois fica só publicável', async () => {
    const ok = await send(me, false);
    const bad = await send(me, true);
    await api().post(`/api/v1/media/${bad}/appeal`).set(auth(me)).send({ draft: { kind: 'post', payload: { body: 'tarde demais', mediaIds: [bad, ok] } } }).expect(200);
    await pool.query(`UPDATE content.held_publications SET expires_at = now() - interval '1 minute' WHERE media_id = $1`, [bad]);
    await app.get(MediaService).sweepDeleted();
    expect((await held(bad)).status).toBe('expired');
    await pool.query(`UPDATE content.media_assets SET created_at = now() - interval '3 days' WHERE id = $1`, [ok]);
    await app.get(UnusedMediaService).run();
    expect((await pool.query('SELECT count(*)::int AS n FROM content.media_assets WHERE id = $1', [ok])).rows[0].n).toBe(0);

    const t = new Date();
    await decide(bad, 'dismiss');
    expect(await lastNotice(me, 'content_restored', t)).toMatchObject({ reason: 'Revimos a tua foto: não tem nudez. Já a podes publicar.' });
    expect((await pool.query(`SELECT count(*)::int AS n FROM content.posts WHERE author_id = $1 AND body = 'tarde demais'`, [me.id])).rows[0].n).toBe(0);
  });

  it('se publicar falhar (um dos outros ficheiros já não existe): avisa com o motivo e a foto fica publicável à mão', async () => {
    const ok = await send(me, false);
    const bad = await send(me, true);
    await api().post(`/api/v1/media/${bad}/appeal`).set(auth(me)).send({ draft: { kind: 'post', payload: { body: 'falha', mediaIds: [ok, bad] } } }).expect(200);
    await pool.query(`UPDATE content.media_assets SET status = 'deleted' WHERE id = $1`, [ok]);
    const t = new Date();
    await decide(bad, 'dismiss');
    const note = await lastNotice(me, 'content_restored', t);
    expect(note?.reason).toMatch(/^Revimos a tua foto: não tem nudez, mas não consegui publicar o que tinhas guardado \(.+\)\. Já a podes publicar à mão\.$/);
    expect((await held(bad)).status).toBe('failed');
    await api().post('/api/v1/posts').set(auth(me)).send({ body: 'à mão', mediaIds: [bad] }).expect(201);
  });

  it('a exportação traz as publicações guardadas; apagar a conta apaga-as', async () => {
    const x = await signup('hq');
    const bad = await send(x, true);
    await api().post(`/api/v1/media/${bad}/appeal`).set(auth(x)).send({ draft: { kind: 'story', payload: { mediaId: bad, caption: 'guardado' } } }).expect(200);
    const data = JSON.parse((await api().get('/api/v1/me/export').set(auth(x)).expect(200)).text) as { heldPublications: { kind: string; mediaId: string; status: string; payload: { caption: string } }[] };
    expect(data.heldPublications).toEqual([expect.objectContaining({ kind: 'story', mediaId: bad, status: 'held', payload: expect.objectContaining({ caption: 'guardado' }) })]);
    await api().post('/api/v1/auth/delete-account').set(auth(x)).send({ confirmUsername: x.username, password: PASSWORD }).expect(204);
    expect((await pool.query('SELECT count(*)::int AS n FROM content.held_publications WHERE owner_id = $1', [x.id])).rows[0].n).toBe(0);
  });
});
