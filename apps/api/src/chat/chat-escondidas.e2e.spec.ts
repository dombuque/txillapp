import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { SignJWT } from 'jose';
import { Pool } from 'pg';
import request from 'supertest';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { PushService, type PushPayload } from '../push/push.service';
import { ExportService } from '../account/export.service';
import { ChatEvents, type StreamEvent } from './chat.events';
import { HIDDEN_PUSH_BODY, HIDDEN_PUSH_CHANNEL, HIDDEN_PUSH_TAG, HIDDEN_PUSH_TITLE, discreetPush } from './hidden-push';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const REDIS_URL = process.env.TEST_REDIS_URL;
const SECRET = 'h'.repeat(40);

interface U { token: string; id: string; username: string; first: string }
interface Row { username: string; unread: number; request?: boolean; hidden?: boolean; hiddenAt?: string; lastMessage: { body: string } }
interface GRow { id: string; unread: number; hidden?: boolean; hiddenAt?: string }

/**
 * Esconder conversas (0160): PUT /chat/with/:username/hidden e PUT /chat/groups/:id/hidden { hidden }, GET /chat/hidden.
 * Escondida, sai da lista e do número de por ler; mensagens novas não a trazem de volta; o push vai sem pré-visualização
 * só para quem a escondeu; o outro lado não sabe; os meus outros aparelhos põem-se em dia (eco 'read'); a exportação diz
 * que conversas estão escondidas; ao apagar a conta, sai com o resto.
 */
