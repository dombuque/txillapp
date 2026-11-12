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

describe('brindar a geleira: contagem no perfil, quem brindou e aviso só da primeira vez (integração)', () => {
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
  const level = (viewer: U, of: U) => api().get(`/api/v1/users/${of.username}/geleira/level`).set(auth(viewer));
  const cheer = (viewer: U, of: U) => api().put(`/api/v1/users/${of.username}/geleira/cheer`).set(auth(viewer));
  const uncheer = (viewer: U, of: U) => api().delete(`/api/v1/users/${of.username}/geleira/cheer`).set(auth(viewer));
  const visibility = (x: U, v: string) => api().put('/api/v1/geleira/me/settings').set(auth(x)).send({ visibility: v }).expect(200);
  const notices = async (owner: U, actor: U) =>
    (await pool.query(`SELECT count(*)::int AS n FROM social.notifications WHERE user_id = $1 AND actor_id = $2 AND kind = 'geleira_cheer'`, [owner.id, actor.id])).rows[0].n as number;

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'h'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    for (const n of ['gca', 'gcb', 'gcc', 'gcd', 'gce']) u[n] = await signup(n);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('brindar e tirar: a contagem e o meu estado; repetir não duplica; o nível traz cheers/cheered certos', async () => {
    const { gca, gcb, gcc } = u;
    expect((await level(gca, gca).expect(200)).body).toMatchObject({ cheers: 0, cheered: false });
    expect((await level(gcb, gca).expect(200)).body).toMatchObject({ cheers: 0, cheered: false, level: 0, title: 'Geleira seca' });

    expect((await cheer(gcb, gca).expect(200)).body).toEqual({ cheered: true, cheers: 1 });
    expect((await cheer(gcb, gca).expect(200)).body).toEqual({ cheered: true, cheers: 1 }); // idempotente
    expect((await cheer(gcc, gca).expect(200)).body).toEqual({ cheered: true, cheers: 2 });

    expect((await level(gca, gca).expect(200)).body).toMatchObject({ cheers: 2, cheered: false }); // o dono vê o total
    expect((await level(gcb, gca).expect(200)).body).toMatchObject({ cheers: 2, cheered: true });
    expect((await level(u.gcd, gca).expect(200)).body).toMatchObject({ cheers: 2, cheered: false });

    expect((await uncheer(gcb, gca).expect(200)).body).toEqual({ cheered: false, cheers: 1 });
    expect((await uncheer(gcb, gca).expect(200)).body).toEqual({ cheered: false, cheers: 1 }); // tirar outra vez também
    expect((await level(gcb, gca).expect(200)).body).toMatchObject({ cheers: 1, cheered: false });
  });

  it('não se brinda a própria geleira', async () => {
    const r = await cheer(u.gca, u.gca).expect(400);
    expect(r.body.message).toBe('Não podes brindar a tua própria geleira');
    await uncheer(u.gca, u.gca).expect(400);
  });

  it('quem não pode ver a geleira não brinda (404): só eu, seguidores sem seguir, bloqueio em qualquer sentido', async () => {
    const { gca, gcb, gcd } = u;
    const notFound = async (viewer: U) => {
      const r = await cheer(viewer, gca).expect(404);
      expect(r.body.message).toBe('Sem geleira para mostrar');
      await uncheer(viewer, gca).expect(404);
      await level(viewer, gca).expect(404);
    };
    await visibility(gca, 'me');
    await notFound(gcd);
    await visibility(gca, 'followers');
    await notFound(gcd); // não segue
    await api().post(`/api/v1/users/${gca.username}/follow`).set(auth(gcd)).expect(200);
    expect((await cheer(gcd, gca).expect(200)).body.cheered).toBe(true);
    await uncheer(gcd, gca).expect(200);
    await visibility(gca, 'everyone');

    // Bloqueio: eu bloqueei-o, ou ele bloqueou-me.
    await api().put(`/api/v1/blocks/${gcb.username}`).set(auth(gca)).expect(200);
    await notFound(gcb);
    await api().delete(`/api/v1/blocks/${gcb.username}`).set(auth(gca)).expect(200);
    await api().put(`/api/v1/blocks/${gca.username}`).set(auth(gcb)).expect(200);
    await notFound(gcb);
    await api().delete(`/api/v1/blocks/${gca.username}`).set(auth(gcb)).expect(200);

    // Pessoa que não existe: a mesma resposta.
    await api().put('/api/v1/users/ninguem_assim_xyz/geleira/cheer').set(auth(gcb)).expect(404);
  });

  it('só o dono vê quem brindou, os mais recentes primeiro, sem bloqueados nem contas inativas', async () => {
    const { gca, gcb, gcc, gcd } = u;
    await cheer(gcb, gca).expect(200);
    await cheer(gcd, gca).expect(200);
    const list = async () => (await api().get(`/api/v1/users/${gca.username}/geleira/cheers`).set(auth(gca)).expect(200)).body as { items: { username: string; displayName: string; hasAvatar: boolean; at: string }[] };

    const all = await list();
    expect(all.items.map((i) => i.username)).toEqual([gcd.username, gcb.username, gcc.username]);
    expect(all.items[0]).toMatchObject({ username: gcd.username, displayName: 'gcd Teste', hasAvatar: false });
    expect(typeof all.items[0].at).toBe('string');

    // Por omissão, outra pessoa (mesmo quem brindou) não vê a lista; pessoa que não existe: 404, como o nível.
    await api().get(`/api/v1/users/${gca.username}/geleira/cheers`).set(auth(gcb)).expect(403);
    await api().get('/api/v1/users/ninguem_assim_xyz/geleira/cheers').set(auth(gcb)).expect(404);

    // Bloqueada: sai da lista e da contagem; desbloqueada, volta.
    await api().put(`/api/v1/blocks/${gcb.username}`).set(auth(gca)).expect(200);
    expect((await list()).items.map((i) => i.username)).toEqual([gcd.username, gcc.username]);
    expect((await level(gca, gca).expect(200)).body.cheers).toBe(2);
    await api().delete(`/api/v1/blocks/${gcb.username}`).set(auth(gca)).expect(200);

    // Conta inativa: não aparece nem conta.
    await pool.query(`UPDATE identity.users SET status = 'suspended' WHERE id = $1`, [gcc.id]);
    expect((await list()).items.map((i) => i.username)).toEqual([gcd.username, gcb.username]);
    expect((await level(gcd, gca).expect(200)).body).toMatchObject({ cheers: 2, cheered: true });
    await pool.query(`UPDATE identity.users SET status = 'active' WHERE id = $1`, [gcc.id]);
  });

  it('o dono é avisado só da primeira vez que cada pessoa brinda (não ao tirar e voltar a pôr)', async () => {
    const { gca, gcb, gcc } = u;
    // gcb já brindou, tirou e voltou a pôr; gcc brindou uma vez: uma notificação cada.
    expect(await notices(gca, gcb)).toBe(1);
    expect(await notices(gca, gcc)).toBe(1);
    await uncheer(gcb, gca).expect(200);
    await cheer(gcb, gca).expect(200);
    await cheer(gcb, gca).expect(200);
    expect(await notices(gca, gcb)).toBe(1);

    // Aparece na lista de notificações do dono, com quem brindou.
    const list = (await api().get('/api/v1/notifications').set(auth(gca)).expect(200)).body as { items: { kind: string; actor: { username: string } }[] };
    expect(list.items.filter((n) => n.kind === 'geleira_cheer').map((n) => n.actor.username).sort()).toEqual([gcb.username, gcc.username, u.gcd.username].sort());
  });

  it('a exportação de dados traz os brindes dados e recebidos', async () => {
    const { gca, gcb } = u;
    const mine = (await api().get('/api/v1/me/export').set(auth(gca)).expect(200)).body;
    expect((mine.geleiraCheersReceived as { from: string }[]).map((c) => c.from)).toContain(gcb.username);
    const theirs = (await api().get('/api/v1/me/export').set(auth(gcb)).expect(200)).body;
    expect(theirs.geleiraCheersGiven).toEqual([expect.objectContaining({ to: gca.username })]);
  });

  it('definição "mostrar quem brindou": desligada por omissão; GET/PUT com cheersPublic, que só aceita sim/não', async () => {
    const { gca, gcb } = u;
    expect((await api().get('/api/v1/geleira/me/settings').set(auth(gcb)).expect(200)).body).toEqual({ matching: true, visibility: 'everyone', cheersPublic: false });
    await api().put('/api/v1/geleira/me/settings').set(auth(gca)).send({ cheersPublic: 'sim' }).expect(400);
    await api().put('/api/v1/geleira/me/settings').set(auth(gca)).send({ cheersPublic: 1 }).expect(400);
    expect((await api().put('/api/v1/geleira/me/settings').set(auth(gca)).send({ cheersPublic: true }).expect(200)).body).toEqual({ matching: true, visibility: 'everyone', cheersPublic: true });
    // Mudar outra coisa não mexe nesta.
    expect((await api().put('/api/v1/geleira/me/settings').set(auth(gca)).send({ visibility: 'followers' }).expect(200)).body).toEqual({ matching: true, visibility: 'followers', cheersPublic: true });
    expect((await api().get('/api/v1/geleira/me/settings').set(auth(gca)).expect(200)).body).toEqual({ matching: true, visibility: 'followers', cheersPublic: true });
    expect((await api().put('/api/v1/geleira/me/settings').set(auth(gca)).send({ visibility: 'everyone', cheersPublic: false }).expect(200)).body).toEqual({ matching: true, visibility: 'everyone', cheersPublic: false });
  });

  it('com a lista pública, quem vê a geleira vê quem brindou (sem quem tem bloqueio com ele); quem não a vê continua 404', async () => {
    const { gca, gcb, gcc, gcd, gce } = u;
    const cheersOf = (viewer: U) => api().get(`/api/v1/users/${gca.username}/geleira/cheers`).set(auth(viewer));
    const names = async (viewer: U) => ((await cheersOf(viewer).expect(200)).body as { items: { username: string }[] }).items.map((i) => i.username);

    // Por omissão: o visitante não lista (403) e o nível diz cheersListable=false; o dono lista sempre.
    expect((await level(gcb, gca).expect(200)).body).toMatchObject({ cheersListable: false });
    expect((await level(gca, gca).expect(200)).body).toMatchObject({ cheersListable: true });
    const denied = await cheersOf(gcb).expect(403);
    expect(denied.body.message).toBe('Só o dono vê quem brindou a geleira');

    // Lista pública: o visitante que vê a geleira vê o mesmo que o dono, no mesmo formato.
    await api().put('/api/v1/geleira/me/settings').set(auth(gca)).send({ cheersPublic: true }).expect(200);
    expect((await level(gcb, gca).expect(200)).body).toMatchObject({ cheersListable: true, cheers: 3 });
    expect((await level(gce, gca).expect(200)).body).toMatchObject({ cheersListable: true, cheered: false });
    const owner = (await cheersOf(gca).expect(200)).body;
    const visitor = (await cheersOf(gce).expect(200)).body;
    expect(visitor).toEqual(owner);
    expect(visitor.items.map((i: { username: string }) => i.username).sort()).toEqual([gcb.username, gcc.username, gcd.username].sort());
    expect(visitor.items[0]).toEqual({ username: expect.any(String), displayName: expect.any(String), verified: false, verifiedTier: null, hasAvatar: false, at: expect.any(String) });

    // Quem não pode ver a geleira continua com 404 (nunca 403), mesmo com a lista pública.
    const notFound = async (viewer: U) => {
      const r = await cheersOf(viewer).expect(404);
      expect(r.body.message).toBe('Sem geleira para mostrar');
      await level(viewer, gca).expect(404);
    };
    await visibility(gca, 'me');
    await notFound(gcb);
    await visibility(gca, 'followers');
    await notFound(gce); // não segue
    await visibility(gca, 'close_friends');
    await notFound(gce);
    await visibility(gca, 'everyone');
    await api().put(`/api/v1/blocks/${gce.username}`).set(auth(gca)).expect(200);
    await notFound(gce);
    await api().delete(`/api/v1/blocks/${gce.username}`).set(auth(gca)).expect(200);
    await api().get('/api/v1/users/ninguem_assim_xyz/geleira/cheers').set(auth(gce)).expect(404);

    // Bloqueio entre o visitante e quem brindou (em qualquer sentido): essa pessoa sai da lista DESSE visitante.
    await api().put(`/api/v1/blocks/${gcc.username}`).set(auth(gce)).expect(200);
    expect(await names(gce)).not.toContain(gcc.username);
    expect(await names(gce)).toHaveLength(2);
    expect(await names(gcb)).toContain(gcc.username); // os outros continuam a ver
    expect(await names(gca)).toContain(gcc.username); // e o dono também
    await api().delete(`/api/v1/blocks/${gcc.username}`).set(auth(gce)).expect(200);
    await api().put(`/api/v1/blocks/${gce.username}`).set(auth(gcd)).expect(200);
    expect(await names(gce)).toEqual((await names(gca)).filter((n) => n !== gcd.username));
    await api().delete(`/api/v1/blocks/${gce.username}`).set(auth(gcd)).expect(200);
    expect(await names(gce)).toEqual(await names(gca));

    // Quem brinda aparece na lista que vê, o mais recente primeiro.
    await cheer(gce, gca).expect(200);
    expect((await names(gce))[0]).toBe(gce.username);
    await uncheer(gce, gca).expect(200);

    // Desligar volta ao 403 para os outros; o dono continua a ver.
    await api().put('/api/v1/geleira/me/settings').set(auth(gca)).send({ cheersPublic: false }).expect(200);
    await cheersOf(gce).expect(403);
    expect((await level(gce, gca).expect(200)).body).toMatchObject({ cheersListable: false });
    await cheersOf(gca).expect(200);
  });
});
