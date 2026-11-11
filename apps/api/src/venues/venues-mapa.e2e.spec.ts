import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { getStorageToken } from '@nestjs/throttler';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';

interface U { token: string; id: string; username: string }
interface V { slug: string; id: string; lat: number | null; lng: number | null; showOnMap: boolean; address: string | null; city: string | null }

describe('locais no mapa: posição, morada, mostrar no mapa (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  // Um sítio ao calhas no meio do Pacífico Sul, para não chocar com dados de corridas antigas.
  const C = { lat: Math.round((-55 + Math.random() * 30) * 100) / 100, lng: Math.round((-150 + Math.random() * 40) * 100) / 100 };
  let dono: U, cliente: U;
  let visivel: V, escondido: V;

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  /** Locais novos ficam em análise; aqui a equipa aprova-os logo. */
  const approve = (id: string) => pool.query("UPDATE content.venues SET review_status = 'approved' WHERE id = $1", [id]);
  const slugs = (xs: { slug: string }[]) => xs.map((x) => x.slug);
  // Os limites de pedidos contam por IP e aqui é tudo do mesmo: começa-se cada teste do zero.
  const resetThrottle = () => {
    const s = app.get(getStorageToken()) as { storage: Map<string, unknown>; hitExpirations?: Map<string, unknown> };
    s.storage.clear();
    s.hitExpirations?.clear();
  };

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'd'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    dono = await signup('mdono');
    cliente = await signup('mcli');
  }, 60_000);

  beforeEach(() => resetThrottle());

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('cria o local com posição, morada e cidade (6 casas decimais) e lê-o de volta; valida a posição', async () => {
    const body = { name: `Bar da Marginal ${run}`, kind: 'bar', address: 'Av. da Marginal 1234', city: 'Maputo', lat: C.lat + 0.0012345678, lng: C.lng - 0.0023456789 };
    const v = (await api().post('/api/v1/venues').set(auth(dono)).send(body).expect(201)).body as V;
    expect(v).toMatchObject({ address: 'Av. da Marginal 1234', city: 'Maputo', showOnMap: true });
    expect(v.lat).toBe(Math.round(body.lat * 1e6) / 1e6);
    expect(v.lng).toBe(Math.round(body.lng * 1e6) / 1e6);
    await approve(v.id);
    visivel = v;
    const seen = (await api().get(`/api/v1/venues/${v.slug}`).set(auth(cliente)).expect(200)).body as V;
    expect(seen).toMatchObject({ lat: v.lat, lng: v.lng, showOnMap: true, address: 'Av. da Marginal 1234', city: 'Maputo' });
    const row = (await pool.query('SELECT lat, lng, show_on_map FROM content.venues WHERE id = $1', [v.id])).rows[0];
    expect(row).toEqual({ lat: v.lat, lng: v.lng, show_on_map: true });

    // A posição vai junta e dentro dos limites; (0, 0) não é um sítio.
    await api().post('/api/v1/venues').set(auth(dono)).send({ name: `Só lat ${run}`, kind: 'bar', lat: C.lat }).expect(400);
    await api().post('/api/v1/venues').set(auth(dono)).send({ name: `Fora ${run}`, kind: 'bar', lat: 95, lng: 10 }).expect(400);
    await api().post('/api/v1/venues').set(auth(dono)).send({ name: `Fora ${run}`, kind: 'bar', lat: 10, lng: -181 }).expect(400);
    await api().post('/api/v1/venues').set(auth(dono)).send({ name: `Fora ${run}`, kind: 'bar', lat: '10', lng: '20' }).expect(400);
    resetThrottle(); // criar locais: 5 por hora
    await api().post('/api/v1/venues').set(auth(dono)).send({ name: `Zero ${run}`, kind: 'bar', lat: 0, lng: 0 }).expect(400);
    await api().patch(`/api/v1/venues/${v.slug}`).set(auth(dono)).send({ lat: C.lat }).expect(400);

    // Sem posição: vem a null (e no mapa por omissão, para quando a tiver).
    const semPos = (await api().post('/api/v1/venues').set(auth(dono)).send({ name: `Sem posição ${run}`, kind: 'cafe' }).expect(201)).body as V;
    expect(semPos).toMatchObject({ lat: null, lng: null, showOnMap: true });
    escondido = semPos;
    await approve(semPos.id);
  });

  it('PATCH muda a posição e tira do mapa; só quem gere vê a posição de um local fora do mapa', async () => {
    const patched = (await api().patch(`/api/v1/venues/${escondido.slug}`).set(auth(dono)).send({ lat: C.lat + 0.004, lng: C.lng + 0.003, address: 'Rua da Sé 7', city: 'Maputo', showOnMap: false }).expect(200)).body as V;
    expect(patched).toMatchObject({ showOnMap: false, lat: Math.round((C.lat + 0.004) * 1e6) / 1e6, lng: Math.round((C.lng + 0.003) * 1e6) / 1e6, address: 'Rua da Sé 7' });
    escondido = patched;
    await api().patch(`/api/v1/venues/${escondido.slug}`).set(auth(cliente)).send({ showOnMap: true }).expect(403);
    const outsider = (await api().get(`/api/v1/venues/${escondido.slug}`).set(auth(cliente)).expect(200)).body as V;
    expect(outsider).toMatchObject({ showOnMap: false, lat: null, lng: null, address: 'Rua da Sé 7', city: 'Maputo' });

    // Ligar e desligar outra vez.
    expect((await api().patch(`/api/v1/venues/${escondido.slug}`).set(auth(dono)).send({ showOnMap: true }).expect(200)).body.showOnMap).toBe(true);
    expect((await api().get(`/api/v1/venues/${escondido.slug}`).set(auth(cliente)).expect(200)).body.lat).toBe(escondido.lat);
    expect((await api().patch(`/api/v1/venues/${escondido.slug}`).set(auth(dono)).send({ showOnMap: false }).expect(200)).body.showOnMap).toBe(false);
    // Limpar a posição (as duas a null).
    const x = (await api().patch(`/api/v1/venues/${visivel.slug}`).set(auth(dono)).send({ lat: null, lng: null }).expect(200)).body as V;
    expect(x).toMatchObject({ lat: null, lng: null });
    visivel = (await api().patch(`/api/v1/venues/${visivel.slug}`).set(auth(dono)).send({ lat: C.lat + 0.001, lng: C.lng }).expect(200)).body as V;
    expect(visivel.lat).toBe(Math.round((C.lat + 0.001) * 1e6) / 1e6);
  });

  it('fora do mapa: não entra em "perto de mim" nem como pino, mas aparece na pesquisa por nome e na página', async () => {
    const disc = (await api().get(`/api/v1/venues/discover?lat=${C.lat}&lng=${C.lng}`).set(auth(cliente)).expect(200)).body as { nearby: V[]; popular: V[] };
    expect(slugs(disc.nearby)).toContain(visivel.slug);
    expect(slugs(disc.nearby)).not.toContain(escondido.slug);
    const pop = disc.popular.find((v) => v.slug === escondido.slug);
    if (pop) expect(pop).toMatchObject({ lat: null, lng: null, showOnMap: false });

    const around = (await api().get(`/api/v1/nearby?lat=${C.lat}&lng=${C.lng}&kinds=venues`).set(auth(cliente)).expect(200)).body as { venues: V[] };
    expect(slugs(around.venues)).toContain(visivel.slug);
    expect(slugs(around.venues)).not.toContain(escondido.slug);
    const map = (await api().get(`/api/v1/nearby/places?q=${encodeURIComponent(run)}&lat=${C.lat}&lng=${C.lng}`).set(auth(cliente)).expect(200)).body as { venues: V[] };
    expect(slugs(map.venues)).toContain(visivel.slug);
    expect(slugs(map.venues)).not.toContain(escondido.slug);

    // Pesquisa por nome: continua lá (sem posição para quem não gere).
    const byName = (await api().get(`/api/v1/venues/search?q=${encodeURIComponent(`Sem posição ${run}`)}`).set(auth(cliente)).expect(200)).body as V[];
    expect(byName.find((v) => v.slug === escondido.slug)).toMatchObject({ showOnMap: false, lat: null, lng: null });
    const global = (await api().get(`/api/v1/search?q=${encodeURIComponent(`Sem posição ${run}`)}`).set(auth(cliente)).expect(200)).body as { venues: V[] };
    expect(slugs(global.venues)).toContain(escondido.slug);
    // O dono vê os dois nas suas páginas, com a posição.
    const mine = (await api().get('/api/v1/venues/mine').set(auth(dono)).expect(200)).body as V[];
    expect(mine.find((v) => v.slug === escondido.slug)).toMatchObject({ showOnMap: false, lat: escondido.lat, lng: escondido.lng });
  });

  it('um evento num local fora do mapa não leva posição nem aparece no mapa; o de um local no mapa leva', async () => {
    const soon = new Date(Date.now() + 2 * 3_600_000).toISOString();
    const evHidden = (await api().post('/api/v1/events').set(auth(dono)).send({ venueSlug: escondido.slug, title: `Noite escondida ${run}`, startsAt: soon }).expect(201)).body;
    const evShown = (await api().post('/api/v1/events').set(auth(dono)).send({ venueSlug: visivel.slug, title: `Noite à vista ${run}`, startsAt: soon }).expect(201)).body;
    expect(evHidden.venue).toMatchObject({ slug: escondido.slug, lat: null, lng: null });
    expect(evShown.venue).toMatchObject({ slug: visivel.slug, lat: visivel.lat, lng: visivel.lng });
    expect((await api().get(`/api/v1/events/${evHidden.id}`).set(auth(cliente)).expect(200)).body.venue).toMatchObject({ lat: null, lng: null });
    const up = (await api().get(`/api/v1/venues-events/${escondido.slug}`).set(auth(cliente)).expect(200)).body.items as { id: string; venue: V }[];
    expect(up.find((e) => e.id === evHidden.id)?.venue).toMatchObject({ lat: null, lng: null });

    const ids = (xs: { id: string }[]) => xs.map((e) => e.id);
    const around = (await api().get(`/api/v1/nearby?lat=${C.lat}&lng=${C.lng}&kinds=events`).set(auth(cliente)).expect(200)).body.events as { id: string }[];
    expect(ids(around)).toContain(evShown.id);
    expect(ids(around)).not.toContain(evHidden.id);
    const found = (await api().get(`/api/v1/nearby/places?q=${encodeURIComponent(`noite`)}&lat=${C.lat}&lng=${C.lng}`).set(auth(cliente)).expect(200)).body.events as { id: string }[];
    expect(ids(found)).toContain(evShown.id);
    expect(ids(found)).not.toContain(evHidden.id);
  });

  it('publicar como um local fora do mapa não dá posição à publicação (nem a de quem publica)', async () => {
    const p = (await api().post('/api/v1/posts').set(auth(dono)).send({ body: `cá estamos ${run}`, venueId: escondido.id, locationLat: C.lat + 0.01, locationLng: C.lng }).expect(201)).body;
    const row = (await pool.query('SELECT location_label, location_lat, location_lng FROM content.posts WHERE id = $1', [p.id])).rows[0];
    expect(row).toEqual({ location_label: `Sem posição ${run}`, location_lat: null, location_lng: null });
    const shown = (await api().post('/api/v1/posts').set(auth(dono)).send({ body: `à vista ${run}`, venueId: visivel.id }).expect(201)).body;
    const row2 = (await pool.query('SELECT location_lat FROM content.posts WHERE id = $1', [shown.id])).rows[0];
    expect(row2.location_lat).not.toBeNull();
  });
});
