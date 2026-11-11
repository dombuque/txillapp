import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { PushService } from '../push/push.service';
import { giphyMediaUrl, mapGiphy, stillOf } from './gif';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';

interface U { token: string; id: string; username: string }
interface Gif { id: string; w: number; h: number; url: string; still?: string; title?: string }
interface Item { id: string; kind: string; body: string; deleted?: boolean; gif?: Gif | null }

/** Um GIF como o GIPHY o devolve (com bundle=messaging_non_clips). */
const giphyGif = (id: string, title = `GIF ${id}`) => ({
  type: 'gif',
  id,
  title,
  images: {
    fixed_width: { url: `https://media2.giphy.com/media/v1.Y2lkPTc5/${id}/200w.gif?cid=abc&rid=200w.gif&ct=g`, width: '200', height: '150', webp: `https://media2.giphy.com/media/v1.Y2lkPTc5/${id}/200w.webp?cid=abc&ct=g`, mp4: `https://media2.giphy.com/media/v1.Y2lkPTc5/${id}/200w.mp4?cid=abc` },
    fixed_width_small: { url: `https://media2.giphy.com/media/${id}/100w.gif?cid=abc`, width: '100', height: '75', webp: `https://media2.giphy.com/media/${id}/100w.webp?cid=abc` },
    fixed_width_still: { url: `https://media2.giphy.com/media/${id}/200w_s.gif?cid=abc`, width: '200', height: '150' },
  },
});
const good = (id = 'AbC123xyz') => ({ id, w: 200, h: 150, url: `https://media2.giphy.com/media/v1.Y2lkPTc5/${id}/200w.webp?cid=abc&ct=g`, still: `https://media2.giphy.com/media/${id}/200w_s.gif`, title: 'Brinde da malta' });

describe('GIFs do GIPHY: lógica pura', () => {
  it('só aceita https de media*.giphy.com, com o id no caminho; tira a analítica (query)', () => {
    expect(giphyMediaUrl('https://media.giphy.com/media/AbC123/giphy.gif?cid=1', 'AbC123')).toBe('https://media.giphy.com/media/AbC123/giphy.gif');
    expect(giphyMediaUrl('https://media4.giphy.com/media/v1.Y2lk/AbC123/200w.webp', 'AbC123')).toBe('https://media4.giphy.com/media/v1.Y2lk/AbC123/200w.webp');
    expect(giphyMediaUrl('http://media.giphy.com/media/AbC123/giphy.gif', 'AbC123')).toBeNull();
    expect(giphyMediaUrl('https://media.giphy.com.evil.com/media/AbC123/giphy.gif', 'AbC123')).toBeNull();
    expect(giphyMediaUrl('https://evil.com/media/AbC123/giphy.gif', 'AbC123')).toBeNull();
    expect(giphyMediaUrl('https://giphy.com/media/AbC123/giphy.gif', 'AbC123')).toBeNull();
    expect(giphyMediaUrl('https://media.giphy.com/media/Outro99/giphy.gif', 'AbC123')).toBeNull();
    expect(giphyMediaUrl('https://media.giphy.com/media/AbC123/giphy.svg', 'AbC123')).toBeNull();
    expect(giphyMediaUrl('https://user:pw@media.giphy.com/media/AbC123/giphy.gif', 'AbC123')).toBeNull();
    expect(giphyMediaUrl('javascript:alert(1)', 'AbC123')).toBeNull();
  });

  it('a página do GIPHY → só o que a app precisa; o próximo offset', () => {
    const p = mapGiphy({ data: [giphyGif('AaaA1'), { id: 'mau', images: {} }, giphyGif('BbbB2')], pagination: { total_count: 100, count: 3, offset: 0 } }, 0, 24);
    expect(p.items.map((i) => i.id)).toEqual(['AaaA1', 'BbbB2']);
    expect(p.items[0]).toEqual({
      id: 'AaaA1', title: 'GIF AaaA1', w: 200, h: 150,
      preview: 'https://media2.giphy.com/media/AaaA1/100w.webp',
      full: 'https://media2.giphy.com/media/v1.Y2lkPTc5/AaaA1/200w.webp',
      still: 'https://media2.giphy.com/media/AaaA1/200w_s.gif',
      mp4: 'https://media2.giphy.com/media/v1.Y2lkPTc5/AaaA1/200w.mp4',
    });
    expect(p.next).toBe(3);
    expect(mapGiphy({ data: [giphyGif('AaaA1')], pagination: { total_count: 1, count: 1, offset: 0 } }, 0, 24).next).toBeNull();
    expect(mapGiphy(null, 0, 24)).toEqual({ items: [], next: null });
    // Sem fixed_width_still (o bundle messaging_non_clips não o traz): a parada deriva-se do fixed_width.
    const g = giphyGif('CccC3');
    delete (g.images as Record<string, unknown>).fixed_width_still;
    expect(mapGiphy({ data: [g] }, 0, 24).items[0].still).toBe('https://media2.giphy.com/media/v1.Y2lkPTc5/CccC3/200w_s.gif');
    expect(stillOf('https://media.giphy.com/media/AbC123/giphy.gif')).toBeNull();
  });
});

