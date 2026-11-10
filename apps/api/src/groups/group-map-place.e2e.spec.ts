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
const NO_PLACE = 'Escolhe onde é o grupo para aparecer em À tua volta';
/** A regra da malta (nearby/geo-sql.ts): o centro da quadrícula de 0,015° (~1,5 km), com 4 casas decimais. */
const cell = (n: number) => Math.round((Math.floor(n / 0.015) * 0.015 + 0.0075) * 10_000) / 10_000;

interface U { token: string; id: string; username: string }
type Row = Record<string, any>;

describe('TxillGroups: o sítio no mapa (local aprovado ou ponto arredondado) (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  // Um sítio ao calhas no meio do Pacífico Sul, para não chocar com dados de outras corridas.
  const C = { lat: Math.round((-55 + Math.random() * 30) * 100) / 100, lng: Math.round((-150 + Math.random() * 40) * 100) / 100 };
  // O ponto que o admin toca no mapa: fino, perto de C (a ~1 km).
  const P = { lat: C.lat + 0.004321, lng: C.lng - 0.006789 };
  let ana: U, beto: U, cris: U, ze: U;
  let venueSlug: string;
  let pendingSlug: string;
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
  const row = async (x: U, id: string) => ((await api().get('/api/v1/chat/groups').set(auth(x)).expect(200)).body as Row[]).find((r) => r.id === id) as Row;
  const nearbyGroup = async (x: U, id: string) =>
    ((await api().get(`/api/v1/nearby?lat=${C.lat}&lng=${C.lng}&kinds=groups`).set(auth(x)).expect(200)).body.groups as Row[]).find((r) => r.id === id);
  /** Um grupo da Ana (admin) com o Beto e a Cris, sem local no plano. Começa privado e oculto. */
  const newGroup = async (name: string) =>
    (await api().post('/api/v1/chat/groups').set(auth(ana)).send({ name, kind: 'festa', members: [beto.username, cris.username] }).expect(201)).body.id as string;

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'p'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    ana = await signup('mpa');
    beto = await signup('mpb');
    cris = await signup('mpc');
    ze = await signup('mpz');
    venueSlug = `t-mp-${run}`;
    pendingSlug = `t-mp-p-${run}`;
    await pool.query(
      `INSERT INTO content.venues (id, slug, name, kind, lat, lng, owner_id, check_token, review_status) VALUES (gen_random_uuid(), $1, $2, 'bar', $3, $4, $5, 'x', 'approved')`,
      [venueSlug, `Barraca MP ${run}`, Math.round((C.lat + 0.02) * 1000) / 1000, C.lng, ana.id],
    );
    await pool.query(
      `INSERT INTO content.venues (id, slug, name, kind, lat, lng, owner_id, check_token, review_status) VALUES (gen_random_uuid(), $1, $2, 'bar', $3, $4, $5, 'x', 'pending')`,
      [pendingSlug, `Em análise MP ${run}`, Math.round((C.lat - 0.02) * 1000) / 1000, C.lng, ana.id],
    );
  }, 60_000);

  beforeEach(() => resetThrottle());

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('sem sítio: mapPlace null e mapReady false; passar a visível dá 400 com a mensagem, e nada muda', async () => {
    const id = await newGroup('Sem sítio');
    expect(await row(ana, id)).toMatchObject({ mapPlace: null, mapReady: false, visibility: 'private', showOnMap: false });
    for (const body of [{ showOnMap: true }, { visibility: 'public' }, { visibility: 'public', showOnMap: true }, { visibility: 'public', mapPlace: null }]) {
      const r = await api().patch(g(id)).set(auth(ana)).send(body).expect(400);
      expect(r.body.message).toBe(NO_PLACE);
    }
    // Nada ficou a meio (nem o nome que ia no mesmo pedido).
    await api().patch(g(id)).set(auth(ana)).send({ name: 'Outro nome', showOnMap: true }).expect(400);
    expect(await row(ana, id)).toMatchObject({ name: 'Sem sítio', visibility: 'private', showOnMap: false });
    // Um local do plano ainda em análise não conta como sítio.
    await api().patch(g(id, '/plan')).set(auth(ana)).send({ venueSlug: pendingSlug }).expect(200);
    expect((await api().patch(g(id)).set(auth(ana)).send({ showOnMap: true }).expect(400)).body.message).toBe(NO_PLACE);
    expect(await row(ana, id)).toMatchObject({ mapReady: false });
    // Ficar privado e oculto continua a dar, sem sítio.
    await api().patch(g(id)).set(auth(ana)).send({ visibility: 'private', showOnMap: false }).expect(204);
  });

  it('o admin escolhe o ponto: guarda-se arredondado (a regra da malta) e o exato nunca volta', async () => {
    const id = await newGroup('Ponto');
    await api().patch(g(id)).set(auth(ana)).send({ mapPlace: { lat: P.lat, lng: P.lng, label: '  Costa do Sol  ' } }).expect(204);
    const want = { lat: cell(P.lat), lng: cell(P.lng), label: 'Costa do Sol' };
    expect(want.lat).not.toBe(P.lat);
    expect(want.lng).not.toBe(P.lng);
    expect(Math.abs(want.lat - P.lat)).toBeLessThanOrEqual(0.0075);
    expect(await row(ana, id)).toMatchObject({ mapPlace: want, mapReady: true });
    expect((await api().get(g(id)).set(auth(beto)).expect(200)).body.group).toMatchObject({ mapPlace: want, mapReady: true });
    const db = (await pool.query('SELECT map_lat, map_lng, map_label FROM social.groups WHERE id = $1', [id])).rows[0];
    expect(db).toEqual({ map_lat: want.lat, map_lng: want.lng, map_label: 'Costa do Sol' });
    // Sem nome também dá; o nome vazio fica null.
    await api().patch(g(id)).set(auth(ana)).send({ mapPlace: { lat: P.lat, lng: P.lng, label: '   ' } }).expect(204);
    expect((await row(ana, id)).mapPlace).toEqual({ lat: want.lat, lng: want.lng, label: null });
    // Valores fora dos limites e nomes compridos: 400.
    await api().patch(g(id)).set(auth(ana)).send({ mapPlace: { lat: 91, lng: 0 } }).expect(400);
    await api().patch(g(id)).set(auth(ana)).send({ mapPlace: { lat: 0, lng: -181 } }).expect(400);
    await api().patch(g(id)).set(auth(ana)).send({ mapPlace: { lat: 0, lng: 0, label: 'x'.repeat(81) } }).expect(400);
    await api().patch(g(id)).set(auth(ana)).send({ mapPlace: { lat: 0 } }).expect(400);
    // Nos limites, o centro da quadrícula não passa de 90 / 180.
    await api().patch(g(id)).set(auth(ana)).send({ mapPlace: { lat: 90, lng: 180 } }).expect(204);
    expect((await row(ana, id)).mapPlace).toEqual({ lat: 90, lng: 180, label: null });
  });

  it('só admins mudam o ponto (membro 403, de fora 404)', async () => {
    const id = await newGroup('Só admins');
    await api().patch(g(id)).set(auth(beto)).send({ mapPlace: { lat: P.lat, lng: P.lng } }).expect(403);
    await api().patch(g(id)).set(auth(beto)).send({ mapPlace: null }).expect(403);
    await api().patch(g(id)).set(auth(ze)).send({ mapPlace: { lat: P.lat, lng: P.lng } }).expect(404);
    expect(await row(ana, id)).toMatchObject({ mapPlace: null, mapReady: false });
  });

  it('com o ponto no mesmo pedido passa a visível; À tua volta mostra o grupo no ponto com placeLabel; /public traz o nome e não a posição', async () => {
    const id = await newGroup('Pelo ponto');
    await api().patch(g(id)).set(auth(ana)).send({ showOnMap: true, mapPlace: { lat: P.lat, lng: P.lng, label: 'Costa do Sol' } }).expect(204);
    expect(await row(ana, id)).toMatchObject({ visibility: 'private', showOnMap: true, mapReady: true });
    const near = await nearbyGroup(ze, id);
    expect(near).toMatchObject({ id, lat: cell(P.lat), lng: cell(P.lng), placeLabel: 'Costa do Sol', destination: 'Costa do Sol', joinMode: 'request', members: 3 });
    const pub = (await api().get(g(id, '/public')).set(auth(ze)).expect(200)).body;
    expect(pub).toMatchObject({ id, placeLabel: 'Costa do Sol', venueName: null, destination: null });
    expect(pub).not.toHaveProperty('lat');
    expect(pub).not.toHaveProperty('mapPlace');
    // Já guardado: passar a público não precisa de o mandar outra vez.
    await api().patch(g(id)).set(auth(ana)).send({ visibility: 'public' }).expect(204);
    expect(await nearbyGroup(ze, id)).toMatchObject({ id, joinMode: 'open', lat: cell(P.lat) });
    // O mesmo noutro grupo, direto a público no mesmo pedido.
    const id2 = await newGroup('Público pelo ponto');
    await api().patch(g(id2)).set(auth(ana)).send({ visibility: 'public', mapPlace: { lat: P.lat, lng: P.lng } }).expect(204);
    expect(await nearbyGroup(ze, id2)).toMatchObject({ id: id2, placeLabel: null, lat: cell(P.lat), lng: cell(P.lng) });
  });

  it('o local aprovado do plano tem prioridade sobre o ponto; um local em análise não', async () => {
    const id = await newGroup('Local e ponto');
    await api().patch(g(id)).set(auth(ana)).send({ showOnMap: true, mapPlace: { lat: P.lat, lng: P.lng, label: 'Costa do Sol' } }).expect(204);
    await api().patch(g(id, '/plan')).set(auth(ana)).send({ venueSlug: pendingSlug }).expect(200);
    expect(await nearbyGroup(ze, id)).toMatchObject({ lat: cell(P.lat), placeLabel: 'Costa do Sol' });
    await api().patch(g(id, '/plan')).set(auth(ana)).send({ venueSlug }).expect(200);
    const v = (await pool.query('SELECT lat, lng FROM content.venues WHERE slug = $1', [venueSlug])).rows[0];
    expect(await nearbyGroup(ze, id)).toMatchObject({ lat: Number(v.lat), lng: Number(v.lng), placeLabel: `Barraca MP ${run}`, destination: `Barraca MP ${run}` });
    expect((await api().get(g(id, '/public')).set(auth(ze)).expect(200)).body).toMatchObject({ placeLabel: `Barraca MP ${run}`, venueName: `Barraca MP ${run}` });
    // O ponto continua guardado (e nos resumos), mas o mapa usa o local.
    expect(await row(ana, id)).toMatchObject({ mapPlace: { lat: cell(P.lat), lng: cell(P.lng), label: 'Costa do Sol' }, mapReady: true });
    // Com o local aprovado, tirar o ponto não deixa o grupo sem sítio.
    await api().patch(g(id)).set(auth(ana)).send({ mapPlace: null }).expect(204);
    expect(await row(ana, id)).toMatchObject({ mapPlace: null, mapReady: true });
    expect(await nearbyGroup(ze, id)).toMatchObject({ lat: Number(v.lat), placeLabel: `Barraca MP ${run}` });
    // Um local aprovado chega para passar a público, sem ponto.
    const id2 = await newGroup('Só local');
    await api().patch(g(id2, '/plan')).set(auth(ana)).send({ venueSlug }).expect(200);
    await api().patch(g(id2)).set(auth(ana)).send({ visibility: 'public' }).expect(204);
  });

  it('null limpa o ponto; num grupo visível sem local, tirar o ponto dá 400', async () => {
    const id = await newGroup('Limpar');
    await api().patch(g(id)).set(auth(ana)).send({ mapPlace: { lat: P.lat, lng: P.lng, label: 'Costa do Sol' } }).expect(204);
    await api().patch(g(id)).set(auth(ana)).send({ mapPlace: null }).expect(204);
    expect(await row(ana, id)).toMatchObject({ mapPlace: null, mapReady: false });
    expect((await pool.query('SELECT map_lat, map_lng, map_label FROM social.groups WHERE id = $1', [id])).rows[0]).toEqual({ map_lat: null, map_lng: null, map_label: null });
    // Visível pelo ponto: não se tira o único sítio...
    await api().patch(g(id)).set(auth(ana)).send({ showOnMap: true, mapPlace: { lat: P.lat, lng: P.lng } }).expect(204);
    expect((await api().patch(g(id)).set(auth(ana)).send({ mapPlace: null }).expect(400)).body.message).toBe(NO_PLACE);
    expect(await nearbyGroup(ze, id)).toBeDefined();
    // ...a não ser que saia do mapa no mesmo pedido.
    await api().patch(g(id)).set(auth(ana)).send({ showOnMap: false, mapPlace: null }).expect(204);
    expect(await row(ana, id)).toMatchObject({ mapPlace: null, mapReady: false, showOnMap: false });
    expect(await nearbyGroup(ze, id)).toBeUndefined();
  });

  it('privado oculto com ponto continua fora do mapa e de /public', async () => {
    const id = await newGroup('Oculto com ponto');
    await api().patch(g(id)).set(auth(ana)).send({ mapPlace: { lat: P.lat, lng: P.lng, label: 'Costa do Sol' } }).expect(204);
    expect(await row(ana, id)).toMatchObject({ visibility: 'private', showOnMap: false, mapReady: true });
    expect(await nearbyGroup(ze, id)).toBeUndefined();
    expect(await nearbyGroup(beto, id)).toBeUndefined();
    await api().get(g(id, '/public')).set(auth(ze)).expect(404);
  });

  it('um grupo que já estava visível sem sítio continua válido: só a mudança é validada', async () => {
    const id = await newGroup('Antigo');
    await pool.query("UPDATE social.groups SET visibility = 'public', show_on_map = true WHERE id = $1", [id]);
    await api().patch(g(id)).set(auth(ana)).send({ name: 'Antigo renomeado' }).expect(204);
    await api().patch(g(id)).set(auth(ana)).send({ visibility: 'public' }).expect(204);
    await api().patch(g(id)).set(auth(ana)).send({ showOnMap: true }).expect(204);
    expect(await row(ana, id)).toMatchObject({ name: 'Antigo renomeado', visibility: 'public', mapReady: false, mapPlace: null });
    // Sem sítio não aparece no mapa (como antes).
    expect(await nearbyGroup(ze, id)).toBeUndefined();
    // Voltar a privado no mapa (de público) também não é "passar a visível".
    await api().patch(g(id)).set(auth(ana)).send({ visibility: 'private' }).expect(204);
    // Mas sair e voltar a entrar no mapa já é.
    await api().patch(g(id)).set(auth(ana)).send({ showOnMap: false }).expect(204);
    expect((await api().patch(g(id)).set(auth(ana)).send({ showOnMap: true }).expect(400)).body.message).toBe(NO_PLACE);
  });
});
