import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { proRata, settle, splitCents, toCents } from './settle';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';

interface U { token: string; id: string; username: string }

describe('contas dos TxillGroups (unidade)', () => {
  it('divide cêntimos, acerta contas e devolve na proporção', () => {
    expect(splitCents(10000, 3)).toEqual([3334, 3333, 3333]);
    expect(toCents(1250.5)).toBe(125050);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(1.234)).toBeNull();
    const s = settle(new Map([['a', 6000], ['b', -1000], ['c', -2000], ['d', -3000]]));
    expect(s).toEqual([{ from: 'd', to: 'a', cents: 3000 }, { from: 'c', to: 'a', cents: 2000 }, { from: 'b', to: 'a', cents: 1000 }]);
    // Ninguém fica a dever depois de aplicar as transferências.
    const two = settle(new Map([['a', 500], ['b', 700], ['c', -400], ['d', -800]]));
    const net = new Map([['a', 500], ['b', 700], ['c', -400], ['d', -800]]);
    for (const t of two) { net.set(t.from, net.get(t.from)! + t.cents); net.set(t.to, net.get(t.to)! - t.cents); }
    expect([...net.values()].every((v) => v === 0)).toBe(true);
    expect(two.length).toBeLessThanOrEqual(3);
    const r = proRata(100n, [['x', 1n], ['y', 1n], ['z', 1n]]);
    expect(r.reduce((a, [, v]) => a + v, 0n)).toBe(100n);
    expect(r.map(([, v]) => v).sort()).toEqual([33n, 33n, 34n]);
  });
});

