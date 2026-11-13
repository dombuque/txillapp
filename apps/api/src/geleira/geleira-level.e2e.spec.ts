import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { geleiraLevel, PERSON_WEEK_MAX, refreshLevel, type LevelRow } from './geleira-level';
import { GeleiraLevelService } from './geleira-level.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const DAY = 86_400_000;

interface P { id: string; username: string }
interface U extends P { token: string; ip: string }

/**
 * O nível da geleira (0146): cada fonte de pontos, os limites, o anti-batota, a janela de 90 dias (relógio falso), o álcool
 * sem efeito, o detalhe só para o dono, o post da geleira com o mesmo nível, a descida gradual e, no fim, a simulação dos
 * ritmos (quem é ativo chega a «Maningue abastecida» em cerca de um mês; o topo pede constância e muita gente diferente).
 */
describe('nível da geleira: o que se vive com a malta (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}`, 'X-Forwarded-For': x.ip });
  let seq = 0;
  let items: string[] = [];
  let FANTA: string;
  let barOwner: P;

  /** Conta criada pela API (para os pedidos com sessão). */
  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    seq++;
    const ip = `10.146.${seq >> 8}.${seq & 255}`;
    const r = await api().post('/api/v1/auth/register').set('X-Forwarded-For', ip)
      .send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
    return { token: r.body.accessToken, id: r.body.user.id, username, ip };
  }
  /** Conta criada direto na base (rápido: para as simulações). */
  async function mk(name: string): Promise<P> {
    const id = randomUUID();
    const username = `${name}${run}${++seq}`.slice(0, 28);
    await pool.query(`INSERT INTO identity.users (id, email, username, display_name, birth_date) VALUES ($1, $2, $3, $4, '1995-06-15')`, [id, `${username}@example.com`, username, `${name} Sim`]);
    return { id, username };
  }
  const mutual = (a: P, b: P) => pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2), ($2, $1) ON CONFLICT DO NOTHING', [a.id, b.id]);
  const drink = (alcoholic: boolean) => (alcoholic ? ['beb-2m', '2M', 'cerveja', true] : ['beb-fanta', 'Fanta', 'refrigerante', false]);
  /** Uma gelada paga e confirmada no livro: quem devia pagou a quem recebia. */
  const paid = (debtor: P, creditor: P, at: Date, alcoholic = false) =>
    pool.query(
      `INSERT INTO taste.gelada_debts (id, debtor_id, creditor_id, drink_slug, drink_name, drink_category, alcoholic, source, status, paid_claimed_at, closed_at, created_at)
       VALUES (gen_random_uuid(), $1, $2, $4, $5, $6, $7, 'manual', 'paid', $3, $3, $3)`,
      [debtor.id, creditor.id, at, ...drink(alcoholic)],
    );
  /** Um pedido aceite («Bora!»): quem recebeu o pedido paga a quem pediu. */
  const accepted = (requester: P, recipient: P, at: Date, alcoholic = false) =>
    pool.query(
      `INSERT INTO taste.gelada_requests (id, requester_id, recipient_id, drink_slug, drink_name, drink_category, alcoholic, channel, status, answered_at, created_at)
       VALUES (gen_random_uuid(), $1, $2, $4, $5, $6, $7, 'chat', 'accepted', $3, $3)`,
      [requester.id, recipient.id, at, ...drink(alcoholic)],
    );
  const cheerSeq = new Map<string, number>();
  /** Um brinde a um gosto (cada um num item diferente: a chave é pessoa + item). */
  const cheer = (owner: P, from: P, at: Date) => {
    const k = `${owner.id}:${from.id}`;
    const i = cheerSeq.get(k) ?? 0;
    cheerSeq.set(k, i + 1);
    return pool.query('INSERT INTO taste.geleira_item_cheers (owner_id, item_id, user_id, created_at) VALUES ($1, $2, $3, $4)', [owner.id, items[i], from.id, at]);
  };
  async function venue(owner: P = barOwner, approved = true) {
    const id = randomUUID();
    await pool.query(`INSERT INTO content.venues (id, slug, name, kind, owner_id, check_token, review_status) VALUES ($1, $2, $3, 'bar', $4, 'qr', $5)`, [id, `bar-${run}-${++seq}`, `Bar ${seq}`, owner.id, approved ? 'approved' : 'pending']);
    return id;
  }
  const checkin = (u: P, venueId: string, at: Date) => pool.query('INSERT INTO content.checkins (id, venue_id, user_id, created_at) VALUES (gen_random_uuid(), $1, $2, $3)', [venueId, u.id, at]);
  async function group(members: P[]) {
    const id = randomUUID();
    await pool.query(`INSERT INTO social.groups (id, name) VALUES ($1, 'Malta')`, [id]);
    for (const m of members) await pool.query('INSERT INTO social.group_members (group_id, user_id) VALUES ($1, $2)', [id, m.id]);
    return id;
  }
  /** Uma rodada fechada: quem abriu, quem pagou (ou ninguém) e quem entrou. */
  async function round(groupId: string, opener: P, payer: P | null, entrants: P[], at: Date, alcoholic = false) {
    const id = randomUUID();
    await pool.query(`INSERT INTO taste.gelada_rounds (id, group_id, opened_by, payer_id, status, closed_at, created_at) VALUES ($1, $2, $3, $4, 'closed', $5, $5)`, [id, groupId, opener.id, payer?.id ?? null, at]);
    for (const e of entrants)
      await pool.query('INSERT INTO taste.gelada_round_entries (round_id, user_id, drink_slug, drink_name, drink_category, alcoholic, created_at) VALUES ($1, $2, $4, $5, $6, $7, $3)', [id, e.id, at, ...drink(alcoholic)]);
  }
  /** Gostos na geleira: `groups` itens de grupos diferentes (com ou sem álcool), os primeiros `rated` com nota. */
  async function tastes(u: P, groups: number, rated: number, alcoholic = false) {
    const { rows } = await pool.query(
      `SELECT id FROM (SELECT DISTINCT ON (category) id, category FROM taste.items WHERE status = 'curated' AND kind IN ('bebida', 'comida') AND alcoholic = $2 ORDER BY category, name) x ORDER BY category LIMIT $1`,
      [groups, alcoholic],
    );
    expect(rows.length).toBe(groups);
    for (const [k, r] of rows.entries()) await pool.query('INSERT INTO taste.user_items (user_id, item_id, rating) VALUES ($1, $2, $3)', [u.id, r.id, k < rated ? 4 : null]);
  }
  const at = (base: Date, days: number, hours = 12) => new Date(base.getTime() + days * DAY + hours * 3_600_000);
  const level = (viewer: U, of: P) => api().get(`/api/v1/users/${of.username}/geleira/level`).set(auth(viewer));

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'n'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    items = (await pool.query(`SELECT id FROM taste.items WHERE status = 'curated' ORDER BY slug LIMIT 120`)).rows.map((r) => r.id as string);
    FANTA = (await pool.query(`SELECT md5('taste:beb-fanta')::uuid::text AS id`)).rows[0].id as string;
    barOwner = await mk('dono');
  }, 90_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('cada fonte vale o que diz a tabela (geladas, pedidos aceites, brindes de mútuos, sítios, rodadas, gostos); o detalhe e a dica só para o dono', async () => {
    const o = await signup('nvo');
    const f1 = await signup('nvf1');
    const f2 = await signup('nvf2');
    const f3 = await signup('nvf3');
    const g = await signup('nvg');
    for (const f of [f1, f2, f3]) await mutual(o, f);
    await pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2)', [g.id, o.id]); // só segue
    await api().put('/api/v1/geleira/me/settings').set(auth(o)).send({ visibility: 'everyone' }).expect(200);
    const empty = (await level(o, o).expect(200)).body;
    expect(empty).toMatchObject({ level: 0, title: 'Geleira seca', points: 0, progress: 0 });
    expect(empty.detail.geladas).toEqual({ points: 0, paid: 0, received: 0 });

    // Gelada paga e confirmada no livro: 3 a quem pagou, 2 a quem recebeu.
    const d = (await api().post('/api/v1/gelada/debts').set(auth(o)).send({ to: f1.username, itemId: FANTA }).expect(201)).body.id;
    await api().post(`/api/v1/gelada/debts/${d}/paid`).set(auth(o)).send({}).expect(200);
    expect((await level(o, o).expect(200)).body.detail.geladas.points).toBe(0); // «Já paguei» sozinho não conta
    await api().post(`/api/v1/gelada/debts/${d}/confirm`).set(auth(f1)).expect(200);
    expect((await level(o, o).expect(200)).body.detail.geladas).toEqual({ points: 3, paid: 1, received: 0 });
    expect((await level(f1, f1).expect(200)).body.detail.geladas).toEqual({ points: 2, paid: 0, received: 1 });

    // Pedido aceite («Bora!»): quem aceitou paga (3), quem pediu recebe (2). Um pedido recusado não vale nada.
    const req = (await api().post('/api/v1/gelada/requests').set(auth(f2)).send({ to: [o.username], itemId: FANTA, channel: 'chat' }).expect(201)).body.requests[0].id;
    await api().post(`/api/v1/gelada/requests/${req}/answer`).set(auth(o)).send({ answer: 'accept' }).expect(200);
    const req2 = (await api().post('/api/v1/gelada/requests').set(auth(f3)).send({ to: [o.username], itemId: FANTA, channel: 'chat' }).expect(201)).body.requests[0].id;
    await api().post(`/api/v1/gelada/requests/${req2}/answer`).set(auth(o)).send({ answer: 'decline' }).expect(200);
    expect((await level(o, o).expect(200)).body.detail.geladas).toEqual({ points: 6, paid: 2, received: 0 });
    expect((await level(f2, f2).expect(200)).body.detail.geladas).toEqual({ points: 2, paid: 0, received: 1 });

    // Brindes: 1 por pessoa (a geleira e um gosto da mesma pessoa contam uma vez); quem só segue não conta.
    const soft = (await pool.query(`SELECT id FROM taste.items WHERE status = 'curated' AND kind = 'comida' ORDER BY slug LIMIT 1`)).rows[0].id as string;
    await api().put(`/api/v1/geleira/me/items/${soft}`).set(auth(o)).send({ rating: 4 }).expect(204);
    await api().put(`/api/v1/users/${o.username}/geleira/cheer`).set(auth(f3)).expect(200);
    await api().put(`/api/v1/users/${o.username}/geleira/items/${soft}/cheer`).set(auth(f3)).expect(200);
    await api().put(`/api/v1/users/${o.username}/geleira/cheer`).set(auth(g)).expect(200);
    let me = (await level(o, o).expect(200)).body;
    expect(me.detail.brindes).toEqual({ points: 1, people: 1 });

    // Sítios: 2 por local, uma vez por semana em cada um; o meu próprio local e um local por aprovar não contam.
    const v1 = await venue();
    const v2 = await venue();
    const mine = await venue(o);
    const pending = await venue(barOwner, false);
    const now = Date.now();
    await checkin(o, v1, new Date(now - 60_000));
    await checkin(o, v1, new Date(now - 30_000));
    await checkin(o, v2, new Date(now - 20_000));
    await checkin(o, mine, new Date(now - 10_000));
    await checkin(o, pending, new Date(now - 5_000));
    me = (await level(o, o).expect(200)).body;
    expect(me.detail.sitios.points).toBeGreaterThanOrEqual(4); // dois locais (se a semana virou entre os dois do v1, são 6)
    expect(me.detail.sitios.places).toBe(2);

    // Rodadas: 1 por entrar numa rodada fechada com mais alguém, 2 por a pagar; sozinho não conta.
    const grp = await group([o, f1, f2]);
    await round(grp, o, o, [o, f1], new Date(now - 4_000));
    await round(grp, o, o, [o], new Date(now - 3_000));
    me = (await level(o, o).expect(200)).body;
    expect(me.detail.rodadas).toEqual({ points: 3, joined: 1, paid: 1 });
    expect((await level(f1, f1).expect(200)).body.detail.rodadas).toEqual({ points: 1, joined: 1, paid: 0 });

    // Gostos (base): 1 grupo e 1 gosto avaliado.
    expect(me.detail.gostos).toMatchObject({ points: 1, groups: 1, rated: 1, max: 8 });
    expect(me.points).toBe(me.detail.geladas.points + me.detail.brindes.points + me.detail.sitios.points + me.detail.rodadas.points + me.detail.gostos.points);
    expect(me.detail.people).toBe(3); // f1, f2 e f3
    expect(me).toMatchObject({ level: 1, title: 'A txilar', nextTitle: 'Maningue abastecida', steps: [0, 1, 40, 100, 180] });
    expect(me.tip).toMatch(/para chegares a Maningue abastecida\.$/);
    expect(me.progress).toBeGreaterThan(0);
    expect(me.progress).toBeLessThan(1);
    expect(me).not.toHaveProperty('tasteContribution');

    // Quem visita: o título e a barra, sem detalhe nem dica.
    const seen = (await level(f1, o).expect(200)).body;
    expect(seen).toMatchObject({ level: 1, title: 'A txilar', progress: me.progress });
    expect(seen).not.toHaveProperty('detail');
    expect(seen).not.toHaveProperty('tip');
  });

  it('limites: brindes 1 por pessoa a cada 30 dias, sítios 1 por local por semana, gostos no máximo 8, rodadas só com mais alguém', async () => {
    const NOW = new Date('2026-06-10T12:00:00Z'); // quarta-feira
    const o = await mk('lim');
    const [a, b, c] = [await mk('lima'), await mk('limb'), await mk('limc')];
    await mutual(o, a);
    await mutual(o, b);
    await pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2)', [c.id, o.id]); // não é mútuo
    for (let i = 0; i < 4; i++) await cheer(o, a, at(NOW, -1, -i));
    await cheer(o, a, at(NOW, -40));
    await cheer(o, a, at(NOW, -75));
    await cheer(o, b, at(NOW, -2));
    await cheer(o, c, at(NOW, -2));
    let r = await refreshLevel(pool, o.id, NOW);
    expect(r.breakdown.brindes).toEqual({ points: 4, people: 2 }); // a: 3 meses = 3; b: 1; c: nada

    const v = await venue();
    const w = await venue();
    await checkin(o, v, at(NOW, -2, 0)); // segunda
    await checkin(o, v, at(NOW, -1, 0)); // terça: a mesma semana
    await checkin(o, v, at(NOW, -9, 0)); // a semana passada
    await checkin(o, w, at(NOW, -1, 3));
    r = await refreshLevel(pool, o.id, NOW);
    expect(r.breakdown.sitios).toEqual({ points: 6, places: 2, visits: 3 });

    await tastes(o, 12, 12);
    r = await refreshLevel(pool, o.id, NOW);
    expect(r.breakdown.gostos).toMatchObject({ points: 8, groups: 12, rated: 12 });

    const grp = await group([o, a]);
    await round(grp, o, o, [o], at(NOW, -1));
    r = await refreshLevel(pool, o.id, NOW);
    expect(r.breakdown.rodadas).toEqual({ points: 0, joined: 0, paid: 0 });
    await round(grp, a, null, [o, a], at(NOW, -1)); // ninguém pagou: entrar conta (de quem abriu)
    r = await refreshLevel(pool, o.id, NOW);
    expect(r.breakdown.rodadas).toEqual({ points: 1, joined: 1, paid: 0 });
  });

  it(`anti-batota: a mesma pessoa vale no máximo ${PERSON_WEEK_MAX} pontos por semana; bloqueadas, suspensas e eliminadas não contam`, async () => {
    const NOW = new Date('2026-06-12T18:00:00Z'); // sexta
    const o = await mk('bat');
    const fake = await mk('batf');
    await mutual(o, fake);
    for (let i = 0; i < 10; i++) await paid(o, fake, at(NOW, -2, -i)); // 10 geladas na mesma semana (30 pontos)
    for (let i = 0; i < 5; i++) await cheer(o, fake, at(NOW, -1, -i));
    let r = await refreshLevel(pool, o.id, NOW);
    expect(r.breakdown.geladas.points + r.breakdown.brindes.points).toBe(PERSON_WEEK_MAX);
    expect(r.breakdown.people).toBe(1);
    await paid(o, fake, at(NOW, -8)); // outra semana: o teto recomeça
    r = await refreshLevel(pool, o.id, NOW);
    expect(r.breakdown.geladas.points).toBe(PERSON_WEEK_MAX + 3);
    expect(r.level).toBe(1); // muitos pontos de uma pessoa só não passam de «A txilar»

    // Bloqueio (em qualquer sentido), conta suspensa ou eliminada: nada conta.
    const [bl, su, de] = [await mk('batb'), await mk('bats'), await mk('batd')];
    const o2 = await mk('bato');
    for (const x of [bl, su, de]) {
      await mutual(o2, x);
      await paid(o2, x, at(NOW, -1));
      await cheer(o2, x, at(NOW, -1));
    }
    r = await refreshLevel(pool, o2.id, NOW);
    expect(r.breakdown.geladas.points).toBe(9);
    expect(r.breakdown.brindes.points).toBe(3);
    await pool.query('INSERT INTO social.blocks (blocker_id, blocked_id) VALUES ($1, $2)', [bl.id, o2.id]);
    await pool.query(`UPDATE identity.users SET status = 'suspended' WHERE id = $1`, [su.id]);
    await pool.query(`UPDATE identity.users SET status = 'deleted' WHERE id = $1`, [de.id]);
    r = await refreshLevel(pool, o2.id, NOW);
    expect(r.breakdown).toMatchObject({ geladas: { points: 0 }, brindes: { points: 0 }, people: 0 });
    expect(r.points).toBe(0);
  });

  it('janela de 90 dias (relógio falso): o que tem mais de 90 dias ou ainda não aconteceu não conta', async () => {
    const NOW = new Date('2026-06-10T12:00:00Z');
    const o = await mk('jan');
    const f = await mk('janf');
    const v = await venue();
    await mutual(o, f);
    await paid(o, f, at(NOW, -89));
    await paid(f, o, at(NOW, -91));
    await checkin(o, v, at(NOW, -95));
    await paid(o, f, at(NOW, 3)); // no futuro (para este relógio)
    let r = await refreshLevel(pool, o.id, NOW);
    expect(r.breakdown.geladas).toEqual({ points: 3, paid: 1, received: 0 });
    expect(r.breakdown.sitios.points).toBe(0);
    r = await refreshLevel(pool, o.id, at(NOW, 2, 0)); // dois dias depois: a de -89 já tem 91
    expect(r.breakdown.geladas).toEqual({ points: 0, paid: 0, received: 0 });
    r = await refreshLevel(pool, o.id, at(NOW, 4, 0)); // e a do futuro já aconteceu
    expect(r.breakdown.geladas).toEqual({ points: 3, paid: 1, received: 0 });
  });

  it('o álcool nunca conta: geladas, rodadas e gostos com álcool valem o mesmo que os de refresco', async () => {
    const NOW = new Date('2026-06-10T12:00:00Z');
    const results: LevelRow[] = [];
    for (const alcoholic of [true, false]) {
      const o = await mk(alcoholic ? 'alc' : 'ref');
      const [a, b] = [await mk('alca'), await mk('alcb')];
      await mutual(o, a);
      await mutual(o, b);
      await paid(o, a, at(NOW, -3), alcoholic);
      await paid(b, o, at(NOW, -10), alcoholic);
      await accepted(o, b, at(NOW, -17), alcoholic);
      await round(await group([o, a, b]), o, o, [o, a, b], at(NOW, -24), alcoholic);
      await tastes(o, 3, 2, alcoholic);
      results.push(await refreshLevel(pool, o.id, NOW));
    }
    expect(results[0].points).toBeGreaterThan(0);
    expect(results[0].points).toBe(results[1].points);
    expect(results[0].breakdown).toEqual(results[1].breakdown);
    expect(results[0].level).toBe(results[1].level);
  });

  it('a cache: mudar uma fonte marca a conta como desatualizada; a leitura e a volta de hora a hora refazem', async () => {
    const o = await mk('cac');
    const f = await mk('cacf');
    await mutual(o, f);
    const first = await geleiraLevel(pool, o.id);
    expect(first.points).toBe(0);
    await paid(o, f, new Date(Date.now() - 60_000));
    expect((await pool.query('SELECT stale FROM taste.geleira_levels WHERE user_id = $1', [o.id])).rows[0].stale).toBe(true);
    expect((await geleiraLevel(pool, o.id)).points).toBe(3); // a leitura refaz
    expect((await pool.query('SELECT stale FROM taste.geleira_levels WHERE user_id = $1', [o.id])).rows[0].stale).toBe(false);
    // Fresca e sem mudanças: a leitura não refaz (a mesma hora de cálculo).
    expect((await geleiraLevel(pool, o.id)).computedAt.getTime()).toBe((await geleiraLevel(pool, o.id)).computedAt.getTime());

    // A volta de hora a hora: refaz quem mudou e quem tem pontos com mais de uma hora.
    await checkin(o, await venue(), new Date(Date.now() - 30_000));
    await app.get(GeleiraLevelService).run();
    const row = (await pool.query('SELECT points, stale FROM taste.geleira_levels WHERE user_id = $1', [o.id])).rows[0];
    expect(row).toEqual({ points: 5, stale: false });
    await pool.query(`UPDATE taste.geleira_levels SET computed_at = now() - interval '2 hours' WHERE user_id = $1`, [o.id]);
    await app.get(GeleiraLevelService).run();
    expect(Date.now() - new Date((await pool.query('SELECT computed_at FROM taste.geleira_levels WHERE user_id = $1', [o.id])).rows[0].computed_at).getTime()).toBeLessThan(60_000);
  });

  it('o post da geleira leva o mesmo nível do perfil', async () => {
    const o = await signup('nvpost');
    const [a, b] = [await mk('nvpa'), await mk('nvpb')];
    await mutual(o, a);
    await mutual(o, b);
    const [v1, v2] = [await venue(), await venue()];
    const now = new Date();
    for (let w = 0; w < 4; w++) {
      await paid(o, a, at(now, -7 * w - 1, 0));
      await paid(o, b, at(now, -7 * w - 1, 1));
      await checkin(o, v1, at(now, -7 * w - 2, 0));
      await checkin(o, v2, at(now, -7 * w - 2, 1));
    }
    await tastes(o, 4, 0);
    const lv = (await level(o, o).expect(200)).body;
    expect(lv.level).toBe(2);
    const post = (await api().post('/api/v1/posts').set(auth(o)).send({ geleira: true }).expect(201)).body;
    expect(post.geleira.level).toBe(lv.level);
  });

  it('a descida é gradual: no máximo um nível por semana; a subida é logo', async () => {
    const NOW = new Date('2026-06-10T12:00:00Z');
    const o = await mk('des');
    await pool.query(`INSERT INTO taste.geleira_levels (user_id, points, level, breakdown, computed_at) VALUES ($1, 300, 4, '{}', $2)`, [o.id, at(NOW, -1)]);
    const steps: [number, number][] = [[0, 3], [3, 3], [6, 3], [7, 2], [13, 2], [14, 1], [20, 1], [21, 0], [40, 0]];
    for (const [d, want] of steps) expect([d, (await refreshLevel(pool, o.id, at(NOW, d, 0))).level]).toEqual([d, want]);

    // Volta a sair: sobe logo (sem esperar a semana).
    const [a, b] = [await mk('desa'), await mk('desb')];
    await mutual(o, a);
    await mutual(o, b);
    const t = at(NOW, 40, 0);
    for (let w = 0; w < 4; w++) {
      await paid(o, a, at(t, -7 * w - 1));
      await paid(o, b, at(t, -7 * w - 1, 13));
      await accepted(a, o, at(t, -7 * w - 2));
      await accepted(b, o, at(t, -7 * w - 2, 13));
    }
    const up = await refreshLevel(pool, o.id, t);
    expect(up.breakdown.raw).toBe(2);
    expect(up.level).toBe(2);
  });

  /**
   * A simulação dos ritmos (relógio falso, um cálculo por dia, eventos guardados na base como acontecem na vida):
   * - «ativa»: 2 geladas por semana (paga uma, recebe outra), 1 brinde, 2 check-ins, com 6 amigos → «Maningue abastecida» em
   *   cerca de um mês; «Paulada garantida» só depois de umas 9 a 10 semanas seguidas; o topo nunca;
   * - «enche a geleira»: muitos gostos, nada com a malta → fica em «A txilar»;
   * - «batoteira»: uma conta falsa, geladas, brindes e rodadas todos os dias → teto de 6 por semana e nunca passa de «A txilar»;
   * - «lenda»: 4 geladas, 3 brindes, 3 check-ins e 1 rodada por semana com 12 amigos → topo em cerca de 9 a 10 semanas;
   *   depois para de sair (dia 90) → desce um degrau de cada vez, com pelo menos 7 dias entre descidas.
   */
  it('simulação: os ritmos de subida e de descida', async () => {
    const START = new Date('2026-01-05T00:00:00Z'); // segunda-feira
    const venues = [await venue(), await venue(), await venue(), await venue()];
    const series = async (u: P, days: number) => {
      const out: LevelRow[] = [];
      for (let d = 0; d <= days; d++) out.push(await refreshLevel(pool, u.id, at(START, d, 21)));
      return out;
    };
    const firstDay = (s: LevelRow[], lv: number) => s.findIndex((r) => r.level >= lv);

    // Ativa.
    const ativa = await mk('ativa');
    const fa = await Promise.all(Array.from({ length: 6 }, (_, k) => mk(`fa${k}`)));
    for (const f of fa) await mutual(ativa, f);
    await tastes(ativa, 3, 3); // 3 grupos e 3 notas: 4 pontos
    for (let k = 0; k < 18; k++) {
      await paid(ativa, fa[(2 * k) % 6], at(START, 7 * k + 2));
      await cheer(ativa, fa[k % 6], at(START, 7 * k + 3));
      await checkin(ativa, venues[k % 3], at(START, 7 * k + 4));
      await accepted(ativa, fa[(2 * k + 1) % 6], at(START, 7 * k + 5)); // pediu e o amigo pagou
      await checkin(ativa, venues[(k + 1) % 3], at(START, 7 * k + 6));
    }
    const sa = await series(ativa, 125);

    // Enche a geleira.
    const cheia = await mk('cheia');
    await tastes(cheia, 8, 8, false);
    await tastes(cheia, 3, 3, true);
    const sc = await series(cheia, 60);

    // Batoteira.
    const bat = await mk('batot');
    const fake = await mk('fake');
    await mutual(bat, fake);
    await tastes(bat, 6, 6);
    const grp = await group([bat, fake]);
    for (let d = 0; d < 100; d++) {
      await paid(bat, fake, at(START, d, 9));
      await paid(fake, bat, at(START, d, 10));
      await accepted(fake, bat, at(START, d, 11));
      await cheer(bat, fake, at(START, d, 12));
      await round(grp, bat, bat, [bat, fake], at(START, d, 13));
    }
    const sb = await series(bat, 100);

    // Lenda (e depois para).
    const lenda = await mk('lenda');
    const fl = await Promise.all(Array.from({ length: 12 }, (_, k) => mk(`fl${k}`)));
    for (const f of fl) await mutual(lenda, f);
    await tastes(lenda, 6, 6); // 7 pontos
    const lg = await group([lenda, ...fl]);
    for (let k = 0; k < 13; k++) {
      const f = (i: number) => fl[i % 12];
      await paid(lenda, f(4 * k), at(START, 7 * k + 1));
      await paid(lenda, f(4 * k + 1), at(START, 7 * k + 2));
      await accepted(lenda, f(4 * k + 2), at(START, 7 * k + 3));
      await accepted(lenda, f(4 * k + 3), at(START, 7 * k + 4));
      for (let j = 0; j < 3; j++) await cheer(lenda, f(3 * k + j), at(START, 7 * k + 2, 12 + j));
      await checkin(lenda, venues[k % 4], at(START, 7 * k + 1, 20));
      await checkin(lenda, venues[(k + 1) % 4], at(START, 7 * k + 3, 20));
      await checkin(lenda, venues[(k + 2) % 4], at(START, 7 * k + 5, 20));
      await round(lg, lenda, k % 2 === 0 ? lenda : f(k), [lenda, f(k), f(k + 1)], at(START, 7 * k + 5, 21));
    }
    const sl = await series(lenda, 200);

    const report = {
      ativa: { maningue: firstDay(sa, 2), paulada: firstDay(sa, 3), topo: firstDay(sa, 4), pontosDia28: sa[28].points, pontosDia90: sa[90].points, nivelDia120: sa[120].level },
      cheia: { pontos: sc[60].points, nivelMax: Math.max(...sc.map((r) => r.level)) },
      batoteira: { pontosDia28: sb[28].points, pontosDia100: sb[100].points, nivelMax: Math.max(...sb.map((r) => r.level)) },
      lenda: { maningue: firstDay(sl, 2), paulada: firstDay(sl, 3), topo: firstDay(sl, 4), pontosDia90: sl[90].points, descidas: sl.map((r, d) => [d, r.level] as const).filter(([d, l]) => d > 0 && l < sl[d - 1].level).map(([d, l]) => `dia ${d} → ${l}`), nivelDia200: sl[200].level },
    };
    // eslint-disable-next-line no-console
    console.log('Simulação do nível da geleira:', JSON.stringify(report, null, 2));

    // Ativa: «Maningue abastecida» em cerca de um mês (entre 3 e 5 semanas); «Paulada» só com constância (8 semanas ou mais).
    expect(report.ativa.maningue).toBeGreaterThanOrEqual(21);
    expect(report.ativa.maningue).toBeLessThanOrEqual(35);
    expect(report.ativa.paulada).toBeGreaterThanOrEqual(56);
    expect(report.ativa.topo).toBe(-1);
    // Encher a geleira não sobe para lá de «A txilar».
    expect(report.cheia).toEqual({ pontos: 8, nivelMax: 1 });
    // Batoteira: uma pessoa só vale no máximo 6 por semana; nunca passa de «A txilar».
    expect(report.batoteira.nivelMax).toBe(1);
    expect(sb[100].points - sb[100].breakdown.gostos.points).toBeLessThanOrEqual(PERSON_WEEK_MAX * 14);
    // Lenda: o topo pede pelo menos 10 semanas com atividade e 10 pessoas diferentes.
    expect(report.lenda.topo).toBeGreaterThanOrEqual(63);
    expect(report.lenda.topo).toBeLessThanOrEqual(80);
    expect(sl[report.lenda.topo].breakdown.people).toBeGreaterThanOrEqual(10);
    // Depois de parar: desce um degrau de cada vez, nunca dois na mesma semana, até ao que os números dão.
    let lastDrop = -Infinity;
    for (let d = 1; d < sl.length; d++) {
      if (sl[d].level < sl[d - 1].level) {
        expect(sl[d - 1].level - sl[d].level).toBe(1);
        expect(d - lastDrop).toBeGreaterThanOrEqual(7);
        lastDrop = d;
      }
    }
    expect(report.lenda.descidas.length).toBe(3);
    expect(sl[200].level).toBe(sl[200].breakdown.raw);
  }, 300_000);
});
