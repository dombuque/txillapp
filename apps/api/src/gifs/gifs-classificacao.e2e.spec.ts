import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { PushService } from '../push/push.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';

interface U { token: string; id: string; username: string }

const gif = (id: string, rating?: string) => ({ id, w: 200, h: 150, url: `https://media2.giphy.com/media/${id}/200w.gif`, ...(rating ? { rating } : {}) });
/** Um GIF como o GIPHY o devolve (por id e nas grelhas). */
const giphy = (id: string, rating: string) => ({
  type: 'gif', id, title: `GIF ${id}`, rating,
  images: { fixed_width: { url: `https://media2.giphy.com/media/${id}/200w.gif`, width: '200', height: '150' } },
});

/**
 * A classificação dos GIFs gravados (notas e mensagens) é a que o GIPHY dá, confirmada pelo id (a da app não conta); os
 * GIFs acima de «g» (ou sem classificação) não chegam a menores nem a quem não tem data de nascimento: nas notas a nota vem
 * sem o GIF; nas mensagens, nas conversas a dois, nos TxillGroups e na lista, vem `gifHidden` (a app mostra «GIF escondido»).
 */
describe('GIFs: classificação confirmada no GIPHY e escondida a menores (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  let fetchSpy: jest.SpyInstance;
  let pushSpy: jest.SpyInstance;
  const run = Date.now().toString(36);
  let n = 0;
  const api = () => request(app.getHttpServer());
  const auth = (x: { token: string }) => ({ Authorization: `Bearer ${x.token}` });
  /** O GIPHY simulado: a classificação de cada id (ausente = 404), os ids que falham (500) e os pedidos por id. */
  const ratings: Record<string, string> = {};
  const failing = new Set<string>();
  const byId: string[] = [];
  let grid: ReturnType<typeof giphy>[] = [];

  async function signup(name: string, birthDate: string | null = '1990-06-15'): Promise<U> {
    const username = `${name}${run}${n++}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').set('X-Forwarded-For', `10.9.8.${(n % 250) + 1}`)
      .send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: 'password-bem-longa-1', birthDate: birthDate ?? '1990-06-15', acceptTerms: true }).expect(201);
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
    if (birthDate === null) await pool.query('UPDATE identity.users SET birth_date = NULL WHERE id = $1', [r.body.user.id]);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  const follow = (who: U, whom: U) => pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [who.id, whom.id]);
  const mutual = async (a: U, b: U) => { await follow(a, b); await follow(b, a); };
  const putNote = (x: U, body: Record<string, unknown>) => api().put('/api/v1/notes/me').set(auth(x)).send(body);
  const noteOf = async (viewer: U, author: U) => ((await api().get('/api/v1/notes').set(auth(viewer)).expect(200)).body.items as { username: string; body: string; gif: Record<string, unknown> | null }[]).find((z) => z.username === author.username);
  const storedRating = async (author: U) => (await pool.query(`SELECT gif ->> 'rating' AS r FROM social.notes WHERE user_id = $1`, [author.id])).rows[0]?.r ?? null;
  const send = (from: U, to: U, g: Record<string, unknown>) => api().post(`/api/v1/chat/with/${to.username}`).set(auth(from)).send({ kind: 'gif', gif: g });
  const thread = async (x: U, other: U) => (await api().get(`/api/v1/chat/with/${other.username}`).set(auth(x)).expect(200)).body.items as { id: string; kind: string; gif: Record<string, unknown> | null; gifHidden?: boolean }[];
  const lastIn = async (x: U, other: U) => ((await api().get('/api/v1/chat/conversations').set(auth(x)).expect(200)).body as { username: string; lastMessage: Record<string, unknown> }[]).find((c) => c.username === other.username)!.lastMessage;

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'k'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test', GIPHY_API_KEY: 'chave-de-teste-456' }));
    await app.init();
    // O GIPHY é simulado: nada sai da máquina nos testes.
    const real = global.fetch;
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.hostname !== 'api.giphy.com') return real(input, init);
      const path = url.pathname.replace('/v1/gifs/', '');
      if (path === 'search' || path === 'trending') return new Response(JSON.stringify({ data: grid, pagination: { total_count: grid.length, count: grid.length, offset: 0 } }), { status: 200 });
      byId.push(path);
      if (failing.has(path)) return new Response('erro', { status: 500 });
      if (!(path in ratings)) return new Response(JSON.stringify({ data: [], meta: { status: 404, msg: 'Not Found' } }), { status: 404 });
      return new Response(JSON.stringify({ data: giphy(path, ratings[path]), meta: { status: 200 } }), { status: 200 });
    });
    pushSpy = jest.spyOn(app.get(PushService), 'send').mockImplementation(async () => 0);
  }, 60_000);

  afterAll(async () => {
    fetchSpy.mockRestore();
    pushSpy.mockRestore();
    await app.close();
    await pool.end();
  });

  it('nota: guarda a classificação do GIPHY, não a da app; cache por id; um GIF que não existe dá 400', async () => {
    const a = await signup('kca');
    const b = await signup('kcb');
    ratings[`Forte${run}`] = 'pg-13';
    // A app diz 'g', o GIPHY diz 'pg-13': fica 'pg-13'.
    await putNote(a, { body: 'Forte', gif: gif(`Forte${run}`, 'g') }).expect(204);
    expect(await storedRating(a)).toBe('pg-13');
    expect(byId.filter((x) => x === `Forte${run}`)).toHaveLength(1);
    // O mesmo id outra vez (outra pessoa, ou numa mensagem): vem da cache, sem novo pedido.
    await putNote(b, { body: 'Também', gif: gif(`Forte${run}`) }).expect(204);
    expect(await storedRating(b)).toBe('pg-13');
    await mutual(a, b);
    await send(a, b, gif(`Forte${run}`)).expect(201);
    expect(byId.filter((x) => x === `Forte${run}`)).toHaveLength(1);
    // Não existe no GIPHY: 400 (nota e mensagem); nada fica gravado.
    const gone = gif(`NaoHa${run}`, 'g');
    await api().delete('/api/v1/notes/me').set(auth(a)).expect(204);
    expect(JSON.stringify((await putNote(a, { body: 'x', gif: gone }).expect(400)).body)).toContain('já não existe no GIPHY');
    expect(await storedRating(a)).toBeNull();
    await send(a, b, gone).expect(400);
  });

  it('GIPHY em baixo: um adulto fica com classificação desconhecida (não chega a menores); um menor fica com «g» só se o GIF esteve na grelha «g»', async () => {
    const adult = await signup('kda');
    const minor = await signup('kdm', '2010-02-02');
    const viewer = await signup('kdv', '2011-05-05');
    for (const a of [adult, minor]) await follow(viewer, a);
    const inGrid = `NaGrelha${run}`;
    const notInGrid = `ForaGrelha${run}`;
    const adultGif = `Adulto${run}`;
    for (const id of [inGrid, notInGrid, adultGif]) failing.add(id);
    // O menor viu a grelha 'g' com este GIF (a pesquisa já passa pela classificação 'g').
    grid = [giphy(inGrid, 'g')];
    await api().get('/api/v1/gifs/search?q=gatinhos').set(auth(minor)).expect(200);
    grid = [];

    await putNote(adult, { body: 'Do adulto', gif: gif(adultGif, 'g') }).expect(204);
    expect(await storedRating(adult)).toBeNull();
    expect(await noteOf(viewer, adult)).toMatchObject({ body: 'Do adulto', gif: null });

    // A grelha já disse ao servidor a classificação deste GIF: nem é preciso perguntar outra vez.
    await putNote(minor, { body: 'Do menor', gif: gif(inGrid) }).expect(204);
    expect(await storedRating(minor)).toBe('g');
    expect(await noteOf(viewer, minor)).toMatchObject({ gif: expect.objectContaining({ id: inGrid, rating: 'g' }) });

    await api().delete('/api/v1/notes/me').set(auth(minor)).expect(204);
    await putNote(minor, { body: 'Outro', gif: gif(notInGrid, 'g') }).expect(204);
    expect(await storedRating(minor)).toBeNull();
    expect(await noteOf(viewer, minor)).toMatchObject({ body: 'Outro', gif: null });
  });

  it('notas: menores e quem não tem data de nascimento recebem a nota sem o GIF acima de «g»; só GIF, não a recebem', async () => {
    const author = await signup('kna');
    const onlyGif = await signup('kno');
    const light = await signup('knl');
    const minor = await signup('knm', '2011-03-01');
    const noBirth = await signup('knn', null);
    const adult = await signup('knx');
    for (const v of [minor, noBirth, adult]) for (const a of [author, onlyGif, light]) await follow(v, a);
    Object.assign(ratings, { [`Pg13${run}`]: 'pg-13', [`Rrr${run}`]: 'r', [`Leve${run}`]: 'g' });
    await putNote(author, { body: 'Com GIF forte', gif: gif(`Pg13${run}`) }).expect(204);
    await putNote(onlyGif, { gif: gif(`Rrr${run}`, 'g') }).expect(204);
    await putNote(light, { body: 'GIF leve', gif: gif(`Leve${run}`) }).expect(204);

    expect(await noteOf(adult, author)).toMatchObject({ gif: expect.objectContaining({ rating: 'pg-13' }) });
    expect(await noteOf(adult, onlyGif)).toMatchObject({ gif: expect.objectContaining({ rating: 'r' }) });
    for (const v of [minor, noBirth]) {
      expect(await noteOf(v, author)).toMatchObject({ body: 'Com GIF forte', gif: null });
      expect(await noteOf(v, onlyGif)).toBeUndefined();
      expect(await noteOf(v, light)).toMatchObject({ gif: expect.objectContaining({ rating: 'g' }) });
      expect((await api().get(`/api/v1/chat/with/${author.username}`).set(auth(v)).expect(200)).body.peerNote).toMatchObject({ gif: null });
    }
  });

  it('mensagens: a classificação vai com o GIF; a um menor, o GIF acima de «g» (ou antigo, sem classificação) vem escondido, a dois, nos grupos e na lista', async () => {
    const adult = await signup('kma');
    const minor = await signup('kmm', '2010-09-09');
    const noBirth = await signup('kmn', null);
    await mutual(adult, minor);
    await mutual(adult, noBirth);
    Object.assign(ratings, { [`MsgPg${run}`]: 'pg', [`MsgG${run}`]: 'g' });

    const strong = (await send(adult, minor, gif(`MsgPg${run}`, 'g')).expect(201)).body.id as string;
    // Quem enviou (adulto) vê o GIF com a classificação do GIPHY.
    expect((await thread(adult, minor)).find((m) => m.id === strong)).toMatchObject({ kind: 'gif', gif: expect.objectContaining({ rating: 'pg' }) });
    // O menor: sem o GIF (nem o endereço), com gifHidden; na lista, «GIF escondido».
    const seen = (await thread(minor, adult)).find((m) => m.id === strong)!;
    expect(seen).toMatchObject({ kind: 'gif', gif: null, gifHidden: true });
    expect(JSON.stringify(seen)).not.toContain('giphy.com');
    expect(await lastIn(minor, adult)).toMatchObject({ kind: 'gif', gifRating: 'pg', gifHidden: true });
    expect(await lastIn(adult, minor)).toMatchObject({ kind: 'gif', gifRating: 'pg' });
    expect(await lastIn(adult, minor)).not.toHaveProperty('gifHidden');

    // Um GIF «g» chega a todos.
    const light = (await send(adult, minor, gif(`MsgG${run}`)).expect(201)).body.id as string;
    expect((await thread(minor, adult)).find((m) => m.id === light)).toMatchObject({ gif: expect.objectContaining({ rating: 'g' }) });
    expect((await thread(minor, adult)).find((m) => m.id === light)).not.toHaveProperty('gifHidden');

    // Uma mensagem antiga, sem classificação: conta como desconhecida (escondida a menores e a quem não tem data de nascimento).
    const old = (await send(adult, noBirth, gif(`MsgG${run}`)).expect(201)).body.id as string;
    await pool.query(`UPDATE social.messages SET gif = gif - 'rating' WHERE id = $1`, [old]);
    expect((await thread(noBirth, adult)).find((m) => m.id === old)).toMatchObject({ gif: null, gifHidden: true });
    expect(await lastIn(noBirth, adult)).toMatchObject({ gifRating: null, gifHidden: true });
    expect((await thread(adult, noBirth)).find((m) => m.id === old)).toMatchObject({ gif: expect.objectContaining({ id: `MsgG${run}` }) });

    // TxillGroups: o mesmo, na conversa e na lista.
    const g = (await api().post('/api/v1/chat/groups').set(auth(adult)).send({ name: `GIFs ${run}`, members: [minor.username, noBirth.username] }).expect(201)).body.id as string;
    const inGroup = (await api().post(`/api/v1/chat/groups/${g}/messages`).set(auth(adult)).send({ kind: 'gif', gif: gif(`MsgPg${run}`) }).expect(201)).body.id as string;
    const gItems = (await api().get(`/api/v1/chat/groups/${g}`).set(auth(minor)).expect(200)).body.items as { id: string; gif: unknown; gifHidden?: boolean }[];
    expect(gItems.find((m) => m.id === inGroup)).toMatchObject({ gif: null, gifHidden: true });
    const gList = ((await api().get('/api/v1/chat/groups').set(auth(minor)).expect(200)).body as { id: string; lastMessage: Record<string, unknown> }[]).find((x) => x.id === g)!;
    expect(gList.lastMessage).toMatchObject({ kind: 'gif', gifRating: 'pg', gifHidden: true });
    const aItems = (await api().get(`/api/v1/chat/groups/${g}`).set(auth(adult)).expect(200)).body.items as { id: string; gif: unknown }[];
    expect(aItems.find((m) => m.id === inGroup)).toMatchObject({ gif: expect.objectContaining({ rating: 'pg' }) });
  });
});
