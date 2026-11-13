import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import webpush from 'web-push';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { GeladaFridayService } from './gelada-friday.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';

interface U { token: string; id: string; username: string; ip: string }

/**
 * «Paga-me uma» (0145), de ponta a ponta: o pedido no chat e publicado, os três botões, os limites, os bloqueios, menores e
 * refresco, o livro (com a confirmação dos dois, perdoar e a privacidade), a rodada, a sexta da gelada (com o relógio
 * falso), a eliminação da conta e a exportação.
 */
describe('«Paga-me uma»: pedidos, livro das geladas, rodadas e sexta (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  let friday: GeladaFridayService;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}`, 'X-Forwarded-For': x.ip });
  const u: Record<string, U> = {};
  const sent: { endpoint: string; payload: { title: string; body: string; url: string; tag?: string } }[] = [];
  let n = 0;

  async function signup(name: string, birthDate: string | null = '1990-06-15'): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    n++;
    const ip = `10.145.${n >> 8}.${n & 255}`;
    const r = await api().post('/api/v1/auth/register').set('X-Forwarded-For', ip)
      .send({ email: `${username}@example.com`, username, displayName: `${name[0].toUpperCase()}${name.slice(1)} Teste`, password: PASSWORD, birthDate: birthDate ?? '1990-06-15', acceptTerms: true }).expect(201);
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
    if (birthDate === null) await pool.query('UPDATE identity.users SET birth_date = NULL WHERE id = $1', [r.body.user.id]);
    return { token: r.body.accessToken, id: r.body.user.id, username, ip };
  }
  const follow = (a: U, b: U) => api().post(`/api/v1/users/${b.username}/follow`).set(auth(a)).expect(200);
  const mutual = async (a: U, b: U) => { await follow(a, b); await follow(b, a); };
  const item = async (slug: string) => (await pool.query(`SELECT md5('taste:' || $1)::uuid::text AS id`, [slug])).rows[0].id as string;
  const ask = (from: U, to: U[], itemId: string, channel: 'chat' | 'post' = 'chat', caption?: string) =>
    api().post('/api/v1/gelada/requests').set(auth(from)).send({ to: to.map((x) => x.username), itemId, channel, caption });
  const answer = (x: U, id: string, a: 'accept' | 'decline' | 'owe') => api().post(`/api/v1/gelada/requests/${id}/answer`).set(auth(x)).send({ answer: a });
  const thread = async (x: U, with_: U) => (await api().get(`/api/v1/chat/with/${with_.username}`).set(auth(x)).expect(200)).body as { items: { kind: string; body: string; gelada?: any }[] };
  const book = async (x: U, of?: U) => (await api().get(of ? `/api/v1/users/${of.username}/gelada/book` : '/api/v1/gelada/book').set(auth(x)).expect(200)).body;
  const post = async (x: U, id: string) => (await api().get(`/api/v1/posts/${id}`).set(auth(x)).expect(200)).body;
  const pushTo = async (x: U) => api().post('/api/v1/push/subscribe').set(auth(x)).send({ endpoint: `https://push.example.com/${run}/${x.username}`, keys: { p256dh: 'p'.repeat(20), auth: 'a'.repeat(16) } }).expect(204);
  const fridaysTo = (x: U) => sent.filter((s) => s.endpoint.endsWith(`/${x.username}`) && s.payload.tag === 'gelada-friday');
  let B2M: string, FANTA: string;

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    const keys = webpush.generateVAPIDKeys();
    jest.spyOn(webpush, 'sendNotification').mockImplementation(async (s, payload) => {
      sent.push({ endpoint: (s as { endpoint: string }).endpoint, payload: JSON.parse(String(payload)) });
      return { statusCode: 201, body: '', headers: {} };
    });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'g'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test', VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey }));
    await app.init();
    friday = app.get(GeladaFridayService);
    B2M = await item('beb-2m');
    FANTA = await item('beb-fanta');
    for (const name of ['ana', 'rui', 'zeca', 'eva', 'olho']) u[name] = await signup(name);
    u.mia = await signup('mia', '2010-03-01'); // 16 anos
    u.nob = await signup('nob', null); // sem data de nascimento: conta como menor
    const { ana, rui, zeca, mia, nob, olho } = u;
    await mutual(ana, rui);
    await mutual(ana, zeca);
    await mutual(ana, mia);
    await mutual(rui, zeca);
    await mutual(ana, nob);
    await follow(olho, ana); // só segue: vê as publicações da ana
  }, 90_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
    jest.restoreAllMocks();
  });

  let accepted: string;

  it('pedido no chat: o cartão chega aos dois (kind gelada) com a bebida, o texto e os botões só para quem recebe', async () => {
    const { ana, rui } = u;
    const r = await ask(ana, [rui], B2M).expect(201);
    expect(r.body.post).toBeNull();
    expect(r.body.requests).toHaveLength(1);
    expect(r.body.requests[0]).toMatchObject({ status: 'pending', channel: 'chat', text: 'Paga-me uma 2M 🍺', mine: true, forMe: false, canAnswer: false, soft: false, drink: { slug: 'beb-2m', name: '2M', alcoholic: true } });
    accepted = r.body.requests[0].id;

    const theirs = (await thread(rui, ana)).items.find((m) => m.kind === 'gelada')!;
    expect(theirs.body).toBe('Paga-me uma 2M 🍺');
    expect(theirs.gelada).toMatchObject({ id: accepted, forMe: true, canAnswer: true, requester: { username: ana.username } });
    const mine = (await thread(ana, rui)).items.find((m) => m.kind === 'gelada')!;
    expect(mine.gelada).toMatchObject({ id: accepted, mine: true, canAnswer: false });
    const list = (await api().get('/api/v1/chat/conversations').set(auth(rui)).expect(200)).body as { username: string; lastMessage: { body: string; kind: string } }[];
    expect(list.find((c) => c.username === ana.username)?.lastMessage).toMatchObject({ body: 'Paga-me uma 2M 🍺', kind: 'gelada' });
  });

  it('os três botões: «Bora!» abre a conversa, «Hoje não» fecha e «Fica a dever» cria a dívida; só quem recebeu e só uma vez', async () => {
    const { ana, rui, zeca } = u;
    await answer(ana, accepted, 'accept').expect(404); // quem pediu não responde
    const a = await answer(rui, accepted, 'accept').expect(200);
    expect(a.body).toMatchObject({ request: { status: 'accepted', canAnswer: false }, debt: null, chatWith: ana.username });
    expect((await answer(rui, accepted, 'decline').expect(409)).body.message).toBe('Já respondeste a este pedido');
    expect((await thread(ana, rui)).items.find((m) => m.kind === 'gelada')!.gelada.status).toBe('accepted');

    const d = (await ask(ana, [zeca], FANTA).expect(201)).body.requests[0].id;
    expect((await answer(zeca, d, 'decline').expect(200)).body.request.status).toBe('declined');

    const o = (await ask(zeca, [rui], B2M).expect(201)).body.requests[0].id;
    const owed = await answer(rui, o, 'owe').expect(200);
    expect(owed.body.request).toMatchObject({ status: 'owed' });
    expect(owed.body.debt).toMatchObject({ iOwe: true, status: 'open', source: 'request', creditor: { username: zeca.username }, drink: { name: '2M' }, canClaim: true });
    expect((await thread(zeca, rui)).items.find((m) => m.kind === 'gelada')!.gelada.debtId).toBe(owed.body.debt.id);
    const zb = await book(zeca);
    expect(zb).toMatchObject({ scope: 'all', public: false, owe: 0, owed: 1 });
    expect(zb.items[0]).toMatchObject({ owedToMe: true, canForgive: true, canConfirm: false });
  });

  it('limites: no máximo 3 por dia ao mesmo amigo e 10 por dia no total (chat e publicação juntos); nunca quantidades', async () => {
    const l1 = await signup('lima');
    const l2 = await signup('limb');
    await mutual(l1, l2);
    for (let i = 0; i < 3; i++) await ask(l1, [l2], FANTA).expect(201);
    expect((await ask(l1, [l2], FANTA).expect(429)).body.message).toMatch(/Já pediste 3 hoje/);
    // Mais 5 pedidos de hoje a outras pessoas (direto na base): 8 no total.
    for (let i = 0; i < 5; i++) {
      await pool.query(`INSERT INTO taste.gelada_requests (id, requester_id, recipient_id, drink_slug, drink_name, drink_category, channel) VALUES (gen_random_uuid(), $1, $2, 'beb-fanta', 'Fanta', 'refrigerante', 'chat')`, [l1.id, u.olho.id]);
    }
    const l3 = await signup('limc');
    const l4 = await signup('limd');
    const l5 = await signup('lime');
    for (const x of [l3, l4, l5]) await mutual(l1, x);
    expect((await ask(l1, [l3, l4, l5], FANTA).expect(429)).body.message).toBe('Hoje só podes pedir a mais 2.');
    await ask(l1, [l3, l4], FANTA).expect(201);
    expect((await ask(l1, [l5], FANTA).expect(429)).body.message).toMatch(/Já fizeste 10 pedidos hoje/);
    expect((await api().get('/api/v1/gelada/drinks').set(auth(l1)).expect(200)).body).toMatchObject({ left: 0, max: 10 });
    // Um pedido é uma bebida: o contrato nem aceita quantidades.
    await api().post('/api/v1/gelada/requests').set(auth(l3)).send({ to: [l1.username], itemId: FANTA, channel: 'chat', quantity: 5 }).expect(201);
  });

  it('bloqueios e quem pode mandar mensagem (dms_allowed) valem para o pedido no chat', async () => {
    const { ana, eva } = u;
    await api().put(`/api/v1/blocks/${ana.username}`).set(auth(eva)).expect(200);
    expect((await ask(ana, [eva], FANTA).expect(403)).body.message).toMatch(/Não podes enviar mensagens/);
    await api().delete(`/api/v1/blocks/${ana.username}`).set(auth(eva)).expect(200);
    const shy = await signup('shy');
    await api().patch('/api/v1/settings/privacy').set(auth(shy)).send({ dmsAllowed: 'off' }).expect(200);
    expect((await ask(ana, [shy], FANTA).expect(403)).body.message).toMatch(/não aceita mensagens novas/);
    expect(await pool.query('SELECT 1 FROM taste.gelada_requests WHERE recipient_id = ANY($1)', [[eva.id, shy.id]]).then((r) => r.rowCount)).toBe(0);
  });

  it('menores (e quem não tem data de nascimento) não veem álcool: só refrescos, e o pedido diz «paga-me um refresco»', async () => {
    const { mia, nob, ana } = u;
    for (const x of [mia, nob]) {
      const d = (await api().get('/api/v1/gelada/drinks').set(auth(x)).expect(200)).body;
      expect(d.soft).toBe(true);
      expect(d.drinks.some((i: { alcoholic: boolean }) => i.alcoholic)).toBe(false);
      expect((await ask(x, [ana], B2M).expect(404)).body.message).toBe('Essa bebida não existe');
    }
    const r = (await ask(mia, [ana], FANTA).expect(201)).body.requests[0];
    expect(r).toMatchObject({ text: 'Paga-me um refresco 🥤', soft: true, drink: { name: 'Fanta', alcoholic: false } });
    expect((await thread(ana, mia)).items.find((m) => m.kind === 'gelada')!.body).toBe('Paga-me um refresco 🥤');
  });

  it('um adulto a pedir álcool a um menor: o pedido passa logo a refresco (no chat)', async () => {
    const { ana, mia } = u;
    expect((await api().get(`/api/v1/gelada/drinks?to=${mia.username}`).set(auth(ana)).expect(200)).body.soft).toBe(true);
    const r = (await ask(ana, [mia], B2M).expect(201)).body.requests[0];
    expect(r.drink.alcoholic).toBe(false);
    expect(r.text).toBe('Paga-me um refresco 🥤');
    const card = (await thread(mia, ana)).items.filter((m) => m.kind === 'gelada').pop()!;
    expect(card.body).toBe('Paga-me um refresco 🥤');
    expect(card.gelada.drink.alcoholic).toBe(false);
    expect(JSON.stringify(card)).not.toMatch(/2M|🍺/);
  });

  let ruiOwesZeca: string;

  it('o livro: «Já paguei» só fica pago quando a outra pessoa confirma (e conta para o nível); «Ainda não» volta atrás', async () => {
    const { rui, zeca, ana } = u;
    ruiOwesZeca = (await book(rui)).items.find((d: { iOwe: boolean }) => d.iOwe).id;
    await api().post(`/api/v1/gelada/debts/${ruiOwesZeca}/confirm`).set(auth(zeca)).expect(409); // ainda não disse que pagou
    const c = await api().post(`/api/v1/gelada/debts/${ruiOwesZeca}/paid`).set(auth(rui)).send({}).expect(200);
    expect(c.body).toMatchObject({ claimed: true, status: 'open', canClaim: false });
    await api().post(`/api/v1/gelada/debts/${ruiOwesZeca}/paid`).set(auth(rui)).send({}).expect(409);
    await api().post(`/api/v1/gelada/debts/${ruiOwesZeca}/confirm`).set(auth(rui)).expect(409); // o devedor não confirma
    await api().post(`/api/v1/gelada/debts/${ruiOwesZeca}/confirm`).set(auth(ana)).expect(404); // nem um terceiro
    expect((await pool.query(`SELECT count(*)::int AS n FROM social.notifications WHERE user_id = $1 AND kind = 'gelada_paid'`, [zeca.id])).rows[0].n).toBe(1);
    const geladas = async (x: U) => (await api().get(`/api/v1/users/${x.username}/geleira/level`).set(auth(x)).expect(200)).body.detail.geladas.points as number;
    const before = [await geladas(rui), await geladas(zeca)];
    const ok = await api().post(`/api/v1/gelada/debts/${ruiOwesZeca}/confirm`).set(auth(zeca)).expect(200);
    expect(ok.body).toMatchObject({ status: 'paid', claimed: false });
    // Nível da geleira (0146): 3 a quem pagou, 2 a quem recebeu.
    expect([await geladas(rui), await geladas(zeca)]).toEqual([before[0] + 3, before[1] + 2]);

    // À mão: «Fico a dever-te uma». Diz que pagou, quem recebe diz «Ainda não».
    const m = await api().post('/api/v1/gelada/debts').set(auth(zeca)).send({ to: ana.username, itemId: B2M }).expect(201);
    expect(m.body).toMatchObject({ source: 'manual', iOwe: true, creditor: { username: ana.username } });
    await api().post(`/api/v1/gelada/debts/${m.body.id}/paid`).set(auth(zeca)).send({}).expect(200);
    expect((await api().post(`/api/v1/gelada/debts/${m.body.id}/reject`).set(auth(ana)).expect(200)).body).toMatchObject({ claimed: false, status: 'open', canConfirm: false });
  });

  it('o teto semanal: a mesma pessoa vale no máximo 6 pontos por semana para o nível; os pedidos sozinhos não valem nada', async () => {
    const p1 = await signup('ptsa');
    const p2 = await signup('ptsb');
    await mutual(p1, p2);
    expect((await api().get(`/api/v1/users/${p1.username}/geleira/level`).set(auth(p1)).expect(200)).body.detail.geladas.points).toBe(0);
    for (let i = 0; i < 4; i++) {
      const d = (await api().post('/api/v1/gelada/debts').set(auth(p1)).send({ to: p2.username, itemId: FANTA }).expect(201)).body.id;
      await api().post(`/api/v1/gelada/debts/${d}/paid`).set(auth(p1)).send({}).expect(200);
      await api().post(`/api/v1/gelada/debts/${d}/confirm`).set(auth(p2)).expect(200);
    }
    expect((await api().get(`/api/v1/users/${p1.username}/geleira/level`).set(auth(p1)).expect(200)).body.detail.geladas).toEqual({ points: 6, paid: 2, received: 0 });
  });

  it('perdoar: só quem recebia fecha a dívida', async () => {
    const { zeca, ana } = u;
    const d = (await book(zeca)).items.find((x: { iOwe: boolean; status: string }) => x.iOwe && x.status === 'open').id;
    await api().post(`/api/v1/gelada/debts/${d}/forgive`).set(auth(zeca)).expect(409);
    expect((await api().post(`/api/v1/gelada/debts/${d}/forgive`).set(auth(ana)).expect(200)).body).toMatchObject({ status: 'forgiven', canForgive: false });
  });

  it('privacidade do livro: por omissão só as duas pessoas veem o que há entre elas; com a opção ligada, quem vê a geleira vê o livro', async () => {
    const { ana, rui, zeca, eva } = u;
    const extra = await api().post('/api/v1/gelada/debts').set(auth(rui)).send({ to: ana.username, itemId: B2M }).expect(201);
    // A zeca vê o livro da ana só com o que há entre as duas (a dívida da ana com o rui não).
    const between = await book(zeca, ana);
    expect(between.scope).toBe('between');
    expect(between.public).toBeUndefined();
    expect(between.items.every((d: { debtor: { username: string }; creditor: { username: string } }) => [d.debtor.username, d.creditor.username].includes(zeca.username))).toBe(true);
    expect(between.items.some((d: { id: string }) => d.id === extra.body.id)).toBe(false);
    // O olho (que só segue a ana) não vê nada.
    expect((await book(u.olho, ana)).items).toEqual([]);

    await api().put('/api/v1/geleira/me/settings').set(auth(ana)).send({ bookPublic: true }).expect(200);
    expect((await book(ana)).public).toBe(true);
    const all = await book(u.olho, ana);
    expect(all.scope).toBe('all');
    expect(all.items.some((d: { id: string }) => d.id === extra.body.id)).toBe(true);
    // Geleira só para mim: o livro volta a ser só entre os dois, mesmo com a opção ligada.
    await api().put('/api/v1/geleira/me/settings').set(auth(ana)).send({ visibility: 'me' }).expect(200);
    expect((await book(u.olho, ana)).scope).toBe('between');
    await api().put('/api/v1/geleira/me/settings').set(auth(ana)).send({ visibility: 'everyone', bookPublic: false }).expect(200);
    // Com bloqueio: 404.
    await api().put(`/api/v1/blocks/${eva.username}`).set(auth(ana)).expect(200);
    await api().get(`/api/v1/users/${ana.username}/gelada/book`).set(auth(eva)).expect(404);
    await api().delete(`/api/v1/blocks/${eva.username}`).set(auth(ana)).expect(200);
  });

  let groupId: string;

  it('rodada no TxillGroup: abrir, entrar com a bebida, «Esta pago eu», fechar com o livro e a sugestão de quem paga a seguir', async () => {
    const { ana, rui, zeca, mia } = u;
    groupId = (await api().post('/api/v1/chat/groups').set(auth(ana)).send({ name: 'Sexta', members: [rui.username, zeca.username, mia.username] }).expect(201)).body.id;
    const r = (await api().post(`/api/v1/chat/groups/${groupId}/rodadas`).set(auth(ana)).expect(201)).body;
    expect(r).toMatchObject({ status: 'open', payer: null, entries: [], lastPayer: null, canClose: true, canBill: false });
    expect(r.suggestedPayer).not.toBeNull();
    expect((await api().post(`/api/v1/chat/groups/${groupId}/rodadas`).set(auth(rui)).expect(409)).body.message).toBe('Já há uma rodada aberta neste grupo');
    const card = ((await api().get(`/api/v1/chat/groups/${groupId}`).set(auth(rui)).expect(200)).body.items as { kind: string; rodada?: { id: string } }[]).find((m) => m.kind === 'rodada')!;
    expect(card.rodada?.id).toBe(r.id);

    await api().put(`/api/v1/gelada/rounds/${r.id}/entry`).set(auth(rui)).send({ itemId: B2M }).expect(200);
    await api().put(`/api/v1/gelada/rounds/${r.id}/entry`).set(auth(mia)).send({ itemId: B2M }).expect(404); // menor: sem álcool
    await api().put(`/api/v1/gelada/rounds/${r.id}/entry`).set(auth(mia)).send({ itemId: FANTA }).expect(200);
    const seenByMia = (await api().get(`/api/v1/gelada/rounds/${r.id}`).set(auth(mia)).expect(200)).body;
    expect(seenByMia.entries.find((e: { person: { username: string } }) => e.person.username === rui.username).drink).toMatchObject({ masked: true, name: 'Uma bebida' });
    await api().put(`/api/v1/gelada/rounds/${r.id}/payer`).set(auth(zeca)).expect(200);
    expect((await api().put(`/api/v1/gelada/rounds/${r.id}/payer`).set(auth(ana)).expect(409)).body.message).toBe(`Esta já é paga por @${zeca.username}`);
    await api().put(`/api/v1/gelada/rounds/${r.id}/entry`).set(auth(zeca)).send({ itemId: B2M }).expect(200);
    const view = (await api().get(`/api/v1/gelada/rounds/${r.id}`).set(auth(ana)).expect(200)).body;
    expect(view).toMatchObject({ payer: { username: zeca.username }, suggestedPayer: null });
    expect(view.entries).toHaveLength(3);
    // Só quem paga põe a rodada no livro; quem não abriu, não paga nem administra não fecha.
    await api().post(`/api/v1/gelada/rounds/${r.id}/close`).set(auth(rui)).send({}).expect(403);
    await api().post(`/api/v1/gelada/rounds/${r.id}/close`).set(auth(ana)).send({ bill: true }).expect(403);
    const closed = (await api().post(`/api/v1/gelada/rounds/${r.id}/close`).set(auth(zeca)).send({ bill: true }).expect(200)).body;
    expect(closed).toMatchObject({ status: 'closed', canClose: false });
    const debts = (await pool.query(`SELECT d.debtor_id, d.drink_name FROM taste.gelada_debts d WHERE d.round_id = $1 ORDER BY d.drink_name`, [r.id])).rows;
    expect(debts).toEqual([{ debtor_id: rui.id, drink_name: '2M' }, { debtor_id: mia.id, drink_name: 'Fanta' }].sort((a, b) => a.drink_name.localeCompare(b.drink_name)));

    // A próxima: a última foi do zeca, por isso a sugestão é outra pessoa.
    const next = (await api().post(`/api/v1/chat/groups/${groupId}/rodadas`).set(auth(rui)).expect(201)).body;
    expect(next.lastPayer).toMatchObject({ username: zeca.username });
    expect(next.suggestedPayer.username).not.toBe(zeca.username);
  });

  it('sexta da gelada (relógio falso): à sexta às 17h, uma vez, a quem tem dívidas por cobrar ou amigos ativos; menores na versão refresco', async () => {
    const { zeca, mia, ana, rui } = u;
    for (const x of [zeca, mia, ana, rui]) await pushTo(x);
    await pool.query('UPDATE identity.users SET last_seen_at = now() WHERE id = ANY($1)', [[zeca.id, mia.id, ana.id, rui.id]]);
    // Uma sexta-feira às 17h30 de Maputo (15h30 UTC) e a quinta antes.
    const fri = new Date();
    fri.setUTCDate(fri.getUTCDate() + ((5 - fri.getUTCDay() + 7) % 7));
    fri.setUTCHours(15, 30, 0, 0);
    const thu = new Date(fri.getTime() - 86_400_000);
    const only = [zeca.id, mia.id, rui.id];
    expect(await friday.run({ now: thu, onlyUsers: only })).toEqual({ sent: 0, outside: true });
    expect(await friday.run({ now: new Date(fri.getTime() - 3 * 3_600_000), onlyUsers: only })).toEqual({ sent: 0, outside: true }); // 14h30

    // O rui desliga a sexta da gelada.
    await api().put('/api/v1/notifications/settings').set(auth(rui)).send({ off: ['gelada'] }).expect((r) => expect([200, 204]).toContain(r.status));
    const res = await friday.run({ now: fri, onlyUsers: only });
    expect(res.sent).toBe(2);
    const z = fridaysTo(zeca);
    expect(z).toHaveLength(1);
    // O rui deve uma ao zeca (da rodada): cobra-lhe.
    expect(z[0].payload.body).toBe(`É sexta 🍻 @${rui.username} ainda te deve uma. Cobra-lhe! Bebe com moderação 🙌`);
    expect(z[0].payload.url).toBe('/geladas');
    const m = fridaysTo(mia);
    expect(m).toHaveLength(1);
    expect(m[0].payload.body).not.toMatch(/🍻|🍺|gelada|Bebe/);
    expect(m[0].payload.body).toMatch(/^É sexta 🥤 .*Com calma e boa sexta 🙌$/);
    expect(fridaysTo(rui)).toHaveLength(0);
    // Uma vez por sexta, mesmo que a tarefa corra outra vez à hora seguinte.
    expect((await friday.run({ now: new Date(fri.getTime() + 3_600_000), onlyUsers: only })).sent).toBe(0);
    expect(fridaysTo(zeca)).toHaveLength(1);
  });

  let postId: string;

  it('publicado: as pessoas ficam identificadas, recebem o aviso, só elas têm os botões e o estado vê-se por todos', async () => {
    const { ana, rui, zeca, olho } = u;
    const r = await ask(ana, [rui, zeca], B2M, 'post', 'Sexta é sexta #gelada').expect(201);
    postId = r.body.post.id;
    expect(r.body.post.body).toBe('Sexta é sexta #gelada');
    expect(r.body.post.gelada).toMatchObject({ text: 'Paga-me uma 2M 🍺', gone: 0, drink: { name: '2M' } });
    expect(r.body.post.gelada.requests.map((q: { recipient: { username: string } }) => q.recipient.username)).toEqual([rui.username, zeca.username]);
    for (const x of [rui, zeca]) {
      const nn = (await pool.query(`SELECT data FROM social.notifications WHERE user_id = $1 AND actor_id = $2 AND kind = 'gelada_tag'`, [x.id, ana.id])).rows;
      expect(nn).toHaveLength(1);
      expect(nn[0].data).toMatchObject({ postId, soft: false });
    }
    const forRui = (await post(rui, postId)).gelada.requests;
    expect(forRui.find((q: { forMe: boolean }) => q.forMe)).toMatchObject({ recipient: { username: rui.username }, canAnswer: true, canUntag: true });
    expect(forRui.find((q: { forMe: boolean }) => !q.forMe).canAnswer).toBe(false);
    expect((await post(ana, postId)).gelada.requests.every((q: { canAnswer: boolean }) => !q.canAnswer)).toBe(true);
    expect((await post(olho, postId)).gelada.requests.every((q: { canAnswer: boolean }) => !q.canAnswer)).toBe(true);
    // Um terceiro não responde pelo rui.
    await answer(olho, forRui[0].id, 'accept').expect(404);

    const ruiReq = forRui.find((q: { forMe: boolean }) => q.forMe).id;
    const a = await answer(rui, ruiReq, 'owe').expect(200);
    expect(a.body.debt).toMatchObject({ iOwe: true, source: 'request', creditor: { username: ana.username } });
    expect((await post(olho, postId)).gelada.requests.find((q: { recipient: { username: string } }) => q.recipient.username === rui.username).status).toBe('owed');
    expect((await pool.query(`SELECT data FROM social.notifications WHERE user_id = $1 AND kind = 'gelada_answer'`, [ana.id])).rows[0].data).toMatchObject({ answer: 'owe', postId });
    expect((await book(ana)).items.some((d: { id: string }) => d.id === a.body.debt.id)).toBe(true);
    // Os outros brindam e comentam como de costume.
    await api().post(`/api/v1/posts/${postId}/cheers`).set(auth(olho)).expect((x) => expect([200, 201]).toContain(x.status));
    // Aparece nas identificações do rui.
    const tagged = (await api().get(`/api/v1/users/${rui.username}/posts?tab=tagged`).set(auth(olho)).expect(200)).body;
    expect((tagged.items ?? tagged).some((p: { id: string }) => p.id === postId)).toBe(true);
  });

  it('publicado: tirar a identificação fecha o pedido para mim (e o aviso sai)', async () => {
    const { zeca } = u;
    const mine = (await post(zeca, postId)).gelada.requests.find((q: { forMe: boolean }) => q.forMe);
    const after = (await api().delete(`/api/v1/posts/${postId}/tags/me`).set(auth(zeca)).expect(200)).body;
    expect(after.gelada.requests.some((q: { recipient: { username: string } }) => q.recipient.username === zeca.username)).toBe(false);
    expect((await answer(zeca, mine.id, 'accept').expect(409)).body.message).toBe('Saíste deste pedido');
    expect((await pool.query(`SELECT count(*)::int AS n FROM social.notifications WHERE user_id = $1 AND kind = 'gelada_tag' AND data->>'postId' = $2`, [zeca.id, postId])).rows[0].n).toBe(0);
  });

  it('publicado: só a seguidores mútuos, que aceitam menções; com bloqueio não; os limites contam juntos', async () => {
    const { ana, olho, eva, zeca } = u;
    expect((await ask(ana, [olho], B2M, 'post').expect(403)).body.message).toMatch(/Em público só pedes a quem te segue e tu segues de volta/);
    await mutual(eva, ana);
    await api().put(`/api/v1/blocks/${ana.username}`).set(auth(eva)).expect(200);
    expect((await ask(ana, [eva], B2M, 'post').expect(403)).body.message).toBe(`Não podes pedir a @${eva.username}`);
    await api().patch('/api/v1/settings/privacy').set(auth(zeca)).send({ mentionsAllowed: 'off' }).expect(200);
    expect((await ask(ana, [zeca], B2M, 'post').expect(403)).body.message).toMatch(/não deixa ser mencionado/);
    // No chat continua a dar (as regras de mensagens). É o 3.º pedido de hoje da ana à zeca (chat, post e este): o 4.º já não.
    await ask(ana, [zeca], FANTA, 'chat').expect(201);
    expect((await ask(ana, [zeca], FANTA, 'chat').expect(429)).body.message).toMatch(/Já pediste 3 hoje/);
    await api().patch('/api/v1/settings/privacy').set(auth(zeca)).send({ mentionsAllowed: 'everyone' }).expect(200);
  });

  it('publicado a um menor: o pedido dele passa a refresco, e um menor que vê o post de dois adultos não vê a bebida', async () => {
    const { ana, mia } = u;
    const r = await ask(ana, [mia], B2M, 'post').expect(201);
    expect(r.body.post.gelada.drink.alcoholic).toBe(false);
    expect(r.body.post.gelada.requests[0]).toMatchObject({ soft: true, text: 'Paga-me um refresco 🥤' });
    expect((await pool.query(`SELECT data FROM social.notifications WHERE user_id = $1 AND kind = 'gelada_tag'`, [mia.id])).rows[0].data.soft).toBe(true);
    // O post da ana ao rui (2M), visto pela mia (que segue a ana).
    const seen = (await post(mia, postId)).gelada;
    expect(seen.drink).toMatchObject({ masked: true, name: 'Uma bebida', alcoholic: false });
    expect(seen.text).toBe('Paga-me uma bebida 🥤');
    expect(JSON.stringify(seen)).not.toMatch(/2M|🍺/);
  });

  it('a exportação traz os pedidos, o livro, as rodadas e os avisos de sexta', async () => {
    const { zeca } = u;
    const r = await api().get('/api/v1/me/export').set(auth(zeca)).expect(200);
    const body = typeof r.body === 'object' && Object.keys(r.body).length ? r.body : JSON.parse(r.text);
    expect(body.geladaRequestsSent.length).toBeGreaterThan(0);
    expect(body.geladaRequestsReceived.length).toBeGreaterThan(0);
    expect(body.geladaBook.length).toBeGreaterThan(0);
    expect(body.geladaRounds.some((x: { iPaid: boolean }) => x.iPaid)).toBe(true);
    expect(body.geladaFridays).toHaveLength(1);
    expect(body.settings).toHaveProperty('geladaBookPublic', false);
  });

  it('apagar a conta leva os pedidos, as dívidas e as rodadas dela; os cartões do outro lado ficam sem pedido («Conta eliminada»)', async () => {
    const { ana, rui, zeca } = u;
    const del = await signup('adeus');
    await mutual(del, ana);
    await mutual(del, rui);
    const chatReq = (await ask(del, [ana], B2M).expect(201)).body.requests[0].id;
    const toDel = (await ask(rui, [del], B2M).expect(201)).body.requests[0].id;
    await answer(del, toDel, 'owe').expect(200);
    const pub = (await ask(ana, [del, rui], B2M, 'post').expect(201)).body.post.id;
    // Na rodada aberta do grupo, entra pelo convite do grupo.
    await api().post(`/api/v1/chat/groups/${groupId}/members`).set(auth(ana)).send({ members: [del.username] }).expect((x) => expect([200, 201, 204]).toContain(x.status));
    const open = (await pool.query(`SELECT id FROM taste.gelada_rounds WHERE group_id = $1 AND status = 'open'`, [groupId])).rows[0].id as string;
    await api().put(`/api/v1/gelada/rounds/${open}/entry`).set(auth(del)).send({ itemId: B2M }).expect(200);
    const delRound = await pool.query(`INSERT INTO taste.gelada_rounds (id, group_id, opened_by, status, closed_at) VALUES (gen_random_uuid(), $1, $2, 'closed', now()) RETURNING id`, [groupId, del.id]);

    await api().post('/api/v1/auth/delete-account').set(auth(del)).send({ confirmUsername: del.username, password: PASSWORD }).expect(204);

    const left = async (sql: string, p: unknown[]) => (await pool.query(sql, p)).rowCount;
    expect(await left('SELECT 1 FROM taste.gelada_requests WHERE requester_id = $1 OR recipient_id = $1', [del.id])).toBe(0);
    expect(await left('SELECT 1 FROM taste.gelada_debts WHERE debtor_id = $1 OR creditor_id = $1', [del.id])).toBe(0);
    expect(await left('SELECT 1 FROM taste.gelada_round_entries WHERE user_id = $1', [del.id])).toBe(0);
    expect(await left('SELECT 1 FROM taste.gelada_rounds WHERE id = $1', [delRound.rows[0].id])).toBe(0);
    expect(await left('SELECT 1 FROM taste.gelada_requests WHERE id = ANY($1)', [[chatReq, toDel]])).toBe(0);
    // O post da ana: a pessoa eliminada sai e conta como «Conta eliminada» (gone).
    const g = (await post(zeca, pub)).gelada;
    expect(g.gone).toBe(1);
    expect(g.requests.map((q: { recipient: { username: string } }) => q.recipient.username)).toEqual([rui.username]);
    // Um cartão de chat cujo pedido já não existe vem com `gelada: null` (a app diz «Conta eliminada»).
    const orphan = await pool.query(`SELECT r.message_id FROM taste.gelada_requests r WHERE r.requester_id = $1 AND r.recipient_id = $2 AND r.channel = 'chat' LIMIT 1`, [zeca.id, rui.id]);
    await pool.query('DELETE FROM taste.gelada_requests WHERE message_id = $1', [orphan.rows[0].message_id]);
    const t = (await thread(rui, zeca)).items.find((m) => m.kind === 'gelada');
    expect(t?.gelada).toBeNull();
  });
});
