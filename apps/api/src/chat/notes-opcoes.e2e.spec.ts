import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';

interface U { token: string; id: string; username: string }
interface Note { username: string; body: string; color: string | null; place: { name: string } | null; gif: Record<string, unknown> | null; audience: string }

const GIF = { id: 'Nota42gif', w: 200, h: 150, url: 'https://media2.giphy.com/media/Nota42gif/200w.gif?cid=abc&rid=200w.gif', title: '  Bora   txilar ' };
const GIF_SAVED = { id: 'Nota42gif', w: 200, h: 150, url: 'https://media2.giphy.com/media/Nota42gif/200w.gif', title: 'Bora txilar' };

/** As opções novas da nota (0178): a cor da bolha, o local, o GIF e o público só para amigos próximos. */
describe('Notas: cor, local, GIF e amigos próximos (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });

  async function signup(name: string, birthDate = '1990-06-15'): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: 'password-bem-longa-1', birthDate, acceptTerms: true }).expect(201);
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  const follow = (who: U, whom: U) => pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [who.id, whom.id]);
  const notes = async (x: U) => (await api().get('/api/v1/notes').set(auth(x)).expect(200)).body as { mine: Note | null; items: Note[] };
  const noteOf = async (viewer: U, author: U) => (await notes(viewer)).items.find((n) => n.username === author.username);
  const peerNote = async (viewer: U, author: U) => (await api().get(`/api/v1/chat/with/${author.username}`).set(auth(viewer)).expect(200)).body.peerNote;
  const lastFrom = async (owner: U, from: U) =>
    ((await api().get(`/api/v1/chat/with/${from.username}`).set(auth(owner)).expect(200)).body.items as { body: string; fromMe: boolean }[]).find((m) => !m.fromMe)?.body;

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'e'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('grava e lê a cor, o local (só o nome, a posição que a app mande sai) e o GIF, na lista, na minha nota, no cabeçalho da conversa e na exportação', async () => {
    const a = await signup('noa');
    const b = await signup('nob');
    await follow(b, a);
    await api()
      .put('/api/v1/notes/me')
      .set(auth(a))
      .send({ body: 'Bora txilar', color: 'ceu', place: { name: '  Ilha de Luanda ', lat: -8.79567, lng: 13.22345, coarse: true }, gif: GIF })
      .expect(204);

    const place = { name: 'Ilha de Luanda' };
    expect((await notes(a)).mine).toMatchObject({ body: 'Bora txilar', color: 'ceu', place, gif: GIF_SAVED, audience: 'mutual' });
    expect((await notes(a)).mine!.place).toEqual(place);
    // Na base de dados também só fica o nome.
    expect((await pool.query('SELECT place FROM social.notes WHERE user_id = $1', [a.id])).rows[0].place).toEqual(place);
    const seen = await noteOf(b, a);
    expect(seen).toMatchObject({ body: 'Bora txilar', color: 'ceu', place, gif: GIF_SAVED });
    expect(seen!.place).toEqual(place);
    expect(await peerNote(b, a)).toMatchObject({ body: 'Bora txilar', color: 'ceu', place, gif: GIF_SAVED, music: null });
    expect((await peerNote(b, a)).place).toEqual(place);

    // Sem as opções: cor, local e GIF vêm a null (a bolha branca de sempre).
    await api().put('/api/v1/notes/me').set(auth(b)).send({ body: 'Simples' }).expect(204);
    await follow(a, b);
    expect(await noteOf(a, b)).toMatchObject({ body: 'Simples', color: null, place: null, gif: null, audience: 'mutual' });

    // A exportação traz os campos novos.
    const ex = (await api().get('/api/v1/me/export').set(auth(a)).expect(200)).body as { notes: Record<string, unknown>[] };
    expect(ex.notes).toHaveLength(1);
    expect(ex.notes[0]).toMatchObject({ body: 'Bora txilar', color: 'ceu', place, gif: GIF_SAVED, audience: 'mutual' });
    expect(ex.notes[0].place).toEqual(place);
    expect(ex.notes[0]).toHaveProperty('expiresAt');
  });

  it('recusa cor fora da lista, GIF fora do GIPHY, local sem nome ou com nome longo e nota vazia', async () => {
    const e = await signup('noe');
    const put = (body: Record<string, unknown>) => api().put('/api/v1/notes/me').set(auth(e)).send(body);
    await put({ body: 'Olá', color: 'roxo' }).expect(400);
    await put({ body: 'Olá', gif: { ...GIF, url: 'https://evil.example.com/media/Nota42gif/200w.gif' } }).expect(400);
    await put({ body: 'Olá', place: { name: '   ' } }).expect(400);
    await put({ body: 'Olá', place: { name: 'x'.repeat(81) } }).expect(400);
    const empty = await put({ body: '', color: 'coral' }).expect(400);
    expect(JSON.stringify(empty.body)).toContain('Escreve algo ou escolhe uma música, um local ou um GIF');
    await put({ body: '   ', color: null, place: null, gif: null }).expect(400);
    expect((await notes(e)).mine).toBeNull();
  });

  it('aceita a nota só com GIF e só com local; a resposta diz «GIF» ou o nome do local; ninguém fica com posição', async () => {
    const g = await signup('nog');
    const h = await signup('noh');
    const r = await signup('nor');
    const m = await signup('nom', '2010-06-15');
    await follow(r, g);
    await follow(r, h);
    await follow(r, m);
    await api().put('/api/v1/notes/me').set(auth(g)).send({ gif: GIF }).expect(204);
    await api().put('/api/v1/notes/me').set(auth(h)).send({ body: '', place: { name: 'Marginal' } }).expect(204);
    await api().put('/api/v1/notes/me').set(auth(m)).send({ place: { name: 'Escola', lat: -8.8, lng: 13.2 } }).expect(204);

    const onlyGif = await noteOf(r, g);
    expect(onlyGif).toMatchObject({ body: '', gif: GIF_SAVED, place: null, color: null });
    const onlyPlace = await noteOf(r, h);
    expect(onlyPlace).toMatchObject({ body: '', gif: null, place: { name: 'Marginal' } });
    expect(Object.keys(onlyPlace!.place!)).toEqual(['name']);
    expect((await noteOf(r, m))!.place).toEqual({ name: 'Escola' });

    await api().post(`/api/v1/notes/${g.username}/reply`).set(auth(r)).send({ text: 'boa!' }).expect(201);
    expect(await lastFrom(g, r)).toBe('Em resposta à tua nota “GIF”: boa!');
    // A linha leva o GIF da nota, para a conversa o mostrar na citação (a nota sai ao fim de 24 h).
    const line = ((await api().get(`/api/v1/chat/with/${r.username}`).set(auth(g)).expect(200)).body.items as { body: string; fromMe: boolean; gif: { id: string } | null }[]).find((x) => !x.fromMe)!;
    expect(line.gif).toMatchObject({ id: GIF_SAVED.id });
    // A resposta a uma nota de local não leva GIF.
    await api().post(`/api/v1/notes/${h.username}/reply`).set(auth(r)).send({ text: 'vou lá' }).expect(201);
    expect(await lastFrom(h, r)).toBe('Em resposta à tua nota “Marginal”: vou lá');
    const placeLine = ((await api().get(`/api/v1/chat/with/${r.username}`).set(auth(h)).expect(200)).body.items as { fromMe: boolean; gif: unknown }[]).find((x) => !x.fromMe)!;
    expect(placeLine.gif).toBeNull();
  });

  it('close_friends: o amigo próximo vê, brinda e responde; o seguidor que não é amigo próximo não', async () => {
    const d = await signup('nod');
    const f = await signup('nof');
    const s = await signup('nos');
    await follow(f, d);
    await follow(s, d);
    await pool.query('INSERT INTO social.close_friends (owner_id, friend_id) VALUES ($1, $2)', [d.id, f.id]);
    await api().put('/api/v1/notes/me').set(auth(d)).send({ body: 'Só para os meus', audience: 'close_friends', color: 'noite' }).expect(204);

    // O próprio vê sempre a sua.
    expect((await notes(d)).mine).toMatchObject({ body: 'Só para os meus', audience: 'close_friends', color: 'noite' });

    // O amigo próximo: na lista, no cabeçalho, brinda e responde.
    expect(await noteOf(f, d)).toMatchObject({ body: 'Só para os meus', audience: 'close_friends' });
    expect(await peerNote(f, d)).toMatchObject({ body: 'Só para os meus', color: 'noite' });
    expect((await api().post(`/api/v1/notes/${d.username}/cheer`).set(auth(f)).expect(200)).body).toEqual({ cheered: true, cheers: 1 });
    await api().post(`/api/v1/notes/${d.username}/reply`).set(auth(f)).send({ text: 'conta comigo' }).expect(201);

    // O seguidor que não é amigo próximo: nada.
    expect(await noteOf(s, d)).toBeUndefined();
    expect(await peerNote(s, d)).toBeNull();
    await api().post(`/api/v1/notes/${d.username}/cheer`).set(auth(s)).expect(404);
    await api().post(`/api/v1/notes/${d.username}/reply`).set(auth(s)).send({ text: 'e eu?' }).expect(404);

    // Sair da lista tira o acesso.
    await pool.query('DELETE FROM social.close_friends WHERE owner_id = $1 AND friend_id = $2', [d.id, f.id]);
    expect(await noteOf(f, d)).toBeUndefined();
    await api().put('/api/v1/notes/me').set(auth(d)).send({ body: 'x', audience: 'todos' }).expect(400);
  });
});
