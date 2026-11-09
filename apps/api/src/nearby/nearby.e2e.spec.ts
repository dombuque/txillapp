import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { getStorageToken } from '@nestjs/throttler';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { snapToCell } from './geo-sql';
import { NearbyService } from './nearby.service';
import { SchemaProbe } from './schema-probe';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

interface U { token: string; id: string; username: string }

describe('À tua volta: locais, eventos, publicações, TxillGroups e a malta (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  // Um sítio ao calhas no meio do Pacífico Sul, para não chocar com dados de corridas antigas.
  const C = { lat: Math.round((-55 + Math.random() * 30) * 100) / 100, lng: Math.round((-150 + Math.random() * 40) * 100) / 100 };
  let dono: U, gestor: U, cliente: U, autor: U, privado: U, bloqueado: U, menor: U;
  const venues: Record<string, string> = {}; // nome curto -> slug
  const mine = (slugs: { slug: string }[]) => slugs.map((v) => v.slug).filter((s) => s.endsWith(run));

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
  async function venue(key: string, dLat: number, owner: U) {
    const slug = `t-${key}-${run}`;
    await pool.query(
      `INSERT INTO content.venues (id, slug, name, kind, lat, lng, owner_id, check_token, review_status) VALUES (gen_random_uuid(), $1, $2, 'bar', $3, $4, $5, 'x', 'approved')`,
      [slug, `Sítio ${key} ${run}`, Math.round((C.lat + dLat) * 1000) / 1000, C.lng, owner.id],
    );
    venues[key] = slug;
    return slug;
  }
  async function post(x: U, dLat: number, label = 'Praia') {
    const media = await upload(x);
    const r = await api().post('/api/v1/posts').set(auth(x)).send({ body: `perto ${run}`, locationLabel: label, locationLat: C.lat + dLat, locationLng: C.lng, mediaIds: [media] }).expect(201);
    return r.body.id as string;
  }
  const nearby = (x: U, qs: string) => api().get(`/api/v1/nearby?lat=${C.lat}&lng=${C.lng}&${qs}`).set(auth(x));
  // Os limites de pedidos contam por IP e aqui é tudo do mesmo: começa-se cada teste do zero.
  const resetThrottle = () => {
    const s = app.get(getStorageToken()) as { storage: Map<string, unknown>; hitExpirations?: Map<string, unknown> };
    s.storage.clear();
    s.hitExpirations?.clear();
  };
  const follow = (a: U, b: U) => pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [a.id, b.id]);
  const unfollow = (a: U, b: U) => pool.query('DELETE FROM social.follows WHERE follower_id = $1 AND followee_id = $2', [a.id, b.id]);
  const block = (a: U, b: U) => pool.query('INSERT INTO social.blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [a.id, b.id]);
  const unblock = (a: U, b: U) => pool.query('DELETE FROM social.blocks WHERE blocker_id = $1 AND blocked_id = $2', [a.id, b.id]);

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'd'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    dono = await signup('ndono');
    gestor = await signup('ngest');
    cliente = await signup('ncli');
    autor = await signup('naut');
    privado = await signup('npriv');
    bloqueado = await signup('nbloq');
    menor = await signup('nmen');
    await venue('perto', 0.01, dono); // ~1,1 km
    await venue('meio', 0.05, dono); // ~5,6 km
    await venue('longe', 0.15, dono); // ~16,7 km
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  beforeEach(() => resetThrottle());

  it('locais por ordem de distância e só dentro do raio; o raio vai de 5 a 30 km', async () => {
    const r10 = (await nearby(cliente, 'radiusKm=10&kinds=venues').expect(200)).body;
    expect(r10.center).toEqual(C);
    expect(r10.radiusKm).toBe(10);
    expect(mine(r10.venues)).toEqual([venues.perto, venues.meio]);
    expect(r10.events).toEqual([]);
    expect(r10.people).toEqual([]);
    const v = r10.venues.find((x: { slug: string }) => x.slug === venues.perto);
    expect(v).toMatchObject({ kind: 'bar', verified: false, checkinsToday: 0, followers: 0, avatarUrl: null });
    expect(v.distanceKm).toBeGreaterThan(0.9);
    expect(v.distanceKm).toBeLessThan(1.3);
    const sorted = r10.venues.map((x: { distanceKm: number }) => x.distanceKm);
    expect(sorted).toEqual([...sorted].sort((a, b) => a - b));

    const r20 = (await nearby(cliente, 'radiusKm=20&kinds=venues').expect(200)).body;
    expect(mine(r20.venues)).toEqual([venues.perto, venues.meio, venues.longe]);

    // Check-ins das últimas 24 horas.
    await pool.query("INSERT INTO content.checkins (id, venue_id, user_id) SELECT gen_random_uuid(), v.id, $2 FROM content.venues v WHERE v.slug = $1", [venues.perto, cliente.id]);
    await pool.query("INSERT INTO content.checkins (id, venue_id, user_id, created_at) SELECT gen_random_uuid(), v.id, $2, now() - interval '2 days' FROM content.venues v WHERE v.slug = $1", [venues.perto, cliente.id]);
    const again = (await nearby(cliente, 'kinds=venues').expect(200)).body;
    expect(again.radiusKm).toBe(10); // por omissão
    expect(again.venues.find((x: { slug: string }) => x.slug === venues.perto).checkinsToday).toBe(1);

    await nearby(cliente, 'radiusKm=4').expect(400);
    await nearby(cliente, 'radiusKm=31').expect(400);
    await nearby(cliente, 'kinds=venues,pizzas').expect(400);
    await nearby(cliente, 'when=amanha').expect(400);
    await api().get('/api/v1/nearby?lat=91&lng=0').set(auth(cliente)).expect(400);
    await api().get('/api/v1/nearby').set(auth(cliente)).expect(400);
  });

  it('arredonda a posição de quem pede: 6 casas decimais dão o mesmo que 2', async () => {
    const two = (await nearby(cliente, 'kinds=venues').expect(200)).body;
    const six = (await api().get(`/api/v1/nearby?lat=${(C.lat + 0.001234).toFixed(6)}&lng=${(C.lng - 0.002345).toFixed(6)}&kinds=venues`).set(auth(cliente)).expect(200)).body;
    expect(six.center).toEqual(C);
    expect(six).toEqual(two);
  });

  it('eventos: só quem gere o local cria, muda e cancela; tenho interesse; próximos eventos; aparecem no mapa', async () => {
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString();
    await api().post('/api/v1/events').set(auth(cliente)).send({ venueSlug: venues.perto, title: 'Intruso', startsAt: soon }).expect(403);
    await api().post('/api/v1/events').set(auth(dono)).send({ venueSlug: 'nao-existe-xyz', title: 'Nada', startsAt: soon }).expect(404);
    await api().post('/api/v1/events').set(auth(dono)).send({ venueSlug: venues.perto, title: 'Passado', startsAt: new Date(Date.now() - 5 * 3_600_000).toISOString() }).expect(400);
    await api().post('/api/v1/events').set(auth(dono)).send({ venueSlug: venues.perto, title: 'Ao contrário', startsAt: soon, endsAt: new Date(Date.now() + 86_400_000).toISOString() }).expect(400);
    await api().post('/api/v1/events').set(auth(dono)).send({ venueSlug: venues.perto, title: 'x'.repeat(81), startsAt: soon }).expect(400);

    const cover = await upload(dono);
    const ev = (await api().post('/api/v1/events').set(auth(dono)).send({ venueSlug: venues.perto, title: 'Noite de kizomba', description: 'Entrada livre até às 22h', startsAt: soon, coverMediaId: cover }).expect(201)).body;
    expect(ev).toMatchObject({ title: 'Noite de kizomba', description: 'Entrada livre até às 22h', endsAt: null, coverUrl: `/api/v1/media/${cover}`, interested: 0, imInterested: false, cancelled: false, canManage: true });
    expect(ev.venue).toMatchObject({ slug: venues.perto, verified: false, avatarUrl: null });
    expect(typeof ev.venue.lat).toBe('number');

    // O gestor pendente ainda não pode; activo já pode.
    await pool.query("INSERT INTO content.venue_managers (venue_id, user_id, role, status) SELECT id, $2, 'editor', 'pending' FROM content.venues WHERE slug = $1", [venues.perto, gestor.id]);
    await api().patch(`/api/v1/events/${ev.id}`).set(auth(gestor)).send({ title: 'Kizomba e semba' }).expect(403);
    await pool.query("UPDATE content.venue_managers SET status = 'active' WHERE user_id = $1", [gestor.id]);
    const ends = new Date(Date.parse(soon) + 5 * 3_600_000).toISOString();
    const patched = (await api().patch(`/api/v1/events/${ev.id}`).set(auth(gestor)).send({ title: 'Kizomba e semba', endsAt: ends }).expect(200)).body;
    expect(patched.title).toBe('Kizomba e semba');
    expect(patched.endsAt).toBe(ends);
    await api().patch(`/api/v1/events/${ev.id}`).set(auth(cliente)).send({ title: 'Meu' }).expect(403);
    await api().delete(`/api/v1/events/${ev.id}`).set(auth(cliente)).expect(403);

    // Tenho interesse (e tirar).
    expect((await api().put(`/api/v1/events/${ev.id}/interest`).set(auth(cliente)).expect(200)).body).toEqual({ interested: 1, imInterested: true });
    await api().put(`/api/v1/events/${ev.id}/interest`).set(auth(cliente)).expect(200); // repetir não conta a dobrar
    const seen = (await api().get(`/api/v1/events/${ev.id}`).set(auth(cliente)).expect(200)).body;
    expect(seen).toMatchObject({ interested: 1, imInterested: true, canManage: false });
    await api().put(`/api/v1/events/${ev.id}/interest`).set(auth(autor)).expect(200);
    expect((await api().delete(`/api/v1/events/${ev.id}/interest`).set(auth(cliente)).expect(200)).body).toEqual({ interested: 1, imInterested: false });

    // A decorrer agora (começou há meia hora).
    const live = (await api().post('/api/v1/events').set(auth(dono)).send({ venueSlug: venues.meio, title: 'Jogo no ecrã grande', startsAt: new Date(Date.now() - 30 * 60_000).toISOString() }).expect(201)).body;

    const up = (await api().get(`/api/v1/venues-events/${venues.perto}`).set(auth(cliente)).expect(200)).body.items as { id: string }[];
    expect(up.map((e) => e.id)).toEqual([ev.id]);
    await api().get('/api/v1/venues-events/nao-existe-xyz').set(auth(cliente)).expect(404);

    const week = (await nearby(cliente, 'kinds=events').expect(200)).body.events as { id: string; venue: { slug: string }; distanceKm: number; interested: number }[];
    expect(week.map((e) => e.id)).toEqual(expect.arrayContaining([ev.id, live.id]));
    expect(week.findIndex((e) => e.id === ev.id)).toBeLessThan(week.findIndex((e) => e.id === live.id)); // mais perto primeiro
    expect(week.find((e) => e.id === ev.id)).toMatchObject({ title: 'Kizomba e semba', interested: 1, coverUrl: `/api/v1/media/${cover}`, venue: { slug: venues.perto } });
    const now = (await nearby(cliente, 'kinds=events&when=now').expect(200)).body.events as { id: string }[];
    expect(now.map((e) => e.id)).toContain(live.id);
    expect(now.map((e) => e.id)).not.toContain(ev.id);
    const today = (await nearby(cliente, 'kinds=events&when=today').expect(200)).body.events as { id: string }[];
    expect(today.map((e) => e.id)).not.toContain(ev.id);

    // Pesquisa da caixa do mapa.
    const found = (await api().get(`/api/v1/nearby/places?q=${encodeURIComponent('kizomba')}&lat=${C.lat}&lng=${C.lng}`).set(auth(cliente)).expect(200)).body;
    expect(found.events.map((e: { id: string }) => e.id)).toContain(ev.id);
    const byName = (await api().get(`/api/v1/nearby/places?q=${encodeURIComponent(`longe ${run}`)}&lat=${C.lat}&lng=${C.lng}`).set(auth(cliente)).expect(200)).body;
    expect(mine(byName.venues)).toEqual([venues.longe]);

    // Cancelar: sai das listas e do mapa; já não dá para marcar interesse.
    const cancelled = (await api().delete(`/api/v1/events/${ev.id}`).set(auth(dono)).expect(200)).body;
    expect(cancelled.cancelled).toBe(true);
    expect((await api().get(`/api/v1/venues-events/${venues.perto}`).set(auth(cliente)).expect(200)).body.items).toEqual([]);
    expect(((await nearby(cliente, 'kinds=events').expect(200)).body.events as { id: string }[]).map((e) => e.id)).not.toContain(ev.id);
    await api().put(`/api/v1/events/${ev.id}/interest`).set(auth(cliente)).expect(400);
    await api().patch(`/api/v1/events/${ev.id}`).set(auth(dono)).send({ title: 'Volta' }).expect(400);
  });

  it('publicações: só das últimas 48 h, respeitando contas privadas, bloqueios e sem menores; até 3 por pessoa', async () => {
    const p1 = await post(autor, 0.02);
    const p2 = await post(autor, 0.021);
    const p3 = await post(autor, 0.022);
    const p4 = await post(autor, 0.023);
    const old = await post(autor, 0.01);
    await pool.query("UPDATE content.posts SET created_at = now() - interval '49 hours' WHERE id = $1", [old]);
    await pool.query('UPDATE identity.users SET is_private = true WHERE id = $1', [privado.id]);
    const priv = await post(privado, 0.02);
    const blk = await post(bloqueado, 0.02);
    await block(bloqueado, cliente);
    await pool.query("UPDATE identity.users SET birth_date = current_date - interval '15 years' WHERE id = $1", [menor.id]);
    const kid = await post(menor, 0.02);
    const far = await post(autor, 0.3); // ~33 km

    const ids = async () => ((await nearby(cliente, 'kinds=posts&radiusKm=30').expect(200)).body.posts as { id: string }[]).map((p) => p.id);
    const got = await ids();
    expect(got).not.toContain(old);
    expect(got).not.toContain(priv);
    expect(got).not.toContain(blk);
    expect(got).not.toContain(kid);
    expect(got).not.toContain(far);
    // Até 3 por autor: as 3 mais recentes.
    expect(got.filter((id) => [p1, p2, p3, p4].includes(id)).sort()).toEqual([p2, p3, p4].sort());

    const item = ((await nearby(cliente, 'kinds=posts').expect(200)).body.posts as Record<string, unknown>[]).find((p) => p.id === p4)!;
    expect(item).toMatchObject({ kind: 'photo', locationLabel: 'Praia', author: { username: autor.username, displayName: 'naut Teste' } });
    expect(item.thumbUrl).toMatch(/^\/api\/v1\/media\/[0-9a-f-]{36}$/);
    expect(typeof item.code).toBe('string');
    expect(typeof item.createdAt).toBe('string');

    // Seguir a conta privada abre as publicações; o bloqueio vale nos dois sentidos.
    await follow(cliente, privado);
    expect(await ids()).toContain(priv);
    await unblock(bloqueado, cliente);
    expect(await ids()).toContain(blk);
    await block(cliente, bloqueado);
    expect(await ids()).not.toContain(blk);
    await unblock(cliente, bloqueado);
  });

  it('TxillGroups: só públicos com o plano num local com posição; a secção fica vazia se as colunas ainda não existirem', async () => {
    const probe = app.get(SchemaProbe);
    const bits = await probe.bits();
    if (bits.groups) {
      const pub = (await pool.query(
        `INSERT INTO social.groups (id, name, created_by, kind, visibility, destination, plan_venue_id, starts_on)
         SELECT gen_random_uuid(), 'Fim de semana na praia', $2, 'fim_de_semana', 'public', 'Ponta do Ouro', v.id, current_date + 2 FROM content.venues v WHERE v.slug = $1 RETURNING id`,
        [venues.meio, dono.id],
      )).rows[0].id as string;
      await pool.query("INSERT INTO social.group_members (group_id, user_id, role) VALUES ($1, $2, 'admin'), ($1, $3, 'member')", [pub, dono.id, autor.id]);
      const priv = (await pool.query(
        `INSERT INTO social.groups (id, name, created_by, visibility, plan_venue_id) SELECT gen_random_uuid(), 'Secreto', $2, 'private', v.id FROM content.venues v WHERE v.slug = $1 RETURNING id`,
        [venues.meio, dono.id],
      )).rows[0].id as string;
      const textOnly = (await pool.query(`INSERT INTO social.groups (id, name, created_by, visibility, destination) VALUES (gen_random_uuid(), 'Só texto', $1, 'public', 'Tofo') RETURNING id`, [dono.id])).rows[0].id as string;

      const groups = (await nearby(cliente, 'kinds=groups').expect(200)).body.groups as Record<string, unknown>[];
      const ids = groups.map((g) => g.id);
      expect(ids).toContain(pub);
      expect(ids).not.toContain(priv);
      expect(ids).not.toContain(textOnly);
      expect(groups.find((g) => g.id === pub)).toMatchObject({ name: 'Fim de semana na praia', kind: 'fim_de_semana', destination: 'Ponta do Ouro', members: 2, coverUrl: null });

      // Quem foi bloqueado pelo criador não vê o grupo.
      await block(dono, cliente);
      expect(((await nearby(cliente, 'kinds=groups').expect(200)).body.groups as { id: string }[]).map((g) => g.id)).not.toContain(pub);
      await unblock(dono, cliente);
    }
    probe.override({ groups: false, accepts: bits.accepts });
    try {
      expect((await nearby(cliente, 'kinds=groups').expect(200)).body.groups).toEqual([]);
    } finally {
      probe.override(null);
    }
  });

  describe('a malta à tua volta', () => {
    let ana: U, beto: U, carla: U, dino: U;
    const people = async (x: U) => (await nearby(x, 'kinds=people').expect(200)).body.people as { username: string; lat: number; lng: number; ago: string; approxKm: number }[];
    const names = async (x: U) => (await people(x)).map((p) => p.username);
    const at = (x: U, dLat = 0, dLng = 0) => api().post('/api/v1/nearby/presence').set(auth(x)).send({ lat: C.lat + dLat, lng: C.lng + dLng });

    beforeAll(async () => {
      resetThrottle();
      ana = await signup('nana');
      beto = await signup('nbeto');
      carla = await signup('ncarla');
      dino = await signup('ndino');
    });

    it('desligado por omissão e invisível; mútuos e "quem eu sigo"; quadrícula de ~1,5 km', async () => {
      expect((await api().get('/api/v1/nearby/settings').set(auth(ana)).expect(200)).body).toEqual({ visibility: 'off', canEnable: true });
      await at(ana).expect(400); // ainda desligado
      await follow(ana, cliente);
      expect(await names(cliente)).not.toContain(ana.username);

      expect((await api().put('/api/v1/nearby/settings').set(auth(ana)).send({ visibility: 'mutual' }).expect(200)).body).toEqual({ visibility: 'mutual', canEnable: true });
      await api().put('/api/v1/nearby/settings').set(auth(ana)).send({ visibility: 'todos' }).expect(400);

      // Duas posições exatas na mesma quadrícula dão o mesmo centro.
      const base = { lat: snapToCell(C.lat), lng: snapToCell(C.lng) };
      const pa = (await api().post('/api/v1/nearby/presence').set(auth(ana)).send({ lat: base.lat + 0.003, lng: base.lng - 0.002 }).expect(200)).body;
      expect(pa).toEqual({ visible: true, cell: base, expiresInMin: 180 });
      await api().put('/api/v1/nearby/settings').set(auth(dino)).send({ visibility: 'following' }).expect(200);
      const pd = (await api().post('/api/v1/nearby/presence').set(auth(dino)).send({ lat: base.lat - 0.004, lng: base.lng + 0.005 }).expect(200)).body;
      expect(pd.cell).toEqual(pa.cell);
      const raw = (await pool.query('SELECT * FROM nearby.presence WHERE user_id = $1', [ana.id])).rows[0];
      expect(Object.keys(raw).sort()).toEqual(['cell_lat', 'cell_lng', 'updated_at', 'user_id']);
      expect([Number(raw.cell_lat), Number(raw.cell_lng)]).toEqual([base.lat, base.lng]);

      // Mútuo: a Ana segue-me mas eu ainda não a sigo, por isso não a vejo.
      expect(await names(cliente)).not.toContain(ana.username);
      await follow(cliente, ana);
      const seen = (await people(cliente)).find((p) => p.username === ana.username)!;
      expect(seen).toMatchObject({ lat: base.lat, lng: base.lng, ago: 'agora', displayName: 'nana Teste', hasAvatar: false });
      expect(seen.approxKm).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(seen.approxKm)).toBe(true);
      expect(seen).not.toHaveProperty('updatedAt');

      // "Quem eu sigo": o Dino segue-me, chega (sem eu o seguir). A Ana não se vê a si própria.
      await follow(dino, cliente);
      expect(await names(cliente)).toEqual(expect.arrayContaining([ana.username, dino.username]));
      expect(await names(ana)).not.toContain(ana.username);
      // O Dino não segue a Ana: a Ana não o vê.
      expect(await names(ana)).not.toContain(dino.username);

      // A Carla liga "quem eu sigo" mas não me segue: invisível para mim.
      await api().put('/api/v1/nearby/settings').set(auth(carla)).send({ visibility: 'following' }).expect(200);
      await at(carla).expect(200);
      await follow(cliente, carla);
      expect(await names(cliente)).not.toContain(carla.username);

      // Fora do raio não aparece.
      await api().put('/api/v1/nearby/settings').set(auth(beto)).send({ visibility: 'following' }).expect(200);
      await follow(beto, cliente);
      await at(beto, 0.2).expect(200); // ~22 km
      expect(await names(cliente)).not.toContain(beto.username);
      expect((await api().get(`/api/v1/nearby?lat=${C.lat}&lng=${C.lng}&kinds=people&radiusKm=30`).set(auth(cliente)).expect(200)).body.people.map((p: { username: string }) => p.username)).toContain(beto.username);
    });

    it('bloqueios, menores, expira em 3 h, DELETE limpa e desligar apaga', async () => {
      // Bloqueio em qualquer sentido.
      await block(cliente, dino);
      expect(await names(cliente)).not.toContain(dino.username);
      await unblock(cliente, dino);
      await block(dino, cliente);
      expect(await names(cliente)).not.toContain(dino.username);
      await unblock(dino, cliente);
      expect(await names(cliente)).toContain(dino.username);

      // Menores: não ligam e não veem ninguém (o Dino segue-o).
      await follow(dino, menor);
      expect((await api().get('/api/v1/nearby/settings').set(auth(menor)).expect(200)).body).toEqual({ visibility: 'off', canEnable: false });
      await api().put('/api/v1/nearby/settings').set(auth(menor)).send({ visibility: 'mutual' }).expect(400);
      await api().put('/api/v1/nearby/settings').set(auth(menor)).send({ visibility: 'off' }).expect(200);
      expect(await people(menor)).toEqual([]);
      // Quem fica menor depois de ligar também desaparece do mapa.
      await pool.query("UPDATE identity.users SET birth_date = current_date - interval '16 years' WHERE id = $1", [dino.id]);
      expect(await names(cliente)).not.toContain(dino.username);
      await pool.query("UPDATE identity.users SET birth_date = '1990-06-15' WHERE id = $1", [dino.id]);

      // Uma actualização por minuto: a segunda logo a seguir não muda a quadrícula.
      const first = (await at(dino).expect(200)).body.cell;
      const second = (await at(dino, 0.05).expect(200)).body.cell;
      expect(second).toEqual(first);

      // Expira passadas 3 horas; a varredura apaga.
      await pool.query("UPDATE nearby.presence SET updated_at = now() - interval '25 minutes' WHERE user_id = $1", [ana.id]);
      expect((await people(cliente)).find((p) => p.username === ana.username)?.ago).toBe('há 25 min');
      await pool.query("UPDATE nearby.presence SET updated_at = now() - interval '3 hours 1 minute' WHERE user_id = $1", [ana.id]);
      expect(await names(cliente)).not.toContain(ana.username);
      expect(await app.get(NearbyService).sweep()).toBeGreaterThanOrEqual(1);
      expect((await pool.query('SELECT 1 FROM nearby.presence WHERE user_id = $1', [ana.id])).rowCount).toBe(0);

      // DELETE limpa logo.
      expect((await api().delete('/api/v1/nearby/presence').set(auth(dino)).expect(200)).body).toEqual({ visible: false });
      expect(await names(cliente)).not.toContain(dino.username);

      // Desligar apaga a presença.
      await pool.query("UPDATE nearby.presence SET updated_at = now() - interval '2 minutes' WHERE user_id = $1", [beto.id]);
      await api().put('/api/v1/nearby/settings').set(auth(beto)).send({ visibility: 'off' }).expect(200);
      expect((await pool.query('SELECT 1 FROM nearby.presence WHERE user_id = $1', [beto.id])).rowCount).toBe(0);
    });
  });

  it('limite de pedidos: 30 por minuto', async () => {
    for (let i = 0; i < 30; i++) await nearby(cliente, 'kinds=venues').expect(200);
    await nearby(cliente, 'kinds=venues').expect(429);
  });
});
