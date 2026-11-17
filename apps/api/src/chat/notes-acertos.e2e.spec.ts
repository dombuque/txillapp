import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { staffLogin } from '../staff/staff-test';
import { PushService } from '../push/push.service';
import { LicensedMusicService } from '../music/licensed-music.service';
import { NotesService } from './notes.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';

interface U { token: string; id: string; username: string }
interface Note { id: string; username: string; body: string; place: { name: string } | null; gif: Record<string, unknown> | null; cheers: number }

const gif = (id: string, rating?: string) => ({ id, w: 200, h: 150, url: `https://media2.giphy.com/media/${id}/200w.gif`, ...(rating ? { rating } : {}) });

/**
 * Os acertos das notas (0178): a limpeza 24 h depois de expirarem, a música retirada, os brindes na exportação, denunciar
 * uma nota e removê-la na fila, os GIFs acima de 'g' escondidos a menores, o local sem posição e o aviso de brinde só uma vez.
 */
describe('Notas: limpeza, música retirada, exportação, denúncia, GIF para menores, local e aviso de brinde (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  let n = 0;
  const api = () => request(app.getHttpServer());
  const auth = (x: { token: string }) => ({ Authorization: `Bearer ${x.token}` });

  async function signup(name: string, birthDate: string | null = '1990-06-15'): Promise<U> {
    const username = `${name}${run}${n++}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').set('X-Forwarded-For', `10.9.7.${(n % 250) + 1}`)
      .send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: 'password-bem-longa-1', birthDate: birthDate ?? '1990-06-15', acceptTerms: true }).expect(201);
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
    if (birthDate === null) await pool.query('UPDATE identity.users SET birth_date = NULL WHERE id = $1', [r.body.user.id]);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  const follow = (who: U, whom: U) => pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [who.id, whom.id]);
  const put = (x: U, body: Record<string, unknown>) => api().put('/api/v1/notes/me').set(auth(x)).send(body).expect(204);
  const notes = async (x: U) => (await api().get('/api/v1/notes').set(auth(x)).expect(200)).body as { mine: Note | null; items: Note[] };
  const noteOf = async (viewer: U, author: U) => (await notes(viewer)).items.find((z) => z.username === author.username);
  const cheer = (x: U, author: U) => api().post(`/api/v1/notes/${author.username}/cheer`).set(auth(x)).expect(200);
  const waitNotice = async (x: U, kind: string) => {
    for (let i = 0; i < 30; i++) {
      const l = ((await api().get('/api/v1/notifications').set(auth(x)).expect(200)).body.items as { kind: string; data: any }[]).filter((z) => z.kind === kind);
      if (l.length) return l;
      await new Promise((r) => setTimeout(r, 50));
    }
    return [];
  };

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'n'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('limpeza: apaga as notas expiradas há mais de 24 h, com os brindes e os avisos; as respostas ficam nas conversas', async () => {
    const old = await signup('nlo');
    const recent = await signup('nlr');
    const fan = await signup('nlf');
    await follow(fan, old);
    await follow(fan, recent);
    await put(old, { body: 'Velha' });
    await put(recent, { body: 'Ontem' });
    await cheer(fan, old);
    await api().post(`/api/v1/notes/${old.username}/reply`).set(auth(fan)).send({ text: 'boa!' }).expect(201);
    const oldId = (await pool.query('SELECT id FROM social.notes WHERE user_id = $1', [old.id])).rows[0].id as string;
    // Uma expirou há 25 horas (apaga-se); a outra há 1 hora (já não se vê, mas fica até às 24 h).
    await pool.query(`UPDATE social.notes SET created_at = now() - interval '49 hours', expires_at = now() - interval '25 hours' WHERE user_id = $1`, [old.id]);
    await pool.query(`UPDATE social.notes SET created_at = now() - interval '25 hours', expires_at = now() - interval '1 hour' WHERE user_id = $1`, [recent.id]);
    expect(await noteOf(fan, recent)).toBeUndefined();

    expect(await app.get(NotesService).purge()).toBeGreaterThanOrEqual(1);
    expect((await pool.query('SELECT 1 FROM social.notes WHERE user_id = $1', [old.id])).rowCount).toBe(0);
    expect((await pool.query('SELECT 1 FROM social.note_cheers WHERE note_user_id = $1', [old.id])).rowCount).toBe(0);
    expect((await pool.query('SELECT 1 FROM social.note_cheer_pings WHERE note_id = $1', [oldId])).rowCount).toBe(0);
    expect((await pool.query('SELECT 1 FROM social.notes WHERE user_id = $1', [recent.id])).rowCount).toBe(1);
    // A resposta é uma mensagem: continua na conversa.
    const thread = (await api().get(`/api/v1/chat/with/${fan.username}`).set(auth(old)).expect(200)).body.items as { body: string }[];
    expect(thread.some((m) => m.body === 'Em resposta à tua nota “Velha”: boa!')).toBe(true);
  });

  it('música retirada: a nota perde a música; só se apaga a que fica sem texto, sem GIF e sem local', async () => {
    const track = `nota-${run}`;
    const music = JSON.stringify({ kind: 'licensed', source: 'licensed', id: track, title: 'Faixa retirada' });
    const [onlyMusic, withGif, withPlace, withText] = [await signup('nmm'), await signup('nmg'), await signup('nmp'), await signup('nmt')];
    const ins = (u: U, body: string, g: unknown, place: unknown) =>
      pool.query('INSERT INTO social.notes (user_id, body, music, gif, place) VALUES ($1, $2, $3, $4, $5)', [u.id, body, music, g ? JSON.stringify(g) : null, place ? JSON.stringify(place) : null]);
    await ins(onlyMusic, '', null, null);
    await ins(withGif, '', gif('Retira1gif', 'g'), null);
    await ins(withPlace, '', null, { name: 'Marginal' });
    await ins(withText, 'Com texto', null, null);

    const out = await app.get(LicensedMusicService).takedown('licensed', track, 'Direitos', 'staff', null);
    expect(out.notes).toBe(4);
    const rows = async (u: U) => (await pool.query('SELECT body, music, gif, place FROM social.notes WHERE user_id = $1', [u.id])).rows;
    expect(await rows(onlyMusic)).toHaveLength(0);
    expect(await rows(withGif)).toEqual([expect.objectContaining({ music: null, gif: expect.objectContaining({ id: 'Retira1gif' }) })]);
    expect(await rows(withPlace)).toEqual([expect.objectContaining({ music: null, place: { name: 'Marginal' } })]);
    expect(await rows(withText)).toEqual([expect.objectContaining({ music: null, body: 'Com texto' })]);
  });

  it('exportação: os brindes que dei a notas (de quem e quando)', async () => {
    const owner = await signup('nxo');
    const me = await signup('nxm');
    await follow(me, owner);
    await put(owner, { body: 'Brinda-me' });
    await cheer(me, owner);
    const ex = (await api().get('/api/v1/me/export').set(auth(me)).expect(200)).body as { noteCheers: { noteOf: string; createdAt: string }[] };
    expect(ex.noteCheers).toEqual([{ noteOf: owner.username, createdAt: expect.any(String) }]);
  });

  it('denunciar uma nota: quem denuncia deixa de a ver; a fila mostra a cópia; «Remover» apaga-a e avisa o autor', async () => {
    const author = await signup('nda');
    const reporter = await signup('ndr');
    const other = await signup('ndo');
    const stranger = await signup('nds');
    await follow(reporter, author);
    await follow(other, author);
    await put(author, { body: 'Nota feia', place: { name: 'Mutamba' }, gif: gif('Denuncia1', 'pg') });
    const noteId = (await noteOf(reporter, author))!.id;

    // O próprio não se denuncia; quem não a vê recebe 404; motivos fora da lista, 400.
    await api().post(`/api/v1/notes/${author.username}/report`).set(auth(author)).send({ reason: 'spam' }).expect(400);
    await api().post(`/api/v1/notes/${author.username}/report`).set(auth(stranger)).send({ reason: 'spam' }).expect(404);
    await api().post(`/api/v1/notes/${author.username}/report`).set(auth(reporter)).send({ reason: 'nada' }).expect(400);
    await api().post(`/api/v1/notes/${author.username}/report`).set(auth(reporter)).send({ reason: 'harassment', note: 'ofende' }).expect(204);

    expect(await noteOf(reporter, author)).toBeUndefined();
    expect((await api().get(`/api/v1/chat/with/${author.username}`).set(auth(reporter)).expect(200)).body.peerNote).toBeNull();
    await api().post(`/api/v1/notes/${author.username}/cheer`).set(auth(reporter)).expect(404);
    expect(await noteOf(other, author)).toMatchObject({ body: 'Nota feia' });

    const mod = await staffLogin(app, `ndm${n++}`, ['moderacao']);
    const queue = async (status = 'open') => ((await api().get('/api/v1/admin/mod/queue').query({ type: 'note', status }).set(auth(mod)).expect(200)).body.items as any[]).find((i) => i.id === noteId);
    const item = await queue();
    expect(item).toMatchObject({
      type: 'note', reports: 1, reasons: ['harassment'], removed: null, preview: 'Nota feia',
      owner: { username: author.username },
      note: { body: 'Nota feia', placeName: 'Mutamba', gifUrl: 'https://media2.giphy.com/media/Denuncia1/200w.gif', gifRating: 'pg', musicTitle: null, audience: 'mutual' },
    });
    expect(item.note).not.toHaveProperty('lat');

    await api().post('/api/v1/admin/mod/queue/decide').set(auth(mod)).send({ items: [{ type: 'note', id: noteId }], action: 'remove', note: 'assédio' }).expect(200);
    expect((await pool.query('SELECT 1 FROM social.notes WHERE id = $1', [noteId])).rowCount).toBe(0);
    expect(await noteOf(other, author)).toBeUndefined();
    const notices = await waitNotice(author, 'content_removed');
    expect(notices.some((x) => x.data.type === 'note' && x.data.reason === 'assédio')).toBe(true);
    // Na fila das decididas, a cópia continua e diz que foi a moderação.
    expect(await queue('actioned')).toMatchObject({ removed: 'moderation', note: { body: 'Nota feia' } });
  });

  it('GIF acima de «g»: menores (e quem não tem data de nascimento) recebem a nota sem o GIF; só GIF, não a recebem', async () => {
    const adultA = await signup('nga');
    const onlyGifA = await signup('ngo');
    const gOk = await signup('ngg');
    const minor = await signup('ngm', '2011-03-01');
    const noBirth = await signup('ngn', null);
    const adult = await signup('ngx');
    for (const v of [minor, noBirth, adult]) for (const a of [adultA, onlyGifA, gOk]) await follow(v, a);
    await put(adultA, { body: 'Com GIF forte', gif: gif('Forte13gif', 'pg-13') });
    await put(onlyGifA, { gif: gif('SoGif13gif', 'r') });
    await put(gOk, { body: 'GIF leve', gif: gif('LeveGgif', 'g') });

    expect(await noteOf(adult, adultA)).toMatchObject({ gif: expect.objectContaining({ id: 'Forte13gif', rating: 'pg-13' }) });
    expect(await noteOf(adult, onlyGifA)).toMatchObject({ gif: expect.objectContaining({ id: 'SoGif13gif' }) });
    for (const v of [minor, noBirth]) {
      expect(await noteOf(v, adultA)).toMatchObject({ body: 'Com GIF forte', gif: null });
      expect(await noteOf(v, onlyGifA)).toBeUndefined();
      expect(await noteOf(v, gOk)).toMatchObject({ gif: expect.objectContaining({ id: 'LeveGgif', rating: 'g' }) });
      expect((await api().get(`/api/v1/chat/with/${adultA.username}`).set(auth(v)).expect(200)).body.peerNote).toMatchObject({ gif: null });
    }

    // Sem classificação: de um adulto conta como desconhecida (não vai a menores); de um menor fica 'g'.
    const adultNoRating = await signup('ngr');
    const minorAuthor = await signup('ngk', '2010-01-01');
    await follow(minor, adultNoRating);
    await follow(minor, minorAuthor);
    await put(adultNoRating, { body: 'Sem rating', gif: gif('SemRating1') });
    await put(minorAuthor, { body: 'Do menor', gif: gif('DoMenor1') });
    expect(await noteOf(minor, adultNoRating)).toMatchObject({ gif: null });
    expect(await noteOf(minor, minorAuthor)).toMatchObject({ gif: expect.objectContaining({ id: 'DoMenor1', rating: 'g' }) });
  });

  it('local: só o nome; a base de dados recusa coordenadas', async () => {
    const a = await signup('npa');
    await put(a, { place: { name: 'Baía de Luanda', lat: -8.8, lng: 13.2, coarse: true } });
    expect((await pool.query('SELECT place FROM social.notes WHERE user_id = $1', [a.id])).rows[0].place).toEqual({ name: 'Baía de Luanda' });
    expect((await notes(a)).mine!.place).toEqual({ name: 'Baía de Luanda' });
    const b = await signup('npb');
    await expect(pool.query(`INSERT INTO social.notes (user_id, body, place) VALUES ($1, 'x', '{"name":"Sítio","lat":1,"lng":2}')`, [b.id])).rejects.toThrow(/notes_place_check/);
  });

  it('aviso de brinde: só o primeiro de cada pessoa a cada nota (tirar e voltar a pôr não volta a avisar)', async () => {
    const owner = await signup('nbo');
    const fan = await signup('nbf');
    await follow(fan, owner);
    await put(owner, { body: 'Brindem' });
    const push = app.get(PushService);
    const spy = jest.spyOn(push, 'send').mockResolvedValue(0);
    try {
      const pings = () => spy.mock.calls.filter(([to, p]) => to === owner.id && p.body === 'brindou a tua nota').length;
      expect((await cheer(fan, owner)).body).toEqual({ cheered: true, cheers: 1 });
      expect((await cheer(fan, owner)).body).toEqual({ cheered: false, cheers: 0 });
      expect((await cheer(fan, owner)).body).toEqual({ cheered: true, cheers: 1 });
      expect(pings()).toBe(1);
      // Uma nota nova volta a avisar do primeiro brinde.
      await api().delete('/api/v1/notes/me').set(auth(owner)).expect(204);
      await put(owner, { body: 'Outra' });
      await cheer(fan, owner);
      expect(pings()).toBe(2);
    } finally {
      spy.mockRestore();
    }
  });
});
