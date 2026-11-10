import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { getStorageToken } from '@nestjs/throttler';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

interface U { token: string; id: string; username: string }
type Notif = { kind: string; data: Record<string, unknown>; actor: { username: string } };

describe('TxillGroups vistos de fora: privado oculto, privado no mapa (pedir) e público (entrar logo) (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  // Um sítio ao calhas no meio do Pacífico Sul, para não chocar com dados de outras corridas.
  const C = { lat: Math.round((-55 + Math.random() * 30) * 100) / 100, lng: Math.round((-150 + Math.random() * 40) * 100) / 100 };
  let ana: U, beto: U, cris: U, ze: U, rui: U, lia: U, bloq: U;
  let venueSlug: string;
  let groupId: string;
  const g = (path = '', id = groupId) => `/api/v1/chat/groups/${id}${path}`;

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  async function upload(x: U): Promise<string> {
    const up = await api().post('/api/v1/media/uploads').set(auth(x)).send({ mime: 'image/png', size: PNG.length }).expect(201);
    await api().put(up.body.uploadUrl).set('Content-Type', 'image/png').send(PNG).expect(200);
    return up.body.assetId as string;
  }
  // Os limites de pedidos contam por IP e aqui é tudo do mesmo: começa-se cada teste do zero.
  const resetThrottle = () => {
    const s = app.get(getStorageToken()) as { storage: Map<string, unknown>; hitExpirations?: Map<string, unknown> };
    s.storage.clear();
    s.hitExpirations?.clear();
  };
  const block = (a: U, b: U) => pool.query('INSERT INTO social.blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [a.id, b.id]);
  const unblock = (a: U, b: U) => pool.query('DELETE FROM social.blocks WHERE blocker_id = $1 AND blocked_id = $2', [a.id, b.id]);
  const notifs = async (x: U) => (await api().get('/api/v1/notifications').set(auth(x)).expect(200)).body.items as Notif[];
  const row = async (x: U, id = groupId) => ((await api().get('/api/v1/chat/groups').set(auth(x)).expect(200)).body as { id: string }[]).find((r) => r.id === id) as Record<string, any>;
  const nearbyIds = async (x: U) => ((await api().get(`/api/v1/nearby?lat=${C.lat}&lng=${C.lng}&kinds=groups`).set(auth(x)).expect(200)).body.groups as { id: string }[]).map((r) => r.id);
  const nearbyGroup = async (x: U, id = groupId) => ((await api().get(`/api/v1/nearby?lat=${C.lat}&lng=${C.lng}&kinds=groups`).set(auth(x)).expect(200)).body.groups as Record<string, unknown>[]).find((r) => r.id === id);
  const requests = async (x: U, id = groupId) => (await api().get(g('/join-requests', id)).set(auth(x)).expect(200)).body as { username: string }[];

  /** Um grupo da Ana (admin) com o Beto e a Cris, com o plano num local aprovado perto de C. Começa privado e oculto. */
  async function newGroup(name: string) {
    const id = (await api().post('/api/v1/chat/groups').set(auth(ana)).send({ name, kind: 'festa', description: 'Kizomba até de manhã', members: [beto.username, cris.username] }).expect(201)).body.id as string;
    await api().patch(g('/plan', id)).set(auth(ana)).send({ destination: 'Costa do Sol', venueSlug, startsOn: '2099-12-20', endsOn: '2099-12-21' }).expect(200);
    return id;
  }

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'p'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    ana = await signup('pga');
    beto = await signup('pgb');
    cris = await signup('pgc');
    ze = await signup('pgz');
    rui = await signup('pgr');
    lia = await signup('pgl');
    bloq = await signup('pgk');
    const ids = [ana, beto, cris].map((u) => u.id);
    for (const a of ids) for (const b of ids) if (a !== b) await pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [a, b]);
    venueSlug = `t-pg-${run}`;
    await pool.query(
      `INSERT INTO content.venues (id, slug, name, kind, lat, lng, owner_id, check_token, review_status) VALUES (gen_random_uuid(), $1, $2, 'bar', $3, $4, $5, 'x', 'approved')`,
      [venueSlug, `Barraca PG ${run}`, Math.round((C.lat + 0.01) * 1000) / 1000, C.lng, ana.id],
    );
    groupId = await newGroup('Noite na Costa');
  }, 60_000);

  beforeEach(() => resetThrottle());

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('só admins mudam a visibilidade e o mapa; a lista e o grupo trazem os valores reais', async () => {
    // Por omissão: privado e fora do mapa.
    expect(await row(beto)).toMatchObject({ visibility: 'private', showOnMap: false, avatarUrl: null, pendingRequests: 0 });
    await api().patch(g()).set(auth(beto)).send({ visibility: 'public' }).expect(403);
    await api().patch(g()).set(auth(beto)).send({ showOnMap: true }).expect(403);
    await api().patch(g()).set(auth(ze)).send({ visibility: 'public' }).expect(404);
    await api().patch(g()).set(auth(ana)).send({ visibility: 'secreto' }).expect(400);
    await api().patch(g()).set(auth(ana)).send({ showOnMap: true }).expect(204);
    expect((await api().get(g()).set(auth(cris)).expect(200)).body.group).toMatchObject({ visibility: 'private', showOnMap: true, avatarUrl: null, pendingRequests: 0 });
    await api().patch(g()).set(auth(ana)).send({ visibility: 'public' }).expect(204);
    expect(await row(ana)).toMatchObject({ visibility: 'public', showOnMap: true, pendingRequests: 0 });
    // Público está sempre no mapa, mesmo com showOnMap guardado a false.
    await api().patch(g()).set(auth(ana)).send({ showOnMap: false }).expect(204);
    expect(await row(beto)).toMatchObject({ visibility: 'public', showOnMap: true });
    await api().patch(g()).set(auth(ana)).send({ visibility: 'private' }).expect(204);
    expect(await row(beto)).toMatchObject({ visibility: 'private', showOnMap: false });
  });

  it('privado oculto: /public dá 404, não se pode pedir e não aparece em À tua volta; os membros veem', async () => {
    await api().get(g('/public')).set(auth(ze)).expect(404);
    await api().post(g('/join-requests')).set(auth(ze)).expect(404);
    expect(await nearbyIds(ze)).not.toContain(groupId);
    const mine = (await api().get(g('/public')).set(auth(beto)).expect(200)).body;
    expect(mine).toMatchObject({ id: groupId, me: 'member', visibility: 'private', joinMode: 'request' });
    await api().get('/api/v1/chat/groups/nao-e-um-id/public').set(auth(ze)).expect(400);
  });

  it('privado no mapa: pedir, o admin vê e aceita, e a pessoa passa a membro com acesso às mensagens', async () => {
    await api().patch(g()).set(auth(ana)).send({ showOnMap: true }).expect(204);
    const pub = (await api().get(g('/public')).set(auth(ze)).expect(200)).body;
    expect(pub).toEqual({
      id: groupId, name: 'Noite na Costa', groupKind: 'festa', description: 'Kizomba até de manhã', coverUrl: null, avatarUrl: null,
      visibility: 'private', joinMode: 'request', destination: 'Costa do Sol', venueName: `Barraca PG ${run}`,
      startsOn: '2099-12-20', endsOn: '2099-12-21', members: 3, me: 'none',
    });
    expect(await nearbyGroup(ze)).toMatchObject({ id: groupId, visibility: 'private', joinMode: 'request', avatarUrl: null, members: 3 });

    // Quem não é membro continua sem ver as mensagens.
    await api().get(g()).set(auth(ze)).expect(404);
    expect((await api().post(g('/join-requests')).set(auth(ze)).expect(201)).body).toEqual({ status: 'pending' });
    // Idempotente: pedir outra vez não cria outro pedido nem outro aviso.
    expect((await api().post(g('/join-requests')).set(auth(ze)).expect(200)).body).toEqual({ status: 'pending' });
    expect((await api().get(g('/public')).set(auth(ze)).expect(200)).body.me).toBe('pending');

    expect(await row(ana)).toMatchObject({ pendingRequests: 1 });
    expect(await row(beto)).toMatchObject({ pendingRequests: 0 });
    expect((await api().get(g()).set(auth(ana)).expect(200)).body.group.pendingRequests).toBe(1);
    await api().get(g('/join-requests')).set(auth(beto)).expect(403);
    await api().get(g('/join-requests')).set(auth(ze)).expect(404);
    const list = await requests(ana);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ username: ze.username, displayName: 'pgz Teste', avatarUrl: null });
    expect(typeof (list[0] as unknown as { createdAt: string }).createdAt).toBe('string');

    // A Ana recebeu o aviso, com o grupo nos dados.
    const asked = (await notifs(ana)).filter((n) => n.kind === 'group_join_request' && n.data.groupId === groupId);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ data: { groupId, groupName: 'Noite na Costa' }, actor: { username: ze.username } });

    // Um membro que não administra não aceita.
    await api().post(g(`/join-requests/${ze.username}/accept`)).set(auth(beto)).expect(403);
    expect((await api().post(g(`/join-requests/${ze.username}/accept`)).set(auth(ana)).expect(200)).body).toEqual({ status: 'member' });
    await api().post(g(`/join-requests/${ze.username}/accept`)).set(auth(ana)).expect(404);

    const t = (await api().get(g()).set(auth(ze)).expect(200)).body;
    expect(t.group).toMatchObject({ myRole: 'member', pendingRequests: 0 });
    expect(t.group.members.map((m: { username: string }) => m.username)).toContain(ze.username);
    await api().post(g('/messages')).set(auth(ze)).send({ body: 'olá malta' }).expect(201);
    expect((await api().get(g()).set(auth(beto)).expect(200)).body.items[0]).toMatchObject({ body: 'olá malta', sender: { username: ze.username } });
    expect((await api().get(g('/public')).set(auth(ze)).expect(200)).body).toMatchObject({ me: 'member', members: 4 });

    // O Zé foi avisado; o aviso do pedido saiu da lista da Ana; o pedido já não está à espera.
    expect((await notifs(ze)).find((n) => n.kind === 'group_join_accepted')).toMatchObject({ data: { groupId, groupName: 'Noite na Costa' }, actor: { username: ana.username } });
    expect((await notifs(ana)).filter((n) => n.kind === 'group_join_request' && n.data.groupId === groupId)).toHaveLength(0);
    expect(await requests(ana)).toEqual([]);
    expect(await row(ana)).toMatchObject({ pendingRequests: 0 });

    // Já é membro: 409 com mensagem.
    const again = await api().post(g('/join-requests')).set(auth(ze)).expect(409);
    expect(typeof again.body.message).toBe('string');

    // Sair não cria pedido.
    await api().delete(g(`/members/${ze.username}`)).set(auth(ze)).expect(204);
    expect(await requests(ana)).toEqual([]);
    expect((await api().get(g('/public')).set(auth(ze)).expect(200)).body.me).toBe('none');
  });

  it('recusar (sem aviso) e cancelar o meu pedido', async () => {
    await api().post(g('/join-requests')).set(auth(rui)).expect(201);
    await api().post(g(`/join-requests/${rui.username}/decline`)).set(auth(beto)).expect(403);
    await api().post(g(`/join-requests/${rui.username}/decline`)).set(auth(ana)).expect(204);
    await api().post(g(`/join-requests/${rui.username}/decline`)).set(auth(ana)).expect(404);
    expect(await requests(ana)).toEqual([]);
    expect((await api().get(g('/public')).set(auth(rui)).expect(200)).body.me).toBe('none');
    expect((await notifs(rui)).filter((n) => n.kind.startsWith('group_'))).toEqual([]);
    await api().get(g()).set(auth(rui)).expect(404);

    // Pede outra vez e desiste.
    await api().post(g('/join-requests')).set(auth(rui)).expect(201);
    expect(await requests(ana)).toHaveLength(1);
    await api().delete(g('/join-requests/me')).set(auth(rui)).expect(204);
    await api().delete(g('/join-requests/me')).set(auth(rui)).expect(204);
    expect(await requests(ana)).toEqual([]);
    expect((await notifs(ana)).filter((n) => n.kind === 'group_join_request' && n.actor.username === rui.username)).toEqual([]);
    expect((await api().get(g('/public')).set(auth(rui)).expect(200)).body.me).toBe('none');
    await api().post(g(`/join-requests/${rui.username}/accept`)).set(auth(ana)).expect(404);
  });

  it('bloqueio com um admin: não vê o grupo, não pede e não o encontra no mapa', async () => {
    expect(await nearbyIds(bloq)).toContain(groupId);
    await block(ana, bloq);
    await api().get(g('/public')).set(auth(bloq)).expect(404);
    await api().post(g('/join-requests')).set(auth(bloq)).expect(404);
    expect(await nearbyIds(bloq)).not.toContain(groupId);
    await unblock(ana, bloq);
    // Também no outro sentido.
    await block(bloq, ana);
    await api().get(g('/public')).set(auth(bloq)).expect(404);
    await api().post(g('/join-requests')).set(auth(bloq)).expect(404);
    await unblock(bloq, ana);
    // Um pedido feito antes do bloqueio deixa de aparecer ao admin.
    await api().post(g('/join-requests')).set(auth(bloq)).expect(201);
    await block(ana, bloq);
    expect(await requests(ana)).toEqual([]);
    expect(await row(ana)).toMatchObject({ pendingRequests: 0 });
    await api().post(g(`/join-requests/${bloq.username}/accept`)).set(auth(ana)).expect(404);
    await unblock(ana, bloq);
    await api().delete(g('/join-requests/me')).set(auth(bloq)).expect(204);
  });

  it('privado no mapa mantém os pedidos; voltar a privado oculto apaga-os', async () => {
    await api().post(g('/join-requests')).set(auth(rui)).expect(201);
    await api().patch(g()).set(auth(ana)).send({ visibility: 'public' }).expect(204);
    await api().patch(g()).set(auth(ana)).send({ visibility: 'private', showOnMap: true }).expect(204);
    expect(await requests(ana)).toHaveLength(1);
    await api().patch(g()).set(auth(ana)).send({ name: 'Noite na Costa' }).expect(204);
    expect(await requests(ana)).toHaveLength(1);
    await api().patch(g()).set(auth(ana)).send({ showOnMap: false }).expect(204);
    expect(await requests(ana)).toEqual([]);
    expect(await row(ana)).toMatchObject({ pendingRequests: 0, visibility: 'private', showOnMap: false });
    expect((await pool.query('SELECT count(*)::int AS n FROM social.group_join_requests WHERE group_id = $1', [groupId])).rows[0].n).toBe(0);
    expect((await notifs(ana)).filter((n) => n.kind === 'group_join_request' && n.data.groupId === groupId)).toEqual([]);
    await api().get(g('/public')).set(auth(rui)).expect(404);
  });

  it('público: quem não é membro entra logo e os admins são avisados', async () => {
    await api().patch(g()).set(auth(ana)).send({ visibility: 'public' }).expect(204);
    expect((await api().get(g('/public')).set(auth(lia)).expect(200)).body).toMatchObject({ visibility: 'public', joinMode: 'open', me: 'none', members: 3 });
    expect(await nearbyGroup(lia)).toMatchObject({ id: groupId, visibility: 'public', joinMode: 'open' });
    expect((await api().post(g('/join-requests')).set(auth(lia)).expect(200)).body).toEqual({ status: 'member' });
    expect((await api().get(g()).set(auth(lia)).expect(200)).body.group).toMatchObject({ myRole: 'member' });
    await api().post(g('/messages')).set(auth(lia)).send({ body: 'cheguei' }).expect(201);
    expect((await api().get(g('/public')).set(auth(lia)).expect(200)).body).toMatchObject({ me: 'member', members: 4 });
    expect((await notifs(ana)).find((n) => n.kind === 'group_member_joined' && n.data.groupId === groupId)).toMatchObject({ data: { groupId, groupName: 'Noite na Costa' }, actor: { username: lia.username } });
    // Sem pedidos pelo caminho.
    expect(await requests(ana)).toEqual([]);
    await api().post(g('/join-requests')).set(auth(lia)).expect(409);
    // Mesmo público, um membro que não administra não muda nada.
    await api().patch(g()).set(auth(lia)).send({ visibility: 'private' }).expect(403);
  });

  it('público ou no mapa, quem não é membro continua sem mensagens, plano, sondagens, lista, despesas, álbum, cofre e membros', async () => {
    expect((await api().get(g('/public')).set(auth(rui)).expect(200)).body.visibility).toBe('public');
    await api().get(g()).set(auth(rui)).expect(404);
    await api().post(g('/messages')).set(auth(rui)).send({ body: 'entrei?' }).expect(404);
    await api().get(g('/plan')).set(auth(rui)).expect(404);
    await api().get(g('/album')).set(auth(rui)).expect(404);
    await api().get(g('/pot')).set(auth(rui)).expect(404);
    await api().post(g('/polls')).set(auth(rui)).send({ question: 'Vamos?', options: ['sim', 'não'] }).expect(404);
    await api().post(g('/checklist')).set(auth(rui)).send({ text: 'gelo' }).expect(404);
    await api().post(g('/expenses')).set(auth(rui)).send({ description: 'gelo', amountMzn: 100 }).expect(404);
    await api().post(g('/members')).set(auth(rui)).send({ members: [rui.username] }).expect(404);
    await api().get(g('/join-requests')).set(auth(rui)).expect(404);
    const pub = (await api().get(g('/public')).set(auth(rui)).expect(200)).body as Record<string, unknown>;
    expect(pub).not.toHaveProperty('items');
    expect(pub).not.toHaveProperty('pot');
    expect(typeof pub.members).toBe('number');
  });

  it('À tua volta: público e privado no mapa aparecem (com o modo de entrar); privado oculto não', async () => {
    const other = await newGroup('Sunset no Bilene');
    expect(await nearbyIds(rui)).not.toContain(other);
    await api().patch(g('', other)).set(auth(ana)).send({ showOnMap: true }).expect(204);
    expect(await nearbyGroup(rui, other)).toMatchObject({ id: other, name: 'Sunset no Bilene', kind: 'festa', visibility: 'private', joinMode: 'request', avatarUrl: null, coverUrl: null, destination: 'Costa do Sol', startsOn: '2099-12-20', members: 3 });
    await api().patch(g('', other)).set(auth(ana)).send({ visibility: 'public', showOnMap: false }).expect(204);
    expect(await nearbyGroup(rui, other)).toMatchObject({ id: other, visibility: 'public', joinMode: 'open' });
    await api().patch(g('', other)).set(auth(ana)).send({ visibility: 'private' }).expect(204);
    expect(await nearbyIds(rui)).not.toContain(other);
  });

  it('foto de perfil: como a capa (foto minha já carregada), só admins mudam, aparece na lista, em /public e no mapa', async () => {
    const foto = await upload(ana);
    const alheia = await upload(beto);
    await api().patch(g()).set(auth(beto)).send({ avatarMediaId: alheia }).expect(403);
    await api().patch(g()).set(auth(ana)).send({ avatarMediaId: alheia }).expect(400);
    await api().patch(g()).set(auth(ana)).send({ avatarMediaId: 'nao-e-uuid' }).expect(400);
    await api().patch(g()).set(auth(ana)).send({ avatarMediaId: foto }).expect(204);
    expect(await row(beto)).toMatchObject({ avatarUrl: `/api/v1/media/${foto}`, coverUrl: null });
    expect((await api().get(g()).set(auth(cris)).expect(200)).body.group.avatarUrl).toBe(`/api/v1/media/${foto}`);
    expect((await api().get(g('/public')).set(auth(rui)).expect(200)).body.avatarUrl).toBe(`/api/v1/media/${foto}`);
    expect(await nearbyGroup(rui)).toMatchObject({ avatarUrl: `/api/v1/media/${foto}` });
    await api().patch(g()).set(auth(ana)).send({ avatarMediaId: null }).expect(204);
    expect(await row(beto)).toMatchObject({ avatarUrl: null });

    // Também ao criar o grupo.
    const capa = await upload(ana);
    const outra = await upload(ana);
    const id = (await api().post('/api/v1/chat/groups').set(auth(ana)).send({ name: 'Com foto', members: [beto.username, cris.username], coverMediaId: capa, avatarMediaId: outra }).expect(201)).body.id as string;
    expect(await row(cris, id)).toMatchObject({ coverUrl: `/api/v1/media/${capa}`, avatarUrl: `/api/v1/media/${outra}` });
  });

  it('exportação de dados inclui os meus pedidos; eliminar a conta apaga-os', async () => {
    const id = await newGroup('Pedidos e conta');
    await api().patch(g('', id)).set(auth(ana)).send({ showOnMap: true }).expect(204);
    const sai = await signup('pgx');
    await api().post(g('/join-requests', id)).set(auth(sai)).expect(201);
    const exp = JSON.parse((await api().get('/api/v1/me/export').set(auth(sai)).expect(200)).text);
    expect(exp.groupJoinRequests).toEqual([expect.objectContaining({ group: 'Pedidos e conta' })]);
    await api().post('/api/v1/auth/delete-account').set(auth(sai)).send({ confirmUsername: sai.username, password: PASSWORD }).expect(204);
    expect((await pool.query('SELECT count(*)::int AS n FROM social.group_join_requests WHERE user_id = $1', [sai.id])).rows[0].n).toBe(0);
    expect(await requests(ana, id)).toEqual([]);
  });
});
