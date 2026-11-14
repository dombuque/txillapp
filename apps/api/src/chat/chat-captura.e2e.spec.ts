import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { SignJWT } from 'jose';
import { Pool } from 'pg';
import request from 'supertest';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { PushService, type PushPayload } from '../push/push.service';
import { RATE_STORE, type RateStore } from '../security/rate-store';
import { RedisRateStore } from '../security/redis-rate-store';
import { ChatEvents, type StreamEvent } from './chat.events';
import { SCREENSHOT_PER_HOUR, screenshotKeys } from './screenshot';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const REDIS_URL = process.env.TEST_REDIS_URL;
const SECRET = 'k'.repeat(40);
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const WEEK = 604_800;

interface U { token: string; id: string; username: string; first: string }
interface Item { id: string; body: string; kind: string; fromMe: boolean; expiresAt: string | null; system?: Record<string, unknown> | null; replyTo: unknown }
interface Row { username: string; unread: number; lastMessage: { body: string; kind: string; fromMe: boolean } }
interface GRow { id: string; lastMessage: { body: string; kind: string; senderName: string | null } }

/**
 * Avisos de captura de ecrã: POST /chat/with/:username/screenshot e POST /chat/groups/:id/screenshot (aviso de sistema
 * { type: 'screenshot', name } na conversa, tempo real e push) e POST /instants/:id/screenshot (só um push ao dono do Zás).
 * Com TEST_REDIS_URL, os tempos do anti-spam ficam no Redis (RedisRateStore), como nas 3 réplicas.
 */
