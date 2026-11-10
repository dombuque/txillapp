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

interface U { token: string; id: string; username: string }
type Notif = { kind: string; data: Record<string, unknown>; actor: { username: string } };

/** Limites e casos de borda dos TxillGroups vistos de fora (o caminho principal está em public-groups.e2e.spec.ts). */
describe('TxillGroups vistos de fora: grupo cheio, limites de pedidos, admins que mudam e preferências (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  let ana: U, beto: U, cris: U, ze: U, rui: U;
  const g = (id: string, path = '') => `/api/v1/chat/groups/${id}${path}`;

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  const resetThrottle = () => {
    const s = app.get(getStorageToken()) as { storage: Map<string, unknown>; hitExpirations?: Map<string, unknown> };
    s.storage.clear();
    s.hitExpirations?.clear();
  };
  const notifs = async (x: U) => (await api().get('/api/v1/notifications').set(auth(x)).expect(200)).body.items as Notif[];
  const requests = async (x: U, id: string) => (await api().get(g(id, '/join-requests')).set(auth(x)).expect(200)).body as { username: string }[];
  const count = async (id: string) => (await pool.query('SELECT count(*)::int AS n FROM social.group_members WHERE group_id = $1', [id])).rows[0].n as number;

  /** Grupo da Ana (admin) com o Beto e a Cris; privado oculto por omissão, já com um ponto no mapa (0104: visível precisa de sítio). */
  const newGroup = async (name: string) => {
    const id = (await api().post('/api/v1/chat/groups').set(auth(ana)).send({ name, members: [beto.username, cris.username] }).expect(201)).body.id as string;
    await api().patch(g(id)).set(auth(ana)).send({ mapPlace: { lat: -40.5, lng: -120.5 } }).expect(204);
    return id;
  };

  /** Enche o grupo com contas de enchimento (inseridas direto na base, sem passar pelo registo com limite) até `n` membros. */
  async function fillTo(id: string, n: number) {
    const missing = n - (await count(id));
    for (let i = 0; i < missing; i++) {
      const u = `pgf${run}${i}${Math.random().toString(36).slice(2, 6)}`.slice(0, 28);
      const uid = (await pool.query(`INSERT INTO identity.users (id, email, username, display_name) VALUES (gen_random_uuid(), $1, $2, 'Enchimento') RETURNING id`, [`${u}@example.com`, u])).rows[0].id;
      await pool.query('INSERT INTO social.group_members (group_id, user_id) VALUES ($1, $2)', [id, uid]);
    }
  }
  const dropFiller = (id: string) =>
    pool.query(`DELETE FROM social.group_members WHERE ctid IN (SELECT m.ctid FROM social.group_members m JOIN identity.users u ON u.id = m.user_id WHERE m.group_id = $1 AND u.display_name = 'Enchimento' LIMIT 1)`, [id]);

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'p'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    ana = await signup('pla');
    beto = await signup('plb');
    cris = await signup('plc');
    ze = await signup('plz');
    rui = await signup('plr');
    const ids = [ana, beto, cris].map((u) => u.id);
    for (const a of ids) for (const b of ids) if (a !== b) await pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [a, b]);
  }, 60_000);

  beforeEach(() => resetThrottle());

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('validação: id inválido dá 400; pessoa sem pedido dá 404; showOnMap tem de ser booleano', async () => {
    const id = await newGroup('Validação');
    await api().post('/api/v1/chat/groups/nao-e-um-id/join-requests').set(auth(ze)).expect(400);
    await api().delete('/api/v1/chat/groups/nao-e-um-id/join-requests/me').set(auth(ze)).expect(400);
    await api().get('/api/v1/chat/groups/nao-e-um-id/join-requests').set(auth(ana)).expect((r) => expect([400, 404]).toContain(r.status));
    await api().get(g('00000000-0000-0000-0000-000000000000', '/public')).set(auth(ze)).expect(404);
    await api().post(g('00000000-0000-0000-0000-000000000000', '/join-requests')).set(auth(ze)).expect(404);
    await api().patch(g(id)).set(auth(ana)).send({ showOnMap: 'sim' }).expect(400);
    await api().patch(g(id)).set(auth(ana)).send({ showOnMap: true }).expect(204);
    await api().post(g(id, '/join-requests/ninguem-assim/accept')).set(auth(ana)).expect(404);
    await api().post(g(id, `/join-requests/${ze.username}/decline`)).set(auth(ana)).expect(404);
    // Sem sessão não há nada.
    await api().get(g(id, '/public')).expect(401);
    await api().post(g(id, '/join-requests')).expect(401);
  });

  it('grupo cheio (50): não se pede, não se entra no público e não se aceita; o pedido fica à espera', async () => {
    const id = await newGroup('Cheio');
    await api().patch(g(id)).set(auth(ana)).send({ showOnMap: true }).expect(204);
    await fillTo(id, 50);
    expect(await count(id)).toBe(50);
    expect((await api().post(g(id, '/join-requests')).set(auth(ze)).expect(409)).body.message).toMatch(/cheio/);
    await api().patch(g(id)).set(auth(ana)).send({ visibility: 'public' }).expect(204);
    expect((await api().post(g(id, '/join-requests')).set(auth(ze)).expect(409)).body.message).toMatch(/cheio/);
    expect(await count(id)).toBe(50);

    // Abre um lugar, o Zé pede (privado no mapa), o lugar volta a ser ocupado: aceitar dá 409 e o pedido fica.
    await api().patch(g(id)).set(auth(ana)).send({ visibility: 'private' }).expect(204);
    await api().patch(g(id)).set(auth(ana)).send({ showOnMap: true }).expect(204);
    await dropFiller(id);
    await api().post(g(id, '/join-requests')).set(auth(ze)).expect(201);
    await fillTo(id, 50);
    await api().post(g(id, `/join-requests/${ze.username}/accept`)).set(auth(ana)).expect(409);
    expect((await requests(ana, id)).map((r) => r.username)).toEqual([ze.username]);
    expect(await count(id)).toBe(50);
    await api().get(g(id)).set(auth(ze)).expect(404);
  });

  it('limite: no máximo 20 pedidos por hora a POST join-requests (429 depois)', async () => {
    const id = await newGroup('Limite');
    await api().patch(g(id)).set(auth(ana)).send({ showOnMap: true }).expect(204);
    for (let i = 0; i < 20; i++) await api().post(g(id, '/join-requests')).set(auth(rui)).expect((r) => expect([200, 201]).toContain(r.status));
    await api().post(g(id, '/join-requests')).set(auth(rui)).expect(429);
    // Só houve um pedido e um aviso, apesar das repetições.
    expect(await requests(ana, id)).toHaveLength(1);
    expect((await notifs(ana)).filter((n) => n.kind === 'group_join_request' && n.data.groupId === id)).toHaveLength(1);
    resetThrottle();
    await api().delete(g(id, '/join-requests/me')).set(auth(rui)).expect(204);
  });

  it('o admin adiciona diretamente quem estava à espera: o pedido e o aviso desaparecem', async () => {
    const id = await newGroup('Adicionado');
    await api().patch(g(id)).set(auth(ana)).send({ showOnMap: true }).expect(204);
    await api().post(g(id, '/join-requests')).set(auth(ze)).expect(201);
    await api().post(g(id, '/members')).set(auth(ana)).send({ members: [ze.username] }).expect((r) => expect(r.status).toBeLessThan(300));
    expect((await api().get(g(id)).set(auth(ze)).expect(200)).body.group.myRole).toBe('member');
    expect(await requests(ana, id)).toEqual([]);
    expect((await notifs(ana)).filter((n) => n.kind === 'group_join_request' && n.data.groupId === id)).toEqual([]);
    expect((await api().get(g(id, '/public')).set(auth(ze)).expect(200)).body.me).toBe('member');
  });

  it('o admin sai: o novo admin vê e aceita os pedidos; o antigo deixa de os ver', async () => {
    const id = await newGroup('Troca de admin');
    await api().patch(g(id)).set(auth(ana)).send({ showOnMap: true }).expect(204);
    await api().post(g(id, '/join-requests')).set(auth(rui)).expect(201);
    await api().delete(g(id, `/members/${ana.username}`)).set(auth(ana)).expect(204);
    await api().get(g(id, '/join-requests')).set(auth(ana)).expect(404);
    const admin = (await api().get(g(id)).set(auth(beto)).expect(200)).body.group.myRole === 'admin' ? beto : cris;
    expect((await requests(admin, id)).map((r) => r.username)).toEqual([rui.username]);
    expect((await api().post(g(id, `/join-requests/${rui.username}/accept`)).set(auth(admin)).expect(200)).body).toEqual({ status: 'member' });
  });

  it('o grupo desaparece quando todos saem: os pedidos vão com ele', async () => {
    const id = await newGroup('Vai fechar');
    await api().patch(g(id)).set(auth(ana)).send({ showOnMap: true }).expect(204);
    await api().post(g(id, '/join-requests')).set(auth(ze)).expect(201);
    for (const x of [ana, beto, cris]) await api().delete(g(id, `/members/${x.username}`)).set(auth(x)).expect(204);
    expect((await pool.query('SELECT count(*)::int AS n FROM social.groups WHERE id = $1', [id])).rows[0].n).toBe(0);
    expect((await pool.query('SELECT count(*)::int AS n FROM social.group_join_requests WHERE group_id = $1', [id])).rows[0].n).toBe(0);
    await api().get(g(id, '/public')).set(auth(ze)).expect(404);
    await api().post(g(id, '/join-requests')).set(auth(ze)).expect(404);
  });

  it('conta suspensa: o pedido deixa de aparecer ao admin e não se pode aceitar', async () => {
    const id = await newGroup('Suspensa');
    await api().patch(g(id)).set(auth(ana)).send({ showOnMap: true }).expect(204);
    const sus = await signup('pls');
    await api().post(g(id, '/join-requests')).set(auth(sus)).expect(201);
    await pool.query(`UPDATE identity.users SET status = 'suspended' WHERE id = $1`, [sus.id]);
    expect(await requests(ana, id)).toEqual([]);
    await api().post(g(id, `/join-requests/${sus.username}/accept`)).set(auth(ana)).expect(404);
    expect(await count(id)).toBe(3);
  });

  it('notificações de "mensagens" desligadas: o pedido para entrar continua na lista; "entrou" não aparece', async () => {
    await api().put('/api/v1/notifications/settings').set(auth(ana)).send({ off: ['messages'] }).expect(204);
    const pedir = await newGroup('Prefs pedir');
    await api().patch(g(pedir)).set(auth(ana)).send({ showOnMap: true }).expect(204);
    await api().post(g(pedir, '/join-requests')).set(auth(ze)).expect(201);
    const aberto = await newGroup('Prefs aberto');
    await api().patch(g(aberto)).set(auth(ana)).send({ visibility: 'public' }).expect(204);
    await api().post(g(aberto, '/join-requests')).set(auth(rui)).expect(200);
    const mine = await notifs(ana);
    expect(mine.filter((n) => n.kind === 'group_join_request' && n.data.groupId === pedir)).toHaveLength(1);
    expect(mine.filter((n) => n.kind === 'group_member_joined' && n.data.groupId === aberto)).toEqual([]);
    await api().put('/api/v1/notifications/settings').set(auth(ana)).send({ off: [] }).expect(204);
  });
});
