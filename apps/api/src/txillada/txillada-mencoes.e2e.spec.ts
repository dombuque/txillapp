import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { uuidv7 } from '../common/uuid7';
import { PushService, type PushPayload } from '../push/push.service';
import { RealtimeBus } from '../realtime/realtime-bus';
import type { LiveKitRooms } from './livekit';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const LK = { LIVEKIT_URL: 'ws://localhost:7880', LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'secret' };

interface U { token: string; id: string; username: string; ip: string }
interface Item { username: string; verified?: boolean; verifiedTier?: string | null; reason?: string; inTxillada?: boolean; invitable?: boolean }

/**
 * txillada-voltar (docs/txillada-contrato.md, «Menções (txillada-voltar)»): o histórico dos comentários (`before`/`more`), as
 * sugestões de @ no contexto 'txillada' (quem lá está primeiro, `inTxillada`/`invitable`), a menção que vira convite (o aviso
 * 'txillada_invite' com `mention: true`, ou `txillada.mention` a quem já lá está) e o selo de quem vê em todo o lado.
 * Sem o servidor LiveKit (o cliente da sala é um falso) e com os pushes guardados em vez de enviados.
 */
describe('Txillada: menções, histórico e selo (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}`, 'X-Forwarded-For': x.ip });
  const u: Record<string, U> = {};
  const events: { to: string; e: any }[] = [];
  const pushes: { userId: string; p: PushPayload }[] = [];
  const rooms: LiveKitRooms = {
    removeParticipant: async () => undefined,
    deleteRoom: async () => undefined,
    participants: async () => [],
    setCanPublish: async () => undefined,
  };
  let n = 0;

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    n++;
    const ip = `10.174.${n >> 8}.${n & 255}`;
    const r = await api().post('/api/v1/auth/register').set('X-Forwarded-For', ip)
      .send({ email: `${username}@example.com`, username, displayName: `${name[0].toUpperCase()}${name.slice(1)} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
    return { token: r.body.accessToken, id: r.body.user.id, username, ip };
  }
  const follow = (a: U, b: U) => api().post(`/api/v1/users/${b.username}/follow`).set(auth(a)).expect(200);
  const block = (a: U, b: U) => api().put(`/api/v1/blocks/${b.username}`).set(auth(a)).expect((r) => expect([200, 204]).toContain(r.status));
  const open = (x: U, body: Record<string, unknown> = {}) => api().post('/api/v1/txilladas').set(auth(x)).send({ title: 'Bora', ...body });
  const get = (x: U, id: string) => api().get(`/api/v1/txilladas/${id}`).set(auth(x));
  const join = (x: U, id: string) => api().post(`/api/v1/txilladas/${id}/join`).set(auth(x));
  const comment = (x: U, id: string, body: string) => api().post(`/api/v1/txilladas/${id}/comments`).set(auth(x)).send({ body });
  const comments = (x: U, id: string, qs = '') => api().get(`/api/v1/txilladas/${id}/comments${qs}`).set(auth(x));
  const endAll = (x: U) => pool.query(`UPDATE content.txilladas SET status = 'ended', ended_at = now() WHERE host_id = $1 AND status = 'live'`, [x.id]);
  const addGuest = (id: string, x: U) =>
    pool.query(`INSERT INTO content.txillada_guests (txillada_id, user_id, kind, status, since) VALUES ($1, $2, 'invite', 'accepted', now())`, [id, x.id]);
  async function suggest(x: U, id: string, q = ''): Promise<Item[]> {
    return (await api().get(`/api/v1/mentions/suggest?q=${encodeURIComponent(q)}&context=txillada&id=${id}`).set(auth(x)).expect(200)).body.items;
  }
  const notes = async (x: U, id: string) =>
    (await pool.query(`SELECT actor_id, data FROM social.notifications WHERE user_id = $1 AND kind = 'txillada_invite' AND data->>'txilladaId' = $2`, [x.id, id])).rows;
  const evs = (x: U, type: string, id: string) => events.filter((e) => e.to === x.id && e.e?.type === type && e.e?.txilladaId === id).map((e) => e.e);
  const pushesTo = (x: U) => pushes.filter((p) => p.userId === x.id && /mencionou-te/.test(p.p.body));
  /** O push sai depois da resposta (void): espera um pouco por ele. */
  async function pushed(x: U) {
    for (let i = 0; i < 50 && !pushesTo(x).length; i++) await new Promise((r) => setTimeout(r, 20));
    return pushesTo(x);
  }

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(
      loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 't'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test', ...LK }),
      { livekitRooms: rooms },
    );
    await app.init();
    const bus = app.get(RealtimeBus);
    const publish = bus.publish.bind(bus);
    jest.spyOn(bus, 'publish').mockImplementation((to: string, e: unknown) => {
      events.push({ to, e });
      publish(to, e);
    });
    // Sem esperar 2 s entre comentários da mesma pessoa (o resto do claimOnce fica como está: o limite de 10 min dos avisos).
    const claimOnce = bus.claimOnce.bind(bus);
    jest.spyOn(bus, 'claimOnce').mockImplementation(async (key: string, ttl: number) => (key.startsWith('tx:cmt:') ? true : claimOnce(key, ttl)));
    const push = app.get(PushService);
    Object.defineProperty(push, 'enabled', { value: true });
    jest.spyOn(push, 'send').mockImplementation(async (userId: string, p: PushPayload) => {
      pushes.push({ userId, p });
      return 1;
    });
    for (const name of ['host', 'ana', 'rui', 'eva', 'gui', 'wat', 'cid', 'blk', 'hf', 'fa', 'nf', 'hp', 'pa', 'pw', 'px', 'zed']) u[name] = await signup(name);
    // A Ana é uma espectadora verificada (selo pago); o anfitrião também tem o selo.
    await pool.query(`UPDATE identity.users SET verified = true, verified_tier = 'paid' WHERE id = $1`, [u.ana.id]);
    await pool.query(`UPDATE identity.users SET verified = true, verified_tier = 'verified' WHERE id = $1`, [u.host.id]);
    // O Blk bloqueou o anfitrião. O Hf (Para amigos) e a Fa são amigos (seguem-se os dois); o Nf só segue o Hf.
    await block(u.blk, u.host);
    await follow(u.hf, u.fa);
    await follow(u.fa, u.hf);
    await follow(u.nf, u.hf);
  }, 240_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
    jest.restoreAllMocks();
  });

  it('histórico: os 50 mais recentes com `more`, depois `before` para trás até ao início; `after` continua igual', async () => {
    const { host, rui, zed } = u;
    const id = (await open(host).expect(201)).body.txillada.id as string;
    const t0 = Date.now() - 600_000;
    const ids: string[] = [];
    for (let i = 0; i < 120; i++) ids.push(uuidv7(t0 + i * 1000));
    await pool.query(
      `INSERT INTO content.txillada_comments (id, txillada_id, author_id, body, created_at)
       SELECT x.id, $1, $2, 'c' || x.n, now() FROM unnest($3::uuid[]) WITH ORDINALITY AS x(id, n)`,
      [id, rui.id, ids],
    );
    // Um apagado e um de quem eu bloqueei não aparecem (nem contam para a página).
    await pool.query(`UPDATE content.txillada_comments SET removed_at = now() WHERE id = $1`, [ids[10]]);
    await pool.query(`INSERT INTO content.txillada_comments (id, txillada_id, author_id, body) VALUES ($1, $2, $3, 'bloqueado')`, [uuidv7(t0 + 5500), id, zed.id]);
    await block(host, zed);

    const p1 = (await comments(host, id).expect(200)).body;
    expect(p1.more).toBe(true);
    expect(p1.items.map((c: any) => c.body)).toEqual(Array.from({ length: 50 }, (_, i) => `c${71 + i}`));
    const p2 = (await comments(host, id, `?before=${p1.items[0].id}`).expect(200)).body;
    expect(p2.more).toBe(true);
    expect(p2.items.map((c: any) => c.body)).toEqual(Array.from({ length: 50 }, (_, i) => `c${21 + i}`));
    const p3 = (await comments(host, id, `?before=${p2.items[0].id}`).expect(200)).body;
    expect(p3.more).toBe(false);
    // 19 (c1..c20 sem o c11, apagado; o do Zed não se vê).
    expect(p3.items.map((c: any) => c.body)).toEqual(Array.from({ length: 20 }, (_, i) => `c${i + 1}`).filter((b) => b !== 'c11'));
    expect((await comments(host, id, `?before=${p3.items[0].id}`).expect(200)).body).toEqual({ items: [], more: false });
    // `after`: os mais recentes depois desse (como antes), com `more`.
    const a = (await comments(host, id, `?after=${ids[115]}`).expect(200)).body;
    expect(a).toMatchObject({ more: false });
    expect(a.items.map((c: any) => c.body)).toEqual(['c117', 'c118', 'c119', 'c120']);
    await comments(host, id, '?before=nao-e-um-id').expect(400);
    await api().delete(`/api/v1/blocks/${zed.username}`).set(auth(host));
    await endAll(host);
  });

  it('sugestões no contexto txillada: com «@» só, o anfitrião primeiro, quem transmite, quem vê, quem comentou; inTxillada e invitable', async () => {
    const { host, rui, gui, wat, cid, eva, blk } = u;
    const id = (await open(host).expect(201)).body.txillada.id as string;
    await addGuest(id, gui);
    await join(gui, id).expect(200);
    await join(rui, id).expect(200);
    await join(wat, id).expect(200);
    await comment(cid, id, 'boa noite').expect(201);
    // O Rui segue a Eva (fora da Txillada, pode entrar) e o Blk (bloqueou o anfitrião: nunca convidável).
    await follow(rui, eva);
    await follow(rui, blk);
    const items = await suggest(rui, id);
    expect(items.map((i) => i.username)).toEqual([host.username, gui.username, wat.username, cid.username, ...[blk.username, eva.username].sort()]);
    const by = Object.fromEntries(items.map((i) => [i.username, i]));
    expect(by[host.username]).toMatchObject({ reason: 'anfitriao', inTxillada: true, invitable: false, verified: true, verifiedTier: 'verified' });
    expect(by[gui.username]).toMatchObject({ reason: 'a-transmitir', inTxillada: true, invitable: false });
    expect(by[wat.username]).toMatchObject({ reason: 'a-ver', inTxillada: true, invitable: false });
    expect(by[cid.username]).toMatchObject({ reason: 'comentou', inTxillada: false, invitable: true });
    expect(by[eva.username]).toMatchObject({ inTxillada: false, invitable: true });
    expect(by[blk.username]).toMatchObject({ inTxillada: false, invitable: false });
    expect(items.map((i) => i.username)).not.toContain(rui.username);
    // A pesquisa geral (completar) também leva as duas marcas.
    const q = await suggest(rui, id, `zed${run}`);
    expect(q.find((i) => i.username === u.zed.username)).toMatchObject({ inTxillada: false, invitable: true });
    // Sem contexto, nada disto.
    const plain = (await api().get('/api/v1/mentions/suggest?q=').set(auth(rui)).expect(200)).body.items as Item[];
    expect(plain.every((i) => i.inTxillada === undefined && i.invitable === undefined)).toBe(true);
    await endAll(host);
  });

  it('sugestões: numa paga, quem vê é segredo (menos para o anfitrião); numa «Para amigos», quem não é amigo nunca é convidável; sem acesso, como sem contexto', async () => {
    const { hp, pa, pw, px, hf, fa, nf, blk } = u;
    const paid = (await open(hp, { audience: 'paid', price: 5 }).expect(201)).body.txillada.id as string;
    await api().post(`/api/v1/txilladas/${paid}/ticket`).set(auth(pa)).expect(200);
    await api().post(`/api/v1/txilladas/${paid}/ticket`).set(auth(pw)).expect(200);
    await join(pw, paid).expect(200);
    await follow(pa, pw);
    await follow(pa, px);
    const forPa = await suggest(pa, paid);
    expect(forPa[0]).toMatchObject({ username: hp.username, reason: 'anfitriao', inTxillada: true });
    // O Pw está a ver mas não sobe nem se diz: aparece só por o Pa o seguir, como quem não está lá.
    expect(forPa.find((i) => i.username === pw.username)).toEqual(expect.objectContaining({ inTxillada: false, invitable: true }));
    expect(forPa.find((i) => i.username === pw.username)?.reason).toBeUndefined();
    expect(forPa.find((i) => i.username === px.username)).toMatchObject({ inTxillada: false, invitable: true });
    // O anfitrião vê quem está a ver.
    expect((await suggest(hp, paid)).find((i) => i.username === pw.username)).toMatchObject({ reason: 'a-ver', inTxillada: true, invitable: false });
    // Quem não tem a entrada: como sem contexto (nem o anfitrião sobe, nem há marcas).
    const forPx = await suggest(px, paid);
    expect(forPx.find((i) => i.username === hp.username)).toBeUndefined();
    expect(forPx.every((i) => i.inTxillada === undefined)).toBe(true);
    await endAll(hp);

    const fr = (await open(hf, { audience: 'friends' }).expect(201)).body.txillada.id as string;
    await follow(fa, nf);
    await follow(fa, blk);
    const forFa = await suggest(fa, fr);
    expect(forFa[0]).toMatchObject({ username: hf.username, inTxillada: true });
    // O Nf só segue o anfitrião (não é amigo): não podia entrar.
    expect(forFa.find((i) => i.username === nf.username)).toMatchObject({ inTxillada: false, invitable: false });
    // O Nf não vê a Txillada: o contexto não conta (não diz de quem é).
    const forNf = await suggest(nf, fr);
    expect(forNf.find((i) => i.username === hf.username)?.reason).toBeUndefined();
    expect(forNf.every((i) => i.inTxillada === undefined)).toBe(true);
    await endAll(hf);
  });

  it('menção = convite: o aviso a quem não está (uma vez a cada 10 min, partilhado com o convite do anfitrião), txillada.mention a quem já está', async () => {
    const { host, rui, eva, wat, cid, blk, gui, zed } = u;
    const id = (await open(host).expect(201)).body.txillada.id as string;
    await addGuest(id, gui);
    await join(rui, id).expect(200);
    await join(wat, id).expect(200);
    pushes.length = 0;
    const r = (await comment(rui, id, `@${eva.username} @${wat.username} @${host.username} @${blk.username} @${cid.username} vem cá`).expect(201)).body;
    expect(r).toMatchObject({ body: expect.stringContaining('vem cá'), author: { username: rui.username } });
    expect(r.invited).toEqual([eva.username, cid.username]);
    const data = { txilladaId: id, title: 'Bora', mention: true, host: { username: host.username, verified: true, verifiedTier: 'verified' } };
    expect(await notes(eva, id)).toEqual([{ actor_id: rui.id, data }]);
    expect(await notes(cid, id)).toEqual([{ actor_id: rui.id, data }]);
    expect(await pushed(eva)).toEqual([{
      userId: eva.id,
      p: expect.objectContaining({ body: `@${rui.username} mencionou-te na Txillada de @${host.username}: vem ver`, url: `/txillada/${id}`, category: 'txilladas' }),
    }]);
    // Quem já lá está: só o evento (sem aviso). O Blk (bloqueou o anfitrião): nada.
    for (const x of [wat, host]) {
      expect(await notes(x, id)).toEqual([]);
      expect(evs(x, 'txillada.mention', id).at(-1)).toEqual({
        type: 'txillada.mention', txilladaId: id, commentId: r.id,
        from: { username: rui.username, displayName: 'Rui Teste', avatarUrl: null, verified: false, verifiedTier: null },
      });
    }
    expect(await notes(blk, id)).toEqual([]);
    expect(evs(blk, 'txillada.mention', id)).toEqual([]);
    // O convidado a transmitir também está lá: evento, sem aviso.
    await comment(rui, id, `@${gui.username} sobe o som`).expect(201);
    expect(evs(gui, 'txillada.mention', id)).toHaveLength(1);
    expect(await notes(gui, id)).toEqual([]);
    // O evento do comentário não leva `invited`.
    const ce = evs(host, 'txillada.comment', id).find((e) => e.comment.id === r.id);
    expect(ce.comment).not.toHaveProperty('invited');
    // Outra vez dentro dos 10 min (outro autor): sem aviso novo; e o convite do anfitrião (0168) também não repete o aviso.
    expect((await comment(wat, id, `@${eva.username} anda`).expect(201)).body.invited).toEqual([]);
    expect(await notes(eva, id)).toHaveLength(1);
    await api().post(`/api/v1/txilladas/${id}/guests/invite`).set(auth(host)).send({ username: eva.username }).expect(200);
    expect(await notes(eva, id)).toHaveLength(1);
    // O anfitrião menciona: «@anfitrião mencionou-te na Txillada: vem ver».
    expect((await comment(host, id, `@${zed.username} chega aqui`).expect(201)).body.invited).toEqual([zed.username]);
    expect((await pushed(zed)).at(-1)?.p.body).toBe(`@${host.username} mencionou-te na Txillada: vem ver`);
    // Mencionar-se a si próprio, ou um @ que não existe: nada (e o comentário entra na mesma).
    expect((await comment(rui, id, `@${rui.username} @ninguem${run}`).expect(201)).body.invited).toEqual([]);
    await endAll(host);
  });

  it('menção: sem convite numa «Para amigos» a quem não é amigo, com bloqueio entre o autor e a pessoa; numa paga o aviso vai mas sem entrada nem lugar', async () => {
    const { hf, fa, nf, zed, hp, pa, px } = u;
    const fr = (await open(hf, { audience: 'friends' }).expect(201)).body.txillada.id as string;
    expect((await comment(fa, fr, `@${nf.username} olha`).expect(201)).body.invited).toEqual([]);
    expect(await notes(nf, fr)).toEqual([]);
    expect(evs(nf, 'txillada.mention', fr)).toEqual([]);
    await endAll(hf);

    const paid = (await open(hp, { audience: 'paid', price: 5 }).expect(201)).body.txillada.id as string;
    await api().post(`/api/v1/txilladas/${paid}/ticket`).set(auth(pa)).expect(200);
    // O Zed bloqueou o Pa: não se menciona (nem aviso nem evento).
    await block(zed, pa);
    expect((await comment(pa, paid, `@${zed.username} @${px.username} vem`).expect(201)).body.invited).toEqual([px.username]);
    expect(await notes(zed, paid)).toEqual([]);
    expect(await notes(px, paid)).toEqual([{ actor_id: pa.id, data: { txilladaId: paid, title: 'Bora', mention: true, host: { username: hp.username, verified: false, verifiedTier: null } } }]);
    expect((await pushed(px)).at(-1)?.p.body).toBe(`@${pa.username} mencionou-te na Txillada de @${hp.username}: vem ver`);
    // Sem entrada grátis: o cadeado continua e não há lugar de convidado.
    expect((await get(px, paid).expect(200)).body).toMatchObject({ locked: true, hasTicket: false });
    expect((await pool.query(`SELECT count(*)::int AS n FROM content.txillada_guests WHERE txillada_id = $1 AND user_id = $2`, [paid, px.id])).rows[0].n).toBe(0);
    expect((await pool.query(`SELECT count(*)::int AS n FROM content.txillada_tickets WHERE txillada_id = $1 AND user_id = $2`, [paid, px.id])).rows[0].n).toBe(0);
    await api().delete(`/api/v1/blocks/${pa.username}`).set(auth(zed));
    await endAll(hp);
  });

  it('o selo de quem vê (verificado, não anfitrião) em todo o lado: comentários, resposta, evento, fixado, a ver, entrou, sugestões', async () => {
    const { host, ana, rui } = u;
    const id = (await open(host).expect(201)).body.txillada.id as string;
    await join(rui, id).expect(200);
    const badge = { username: ana.username, verified: true, verifiedTier: 'paid' };
    await join(ana, id).expect(200);
    expect(evs(host, 'txillada.joined', id).at(-1)?.user).toMatchObject(badge);
    expect(evs(rui, 'txillada.joined', id).at(-1)?.user).toMatchObject(badge);
    const c = (await comment(ana, id, 'olá a todos').expect(201)).body;
    expect(c.author).toMatchObject(badge);
    expect(c.invited).toEqual([]);
    expect(evs(rui, 'txillada.comment', id).find((e) => e.comment.id === c.id)?.comment.author).toMatchObject(badge);
    expect((await comments(rui, id).expect(200)).body.items.find((x: any) => x.id === c.id).author).toMatchObject(badge);
    await api().post(`/api/v1/txilladas/${id}/pin`).set(auth(host)).send({ commentId: c.id }).expect(200);
    expect(evs(rui, 'txillada.pinned', id).at(-1)?.comment.author).toMatchObject(badge);
    expect((await get(rui, id).expect(200)).body.pinned.author).toMatchObject(badge);
    expect((await api().get(`/api/v1/txilladas/${id}/viewers`).set(auth(rui)).expect(200)).body.items.find((x: any) => x.username === ana.username)).toMatchObject(badge);
    expect((await suggest(rui, id)).find((i) => i.username === ana.username)).toMatchObject({ ...badge, reason: 'a-ver', inTxillada: true });
    // O brinde também leva o selo.
    await api().post(`/api/v1/txilladas/${id}/cheer`).set(auth(ana)).expect((r) => expect([200, 201]).toContain(r.status));
    expect(evs(rui, 'txillada.cheer', id).at(-1)?.from).toEqual(badge);
    await endAll(host);
  });
});
