import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { ChatEvents } from '../chat/chat.events';
import { NotificationsService } from '../notifications/notifications.service';
import { pushEndpointOk } from '../push/push.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

interface U { token: string; id: string; username: string; ip: string }

/**
 * Auditoria de segurança (bloqueios, privacidade e abusos): comentários e avisos com bloqueio, localização em direto e
 * chamadas que acabam ao bloquear, presença de contas privadas, «a escrever» só em publicações que se veem, grupos com
 * pessoas que se bloquearam, subscrições Web Push só de serviços conhecidos, publicações como local sem o gestor à vista,
 * mimos partilhados de quem passou a privado e respostas às notas com as regras das contas novas em revisão.
 */
describe('segurança: bloqueios, privacidade e abusos (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  let events: ChatEvents;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}`, 'X-Forwarded-For': x.ip });
  let n = 0;

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    n++;
    const ip = `10.183.${n >> 8}.${n & 255}`;
    const r = await api().post('/api/v1/auth/register').set('X-Forwarded-For', ip)
      .send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
    return { token: r.body.accessToken, id: r.body.user.id, username, ip };
  }
  const block = (a: U, b: U) => api().put(`/api/v1/blocks/${b.username}`).set(auth(a)).expect(200);
  const followDb = (a: U, b: U) => pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [a.id, b.id]);
  async function uploadPng(a: U) {
    const r = await api().post('/api/v1/media/uploads').set(auth(a)).send({ mime: 'image/png', size: PNG.length }).expect(201);
    await api().put(r.body.uploadUrl).set('Content-Type', 'image/png').send(PNG).expect(200);
    return r.body.assetId as string;
  }

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 's'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    events = app.get(ChatEvents);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('comentários: com um bloqueio, não se veem os do outro, não se lhe responde e ele não é avisado; os de contas suspensas saem', async () => {
    const [dono, a, b, d] = [await signup('cmdono'), await signup('cma'), await signup('cmb'), await signup('cmd')];
    const post = (await api().post('/api/v1/posts').set(auth(dono)).send({ body: `publicação ${run}` }).expect(201)).body;
    const cb = (await api().post(`/api/v1/posts/${post.id}/comments`).set(auth(b)).send({ body: 'comentário da b' }).expect(201)).body;
    const cd = (await api().post(`/api/v1/posts/${post.id}/comments`).set(auth(d)).send({ body: 'comentário da d' }).expect(201)).body;
    const list = async (x: U) => ((await api().get(`/api/v1/posts/${post.id}/comments`).set(auth(x)).expect(200)).body.items as { id: string }[]).map((c) => c.id);
    expect(await list(a)).toEqual(expect.arrayContaining([cb.id, cd.id]));

    await block(b, a);
    expect(await list(a)).not.toContain(cb.id);
    expect(await list(dono)).toContain(cb.id); // quem não tem bloqueio continua a ver
    // Responder a um comentário de quem me bloqueou: como se não existisse.
    await api().post(`/api/v1/posts/${post.id}/comments`).set(auth(a)).send({ body: 'olá b', parentId: cb.id }).expect(400);
    // As respostas também não: a resposta da b a um comentário da d não aparece à a.
    const rb = (await api().post(`/api/v1/posts/${post.id}/comments`).set(auth(b)).send({ body: 'resposta da b', parentId: cd.id }).expect(201)).body;
    expect(((await api().get(`/api/v1/comments/${cd.id}/replies`).set(auth(a)).expect(200)).body.items as { id: string }[]).map((c) => c.id)).not.toContain(rb.id);

    // Nenhum aviso (nem no telemóvel) com um bloqueio entre as duas pessoas, tirando o «bloqueou-te».
    const before = (await pool.query('SELECT count(*)::int AS n FROM social.notifications WHERE user_id = $1 AND actor_id = $2', [b.id, a.id])).rows[0].n as number;
    await app.get(NotificationsService).notify({ userId: b.id, actorId: a.id, kind: 'reply', data: { postId: post.id } });
    expect((await pool.query('SELECT count(*)::int AS n FROM social.notifications WHERE user_id = $1 AND actor_id = $2', [b.id, a.id])).rows[0].n).toBe(before);
    const blockedNotice = (await pool.query(`SELECT count(*)::int AS n FROM social.notifications WHERE user_id = $1 AND actor_id = $2 AND kind = 'blocked'`, [a.id, b.id])).rows[0].n;
    expect(blockedNotice).toBe(1);

    await pool.query(`UPDATE identity.users SET status = 'suspended' WHERE id = $1`, [d.id]);
    expect(await list(dono)).not.toContain(cd.id);
    await pool.query(`UPDATE identity.users SET status = 'active' WHERE id = $1`, [d.id]);
  });

  it('bloquear acaba a localização em direto entre os dois (a posição apaga-se) e a chamada a tocar', async () => {
    const [a, b] = [await signup('lva'), await signup('lvb')];
    const sent = (await api().post(`/api/v1/chat/with/${b.username}`).set(auth(a)).send({ kind: 'location', body: 'Em direto', lat: -25.97, lng: 32.57, liveMinutes: 480 }).expect(201)).body.id as string;
    await api().put(`/api/v1/chat/messages/${sent}/location`).set(auth(a)).send({ lat: -25.98, lng: 32.58 }).expect(204);
    const call = (await pool.query(`INSERT INTO social.calls (id, caller_id, callee_id) VALUES (gen_random_uuid(), $1, $2) RETURNING id`, [a.id, b.id])).rows[0].id as string;

    await block(b, a);
    const m = (await pool.query('SELECT lat, lng, live_until <= now() AS ended FROM social.messages WHERE id = $1', [sent])).rows[0];
    expect(m).toEqual({ lat: null, lng: null, ended: true });
    // Quem partilhava já não consegue mandar a posição.
    await api().put(`/api/v1/chat/messages/${sent}/location`).set(auth(a)).send({ lat: -25.99, lng: 32.59 }).expect(404);
    expect((await pool.query('SELECT status, ended_at IS NOT NULL AS ended FROM social.calls WHERE id = $1', [call])).rows[0]).toEqual({ status: 'cancelled', ended: true });
    await api().post(`/api/v1/calls/${call}/accept`).set(auth(b)).expect((r) => expect(r.status).toBeGreaterThanOrEqual(400));
  });

  it('presença e «a escrever»: numa conta privada, só quem a segue (ou já conversa com ela) vê se está online', async () => {
    const [p, fan, stranger, chatter] = [await signup('prp'), await signup('prf'), await signup('prs'), await signup('prc')];
    await pool.query('UPDATE identity.users SET is_private = true WHERE id = $1', [p.id]);
    await followDb(fan, p);
    const online = async (viewer: U) => (await api().post('/api/v1/presence/online').set(auth(viewer)).send({ usernames: [p.username] }).expect(200)).body.online as string[];
    events.connect(p.id);
    try {
      expect(await online(fan)).toEqual([p.username]);
      expect(await online(stranger)).toEqual([]);
      expect((await api().get(`/api/v1/chat/with/${p.username}?read=0`).set(auth(stranger)).expect(200)).body.person.presence).toBeNull();
      expect((await api().get(`/api/v1/chat/with/${p.username}?read=0`).set(auth(fan)).expect(200)).body.person.presence).toMatchObject({ online: true });
      // Uma conversa que já existe (a pessoa privada escreveu-me) também conta.
      await api().post(`/api/v1/chat/with/${chatter.username}`).set(auth(p)).send({ body: 'olá' }).expect(201);
      expect(await online(chatter)).toEqual([p.username]);
    } finally {
      events.disconnect(p.id);
    }

    // «A escrever» num post da conta privada: quem não o vê não deixa sinal (nem lê os nomes).
    const post = (await api().post('/api/v1/posts').set(auth(p)).send({ body: `privado ${run}` }).expect(201)).body;
    const names = async (x: U) => (await api().get(`/api/v1/presence/typing?postId=${post.id}`).set(auth(x)).expect(200)).body.names as string[];
    await api().post('/api/v1/presence/typing').set(auth(stranger)).send({ postId: post.id }).expect(204);
    expect(await names(p)).toEqual([]);
    await api().post('/api/v1/presence/typing').set(auth(fan)).send({ postId: post.id }).expect(204);
    expect(await names(p)).toEqual(['prf']);
    expect(await names(stranger)).toEqual([]);
  });

  it('grupos: duas pessoas com um bloqueio entre elas não ficam no mesmo grupo (ao criar nem ao adicionar)', async () => {
    const [admin, a, v, x] = [await signup('gra'), await signup('grb'), await signup('grv'), await signup('grx')];
    await block(v, a);
    await api().post('/api/v1/chat/groups').set(auth(admin)).send({ name: 'Malta', members: [a.username, v.username] }).expect(403);
    const g = (await api().post('/api/v1/chat/groups').set(auth(admin)).send({ name: 'Malta', members: [a.username, x.username] }).expect(201)).body.id as string;
    await api().post(`/api/v1/chat/groups/${g}/members`).set(auth(admin)).send({ members: [v.username] }).expect(403);
    expect((await pool.query('SELECT count(*)::int AS n FROM social.group_members WHERE group_id = $1 AND user_id = $2', [g, v.id])).rows[0].n).toBe(0);
  });

  it('Web Push: só endpoints dos serviços de push conhecidos (nada de pedidos do servidor para a rede interna)', async () => {
    const u = await signup('wpu');
    const keys = { p256dh: 'p'.repeat(20), auth: 'a'.repeat(16) };
    for (const endpoint of ['https://10.0.0.5:8443/admin', 'https://localhost/x', 'http://fcm.googleapis.com/fcm/send/x', 'https://fcm.googleapis.com.evil.example/x', 'https://169.254.169.254/latest']) {
      await api().post('/api/v1/push/subscribe').set(auth(u)).send({ endpoint, keys }).expect(400);
    }
    expect(pushEndpointOk('https://fcm.googleapis.com/fcm/send/abc')).toBe(true);
    expect(pushEndpointOk('https://updates.push.services.mozilla.com/wpush/v2/abc')).toBe(true);
    expect(pushEndpointOk('https://web.push.apple.com/abc')).toBe(true);
    expect(pushEndpointOk('https://wns2-par02p.notify.windows.com/w/?token=abc')).toBe(true);
    expect(pushEndpointOk('https://fcm.googleapis.com:8443/x')).toBe(false);
    expect(pushEndpointOk('https://user:pw@fcm.googleapis.com/x')).toBe(false);
  });

  it('publicado como um local: a pré-visualização pública e a página partilhada mostram o local, nunca o gestor', async () => {
    const dono = await signup('vndono');
    const v = (await api().post('/api/v1/venues').set(auth(dono)).send({ name: `Barraca ${run}`, kind: 'bar', city: 'Maputo' }).expect(201)).body;
    await pool.query(`UPDATE content.venues SET review_status = 'approved' WHERE id = $1`, [v.id]);
    const post = (await api().post('/api/v1/posts').set(auth(dono)).send({ body: `gelada a 50 ${run}`, venueId: v.id }).expect(201)).body;
    const pub = (await api().get(`/api/v1/public/posts/${post.code}`).expect(200)).body;
    expect(pub.author).toMatchObject({ username: '', displayName: v.name, hasAvatar: false });
    expect(JSON.stringify(pub)).not.toContain(dono.username);
    const page = await api().get(`/api/v1/share/p/${post.code}`).expect(200);
    expect(page.text).toContain(`Barraca ${run} no Txillapp`);
    expect(page.text).not.toContain('vndono Teste');
  });

  it('mimo partilhado: se o autor da publicação passa a privado, a partilha deixa de aparecer a quem não o segue', async () => {
    const [autor, quem, viewer] = [await signup('shaut'), await signup('shquem'), await signup('shview')];
    const media = await uploadPng(autor);
    const post = (await api().post('/api/v1/posts').set(auth(autor)).send({ body: 'foto', mediaIds: [media] }).expect(201)).body;
    await api().post('/api/v1/stories/share').set(auth(quem)).send({ postId: post.id }).expect(201);
    await followDb(viewer, quem);
    const shared = async () => ((await api().get(`/api/v1/stories/user/${quem.username}`).set(auth(viewer)).expect(200)).body as { sharedFrom: unknown }[]).filter((s) => s.sharedFrom);
    expect(await shared()).toHaveLength(1);
    await pool.query('UPDATE identity.users SET is_private = true WHERE id = $1', [autor.id]);
    expect(await shared()).toHaveLength(0);
    await followDb(viewer, autor);
    expect(await shared()).toHaveLength(1); // quem segue o autor continua a ver
  });

  it('responder a uma nota segue as regras das contas novas em revisão (como escrever uma mensagem)', async () => {
    const [dona, sus] = [await signup('ntdona'), await signup('ntsus')];
    await followDb(sus, dona);
    await api().put('/api/v1/notes/me').set(auth(dona)).send({ body: 'quem vem à praia?' }).expect(204);
    await pool.query(
      `INSERT INTO security.account_risk (user_id, signals, state, limited_until) VALUES ($1, '{}', 'flagged', now() + interval '1 day')
       ON CONFLICT (user_id) DO UPDATE SET state = 'flagged', limited_until = now() + interval '1 day'`,
      [sus.id],
    );
    const r = await api().post(`/api/v1/notes/${dona.username}/reply`).set(auth(sus)).send({ text: 'eu!' }).expect(403);
    expect(r.body.code).toBe('risk_limited');
    await pool.query(`UPDATE security.account_risk SET state = 'cleared', limited_until = NULL WHERE user_id = $1`, [sus.id]);
    await api().post(`/api/v1/notes/${dona.username}/reply`).set(auth(sus)).send({ text: 'eu!' }).expect(201);
  });
});