describe('TxillGroups: plano, sondagens, lista, despesas, cofre e pagar com Txills nos locais (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  /** Locais novos ficam em análise; nestes testes a equipa aprova-os logo. */
  const approved = async (req: request.Test) => { const r = await req; if (r.body?.id) await pool.query("UPDATE content.venues SET review_status = 'approved' WHERE id = $1", [r.body.id]); if (r.body?.slug) r.body.reviewStatus = 'approved'; return r; };
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  let ana: U, beto: U, cris: U, dino: U, dono: U, fora: U;
  let groupId: string;
  let venueSlug: string;
  const g = (path = '') => `/api/v1/chat/groups/${groupId}${path}`;
  const balance = async (x: U) => (await api().get('/api/v1/wallet').set(auth(x)).expect(200)).body.balance as number;
  const key = () => `k-${Math.random().toString(36).slice(2)}-${Date.now()}`;

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'g'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    ana = await signup('tga');
    beto = await signup('tgb');
    cris = await signup('tgc');
    dino = await signup('tgd');
    dono = await signup('tgo');
    fora = await signup('tgf');
    const ids = [ana, beto, cris, dino].map((u) => u.id);
    for (const a of ids) for (const b of ids) if (a !== b) await pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [a, b]);
    // As carteiras abrem com o bónus de boas-vindas.
    for (const u of [ana, beto, cris, dino, dono, fora]) await balance(u);
    venueSlug = (await approved(api().post('/api/v1/venues').set(auth(dono)).send({ name: `Barraca TG ${run}`, kind: 'bar', city: 'Maputo' }).expect(201))).body.slug as string;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('cria um TxillGroup com nome e tipo; os grupos antigos continuam a funcionar', async () => {
    await api().post('/api/v1/chat/groups').set(auth(ana)).send({ name: 'x', members: [beto.username, cris.username] }).expect(400);
    await api().post('/api/v1/chat/groups').set(auth(ana)).send({ name: 'Bilene', kind: 'cruzeiro', members: [beto.username, cris.username] }).expect(400);
    groupId = (await api().post('/api/v1/chat/groups').set(auth(ana)).send({ name: 'Bilene em Dezembro', kind: 'viagem', description: 'Praia, sol e gelada', members: [beto.username, cris.username, dino.username] }).expect(201)).body.id;
    const row = ((await api().get('/api/v1/chat/groups').set(auth(beto)).expect(200)).body as { id: string }[]).find((x) => x.id === groupId) as Record<string, any>;
    expect(row).toMatchObject({ kind: 'group', groupKind: 'viagem', description: 'Praia, sol e gelada', visibility: 'private', createdBy: ana.username, members: 4 });
    expect(row.plan).toEqual({ destination: null, startsOn: null, endsOn: null, going: 0, maybe: 0, notGoing: 0, myRsvp: null });
    expect(row.pot).toEqual({ balance: 0, goal: null, venue: null });

    // Sem tipo (cliente antigo): fica 'outro'. Um grupo criado antes da migração também é 'outro'.
    const legacy = (await api().post('/api/v1/chat/groups').set(auth(ana)).send({ name: 'Malta', members: [beto.username, cris.username] }).expect(201)).body.id as string;
    const t = (await api().get(`/api/v1/chat/groups/${legacy}`).set(auth(beto)).expect(200)).body;
    expect(t.group).toMatchObject({ name: 'Malta', kind: 'outro', groupKind: 'outro', myRole: 'member' });
    await api().post(`/api/v1/chat/groups/${legacy}/messages`).set(auth(beto)).send({ body: 'ainda funciona' }).expect(201);
    expect((await api().get(`/api/v1/chat/groups/${legacy}`).set(auth(ana)).expect(200)).body.items[0]).toMatchObject({ body: 'ainda funciona', sender: { username: beto.username } });

    // Só quem administra edita o grupo.
    await api().patch(g()).set(auth(beto)).send({ kind: 'festa' }).expect(403);
    await api().patch(g()).set(auth(ana)).send({ kind: 'fim_de_semana', description: null }).expect(204);
    expect((await api().get(g()).set(auth(cris)).expect(200)).body.group).toMatchObject({ kind: 'fim_de_semana', description: null });
    await api().patch(g()).set(auth(ana)).send({ kind: 'viagem' }).expect(204);
    // Quem não é membro não vê nada.
    await api().get(g('/plan')).set(auth(fora)).expect(404);
    await api().get(g('/pot')).set(auth(fora)).expect(404);
  });

  it('plano: só os admins editam; datas validadas; todos respondem', async () => {
    await api().patch(g('/plan')).set(auth(beto)).send({ destination: 'Bilene' }).expect(403);
    await api().patch(g('/plan')).set(auth(ana)).send({ startsOn: '2026-12-20', endsOn: '2026-12-10' }).expect(400);
    await api().patch(g('/plan')).set(auth(ana)).send({ startsOn: '2026-02-30' }).expect(400);
    await api().patch(g('/plan')).set(auth(ana)).send({ venueSlug: 'nao-existe-mesmo' }).expect(404);
    const plan = (await api().patch(g('/plan')).set(auth(ana)).send({ destination: 'Bilene', startsOn: '2026-12-20', endsOn: '2026-12-23', venueSlug }).expect(200)).body;
    expect(plan).toMatchObject({ destination: 'Bilene', startsOn: '2026-12-20', endsOn: '2026-12-23', venue: { slug: venueSlug } });

    await api().put(g('/plan/rsvp')).set(auth(ana)).send({ status: 'going' }).expect(200);
    await api().put(g('/plan/rsvp')).set(auth(beto)).send({ status: 'maybe' }).expect(200);
    await api().put(g('/plan/rsvp')).set(auth(beto)).send({ status: 'going' }).expect(200);
    await api().put(g('/plan/rsvp')).set(auth(cris)).send({ status: 'not_going' }).expect(200);
    await api().put(g('/plan/rsvp')).set(auth(cris)).send({ status: 'talvez' }).expect(400);
    const p = (await api().get(g('/plan')).set(auth(dino)).expect(200)).body;
    expect(p.rsvps.map((r: { username: string; status: string }) => [r.username, r.status])).toEqual([[ana.username, 'going'], [beto.username, 'going'], [cris.username, 'not_going']]);
    const row = ((await api().get('/api/v1/chat/groups').set(auth(beto)).expect(200)).body as { id: string }[]).find((x) => x.id === groupId) as Record<string, any>;
    expect(row.plan).toMatchObject({ destination: 'Bilene', going: 2, maybe: 0, notGoing: 1, myRsvp: 'going' });
  });

  it('sondagens: criar (aparece na conversa), votar, várias opções, fechar', async () => {
    await api().post(g('/polls')).set(auth(beto)).send({ question: 'Quando?', options: ['sexta'] }).expect(400);
    await api().post(g('/polls')).set(auth(beto)).send({ question: 'Quando?', options: ['sexta', 'Sexta'] }).expect(400);
    const poll = (await api().post(g('/polls')).set(auth(beto)).send({ question: 'Saímos quando?', options: ['sexta', 'sábado', 'domingo'] }).expect(201)).body;
    expect(poll).toMatchObject({ question: 'Saímos quando?', multiple: false, closed: false, createdBy: beto.username, myVotes: [] });
    expect(poll.options).toHaveLength(3);

    // A mensagem 'poll' aparece na conversa com a sondagem; na lista, a última mensagem mostra a pergunta.
    const thread = (await api().get(g()).set(auth(cris)).expect(200)).body;
    expect(thread.items[0]).toMatchObject({ kind: 'poll', body: poll.id, sender: { username: beto.username }, poll: { id: poll.id } });
    const row = ((await api().get('/api/v1/chat/groups').set(auth(ana)).expect(200)).body as { id: string }[]).find((x) => x.id === groupId) as Record<string, any>;
    expect(row.lastMessage).toMatchObject({ kind: 'poll', body: 'Saímos quando?' });

    const [sexta, sabado] = poll.options.map((o: { id: string }) => o.id);
    await api().post(g(`/polls/${poll.id}/vote`)).set(auth(ana)).send({ optionIds: [sexta, sabado] }).expect(400); // só uma
    await api().post(g(`/polls/${poll.id}/vote`)).set(auth(ana)).send({ optionIds: [sexta] }).expect(200);
    await api().post(g(`/polls/${poll.id}/vote`)).set(auth(cris)).send({ optionIds: [sexta] }).expect(200);
    const changed = (await api().post(g(`/polls/${poll.id}/vote`)).set(auth(ana)).send({ optionIds: [sabado] }).expect(200)).body; // muda o voto
    expect(changed.myVotes).toEqual([sabado]);
    expect(changed.options.map((o: { votes: number }) => o.votes)).toEqual([1, 1, 0]);
    expect(changed.options[1].voters).toEqual([ana.username]);
    await api().post(g(`/polls/${poll.id}/vote`)).set(auth(fora)).send({ optionIds: [sexta] }).expect(404);

    const multi = (await api().post(g('/polls')).set(auth(ana)).send({ question: 'O que levamos?', options: ['coleman', 'coluna', 'carvão'], multiple: true }).expect(201)).body;
    const ids = multi.options.map((o: { id: string }) => o.id);
    const voted = (await api().post(g(`/polls/${multi.id}/vote`)).set(auth(dino)).send({ optionIds: [ids[0], ids[2]] }).expect(200)).body;
    expect(voted.myVotes.sort()).toEqual([ids[0], ids[2]].sort());

    // Fecha quem criou ou quem administra; depois de fechada ninguém vota.
    await api().post(g(`/polls/${poll.id}/close`)).set(auth(cris)).expect(403);
    expect((await api().post(g(`/polls/${poll.id}/close`)).set(auth(beto)).expect(200)).body.closed).toBe(true);
    await api().post(g(`/polls/${poll.id}/vote`)).set(auth(dino)).send({ optionIds: [sexta] }).expect(403);
    expect((await api().post(g(`/polls/${multi.id}/close`)).set(auth(ana)).expect(200)).body.closed).toBe(true);
    const plan = (await api().get(g('/plan')).set(auth(ana)).expect(200)).body;
    expect(plan.polls.map((p: { id: string }) => p.id)).toEqual([multi.id, poll.id]);
  });

  it('lista: adicionar, atribuir, marcar feito, apagar (quem criou ou admin)', async () => {
    await api().post(g('/checklist')).set(auth(beto)).send({ text: 'Levar a coleman', assignee: fora.username }).expect(400);
    const item = (await api().post(g('/checklist')).set(auth(beto)).send({ text: 'Levar a coleman', assignee: cris.username }).expect(201)).body;
    expect(item).toMatchObject({ text: 'Levar a coleman', done: false, assignee: { username: cris.username }, createdBy: beto.username });
    const done = (await api().patch(g(`/checklist/${item.id}`)).set(auth(cris)).send({ done: true, assignee: null }).expect(200)).body;
    expect(done).toMatchObject({ done: true, assignee: null });
    const other = (await api().post(g('/checklist')).set(auth(ana)).send({ text: 'Reservar a casa' }).expect(201)).body;
    await api().delete(g(`/checklist/${item.id}`)).set(auth(dino)).expect(403);
    await api().delete(g(`/checklist/${item.id}`)).set(auth(beto)).expect(204);
    const list = (await api().get(g('/plan')).set(auth(ana)).expect(200)).body.checklist as { id: string }[];
    expect(list.map((i) => i.id)).toEqual([other.id]);
    await api().delete(g(`/checklist/${other.id}`)).set(auth(ana)).expect(204);
  });

  it('despesas: saldos por pessoa e quem paga a quem', async () => {
    // Ana paga 100,00 MT a dividir pelos 4; Beto paga 50,50 MT a dividir por ele e pela Cris.
    await api().post(g('/expenses')).set(auth(ana)).send({ description: 'Gasolina', amountMzn: 100.123 }).expect(400);
    await api().post(g('/expenses')).set(auth(ana)).send({ description: 'Gasolina', amountMzn: 100 }).expect(201);
    const ex = (await api().post(g('/expenses')).set(auth(cris)).send({ description: 'Gelo', amountMzn: 50.5, paidBy: beto.username, splitAmong: [beto.username, cris.username] }).expect(201)).body;
    expect(ex.total).toBe(150.5);
    expect(ex.items[0]).toMatchObject({ description: 'Gelo', amountMzn: 50.5, paidBy: { username: beto.username }, createdBy: cris.username, canDelete: true });
    const net = Object.fromEntries(ex.balances.map((b: { username: string; net: number }) => [b.username, b.net]));
    // Ana: +100 - 25 = 75; Beto: +50,5 - 25 - 25,25 = 0,25; Cris: -25 - 25,25 = -50,25; Dino: -25.
    expect(net).toEqual({ [ana.username]: 75, [beto.username]: 0.25, [cris.username]: -50.25, [dino.username]: -25 });
    expect(ex.settlements).toEqual([
      { from: cris.username, to: ana.username, amount: 50.25 },
      { from: dino.username, to: ana.username, amount: 24.75 },
      { from: dino.username, to: beto.username, amount: 0.25 },
    ]);
    // Apaga quem registou ou um admin.
    await api().delete(g(`/expenses/${ex.items[0].id}`)).set(auth(dino)).expect(403);
    const after = (await api().delete(g(`/expenses/${ex.items[0].id}`)).set(auth(ana)).expect(200)).body;
    expect(after.settlements).toEqual([
      { from: beto.username, to: ana.username, amount: 25 },
      { from: cris.username, to: ana.username, amount: 25 },
      { from: dino.username, to: ana.username, amount: 25 },
    ]);
  });

  it('cofre: contribuir mexe nos saldos, é idempotente, não passa do saldo e aguenta contribuições em simultâneo', async () => {
    const before = await balance(beto);
    const k = key();
    const pot = (await api().post(g('/pot/contribute')).set(auth(beto)).send({ amount: 100, idempotencyKey: k }).expect(201)).body;
    expect(pot.balance).toBe(100);
    // Repetir com a mesma chave (no corpo ou no cabeçalho) não volta a cobrar.
    await api().post(g('/pot/contribute')).set(auth(beto)).send({ amount: 100, idempotencyKey: k }).expect(201);
    await api().post(g('/pot/contribute')).set(auth(beto)).set('Idempotency-Key', k).send({ amount: 100 }).expect(201);
    expect(await balance(beto)).toBe(before - 100);
    await api().post(g('/pot/contribute')).set(auth(beto)).send({ amount: 5, idempotencyKey: key() }).expect(400);
    await api().post(g('/pot/contribute')).set(auth(beto)).send({ amount: 100 }).expect(400); // sem chave
    await api().post(g('/pot/contribute')).set(auth(beto)).send({ amount: before + 1, idempotencyKey: key() }).expect(422);
    await api().post(g('/pot/contribute')).set(auth(fora)).send({ amount: 10, idempotencyKey: key() }).expect(404);

    // Cris tem X Txills e tenta pôr 100 oito vezes ao mesmo tempo: só passam as que cabem no saldo.
    const crisBefore = await balance(cris);
    const tries = await Promise.all(Array.from({ length: 8 }, () => api().post(g('/pot/contribute')).set(auth(cris)).send({ amount: 100, idempotencyKey: key() })));
    const ok = tries.filter((r) => r.status === 201).length;
    expect(ok).toBe(Math.min(8, Math.floor(crisBefore / 100)));
    expect(tries.every((r) => r.status === 201 || r.status === 422)).toBe(true);
    expect(await balance(cris)).toBe(crisBefore - ok * 100);
    await api().post(g('/pot/contribute')).set(auth(ana)).send({ amount: 200, idempotencyKey: key() }).expect(201);

    const p = (await api().get(g('/pot')).set(auth(dino)).expect(200)).body;
    expect(p.balance).toBe(100 + ok * 100 + 200);
    expect(p.totalByMember).toEqual(expect.arrayContaining([
      { username: beto.username, displayName: expect.any(String), amount: 100 },
      { username: cris.username, displayName: expect.any(String), amount: ok * 100 },
      { username: ana.username, displayName: expect.any(String), amount: 200 },
    ]));
    expect(p.contributions[0]).toMatchObject({ username: ana.username, amount: 200 });
    expect(p.canManage).toBe(false);

    // Meta e local do cofre: só admins, e o local tem de aceitar Txills.
    await api().patch(g('/pot')).set(auth(beto)).send({ goal: 5000 }).expect(403);
    await api().patch(g('/pot')).set(auth(ana)).send({ goal: 5000, venueSlug }).expect(422);
    expect((await api().patch(g('/pot')).set(auth(ana)).send({ goal: 5000 }).expect(200)).body.goal).toBe(5000);

    // O histórico da carteira mostra a contribuição com texto legível.
    const h = (await api().get('/api/v1/wallet').set(auth(beto)).expect(200)).body.history[0];
    expect(h).toMatchObject({ type: 'group_contribution', amount: -100, group: { id: groupId, name: 'Bilene em Dezembro' }, label: 'Puseste no cofre de Bilene em Dezembro' });
  });

  it('pagar com o cofre: recusado se o local não aceita Txills ou se não é admin; depois paga e avisa os gestores', async () => {
    await api().post(g('/pot/pay')).set(auth(ana)).send({ venueSlug, amount: 100, idempotencyKey: key() }).expect(422);
    await api().patch(`/api/v1/venues/${venueSlug}`).set(auth(fora)).send({ acceptsTxills: true }).expect(403);
    const v = (await api().patch(`/api/v1/venues/${venueSlug}`).set(auth(dono)).send({ acceptsTxills: true }).expect(200)).body;
    expect(v).toMatchObject({ acceptsTxills: true, txillsBalance: 0 });
    expect((await api().get(`/api/v1/venues/${venueSlug}`).set(auth(fora)).expect(200)).body.txillsBalance).toBeUndefined();

    await api().post(g('/pot/pay')).set(auth(beto)).send({ venueSlug, amount: 100, idempotencyKey: key() }).expect(403);
    const before = (await api().get(g('/pot')).set(auth(ana)).expect(200)).body.balance as number;
    await api().post(g('/pot/pay')).set(auth(ana)).send({ venueSlug, amount: before + 1, idempotencyKey: key() }).expect(422);
    const k = key();
    const pot = (await api().post(g('/pot/pay')).set(auth(ana)).send({ venueSlug, amount: 150, note: 'Mesa do sábado', idempotencyKey: k }).expect(201)).body;
    await api().post(g('/pot/pay')).set(auth(ana)).send({ venueSlug, amount: 150, note: 'Mesa do sábado', idempotencyKey: k }).expect(201);
    expect(pot.balance).toBe(before - 150);
    expect(pot.payments[0]).toMatchObject({ venue: { slug: venueSlug }, amount: 150, note: 'Mesa do sábado', by: { username: ana.username } });
    expect((await api().get(`/api/v1/venues/${venueSlug}`).set(auth(dono)).expect(200)).body.txillsBalance).toBe(150);

    const n = ((await api().get('/api/v1/notifications').set(auth(dono)).expect(200)).body.items as { kind: string; data: Record<string, unknown>; actor: { username: string } }[]).find((x) => x.kind === 'venue_payment');
    expect(n).toMatchObject({ actor: { username: ana.username }, data: { amount: 150, venueSlug, groupId, groupName: 'Bilene em Dezembro' } });
  });

  it('devolver o cofre na proporção do que cada um pôs', async () => {
    const p = (await api().get(g('/pot')).set(auth(ana)).expect(200)).body;
    const stakes = new Map<string, number>(p.totalByMember.map((m: { username: string; amount: number }) => [m.username, m.amount]));
    const total = [...stakes.values()].reduce((a, b) => a + b, 0);
    const before = new Map<string, number>();
    for (const u of [ana, beto, cris]) before.set(u.username, await balance(u));
    await api().post(g('/pot/refund')).set(auth(beto)).send({}).expect(403);
    const after = (await api().post(g('/pot/refund')).set(auth(ana)).send({ idempotencyKey: key() }).expect(201)).body;
    expect(after.balance).toBe(0);
    expect(after.totalByMember).toEqual([]);
    expect(after.refunds[0]).toMatchObject({ amount: p.balance, by: { username: ana.username } });
    let got = 0;
    for (const u of [ana, beto, cris]) {
      const diff = (await balance(u)) - before.get(u.username)!;
      const share = (p.balance * (stakes.get(u.username) ?? 0)) / total;
      expect(Math.abs(diff - share)).toBeLessThan(1);
      got += diff;
    }
    expect(got).toBe(p.balance);
    await api().post(g('/pot/refund')).set(auth(ana)).send({}).expect(422); // vazio
    const h = (await api().get('/api/v1/wallet').set(auth(beto)).expect(200)).body.history[0];
    expect(h).toMatchObject({ type: 'group_refund', label: 'Devolução do cofre de Bilene em Dezembro', group: { id: groupId } });
  });

  it('pagar diretamente a um local; só quem gere vê os pagamentos', async () => {
    const before = await balance(fora);
    const r = (await api().post(`/api/v1/venues/${venueSlug}/pay`).set(auth(fora)).set('Idempotency-Key', 'pagar-direto-1').send({ amount: 50, note: 'Duas 2M' }).expect(201)).body;
    expect(r).toMatchObject({ balance: before - 50, transactionId: expect.any(String), at: expect.any(String) });
    await api().post(`/api/v1/venues/${venueSlug}/pay`).set(auth(fora)).send({ amount: 50, idempotencyKey: 'pagar-direto-1' }).expect(201);
    expect(await balance(fora)).toBe(before - 50);
    await api().post(`/api/v1/venues/${venueSlug}/pay`).set(auth(fora)).send({ amount: 0, idempotencyKey: key() }).expect(400);
    await api().post(`/api/v1/venues/${venueSlug}/pay`).set(auth(fora)).send({ amount: before, idempotencyKey: key() }).expect(422);

    const h = (await api().get('/api/v1/wallet').set(auth(fora)).expect(200)).body.history[0];
    expect(h).toMatchObject({ type: 'venue_payment', amount: -50, note: 'Duas 2M', venue: { slug: venueSlug, kind: 'bar' } });
    expect(h.label).toMatch(/^Pagaste em Barraca TG/);

    await api().get(`/api/v1/venues/${venueSlug}/payments`).set(auth(fora)).expect(403);
    const list = (await api().get(`/api/v1/venues/${venueSlug}/payments`).set(auth(dono)).expect(200)).body;
    expect(list.balance).toBe(200);
    expect(list.items[0]).toMatchObject({ from: { username: fora.username }, amount: 50, note: 'Duas 2M' });
    expect(list.items[1]).toMatchObject({ from: { group: { id: groupId, name: 'Bilene em Dezembro' } }, by: { username: ana.username }, amount: 150 });
    const n = ((await api().get('/api/v1/notifications').set(auth(dono)).expect(200)).body.items as { kind: string; data: Record<string, unknown>; actor: { username: string } }[])[0];
    expect(n).toMatchObject({ kind: 'venue_payment', actor: { username: fora.username }, data: { amount: 50, venueSlug } });

    // Um local que não aceita Txills recusa.
    const other = (await approved(api().post('/api/v1/venues').set(auth(dono)).send({ name: `Tasca TG ${run}`, kind: 'restaurante' }).expect(201))).body.slug as string;
    await api().post(`/api/v1/venues/${other}/pay`).set(auth(fora)).send({ amount: 10, idempotencyKey: key() }).expect(422);
  });

  it('álbum: as fotos e os vídeos da conversa', async () => {
    const empty = (await api().get(g('/album')).set(auth(beto)).expect(200)).body;
    expect(empty).toEqual({ items: [], nextCursor: null });
    await api().get(g('/album')).set(auth(fora)).expect(404);
  });

  it('quando a última pessoa sai, o cofre volta a quem contribuiu', async () => {
    const id = (await api().post('/api/v1/chat/groups').set(auth(beto)).send({ name: 'Fim de semana', kind: 'fim_de_semana', members: [cris.username, dino.username] }).expect(201)).body.id as string;
    await api().post(`/api/v1/chat/groups/${id}/pot/contribute`).set(auth(dino)).send({ amount: 40, idempotencyKey: key() }).expect(201);
    const dinoBefore = await balance(dino);
    await api().delete(`/api/v1/chat/groups/${id}/members/${dino.username}`).set(auth(dino)).expect(204);
    // Quem sai não leva os Txills: ficam no cofre.
    expect((await api().get(`/api/v1/chat/groups/${id}/pot`).set(auth(beto)).expect(200)).body.balance).toBe(40);
    expect(await balance(dino)).toBe(dinoBefore);
    await api().delete(`/api/v1/chat/groups/${id}/members/${cris.username}`).set(auth(beto)).expect(204);
    await api().delete(`/api/v1/chat/groups/${id}/members/${beto.username}`).set(auth(beto)).expect(204);
    expect(await balance(dino)).toBe(dinoBefore + 40);
    const acc = (await pool.query('SELECT balance, group_id FROM ledger.accounts WHERE kind = $1 AND id IN (SELECT e.account_id FROM ledger.entries e JOIN ledger.transactions t ON t.id = e.transaction_id WHERE t.metadata->>$2 = $3)', ['group_pot', 'groupId', id])).rows[0];
    expect(acc).toMatchObject({ balance: '0', group_id: null });
  });

  it('o ledger continua equilibrado', async () => {
    const unbalanced = await pool.query('SELECT transaction_id FROM ledger.entries GROUP BY transaction_id HAVING SUM(amount) <> 0');
    expect(unbalanced.rowCount).toBe(0);
    const drift = await pool.query(
      `SELECT a.id FROM ledger.accounts a LEFT JOIN (SELECT account_id, SUM(amount) s FROM ledger.entries GROUP BY account_id) e ON e.account_id = a.id
        WHERE a.balance <> COALESCE(e.s, 0)`,
    );
    expect(drift.rowCount).toBe(0);
    const negative = await pool.query("SELECT id FROM ledger.accounts WHERE kind <> 'system_issuance' AND balance < 0");
    expect(negative.rowCount).toBe(0);
  });
});
