import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { ChatExpiryService } from './chat-expiry.service';
import { ChatEvents, type StreamEvent } from './chat.events';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const DAY = 86_400;
const WEEK = 604_800;

interface U { token: string; id: string; username: string }
interface Item { id: string; body: string; kind: string; fromMe: boolean; expiresAt: string | null; system?: { type: string; ttl: number | null } | null; replyTo: unknown }
interface Row { username: string; unread: number; ttl: number | null; lastMessage: { body: string; kind: string; fromMe: boolean; empty: boolean } }
interface GRow { id: string; unread: number; ttl: number | null; lastMessage: { body: string; kind: string; senderName: string | null; empty: boolean; cleared: boolean } }

/**
 * Mensagens temporárias (PUT /chat/with/:username/ttl e PUT /chat/groups/:id/ttl) e "Limpar conversa" só para mim
 * (POST /chat/with/:username/clear e POST /chat/groups/:id/clear). Migração 0123.
 */
describe('mensagens temporárias e limpar conversa (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  const u: Record<string, U> = {};
  const seen: { to: string; e: StreamEvent }[] = [];

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  const send = async (from: U, to: U, body: string, extra: Record<string, unknown> = {}) =>
    (await api().post(`/api/v1/chat/with/${to.username}`).set(auth(from)).send({ body, ...extra }).expect(201)).body.id as string;
  const threadOf = async (x: U, other: U) => (await api().get(`/api/v1/chat/with/${other.username}`).set(auth(x)).expect(200)).body as { ttl: number | null; items: Item[] };
  const items = async (x: U, other: U) => (await threadOf(x, other)).items;
  const peek = async (x: U, other: U) => (await api().get(`/api/v1/chat/with/${other.username}?read=0`).set(auth(x)).expect(200)).body.items as Item[];
  const convo = async (x: U, other: U) => ((await api().get('/api/v1/chat/conversations').set(auth(x)).expect(200)).body as Row[]).find((c) => c.username === other.username);
  const setTtl = (x: U, other: U, ttl: number | null) => api().put(`/api/v1/chat/with/${other.username}/ttl`).set(auth(x)).send({ ttl });
  const gp = (x: U, path: string, method: 'get' | 'post' | 'put' = 'get') => api()[method](`/api/v1/chat/groups${path}`).set(auth(x));
  const expire = (ids: string[]) => pool.query("UPDATE social.messages SET expires_at = now() - interval '1 second' WHERE id = ANY($1::uuid[])", [ids]);
  async function uploadChat(a: U) {
    const r = await api().post('/api/v1/media/uploads').set(auth(a)).send({ mime: 'image/png', size: PNG.length, purpose: 'chat' }).expect(201);
    await api().put(r.body.uploadUrl).set('Content-Type', 'image/png').send(PNG).expect(200);
    return r.body.assetId as string;
  }
  const near = (iso: string | null, seconds: number) => {
    expect(iso).not.toBeNull();
    expect(Math.abs(new Date(iso!).getTime() - (Date.now() + seconds * 1000))).toBeLessThan(120_000);
  };

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'c'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    for (const n of ['ta', 'tb', 'tc', 'td', 'te', 'tz']) u[n] = await signup(n);
    // Todos se seguem, menos 'tz' (desconhecido: só para os pedidos de mensagem).
    const ids = Object.entries(u).filter(([k]) => k !== 'tz').map(([, x]) => x.id);
    for (const a of ids) for (const b of ids) if (a !== b) await pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [a, b]);
    // Guarda todos os eventos em tempo real (para ver o que chega a cada um).
    const ev = app.get(ChatEvents);
    const emit = ev.emit.bind(ev);
    ev.emit = (to: string, e: StreamEvent) => { seen.push({ to, e }); emit(to, e); };
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('a dois: qualquer um liga e desliga; fica o aviso para os dois; só as enviadas depois expiram; chega aos dois em tempo real', async () => {
    const { ta, tb } = u;
    const before = await send(ta, tb, 'antes das temporárias');
    seen.length = 0;
    expect(await setTtl(ta, tb, WEEK).expect(200).then((r) => r.body)).toEqual({ ttl: WEEK });
    // O outro lado e os meus outros aparelhos ficam a saber.
    expect(seen).toEqual(expect.arrayContaining([
      { to: tb.id, e: { type: 'message', from: ta.username } },
      { to: ta.id, e: { type: 'message', from: tb.username, self: true } },
    ]));

    const mine = await threadOf(ta, tb);
    expect(mine.ttl).toBe(WEEK);
    expect(mine.items[0]).toMatchObject({ kind: 'system', fromMe: true, body: 'Ligaste as mensagens temporárias: 7 dias.', system: { type: 'ttl', ttl: WEEK }, expiresAt: null });
    const theirs = await threadOf(tb, ta);
    expect(theirs.ttl).toBe(WEEK);
    expect(theirs.items[0]).toMatchObject({ kind: 'system', fromMe: false, body: 'ta ligou as mensagens temporárias: 7 dias.' });
    // O aviso aparece na lista mas não conta como por ler.
    expect((await convo(tb, ta))!).toMatchObject({ ttl: WEEK, unread: 0, lastMessage: { kind: 'system', body: 'ta ligou as mensagens temporárias: 7 dias.' } });
    expect((await convo(ta, tb))!.lastMessage).toMatchObject({ body: 'Ligaste as mensagens temporárias: 7 dias.', fromMe: true });

    // Pedir o mesmo não deixa outro aviso.
    await setTtl(tb, ta, WEEK).expect(200);
    expect((await items(ta, tb)).filter((m) => m.kind === 'system')).toHaveLength(1);

    // A nova expira daqui a 7 dias; a de antes fica como estava.
    const after = await send(ta, tb, 'esta vai desaparecer', { once: true });
    expect((await convo(tb, ta))!.unread).toBe(1);
    const now = await items(tb, ta);
    near(now.find((m) => m.id === after)!.expiresAt, WEEK);
    expect(now.find((m) => m.id === before)!.expiresAt).toBeNull();

    // O outro muda para 24 horas e depois desliga.
    await setTtl(tb, ta, DAY).expect(200);
    const voice = await send(ta, tb, 'Aqui', { kind: 'location', lat: -25.97, lng: 32.57 });
    near((await items(tb, ta)).find((m) => m.id === voice)!.expiresAt, DAY);
    await setTtl(tb, ta, null).expect(200);
    const off = await send(ta, tb, 'já não expira');
    const last = await items(ta, tb);
    expect(last.find((m) => m.id === off)!.expiresAt).toBeNull();
    expect(last.filter((m) => m.kind === 'system').map((m) => m.body)).toEqual(['tb desligou as mensagens temporárias.', 'tb ligou as mensagens temporárias: 24 horas.', 'Ligaste as mensagens temporárias: 7 dias.']);
    expect((await items(tb, ta)).find((m) => m.kind === 'system')!.body).toBe('Desligaste as mensagens temporárias.');
    expect((await threadOf(ta, tb)).ttl).toBeNull();

    // Valores que não existem e avisos que não se apagam nem recebem reações.
    await setTtl(ta, tb, 3600).expect(400);
    await api().put(`/api/v1/chat/with/${tb.username}/ttl`).set(auth(ta)).send({}).expect(400);
    const notice = last.find((m) => m.kind === 'system')!;
    await api().delete(`/api/v1/chat/messages/${notice.id}`).set(auth(tb)).expect(404);
    await api().put(`/api/v1/chat/messages/${notice.id}/reaction`).set(auth(ta)).send({ reaction: ':amor:' }).expect(404);
  });

  it('a dois: num pedido de mensagem (quem não segue e ainda não respondeu) ninguém liga as temporárias; com bloqueio também não', async () => {
    const { ta, tc, tz } = u;
    await api().patch('/api/v1/settings/privacy').set(auth(ta)).send({ dmsAllowed: 'everyone' }).expect(200);
    await send(tz, ta, 'olá, não me conheces');
    await setTtl(ta, tz, DAY).expect(403); // ainda é um pedido para mim
    await setTtl(tz, ta, DAY).expect(403); // não me segue e ainda não respondeu
    await api().post(`/api/v1/chat/with/${tz.username}/accept`).set(auth(ta)).expect(204);
    await setTtl(ta, tz, DAY).expect(200);
    // Os avisos não contam como "já respondeu" para os limites de quem não se segue.
    await api().put(`/api/v1/blocks/${u.td.username}`).set(auth(tc)).expect((r) => { if (r.status >= 300) throw new Error(String(r.status)); });
    await setTtl(u.td, tc, DAY).expect(403);
  });

  it('nos grupos: só quem administra muda; todos veem o aviso e o estado; as mensagens novas (e as sondagens) expiram', async () => {
    const { ta, tb, tc } = u;
    const id = (await gp(ta, '', 'post').send({ name: 'Temporárias', members: [tb.username, tc.username] }).expect(201)).body.id as string;
    const old = (await gp(tb, `/${id}/messages`, 'post').send({ body: 'antes' }).expect(201)).body.id as string;
    await gp(tb, `/${id}/ttl`, 'put').send({ ttl: WEEK }).expect(403); // só membro
    await gp(u.td, `/${id}/ttl`, 'put').send({ ttl: WEEK }).expect(404); // nem é do grupo
    seen.length = 0;
    expect((await gp(ta, `/${id}/ttl`, 'put').send({ ttl: WEEK }).expect(200)).body).toEqual({ ttl: WEEK });
    expect(seen).toEqual(expect.arrayContaining([
      { to: tb.id, e: { type: 'message', group: id } },
      { to: tc.id, e: { type: 'message', group: id } },
      { to: ta.id, e: { type: 'message', group: id, self: true } },
    ]));
    const asB = (await gp(tb, `/${id}`).expect(200)).body as { group: { ttl: number | null }; items: Item[] };
    expect(asB.group.ttl).toBe(WEEK);
    expect(asB.items[0]).toMatchObject({ kind: 'system', body: 'ta ligou as mensagens temporárias: 7 dias.' });
    expect(((await gp(ta, `/${id}`).expect(200)).body.items as Item[])[0].body).toBe('Ligaste as mensagens temporárias: 7 dias.');
    // Na lista: o aviso sem o nome à frente (já vai no texto) e não conta como por ler.
    const row = ((await gp(tc, '').expect(200)).body as GRow[]).find((g) => g.id === id)!;
    expect(row).toMatchObject({ ttl: WEEK, lastMessage: { kind: 'system', senderName: null, body: 'ta ligou as mensagens temporárias: 7 dias.' } });
    expect(row.unread).toBe(1); // só a mensagem "antes"

    const fresh = (await gp(tc, `/${id}/messages`, 'post').send({ body: 'depois' }).expect(201)).body.id as string;
    const list = (await gp(tb, `/${id}`).expect(200)).body.items as Item[];
    near(list.find((m) => m.id === fresh)!.expiresAt, WEEK);
    expect(list.find((m) => m.id === old)!.expiresAt).toBeNull();
    // Uma sondagem nova também expira.
    await api().post(`/api/v1/chat/groups/${id}/polls`).set(auth(tb)).send({ question: 'Onde?', options: ['Tofo', 'Bilene'] }).expect(201);
    expect((await pool.query("SELECT expires_at FROM social.messages WHERE group_id = $1 AND kind = 'poll' ORDER BY id DESC LIMIT 1", [id])).rows[0].expires_at).not.toBeNull();

    // Um admin novo também pode; desligar deixa o aviso.
    await api().patch(`/api/v1/chat/groups/${id}/members/${tb.username}`).set(auth(ta)).send({ role: 'admin' }).expect(200);
    await gp(tb, `/${id}/ttl`, 'put').send({ ttl: null }).expect(200);
    const off = (await gp(tc, `/${id}`).expect(200)).body as { group: { ttl: number | null }; items: Item[] };
    expect(off.group.ttl).toBeNull();
    expect(off.items[0].body).toBe('tb desligou as mensagens temporárias.');
  });

  it('expiradas: deixam logo de aparecer (conversa, lista, por ler, citações, abrir, ficheiro) e a limpeza apaga-as de vez com o ficheiro', async () => {
    const { tc, te } = u;
    const keep = await send(te, tc, 'esta fica');
    await setTtl(te, tc, DAY).expect(200);
    const text = await send(te, tc, 'vai expirar');
    const pic = await uploadChat(te);
    const img = await send(te, tc, '', { kind: 'image', mediaId: pic });
    const once = await send(te, tc, 'ver uma vez', { once: true });
    const imgUrl = ((await peek(tc, te)).find((m) => m.id === img) as unknown as { mediaUrl: string }).mediaUrl;
    await api().get(imgUrl.replace(/^.*\/api\/v1/, '/api/v1')).expect((r) => { if (r.status >= 400) throw new Error(`ficheiro: ${r.status}`); });
    await api().put(`/api/v1/chat/messages/${text}/reaction`).set(auth(tc)).send({ reaction: ':amor:' }).expect(204);
    const reply = await send(tc, te, 'respondo à que vai expirar', { replyTo: text });
    await pool.query('UPDATE social.messages SET expires_at = NULL WHERE id = $1', [reply]); // a resposta fica (para ver a citação)
    expect((await convo(tc, te))!.unread).toBe(0);
    const late = await send(te, tc, 'última, também vai');
    expect((await convo(tc, te))!.unread).toBe(1);

    await expire([text, img, once, late]);
    const now = await peek(tc, te);
    for (const id of [text, img, once, late]) expect(now.some((m) => m.id === id)).toBe(false);
    expect(now.some((m) => m.id === keep)).toBe(true);
    expect(now.find((m) => m.id === reply)!.replyTo).toMatchObject({ id: text, gone: true });
    expect((await convo(tc, te))!).toMatchObject({ unread: 0, lastMessage: { body: 'respondo à que vai expirar' } });
    // Nem para quem enviou.
    expect((await peek(te, tc)).some((m) => m.id === text)).toBe(false);
    // Já não se abre, não se reage, não se responde, nem o ficheiro se serve.
    await api().post(`/api/v1/chat/messages/${once}/open`).set(auth(tc)).expect(404);
    await api().put(`/api/v1/chat/messages/${late}/reaction`).set(auth(tc)).send({ reaction: ':amor:' }).expect(404);
    await api().get(imgUrl.replace(/^.*\/api\/v1/, '/api/v1')).expect(404);
    const r2 = await send(tc, te, 'responder a uma que já foi', { replyTo: late });
    expect((await peek(tc, te)).find((m) => m.id === r2)!.replyTo).toBeNull();
    // Nem na exportação de dados de quem as enviou.
    const exp = (await api().get('/api/v1/me/export').set(auth(te)).expect(200)).body as { messagesSent: { id: string }[] };
    expect(exp.messagesSent.some((m) => m.id === text)).toBe(false);
    expect(exp.messagesSent.some((m) => m.id === keep)).toBe(true);

    // A limpeza apaga-as de vez (as linhas, as reações e o ficheiro) e avisa os ecrãs abertos.
    seen.length = 0;
    expect(await app.get(ChatExpiryService).run()).toBeGreaterThanOrEqual(4);
    const left = (await pool.query('SELECT id FROM social.messages WHERE id = ANY($1::uuid[])', [[text, img, once, late]])).rows;
    expect(left).toEqual([]);
    expect((await pool.query('SELECT count(*)::int AS n FROM social.message_reactions WHERE message_id = $1', [text])).rows[0].n).toBe(0);
    expect((await pool.query('SELECT status FROM content.media_assets WHERE id = $1', [pic])).rows[0].status).toBe('deleted');
    expect(seen).toEqual(expect.arrayContaining([{ to: tc.id, e: { type: 'deleted', from: te.username } }, { to: te.id, e: { type: 'deleted', from: tc.username } }]));
    // A resposta continua, sem a citação; o resto da conversa não mexe.
    const after = await peek(tc, te);
    expect(after.find((m) => m.id === reply)!.replyTo).toBeNull();
    expect(after.some((m) => m.id === keep)).toBe(true);
    // Correr outra vez não faz nada.
    expect(await app.get(ChatExpiryService).run()).toBe(0);
  });

  it('expiradas nos grupos: saem da conversa, da lista e dos por ler; a limpeza apaga-as', async () => {
    const { ta, tb, tc } = u;
    const id = (await gp(ta, '', 'post').send({ name: 'Expira em grupo', members: [tb.username, tc.username] }).expect(201)).body.id as string;
    await gp(ta, `/${id}/messages`, 'post').send({ body: 'fica' }).expect(201);
    await gp(ta, `/${id}/ttl`, 'put').send({ ttl: DAY }).expect(200);
    const gone = (await gp(tb, `/${id}/messages`, 'post').send({ body: 'vai-se' }).expect(201)).body.id as string;
    const row = async () => ((await gp(tc, '').expect(200)).body as GRow[]).find((g) => g.id === id)!;
    expect((await row()).unread).toBe(2);
    await expire([gone]);
    expect((await row())).toMatchObject({ unread: 1, lastMessage: { kind: 'system' } });
    expect(((await gp(tc, `/${id}?read=0`).expect(200)).body.items as Item[]).some((m) => m.id === gone)).toBe(false);
    await app.get(ChatExpiryService).run();
    expect((await pool.query('SELECT 1 FROM social.messages WHERE id = $1', [gone])).rowCount).toBe(0);
  });

  it('limpar conversa a dois: só para mim; fica na lista vazia até chegar outra; o outro continua a ver; os meus aparelhos sabem', async () => {
    const { tb, td } = u;
    const m1 = await send(td, tb, 'primeira');
    const m2 = await send(tb, td, 'segunda');
    const m3 = await send(td, tb, 'terceira');
    await api().post(`/api/v1/chat/messages/${m2}/hide`).set(auth(tb)).expect(204);
    expect((await convo(tb, td))!.unread).toBe(1);
    seen.length = 0;
    expect((await api().post(`/api/v1/chat/with/${td.username}/clear`).set(auth(tb)).expect(200)).body).toEqual({ ok: true });
    // Eco só para os meus aparelhos; ao outro não chega nada.
    expect(seen).toEqual([{ to: tb.id, e: { type: 'deleted', from: td.username, self: true } }]);

    expect(await items(tb, td)).toEqual([]);
    expect((await convo(tb, td))!).toMatchObject({ unread: 0, lastMessage: { empty: true, body: '' } });
    expect((await items(td, tb)).map((m) => m.id)).toEqual([m3, m2, m1]);
    expect((await convo(td, tb))!.lastMessage).toMatchObject({ body: 'terceira', empty: false });
    // O "Apagar para mim" dessas já não é preciso.
    expect((await pool.query('SELECT 1 FROM social.message_hidden WHERE user_id = $1 AND message_id = $2', [tb.id, m2])).rowCount).toBe(0);
    const unread = (await api().get('/api/v1/chat/unread').set(auth(tb)).expect(200)).body;
    expect(unread.conversations).toBe(0);

    // Chega uma nova: só ela aparece.
    const m4 = await send(td, tb, 'quarta');
    expect((await convo(tb, td))!).toMatchObject({ unread: 1, lastMessage: { body: 'quarta', empty: false } });
    expect((await items(tb, td)).map((m) => m.id)).toEqual([m4]);

    // O "Apagar conversa" da lista continua a tirá-la da lista.
    await api().delete(`/api/v1/chat/with/${td.username}`).set(auth(tb)).expect(200);
    expect(await convo(tb, td)).toBeUndefined();
    await api().post(`/api/v1/chat/with/${td.username}/clear`).set(auth(u.ta)).expect(404); // sem conversa
  });

  it('limpar conversa num grupo: só para mim; o grupo fica na lista com "Sem mensagens"; os outros continuam a ver', async () => {
    const { ta, tb, tc, td } = u;
    const id = (await gp(ta, '', 'post').send({ name: 'Limpar em grupo', members: [tb.username, tc.username] }).expect(201)).body.id as string;
    const g1 = (await gp(tb, `/${id}/messages`, 'post').send({ body: 'olá' }).expect(201)).body.id as string;
    const g2 = (await gp(ta, `/${id}/messages`, 'post').send({ body: 'bora' }).expect(201)).body.id as string;
    await gp(td, `/${id}/clear`, 'post').expect(404);
    seen.length = 0;
    expect((await gp(tc, `/${id}/clear`, 'post').expect(200)).body).toEqual({ ok: true });
    expect(seen).toEqual([{ to: tc.id, e: { type: 'deleted', group: id, self: true } }]);
    expect(((await gp(tc, `/${id}`).expect(200)).body.items as Item[])).toEqual([]);
    expect(((await gp(tc, '').expect(200)).body as GRow[]).find((g) => g.id === id)).toMatchObject({ unread: 0, lastMessage: { empty: true, cleared: true } });
    expect(((await gp(tb, `/${id}`).expect(200)).body.items as Item[]).map((m) => m.id)).toEqual([g2, g1]);
    expect(((await gp(tb, '').expect(200)).body as GRow[]).find((g) => g.id === id)!.lastMessage).toMatchObject({ body: 'bora', cleared: false });

    const g3 = (await gp(tb, `/${id}/messages`, 'post').send({ body: 'nova' }).expect(201)).body.id as string;
    expect(((await gp(tc, '').expect(200)).body as GRow[]).find((g) => g.id === id)).toMatchObject({ unread: 1, lastMessage: { body: 'nova', empty: false } });
    expect(((await gp(tc, `/${id}`).expect(200)).body.items as Item[]).map((m) => m.id)).toEqual([g3]);
  });
});
