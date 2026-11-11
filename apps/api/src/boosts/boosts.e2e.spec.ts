import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { getStorageToken } from '@nestjs/throttler';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { staffLogin } from '../staff/staff-test';
import { ISSUANCE_ACCOUNT, WalletService } from '../wallet/wallet.service';
import { boostRefund, feedSlotPositions } from './boost-config';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const LABEL = 'Bombado · Patrocinado';

interface U { token: string; id: string; username: string }
interface V { slug: string; id: string; qrToken?: string }
interface Slot { campaignId: string; afterId: string | null; label: string; kind: 'post' | 'event'; venue: { slug: string; name: string }; post: { id: string; sponsored?: boolean } | null; event: { id: string } | null }
interface Campaign { id: string; state: string; price: number; refunded: number; radiusKm: number; package: string; report: { impressions: number; people: number; taps: number; interested: number | null; checkins: number; checkinsAfterSeeing: number; feedImpressions: number; mapImpressions: number } }

describe('Bombar: destaques pagos dos locais (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  let n = 0;
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  // Um sítio ao calhas no meio do Pacífico Sul, para não chocar com dados de outros testes.
  const C = { lat: Math.round((-50 + Math.random() * 20) * 100) / 100, lng: Math.round((-140 + Math.random() * 30) * 100) / 100 };
  const FAR = { lat: C.lat + 0.3, lng: C.lng }; // ~33 km a norte
  const near = (x: { lat: number; lng: number }) => `lat=${x.lat}&lng=${x.lng}`;
  let dono: U, admin: U, editor: U, ana: U, longe: U, menor: U, semData: U, bloq: U, cap: U, outra: U;
  let venue: V, pobre: V, analise: V;
  let eventId: string, postId: string;
  let evCamp: Campaign, postCamp: Campaign;

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}${n++}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').set('X-Forwarded-For', `10.9.0.${(n % 250) + 1}`)
      .send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  const resetThrottle = () => {
    const s = app.get(getStorageToken()) as { storage: Map<string, unknown>; hitExpirations?: Map<string, unknown> };
    s.storage.clear();
    s.hitExpirations?.clear();
  };
  const approve = (id: string) => pool.query("UPDATE content.venues SET review_status = 'approved' WHERE id = $1", [id]);
  async function fund(venueId: string, amount: number) {
    const w = app.get(WalletService);
    const acc = await w.ensureVenueWallet(venueId);
    await w.move({ type: 'topup', actorId: dono.id, idempotencyKey: `fund-${venueId}-${amount}-${n++}`, lock: [acc], legs: [[ISSUANCE_ACCOUNT, -amount], [acc, amount]], metadata: { test: true } });
  }
  const balance = async (venueId: string) => Number((await pool.query('SELECT balance FROM ledger.accounts WHERE venue_id = $1', [venueId])).rows[0]?.balance ?? 0);
  const feed = async (u: U, at: { lat: number; lng: number } | null = C) => (await api().get(`/api/v1/feed${at ? `?${near(at)}` : ''}`).set(auth(u)).expect(200)).body as { items: { id: string }[]; nextCursor: string | null; sponsored?: Slot[] };
  const ours = (s: Slot[] | undefined) => (s ?? []).filter((x) => x.venue.slug === venue.slug);
  const create = (u: U, slug: string, body: Record<string, unknown>, key = `k-${run}-${n++}`) => api().post(`/api/v1/boosts/venue/${slug}`).set(auth(u)).set('Idempotency-Key', key).send(body);
  const list = async (u: U, slug = venue.slug) => (await api().get(`/api/v1/boosts/venue/${slug}`).set(auth(u)).expect(200)).body as { balance: number; active: Campaign[]; past: Campaign[] };
  const find = async (id: string) => { const l = await list(dono); return [...l.active, ...l.past].find((c) => c.id === id)!; };

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'b'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    [dono, admin, editor, ana, longe, menor, semData, bloq, cap, outra] = await Promise.all(['bdono', 'badm', 'bedi', 'bana', 'blonge', 'bmenor', 'bsem', 'bbloq', 'bcap', 'boutra'].map(signup));
    await pool.query("UPDATE identity.users SET birth_date = current_date - interval '16 years' WHERE id = $1", [menor.id]);
    await pool.query('UPDATE identity.users SET birth_date = NULL WHERE id = $1', [semData.id]);

    venue = (await api().post('/api/v1/venues').set(auth(dono)).send({ name: `Bar Bombado ${run}`, kind: 'bar', lat: C.lat + 0.004, lng: C.lng + 0.003, city: 'Maputo' }).expect(201)).body;
    pobre = (await api().post('/api/v1/venues').set(auth(dono)).send({ name: `Bar Teso ${run}`, kind: 'bar', lat: C.lat + 0.002, lng: C.lng }).expect(201)).body;
    analise = (await api().post('/api/v1/venues').set(auth(dono)).send({ name: `Bar Novo ${run}`, kind: 'discoteca', lat: C.lat, lng: C.lng + 0.002 }).expect(201)).body;
    await approve(venue.id);
    await approve(pobre.id);
    for (const [u, role] of [[admin, 'admin'], [editor, 'editor']] as const) {
      await api().post(`/api/v1/venues/${venue.slug}/managers`).set(auth(dono)).send({ username: u.username, role }).expect(201);
      await api().post(`/api/v1/venues/${venue.slug}/managers/accept`).set(auth(u)).expect(200);
    }
    await fund(venue.id, 20_000);

    const starts = new Date(Date.now() + 3_600_000).toISOString();
    const ends = new Date(Date.now() + 3 * 86_400_000).toISOString();
    eventId = (await api().post('/api/v1/events').set(auth(dono)).send({ venueSlug: venue.slug, title: `Noite de kizomba ${run}`, startsAt: starts, endsAt: ends }).expect(201)).body.id;
    postId = (await api().post('/api/v1/posts').set(auth(editor)).send({ body: `Hoje há gelada a 50 ${run}`, venueId: venue.id }).expect(201)).body.id;
  }, 90_000);

  beforeEach(() => resetThrottle());

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('regras puras: posições no feed e devolução por dias inteiros', () => {
    expect(feedSlotPositions(0, 10)).toEqual([3]);
    expect(feedSlotPositions(10, 10)).toEqual([14]);
    expect(feedSlotPositions(0, 30)).toEqual([3, 14, 25]);
    expect(feedSlotPositions(4, 9)).toEqual([]);
    const t0 = new Date('2026-11-11T12:00:00Z');
    const c = { price: 8000, days: 7, startsAt: t0, endsAt: new Date(t0.getTime() + 7 * 86_400_000) };
    expect(boostRefund(c, new Date(t0.getTime() - 1000))).toBe(8000); // ainda não começou: tudo
    expect(boostRefund(c, new Date(t0.getTime() + 60_000))).toBe(Math.floor((8000 * 6) / 7)); // o 1.º dia já conta
    expect(boostRefund(c, new Date(t0.getTime() + 6.5 * 86_400_000))).toBe(0);
  });

  it('opções: pacotes e preços por raio, saldo e alvos; os editores não entram', async () => {
    const o = (await api().get(`/api/v1/boosts/venue/${venue.slug}/options`).set(auth(dono)).expect(200)).body;
    expect(o).toMatchObject({ canBoost: true, blocker: null, balance: 20_000, label: LABEL });
    const p1 = o.packages.find((p: { id: string }) => p.id === '1d');
    expect(p1.prices[3]).toBe(1500);
    expect(p1.prices[1]).toBe(1500);
    expect(p1.prices[10]).toBe(2550);
    expect(o.packages.find((p: { id: string }) => p.id === '7d').prices[3]).toBe(8000);
    expect(o.payments).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'txills', enabled: true }), expect.objectContaining({ id: 'mzn', enabled: false })]));
    expect(o.targets.events.map((e: { id: string }) => e.id)).toContain(eventId);
    expect(o.targets.posts.map((p: { id: string }) => p.id)).toContain(postId);
    await api().get(`/api/v1/boosts/venue/${venue.slug}/options`).set(auth(editor)).expect(403);
    await api().get(`/api/v1/boosts/venue/${venue.slug}/options`).set(auth(ana)).expect(403);
    await api().get(`/api/v1/boosts/venue/${venue.slug}`).set(auth(editor)).expect(403);
  });

  it('criar uma campanha debita a carteira do local no livro (tipo boost) e é idempotente', async () => {
    const key = `ev-${run}`;
    const body = { target: { kind: 'event', id: eventId }, package: '1d', radiusKm: 3 };
    const r = (await create(dono, venue.slug, body, key).expect(201)).body;
    expect(r).toMatchObject({ balance: 18_500, replayed: false, campaign: { state: 'active', price: 1500, radiusKm: 3, package: '1d', refunded: 0, review: 'auto', label: LABEL } });
    evCamp = r.campaign;
    expect(await balance(venue.id)).toBe(18_500);
    const tx = (await pool.query(`SELECT t.id, t.type FROM ledger.transactions t JOIN content.boost_campaigns c ON c.charge_tx_id = t.id WHERE c.id = $1`, [evCamp.id])).rows[0];
    expect(tx.type).toBe('boost');
    const legs = (await pool.query('SELECT account_id, amount FROM ledger.entries WHERE transaction_id = $1 ORDER BY amount', [tx.id])).rows.map((x) => Number(x.amount));
    expect(legs).toEqual([-1500, 1500]);

    // A mesma chave outra vez: a mesma campanha, sem segundo débito.
    const again = (await create(dono, venue.slug, body, key).expect(201)).body;
    expect(again).toMatchObject({ replayed: true, balance: 18_500, campaign: { id: evCamp.id } });
    expect(Number((await pool.query('SELECT count(*) FROM content.boost_campaigns WHERE venue_id = $1', [venue.id])).rows[0].count)).toBe(1);
    expect(await balance(venue.id)).toBe(18_500);
    const audit = (await pool.query("SELECT action, metadata FROM audit.audit_log WHERE target = $1", [`boost:${evCamp.id}`])).rows;
    expect(audit).toEqual([expect.objectContaining({ action: 'boost.created', metadata: expect.objectContaining({ review: 'auto', price: 1500 }) })]);

    // Um evento que acaba antes de uma campanha de 7 dias: recusado.
    await create(dono, venue.slug, { target: { kind: 'event', id: eventId }, package: '7d', radiusKm: 3 }).expect(422);
  });

  it('um administrador bomba uma publicação do local (raio maior, preço maior); um editor não pode', async () => {
    await create(editor, venue.slug, { target: { kind: 'post', id: postId }, package: '3d', radiusKm: 5 }).expect(403);
    const r = (await create(admin, venue.slug, { target: { kind: 'post', id: postId }, package: '3d', radiusKm: 5 }).expect(201)).body;
    expect(r.campaign).toMatchObject({ price: 4800, radiusKm: 5, state: 'active' });
    postCamp = r.campaign;
    expect(await balance(venue.id)).toBe(18_500 - 4800);
    // Um alvo de outro local não serve; um raio fora de 1–10 também não.
    await create(dono, pobre.slug, { target: { kind: 'post', id: postId }, package: '1d', radiusKm: 3 }).expect(404);
    await create(dono, venue.slug, { target: { kind: 'post', id: postId }, package: '1d', radiusKm: 11 }).expect(400);
  });

  it('sem saldo dá erro e não cria nada; meticais ainda desligados', async () => {
    const ev = (await api().post('/api/v1/events').set(auth(dono)).send({ venueSlug: pobre.slug, title: `Jogo no ecrã ${run}`, startsAt: new Date(Date.now() + 3_600_000).toISOString() }).expect(201)).body.id;
    const r = await create(dono, pobre.slug, { target: { kind: 'event', id: ev }, package: '1d', radiusKm: 3 }).expect(422);
    expect(r.body.message).toMatch(/Txills suficientes/);
    expect(Number((await pool.query('SELECT count(*) FROM content.boost_campaigns WHERE venue_id = $1', [pobre.id])).rows[0].count)).toBe(0);
    expect(await balance(pobre.id)).toBe(0);
    const m = await create(dono, venue.slug, { target: { kind: 'event', id: eventId }, package: '1d', radiusKm: 3, payment: 'mzn' }).expect(422);
    expect(m.body.message).toMatch(/meticais/);
  });

  it('um local não aprovado ou fora do mapa não pode bombar', async () => {
    await fund(analise.id, 5000);
    const body = { target: { kind: 'post', id: postId }, package: '1d', radiusKm: 3 };
    const o = (await api().get(`/api/v1/boosts/venue/${analise.slug}/options`).set(auth(dono)).expect(200)).body;
    expect(o.canBoost).toBe(false);
    expect((await create(dono, analise.slug, body).expect(422)).body.message).toMatch(/aprovado/);
    await approve(analise.id);
    await api().patch(`/api/v1/venues/${analise.slug}`).set(auth(dono)).send({ showOnMap: false }).expect(200);
    expect((await create(dono, analise.slug, body).expect(422)).body.message).toMatch(/Mostrar no mapa/);
    expect(await balance(analise.id)).toBe(5000);
  });

  it('aparece no feed a quem está no raio, com a etiqueta; não a quem está fora nem sem posição', async () => {
    const page = await feed(ana);
    const mine = ours(page.sponsored);
    expect(mine.length).toBe(1);
    expect(mine[0].label).toBe(LABEL);
    expect([evCamp.id, postCamp.id]).toContain(mine[0].campaignId);
    if (mine[0].kind === 'post') expect(mine[0].post).toMatchObject({ id: postId, sponsored: true });
    else expect(mine[0].event).toMatchObject({ id: eventId });
    if (mine[0].afterId) expect(page.items.map((i) => i.id)).toContain(mine[0].afterId);
    expect(ours((await feed(longe, FAR)).sponsored)).toEqual([]);
    // Sem posição: o feed vem como sempre, sem destaques.
    expect((await feed(ana, null)).sponsored).toBeUndefined();
  });

  it('não aparece a menores nem a quem não tem data de nascimento (feed e mapa)', async () => {
    expect(ours((await feed(menor)).sponsored)).toEqual([]);
    expect(ours((await feed(semData)).sponsored)).toEqual([]);
    const m = (await api().get(`/api/v1/nearby?${near(C)}&kinds=venues,events`).set(auth(menor)).expect(200)).body;
    expect(m.venues.filter((v: { boosted: unknown }) => v.boosted)).toEqual([]);
    expect(m.events.filter((e: { boosted: unknown }) => e.boosted)).toEqual([]);
  });

  it('não aparece a quem tem bloqueio com o dono, nem a quem escondeu os destaques do local', async () => {
    expect(ours((await feed(bloq)).sponsored).length).toBe(1);
    await pool.query('INSERT INTO social.blocks (blocker_id, blocked_id) VALUES ($1, $2)', [bloq.id, dono.id]);
    expect(ours((await feed(bloq)).sponsored)).toEqual([]);
    const s = ours((await feed(outra)).sponsored);
    expect(s.length).toBe(1);
    await api().post(`/api/v1/boosts/${s[0].campaignId}/hide`).set(auth(outra)).expect(204);
    expect(ours((await feed(outra)).sponsored)).toEqual([]);
  });

  it('respeita o limite de 3 vezes por dia por pessoa e campanha', async () => {
    const seen = new Map<string, number>();
    let empty = 0;
    for (let i = 0; i < 9; i++) {
      const s = ours((await feed(cap)).sponsored);
      expect(s.length).toBeLessThanOrEqual(1);
      if (!s.length) empty++;
      for (const x of s) seen.set(x.campaignId, (seen.get(x.campaignId) ?? 0) + 1);
    }
    expect([...seen.values()].every((v) => v <= 3)).toBe(true);
    expect([...seen.values()].reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(3);
    expect(empty).toBeGreaterThanOrEqual(3);
    const rows = (await pool.query("SELECT campaign_id, count(*)::int AS n FROM content.boost_impressions WHERE user_id = $1 AND kind = 'view' AND surface = 'feed' GROUP BY 1", [cap.id])).rows;
    expect(rows.every((r) => r.n <= 3)).toBe(true);
  });

  it('o mapa realça o evento e o local bombados e põe-nos no topo', async () => {
    const m = (await api().get(`/api/v1/nearby?${near(C)}&kinds=venues,events`).set(auth(ana)).expect(200)).body;
    expect(m.events[0]).toMatchObject({ id: eventId, boosted: { campaignId: evCamp.id, label: LABEL } });
    expect(m.venues[0]).toMatchObject({ slug: venue.slug, boosted: { campaignId: postCamp.id, label: LABEL } });
    expect(m.venues.find((v: { slug: string }) => v.slug === pobre.slug)?.boosted ?? null).toBeNull();
    // Refrescar o mapa logo a seguir não conta outra impressão.
    await api().get(`/api/v1/nearby?${near(C)}&kinds=venues,events`).set(auth(ana)).expect(200);
    const n = (await pool.query("SELECT count(*)::int AS n FROM content.boost_impressions WHERE user_id = $1 AND campaign_id = $2 AND surface = 'map'", [ana.id, evCamp.id])).rows[0].n;
    expect(n).toBe(1);
  });

  it('o relatório conta impressões, pessoas, toques, interesse e check-ins (só totais)', async () => {
    const before = await find(evCamp.id);
    // Toque de quem viu conta; de quem nunca o viu, não.
    await api().post(`/api/v1/boosts/${evCamp.id}/tap`).set(auth(ana)).send({ surface: 'map' }).expect(204);
    await api().post(`/api/v1/boosts/${evCamp.id}/tap`).set(auth(menor)).send({ surface: 'feed' }).expect(204);
    await api().put(`/api/v1/events/${eventId}/interest`).set(auth(ana)).expect(200);
    const token = (await api().get(`/api/v1/venues/${venue.slug}`).set(auth(dono)).expect(200)).body.qrToken as string;
    await api().post(`/api/v1/venues/${venue.slug}/checkin`).set(auth(ana)).send({ token }).expect(201);
    await api().post(`/api/v1/venues/${venue.slug}/checkin`).set(auth(menor)).send({ token }).expect(201);
    const r = await find(evCamp.id);
    expect(r.report.taps).toBe(before.report.taps + 1);
    expect(r.report.impressions).toBeGreaterThanOrEqual(1);
    expect(r.report.impressions).toBe(r.report.feedImpressions + r.report.mapImpressions);
    expect(r.report.people).toBeGreaterThanOrEqual(1);
    expect(r.report.people).toBeLessThanOrEqual(r.report.impressions);
    expect(r.report.interested).toBe(1);
    expect(r.report.checkins).toBe(2);
    expect(r.report.checkinsAfterSeeing).toBe(1);
    const exact = (await pool.query("SELECT count(*) FILTER (WHERE kind = 'view')::int AS v, count(DISTINCT user_id) FILTER (WHERE kind = 'view')::int AS p FROM content.boost_impressions WHERE campaign_id = $1", [evCamp.id])).rows[0];
    expect(r.report.impressions).toBe(exact.v);
    expect(r.report.people).toBe(exact.p);
    // Nunca quem viu.
    expect(JSON.stringify(await list(dono))).not.toContain(ana.username);
    expect(JSON.stringify(await list(dono))).not.toContain(ana.id);
  });

  it('parar: com devolução dos dias inteiros que faltam, sem devolução no último dia, e agendada devolve tudo', async () => {
    await api().post(`/api/v1/boosts/${postCamp.id}/stop`).set(auth(editor)).expect(403);
    const b0 = await balance(venue.id);
    const s = (await api().post(`/api/v1/boosts/${postCamp.id}/stop`).set(auth(admin)).expect(200)).body;
    expect(s.refunded).toBe(Math.floor((4800 * 2) / 3)); // 3 dias, o 1.º já conta como gasto
    expect(s.campaign).toMatchObject({ state: 'stopped', refunded: 3200 });
    expect(await balance(venue.id)).toBe(b0 + 3200);
    expect((await pool.query("SELECT count(*)::int AS n FROM ledger.transactions WHERE type = 'boost_refund' AND metadata->>'campaignId' = $1", [postCamp.id])).rows[0].n).toBe(1);
    await api().post(`/api/v1/boosts/${postCamp.id}/stop`).set(auth(dono)).expect(409);

    const b1 = await balance(venue.id);
    const e = (await api().post(`/api/v1/boosts/${evCamp.id}/stop`).set(auth(dono)).expect(200)).body;
    expect(e).toMatchObject({ refunded: 0, campaign: { state: 'stopped', refunded: 0 } });
    expect(await balance(venue.id)).toBe(b1);

    // Parada: já não aparece no feed nem no mapa.
    expect(ours((await feed(ana)).sponsored)).toEqual([]);
    const m = (await api().get(`/api/v1/nearby?${near(C)}&kinds=venues,events`).set(auth(ana)).expect(200)).body;
    expect([...m.venues, ...m.events].filter((x: { boosted: unknown }) => x.boosted)).toEqual([]);

    // Agendada para daqui a 2 dias e parada antes de começar: devolve tudo.
    const sched = (await create(dono, venue.slug, { target: { kind: 'post', id: postId }, package: '1d', radiusKm: 3, startsAt: new Date(Date.now() + 2 * 86_400_000).toISOString() }).expect(201)).body;
    expect(sched.campaign.state).toBe('scheduled');
    const b2 = await balance(venue.id);
    expect(ours((await feed(ana)).sponsored)).toEqual([]); // ainda não começou
    const st = (await api().post(`/api/v1/boosts/${sched.campaign.id}/stop`).set(auth(dono)).expect(200)).body;
    expect(st.refunded).toBe(1500);
    expect(await balance(venue.id)).toBe(b2 + 1500);
    const l = await list(dono);
    expect(l.past.map((c) => c.id)).toEqual(expect.arrayContaining([postCamp.id, evCamp.id, sched.campaign.id]));
  });

  it('a equipa vê, suspende (com registo na auditoria) e repõe', async () => {
    const c = (await create(dono, venue.slug, { target: { kind: 'post', id: postId }, package: '1d', radiusKm: 2 }).expect(201)).body.campaign as Campaign;
    const st = await staffLogin(app, 'bombar', ['moderacao']);
    const sa = { Authorization: `Bearer ${st.token}` };
    const live = (await api().get('/api/v1/venues/admin/boosts').set(sa).expect(200)).body as { id: string }[];
    expect(live.map((x) => x.id)).toContain(c.id);
    expect([401, 403]).toContain((await api().get('/api/v1/venues/admin/boosts').set(auth(dono))).status);
    const s = (await api().put(`/api/v1/venues/admin/boosts/${c.id}/suspend`).set(sa).send({ note: 'teste' }).expect(200)).body;
    expect(s).toMatchObject({ refunded: 0, campaign: { state: 'suspended', note: 'teste' } });
    expect(ours((await feed(ana)).sponsored)).toEqual([]);
    const r = (await api().put(`/api/v1/venues/admin/boosts/${c.id}/reinstate`).set(sa).expect(200)).body;
    expect(r.campaign.state).toBe('active');
    const actions = (await pool.query('SELECT action FROM audit.audit_log WHERE target = $1 ORDER BY created_at', [`boost:${c.id}`])).rows.map((x) => x.action);
    expect(actions).toEqual(['boost.created', 'moderation.boost_suspended', 'moderation.boost_reinstated']);
  });
});