describe('GIFs do GIPHY (integração)', () => {
  let off: INestApplication;
  let app: INestApplication;
  let pool: Pool;
  let fetchSpy: jest.SpyInstance;
  let pushSpy: jest.SpyInstance;
  /** Os pedidos que "saíram" para o GIPHY (simulado) e o que o simulador responde a seguir. */
  const calls: URL[] = [];
  let reply: () => Promise<Response> = async () => new Response('{}', { status: 200 });
  const run = Date.now().toString(36);
  const api = (a: INestApplication = app) => request(a.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  const u: Record<string, U> = {};

  async function signup(name: string, birthDate = '1990-06-15'): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate, acceptTerms: true }).expect(201);
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  const thread = async (x: U, other: U) => (await api().get(`/api/v1/chat/with/${other.username}`).set(auth(x)).expect(200)).body.items as Item[];

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    const base = { DATABASE_URL: DB, JWT_ACCESS_SECRET: 'g'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' } as const;
    off = await createApp(loadConfig({ ...base }));
    await off.init();
    app = await createApp(loadConfig({ ...base, GIPHY_API_KEY: 'chave-de-teste-123', GIPHY_CHANNEL: '@txillapp' }));
    await app.init();
    for (const n of ['ga', 'gb', 'gc']) u[n] = await signup(n);
    // Menor: 15 anos.
    const teen = new Date();
    teen.setFullYear(teen.getFullYear() - 15);
    u.gm = await signup('gm', teen.toISOString().slice(0, 10));
    const ids = Object.values(u).map((x) => x.id);
    for (const a of ids) for (const b of ids) if (a !== b) await pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [a, b]);
    // O GIPHY é simulado: nada sai da máquina nos testes.
    const real = global.fetch;
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (!url.startsWith('https://api.giphy.com/')) return real(input, init);
      calls.push(new URL(url));
      return reply();
    });
    pushSpy = jest.spyOn(app.get(PushService), 'send').mockImplementation(async () => undefined as never);
  }, 60_000);

  afterAll(async () => {
    fetchSpy.mockRestore();
    pushSpy.mockRestore();
    await off.close();
    await app.close();
    await pool.end();
  });

  it('sem chave: config enabled false e as listas respondem { enabled: false } sem falar com o GIPHY', async () => {
    expect((await api(off).get('/api/v1/gifs/config').expect(200)).body).toEqual({ enabled: false, channel: null });
    const before = calls.length;
    for (const p of ['/api/v1/gifs/trending', '/api/v1/gifs/search?q=ola', '/api/v1/gifs/channel']) {
      expect((await api(off).get(p).set(auth(u.ga)).expect(200)).body).toMatchObject({ enabled: false, items: [], next: null });
    }
    expect(calls.length).toBe(before);
  });

  it('com chave: config com o canal; pesquisa pelo servidor sem dados do utilizador; cache; erros dão página vazia', async () => {
    expect((await api().get('/api/v1/gifs/config').expect(200)).body).toEqual({ enabled: true, channel: 'txillapp' });
    await api().get('/api/v1/gifs/trending').expect(401);
    reply = async () => new Response(JSON.stringify({ data: [giphyGif('Trend01'), giphyGif('Trend02')], pagination: { total_count: 500, count: 2, offset: 0 } }), { status: 200 });
    const t = (await api().get('/api/v1/gifs/trending').set(auth(u.ga)).expect(200)).body;
    expect(t.items.map((i: { id: string }) => i.id)).toEqual(['Trend01', 'Trend02']);
    expect(t.next).toBe(2);
    const sent = calls[calls.length - 1];
    expect(sent.pathname).toBe('/v1/gifs/trending');
    expect(Object.fromEntries(sent.searchParams)).toEqual({ api_key: 'chave-de-teste-123', limit: '24', offset: '0', rating: 'pg-13', lang: 'pt', bundle: 'messaging_non_clips' });
    // Nada do utilizador: nem id, nem nome, nem random_id.
    expect(sent.toString()).not.toContain(u.ga.id);
    expect(sent.toString()).not.toContain(u.ga.username);
    expect(sent.searchParams.has('random_id')).toBe(false);

    // A mesma página outra vez vem da cache (não sai pedido novo).
    const n = calls.length;
    await api().get('/api/v1/gifs/trending').set(auth(u.gb)).expect(200);
    expect(calls.length).toBe(n);

    // Pesquisa e canal ("GIFs Txillapp" = pesquisa @canal).
    reply = async () => new Response(JSON.stringify({ data: [giphyGif('Srch01')], pagination: { total_count: 1, count: 1, offset: 24 } }), { status: 200 });
    const s = (await api().get('/api/v1/gifs/search?q=%20Brinde%20&offset=24').set(auth(u.ga)).expect(200)).body;
    expect(s).toEqual({ items: [expect.objectContaining({ id: 'Srch01' })], next: null });
    expect(calls[calls.length - 1].searchParams.get('q')).toBe('Brinde');
    expect(calls[calls.length - 1].searchParams.get('offset')).toBe('24');
    await api().get('/api/v1/gifs/channel').set(auth(u.ga)).expect(200);
    expect(calls[calls.length - 1].pathname).toBe('/v1/gifs/search');
    expect(calls[calls.length - 1].searchParams.get('q')).toBe('@txillapp');

    // O GIPHY falha (500, 429 ou rede): página vazia, nunca 500.
    reply = async () => new Response('erro', { status: 500 });
    expect((await api().get('/api/v1/gifs/search?q=falha1').set(auth(u.ga)).expect(200)).body).toEqual({ items: [], next: null });
    reply = async () => { throw new Error('rede em baixo'); };
    expect((await api().get('/api/v1/gifs/search?q=falha2').set(auth(u.ga)).expect(200)).body).toEqual({ items: [], next: null });
  });

  it('menores de 18 (e quem não tem data de nascimento) só recebem GIFs com rating g', async () => {
    reply = async () => new Response(JSON.stringify({ data: [giphyGif('Kids01')], pagination: { total_count: 1, count: 1, offset: 0 } }), { status: 200 });
    await api().get('/api/v1/gifs/search?q=gatinhos').set(auth(u.gm)).expect(200);
    expect(calls[calls.length - 1].searchParams.get('rating')).toBe('g');
    await api().get('/api/v1/gifs/search?q=gatinhos').set(auth(u.ga)).expect(200);
    expect(calls[calls.length - 1].searchParams.get('rating')).toBe('pg-13');
    // A cache separa por classificação: o menor não recebe o que foi pedido para adultos.
    await api().get('/api/v1/gifs/trending?offset=48').set(auth(u.ga)).expect(200);
    await api().get('/api/v1/gifs/trending?offset=48').set(auth(u.gm)).expect(200);
    expect(calls.slice(-2).map((c) => c.searchParams.get('rating'))).toEqual(['pg-13', 'g']);
    await pool.query('UPDATE identity.users SET birth_date = NULL WHERE id = $1', [u.gc.id]);
    await api().get('/api/v1/gifs/search?q=semdata').set(auth(u.gc)).expect(200);
    expect(calls[calls.length - 1].searchParams.get('rating')).toBe('g');
    await pool.query("UPDATE identity.users SET birth_date = '1990-06-15' WHERE id = $1", [u.gc.id]);
  });

  it('validação: só https de media*.giphy.com, id válido e medidas razoáveis', async () => {
    const { ga, gb } = u;
    const bad = [
      { ...good(), url: 'http://media2.giphy.com/media/AbC123xyz/200w.webp' },
      { ...good(), url: 'https://evil.example.com/media/AbC123xyz/200w.webp' },
      { ...good(), url: 'https://media2.giphy.com.evil.com/media/AbC123xyz/200w.webp' },
      { ...good(), url: 'https://media2.giphy.com/media/OutroId9/200w.webp' },
      { ...good(), still: 'https://evil.example.com/media/AbC123xyz/s.gif' },
      { ...good(), id: 'mau id!' },
      { ...good(), w: 5000 },
      { ...good(), w: 16, h: 1000 },
    ];
    for (const gif of bad) await api().post(`/api/v1/chat/with/${gb.username}`).set(auth(ga)).send({ kind: 'gif', gif }).expect(400);
    await api().post(`/api/v1/chat/with/${gb.username}`).set(auth(ga)).send({ kind: 'gif' }).expect(400); // sem GIF
    // Nos comentários, a mesma validação.
    const post = (await api().post('/api/v1/posts').set(auth(gb)).send({ body: 'post para GIFs' }).expect(201)).body.id as string;
    await api().post(`/api/v1/posts/${post}/comments`).set(auth(ga)).send({ gif: bad[0] }).expect(400);
    await api().post(`/api/v1/posts/${post}/comments`).set(auth(ga)).send({ gif: bad[1] }).expect(400);
    await api().post(`/api/v1/posts/${post}/comments`).set(auth(ga)).send({ body: '' }).expect(400); // nem texto nem GIF
  });

  it('a dois: enviar e ler um GIF (url limpo), "GIF" na lista e na notificação; apagar para todos limpa o GIF', async () => {
    const { ga, gb } = u;
    pushSpy.mockClear();
    const id = (await api().post(`/api/v1/chat/with/${gb.username}`).set(auth(ga)).send({ kind: 'gif', body: 'ignorado', gif: good() }).expect(201)).body.id as string;
    const want = { id: 'AbC123xyz', w: 200, h: 150, url: 'https://media2.giphy.com/media/v1.Y2lkPTc5/AbC123xyz/200w.webp', still: 'https://media2.giphy.com/media/AbC123xyz/200w_s.gif', title: 'Brinde da malta' };
    expect((await thread(gb, ga)).find((m) => m.id === id)).toMatchObject({ kind: 'gif', body: 'GIF', gif: want });
    expect((await thread(ga, gb)).find((m) => m.id === id)).toMatchObject({ kind: 'gif', gif: want });
    const convo = ((await api().get('/api/v1/chat/conversations').set(auth(gb)).expect(200)).body as { username: string; lastMessage: { kind: string; body: string } }[]).find((c) => c.username === ga.username)!;
    expect(convo.lastMessage).toMatchObject({ kind: 'gif', body: 'GIF' });
    expect(pushSpy).toHaveBeenCalledWith(gb.id, expect.objectContaining({ body: 'enviou-te um GIF' }));
    // As outras mensagens não trazem GIF.
    const txt = (await api().post(`/api/v1/chat/with/${gb.username}`).set(auth(ga)).send({ body: 'olá' }).expect(201)).body.id as string;
    expect((await thread(gb, ga)).find((m) => m.id === txt)).toMatchObject({ kind: 'text', gif: null });

    await api().delete(`/api/v1/chat/messages/${id}`).set(auth(ga)).expect(204);
    expect((await thread(gb, ga)).find((m) => m.id === id)).toMatchObject({ deleted: true, kind: 'text', gif: null });
    const row = (await pool.query('SELECT kind, body, gif FROM social.messages WHERE id = $1', [id])).rows[0];
    expect(row).toEqual({ kind: 'text', body: '', gif: null });
  });

  it('em grupo: enviar e ler um GIF, notificação "enviou um GIF"; apagar para todos limpa', async () => {
    const { ga, gb, gc } = u;
    const g = (await api().post('/api/v1/chat/groups').set(auth(ga)).send({ name: 'Malta dos GIFs', members: [gb.username, gc.username] }).expect(201)).body.id as string;
    pushSpy.mockClear();
    const id = (await api().post(`/api/v1/chat/groups/${g}/messages`).set(auth(gb)).send({ kind: 'gif', gif: good('Grp99zz') }).expect(201)).body.id as string;
    const items = (await api().get(`/api/v1/chat/groups/${g}`).set(auth(gc)).expect(200)).body.items as Item[];
    expect(items.find((m) => m.id === id)).toMatchObject({ kind: 'gif', body: 'GIF', gif: { id: 'Grp99zz', w: 200, h: 150, url: 'https://media2.giphy.com/media/v1.Y2lkPTc5/Grp99zz/200w.webp' } });
    expect(pushSpy).toHaveBeenCalledWith(gc.id, expect.objectContaining({ body: 'gb: enviou um GIF' }));
    const list = ((await api().get('/api/v1/chat/groups').set(auth(gc)).expect(200)).body as { id: string; lastMessage: { kind: string } }[]).find((x) => x.id === g)!;
    expect(list.lastMessage.kind).toBe('gif');
    await api().post(`/api/v1/chat/groups/${g}/messages`).set(auth(gb)).send({ kind: 'gif', gif: { ...good('Grp99zz'), url: 'https://cdn.example.com/media/Grp99zz/a.gif' } }).expect(400);

    await api().delete(`/api/v1/chat/messages/${id}`).set(auth(gb)).expect(204);
    const after = (await api().get(`/api/v1/chat/groups/${g}`).set(auth(ga)).expect(200)).body.items as Item[];
    expect(after.find((m) => m.id === id)).toMatchObject({ deleted: true, gif: null });
    expect((await pool.query('SELECT gif FROM social.messages WHERE id = $1', [id])).rows[0].gif).toBeNull();
  });

  it('comentários: GIF com ou sem texto; os outros comentários trazem gif null', async () => {
    const { ga, gb } = u;
    const post = (await api().post('/api/v1/posts').set(auth(gb)).send({ body: 'outro post' }).expect(201)).body.id as string;
    const only = (await api().post(`/api/v1/posts/${post}/comments`).set(auth(ga)).send({ gif: good('Cmt01ab') }).expect(201)).body;
    expect(only).toMatchObject({ body: '', gif: { id: 'Cmt01ab', url: 'https://media2.giphy.com/media/v1.Y2lkPTc5/Cmt01ab/200w.webp' } });
    const both = (await api().post(`/api/v1/posts/${post}/comments`).set(auth(ga)).send({ body: 'que brinde!', gif: good('Cmt02ab') }).expect(201)).body;
    expect(both).toMatchObject({ body: 'que brinde!', gif: { id: 'Cmt02ab' } });
    const plain = (await api().post(`/api/v1/posts/${post}/comments`).set(auth(ga)).send({ body: 'só texto' }).expect(201)).body;
    expect(plain.gif).toBeNull();
    const list = (await api().get(`/api/v1/posts/${post}/comments`).set(auth(gb)).expect(200)).body.items as { id: string; gif: Gif | null }[];
    expect(list.find((c) => c.id === only.id)?.gif?.id).toBe('Cmt01ab');
    // Editar o texto mantém o GIF.
    expect((await api().patch(`/api/v1/comments/${both.id}`).set(auth(ga)).send({ body: 'que brinde!!' }).expect(200)).body).toMatchObject({ body: 'que brinde!!', gif: { id: 'Cmt02ab' } });
  });
});
