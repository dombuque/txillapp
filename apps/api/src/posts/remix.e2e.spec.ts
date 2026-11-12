import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';

interface U { token: string; id: string; username: string }

/** Remix das tchekas (0134): dueto, resposta com tcheka, quem deixa, bloqueios, privacidade, avisos e «Duetos e respostas». */
describe('remix das tchekas: dueto e responder com tcheka (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  const u: Record<string, U> = {};

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  /** Um vídeo já processado (como se tivesse sido carregado e convertido). */
  const video = async (owner: U, mime = 'video/mp4') =>
    (await pool.query(`INSERT INTO content.media_assets (id, owner_id, mime, size_bytes, storage_key, status, duration_ms, width, height) VALUES (gen_random_uuid(), $1, $2, 1, 'x', 'ready', 5000, 720, 1280) RETURNING id`, [owner.id, mime])).rows[0].id as string;
  const tcheka = async (owner: U, body = 'a minha tcheka') => (await api().post('/api/v1/posts').set(auth(owner)).send({ body, mediaIds: [await video(owner)] }).expect(201)).body as { id: string; canRemix: boolean; remixes: number };
  const publish = async (who: U, remixOf: object, expect: number, extra: object = {}) =>
    api().post('/api/v1/posts').set(auth(who)).send({ body: 'remix', mediaIds: [await video(who)], remixOf, ...extra }).expect(expect);
  const notes = async (who: U) => (await api().get('/api/v1/notifications').set(auth(who)).expect(200)).body.items as { kind: string; data: Record<string, unknown>; actor: { username: string } }[];
  const privacy = (who: U, b: object) => api().patch('/api/v1/settings/privacy').set(auth(who)).send(b).expect(200);

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'd'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    for (const n of ['rxa', 'rxb', 'rxc', 'rxd']) u[n] = await signup(n);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('dueto: liga ao original, avisa o autor e aparece em «Duetos e respostas»', async () => {
    const { rxa, rxb } = u;
    const orig = await tcheka(rxa);
    expect(orig.canRemix).toBe(true);
    expect(orig.remixes).toBe(0);
    // A outra pessoa vê que pode fazer dueto.
    expect((await api().get(`/api/v1/posts/${orig.id}`).set(auth(rxb)).expect(200)).body.canRemix).toBe(true);

    const duet = (await publish(rxb, { postId: orig.id, kind: 'duet' }, 201)).body;
    expect(duet.remixOf).toMatchObject({ postId: orig.id, kind: 'duet', commentId: null, sticker: null, available: true, author: { username: rxa.username } });

    const list = (await api().get(`/api/v1/posts/${orig.id}/remixes`).set(auth(rxa)).expect(200)).body;
    expect(list.items.map((p: { id: string }) => p.id)).toEqual([duet.id]);
    expect((await api().get(`/api/v1/posts/${orig.id}/remixes?kind=reply`).set(auth(rxa)).expect(200)).body.items).toEqual([]);
    expect((await api().get(`/api/v1/posts/${orig.id}`).set(auth(rxa)).expect(200)).body.remixes).toBe(1);

    const n = (await notes(rxa)).find((x) => x.kind === 'remix' && x.data.postId === duet.id);
    expect(n).toMatchObject({ actor: { username: rxb.username }, data: { remixKind: 'duet', role: 'post', originalId: orig.id } });

    // Um dueto é uma tcheka: um vídeo só, com uma tcheka (não uma foto nem texto).
    const photo = (await pool.query(`INSERT INTO content.media_assets (id, owner_id, mime, size_bytes, storage_key, status) VALUES (gen_random_uuid(), $1, 'image/jpeg', 1, 'x', 'ready') RETURNING id`, [rxb.id])).rows[0].id as string;
    await api().post('/api/v1/posts').set(auth(rxb)).send({ body: 'x', mediaIds: [photo], remixOf: { postId: orig.id, kind: 'duet' } }).expect(400);
    await api().post('/api/v1/posts').set(auth(rxb)).send({ body: 'x', remixOf: { postId: orig.id, kind: 'duet' } }).expect(400);
    const text = (await api().post('/api/v1/posts').set(auth(rxa)).send({ body: 'só texto' }).expect(201)).body;
    await publish(rxb, { postId: text.id, kind: 'duet' }, 400);
    // Um dueto não leva comentário; uma resposta tem de levar.
    await publish(rxb, { postId: orig.id, kind: 'reply' }, 400);
  });

  it('desligar «Deixar fazer duetos e respostas»: deixa de dar, os que já existem ficam', async () => {
    const { rxa, rxb } = u;
    const orig = await tcheka(rxa, 'desliga');
    const before = (await publish(rxb, { postId: orig.id, kind: 'duet' }, 201)).body;
    expect((await privacy(rxa, { remixAllowed: false })).body.remixAllowed).toBe(false);
    expect((await api().get(`/api/v1/posts/${orig.id}`).set(auth(rxb)).expect(200)).body.canRemix).toBe(false);
    await publish(rxb, { postId: orig.id, kind: 'duet' }, 403);
    // O próprio continua a poder (com a sua própria tcheka).
    expect((await api().get(`/api/v1/posts/${orig.id}`).set(auth(rxa)).expect(200)).body.canRemix).toBe(true);
    await publish(rxa, { postId: orig.id, kind: 'duet' }, 201);
    expect((await api().get(`/api/v1/posts/${orig.id}/remixes`).set(auth(rxb)).expect(200)).body.items.map((p: { id: string }) => p.id)).toContain(before.id);
    await privacy(rxa, { remixAllowed: true });
    await publish(rxb, { postId: orig.id, kind: 'duet' }, 201);
  });

  it('conta privada: nem os seguidores fazem remix; quem não segue nem vê (404)', async () => {
    const { rxc, rxb, rxd } = u;
    const orig = await tcheka(rxc, 'privada');
    await privacy(rxc, { isPrivate: true });
    expect((await api().get('/api/v1/settings/privacy').set(auth(rxc)).expect(200)).body.remixAllowed).toBe(true); // a escolha fica guardada…
    await publish(rxd, { postId: orig.id, kind: 'duet' }, 404); // …mas quem não segue nem vê a publicação
    // Um seguidor aceite vê a tcheka mas não pode fazer remix dela.
    await api().post(`/api/v1/users/${rxc.username}/follow`).set(auth(rxb)).expect((r) => expect([200, 201]).toContain(r.status));
    await api().post(`/api/v1/follow-requests/${rxb.username}/accept`).set(auth(rxc)).expect((r) => expect([200, 201, 204]).toContain(r.status));
    const seen = (await api().get(`/api/v1/posts/${orig.id}`).set(auth(rxb)).expect(200)).body;
    expect(seen.canRemix).toBe(false);
    await publish(rxb, { postId: orig.id, kind: 'duet' }, 403);
    await privacy(rxc, { isPrivate: false });
  });

  it('bloqueio: nenhum dos lados faz remix do outro, nem vê os remixes do outro', async () => {
    const { rxa, rxd } = u;
    const orig = await tcheka(rxa, 'bloqueio');
    const mine = await tcheka(rxd, 'do d');
    const d1 = (await publish(rxd, { postId: orig.id, kind: 'duet' }, 201)).body;
    await api().put(`/api/v1/blocks/${rxd.username}`).set(auth(rxa)).expect((r) => expect([200, 201, 204]).toContain(r.status));
    await publish(rxd, { postId: orig.id, kind: 'duet' }, 404);
    await publish(rxa, { postId: mine.id, kind: 'duet' }, 404);
    // A lista de remixes do original, vista pelo autor, já não mostra o dueto de quem ele bloqueou.
    expect((await api().get(`/api/v1/posts/${orig.id}/remixes`).set(auth(rxa)).expect(200)).body.items.map((p: { id: string }) => p.id)).not.toContain(d1.id);
    await api().delete(`/api/v1/blocks/${rxd.username}`).set(auth(rxa));
  });

  it('responder com tcheka: autocolante, «Respondeu com uma tcheka» e avisos a quem comentou e ao dono', async () => {
    const { rxa, rxb, rxc } = u;
    const orig = await tcheka(rxa, 'comenta aqui');
    const c = (await api().post(`/api/v1/posts/${orig.id}/comments`).set(auth(rxb)).send({ body: 'faz um tutorial!' }).expect(201)).body;
    expect(c.canRemix).toBe(true);
    expect(c.tchekaReplies).toBeNull();
    // O estúdio lê o comentário para o autocolante.
    const one = (await api().get(`/api/v1/comments/${c.id}`).set(auth(rxc)).expect(200)).body;
    expect(one).toMatchObject({ id: c.id, postId: orig.id, body: 'faz um tutorial!', author: { username: rxb.username, hasAvatar: false }, canRemix: true });

    const reply = (await publish(rxc, { postId: orig.id, kind: 'reply', commentId: c.id, sticker: { x: 0.2, y: 0.3 } }, 201)).body;
    expect(reply.remixOf).toMatchObject({ postId: orig.id, kind: 'reply', commentId: c.id, available: true, comment: { id: c.id, body: 'faz um tutorial!', author: { username: rxb.username } } });
    expect(reply.remixOf.sticker.x).toBeCloseTo(0.2);
    expect(reply.remixOf.sticker.y).toBeCloseTo(0.3);

    // No comentário: «Respondeu com uma tcheka», que leva à tcheka.
    const listed = (await api().get(`/api/v1/posts/${orig.id}/comments`).set(auth(rxa)).expect(200)).body.items.find((x: { id: string }) => x.id === c.id);
    expect(listed.tchekaReplies).toEqual({ count: 1, postId: reply.id });

    // Avisa quem escreveu o comentário e o dono da publicação (duas linhas, papéis diferentes).
    expect((await notes(rxb)).find((x) => x.kind === 'remix' && x.data.postId === reply.id)).toMatchObject({ data: { remixKind: 'reply', role: 'comment', commentId: c.id } });
    expect((await notes(rxa)).find((x) => x.kind === 'remix' && x.data.postId === reply.id)).toMatchObject({ data: { remixKind: 'reply', role: 'post', commentId: c.id } });

    // A resposta também entra em «Duetos e respostas» do original.
    expect((await api().get(`/api/v1/posts/${orig.id}/remixes?kind=reply`).set(auth(rxa)).expect(200)).body.items.map((p: { id: string }) => p.id)).toEqual([reply.id]);

    // Um comentário de outra publicação não serve.
    const other = await tcheka(rxa, 'outra');
    await publish(rxc, { postId: other.id, kind: 'reply', commentId: c.id }, 404);

    // Quem escreveu o comentário desligou: já não se responde com tcheka a esse comentário.
    await privacy(rxb, { remixAllowed: false });
    expect((await api().get(`/api/v1/comments/${c.id}`).set(auth(rxc)).expect(200)).body.canRemix).toBe(false);
    await publish(rxc, { postId: orig.id, kind: 'reply', commentId: c.id }, 403);
    await privacy(rxb, { remixAllowed: true });

    // Apagado o comentário, a tcheka fica, sem o autocolante.
    await api().delete(`/api/v1/comments/${c.id}`).set(auth(rxb)).expect(200);
    const after = (await api().get(`/api/v1/posts/${reply.id}`).set(auth(rxc)).expect(200)).body;
    expect(after.remixOf).toMatchObject({ kind: 'reply', commentId: null, comment: null, available: true });
  });

  it('a categoria «Duetos e respostas» desligada: sem aviso', async () => {
    const { rxa, rxb } = u;
    const settings = (await api().get('/api/v1/notifications/settings').set(auth(rxa)).expect(200)).body;
    expect(settings.categories).toContain('remixes');
    await api().put('/api/v1/notifications/settings').set(auth(rxa)).send({ off: ['remixes'] }).expect((r) => expect([200, 204]).toContain(r.status));
    const orig = await tcheka(rxa, 'sem aviso');
    const duet = (await publish(rxb, { postId: orig.id, kind: 'duet' }, 201)).body;
    await new Promise((r) => setTimeout(r, 150));
    expect((await notes(rxa)).some((x) => x.kind === 'remix' && x.data.postId === duet.id)).toBe(false);
    await api().put('/api/v1/notifications/settings').set(auth(rxa)).send({ off: [] });
  });

  it('original apagado: o dueto fica, a ligação diz que já não está disponível', async () => {
    const { rxa, rxb } = u;
    const orig = await tcheka(rxa, 'vai sair');
    const duet = (await publish(rxb, { postId: orig.id, kind: 'duet' }, 201)).body;
    await api().delete(`/api/v1/posts/${orig.id}`).set(auth(rxa)).expect(204);
    const after = (await api().get(`/api/v1/posts/${duet.id}`).set(auth(rxb)).expect(200)).body;
    expect(after.remixOf).toMatchObject({ postId: orig.id, kind: 'duet', available: false, author: null });
    await api().get(`/api/v1/posts/${orig.id}/remixes`).set(auth(rxb)).expect(404);
    // Não se faz remix do que já não existe, nem como um local.
    await publish(rxb, { postId: orig.id, kind: 'duet' }, 404);
  });

  it('dueto sem música escolhida fica com o som do original; com música escolhida, fica a escolhida', async () => {
    const { rxa, rxb } = u;
    // A faixa como fica guardada numa publicação (do catálogo antigo, que continua a valer).
    const track = { id: `cc-${run}`, title: 'Marrabenta', artist: 'Teste', url: 'https://example.com/a.mp3', license: 'cc-by', licenseUrl: null, landing: null, cover: null, durationMs: 30000 };
    const orig = await tcheka(rxa, 'com som');
    await pool.query('UPDATE content.posts SET music = $2 WHERE id = $1', [orig.id, JSON.stringify(track)]);
    const duet = (await publish(rxb, { postId: orig.id, kind: 'duet' }, 201)).body;
    expect(duet.music?.title).toBe('Marrabenta');
    // «Sem som do original»: a app manda music: null.
    const silent = (await publish(rxb, { postId: orig.id, kind: 'duet' }, 201, { music: null })).body;
    expect(silent.music ?? null).toBeNull();
    // Uma resposta não herda a música da publicação.
    const c = (await api().post(`/api/v1/posts/${orig.id}/comments`).set(auth(rxb)).send({ body: 'que som!' }).expect(201)).body;
    expect((await publish(rxb, { postId: orig.id, kind: 'reply', commentId: c.id }, 201)).body.music ?? null).toBeNull();
    // O clipe de áudio próprio do autor nunca passa para o dueto de outra pessoa.
    await pool.query(`UPDATE content.posts SET music = '{"kind":"clip","mediaId":"00000000-0000-0000-0000-000000000000","durationMs":1000,"title":"meu"}' WHERE id = $1`, [orig.id]);
    expect((await publish(rxb, { postId: orig.id, kind: 'duet' }, 201)).body.music ?? null).toBeNull();
  });
});