describe('conversas escondidas: conversas a dois e TxillGroups (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  const u: Record<string, U> = {};
  const seen: { to: string; e: StreamEvent }[] = [];
  const sent: { userId: string; p: PushPayload }[] = [];

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
  const send = async (from: U, to: U, body: string) => (await api().post(`/api/v1/chat/with/${to.username}`).set(auth(from)).send({ body }).expect(201)).body.id as string;
  const gsend = async (from: U, id: string, body: string) => (await api().post(`/api/v1/chat/groups/${id}/messages`).set(auth(from)).send({ body }).expect(201)).body.id as string;
  const hide = (x: U, other: U | string, hidden = true) => api().put(`/api/v1/chat/with/${typeof other === 'string' ? other : other.username}/hidden`).set(auth(x)).send({ hidden });
  const ghide = (x: U, id: string, hidden = true) => api().put(`/api/v1/chat/groups/${id}/hidden`).set(auth(x)).send({ hidden });
  const list = async (x: U) => (await api().get('/api/v1/chat/conversations').set(auth(x)).expect(200)).body as Row[];
  const glist = async (x: U) => (await api().get('/api/v1/chat/groups').set(auth(x)).expect(200)).body as GRow[];
  const hiddenOf = async (x: U) => (await api().get('/api/v1/chat/hidden').set(auth(x)).expect(200)).body as { conversations: Row[]; groups: GRow[] };
  const unread = async (x: U) => (await api().get('/api/v1/chat/unread').set(auth(x)).expect(200)).body as { conversations: number; requests: number };
  const pushesTo = (x: U) => sent.filter((s) => s.userId === x.id).map((s) => s.p);
  const eventsTo = (x: U) => seen.filter((s) => s.to === x.id).map((s) => s.e);
  /** O push sai sem esperar (void): dá-lhe um instante. */
  const tick = () => new Promise((r) => setTimeout(r, 60));

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: SECRET, NODE_ENV: 'test', MEDIA_DIR: './uploads-test', ...(REDIS_URL ? { REDIS_URL } : {}) }));
    await app.init();
    for (const [n, first] of [['ha', 'Ana'], ['hb', 'Bia'], ['hc', 'Caio'], ['hd', 'Dino'], ['hx', 'Xico']] as const) u[n] = await quick(n, first);
    const inner = [u.ha, u.hb, u.hc, u.hd];
    for (let i = 0; i < inner.length; i++) for (let j = i + 1; j < inner.length; j++) await mutual(inner[i], inner[j]);
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

  it('o aviso discreto: sem quem, sem o quê, sem som de destaque; o endereço fica', () => {
    const p = discreetPush({ title: 'Ana Teste', body: 'enviou-te uma foto', url: '/messages/ana', tag: 'chat:1', category: 'messages', data: { a: 'b' } });
    expect(p).toEqual({ title: HIDDEN_PUSH_TITLE, body: HIDDEN_PUSH_BODY, url: '/messages/ana', tag: HIDDEN_PUSH_TAG, category: 'messages', channel: HIDDEN_PUSH_CHANNEL, ios: { interruptionLevel: 'passive' }, data: { a: 'b', quiet: '1' } });
    expect([HIDDEN_PUSH_TITLE, HIDDEN_PUSH_BODY]).toEqual(['Txillapp', 'Nova mensagem']);
  });

  it('a dois: esconder tira da lista e do contador; fica em «Conversas escondidas»; o outro não sabe; os meus aparelhos sabem', async () => {
    const { ha, hb } = u;
    await send(ha, hb, 'olá');
    await send(hb, ha, 'olá!');
    await send(hb, ha, 'tudo bem?');
    expect((await list(ha)).find((c) => c.username === hb.username)?.unread).toBe(2);
    expect((await unread(ha)).conversations).toBe(1);

    seen.length = 0;
    expect((await hide(ha, hb).expect(200)).body).toEqual({ hidden: true });
    expect((await list(ha)).map((c) => c.username)).not.toContain(hb.username);
    expect((await unread(ha)).conversations).toBe(0);
    const h = await hiddenOf(ha);
    expect(h.conversations).toEqual([expect.objectContaining({ username: hb.username, unread: 2, hidden: true, lastMessage: expect.objectContaining({ body: 'tudo bem?' }) })]);
    expect(new Date(h.conversations[0].hiddenAt!).getTime()).toBeGreaterThan(Date.now() - 60_000);
    // O outro lado continua igual e não recebe nada.
    expect((await list(hb)).map((c) => c.username)).toContain(ha.username);
    expect(eventsTo(hb)).toEqual([]);
    expect(eventsTo(ha)).toEqual([{ type: 'read', from: hb.username, self: true }]);
    // A conversa aberta diz que está escondida (só a mim).
    expect((await api().get(`/api/v1/chat/with/${hb.username}?read=0`).set(auth(ha)).expect(200)).body.hidden).toBe(true);
    expect((await api().get(`/api/v1/chat/with/${ha.username}?read=0`).set(auth(hb)).expect(200)).body.hidden).toBe(false);

    // Repetir não muda a hora.
    const at = h.conversations[0].hiddenAt;
    await hide(ha, hb).expect(200);
    expect((await hiddenOf(ha)).conversations[0].hiddenAt).toBe(at);
  });

  it('a dois: mensagem nova não a traz de volta e o push vai sem pré-visualização (só para quem escondeu)', async () => {
    const { ha, hb } = u;
    sent.length = 0;
    await send(hb, ha, 'estás aí?');
    await tick();
    expect((await list(ha)).map((c) => c.username)).not.toContain(hb.username);
    expect((await unread(ha)).conversations).toBe(0);
    expect((await hiddenOf(ha)).conversations[0]).toMatchObject({ username: hb.username, unread: 3, lastMessage: { body: 'estás aí?' } });
    expect(pushesTo(ha)).toEqual([expect.objectContaining({ title: 'Txillapp', body: 'Nova mensagem', url: `/messages/${hb.username}`, tag: HIDDEN_PUSH_TAG, channel: 'discreto', ios: { interruptionLevel: 'passive' }, data: { quiet: '1' }, category: 'messages' })]);
    expect(JSON.stringify(pushesTo(ha))).not.toMatch(/Bia|estás/);

    // Responder de dentro da escondida também não a traz de volta; quem não escondeu recebe o aviso normal.
    sent.length = 0;
    await send(ha, hb, 'sim');
    await tick();
    expect((await list(ha)).map((c) => c.username)).not.toContain(hb.username);
    expect(pushesTo(hb)).toEqual([expect.objectContaining({ title: 'Ana Teste', body: 'enviou-te uma mensagem', tag: `chat:${ha.id}` })]);

    // A captura de ecrã segue as mesmas regras.
    sent.length = 0;
    await api().post(`/api/v1/chat/with/${ha.username}/screenshot`).set(auth(hb)).expect(200);
    await tick();
    expect(pushesTo(ha)).toEqual([expect.objectContaining({ title: 'Txillapp', body: 'Nova mensagem', channel: 'discreto' })]);
  });

  it('a dois: «Mostrar outra vez» volta à lista (com os por ler) e os avisos voltam a ser normais', async () => {
    const { ha, hb } = u;
    seen.length = 0;
    expect((await hide(ha, hb, false).expect(200)).body).toEqual({ hidden: false });
    expect(eventsTo(ha)).toEqual([{ type: 'read', from: hb.username, self: true }]);
    expect((await hiddenOf(ha)).conversations).toEqual([]);
    const row = (await list(ha)).find((c) => c.username === hb.username);
    expect(row).toBeDefined();
    expect(row!.hidden).toBeUndefined();
    sent.length = 0;
    await send(hb, ha, 'voltei');
    await tick();
    expect(pushesTo(ha)).toEqual([expect.objectContaining({ title: 'Bia Teste', body: 'enviou-te uma mensagem', tag: `chat:${hb.id}` })]);
  });

  it('a dois: sem conversa ou pessoa que não existe dá 404; o corpo tem de ser { hidden: boolean }', async () => {
    const { ha, hc, hd } = u;
    await hide(hc, hd).expect(404);
    await hide(ha, `ninguem${run}`).expect(404);
    await api().put(`/api/v1/chat/with/${u.hb.username}/hidden`).set(auth(ha)).send({ hidden: 'sim' }).expect(400);
    await api().put(`/api/v1/chat/with/${u.hb.username}/hidden`).send({ hidden: true }).expect(401);
  });

  it('pedido de mensagem escondido: sai também dos pedidos', async () => {
    const { hx, hc } = u;
    await send(hx, hc, 'olá, desconhecido aqui');
    expect((await unread(hc)).requests).toBe(1);
    await hide(hc, hx).expect(200);
    expect((await unread(hc)).requests).toBe(0);
    expect((await list(hc)).map((c) => c.username)).not.toContain(hx.username);
    expect((await hiddenOf(hc)).conversations).toEqual([expect.objectContaining({ username: hx.username, request: true })]);
  });

  let groupId = '';

  it('TxillGroups: esconder tira da lista e do contador; mensagens novas não o trazem; push discreto só para quem escondeu', async () => {
    const { ha, hb, hc } = u;
    groupId = (await api().post('/api/v1/chat/groups').set(auth(ha)).send({ name: 'Malta do Tofo', members: [hb.username, hc.username] }).expect(201)).body.id as string;
    await gsend(ha, groupId, 'bora praia?');
    expect((await glist(hb)).find((g) => g.id === groupId)?.unread).toBe(1);
    const before = (await unread(hb)).conversations;

    seen.length = 0;
    expect((await ghide(hb, groupId).expect(200)).body).toEqual({ hidden: true });
    expect(eventsTo(hb)).toEqual([{ type: 'read', group: groupId, self: true }]);
    expect(eventsTo(ha)).toEqual([]);
    expect(eventsTo(hc)).toEqual([]);
    expect((await glist(hb)).map((g) => g.id)).not.toContain(groupId);
    expect((await unread(hb)).conversations).toBe(before - 1);
    expect((await hiddenOf(hb)).groups).toEqual([expect.objectContaining({ id: groupId, unread: 1, hidden: true })]);
    expect((await api().get(`/api/v1/chat/groups/${groupId}?read=0`).set(auth(hb)).expect(200)).body.group.hidden).toBe(true);
    expect((await api().get(`/api/v1/chat/groups/${groupId}?read=0`).set(auth(ha)).expect(200)).body.group.hidden).toBe(false);
    // Os outros continuam a vê-lo.
    expect((await glist(ha)).map((g) => g.id)).toContain(groupId);

    sent.length = 0;
    await gsend(ha, groupId, 'às 10h');
    await tick();
    expect((await glist(hb)).map((g) => g.id)).not.toContain(groupId);
    expect((await hiddenOf(hb)).groups[0]).toMatchObject({ id: groupId, unread: 2 });
    expect(pushesTo(hb)).toEqual([expect.objectContaining({ title: 'Txillapp', body: 'Nova mensagem', url: `/messages/g/${groupId}`, channel: 'discreto', data: { quiet: '1' } })]);
    expect(JSON.stringify(pushesTo(hb))).not.toMatch(/Tofo|Ana|10h/);
    expect(pushesTo(hc)).toEqual([expect.objectContaining({ title: 'Malta do Tofo', body: 'Ana: enviou uma mensagem' })]);

    // Captura de ecrã no grupo: o mesmo.
    sent.length = 0;
    await api().post(`/api/v1/chat/groups/${groupId}/screenshot`).set(auth(hc)).expect(200);
    await tick();
    expect(pushesTo(hb)).toEqual([expect.objectContaining({ title: 'Txillapp', body: 'Nova mensagem' })]);
    expect(pushesTo(ha)).toEqual([expect.objectContaining({ title: 'Malta do Tofo' })]);

    // Quem não é membro: 404.
    await ghide(u.hd, groupId).expect(404);
    await ghide(hb, 'nao-e-um-id').expect(400);

    // Mostrar outra vez.
    expect((await ghide(hb, groupId, false).expect(200)).body).toEqual({ hidden: false });
    expect((await glist(hb)).map((g) => g.id)).toContain(groupId);
    expect((await hiddenOf(hb)).groups).toEqual([]);
  });

  it('sair do grupo e voltar: já não está escondido', async () => {
    const { ha, hb } = u;
    await ghide(hb, groupId).expect(200);
    await api().delete(`/api/v1/chat/groups/${groupId}/members/${hb.username}`).set(auth(hb)).expect(204);
    await api().post(`/api/v1/chat/groups/${groupId}/members`).set(auth(ha)).send({ members: [hb.username] }).expect(204);
    expect((await glist(hb)).map((g) => g.id)).toContain(groupId);
    expect((await hiddenOf(hb)).groups).toEqual([]);
  });

  it('exportação de dados: que conversas e TxillGroups escondi, e desde quando', async () => {
    const { ha, hb, hc } = u;
    await hide(ha, hb).expect(200);
    await ghide(ha, groupId).expect(200);
    // O serviço da exportação (o mesmo de GET /me/export, que tem limite por hora e por endereço, partilhado no Redis).
    const exp = async (x: U) => JSON.parse(JSON.stringify(await app.get(ExportService).build(x.id))) as Record<string, unknown>;
    const ex = await exp(ha);
    expect(ex.hiddenConversations).toEqual([{ with: hb.username, hiddenAt: expect.any(String) }]);
    expect(ex.hiddenGroups).toEqual([{ id: groupId, name: 'Malta do Tofo', hiddenAt: expect.any(String) }]);
    // A outra pessoa não vê isto na dela.
    const theirs = await exp(hb);
    expect(theirs.hiddenConversations).toEqual([]);
    const c = await exp(hc);
    expect(c.hiddenConversations).toEqual([{ with: u.hx.username, hiddenAt: expect.any(String) }]);
  });

  it('convite do Mixar (cartão na conversa) a quem escondeu a conversa: o aviso vai sem pré-visualização', async () => {
    const { hc, hd } = u;
    await send(hd, hc, 'bora mixar?');
    await hide(hc, hd).expect(200);
    sent.length = 0;
    await api().post('/api/v1/mixar/invite').set(auth(hd)).send({ username: hc.username }).expect(201);
    await tick();
    expect(pushesTo(hc)).toEqual([expect.objectContaining({ title: 'Txillapp', body: 'Nova mensagem', channel: 'discreto' })]);
    expect(JSON.stringify(pushesTo(hc))).not.toMatch(/Mixar|Dino/);
  });

  it('apagar a conta: o que escondi sai com o resto (conversas e lugar nos grupos)', async () => {
    const { ha, hb } = u;
    await api().post('/api/v1/auth/delete-account').set(auth(ha)).send({ confirmUsername: ha.username }).expect(204);
    const left = await pool.query(
      `SELECT (SELECT count(*) FROM social.conversations WHERE (user_a = $1 AND hidden_at_a IS NOT NULL) OR (user_b = $1 AND hidden_at_b IS NOT NULL))::int AS convs,
              (SELECT count(*) FROM social.group_members WHERE user_id = $1)::int AS groups`,
      [ha.id],
    );
    expect(left.rows[0]).toEqual({ convs: 0, groups: 0 });
    // Quem fica não é afetado.
    expect((await hiddenOf(hb)).conversations).toEqual([]);
  });
});
