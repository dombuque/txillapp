import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { badge } from './badge';

/**
 * «Em todo o sítio uma conta verificada deve vir com selo»: cada DTO que traz o nome ou o @ de uma pessoa traz também
 * `verified` e `verifiedTier`, com os mesmos nomes dos posts e do perfil. A pessoa verificada (vip) é a conta oficial
 * (tier 'official'); quem não é verificado vem com `verified: false, verifiedTier: null`.
 */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const VIP = { verified: true, verifiedTier: 'official' };
const NONE = { verified: false, verifiedTier: null };

interface U { token: string; id: string; username: string }
type Row = { username: string; verified?: boolean; verifiedTier?: string | null };

describe('selo de verificado em todos os DTOs com pessoas (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  const u: Record<string, U> = {};
  const find = <T extends Row>(rows: T[], who: U) => rows.find((r) => r.username === who.username);

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  async function photo(x: U): Promise<string> {
    const up = await api().post('/api/v1/media/uploads').set(auth(x)).send({ mime: 'image/png', size: PNG.length }).expect(201);
    await api().put(up.body.uploadUrl).set('Content-Type', 'image/png').send(PNG).expect(200);
    return up.body.assetId as string;
  }
  /** O Zás usa fotos do chat, já fechadas. */
  async function chatPhoto(x: U): Promise<string> {
    const up = await api().post('/api/v1/media/uploads').set(auth(x)).send({ mime: 'image/png', size: PNG.length, purpose: 'chat' }).expect(201);
    await api().put(up.body.uploadUrl).set('Content-Type', 'image/png').send(PNG).expect(200);
    await api().post(`/api/v1/media/${up.body.assetId}/complete`).set(auth(x)).send({}).expect(200);
    return up.body.assetId as string;
  }
  const follow = (a: U, b: U) => api().post(`/api/v1/users/${b.username}/follow`).set(auth(a)).expect(200);
  // A foto primeiro: um pedido criado antes de outro terminar perde o servidor de testes do supertest.
  const story = async (x: U) => { const mediaId = await photo(x); return (await api().post('/api/v1/stories').set(auth(x)).send({ mediaId, caption: 'mimo' }).expect(201)).body as { id: string }; };

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'd'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    for (const n of ['sla', 'slv', 'slc', 'sld', 'slp']) u[n] = await signup(n);
    // slv é a conta oficial (selo coral); os outros não têm selo.
    await pool.query(`UPDATE identity.users SET verified = true, verified_at = now(), verified_tier = 'official' WHERE id = $1`, [u.slv.id]);
    const { sla, slv, slc } = u;
    await follow(sla, slv); await follow(slv, sla);
    await follow(sla, slc); await follow(slc, sla);
    await follow(slv, slc); await follow(slc, slv);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('badge(): o mesmo par dos posts (verified boolean, verifiedTier ou null)', () => {
    expect(badge(true, 'official')).toEqual(VIP);
    expect(badge(true, null)).toEqual({ verified: true, verifiedTier: null });
    expect(badge(false, null)).toEqual(NONE);
    expect(badge(undefined, undefined)).toEqual(NONE);
  });

  it('mimos: bandeja, visor, quem viu, comentários, respostas, amigos próximos e escondidos', async () => {
    const { sla, slv, slc } = u;
    const sv = await story(slv);
    // A bandeja do Início e o cabeçalho do visor.
    const tray = (await api().get('/api/v1/stories').set(auth(sla)).expect(200)).body as Row[];
    expect(find(tray, slv)).toMatchObject(VIP);
    const of = (await api().get(`/api/v1/stories/user/${slv.username}`).set(auth(sla)).expect(200)).body as { author: Row }[];
    expect(of[0].author).toMatchObject({ username: slv.username, ...VIP });
    // Comentários: o do vip com selo, o do outro sem.
    await api().post(`/api/v1/stories/${sv.id}/comments`).set(auth(slv)).send({ body: 'o meu' }).expect(201);
    await api().post(`/api/v1/stories/${sv.id}/comments`).set(auth(slc)).send({ body: 'o teu' }).expect(201);
    const cm = (await api().get(`/api/v1/stories/${sv.id}/comments`).set(auth(sla)).expect(200)).body as { author: Row }[];
    expect(cm.find((c) => c.author.username === slv.username)!.author).toMatchObject(VIP);
    expect(cm.find((c) => c.author.username === slc.username)!.author).toMatchObject(NONE);
    // Quem viu e as respostas (só o autor vê).
    const sa = await story(sla);
    await api().post(`/api/v1/stories/${sa.id}/view`).set(auth(slv)).expect(204);
    await api().post(`/api/v1/stories/${sa.id}/view`).set(auth(slc)).expect(204);
    const viewers = (await api().get(`/api/v1/stories/${sa.id}/viewers`).set(auth(sla)).expect(200)).body as Row[];
    expect(find(viewers, slv)).toMatchObject(VIP);
    expect(find(viewers, slc)).toMatchObject(NONE);
    await api().post(`/api/v1/stories/${sa.id}/replies`).set(auth(slv)).send({ body: 'Que vista!' }).expect(201);
    const replies = (await api().get(`/api/v1/stories/${sa.id}/replies`).set(auth(sla)).expect(200)).body as { author: Row }[];
    expect(replies[0].author).toMatchObject({ username: slv.username, ...VIP });
    // Amigos próximos e a quem escondo os mimos.
    await api().put(`/api/v1/stories/close-friends/${slv.username}`).set(auth(sla)).expect(204);
    expect(find((await api().get('/api/v1/stories/close-friends').set(auth(sla)).expect(200)).body as Row[], slv)).toMatchObject(VIP);
    await api().put(`/api/v1/stories/hidden/${slv.username}`).set(auth(sla)).expect(200);
    expect(find((await api().get('/api/v1/stories/settings').set(auth(sla)).expect(200)).body.hidden as Row[], slv)).toMatchObject(VIP);
    await api().delete(`/api/v1/stories/hidden/${slv.username}`).set(auth(sla)).expect(200);
  });

  it('pessoas: seguidores, a seguir, pedidos, bloqueados, menções e pesquisa', async () => {
    const { sla, slv, slc, sld, slp } = u;
    const followers = (await api().get(`/api/v1/users/${sla.username}/followers`).set(auth(sla)).expect(200)).body.items as Row[];
    expect(find(followers, slv)).toMatchObject(VIP);
    expect(find(followers, slc)).toMatchObject(NONE);
    const following = (await api().get(`/api/v1/users/${sla.username}/following`).set(auth(sla)).expect(200)).body.items as Row[];
    expect(find(following, slv)).toMatchObject(VIP);
    // Pedidos para seguir (conta privada).
    await pool.query('UPDATE identity.users SET is_private = true WHERE id = $1', [slp.id]);
    await api().post(`/api/v1/users/${slp.username}/follow`).set(auth(slv)).expect(200);
    expect(find((await api().get('/api/v1/follow-requests').set(auth(slp)).expect(200)).body as Row[], slv)).toMatchObject(VIP);
    // Bloqueados.
    await api().put(`/api/v1/blocks/${slv.username}`).set(auth(sld)).expect(200);
    expect(find((await api().get('/api/v1/blocks').set(auth(sld)).expect(200)).body as Row[], slv)).toMatchObject(VIP);
    // Menções ao escrever @ (as duas listas) e a pesquisa.
    expect(find((await api().get(`/api/v1/mentionable?q=${slv.username}`).set(auth(sla)).expect(200)).body as Row[], slv)).toMatchObject(VIP);
    const sug = (await api().get(`/api/v1/mentions/suggest?q=${slv.username}&context=post`).set(auth(sla)).expect(200)).body.items as Row[];
    expect(find(sug, slv)).toMatchObject(VIP);
    const found = (await api().get(`/api/v1/search?q=${slv.username}`).set(auth(sla)).expect(200)).body.people as Row[];
    expect(find(found, slv)).toMatchObject(VIP);
    const quick = (await api().get(`/api/v1/search/suggest?q=${slv.username}`).set(auth(sla)).expect(200)).body.people as Row[];
    expect(find(quick, slv)).toMatchObject(VIP);
  });

  it('notificações: quem fez a ação traz o selo', async () => {
    const { sla, slv, slc } = u;
    const items = (await api().get('/api/v1/notifications').set(auth(sla)).expect(200)).body.items as { kind: string; actor: Row }[];
    expect(items.find((n) => n.kind === 'follow' && n.actor.username === slv.username)!.actor).toMatchObject(VIP);
    expect(items.find((n) => n.kind === 'follow' && n.actor.username === slc.username)!.actor).toMatchObject(NONE);
  });

  it('mensagens: lista, cabeçalho, grupos (lista, membros, quem enviou) e notas', async () => {
    const { sla, slv, slc } = u;
    await api().post(`/api/v1/chat/with/${sla.username}`).set(auth(slv)).send({ body: 'olá' }).expect(201);
    const list = (await api().get('/api/v1/chat/conversations').set(auth(sla)).expect(200)).body as Row[];
    expect(find(list, slv)).toMatchObject(VIP);
    expect((await api().get(`/api/v1/chat/with/${slv.username}`).set(auth(sla)).expect(200)).body.person).toMatchObject({ username: slv.username, ...VIP });
    const g = (await api().post('/api/v1/chat/groups').set(auth(sla)).send({ name: `Selo ${run}`, members: [slv.username, slc.username] }).expect(201)).body.id as string;
    await api().post(`/api/v1/chat/groups/${g}/messages`).set(auth(slv)).send({ body: 'no grupo' }).expect(201);
    const groups = (await api().get('/api/v1/chat/groups').set(auth(sla)).expect(200)).body as { id: string; preview: Row[] }[];
    expect(find(groups.find((x) => x.id === g)!.preview, slv)).toMatchObject(VIP);
    const t = (await api().get(`/api/v1/chat/groups/${g}`).set(auth(sla)).expect(200)).body as { group: { members: Row[] }; items: { body: string; sender: Row }[] };
    expect(find(t.group.members, slv)).toMatchObject(VIP);
    expect(find(t.group.members, slc)).toMatchObject(NONE);
    expect(t.items.find((m) => m.body === 'no grupo')!.sender).toMatchObject({ username: slv.username, ...VIP });
    // Notas (por cima das conversas).
    await api().put('/api/v1/notes/me').set(auth(slv)).send({ body: 'bora praia' }).expect(204);
    const notes = (await api().get('/api/v1/notes').set(auth(sla)).expect(200)).body as { items: Row[] };
    expect(find(notes.items, slv)).toMatchObject(VIP);
  });

  it('publicações: identificações nas fotos e quem brindou', async () => {
    const { sla, slv } = u;
    const media = await photo(sla);
    const p = (await api().post('/api/v1/posts').set(auth(sla)).send({ body: 'praia', mediaIds: [media], tags: [{ index: 0, username: slv.username, x: 0.4, y: 0.5 }] }).expect(201)).body as { id: string };
    const post = (await api().get(`/api/v1/posts/${p.id}`).set(auth(sla)).expect(200)).body as { media: { tags: Row[] }[] };
    expect(post.media[0].tags[0]).toMatchObject({ username: slv.username, ...VIP });
    await api().post(`/api/v1/posts/${p.id}/cheers`).set(auth(slv)).expect((r) => expect([200, 201]).toContain(r.status));
    expect(find((await api().get(`/api/v1/posts/${p.id}/people/cheers`).set(auth(sla)).expect(200)).body as Row[], slv)).toMatchObject(VIP);
  });

  it('chamadas: o ecrã (quem atende) e o histórico', async () => {
    const { sla, slv } = u;
    const c = (await api().post('/api/v1/calls').set(auth(sla)).send({ username: slv.username, video: false }).expect(201)).body as { id: string; peer: Row };
    expect(c.peer).toMatchObject({ username: slv.username, ...VIP });
    await api().post(`/api/v1/calls/${c.id}/end`).set(auth(sla)).expect(200);
    const h = (await api().get('/api/v1/calls').set(auth(sla)).expect(200)).body.items as { peer: Row }[];
    expect(h.find((x) => x.peer.username === slv.username)!.peer).toMatchObject(VIP);
  });

  it('convites: o cartão e a página /c/[code]', async () => {
    const { slv, slc } = u;
    const me = (await api().get('/api/v1/invites/me').set(auth(slv)).expect(200)).body as { code: string; card: Row };
    expect(me.card).toMatchObject({ username: slv.username, ...VIP });
    expect((await api().get(`/api/v1/invites/preview/${me.code}`).expect(200)).body).toMatchObject({ username: slv.username, ...VIP });
    const other = (await api().get('/api/v1/invites/me').set(auth(slc)).expect(200)).body as { code: string; card: Row };
    expect(other.card).toMatchObject(NONE);
  });

  it('carteira: o histórico diz de quem veio, com selo', async () => {
    const { sla, slv } = u;
    // As duas carteiras abertas (quem envia e quem recebe).
    await api().get('/api/v1/wallet').set(auth(sla)).expect(200);
    await api().get('/api/v1/wallet').set(auth(slv)).expect(200);
    await api().post('/api/v1/wallet/transfers').set(auth(slv)).set('Idempotency-Key', `selo-${run}`).send({ toUsername: sla.username, amount: 5 }).expect(201);
    const w = (await api().get('/api/v1/wallet').set(auth(sla)).expect(200)).body as { history: { counterparty: Row | null }[] };
    expect(w.history.find((h) => h.counterparty?.username === slv.username)!.counterparty).toMatchObject(VIP);
  });

  it('Zás: a faixa e quem viu', async () => {
    const { sla, slv } = u;
    const zv = await chatPhoto(slv);
    await api().post('/api/v1/instants').set(auth(slv)).send({ mediaId: zv, caption: 'zás' }).expect(201);
    expect(find((await api().get('/api/v1/instants').set(auth(sla)).expect(200)).body.others as Row[], slv)).toMatchObject(VIP);
    const za = await chatPhoto(sla);
    const mine = (await api().post('/api/v1/instants').set(auth(sla)).send({ mediaId: za, caption: 'meu' }).expect(201)).body as { id: string };
    await api().post(`/api/v1/instants/${mine.id}/view`).set(auth(slv)).expect((r) => expect([200, 201, 204]).toContain(r.status));
    expect(find((await api().get(`/api/v1/instants/${mine.id}/viewers`).set(auth(sla)).expect(200)).body as Row[], slv)).toMatchObject(VIP);
  });
});