describe('avisos de captura de ecrã: conversas, TxillGroups e Zás (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  let rates: RateStore;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  const u: Record<string, U> = {};
  const seen: { to: string; e: StreamEvent }[] = [];
  const sent: { userId: string; p: PushPayload }[] = [];

  /** Conta feita direto na base, com o token assinado aqui (o registo tem limite de pedidos por minuto). */
  async function quick(name: string, first: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const id = (
      await pool.query(`INSERT INTO identity.users (id, email, username, display_name) VALUES (gen_random_uuid(), $1, $2, $3) RETURNING id`, [`${username}@example.com`, username, `${first} Teste`])
    ).rows[0].id as string;
    const token = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(id).setIssuer('txillapp').setAudience('access').setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    return { token, id, username, first };
  }
  const mutual = async (a: U, b: U) => {
    await pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2), ($2, $1) ON CONFLICT DO NOTHING', [a.id, b.id]);
  };
  const send = async (from: U, to: U, body: string, extra: Record<string, unknown> = {}) =>
    (await api().post(`/api/v1/chat/with/${to.username}`).set(auth(from)).send({ body, ...extra }).expect(201)).body.id as string;
  /** Uma conversa já a decorrer (os dois escreveram). */
  const talk = async (a: U, b: U) => {
    await send(a, b, 'olá');
    await send(b, a, 'olá!');
  };
  const shot = (from: U, to: U | string) => api().post(`/api/v1/chat/with/${typeof to === 'string' ? to : to.username}/screenshot`).set(auth(from));
  const gshot = (from: U, groupId: string) => api().post(`/api/v1/chat/groups/${groupId}/screenshot`).set(auth(from));
  const zshot = (from: U, id: string) => api().post(`/api/v1/instants/${id}/screenshot`).set(auth(from));
  const items = async (x: U, other: U) => (await api().get(`/api/v1/chat/with/${other.username}?read=0`).set(auth(x)).expect(200)).body.items as Item[];
  const gitems = async (x: U, id: string) => (await api().get(`/api/v1/chat/groups/${id}?read=0`).set(auth(x)).expect(200)).body.items as Item[];
  const convo = async (x: U, other: U) => ((await api().get('/api/v1/chat/conversations').set(auth(x)).expect(200)).body as Row[]).find((c) => c.username === other.username);
  const convId = async (a: U, b: U) =>
    (await pool.query('SELECT id FROM social.conversations WHERE user_a = LEAST($1::uuid, $2::uuid) AND user_b = GREATEST($1::uuid, $2::uuid)', [a.id, b.id])).rows[0]?.id as string;
  const notices = async (where: { conv?: string; group?: string }) =>
    (
      await pool.query(
        `SELECT count(*)::int AS n FROM social.messages WHERE kind = 'system' AND system->>'type' = 'screenshot' AND (conversation_id = $1 OR group_id = $2)`,
        [where.conv ?? null, where.group ?? null],
      )
    ).rows[0].n as number;
  const pushesTo = (x: U) => sent.filter((s) => s.userId === x.id);
  const near = (iso: string | null, seconds: number) => {
    expect(iso).not.toBeNull();
    expect(Math.abs(new Date(iso!).getTime() - (Date.now() + seconds * 1000))).toBeLessThan(120_000);
  };
  async function photo(a: U) {
    const up = await api().post('/api/v1/media/uploads').set(auth(a)).send({ mime: 'image/png', size: PNG.length, purpose: 'chat' }).expect(201);
    await api().put(up.body.uploadUrl).set('Content-Type', 'image/png').send(PNG).expect(200);
    await api().post(`/api/v1/media/${up.body.assetId}/complete`).set(auth(a)).send({}).expect(200);
    return up.body.assetId as string;
  }

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: SECRET, NODE_ENV: 'test', MEDIA_DIR: './uploads-test', ...(REDIS_URL ? { REDIS_URL } : {}) }));
    await app.init();
    rates = app.get(RATE_STORE);
    const names: [string, string][] = [['ca', 'Ana'], ['cb', 'Bia'], ['cc', 'Caio'], ['cd', 'Dino'], ['ce', 'Eva'], ['cf', 'Fábio'], ['ch', 'Hugo'], ['ci', 'Inês'], ['cj', 'Jó'], ['ck', 'Kiko']];
    for (const [n, first] of names) u[n] = await quick(n, first);
    // Seguem-se todos, menos 'cd' (desconhecido: pedidos de mensagem) e 'cf' (só segue e é seguido por 'cj').
    const inner = Object.entries(u).filter(([k]) => k !== 'cd' && k !== 'cf').map(([, x]) => x);
    for (let i = 0; i < inner.length; i++) for (let j = i + 1; j < inner.length; j++) await mutual(inner[i], inner[j]);
    await mutual(u.cf, u.cj);
    // Guarda os eventos em tempo real e os pushes (sem os enviar).
    const ev = app.get(ChatEvents);
    const emit = ev.emit.bind(ev);
    ev.emit = (to: string, e: StreamEvent) => { seen.push({ to, e }); emit(to, e); };
    jest.spyOn(app.get(PushService), 'send').mockImplementation(async (userId: string, p: PushPayload) => {
      sent.push({ userId, p });
      return 1;
    });
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('a dois: o aviso aparece aos dois com os textos certos, chega em tempo real e o outro recebe um push; não se cita', async () => {
    const { ca, cb } = u;
    await talk(ca, cb);
    seen.length = 0;
    sent.length = 0;
    expect((await shot(ca, cb).expect(200)).body).toEqual({ ok: true });

    const mine = (await items(ca, cb))[0];
    expect(mine).toMatchObject({ kind: 'system', fromMe: true, body: 'Fizeste uma captura de ecrã.', system: { type: 'screenshot', name: 'Ana' }, expiresAt: null, replyTo: null });
    const theirs = (await items(cb, ca))[0];
    expect(theirs).toMatchObject({ id: mine.id, kind: 'system', fromMe: false, body: 'Ana fez uma captura de ecrã.', system: { type: 'screenshot', name: 'Ana' } });

    // Tempo real: o outro lado e os meus outros aparelhos.
    expect(seen).toEqual(expect.arrayContaining([
      { to: cb.id, e: { type: 'message', from: ca.username } },
      { to: ca.id, e: { type: 'message', from: cb.username, self: true } },
    ]));
    // Push só ao outro, com as regras das mensagens.
    expect(pushesTo(ca)).toHaveLength(0);
    expect(pushesTo(cb)).toEqual([{ userId: cb.id, p: expect.objectContaining({ title: 'Ana Teste', body: 'fez uma captura de ecrã da conversa', url: `/messages/${ca.username}`, category: 'messages' }) }]);
    // Quem fez já o leu; para o outro não conta como mensagem por ler.
    const read = (await pool.query('SELECT user_a, read_a, read_b FROM social.conversations WHERE id = $1', [await convId(ca, cb)])).rows[0];
    expect(read.user_a === ca.id ? read.read_a : read.read_b).toBe(mine.id);

    // Não se responde a um aviso: a citação fica de fora; nem se reage.
    const reply = await send(cb, ca, 'a responder ao aviso', { replyTo: mine.id });
    expect((await items(ca, cb)).find((i) => i.id === reply)!.replyTo).toBeNull();
    await api().put(`/api/v1/chat/messages/${mine.id}/reaction`).set(auth(cb)).send({ reaction: ':fire:' }).expect(404);
  });

  it('a lista de conversas mostra o aviso como última mensagem (com o texto de cada lado)', async () => {
    const { ca, ce } = u;
    await talk(ca, ce);
    await shot(ce, ca).expect(200);
    expect((await convo(ca, ce))!.lastMessage).toMatchObject({ kind: 'system', body: 'Eva fez uma captura de ecrã.', fromMe: false });
    expect((await convo(ce, ca))!.lastMessage).toMatchObject({ kind: 'system', body: 'Fizeste uma captura de ecrã.', fromMe: true });
    // A exportação de quem fez continua a funcionar e leva o aviso com o texto neutro.
    const ex = (await api().get('/api/v1/me/export').set(auth(ce)).expect(200)).body as { messagesSent: { kind: string; body: string }[] };
    expect(ex.messagesSent).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'system', body: 'Eva fez uma captura de ecrã.' })]));
  });

  it('anti-spam: um aviso por pessoa e por conversa a cada 30 s (no store partilhado) e um teto por hora', async () => {
    const { cb, ce, cj, cf } = u;
    await talk(cb, ce);
    const conv = await convId(cb, ce);
    sent.length = 0;
    for (let i = 0; i < 4; i++) expect((await shot(cb, ce).expect(200)).body).toEqual({ ok: true });
    expect(await notices({ conv })).toBe(1);
    expect(pushesTo(ce)).toHaveLength(1);
    // O tempo fica no store dos limites (Redis com REDIS_URL, igual nas réplicas).
    const keys = screenshotKeys(cb.id, `c:${conv}`);
    expect(await rates.peek(keys.spot)).toBe(4);
    if (REDIS_URL) expect(rates).toBeInstanceOf(RedisRateStore);
    // O outro lado tem o seu próprio tempo.
    await shot(ce, cb).expect(200);
    expect(await notices({ conv })).toBe(2);
    // Passados os 30 s (a janela acaba), volta a avisar.
    await rates.clearCounters(keys.spot);
    await shot(cb, ce).expect(200);
    expect(await notices({ conv })).toBe(3);

    // Teto por hora: com 30 avisos na última hora, os seguintes respondem { ok } e não fazem nada.
    await talk(cf, cj);
    const conv2 = await convId(cf, cj);
    const hour = screenshotKeys(cf.id, 'x').hour;
    for (let i = 0; i < SCREENSHOT_PER_HOUR; i++) await rates.hit(hour, 3_600_000);
    expect((await shot(cf, cj).expect(200)).body).toEqual({ ok: true });
    expect(await notices({ conv: conv2 })).toBe(0);
    await rates.clearCounters(hour, screenshotKeys(cf.id, `c:${conv2}`).spot);
    await shot(cf, cj).expect(200);
    expect(await notices({ conv: conv2 })).toBe(1);
  });

  it('permissões: bloqueio 403; conversa ou pessoa inexistente 404; pedido por aceitar ou conversa recusada não grava nada', async () => {
    const { ca, cc, cd, ch, ci, ck } = u;
    // Bloqueio (para os dois lados).
    await talk(ca, cc);
    await api().put(`/api/v1/blocks/${ca.username}`).set(auth(cc)).expect(200);
    await shot(ca, cc).expect(403);
    await shot(cc, ca).expect(403);
    expect(await notices({ conv: await convId(ca, cc) })).toBe(0);

    // Sem conversa, ou a pessoa não existe, ou comigo próprio.
    await shot(ci, ck).expect(404);
    await shot(ci, `naoexiste${run}`).expect(404);
    await shot(ci, ci).expect(400);

    // Pedido de mensagem por aceitar: 'cd' escreveu a 'ca', que não o segue e ainda não respondeu nem aceitou.
    await send(cd, ca, 'olá, posso?');
    sent.length = 0;
    const req = await convId(ca, cd);
    expect((await shot(ca, cd).expect(200)).body).toEqual({ ok: true });
    expect((await shot(cd, ca).expect(200)).body).toEqual({ ok: true });
    expect(await notices({ conv: req })).toBe(0);
    expect(sent).toHaveLength(0);
    // Aceite, já avisa.
    await api().post(`/api/v1/chat/with/${cd.username}/accept`).set(auth(ca)).expect(204);
    await shot(ca, cd).expect(200);
    expect(await notices({ conv: req })).toBe(1);

    // A outra pessoa recusou a conversa (saiu): não grava nada.
    await talk(ch, ci);
    await api().post(`/api/v1/chat/with/${ch.username}/decline`).set(auth(ci)).expect(204);
    expect((await shot(ch, ci).expect(200)).body).toEqual({ ok: true });
    expect(await notices({ conv: await convId(ch, ci) })).toBe(0);
  });

  let groupId = '';

  it('TxillGroups: só os membros; o aviso aparece a todos, o push vai aos outros membros; repetido não grava', async () => {
    const { ca, cb, ce, cf } = u;
    groupId = (await api().post('/api/v1/chat/groups').set(auth(ca)).send({ name: 'Malta do Tofo', members: [cb.username, ce.username] }).expect(201)).body.id as string;
    await gshot(cf, groupId).expect(404);
    await gshot(cf, '00000000-0000-0000-0000-000000000000').expect(404);
    expect(await notices({ group: groupId })).toBe(0);

    seen.length = 0;
    sent.length = 0;
    expect((await gshot(cb, groupId).expect(200)).body).toEqual({ ok: true });
    expect((await gitems(cb, groupId))[0]).toMatchObject({ kind: 'system', fromMe: true, body: 'Fizeste uma captura de ecrã.', system: { type: 'screenshot', name: 'Bia' } });
    expect((await gitems(ca, groupId))[0]).toMatchObject({ kind: 'system', fromMe: false, body: 'Bia fez uma captura de ecrã.' });
    expect(seen).toEqual(expect.arrayContaining([
      { to: ca.id, e: { type: 'message', group: groupId } },
      { to: ce.id, e: { type: 'message', group: groupId } },
      { to: cb.id, e: { type: 'message', group: groupId, self: true } },
    ]));
    expect(pushesTo(cb)).toHaveLength(0);
    for (const x of [ca, ce]) {
      expect(pushesTo(x)).toEqual([{ userId: x.id, p: expect.objectContaining({ title: 'Malta do Tofo', body: 'Bia fez uma captura de ecrã da conversa', url: `/messages/g/${groupId}`, category: 'messages' }) }]);
    }
    // Na lista dos grupos, o aviso é a última mensagem.
    const row = ((await api().get('/api/v1/chat/groups').set(auth(ca)).expect(200)).body as GRow[]).find((g) => g.id === groupId)!;
    expect(row.lastMessage).toMatchObject({ kind: 'system', body: 'Bia fez uma captura de ecrã.', senderName: null });

    await gshot(cb, groupId).expect(200);
    expect(await notices({ group: groupId })).toBe(1);
    // Quem sai do grupo deixa de poder.
    await api().delete(`/api/v1/chat/groups/${groupId}/members/${ce.username}`).set(auth(ce)).expect(204);
    await gshot(ce, groupId).expect(404);
  });

  it('Zás: o push vai só ao dono; o próprio é ignorado; quem não o pode ver dá 404; nada fica no chat', async () => {
    const { ca, cb, cf } = u;
    const mediaId = await photo(ca);
    const zas = (await api().post('/api/v1/instants').set(auth(ca)).send({ mediaId }).expect(201)).body as { id: string };
    const before = await pool.query('SELECT count(*)::int AS n FROM social.messages WHERE conversation_id = $1', [await convId(ca, cb)]);
    sent.length = 0;

    await zshot(ca, zas.id).expect(204); // o próprio: em silêncio
    expect(sent).toHaveLength(0);
    await zshot(cf, zas.id).expect(404); // não o pode ver
    await zshot(cb, '00000000-0000-0000-0000-000000000000').expect(404);

    await zshot(cb, zas.id).expect(204);
    expect(sent).toEqual([{ userId: ca.id, p: expect.objectContaining({ title: 'Bia Teste', body: 'fez uma captura do teu Zás', url: '/messages', category: 'messages' }) }]);
    await zshot(cb, zas.id).expect(204); // repetido: sem outro push
    expect(sent).toHaveLength(1);

    const after = await pool.query('SELECT count(*)::int AS n FROM social.messages WHERE conversation_id = $1', [await convId(ca, cb)]);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it('mensagens temporárias: o aviso segue o expires_at da conversa (e do grupo) e desaparece com elas', async () => {
    const { ca, cb, cj } = u;
    await talk(ca, cj);
    await api().put(`/api/v1/chat/with/${cj.username}/ttl`).set(auth(ca)).send({ ttl: WEEK }).expect(200);
    await shot(cj, ca).expect(200);
    const notice = (await items(ca, cj))[0];
    expect(notice).toMatchObject({ kind: 'system', body: 'Jó fez uma captura de ecrã.' });
    near(notice.expiresAt, WEEK);
    // Expirado, sai da conversa e da lista (a última volta a ser o aviso das temporárias, que não expira).
    await pool.query("UPDATE social.messages SET expires_at = now() - interval '1 second' WHERE id = $1", [notice.id]);
    expect((await items(ca, cj)).find((i) => i.id === notice.id)).toBeUndefined();
    expect((await convo(ca, cj))!.lastMessage).toMatchObject({ kind: 'system', body: 'Ligaste as mensagens temporárias: 7 dias.' });

    // No grupo: a mesma regra.
    await api().put(`/api/v1/chat/groups/${groupId}/ttl`).set(auth(ca)).send({ ttl: WEEK }).expect(200);
    await rates.clearCounters(screenshotKeys(cb.id, `g:${groupId}`).spot);
    await gshot(cb, groupId).expect(200);
    const g = (await gitems(ca, groupId))[0];
    expect(g).toMatchObject({ kind: 'system', body: 'Bia fez uma captura de ecrã.' });
    near(g.expiresAt, WEEK);
  });
});
