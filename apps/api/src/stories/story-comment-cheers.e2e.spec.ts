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
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

interface U { token: string; id: string; username: string }
interface Item { id: string; kind: string; read: boolean; data: Record<string, unknown>; actor: { username: string }; thumb: { url: string } | null; cheer?: { count: number; actors: { username: string }[] } }

/** Brindar os comentários dos mimos (0161): POST /stories/comments/:id/cheer alterna, conta, avisa juntado e sai com tudo. */
describe('brindar os comentários dos mimos (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  const u: Record<string, U> = {};
  const keys = webpush.generateVAPIDKeys();
  const sent: { userId: string; p: PushPayload }[] = [];

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  async function newStory(x: U) {
    const up = await api().post('/api/v1/media/uploads').set(auth(x)).send({ mime: 'image/png', size: PNG.length }).expect(201);
    await api().put(up.body.uploadUrl).set('Content-Type', 'image/png').send(PNG).expect(200);
    const s = (await api().post('/api/v1/stories').set(auth(x)).send({ mediaId: up.body.assetId, caption: 'mimo' }).expect(201)).body;
    return { id: s.id as string, mediaId: up.body.assetId as string };
  }
  const comment = async (x: U, storyId: string, body: string) => (await api().post(`/api/v1/stories/${storyId}/comments`).set(auth(x)).send({ body }).expect(201)).body.id as string;
  const cheer = (x: U, commentId: string) => api().post(`/api/v1/stories/comments/${commentId}/cheer`).set(auth(x));
  const comments = async (x: U, storyId: string) => (await api().get(`/api/v1/stories/${storyId}/comments`).set(auth(x)).expect(200)).body as { id: string; cheers: number; cheered: boolean }[];
  const notices = async (x: U, commentId: string) =>
    ((await api().get('/api/v1/notifications').set(auth(x)).expect(200)).body.items as Item[]).filter((n) => n.kind === 'cheer' && n.data.targetId === commentId);
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
      loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 's'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test', VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey }),
    );
    await app.init();
    jest.spyOn(app.get(PushService), 'send').mockImplementation(async (userId: string, p: PushPayload) => {
      sent.push({ userId, p });
      return 1;
    });
    for (const n of ['sma', 'smb', 'smc', 'smd', 'sme', 'smp']) u[n] = await signup(n);
  }, 90_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
    jest.restoreAllMocks();
  });

  it('brindar e tirar: a contagem e o meu estado na lista; o autor do comentário é avisado uma vez, juntado, com o mimo', async () => {
    const { sma, smb, smc, smd } = u;
    const s = await newStory(sma);
    const c = await comment(smb, s.id, 'Que mimo!');
    expect((await comments(smc, s.id)).find((x) => x.id === c)).toMatchObject({ cheers: 0, cheered: false });

    expect((await cheer(smc, c).expect(200)).body).toEqual({ cheered: true, cheers: 1 });
    expect((await cheer(smd, c).expect(200)).body).toEqual({ cheered: true, cheers: 2 });
    expect((await comments(smc, s.id)).find((x) => x.id === c)).toMatchObject({ cheers: 2, cheered: true });
    expect((await comments(sma, s.id)).find((x) => x.id === c)).toMatchObject({ cheers: 2, cheered: false });

    // Um só aviso, juntado: quem brindou por último à frente, os dois a contar, a miniatura do mimo e o destino.
    await settle();
    const n = await notices(smb, c);
    expect(n).toHaveLength(1);
    expect(n[0].actor.username).toBe(smd.username);
    expect(n[0].cheer?.count).toBe(2);
    expect(n[0].data).toMatchObject({ target: 'story_comment', targetId: c, storyId: s.id, commentId: c, storyAuthor: sma.username, mediaId: s.mediaId });
    expect(n[0].thumb?.url).toBe(`/api/v1/media/${s.mediaId}`);
    const p = sent.filter((x) => x.userId === smb.id);
    expect(p[0].p).toMatchObject({ body: 'brindou o teu comentário no mimo', url: `/stories/${sma.username}?m=${s.mediaId}&comments=1`, tag: `cheer:${c}`, category: 'reactions' });

    // Tirar: a contagem desce; voltar a pôr não avisa outra vez.
    expect((await cheer(smc, c).expect(200)).body).toEqual({ cheered: false, cheers: 1 });
    expect((await notices(smb, c))[0].cheer?.count).toBe(1);
    expect((await cheer(smc, c).expect(200)).body).toEqual({ cheered: true, cheers: 2 });
    expect((await pool.query(`SELECT count(*)::int AS n FROM social.cheer_notices WHERE kind = 'story_comment' AND target_id = $1`, [c])).rows[0].n).toBe(2);

    // O próprio autor brinda o seu comentário: conta, sem aviso.
    expect((await cheer(smb, c).expect(200)).body.cheers).toBe(3);
    expect((await notices(smb, c))[0].actor.username).toBe(smd.username);
    await api().post(`/api/v1/stories/comments/${c}/cheer`).expect(401);
  });

  it('permissões: quem não vê o mimo, quem tem bloqueio com quem comentou e quem denunciou o comentário não brindam', async () => {
    const { sma, smb, smc, sme, smp } = u;
    const s = await newStory(sma);
    const c = await comment(smb, s.id, 'Bloqueia-me se fores capaz');
    // Bloqueio entre quem brinda e quem comentou: 404 (não o vê na lista).
    await api().put(`/api/v1/blocks/${smb.username}`).set(auth(sme)).expect((r) => expect([200, 204]).toContain(r.status));
    expect((await comments(sme, s.id)).some((x) => x.id === c)).toBe(false);
    await cheer(sme, c).expect(404);
    // Conta privada a fazer o mimo: quem não segue não vê o mimo.
    await pool.query('UPDATE identity.users SET is_private = true WHERE id = $1', [smp.id]);
    const ps = await newStory(smp);
    const pc = await comment(smp, ps.id, 'Só para os meus');
    await cheer(smc, pc).expect(404);
    // Denunciei o comentário: sai da minha lista e já não o brindo.
    await api().post('/api/v1/reports').set(auth(smc)).send({ type: 'story_comment', id: c, reason: 'spam' }).expect(204);
    await cheer(smc, c).expect(404);
    // Mimo expirado: já não se brinda.
    const c2 = await comment(smb, s.id, 'Até amanhã');
    await pool.query(`UPDATE content.stories SET expires_at = now() - interval '1 minute' WHERE id = $1`, [s.id]);
    await cheer(sma, c2).expect(404);
    await cheer(smc, '11111111-1111-4111-8111-111111111111').expect(404);
  });

  it('com a categoria «Reações» desligada ou com bloqueio depois do brinde, não há aviso', async () => {
    const { sma, smb, smd } = u;
    const s = await newStory(sma);
    const c = await comment(smb, s.id, 'Shiu');
    await api().put('/api/v1/notifications/settings').set(auth(smb)).send({ off: ['reactions'] }).expect(204);
    await cheer(smd, c).expect(200);
    expect(await notices(smb, c)).toHaveLength(0);
    await api().put('/api/v1/notifications/settings').set(auth(smb)).send({ off: [] }).expect(204);
  });

  it('apaga-se com o comentário, com o mimo e com a conta; vai na exportação', async () => {
    const { sma, smb, smc, smd } = u;
    const s = await newStory(sma);
    const c1 = await comment(smb, s.id, 'Um');
    const c2 = await comment(smb, s.id, 'Dois');
    await cheer(smc, c1).expect(200);
    await cheer(smc, c2).expect(200);
    await cheer(smd, c2).expect(200);
    const rows = async (id: string) => (await pool.query('SELECT count(*)::int AS n FROM content.story_comment_cheers WHERE comment_id = $1', [id])).rows[0].n as number;
    const ex = (await api().get('/api/v1/me/export').set(auth(smc)).expect(200)).body;
    expect(ex.storyCommentCheers.map((x: { commentId: string }) => x.commentId)).toEqual(expect.arrayContaining([c1, c2]));
    // Apagar o comentário (o dono do mimo pode).
    await api().delete(`/api/v1/stories/comments/${c1}`).set(auth(sma)).expect(204);
    expect(await rows(c1)).toBe(0);
    // Apagar a conta de quem brindou: os brindes dela saem, os dos outros ficam.
    await api().post('/api/v1/auth/delete-account').set(auth(smd)).send({ confirmUsername: smd.username, password: PASSWORD }).expect(204);
    expect(await rows(c2)).toBe(1);
    // Apagar o mimo: os comentários e os brindes vão com ele.
    await api().delete(`/api/v1/stories/${s.id}`).set(auth(sma)).expect((r) => expect([200, 204]).toContain(r.status));
    expect(await rows(c2)).toBe(0);
  });
});
