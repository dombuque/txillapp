import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { staffLogin } from '../staff/staff-test';
import { ModerationService, REPORT_EVIDENCE_DAYS } from '../moderation/moderation.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';

interface U { token: string; id: string; username: string }
interface Item { id: string; body: string; kind: string; deleted?: boolean; lat: number | null; lng: number | null; placeName: string | null; placeAddress: string | null; live: boolean; liveUntil: string | null; giftAmount: number | null }
interface Queued { type: string; id: string; preview: string; reported: Record<string, unknown> | null; current: Record<string, unknown> | null }

/**
 * Privacidade do chat novo (v1.21.0):
 * 1. a exportação traz as mensagens que enviei também nos TxillGroups, com edição, sítio e partilha em direto, e as que apaguei para mim;
 * 2. eliminar a conta leva também o "Apagar para mim" e o resto do chat novo;
 * 3. "Apagar para todos" tira também a duração, o valor do presente (sem desfazer o presente), a visualização única, as reações,
 *    as vistas e, numa sondagem de grupo, a sondagem com as opções e os votos;
 * 4. a remoção pela moderação faz o mesmo (também o sítio e a partilha em direto);
 * 5. as denúncias de mensagens guardam uma cópia do que foi denunciado; a moderação vê a cópia e, se mudou, o atual;
 * 6. uma partilha em direto que acabou deixa de servir a última posição; as localizações fixas mantêm o ponto.
 */
