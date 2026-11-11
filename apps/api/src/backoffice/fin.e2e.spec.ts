import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { getStorageToken } from '@nestjs/throttler';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { PaymentsService } from '../payments/payments.service';
import { staffLogin } from '../staff/staff-test';
import { ISSUANCE_ACCOUNT, WalletService } from '../wallet/wallet.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';

interface U { token: string; id: string; username: string }
type Body = Record<string, any>;

describe('Backoffice: Finanças, Bombar, Crescimento e Resumo (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  let wallet: WalletService;
  const run = Date.now().toString(36);
  let n = 0;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  let fin: string, growth: string, suporte: string, admin: string;

  async function signup(name: string, extra: { inviteCode?: string; email?: string } = {}): Promise<U> {
    const username = `${name}${run}${n++}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').set('X-Forwarded-For', `10.77.${n % 250}.${(n * 7) % 250}`)
      .send({ email: extra.email ?? `${username}@example.com`, username, displayName: `${name} Teste`, password: 'password-bem-longa-1', birthDate: '1990-06-15', acceptTerms: true, inviteCode: extra.inviteCode }).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  const resetThrottle = () => {
    const s = app.get(getStorageToken()) as { storage: Map<string, unknown>; hitExpirations?: Map<string, unknown> };
    s.storage.clear();
    s.hitExpirations?.clear();
  };
  const get = async (path: string, token = fin) => (await api().get(`/api/v1${path}`).set(bearer(token)).expect(200)).body as Body;
  const acc = async (userId: string) => (await pool.query('SELECT id FROM ledger.accounts WHERE user_id = $1', [userId])).rows[0].id as string;
  const gift = (from: U, to: U, amount: number, type: 'gift' | 'transfer' = 'gift') =>
    wallet.transfer({ actorId: from.id, fromUserId: from.id, toUserId: to.id, amount, type, idempotencyKey: `t-${run}-${n++}` });
  const byType = (o: Body, t: string) => (o.byType as Body[]).find((x) => x.type === t)!;

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'f'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test', PAYMENTS_SANDBOX: 'true' }));
    await app.init();
    wallet = app.get(WalletService);
    fin = (await staffLogin(app, 'Finanças', ['financas'])).token;
    growth = (await staffLogin(app, 'Crescimento', ['crescimento'])).token;
    suporte = (await staffLogin(app, 'Suporte', ['suporte'])).token;
    admin = (await staffLogin(app, 'Admin', ['administracao'])).token;
  }, 90_000);

  beforeEach(() => resetThrottle());

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('permissões: sem wallet.view dá 403; sem invites.view dá 403; a sessão da rede social não entra', async () => {
    const user = await signup('fpx');
    for (const p of ['/admin/fin/overview', '/admin/fin/venues', '/admin/fin/ledger', '/admin/fin/alerts', '/admin/fin/purchases', '/admin/fin/boosts', `/admin/fin/ledger/${ISSUANCE_ACCOUNT}`]) {
      await api().get(`/api/v1${p}`).set(bearer(suporte)).expect(403);
      await api().get(`/api/v1${p}`).set(bearer(growth)).expect(403);
      await api().get(`/api/v1${p}`).set(bearer(user.token)).expect(401);
      await api().get(`/api/v1${p}`).expect(401);
    }
    await api().get('/api/v1/admin/growth').set(bearer(suporte)).expect(403);
    await api().get('/api/v1/admin/growth').set(bearer(fin)).expect(403);
    await api().get('/api/v1/admin/growth').set(bearer(growth)).expect(200);
    await api().get('/api/v1/admin/fin/overview').set(bearer(fin)).expect(200);
    await api().get('/api/v1/admin/summary').set(bearer(user.token)).expect(401);
  });

  it('Resumo: cada número só aparece a quem tem a permissão', async () => {
    const s = await get('/admin/summary', suporte);
    expect(s).toHaveProperty('signupsToday');
    expect(s).not.toHaveProperty('txillsToday');
    expect(s).not.toHaveProperty('dau');
    expect(s).not.toHaveProperty('reportsOpen');
    const f = await get('/admin/summary', fin);
    expect(f).toEqual(expect.objectContaining({ txillsToday: expect.any(Number), movesToday: expect.any(Number), boostsActive: expect.any(Number), dau: expect.any(Number) }));
    expect(f).not.toHaveProperty('reportsOpen');
    expect(f).not.toHaveProperty('venuesPending');
    expect(f).not.toHaveProperty('invitesToday');
    const a = await get('/admin/summary', admin);
    for (const k of ['dau', 'wau', 'mau', 'signupsToday', 'reportsOpen', 'verificationsPending', 'venuesPending', 'boostsActive', 'txillsToday', 'invitesToday']) expect(a).toHaveProperty(k);
  });

  it('Txills em circulação: somas por tipo, emitidos, resgatados pelo Bombar, livro com filtros, páginas e detalhe', async () => {
    const before = await get('/admin/fin/overview?days=7');
    const todayBefore = (await get('/admin/summary')).txillsToday as number;
    const [a, b, c] = [await signup('fma'), await signup('fmb'), await signup('fmc')];
    for (const u of [a, b, c]) await wallet.ensureWallet(u.id);
    const g = await gift(a, b, 120);
    await gift(b, c, 30, 'transfer');
    // Um local com carteira: carrega 1000, paga 300 ao Bombar, recebe 100 de volta e 25 de um cliente.
    const v = (await api().post('/api/v1/venues').set(bearer(a.token)).send({ name: `Bar Contas ${run}`, kind: 'bar', lat: -60.1, lng: -150.2 }).expect(201)).body as { id: string; slug: string };
    const va = await wallet.ensureVenueWallet(v.id);
    const k = () => `fm-${run}-${n++}`;
    await wallet.move({ type: 'topup', actorId: a.id, idempotencyKey: k(), lock: [va], legs: [[ISSUANCE_ACCOUNT, -1000], [va, 1000]], metadata: { venueId: v.id, test: true } });
    await wallet.move({ type: 'boost', actorId: a.id, idempotencyKey: k(), lock: [va], legs: [[va, -300], [ISSUANCE_ACCOUNT, 300]], metadata: { venueId: v.id } });
    await wallet.move({ type: 'boost_refund', actorId: a.id, idempotencyKey: k(), lock: [va], legs: [[ISSUANCE_ACCOUNT, -100], [va, 100]], metadata: { venueId: v.id } });
    const ca = await acc(c.id);
    await wallet.move({ type: 'venue_payment', actorId: c.id, idempotencyKey: k(), lock: [ca, va], legs: [[ca, -25], [va, 25]], metadata: { venueId: v.id, payerId: c.id } });

    const after = await get('/admin/fin/overview?days=7');
    const d = (t: string, f: string) => byType(after, t)[f] - byType(before, t)[f];
    expect(d('welcome_bonus', 'issued')).toBe(1500);
    expect(d('welcome_bonus', 'count')).toBe(3);
    expect(d('gift', 'volume')).toBe(120);
    expect(d('gift', 'count')).toBe(1);
    expect(d('gift', 'issued')).toBe(0);
    expect(d('transfer', 'volume')).toBe(30);
    expect(d('topup', 'issued')).toBe(1000);
    expect(d('boost', 'redeemed')).toBe(300);
    expect(d('boost_refund', 'issued')).toBe(100);
    expect(d('venue_payment', 'volume')).toBe(25);
    expect(after.period.issued - before.period.issued).toBe(2600);
    expect(after.period.redeemed - before.period.redeemed).toBe(300);
    expect(after.circulation.total - before.circulation.total).toBe(2300);
    expect(after.circulation.venues - before.circulation.venues).toBe(825);
    // Em circulação = emitidos − resgatados, e o livro está equilibrado.
    expect(after.circulation.total).toBe(after.circulation.issuedEver - after.circulation.redeemedEver);
    expect(after.circulation.balanced).toBe(true);
    expect(after.series).toHaveLength(7);
    const today = after.series[6];
    expect(today.issued - before.series[6].issued).toBe(2600);
    expect((await get('/admin/summary')).txillsToday - todayBefore).toBe(1500 + 120 + 30 + 1000 + 300 + 100 + 25);

    // Carteiras dos locais.
    const w = (await get('/admin/fin/venues?days=7')).items.find((x: Body) => x.venue?.slug === v.slug);
    expect(w).toMatchObject({ balance: 825, received: 25, payments: 1, boostSpent: 200 });

    // Livro: filtro por conta (@utilizador), totais do filtro (entrou / saiu) e o lado da conta em cada linha.
    const la = await get(`/admin/fin/ledger?account=@${a.username}`);
    expect(la.account).toMatchObject({ label: `@${a.username}`, found: true });
    expect(la.totals).toEqual({ count: 2, volume: 620, in: 500, out: 120 });
    expect(la.items.map((x: Body) => x.type).sort()).toEqual(['gift', 'welcome_bonus']);
    expect(la.items.find((x: Body) => x.type === 'gift')).toMatchObject({ amount: 120, net: -120, from: [`@${a.username}`], to: [`@${b.username}`] });
    // Por tipo e conta.
    const lb = await get(`/admin/fin/ledger?account=${b.username}&type=gift`);
    expect(lb.totals).toMatchObject({ count: 1, in: 120, out: 0 });
    expect(lb.items[0]).toMatchObject({ id: g.transactionId, net: 120 });
    // Pelo endereço do local.
    const lv = await get(`/admin/fin/ledger?account=${v.slug}`);
    expect(lv.totals).toMatchObject({ count: 4, in: 1125, out: 300 });
    expect((await get(`/admin/fin/ledger?account=${v.slug}&type=boost`)).totals).toMatchObject({ count: 1, out: 300 });
    // Datas: até ontem não há nada desta conta; de hoje em diante há tudo.
    const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    expect((await get(`/admin/fin/ledger?account=@${a.username}&to=${iso(Date.now() - 86_400_000)}`)).totals.count).toBe(0);
    expect((await get(`/admin/fin/ledger?account=@${a.username}&from=${iso(Date.now())}&to=${iso(Date.now())}`)).totals.count).toBe(2);
    // Conta que não existe.
    expect(await get('/admin/fin/ledger?account=@ninguem-que-exista-zz')).toMatchObject({ items: [], account: { found: false } });
    // Páginas: 4 movimentos do local, 3 por página.
    const p1 = await get(`/admin/fin/ledger?account=${v.slug}&limit=3`);
    expect(p1.items).toHaveLength(3);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = await get(`/admin/fin/ledger?account=${v.slug}&limit=3&cursor=${p1.nextCursor}`);
    expect(p2.items).toHaveLength(1);
    expect(p2.nextCursor).toBeNull();
    expect(new Set([...p1.items, ...p2.items].map((x: Body) => x.id)).size).toBe(4);
    // Sem filtros: a soma da página bate com as linhas.
    const all = await get('/admin/fin/ledger?limit=5');
    expect(all.items.length).toBeLessThanOrEqual(5);
    expect(all.totals.count).toBeGreaterThanOrEqual(10);

    // Detalhe.
    const det = await get(`/admin/fin/ledger/${g.transactionId}`);
    expect(det).toMatchObject({ type: 'gift', amount: 120, balanced: true, actor: { username: a.username } });
    expect(det.legs.map((l: Body) => [l.label, l.amount])).toEqual([[`@${a.username}`, -120], [`@${b.username}`, 120]]);
    await api().get('/api/v1/admin/fin/ledger/00000000-0000-7000-8000-00000000abcd').set(bearer(fin)).expect(404);
    await api().get('/api/v1/admin/fin/ledger/nada').set(bearer(fin)).expect(404);
  });

  it('alertas: quem recebe presentes de muitas contas novas', async () => {
    const r = await signup('fal');
    await wallet.ensureWallet(r.id);
    for (let i = 0; i < 5; i++) {
      const s = await signup(`fas${i}`);
      await wallet.ensureWallet(s.id);
      await gift(s, r, 300);
    }
    const al = await get('/admin/fin/alerts');
    const mine = (al.items as Body[]).find((x) => x.account?.userId === r.id);
    expect(mine).toBeTruthy();
    expect(mine!.detail).toContain('5 de 5');
    expect(mine!.amount).toBe(1500);
    expect((al.items as Body[]).some((x) => x.id === 'ledger')).toBe(false); // o livro bate certo
  });

  it('compras de Txills: fornecedor de teste, pacotes e pedidos', async () => {
    const before = await get('/admin/fin/purchases?days=7');
    expect(before.mode).toBe('sandbox');
    expect(before.providers.find((p: Body) => p.id === 'sandbox')).toMatchObject({ enabled: true });
    expect(before.providers.find((p: Body) => p.id === 'mpesa')).toMatchObject({ enabled: false });
    const u = await signup('fcp');
    const pay = app.get(PaymentsService);
    const o = await pay.create(u.id, { packageId: 'pequeno', provider: 'sandbox' }, `k-${run}-${n++}`);
    await pay.sandboxPay(u.id, o.id);
    await pay.create(u.id, { packageId: 'medio', provider: 'sandbox' }, `k-${run}-${n++}`); // fica pendente
    const after = await get('/admin/fin/purchases?days=7');
    const pk = (x: Body, id: string) => x.packages.find((p: Body) => p.id === id);
    expect(pk(after, 'pequeno').sold - pk(before, 'pequeno').sold).toBe(1);
    expect(pk(after, 'pequeno').txillsSold - pk(before, 'pequeno').txillsSold).toBe(500);
    expect(after.paid.count - before.paid.count).toBe(1);
    expect(after.paid.testMinor - before.paid.testMinor).toBe(5000);
    expect(after.paid.revenueMinor - before.paid.revenueMinor).toBe(0); // o de teste não é dinheiro
    expect(after.orders.pending - before.orders.pending).toBe(1);
    const paid = after.recent.find((x: Body) => x.id === o.id);
    expect(paid).toMatchObject({ status: 'paid', username: u.username });
    // O carregamento está no livro e liga ao pedido.
    expect((await get(`/admin/fin/ledger/${paid.ledgerTx}`)).order).toMatchObject({ id: o.id, provider: 'sandbox', status: 'paid' });
  });

  it('Bombar: totais de todos os locais, lista e suspender/repor pelas rotas que já existem', async () => {
    const before = await get('/admin/fin/boosts?days=7');
    const dono = await signup('fbd');
    const C = { lat: -55.5 + Math.random(), lng: -120.5 + Math.random() };
    const v = (await api().post('/api/v1/venues').set(bearer(dono.token)).send({ name: `Bar Bomba ${run}`, kind: 'bar', lat: C.lat, lng: C.lng }).expect(201)).body as { id: string; slug: string };
    await pool.query("UPDATE content.venues SET review_status = 'approved' WHERE id = $1", [v.id]);
    const va = await wallet.ensureVenueWallet(v.id);
    await wallet.move({ type: 'topup', actorId: dono.id, idempotencyKey: `fb-${run}`, lock: [va], legs: [[ISSUANCE_ACCOUNT, -5000], [va, 5000]], metadata: { test: true } });
    const ev = (await api().post('/api/v1/events').set(bearer(dono.token)).send({ venueSlug: v.slug, title: `Kizomba ${run}`, startsAt: new Date(Date.now() + 3_600_000).toISOString(), endsAt: new Date(Date.now() + 2 * 86_400_000).toISOString() }).expect(201)).body.id as string;
    const camp = (await api().post(`/api/v1/boosts/venue/${v.slug}`).set(bearer(dono.token)).set('Idempotency-Key', `fbk-${run}`).send({ target: { kind: 'event', id: ev }, package: '1d', radiusKm: 3 }).expect(201)).body.campaign as { id: string; price: number };
    const viewer = await signup('fbv');
    await pool.query(`INSERT INTO content.boost_impressions (id, campaign_id, user_id, kind, surface) VALUES (gen_random_uuid(), $1, $2, 'view', 'feed'), (gen_random_uuid(), $1, $2, 'view', 'map'), (gen_random_uuid(), $1, $2, 'tap', 'feed')`, [camp.id, viewer.id]);

    const after = await get('/admin/fin/boosts?days=7');
    const t = (k: string) => after.totals[k] - before.totals[k];
    expect(t('campaigns')).toBe(1);
    expect(t('spent')).toBe(camp.price);
    expect(t('impressions')).toBe(2);
    expect(t('taps')).toBe(1);
    expect(after.topVenues.find((x: Body) => x.slug === v.slug)).toMatchObject({ campaigns: 1, spent: camp.price, impressions: 2, taps: 1 });
    expect(after.campaigns.find((x: Body) => x.id === camp.id)).toMatchObject({ venue: { slug: v.slug }, report: { impressions: 2, taps: 1 } });
    // O Bombar resgata Txills: aparece no livro como 'boost'.
    expect((await get(`/admin/fin/ledger?account=${v.slug}&type=boost`)).totals).toMatchObject({ count: 1, out: camp.price });

    // Suspender e repor: as rotas de sempre (catalog.manage). As Finanças só veem.
    await api().put(`/api/v1/venues/admin/boosts/${camp.id}/suspend`).set(bearer(fin)).send({ refund: false }).expect(403);
    await api().put(`/api/v1/venues/admin/boosts/${camp.id}/suspend`).set(bearer(admin)).send({ refund: false, note: 'teste' }).expect(200);
    expect((await get('/admin/fin/boosts?days=7&filter=all')).campaigns.find((x: Body) => x.id === camp.id).state).toBe('suspended');
    expect((await get('/admin/fin/boosts?days=7')).totals.suspended - before.totals.suspended).toBe(1);
    await api().put(`/api/v1/venues/admin/boosts/${camp.id}/reinstate`).set(bearer(admin)).send({}).expect(200);
    expect((await get('/admin/fin/boosts?days=7&filter=all')).campaigns.find((x: Body) => x.id === camp.id).state).not.toBe('suspended');
  });

  it('Crescimento: convites (entraram, bloqueados), quem mais convida, orçamento, série, funil e fontes', async () => {
    const before = await get('/admin/growth?days=7', growth);
    const host = await signup('fgh');
    const code = (await api().get('/api/v1/invites/me').set(bearer(host.token)).expect(200)).body.code as string;
    await signup('fgi', { inviteCode: code });
    await signup('fgj', { inviteCode: code });
    await signup('fgk', { inviteCode: code, email: `fgk${run}@mailinator.com` }); // email temporário: bloqueado pela antifraude
    const after = await get('/admin/growth?days=7', growth);
    expect(after.invites.joined - before.invites.joined).toBe(3);
    expect(after.invites.blocked - before.invites.blocked).toBe(1);
    expect(after.invites.blockedBy.find((x: Body) => x.reason === 'email temporário').count).toBeGreaterThanOrEqual(1);
    expect(after.top.find((x: Body) => x.username === host.username)).toMatchObject({ joined: 3, blocked: 1, paid: 0 });
    expect(after.sources.invite - before.sources.invite).toBe(3);
    expect(after.sources.total - before.sources.total).toBe(4);
    expect(after.sources.direct + after.sources.invite).toBe(after.sources.total);
    expect(after.sources.methods.reduce((s: number, m: Body) => s + m.count, 0)).toBe(after.sources.total);
    expect(after.funnel.signed - before.funnel.signed).toBe(4);
    expect(after.series).toHaveLength(7);
    expect(after.series[6].joined - before.series[6].joined).toBe(3);
    expect(after.series[6].blocked - before.series[6].blocked).toBe(1);
    // Orçamento do mês: o mesmo que o livro diz (prémios de convite creditados este mês).
    const used = Number((await pool.query(
      `SELECT coalesce(sum(e.amount), 0)::bigint AS n FROM ledger.transactions t JOIN ledger.entries e ON e.transaction_id = t.id
        WHERE t.type = 'invite' AND e.amount > 0 AND e.account_id <> $1 AND t.created_at >= date_trunc('month', now())`, [ISSUANCE_ACCOUNT],
    )).rows[0].n);
    expect(after.budget.used).toBe(used);
    expect(after.budget.left).toBe(after.budget.monthly - used);
  });
});
