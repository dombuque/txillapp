import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';

interface U { token: string; id: string; username: string }
interface Item { id: string; body: string; kind: string; fromMe: boolean; deleted?: boolean; mediaUrl: string | null; reactions: unknown[]; replyTo: unknown }

/**
 * Apagar mensagens como no WhatsApp:
 * - "Apagar para todos" (DELETE /chat/messages/:id): só as minhas, sem limite de tempo; fica o aviso no lugar;
 * - "Apagar para mim" (POST /chat/messages/:id/hide): qualquer mensagem de uma conversa ou grupo em que estou; só eu deixo
 *   de a ver (a conversa, a última mensagem da lista e os por ler ignoram-na); os outros continuam a vê-la;
 * - "Editar" (PATCH /chat/messages/:id): só as minhas de texto, nos primeiros 15 minutos, com o filtro do envio.
 */
describe('apagar (para todos e para mim) e editar mensagens (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  const u: Record<string, U> = {};

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  const send = async (from: U, to: U, body: string, extra: Record<string, unknown> = {}) =>
    (await api().post(`/api/v1/chat/with/${to.username}`).set(auth(from)).send({ body, ...extra }).expect(201)).body.id as string;
  const thread = async (x: U, other: U) => (await api().get(`/api/v1/chat/with/${other.username}`).set(auth(x)).expect(200)).body.items as Item[];
  const convo = async (x: U, other: U) =>
    ((await api().get('/api/v1/chat/conversations').set(auth(x)).expect(200)).body as { username: string; unread: number; lastMessage: { body: string; fromMe: boolean } }[]).find((c) => c.username === other.username);
  const delAll = (x: U, id: string) => api().delete(`/api/v1/chat/messages/${id}`).set(auth(x));
  const hide = (x: U, id: string) => api().post(`/api/v1/chat/messages/${id}/hide`).set(auth(x));
  const gp = (x: U, path: string, method: 'get' | 'post' = 'get') => api()[method](`/api/v1/chat/groups${path}`).set(auth(x));

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'c'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    for (const n of ['da', 'db', 'dc', 'dd']) u[n] = await signup(n);
    const ids = Object.values(u).map((x) => x.id);
    for (const a of ids) for (const b of ids) if (a !== b) await pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [a, b]);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('apagar para todos: a minha → 204 e fica o aviso para os dois; a de outra pessoa → 404; sem limite de tempo', async () => {
    const { da, db } = u;
    const mine = await send(da, db, 'vou apagar isto');
    const theirs = await send(db, da, 'esta é do outro');
    await delAll(da, theirs).expect(404); // não é minha
    await delAll(u.dc, mine).expect(404); // nem é da conversa
    await delAll(da, mine).expect(204);
    await delAll(da, mine).expect(404); // já apagada

    const forMe = (await thread(da, db)).find((m) => m.id === mine)!;
    const forThem = (await thread(db, da)).find((m) => m.id === mine)!;
    expect(forMe).toMatchObject({ deleted: true, fromMe: true, kind: 'text', body: 'Apagaste esta mensagem', mediaUrl: null, reactions: [], replyTo: null });
    expect(forThem).toMatchObject({ deleted: true, fromMe: false, body: 'Esta mensagem foi apagada' });
    expect((await thread(db, da)).find((m) => m.id === theirs)).toMatchObject({ body: 'esta é do outro' });
    // Não se reage a uma apagada.
    await api().put(`/api/v1/chat/messages/${mine}/reaction`).set(auth(db)).send({ reaction: ':amor:' }).expect(404);

    // Sem limite de tempo: uma mensagem de há 3 dias também se apaga para todos.
    const old = await send(da, db, 'mensagem antiga');
    await pool.query("UPDATE social.messages SET created_at = now() - interval '3 days' WHERE id = $1", [old]);
    await delAll(da, old).expect(204);
    expect((await thread(db, da)).find((m) => m.id === old)).toMatchObject({ deleted: true });

    // Uma localização apagada não leva o sítio.
    const here = await send(da, db, 'Aqui', { kind: 'location', lat: 38.7223, lng: -9.1393 });
    await delAll(da, here).expect(204);
    expect((await thread(db, da)).find((m) => m.id === here)).toMatchObject({ deleted: true, lat: null, lng: null });

    // As que foram apagadas antes deste aviso existir (sem rasto) continuam a não aparecer.
    const before = await send(da, db, 'apagada à antiga');
    await pool.query("UPDATE social.messages SET deleted_at = now(), body = '' WHERE id = $1", [before]);
    expect((await thread(db, da)).some((m) => m.id === before)).toBe(false);
  });

  it('apagar para mim: esconde só para mim (minha ou do outro); o outro continua a ver; a lista e os por ler ignoram-na', async () => {
    const { da, dc } = u;
    const a1 = await send(dc, da, 'primeira do dc');
    const a2 = await send(da, dc, 'resposta da da');
    const a3 = await send(dc, da, 'última do dc');
    expect((await convo(da, dc))!.unread).toBe(1); // a3 (responder marcou a1 como lida)

    await hide(da, a3).expect(204); // do outro
    expect((await convo(da, dc))!.unread).toBe(0); // os por ler não contam as que apaguei para mim
    await hide(da, a3).expect(204); // repetir não faz mal
    await hide(da, a2).expect(204); // minha
    await hide(u.dd, a1).expect(404); // quem não é da conversa
    await hide(da, '00000000-0000-7000-8000-000000000000').expect(404);

    const mineNow = await thread(da, dc);
    expect(mineNow.map((m) => m.id)).toEqual([a1]); // a conversa não devolve as que apaguei para mim
    const theirsNow = await thread(dc, da);
    expect(theirsNow.map((m) => m.id)).toEqual([a3, a2, a1]); // o outro continua a ver tudo

    // A última mensagem na lista de conversas ignora as que apaguei para mim; a do outro não muda.
    const row = (await convo(da, dc))!;
    expect(row.lastMessage).toMatchObject({ body: 'primeira do dc', fromMe: false });
    expect((await convo(dc, da))!.lastMessage).toMatchObject({ body: 'última do dc', fromMe: true });

    // Chega outra e apago-a para mim sem abrir a conversa: deixa de contar como por ler.
    const a4 = await send(dc, da, 'mais uma');
    expect((await convo(da, dc))!.unread).toBe(1);
    await hide(da, a4).expect(204);
    expect((await convo(da, dc))!.unread).toBe(0);

    // O aviso de uma apagada para todos também se tira só para mim.
    const a5 = await send(dc, da, 'vai ser apagada');
    await delAll(dc, a5).expect(204);
    expect((await thread(da, dc)).find((m) => m.id === a5)).toMatchObject({ deleted: true });
    await hide(da, a5).expect(204);
    expect((await thread(da, dc)).some((m) => m.id === a5)).toBe(false);
    expect((await thread(dc, da)).find((m) => m.id === a5)).toMatchObject({ deleted: true, body: 'Apagaste esta mensagem' });

    // Escondida para mim, ainda posso apagá-la para todos (era minha): o outro passa a ver o aviso.
    await delAll(da, a2).expect(204);
    expect((await thread(dc, da)).find((m) => m.id === a2)).toMatchObject({ deleted: true, body: 'Esta mensagem foi apagada' });
    expect((await thread(da, dc)).some((m) => m.id === a2)).toBe(false);
  });

  it('nos TxillGroups: apagar para todos deixa o aviso a todos; apagar para mim esconde só a mim; a lista ignora-as', async () => {
    const { da, db, dc, dd } = u;
    const id = (await gp(da, '', 'post').send({ name: 'Apagar em grupo', members: [db.username, dc.username] }).expect(201)).body.id as string;
    const say = async (x: U, body: string) => (await gp(x, `/${id}/messages`, 'post').send({ body }).expect(201)).body.id as string;
    const items = async (x: U) => (await gp(x, `/${id}`).expect(200)).body.items as Item[];
    const last = async (x: U) => ((await gp(x, '').expect(200)).body as { id: string; lastMessage: { body: string }; unread: number }[]).find((g) => g.id === id)!;

    const g1 = await say(db, 'olá malta');
    const g2 = await say(dc, 'bora');
    const g3 = await say(db, 'a última do db');

    expect((await last(da)).unread).toBe(3);
    // Para todos: só quem enviou.
    await delAll(da, g2).expect(404);
    await delAll(dc, g2).expect(204);
    expect((await last(da)).unread).toBe(2); // a apagada para todos não conta
    for (const x of [da, db]) expect((await items(x)).find((m) => m.id === g2)).toMatchObject({ deleted: true, body: 'Esta mensagem foi apagada' });
    expect((await items(dc)).find((m) => m.id === g2)).toMatchObject({ deleted: true, body: 'Apagaste esta mensagem' });

    // Para mim: qualquer membro, qualquer mensagem; quem não é membro não.
    await hide(dd, g3).expect(404);
    await hide(da, g3).expect(204);
    expect((await items(da)).map((m) => m.id)).not.toContain(g3);
    expect((await items(db)).map((m) => m.id)).toContain(g3);
    expect((await items(dc)).map((m) => m.id)).toContain(g3);
    expect((await last(da)).lastMessage.body).toBe('olá malta'); // a última ignora a que apaguei para mim (e a apagada para todos)
    expect((await last(db)).lastMessage.body).toBe('a última do db');
    expect((await items(da)).map((m) => m.id)).toEqual([g2, g1]);
    // Uma nova que apago para mim antes de abrir o grupo não fica por ler.
    const g4 = await say(dc, 'mais uma');
    expect((await last(da)).unread).toBe(1);
    await hide(da, g4).expect(204);
    expect((await last(da)).unread).toBe(0);
  });

  it('editar: a minha de texto dentro de 15 min (fica editada para os dois); fora do prazo 403; de outro 403; não-texto 400; filtro', async () => {
    const { da, db, dd } = u;
    const edit = (x: U, id: string, body: string) => api().patch(`/api/v1/chat/messages/${id}`).set(auth(x)).send({ body });
    const t1 = await send(da, db, 'vou ao cinema às 8');
    const r = await edit(da, t1, '  vou ao cinema às 9  ').expect(200);
    expect(r.body).toEqual({ id: t1, body: 'vou ao cinema às 9', edited: true });
    for (const [x, o] of [[da, db], [db, da]] as const) expect((await thread(x, o)).find((m) => m.id === t1)).toMatchObject({ body: 'vou ao cinema às 9', edited: true });
    expect((await convo(db, da))!.lastMessage.body).toBe('vou ao cinema às 9'); // a lista mostra o texto novo
    const plain = await send(da, db, 'nunca editada');
    expect((await thread(db, da)).find((m) => m.id === plain)).toMatchObject({ edited: false });

    await edit(db, t1, 'mudei a tua').expect(403); // de outra pessoa
    await edit(dd, t1, 'nem sou da conversa').expect(404);
    await edit(da, t1, '   ').expect(400); // vazia
    await edit(da, t1, 'x'.repeat(2001)).expect(400);
    await edit(da, t1, 'kill yourself').expect(422); // o mesmo filtro do envio
    expect((await thread(db, da)).find((m) => m.id === t1)!.body).toBe('vou ao cinema às 9');

    // Fora do prazo (enviada há 16 minutos) e ainda dentro (14 minutos).
    const old = await send(da, db, 'já vai tarde');
    await pool.query("UPDATE social.messages SET created_at = now() - interval '16 minutes' WHERE id = $1", [old]);
    await edit(da, old, 'tarde demais').expect(403);
    const soon = await send(da, db, 'ainda dá');
    await pool.query("UPDATE social.messages SET created_at = now() - interval '14 minutes' WHERE id = $1", [soon]);
    await edit(da, soon, 'ainda deu').expect(200);

    // Não-texto (sticker, localização), visualização única e apagada.
    const st = await send(da, db, 'bora', { kind: 'sticker' });
    await edit(da, st, 'outro').expect(400);
    const loc = await send(da, db, 'Aqui', { kind: 'location', lat: 38.7, lng: -9.1 });
    await edit(da, loc, 'Ali').expect(400);
    const once = await send(da, db, 'segredo', { once: true });
    await edit(da, once, 'outro segredo').expect(400);
    const gone = await send(da, db, 'a apagar');
    await delAll(da, gone).expect(204);
    await edit(da, gone, 'volta').expect(404);
  });

  it('editar nos TxillGroups: só quem enviou, e todos veem o texto novo com "editada"', async () => {
    const { da, db, dc, dd } = u;
    const id = (await gp(da, '', 'post').send({ name: 'Editar em grupo', members: [db.username, dc.username] }).expect(201)).body.id as string;
    const msg = (await gp(db, `/${id}/messages`, 'post').send({ body: 'jantar às 20h' }).expect(201)).body.id as string;
    const edit = (x: U, body: string) => api().patch(`/api/v1/chat/messages/${msg}`).set(auth(x)).send({ body });
    await edit(da, 'às 21h').expect(403);
    await edit(dd, 'às 21h').expect(404);
    await edit(db, 'jantar às 21h').expect(200);
    for (const x of [da, db, dc]) expect(((await gp(x, `/${id}`).expect(200)).body.items as Item[]).find((m) => m.id === msg)).toMatchObject({ body: 'jantar às 21h', edited: true });
  });
});