describe('privacidade do chat: exportação, eliminar conta, apagar para todos, moderação, prova nas denúncias e partilha em direto (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  const u: Record<string, U> = {};
  let staff = '';
  const sauth = () => ({ Authorization: `Bearer ${staff}` });
  let group = '';

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  const send = async (from: U, to: U, body: string, extra: Record<string, unknown> = {}) =>
    (await api().post(`/api/v1/chat/with/${to.username}`).set(auth(from)).send({ body, ...extra }).expect(201)).body.id as string;
  const sendGroup = async (from: U, body: string, extra: Record<string, unknown> = {}) =>
    (await api().post(`/api/v1/chat/groups/${group}/messages`).set(auth(from)).send({ body, ...extra }).expect(201)).body.id as string;
  const thread = async (x: U, other: U) => (await api().get(`/api/v1/chat/with/${other.username}`).set(auth(x)).expect(200)).body.items as Item[];
  const groupThread = async (x: U) => (await api().get(`/api/v1/chat/groups/${group}`).set(auth(x)).expect(200)).body.items as (Item & { poll?: unknown })[];
  const row = async (id: string) => (await pool.query('SELECT * FROM social.messages WHERE id = $1', [id])).rows[0];
  const count = async (sql: string, args: unknown[]) => (await pool.query(sql, args)).rows[0].n as number;
  const queue = async () => (await api().get('/api/v1/admin/reports').set(sauth()).expect(200)).body as Queued[];
  const report = (x: U, id: string) => api().post('/api/v1/reports').set(auth(x)).send({ type: 'message', id, reason: 'harassment' });

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'p'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    for (const n of ['pva', 'pvb', 'pvc', 'pvd', 'pve']) u[n] = await signup(n);
    const ids = Object.values(u).map((x) => x.id);
    for (const a of ids) for (const b of ids) if (a !== b) await pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [a, b]);
    group = (await api().post('/api/v1/chat/groups').set(auth(u.pva)).send({ name: `Privacidade ${run}`, members: [u.pvb.username, u.pvc.username] }).expect(201)).body.id;
    staff = (await staffLogin(app, 'pvstaff')).token;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('1. exportação: as minhas mensagens (conversas e TxillGroups) com edição, sítio e partilha em direto; as que apaguei para mim; nunca as dos outros', async () => {
    const { pva: a, pvb: b } = u;
    const text = await send(a, b, 'texto original');
    await api().patch(`/api/v1/chat/messages/${text}`).set(auth(a)).send({ body: 'texto editado' }).expect(200);
    const spot = await send(a, b, '', { kind: 'location', lat: -25.96553, lng: 32.58322, name: 'Café Central', address: 'Av. Julius Nyerere, Maputo' });
    const live = await send(a, b, '', { kind: 'location', lat: -25.9, lng: 32.5, liveMinutes: 15 });
    const inGroup = await sendGroup(a, 'olá grupo');
    const fromB = await send(b, a, 'isto é da outra pessoa e não vai no export');
    const fromBInGroup = await sendGroup(b, 'isto é do grupo, da outra pessoa');
    await api().post(`/api/v1/chat/messages/${fromB}/hide`).set(auth(a)).expect(204);

    const ex = (await api().get('/api/v1/me/export').set(auth(a)).expect(200)).body;
    const sent = ex.messagesSent as Record<string, unknown>[];
    const byId = new Map(sent.map((m) => [m.id as string, m]));
    expect(byId.get(text)).toMatchObject({ to: b.username, group: null, kind: 'text', body: 'texto editado' });
    expect(byId.get(text)!.editedAt).toBeTruthy();
    expect(byId.get(spot)).toMatchObject({ kind: 'location', lat: -25.96553, lng: 32.58322, placeName: 'Café Central', placeAddress: 'Av. Julius Nyerere, Maputo', liveUntil: null, editedAt: null });
    expect(byId.get(live)!.liveUntil).toBeTruthy();
    expect(byId.get(inGroup)).toMatchObject({ to: null, group: `Privacidade ${run}`, body: 'olá grupo' });
    // As que recebi não entram (nem pelo id nem pelo texto); as que apaguei para mim só com o id e a hora.
    expect(byId.has(fromB)).toBe(false);
    expect(byId.has(fromBInGroup)).toBe(false);
    expect(JSON.stringify(ex)).not.toContain('isto é da outra pessoa');
    expect(JSON.stringify(ex)).not.toContain('isto é do grupo, da outra pessoa');
    const hidden = ex.messagesHiddenForMe as { id: string; hiddenAt: string }[];
    expect(hidden).toEqual([{ id: fromB, hiddenAt: expect.any(String) }]);
  });

  it('2. eliminar a conta: o "Apagar para mim", as mensagens editadas, os sítios e a partilha em direto a decorrer saem todos', async () => {
    const { pva: a, pvd: d } = u;
    const fromA = await send(a, d, 'mensagem da outra pessoa');
    await api().post(`/api/v1/chat/messages/${fromA}/hide`).set(auth(d)).expect(204);
    const fromAGroup = await sendGroup(a, 'no grupo, de outra pessoa');
    // d não está no grupo: esconde-se à força para provar que o DELETE apanha também os grupos.
    await pool.query('INSERT INTO social.message_hidden (user_id, message_id) VALUES ($1, $2)', [d.id, fromAGroup]);
    const edited = await send(d, a, 'antes');
    await api().patch(`/api/v1/chat/messages/${edited}`).set(auth(d)).send({ body: 'depois' }).expect(200);
    await send(d, a, '', { kind: 'location', lat: -25.95, lng: 32.57, name: 'Casa', address: 'Rua 1' });
    await send(d, a, '', { kind: 'location', lat: -25.95, lng: 32.57, liveMinutes: 60 });
    expect(await count('SELECT count(*)::int AS n FROM social.message_hidden WHERE user_id = $1', [d.id])).toBe(2);

    await api().post('/api/v1/auth/delete-account').set(auth(d)).send({ confirmUsername: d.username, password: PASSWORD }).expect(204);
    expect(await count('SELECT count(*)::int AS n FROM social.message_hidden WHERE user_id = $1', [d.id])).toBe(0);
    expect(await count('SELECT count(*)::int AS n FROM social.messages WHERE sender_id = $1', [d.id])).toBe(0);
    // As mensagens dos outros continuam (só o "esconder" da pessoa eliminada se foi).
    expect(await row(fromAGroup)).toBeTruthy();
  });

  it('3. apagar para todos: tira a duração, o valor do presente (o presente fica na carteira), a visualização única, as reações e as vistas; o tipo passa a texto', async () => {
    const { pva: a, pvb: b } = u;
    // Presente: a transação da carteira não se desfaz.
    const tx = (await api().post('/api/v1/gifts').set(auth(a)).set('Idempotency-Key', `priv-gift-${run}`).send({ toUsername: b.username, amount: 10, note: 'por minha conta', visibility: 'private' }).expect(201)).body.transactionId as string;
    const gift = await send(a, b, tx, { kind: 'gift' });
    const ledgerBefore = (await pool.query('SELECT e.account_id, e.amount FROM ledger.entries e WHERE e.transaction_id = $1 ORDER BY e.account_id', [tx])).rows;
    const balanceB = (await pool.query('SELECT balance FROM ledger.accounts WHERE user_id = $1', [b.id])).rows[0].balance;
    await api().put(`/api/v1/chat/messages/${gift}/reaction`).set(auth(b)).send({ reaction: ':amor:' }).expect(204);
    expect(await count('SELECT count(*)::int AS n FROM social.message_reactions WHERE message_id = $1', [gift])).toBe(1);
    await api().delete(`/api/v1/chat/messages/${gift}`).set(auth(a)).expect(204);
    const g = await row(gift);
    expect(g).toMatchObject({ gift_amount: null, body: '', kind: 'text', deleted_notice: true, gift_tx: tx });
    expect(await count('SELECT count(*)::int AS n FROM social.message_reactions WHERE message_id = $1', [gift])).toBe(0);
    expect((await pool.query('SELECT e.account_id, e.amount FROM ledger.entries e WHERE e.transaction_id = $1 ORDER BY e.account_id', [tx])).rows).toEqual(ledgerBefore);
    expect((await pool.query('SELECT balance FROM ledger.accounts WHERE user_id = $1', [b.id])).rows[0].balance).toBe(balanceB);
    expect(await count('SELECT count(*)::int AS n FROM ledger.transactions WHERE id = $1', [tx])).toBe(1);
    // O mesmo presente não volta a entrar na conversa.
    await api().post(`/api/v1/chat/with/${b.username}`).set(auth(a)).send({ kind: 'gift', body: tx }).expect(400);
    const shown = (await thread(b, a)).find((m) => m.id === gift)!;
    expect(shown).toMatchObject({ deleted: true, kind: 'text', body: 'Esta mensagem foi apagada', giftAmount: null });

    // Duração (de uma voz ou vídeo) e visualização única.
    const once = await send(a, b, 'só uma vez', { once: true });
    await pool.query('UPDATE social.messages SET duration_ms = 4200 WHERE id = $1', [once]);
    await api().delete(`/api/v1/chat/messages/${once}`).set(auth(a)).expect(204);
    expect(await row(once)).toMatchObject({ duration_ms: null, view_once: false, viewed_at: null, body: '' });

    // Vistas de uma visualização única no grupo.
    const gOnce = await sendGroup(a, 'segredo do grupo', { once: true });
    await api().post(`/api/v1/chat/messages/${gOnce}/open`).set(auth(b)).expect(200);
    expect(await count('SELECT count(*)::int AS n FROM social.message_views WHERE message_id = $1', [gOnce])).toBe(1);
    await api().delete(`/api/v1/chat/messages/${gOnce}`).set(auth(a)).expect(204);
    expect(await count('SELECT count(*)::int AS n FROM social.message_views WHERE message_id = $1', [gOnce])).toBe(0);
    expect(await row(gOnce)).toMatchObject({ view_once: false, body: '', deleted_notice: true });
  });

  it('3. apagar para todos uma sondagem de grupo: a sondagem, as opções e os votos vão-se (também do plano)', async () => {
    const { pva: a, pvb: b } = u;
    const poll = (await api().post(`/api/v1/chat/groups/${group}/polls`).set(auth(a)).send({ question: 'Onde jantamos?', options: ['Baixa', 'Costa do Sol'] }).expect(201)).body as { id: string; options: { id: string }[] };
    await api().post(`/api/v1/chat/groups/${group}/polls/${poll.id}/vote`).set(auth(b)).send({ optionIds: [poll.options[0].id] }).expect(200);
    const msg = (await groupThread(a)).find((m) => m.kind === 'poll' && m.body === poll.id)!;
    expect(msg).toBeTruthy();
    // Só quem a enviou apaga para todos.
    await api().delete(`/api/v1/chat/messages/${msg.id}`).set(auth(b)).expect(404);
    await api().delete(`/api/v1/chat/messages/${msg.id}`).set(auth(a)).expect(204);
    expect(await count('SELECT count(*)::int AS n FROM social.group_polls WHERE id = $1', [poll.id])).toBe(0);
    expect(await count('SELECT count(*)::int AS n FROM social.group_poll_options WHERE poll_id = $1', [poll.id])).toBe(0);
    expect(await count('SELECT count(*)::int AS n FROM social.group_poll_votes WHERE poll_id = $1', [poll.id])).toBe(0);
    const after = (await groupThread(b)).find((m) => m.id === msg.id)!;
    expect(after).toMatchObject({ deleted: true, kind: 'text', body: 'Esta mensagem foi apagada' });
    expect(after.poll).toBeUndefined();
    const plan = (await api().get(`/api/v1/chat/groups/${group}/plan`).set(auth(b)).expect(200)).body as { polls: { id: string }[] };
    expect(plan.polls.find((p) => p.id === poll.id)).toBeUndefined();
  });

  it('4 e 5. denúncia guarda a cópia; a moderação vê a cópia e o atual se mudou; remover limpa também o sítio e a partilha em direto', async () => {
    const { pva: a, pvb: b } = u;
    // Uma mensagem de texto denunciada e depois editada.
    const text = await send(a, b, 'mensagem ofensiva');
    await report(b, text).expect(204);
    await api().patch(`/api/v1/chat/messages/${text}`).set(auth(a)).send({ body: 'mensagem simpática' }).expect(200);
    let q = (await queue()).find((x) => x.id === text)!;
    expect(q.reported).toMatchObject({ kind: 'text', body: 'mensagem ofensiva', editedAt: null, placeName: null });
    expect(q.current).toMatchObject({ body: 'mensagem simpática', deleted: false });
    expect(q.current!.editedAt).toBeTruthy();
    expect(q.preview).toBe('mensagem ofensiva');
    // Apagada para todos depois de denunciada: a cópia fica.
    await api().delete(`/api/v1/chat/messages/${text}`).set(auth(a)).expect(204);
    q = (await queue()).find((x) => x.id === text)!;
    expect(q.reported).toMatchObject({ body: 'mensagem ofensiva' });
    expect(q.current).toMatchObject({ deleted: true, body: '' });

    // Uma que não mudou: só a cópia (current null).
    const same = await send(a, b, 'igual ao denunciado');
    await report(b, same).expect(204);
    expect((await queue()).find((x) => x.id === same)).toMatchObject({ reported: { body: 'igual ao denunciado' }, current: null });
    // A cópia está na denúncia.
    expect((await pool.query("SELECT evidence FROM social.reports WHERE target_type = 'message' AND target_id = $1", [same])).rows[0].evidence).toMatchObject({ kind: 'text', body: 'igual ao denunciado' });

    // Um sítio e uma partilha em direto denunciados e removidos pela moderação: sai tudo, a cópia (nome e morada) fica.
    const spot = await send(a, b, '', { kind: 'location', lat: -25.96, lng: 32.58, name: 'Bar X', address: 'Rua Y' });
    const live = await send(a, b, '', { kind: 'location', lat: -25.97, lng: 32.59, liveMinutes: 60 });
    await report(b, spot).expect(204);
    await report(b, live).expect(204);
    expect((await queue()).find((x) => x.id === spot)).toMatchObject({ reported: { kind: 'location', placeName: 'Bar X', placeAddress: 'Rua Y' }, current: null });
    for (const id of [spot, live]) await api().post('/api/v1/admin/reports/resolve').set(sauth()).send({ type: 'message', id, action: 'remove' }).expect(204);
    for (const id of [spot, live]) {
      const r = await row(id);
      expect(r).toMatchObject({ lat: null, lng: null, place_name: null, place_address: null, live_until: null, body: '', kind: 'text', deleted_notice: false });
      expect(r.deleted_at).toBeTruthy();
    }
    // O histórico (decididas) mostra a cópia e o atual (removida).
    const decided = (await api().get('/api/v1/admin/reports/decided?status=actioned').set(sauth()).expect(200)).body.items as Queued[];
    expect(decided.find((x) => x.id === spot)).toMatchObject({ reported: { placeName: 'Bar X' }, current: { deleted: true } });
    // Na conversa já nem aparece (a moderação remove sem aviso).
    expect((await thread(b, a)).find((m) => m.id === spot)).toBeUndefined();
  });

  it('5. nos TxillGroups também se denuncia uma mensagem (só quem é membro) e a cópia fica guardada', async () => {
    const { pva: a, pvb: b, pve: outsider } = u;
    const msg = await sendGroup(a, 'ofensa no grupo');
    await report(b, msg).expect(204);
    // Quem não é membro não a vê, por isso não a pode denunciar (nem confirmar que existe).
    await report(outsider, msg).expect(404);
    await api().patch(`/api/v1/chat/messages/${msg}`).set(auth(a)).send({ body: 'já não é ofensa' }).expect(200);
    expect((await queue()).find((x) => x.id === msg)).toMatchObject({ reported: { body: 'ofensa no grupo' }, current: { body: 'já não é ofensa', deleted: false } });
  });

  it(`5. prazo da prova: ${REPORT_EVIDENCE_DAYS} dias depois de decidida a denúncia, a cópia apaga-se e a denúncia fica; por decidir, fica`, async () => {
    const { pva: a, pvb: b, pvc: c } = u;
    const old = await send(a, b, 'decidida há muito');
    const recent = await send(a, b, 'decidida há pouco');
    const open = await send(a, c, 'ainda por decidir');
    for (const [x, id] of [[b, old], [b, recent], [c, open]] as [U, string][]) await report(x, id).expect(204);
    for (const id of [old, recent]) await api().post('/api/v1/admin/reports/resolve').set(sauth()).send({ type: 'message', id, action: 'dismiss' }).expect(204);
    const ev = async (id: string) => (await pool.query("SELECT evidence, status FROM social.reports WHERE target_type = 'message' AND target_id = $1", [id])).rows[0];
    // A decisão (e a denúncia por decidir) com datas antigas: só a decidida há mais de 180 dias perde a cópia.
    await pool.query(`UPDATE social.reports SET resolved_at = now() - interval '${REPORT_EVIDENCE_DAYS + 1} days' WHERE target_type = 'message' AND target_id = $1`, [old]);
    await pool.query(`UPDATE social.reports SET resolved_at = now() - interval '${REPORT_EVIDENCE_DAYS - 1} days' WHERE target_type = 'message' AND target_id = $1`, [recent]);
    await pool.query(`UPDATE social.reports SET created_at = now() - interval '400 days' WHERE target_type = 'message' AND target_id = $1`, [open]);

    expect(await app.get(ModerationService).purgeEvidence()).toBeGreaterThanOrEqual(1);
    expect(await ev(old)).toMatchObject({ evidence: null, status: 'dismissed' });
    expect((await ev(recent)).evidence).toMatchObject({ body: 'decidida há pouco' });
    expect(await ev(open)).toMatchObject({ evidence: { body: 'ainda por decidir' }, status: 'open' });
    // O histórico continua a mostrar a denúncia, agora sem cópia (o texto atual da mensagem).
    const decided = (await api().get('/api/v1/admin/reports/decided?status=dismissed').set(sauth()).expect(200)).body.items as Queued[];
    expect(decided.find((x) => x.id === old)).toMatchObject({ reported: null, current: null, preview: 'decidida há muito' });
    // Correr outra vez não muda nada.
    expect(await app.get(ModerationService).purgeEvidence()).toBe(0);
  });

  it('6. partilha em direto terminada (Parar ou fim do tempo): a última posição deixa de ser servida; as localizações fixas mantêm o ponto', async () => {
    const { pva: a, pvb: b } = u;
    const live = await send(a, b, '', { kind: 'location', lat: -25.9, lng: 32.5, liveMinutes: 15 });
    expect((await thread(b, a)).find((m) => m.id === live)).toMatchObject({ live: true, lat: -25.9, lng: 32.5 });
    await api().put(`/api/v1/chat/messages/${live}/location`).set(auth(a)).send({ lat: -25.91, lng: 32.51 }).expect((r) => expect(r.status).toBeLessThan(300));

    // "Parar": acaba agora e a posição apaga-se ao gravar.
    await api().delete(`/api/v1/chat/messages/${live}/live`).set(auth(a)).expect((r) => expect(r.status).toBeLessThan(300));
    expect(await row(live)).toMatchObject({ lat: null, lng: null, place_name: null, place_address: null });
    for (const x of [a, b]) {
      const m = (await thread(x, x === a ? b : a)).find((i) => i.id === live)!;
      expect(m).toMatchObject({ kind: 'location', live: false, lat: null, lng: null, placeName: null, placeAddress: null });
      expect(m.liveUntil).toBeTruthy();
    }
    // Já não se volta a pôr posição numa partilha parada.
    await api().put(`/api/v1/chat/messages/${live}/location`).set(auth(a)).send({ lat: -25.92, lng: 32.52 }).expect(404);

    // Fim do tempo (sem "Parar"): a posição fica guardada, mas não é servida a ninguém.
    const timed = await send(a, b, '', { kind: 'location', lat: -25.8, lng: 32.4, liveMinutes: 15 });
    await pool.query("UPDATE social.messages SET live_until = now() - interval '1 minute' WHERE id = $1", [timed]);
    expect((await thread(b, a)).find((m) => m.id === timed)).toMatchObject({ live: false, lat: null, lng: null });
    expect((await thread(a, b)).find((m) => m.id === timed)).toMatchObject({ live: false, lat: null, lng: null });

    // Localização fixa (um sítio): o ponto, o nome e a morada continuam, mesmo muito depois.
    const fixed = await send(a, b, '', { kind: 'location', lat: -25.7, lng: 32.3, name: 'Praia', address: 'Costa do Sol' });
    await pool.query("UPDATE social.messages SET created_at = now() - interval '2 days' WHERE id = $1", [fixed]);
    // "Parar" numa localização fixa não lhe mexe.
    await api().delete(`/api/v1/chat/messages/${fixed}/live`).set(auth(a)).expect((r) => expect(r.status).toBeLessThan(300));
    expect(await row(fixed)).toMatchObject({ lat: -25.7, lng: 32.3, place_name: 'Praia', live_until: null });
    expect((await thread(b, a)).find((m) => m.id === fixed)).toMatchObject({ lat: -25.7, lng: 32.3, placeName: 'Praia', placeAddress: 'Costa do Sol', liveUntil: null });
  });
});
