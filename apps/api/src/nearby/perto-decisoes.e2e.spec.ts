import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { getStorageToken } from '@nestjs/throttler';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { SchemaProbe } from './schema-probe';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

interface U { token: string; id: string; username: string }
type Geo = { lat: number; lng: number } | null;
interface PostDto { id: string; body: string; locationGeo: Geo }

/** Tem no máximo 2 casas decimais (~1 km)? */
const twoDp = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
const r2 = (n: number) => Math.round(n * 100) / 100;

describe('À tua volta: privacidade das publicações, contas apagadas, presença, datas dos grupos e as minhas coisas (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  // Um sítio ao calhas no meio do Pacífico Sul, para não chocar com dados de corridas antigas.
  const C = { lat: Math.round((-55 + Math.random() * 30) * 100) / 100, lng: Math.round((-150 + Math.random() * 40) * 100) / 100 };
  let autor: U, leitor: U, dono: U;

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
  async function venue(key: string, owner: U, lat: number, lng: number) {
    const slug = `d-${key}-${run}`;
    const id = (await pool.query(
      `INSERT INTO content.venues (id, slug, name, kind, lat, lng, owner_id, check_token, review_status) VALUES (gen_random_uuid(), $1, $2, 'bar', $3, $4, $5, 'x', 'approved') RETURNING id`,
      [slug, `Decisão ${key} ${run}`, lat, lng, owner.id],
    )).rows[0].id as string;
    return { id, slug };
  }
  const nearby = (x: U, qs: string) => api().get(`/api/v1/nearby?lat=${C.lat}&lng=${C.lng}&${qs}`).set(auth(x));
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
    autor = await signup('dautor');
    leitor = await signup('dleit');
    dono = await signup('ddono');
    await pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [leitor.id, autor.id]);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  beforeEach(() => resetThrottle());

  it('a posição de uma publicação sai com 2 casas no máximo em todas as respostas (também as antigas) e grava-se com 2', async () => {
    const tag = `geo${run}`;
    const label = `Praia Decisão ${run}`;
    const exact = { lat: C.lat + 0.012345, lng: C.lng + 0.006789 };
    const media = await upload(autor);
    const p = (await api().post('/api/v1/posts').set(auth(autor)).send({ body: `privacidade${run} #${tag}`, locationLabel: label, locationLat: exact.lat, locationLng: exact.lng, mediaIds: [media] }).expect(201)).body as PostDto;
    // Grava-se já com 2 casas.
    const row = (await pool.query('SELECT location_lat, location_lng FROM content.posts WHERE id = $1', [p.id])).rows[0];
    expect(row).toEqual({ location_lat: r2(exact.lat), location_lng: r2(exact.lng) });
    expect(p.locationGeo).toEqual({ lat: r2(exact.lat), lng: r2(exact.lng) });
    // Dados antigos (com mais casas, de antes desta regra): saem também com 2.
    const old = { lat: C.lat + 0.0123, lng: C.lng + 0.0067 };
    await pool.query('UPDATE content.posts SET location_lat = $2, location_lng = $3 WHERE id = $1', [p.id, old.lat, old.lng]);
    const want = { lat: r2(old.lat), lng: r2(old.lng) };
    expect(twoDp(want.lat) && twoDp(want.lng)).toBe(true);

    const mineIn = (items: PostDto[]) => items.find((x) => x.id === p.id);
    const check = (where: string, got: PostDto | undefined) => {
      expect({ where, geo: got?.locationGeo }).toEqual({ where, geo: want });
    };
    check('detalhe', (await api().get(`/api/v1/posts/${p.id}`).set(auth(leitor)).expect(200)).body);
    check('código', (await api().get(`/api/v1/posts/code/${(await api().get(`/api/v1/posts/${p.id}`).set(auth(leitor))).body.code}`).set(auth(leitor)).expect(200)).body);
    check('feed', mineIn((await api().get('/api/v1/posts?limit=50').set(auth(leitor)).expect(200)).body.items));
    check('perfil', mineIn((await api().get(`/api/v1/users/${autor.username}/posts`).set(auth(leitor)).expect(200)).body.items));
    check('hashtag', mineIn((await api().get(`/api/v1/tags/${tag}`).set(auth(leitor)).expect(200)).body.items));
    const at = (await api().get(`/api/v1/feed/place?label=${encodeURIComponent(label)}&mode=at`).set(auth(leitor)).expect(200)).body;
    check('sítio', mineIn(at.items));
    const near = (await api().get(`/api/v1/feed/place?label=${encodeURIComponent(label)}&mode=near`).set(auth(leitor)).expect(200)).body;
    check('perto do sítio', mineIn(near.items));
    expect(twoDp(near.center.lat) && twoDp(near.center.lng)).toBe(true); // o ponto do sítio também
    const found = (await api().get(`/api/v1/search?q=${encodeURIComponent(`privacidade${run}`)}`).set(auth(leitor)).expect(200)).body;
    check('pesquisa', mineIn(found.posts));
    await api().put(`/api/v1/posts/${p.id}/save`).set(auth(leitor)).expect(200);
    check('guardados', mineIn((await api().get('/api/v1/feed/saved').set(auth(leitor)).expect(200)).body.items));
    // O mapa "Publicações" do À tua volta.
    const pin = ((await nearby(leitor, 'kinds=posts').expect(200)).body.posts as { id: string; lat: number; lng: number }[]).find((x) => x.id === p.id);
    expect(pin && { lat: pin.lat, lng: pin.lng }).toEqual(want);
    // Um repost mostra a original também com 2 casas.
    const rp = (await api().post(`/api/v1/posts/${p.id}/repost`).set(auth(leitor)).send({}).expect((r) => { if (r.status >= 400) throw new Error(`repost ${r.status}`); })).body;
    const rpSeen = (await api().get(`/api/v1/posts/${rp.id ?? rp.post?.id}`).set(auth(leitor))).body as { repostOf?: PostDto; original?: PostDto };
    const orig = rpSeen.repostOf ?? rpSeen.original;
    if (orig) expect(orig.locationGeo).toEqual(want);
  });

  it('publicada como um local no mapa: vai a posição do local; se o local sair do mapa, nenhuma', async () => {
    const v = await venue('pub', dono, C.lat + 0.031234, C.lng - 0.021987);
    const vlat = (await pool.query('SELECT lat, lng FROM content.venues WHERE id = $1', [v.id])).rows[0] as { lat: number; lng: number };
    const p = (await api().post('/api/v1/posts').set(auth(dono)).send({ body: `como local ${run}`, venueId: v.id, locationLat: C.lat, locationLng: C.lng }).expect(201)).body as PostDto;
    expect(p.locationGeo).toEqual({ lat: vlat.lat, lng: vlat.lng });
    // Grava-se a do local, tal como está (é um sítio público).
    expect((await pool.query('SELECT location_lat, location_lng FROM content.posts WHERE id = $1', [p.id])).rows[0]).toEqual({ location_lat: vlat.lat, location_lng: vlat.lng });
    expect((await api().get(`/api/v1/posts/${p.id}`).set(auth(leitor)).expect(200)).body.locationGeo).toEqual({ lat: vlat.lat, lng: vlat.lng });
    // A página "perto deste sítio" usa a posição do local enquanto está no mapa.
    const label = encodeURIComponent(`Decisão pub ${run}`);
    const before = (await api().get(`/api/v1/feed/place?label=${label}&mode=near`).set(auth(leitor)).expect(200)).body;
    expect(before.hasNear).toBe(true);
    expect(before.items.map((x: PostDto) => x.id)).toContain(p.id);

    // O local sai do mapa: a posição não sai para quem não o gere (detalhe, feed, sítio) e não conta para o "perto".
    await pool.query('UPDATE content.venues SET show_on_map = false WHERE id = $1', [v.id]);
    expect((await api().get(`/api/v1/posts/${p.id}`).set(auth(leitor)).expect(200)).body.locationGeo).toBeNull();
    const feedItem = ((await api().get('/api/v1/posts?limit=50').set(auth(leitor)).expect(200)).body.items as PostDto[]).find((x) => x.id === p.id);
    expect(feedItem?.locationGeo ?? null).toBeNull();
    const at = (await api().get(`/api/v1/feed/place?label=${label}&mode=at`).set(auth(leitor)).expect(200)).body;
    expect((at.items as PostDto[]).find((x) => x.id === p.id)?.locationGeo).toBeNull(); // continua na lista pelo nome, sem posição
    const after = (await api().get(`/api/v1/feed/place?label=${label}&mode=near`).set(auth(leitor)).expect(200)).body;
    expect(after.hasNear).toBe(false);
    expect(after.center).toBeNull();
    expect(after.items).toEqual([]);
    expect(((await nearby(leitor, 'kinds=posts').expect(200)).body.posts as { id: string }[]).map((x) => x.id)).not.toContain(p.id);
    // Quem gere o local continua a ver a posição do local (como na página do local).
    expect((await api().get(`/api/v1/posts/${p.id}`).set(auth(dono)).expect(200)).body.locationGeo).toEqual({ lat: vlat.lat, lng: vlat.lng });
  });

  it('a exportação de dados traz a morada e a posição dos meus locais (e se aparecem no mapa)', async () => {
    const x = await signup('dexp');
    const v = await venue('exp', x, C.lat + 0.041234, C.lng + 0.012345);
    await pool.query("UPDATE content.venues SET address = 'Rua do Teste 1', city = 'Maputo', show_on_map = false WHERE id = $1", [v.id]);
    const exp = JSON.parse((await api().get('/api/v1/me/export').set(auth(x)).expect(200)).text) as { venuesOwned: Record<string, unknown>[] };
    const row = (await pool.query('SELECT lat, lng FROM content.venues WHERE id = $1', [v.id])).rows[0];
    expect(exp.venuesOwned).toEqual([expect.objectContaining({ slug: v.slug, address: 'Rua do Teste 1', city: 'Maputo', lat: row.lat, lng: row.lng, showOnMap: false })]);
  });

  it('eventos de locais de contas apagadas não aparecem no mapa nem na pesquisa do mapa', async () => {
    const quem = await signup('dapag');
    const v = await venue('apagado', quem, C.lat + 0.01, C.lng);
    const ev = (await api().post('/api/v1/events').set(auth(quem)).send({ venueSlug: v.slug, title: `Festa fantasma ${run}`, startsAt: new Date(Date.now() + 2 * 86_400_000).toISOString() }).expect(201)).body as { id: string };
    const ids = (xs: { id: string }[]) => xs.map((e) => e.id);
    const search = () => api().get(`/api/v1/nearby/places?q=${encodeURIComponent(`fantasma ${run}`)}&lat=${C.lat}&lng=${C.lng}`).set(auth(leitor)).expect(200);
    expect(ids((await nearby(leitor, 'kinds=events').expect(200)).body.events)).toContain(ev.id);
    expect(ids((await search()).body.events)).toContain(ev.id);
    await pool.query("UPDATE identity.users SET status = 'deleted' WHERE id = $1", [quem.id]);
    expect(ids((await nearby(leitor, 'kinds=events').expect(200)).body.events)).not.toContain(ev.id);
    expect(ids((await search()).body.events)).not.toContain(ev.id);
    expect(((await nearby(leitor, 'kinds=venues').expect(200)).body.venues as { slug: string }[]).map((x) => x.slug)).not.toContain(v.slug);
  });

  it('as contagens por local e por evento continuam certas (contadas só para as linhas finais); há índice do mapa', async () => {
    const v = await venue('contas', dono, C.lat + 0.02, C.lng + 0.01);
    await pool.query('INSERT INTO content.checkins (id, venue_id, user_id) VALUES (gen_random_uuid(), $1, $2), (gen_random_uuid(), $1, $3)', [v.id, leitor.id, autor.id]);
    await pool.query('INSERT INTO content.venue_follows (venue_id, user_id) VALUES ($1, $2)', [v.id, leitor.id]);
    const ev = (await api().post('/api/v1/events').set(auth(dono)).send({ venueSlug: v.slug, title: `Contas ${run}`, startsAt: new Date(Date.now() + 86_400_000).toISOString() }).expect(201)).body as { id: string };
    await api().put(`/api/v1/events/${ev.id}/interest`).set(auth(leitor)).expect(200);
    const body = (await nearby(leitor, 'kinds=venues,events').expect(200)).body;
    expect(body.venues.find((x: { slug: string }) => x.slug === v.slug)).toMatchObject({ checkinsToday: 2, followers: 1 });
    expect(body.events.find((x: { id: string }) => x.id === ev.id)).toMatchObject({ interested: 1 });
    const d = body.venues.map((x: { distanceKm: number }) => x.distanceKm);
    expect(d).toEqual([...d].sort((a: number, b: number) => a - b));
    expect((await pool.query("SELECT 1 FROM pg_indexes WHERE schemaname = 'content' AND indexname = 'venues_map_geo_idx'")).rowCount).toBe(1);
  });

  it('DELETE /nearby/presence: apaga a minha presença, dá 200 mesmo sem presença (sair da conta) e pede sessão', async () => {
    const x = await signup('dpres');
    expect((await api().delete('/api/v1/nearby/presence').set(auth(x)).expect(200)).body).toEqual({ visible: false });
    await api().put('/api/v1/nearby/settings').set(auth(x)).send({ visibility: 'mutual' }).expect(200);
    await api().post('/api/v1/nearby/presence').set(auth(x)).send({ lat: C.lat, lng: C.lng }).expect(200);
    expect((await pool.query('SELECT 1 FROM nearby.presence WHERE user_id = $1', [x.id])).rowCount).toBe(1);
    expect((await api().delete('/api/v1/nearby/presence').set(auth(x)).expect(200)).body).toEqual({ visible: false });
    expect((await pool.query('SELECT 1 FROM nearby.presence WHERE user_id = $1', [x.id])).rowCount).toBe(0);
    // A definição de quem me vê fica (só a presença sai).
    expect((await api().get('/api/v1/nearby/settings').set(auth(x)).expect(200)).body.visibility).toBe('mutual');
    await api().delete('/api/v1/nearby/presence').expect(401);
  });

  it('TxillGroups no mapa: o fim do grupo conta pelo dia de Maputo, não pelo de UTC', async () => {
    if (!(await app.get(SchemaProbe).bits()).groups) return;
    // O dia de hoje em Maputo, calculado fora da base.
    const maputo = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Maputo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const dayBefore = new Date(Date.parse(`${maputo}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    const mk = async (name: string, endsOn: string) =>
      (await pool.query(
        `INSERT INTO social.groups (id, name, created_by, visibility, starts_on, ends_on, map_lat, map_lng, map_label)
         VALUES (gen_random_uuid(), $1, $2, 'public', $3::date, $3::date, $4, $5, 'Ponto') RETURNING id`,
        [name, dono.id, endsOn, C.lat + 0.015, C.lng + 0.015],
      )).rows[0].id as string;
    const today = await mk(`Hoje ${run}`, maputo);
    const yesterday = await mk(`Ontem ${run}`, dayBefore);
    const ids = ((await nearby(leitor, 'kinds=groups').expect(200)).body.groups as { id: string }[]).map((g) => g.id);
    expect(ids).toContain(today);
    expect(ids).not.toContain(yesterday);
  });

  it('as minhas publicações não aparecem no meu À tua volta (nem em "Tudo"); os meus locais e eventos sim; eu não estou na malta', async () => {
    const media = await upload(dono);
    const mine = (await api().post('/api/v1/posts').set(auth(dono)).send({ body: `minha ${run}`, locationLabel: 'Aqui', locationLat: C.lat + 0.01, locationLng: C.lng, mediaIds: [media] }).expect(201)).body as PostDto;
    const v = await venue('meu', dono, C.lat + 0.005, C.lng);
    const ev = (await api().post('/api/v1/events').set(auth(dono)).send({ venueSlug: v.slug, title: `O meu evento ${run}`, startsAt: new Date(Date.now() + 86_400_000).toISOString() }).expect(201)).body as { id: string };
    const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
    for (const qs of ['kinds=posts', '']) {
      const b = (await nearby(dono, qs).expect(200)).body;
      expect(ids(b.posts)).not.toContain(mine.id);
      if (qs === '') {
        expect((b.venues as { slug: string }[]).map((x) => x.slug)).toContain(v.slug);
        expect(ids(b.events)).toContain(ev.id);
      }
    }
    // Os outros veem-na.
    expect(ids((await nearby(leitor, 'kinds=posts').expect(200)).body.posts)).toContain(mine.id);
    // Reposts e presentes nunca entram (só publicações normais).
    const rp = (await api().post(`/api/v1/posts/${mine.id}/repost`).set(auth(leitor)).send({}).expect((r) => { if (r.status >= 400) throw new Error(`repost ${r.status}`); })).body as { id?: string };
    if (rp.id) expect(ids((await nearby(leitor, 'kinds=posts').expect(200)).body.posts)).not.toContain(rp.id);
    // Eu não apareço na malta, mesmo visível e com seguidores mútuos.
    await pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2), ($2, $1) ON CONFLICT DO NOTHING', [dono.id, leitor.id]);
    await api().put('/api/v1/nearby/settings').set(auth(dono)).send({ visibility: 'mutual' }).expect(200);
    await api().post('/api/v1/nearby/presence').set(auth(dono)).send({ lat: C.lat, lng: C.lng }).expect(200);
    const malta = (u: U) => nearby(u, 'kinds=people').expect(200).then((r) => (r.body.people as { username: string }[]).map((x) => x.username));
    expect(await malta(dono)).not.toContain(dono.username);
    expect(await malta(leitor)).toContain(dono.username);
  });
});
