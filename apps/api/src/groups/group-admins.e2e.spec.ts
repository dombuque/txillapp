import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { getStorageToken } from '@nestjs/throttler';
import request from 'supertest';
import { Pool } from 'pg';
import { ChatEvents } from '../chat/chat.events';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';

interface U { token: string; id: string; username: string }
type Notif = { kind: string; data: Record<string, unknown>; actor: { username: string } };

/**
 * TxillGroups: bloqueios com qualquer membro (vistos de fora), "entrou" sem spam, limite de 50 atómico
 * e atribuir/retirar administrador (PATCH /chat/groups/:id/members/:username).
 */
describe('TxillGroups: bloqueios com membros, avisos sem spam, limite atómico e administradores (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  const C = { lat: Math.round((-55 + Math.random() * 30) * 100) / 100, lng: Math.round((-150 + Math.random() * 40) * 100) / 100 };
  let ana: U, beto: U, cris: U, ze: U, rui: U, bloq: U;
  let venueSlug: string;
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
  const block = (a: U, b: U) => pool.query('INSERT INTO social.blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [a.id, b.id]);
  const unblock = (a: U, b: U) => pool.query('DELETE FROM social.blocks WHERE blocker_id = $1 AND blocked_id = $2', [a.id, b.id]);
  const notifs = async (x: U) => (await api().get('/api/v1/notifications').set(auth(x)).expect(200)).body.items as Notif[];
  const requests = async (x: U, id: string) => (await api().get(g(id, '/join-requests')).set(auth(x)).expect(200)).body as { username: string }[];
  const count = async (id: string) => (await pool.query('SELECT count(*)::int AS n FROM social.group_members WHERE group_id = $1', [id])).rows[0].n as number;
  const nearbyIds = async (x: U) => ((await api().get(`/api/v1/nearby?lat=${C.lat}&lng=${C.lng}&kinds=groups`).set(auth(x)).expect(200)).body.groups as { id: string }[]).map((r) => r.id);
  const members = async (x: U, id: string) => (await api().get(g(id)).set(auth(x)).expect(200)).body.group.members as { username: string; role: string }[];
  const roleOf = async (id: string, x: U) => (await members(ana, id).catch(() => members(beto, id))).find((m) => m.username === x.username)?.role;
  const setRole = (by: U, id: string, who: U | string, role: unknown) => api().patch(g(id, `/members/${typeof who === 'string' ? who : who.username}`)).set(auth(by)).send({ role });

  /** Grupo da Ana (admin) com o Beto e a Cris, com o plano num local aprovado perto de C. */
  async function newGroup(name: string, opts: { visibility?: 'public'; showOnMap?: boolean } = {}) {
    const id = (await api().post('/api/v1/chat/groups').set(auth(ana)).send({ name, members: [beto.username, cris.username] }).expect(201)).body.id as string;
    await api().patch(g(id, '/plan')).set(auth(ana)).send({ destination: 'Costa do Sol', venueSlug, startsOn: '2099-12-20', endsOn: '2099-12-21' }).expect(200);
    if (opts.visibility || opts.showOnMap) await api().patch(g(id)).set(auth(ana)).send(opts).expect(204);
    return id;
  }

  /** Enche o grupo com contas inseridas direto na base até `n` membros. */
  async function fillTo(id: string, n: number) {
    const missing = n - (await count(id));
    for (let i = 0; i < missing; i++) {
      const u = `gaf${run}${i}${Math.random().toString(36).slice(2, 6)}`.slice(0, 28);
      const uid = (await pool.query(`INSERT INTO identity.users (id, email, username, display_name) VALUES (gen_random_uuid(), $1, $2, 'Enchimento') RETURNING id`, [`${u}@example.com`, u])).rows[0].id;
      await pool.query('INSERT INTO social.group_members (group_id, user_id) VALUES ($1, $2)', [id, uid]);
    }
  }

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'p'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    ana = await signup('gaa');
    beto = await signup('gab');
    cris = await signup('gac');
    ze = await signup('gaz');
    rui = await signup('gar');
    bloq = await signup('gak');
    const ids = [ana, beto, cris].map((u) => u.id);
    for (const a of ids) for (const b of ids) if (a !== b) await pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [a, b]);
    venueSlug = `t-ga-${run}`;
    await pool.query(
      `INSERT INTO content.venues (id, slug, name, kind, lat, lng, owner_id, check_token, review_status) VALUES (gen_random_uuid(), $1, $2, 'bar', $3, $4, $5, 'x', 'approved')`,
      [venueSlug, `Barraca GA ${run}`, Math.round((C.lat + 0.01) * 1000) / 1000, C.lng, ana.id],
    );
  }, 60_000);

  beforeEach(() => resetThrottle());

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  /* ───────── 1. bloqueio com QUALQUER membro ───────── */

  it('bloqueio com um membro (não admin), nos dois sentidos: não vê o grupo, não entra, não o encontra no mapa', async () => {
    const id = await newGroup('Bloqueio membro', { visibility: 'public' });
    expect(await nearbyIds(bloq)).toContain(id);
    await api().get(g(id, '/public')).set(auth(bloq)).expect(200);

    await block(cris, bloq);
    await api().get(g(id, '/public')).set(auth(bloq)).expect(404);
    await api().post(g(id, '/join-requests')).set(auth(bloq)).expect(404);
    expect(await nearbyIds(bloq)).not.toContain(id);
    await unblock(cris, bloq);

    await block(bloq, beto);
    await api().get(g(id, '/public')).set(auth(bloq)).expect(404);
    await api().post(g(id, '/join-requests')).set(auth(bloq)).expect(404);
    expect(await nearbyIds(bloq)).not.toContain(id);
    await unblock(bloq, beto);

    // Sem bloqueios volta tudo; e quem não tem nada a ver continua a ver.
    expect(await nearbyIds(bloq)).toContain(id);
    await api().get(g(id, '/public')).set(auth(ze)).expect(200);
    expect(await count(id)).toBe(3);
  });

  it('privado no mapa: um pedido de quem depois bloqueia um membro some da lista, do pendingRequests e não se aceita', async () => {
    const id = await newGroup('Bloqueio pedido', { showOnMap: true });
    await api().post(g(id, '/join-requests')).set(auth(bloq)).expect(201);
    expect((await requests(ana, id)).map((r) => r.username)).toEqual([bloq.username]);
    const pending = async () => ((await api().get('/api/v1/chat/groups').set(auth(ana)).expect(200)).body as { id: string; pendingRequests: number }[]).find((r) => r.id === id)!.pendingRequests;
    expect(await pending()).toBe(1);
    expect((await api().get(g(id)).set(auth(ana)).expect(200)).body.group.pendingRequests).toBe(1);

    await block(bloq, cris);
    expect(await requests(ana, id)).toEqual([]);
    expect(await pending()).toBe(0);
    expect((await api().get(g(id)).set(auth(ana)).expect(200)).body.group.pendingRequests).toBe(0);
    await api().post(g(id, `/join-requests/${bloq.username}/accept`)).set(auth(ana)).expect(404);
    // Quem bloqueou também deixa de ver o grupo e de pedir.
    await api().get(g(id, '/public')).set(auth(bloq)).expect(404);
    await api().post(g(id, '/join-requests')).set(auth(bloq)).expect(404);
    expect(await count(id)).toBe(3);

    await unblock(bloq, cris);
    expect((await api().post(g(id, `/join-requests/${bloq.username}/accept`)).set(auth(ana)).expect(200)).body).toEqual({ status: 'member' });
    // Já é membro: vê sempre, mesmo que surja um bloqueio com outro membro.
    await block(beto, bloq);
    expect((await api().get(g(id, '/public')).set(auth(bloq)).expect(200)).body.me).toBe('member');
    await unblock(beto, bloq);
  });

  it('o criador conta igual em todo o lado, mesmo depois de sair do grupo', async () => {
    const id = await newGroup('Criador saiu', { visibility: 'public' });
    await api().delete(g(id, `/members/${ana.username}`)).set(auth(ana)).expect(204);
    await block(ana, bloq);
    await api().get(g(id, '/public')).set(auth(bloq)).expect(404);
    await api().post(g(id, '/join-requests')).set(auth(bloq)).expect(404);
    expect(await nearbyIds(bloq)).not.toContain(id);
    await unblock(ana, bloq);
    await api().get(g(id, '/public')).set(auth(bloq)).expect(200);
    expect(await nearbyIds(bloq)).toContain(id);
  });

  /* ───────── 2. "entrou" sem spam ───────── */

  it('group_member_joined: sair e voltar a entrar não repete o aviso em 24 h; depois disso volta a avisar', async () => {
    const id = await newGroup('Entra e sai', { visibility: 'public' });
    const joined = async (x: U, who: U) => (await notifs(x)).filter((n) => n.kind === 'group_member_joined' && n.data.groupId === id && n.actor.username === who.username);
    for (let i = 0; i < 3; i++) {
      expect((await api().post(g(id, '/join-requests')).set(auth(ze)).expect(200)).body).toEqual({ status: 'member' });
      await api().delete(g(id, `/members/${ze.username}`)).set(auth(ze)).expect(204);
    }
    expect(await joined(ana, ze)).toHaveLength(1);
    // Outra pessoa tem o seu próprio aviso.
    await api().post(g(id, '/join-requests')).set(auth(rui)).expect(200);
    expect(await joined(ana, rui)).toHaveLength(1);
    // Lido também conta (a janela é de 24 h): marcar como lido não reabre o spam.
    await pool.query(`UPDATE social.notifications SET read_at = now() WHERE user_id = $1`, [ana.id]);
    await api().post(g(id, '/join-requests')).set(auth(ze)).expect(200);
    await api().delete(g(id, `/members/${ze.username}`)).set(auth(ze)).expect(204);
    expect(await joined(ana, ze)).toHaveLength(1);
    // Passadas 24 h, volta a avisar.
    await pool.query(`UPDATE social.notifications SET created_at = now() - interval '25 hours' WHERE user_id = $1 AND kind = 'group_member_joined' AND data->>'groupId' = $2`, [ana.id, id]);
    await api().post(g(id, '/join-requests')).set(auth(ze)).expect(200);
    expect(await joined(ana, ze)).toHaveLength(2);
    // Um segundo admin também é avisado (uma vez).
    await setRole(ana, id, beto, 'admin').expect(200);
    await api().delete(g(id, `/members/${ze.username}`)).set(auth(ze)).expect(204);
    await api().post(g(id, '/join-requests')).set(auth(ze)).expect(200);
    await api().delete(g(id, `/members/${ze.username}`)).set(auth(ze)).expect(204);
    await api().post(g(id, '/join-requests')).set(auth(ze)).expect(200);
    expect(await joined(beto, ze)).toHaveLength(1);
    expect(await joined(ana, ze)).toHaveLength(2);
  });

  /* ───────── 3. limite de 50 atómico ───────── */

  it('público a 49: vários a entrar ao mesmo tempo, só 1 entra e o grupo fica com 50', async () => {
    const id = await newGroup('Corrida pública', { visibility: 'public' });
    await fillTo(id, 49);
    const racers = await Promise.all(['gr1', 'gr2', 'gr3', 'gr4', 'gr5', 'gr6'].map((n) => signup(n)));
    resetThrottle();
    const res = await Promise.all(racers.map((x) => api().post(g(id, '/join-requests')).set(auth(x))));
    const codes = res.map((r) => r.status).sort();
    expect(codes.filter((c) => c === 200)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(racers.length - 1);
    expect(await count(id)).toBe(50);
  }, 60_000);

  it('privado no mapa a 49: aceitar vários pedidos ao mesmo tempo só deixa entrar 1; os outros ficam à espera', async () => {
    const id = await newGroup('Corrida pedidos', { showOnMap: true });
    const askers = await Promise.all(['gq1', 'gq2', 'gq3', 'gq4'].map((n) => signup(n)));
    for (const x of askers) await api().post(g(id, '/join-requests')).set(auth(x)).expect(201);
    await fillTo(id, 49);
    const res = await Promise.all(askers.map((x) => api().post(g(id, `/join-requests/${x.username}/accept`)).set(auth(ana))));
    expect(res.filter((r) => r.status === 200)).toHaveLength(1);
    expect(res.filter((r) => r.status === 409)).toHaveLength(askers.length - 1);
    expect(await count(id)).toBe(50);
    expect(await requests(ana, id)).toHaveLength(askers.length - 1);
  }, 60_000);

  it('adicionar membros e entrar ao mesmo tempo também não passa de 50', async () => {
    const id = await newGroup('Corrida mista', { visibility: 'public' });
    await fillTo(id, 49);
    await Promise.all([
      api().post(g(id, '/members')).set(auth(ana)).send({ members: [ze.username] }),
      api().post(g(id, '/join-requests')).set(auth(rui)),
    ]);
    expect(await count(id)).toBe(50);
  });

  /* ───────── 4. atribuir administrador ───────── */

  it('PATCH members/:username: só admins; dar e tirar admin; idempotente; nunca sem admin', async () => {
    const id = await newGroup('Admins');
    const ev = app.get(ChatEvents);
    const spy = jest.spyOn(ev, 'emit');
    try {
      // Validação e permissões.
      await setRole(ana, id, beto, 'dono').expect(400);
      await setRole(ana, id, beto, undefined).expect(400);
      await setRole(beto, id, cris, 'admin').expect(403);
      await setRole(ze, id, beto, 'admin').expect(404);
      await setRole(ana, id, ze, 'admin').expect(404);
      await setRole(ana, id, 'ninguem-assim', 'admin').expect(404);
      await api().patch('/api/v1/chat/groups/nao-e-um-id/members/x').set(auth(ana)).send({ role: 'admin' }).expect(400);
      await api().patch(g(id, `/members/${beto.username}`)).send({ role: 'admin' }).expect(401);
      expect(await roleOf(id, beto)).toBe('member');

      // A Ana faz o Beto admin (aceita @ e maiúsculas): 200 { username, role }.
      spy.mockClear();
      const r = await setRole(ana, id, `@${beto.username.toUpperCase()}`, 'admin').expect(200);
      expect(r.body).toEqual({ username: beto.username, role: 'admin' });
      expect(await roleOf(id, beto)).toBe('admin');
      // Aviso em tempo real a todos os membros (também à Ana, para os outros ecrãs dela).
      for (const x of [ana, beto, cris]) expect(spy).toHaveBeenCalledWith(x.id, { type: 'group', groupId: id, what: 'info' });
      const granted = (await notifs(beto)).filter((n) => n.kind === 'group_admin_granted' && n.data.groupId === id);
      expect(granted).toHaveLength(1);
      expect(granted[0]).toMatchObject({ kind: 'group_admin_granted', data: { groupId: id, groupName: 'Admins' }, actor: { username: ana.username } });

      // Idempotente: 200, sem avisos nem notificação nova.
      spy.mockClear();
      expect((await setRole(ana, id, beto, 'admin').expect(200)).body).toEqual({ username: beto.username, role: 'admin' });
      expect(spy).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'group', what: 'info' }));
      expect((await notifs(beto)).filter((n) => n.kind === 'group_admin_granted' && n.data.groupId === id)).toHaveLength(1);
      expect((await setRole(ana, id, cris, 'member').expect(200)).body).toEqual({ username: cris.username, role: 'member' });

      // O Beto (admin) já pode fazer coisas de admin e tira o papel à Ana: retirar não notifica.
      await api().patch(g(id)).set(auth(beto)).send({ description: 'Agora mando eu' }).expect(204);
      spy.mockClear();
      expect((await setRole(beto, id, ana, 'member').expect(200)).body).toEqual({ username: ana.username, role: 'member' });
      expect(spy).toHaveBeenCalledWith(ana.id, { type: 'group', groupId: id, what: 'info' });
      expect((await notifs(ana)).filter((n) => n.kind === 'group_admin_granted' && n.data.groupId === id)).toEqual([]);
      expect((await api().get(g(id)).set(auth(ana)).expect(200)).body.group.myRole).toBe('member');
      await setRole(ana, id, beto, 'member').expect(403);

      // O último admin não se pode retirar: 409 e continua admin.
      const last = await setRole(beto, id, beto, 'member').expect(409);
      expect(last.body.message).toBe('O grupo precisa de pelo menos um administrador');
      expect(await roleOf(id, beto)).toBe('admin');

      // Com outro admin, pode retirar-se a si próprio.
      await setRole(beto, id, cris, 'admin').expect(200);
      expect((await setRole(beto, id, beto, 'member').expect(200)).body).toEqual({ username: beto.username, role: 'member' });
      const list = await members(cris, id);
      expect(list.every((m) => m.role === 'admin' || m.role === 'member')).toBe(true);
      expect(list.filter((m) => m.role === 'admin').map((m) => m.username)).toEqual([cris.username]);
      // Os admins aparecem primeiro na lista de membros.
      expect(list[0]).toMatchObject({ username: cris.username, role: 'admin' });
    } finally {
      spy.mockRestore();
    }
  });

  it('dois admins a retirarem-se ao mesmo tempo: só um consegue e o grupo fica com um admin', async () => {
    const id = await newGroup('Admins em corrida');
    await setRole(ana, id, beto, 'admin').expect(200);
    const res = await Promise.all([setRole(ana, id, ana, 'member'), setRole(beto, id, beto, 'member')]);
    expect(res.map((r) => r.status).sort()).toEqual([200, 409]);
    const admins = (await pool.query(`SELECT count(*)::int AS n FROM social.group_members WHERE group_id = $1 AND role = 'admin'`, [id])).rows[0].n;
    expect(admins).toBe(1);
  });

  it('o admin promovido vê e aceita pedidos; quem perdeu o papel deixa de os ver', async () => {
    const id = await newGroup('Pedidos e admins', { showOnMap: true });
    await api().post(g(id, '/join-requests')).set(auth(rui)).expect(201);
    await api().get(g(id, '/join-requests')).set(auth(cris)).expect(403);
    await setRole(ana, id, cris, 'admin').expect(200);
    expect((await requests(cris, id)).map((r) => r.username)).toEqual([rui.username]);
    await setRole(cris, id, ana, 'member').expect(200);
    await api().get(g(id, '/join-requests')).set(auth(ana)).expect(403);
    expect((await api().post(g(id, `/join-requests/${rui.username}/accept`)).set(auth(cris)).expect(200)).body).toEqual({ status: 'member' });
  });
});
