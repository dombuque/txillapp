import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { uuidv7 } from '../common/uuid7';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { ModerationService } from '../moderation/moderation.service';
import { RealtimeBus } from '../realtime/realtime-bus';
import { mixarDay } from './mixar-pick';
import { MixarSocialService, MORE_ITEMS, MORE_PER_DAY, type MixarLiveEvent } from './mixar-social.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';

interface U { token: string; id: string; username: string; ip: string }

/**
 * Mixar, social e guardados (0171, docs/mixar-contrato.md, «Social e guardados»), de ponta a ponta: a conversa de cada item
 * (só os dois a veem, o filtro de texto, apagar só o meu, denunciar e a moderação, o tempo real), os contadores do carril, os
 * Guardados (à mão, sozinhos quando os dois reagem sem «nah», tirar, sem o que foi ocultado ou removido, paginados), o «Mais
 * 5» (sem repetir, no máximo 3 vezes por dia, o desafio não muda), o «ver juntos» (presença curta) e a exportação.
 * Um terceiro (o Rui, que tem o seu próprio Mixar) nunca vê nada disto.
 *
 * Os temas (ciencia, historia) não são usados por mais nenhum teste; no fim as publicações deste teste saem, para não
 * entrarem nas seleções dos outros.
 */
describe('Mixar: social e guardados (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  let social: MixarSocialService;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}`, 'X-Forwarded-For': x.ip });
  const u: Record<string, U> = {};
  const published: { to: string; e: MixarLiveEvent }[] = [];
  const posts: string[] = [];
  let n = 0;
  let mx = ''; // Dom + Ana
  let other = ''; // Rui + Eva
  let items: string[] = [];

  async function signup(name: string, display?: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    n++;
    const ip = `10.171.${n >> 8}.${n & 255}`;
    const r = await api().post('/api/v1/auth/register').set('X-Forwarded-For', ip)
      .send({ email: `${username}@example.com`, username, displayName: display ?? `${name[0].toUpperCase()}${name.slice(1)} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
    return { token: r.body.accessToken, id: r.body.user.id, username, ip };
  }
  const follow = (a: U, b: U) => api().post(`/api/v1/users/${b.username}/follow`).set(auth(a)).expect(200);
  const mutual = async (a: U, b: U) => { await follow(a, b); await follow(b, a); };
  const prefs = (x: U, topics: string[]) => Promise.all(topics.map((t) => pool.query('INSERT INTO social.explore_prefs (user_id, topic, pref) VALUES ($1, $2, 1) ON CONFLICT DO NOTHING', [x.id, t])));
  const live = (x: U, what: string) => published.filter((p) => p.to === x.id && p.e.type === 'mixar.live' && p.e.id === mx && p.e.what === what).map((p) => p.e);
  const feedIds = async (x: U, id = mx) => {
    const out: string[] = [];
    let cursor: string | null = null;
    do {
      const r: { items: { post: { id: string } }[]; nextCursor: string | null } = (await api().get(`/api/v1/mixar/${id}/feed?limit=24${cursor ? `&cursor=${cursor}` : ''}`).set(auth(x)).expect(200)).body;
      out.push(...r.items.map((i) => i.post.id));
      cursor = r.nextCursor;
    } while (cursor);
    return out;
  };
  const comments = (x: U, postId: string, q = '', id = mx) => api().get(`/api/v1/mixar/${id}/items/${postId}/comments${q}`).set(auth(x));
  const say = (x: U, postId: string, body: string, id = mx) => api().post(`/api/v1/mixar/${id}/items/${postId}/comments`).set(auth(x)).send({ body });
  const saved = async (x: U, q = '') => (await api().get(`/api/v1/mixar/${mx}/saved${q}`).set(auth(x)).expect(200)).body as { items: { post: { id: string }; savedBy: string; savedAt: string; mine: string | null; theirs: string | null }[]; nextCursor: string | null };
  const react = (x: U, postId: string, reaction: string | null) => api().post(`/api/v1/mixar/${mx}/items/${postId}/react`).set(auth(x)).send({ reaction }).expect(200);

  /** Uma tcheka (um só vídeo) com estes temas, publicada há `hours` horas. */
  async function tcheka(author: U, topics: string[], hours = 2) {
    const media = (await pool.query(`INSERT INTO content.media_assets (id, owner_id, mime, size_bytes, storage_key, status, duration_ms, width, height) VALUES (gen_random_uuid(), $1, 'video/mp4', 1, 'x', 'ready', 5000, 720, 1280) RETURNING id`, [author.id])).rows[0].id as string;
    const id = uuidv7(Date.now() - hours * 3_600_000);
    await pool.query(`INSERT INTO content.posts (id, author_id, body, topics, created_at) VALUES ($1, $2, $3, $4, now() - make_interval(hours => $5))`, [id, author.id, `tcheka ${topics.join(' ')}`, topics, hours]);
    await pool.query('INSERT INTO content.post_media (post_id, media_id, position) VALUES ($1, $2, 0)', [id, media]);
    posts.push(id);
    return id;
  }

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 's'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    social = app.get(MixarSocialService);
    const bus = app.get(RealtimeBus);
    const publish = bus.publish.bind(bus);
    jest.spyOn(bus, 'publish').mockImplementation((to: string, e: unknown) => {
      published.push({ to, e: e as MixarLiveEvent });
      publish(to, e);
    });

    u.dom = await signup('sdom', 'Dom Teste');
    u.ana = await signup('sana', 'Ana Teste');
    u.rui = await signup('srui', 'Rui Teste');
    u.eva = await signup('seva', 'Eva Teste');
    // A Ana tem o selo: os comentários e a presença levam-no.
    await pool.query(`UPDATE identity.users SET verified = true, verified_tier = 'verified' WHERE id = $1`, [u.ana.id]);
    await mutual(u.dom, u.ana);
    await mutual(u.rui, u.eva);
    await prefs(u.dom, ['ciencia', 'historia']);
    await prefs(u.ana, ['ciencia', 'historia']);
    await pool.query(`UPDATE content.posts SET removed_at = now(), removed_by = 'author' WHERE topics && ARRAY['ciencia', 'historia'] AND removed_at IS NULL`);
    // 24 autores com 2 tchekas cada: chega para a seleção do dia (24) e para os três «Mais 5».
    for (let i = 0; i < 24; i++) {
      const a = await signup(`sa${i}x`);
      for (let k = 0; k < 2; k++) await tcheka(a, [i % 2 ? 'ciencia' : 'historia'], 1 + i + k);
    }

    mx = (await api().post('/api/v1/mixar/invite').set(auth(u.dom)).send({ username: u.ana.username }).expect(201)).body.id;
    await api().post(`/api/v1/mixar/${mx}/accept`).set(auth(u.ana)).expect(200);
    other = (await api().post('/api/v1/mixar/invite').set(auth(u.rui)).send({ username: u.eva.username }).expect(201)).body.id;
    await api().post(`/api/v1/mixar/${other}/accept`).set(auth(u.eva)).expect(200);
    items = await feedIds(u.dom);
  }, 240_000);

  afterAll(async () => {
    if (posts.length) await pool.query(`UPDATE content.posts SET removed_at = now(), removed_by = 'author' WHERE id = ANY($1::uuid[]) AND removed_at IS NULL`, [posts]);
    await app.close();
    await pool.end();
    jest.restoreAllMocks();
  });

  it('a seleção do dia tem itens para o resto dos testes', () => {
    expect(items.length).toBeGreaterThanOrEqual(10);
  });

  it('comentários: só os dois veem a conversa do item; o selo vai no autor; o outro recebe o evento logo', async () => {
    const { dom, ana, rui } = u;
    const [p] = items;
    const c = (await say(ana, p, '  Isto é muito bom  ').expect(201)).body;
    expect(c).toMatchObject({ body: 'Isto é muito bom', mine: true, author: { username: ana.username, displayName: 'Ana Teste', hasAvatar: false, verified: true, verifiedTier: 'verified' } });
    expect(live(dom, 'comment')).toContainEqual({ type: 'mixar.live', id: mx, what: 'comment', postId: p });
    expect(live(ana, 'comment')).toContainEqual({ type: 'mixar.live', id: mx, what: 'comment', postId: p, self: true });
    await say(dom, p, 'Pois é').expect(201);

    const seen = (await comments(dom, p).expect(200)).body;
    expect(seen.items.map((x: { body: string; mine: boolean }) => [x.body, x.mine])).toEqual([['Isto é muito bom', false], ['Pois é', true]]);
    expect(seen.nextCursor).toBeNull();

    // Um terceiro: nem no Mixar deles, nem com o item noutro Mixar.
    await comments(rui, p).expect(404);
    await say(rui, p, 'Olá').expect(404);
    // No Mixar dele (o mesmo vídeo pode estar nos dois Mixar): a conversa é outra, vazia.
    const own = await comments(rui, p, '', other);
    if (own.status === 200) expect(own.body.items).toEqual([]);
    else expect(own.status).toBe(404);
    // Uma publicação que não está no Mixar.
    await comments(dom, uuidv7()).expect(404);
  });

  it('comentários: texto vazio, com mais de 500 caracteres ou abusivo não passa; paginação das mais antigas', async () => {
    const { dom, ana } = u;
    const p = items[1];
    await say(dom, p, '   ').expect(400);
    await say(dom, p, 'x'.repeat(501)).expect(400);
    await say(dom, p, 'x'.repeat(500)).expect(201);
    await say(dom, p, 'vou te matar').expect(422);
    await say(ana, p, 'um').expect(201);
    await say(ana, p, 'dois').expect(201);
    const first = (await comments(dom, p, '?limit=2').expect(200)).body;
    expect(first.items.map((x: { body: string }) => x.body)).toEqual(['um', 'dois']);
    expect(first.nextCursor).toEqual(expect.any(String));
    const older = (await comments(dom, p, `?limit=2&cursor=${first.nextCursor}`).expect(200)).body;
    expect(older.items.map((x: { body: string }) => x.body)).toEqual(['x'.repeat(500)]);
    expect(older.nextCursor).toBeNull();
    await comments(dom, p, '?cursor=abc').expect(400);
  });

  it('apagar: só o meu; deixa de se ver para os dois e o outro recebe o evento', async () => {
    const { dom, ana, rui } = u;
    const p = items[2];
    const mine = (await say(dom, p, 'vou apagar').expect(201)).body.id as string;
    await api().delete(`/api/v1/mixar/${mx}/comments/${mine}`).set(auth(ana)).expect(404);
    await api().delete(`/api/v1/mixar/${mx}/comments/${mine}`).set(auth(rui)).expect(404);
    const before = live(ana, 'comment').length;
    await api().delete(`/api/v1/mixar/${mx}/comments/${mine}`).set(auth(dom)).expect(200, { ok: true });
    expect(live(ana, 'comment').length).toBe(before + 1);
    expect((await comments(ana, p).expect(200)).body.items).toEqual([]);
    await api().delete(`/api/v1/mixar/${mx}/comments/${mine}`).set(auth(dom)).expect(404);
  });

  it('denunciar: quem denuncia deixa de ver; um terceiro não consegue; a moderação apaga para os dois', async () => {
    const { dom, ana, rui } = u;
    const p = items[3];
    const c = (await say(dom, p, 'comentário denunciado').expect(201)).body.id as string;
    await api().post('/api/v1/reports').set(auth(rui)).send({ type: 'mixar_comment', id: c, reason: 'harassment' }).expect(404);
    await api().post('/api/v1/reports').set(auth(dom)).send({ type: 'mixar_comment', id: c, reason: 'harassment' }).expect(400);
    await api().post('/api/v1/reports').set(auth(ana)).send({ type: 'mixar_comment', id: c, reason: 'harassment' }).expect(204);
    expect((await comments(ana, p).expect(200)).body.items).toEqual([]);
    expect((await comments(dom, p).expect(200)).body.items.map((x: { id: string }) => x.id)).toEqual([c]);

    const queue = await app.get(ModerationService).queue();
    expect(queue.find((q) => q.type === 'mixar_comment' && q.id === c)).toMatchObject({ preview: 'comentário denunciado', owner: { username: dom.username } });
    await app.get(ModerationService).resolve(ana.id, 'mixar_comment', c, 'remove');
    expect((await comments(dom, p).expect(200)).body.items).toEqual([]);
  });

  it('o carril: quantos comentários e se está nos Guardados, só para os dois', async () => {
    const { dom, rui } = u;
    const r = (await api().get(`/api/v1/mixar/${mx}/social?posts=${items.slice(0, 3).join(',')},nada`).set(auth(dom)).expect(200)).body;
    expect(r.items).toEqual([
      { postId: items[0], comments: 2, saved: false },
      { postId: items[1], comments: 3, saved: false },
      { postId: items[2], comments: 0, saved: false },
    ]);
    await api().get(`/api/v1/mixar/${mx}/social?posts=${items[0]}`).set(auth(rui)).expect(404);
  });

  it('guardados: à mão (com o evento), sozinhos quando os dois reagem sem «nah», e tirar', async () => {
    const { dom, ana, rui } = u;
    const [a, b, c, d] = items.slice(4, 8);
    await api().post(`/api/v1/mixar/${mx}/saved/${a}`).set(auth(dom)).expect(200, { saved: true });
    expect(live(ana, 'saved')).toContainEqual({ type: 'mixar.live', id: mx, what: 'saved', postId: a, saved: true });
    // Os dois reagem: amor + fogo entra sozinho; amor + nah não.
    await react(dom, b, 'amor');
    expect((await saved(ana)).items.map((x) => x.post.id)).not.toContain(b);
    await react(ana, b, 'fogo');
    await react(dom, c, 'amor');
    await react(ana, c, 'nah');
    // Só um reagiu: não entra.
    await react(dom, d, 'kkk');

    const mine = await saved(dom);
    expect(mine.items.map((x) => [x.post.id, x.savedBy])).toEqual([[b, 'both'], [a, 'me']]);
    expect(mine.items[0]).toMatchObject({ mine: 'amor', theirs: 'fogo' });
    expect((await saved(ana)).items.map((x) => [x.post.id, x.savedBy])).toEqual([[b, 'both'], [a, 'them']]);
    // O terceiro não vê os Guardados nem guarda.
    await api().get(`/api/v1/mixar/${mx}/saved`).set(auth(rui)).expect(404);
    await api().post(`/api/v1/mixar/${mx}/saved/${a}`).set(auth(rui)).expect(404);
    // Uma publicação fora do Mixar não se guarda.
    await api().post(`/api/v1/mixar/${mx}/saved/${uuidv7()}`).set(auth(dom)).expect(404);

    // Tirar (qualquer um dos dois): sai e não volta sozinho ao mudar a reação; à mão volta.
    await api().delete(`/api/v1/mixar/${mx}/saved/${b}`).set(auth(ana)).expect(200, { saved: false });
    expect(live(dom, 'saved')).toContainEqual({ type: 'mixar.live', id: mx, what: 'saved', postId: b, saved: false });
    await react(dom, b, 'uau');
    expect((await saved(dom)).items.map((x) => x.post.id)).toEqual([a]);
    await api().post(`/api/v1/mixar/${mx}/saved/${b}`).set(auth(dom)).expect(200);
    expect((await saved(ana)).items.map((x) => [x.post.id, x.savedBy])).toEqual([[b, 'them'], [a, 'them']]);
    const s = (await api().get(`/api/v1/mixar/${mx}/social?posts=${a},${c}`).set(auth(ana)).expect(200)).body.items;
    expect(s).toEqual([{ postId: a, comments: 0, saved: true }, { postId: c, comments: 0, saved: false }]);
  });

  it('guardados: paginados, e sem o que o autor ocultou ou a moderação removeu', async () => {
    const { dom } = u;
    const e = items[8];
    await api().post(`/api/v1/mixar/${mx}/saved/${e}`).set(auth(dom)).expect(200);
    const all = (await saved(dom)).items.map((x) => x.post.id);
    expect(all).toHaveLength(3);
    const p1 = await saved(dom, '?limit=2');
    expect(p1.items).toHaveLength(2);
    expect(p1.nextCursor).toEqual(expect.any(String));
    const p2 = await saved(dom, `?limit=2&cursor=${encodeURIComponent(p1.nextCursor!)}`);
    expect([...p1.items, ...p2.items].map((x) => x.post.id)).toEqual(all);
    expect(p2.nextCursor).toBeNull();
    await api().get(`/api/v1/mixar/${mx}/saved?cursor=mau`).set(auth(dom)).expect(400);

    await pool.query('UPDATE content.posts SET hidden_at = now() WHERE id = $1', [e]);
    expect((await saved(dom)).items.map((x) => x.post.id)).not.toContain(e);
    await pool.query('UPDATE content.posts SET hidden_at = NULL WHERE id = $1', [e]);
    await pool.query(`UPDATE content.posts SET removed_at = now(), removed_by = 'moderation' WHERE id = $1`, [e]);
    expect((await saved(dom)).items.map((x) => x.post.id)).not.toContain(e);
    await pool.query('UPDATE content.posts SET removed_at = NULL, removed_by = NULL WHERE id = $1', [e]);
    expect((await saved(dom)).items.map((x) => x.post.id)).toContain(e);
  });

  it('«Mais 5»: acrescenta até 5 itens novos ao dia, sem repetir, no máximo 3 vezes (429 depois); o desafio não muda', async () => {
    const { dom, ana, rui } = u;
    const ch = (await api().get(`/api/v1/mixar/${mx}/challenge`).set(auth(dom)).expect(200)).body;
    expect((await api().get(`/api/v1/mixar/${mx}/more`).set(auth(dom)).expect(200)).body).toEqual({ left: MORE_PER_DAY });
    await api().post(`/api/v1/mixar/${mx}/more`).set(auth(rui)).expect(404);
    let before = await feedIds(dom);
    for (let round = 1; round <= MORE_PER_DAY; round++) {
      const r = (await api().post(`/api/v1/mixar/${mx}/more`).set(auth(round % 2 ? dom : ana)).expect(200)).body;
      expect(r.added).toBeGreaterThan(0);
      expect(r.added).toBeLessThanOrEqual(MORE_ITEMS);
      expect(r.left).toBe(MORE_PER_DAY - round);
      const after = await feedIds(ana);
      // Os de antes ficam no mesmo sítio e os novos vão para o fim, sem repetidos.
      expect(after.slice(0, before.length)).toEqual(before);
      expect(after).toHaveLength(before.length + r.added);
      expect(new Set(after).size).toBe(after.length);
      before = after;
    }
    expect(live(ana, 'more').length + live(dom, 'more').length).toBeGreaterThanOrEqual(MORE_PER_DAY);
    const no = await api().post(`/api/v1/mixar/${mx}/more`).set(auth(dom)).expect(429);
    expect(no.body.message).toBe('Já pediram mais 3 vezes hoje. Amanhã às 05:00 há uma seleção nova');
    expect((await api().get(`/api/v1/mixar/${mx}/more`).set(auth(ana)).expect(200)).body).toEqual({ left: 0 });
    const day = (await pool.query('SELECT items, more_rounds FROM social.mixar_days WHERE mixar_id = $1 AND day = $2::date', [mx, mixarDay()])).rows[0];
    expect(day).toMatchObject({ items: before.length, more_rounds: 3 });
    // O desafio do dia é o mesmo.
    const ch2 = (await api().get(`/api/v1/mixar/${mx}/challenge`).set(auth(dom)).expect(200)).body;
    expect(ch2 && { id: ch2.id, options: ch2.options.map((o: { id: string }) => o.id) }).toEqual(ch && { id: ch.id, options: ch.options.map((o: { id: string }) => o.id) });
  });

  it('ver juntos: a presença vai para o outro quando chego, mudo de item ou saio (não a cada repetição); um terceiro não entra', async () => {
    const { dom, ana, rui } = u;
    const [p, q] = items;
    const pres = (x: U, b: object) => api().post(`/api/v1/mixar/${mx}/presence`).set(auth(x)).send(b).expect(200);
    const toAna = () => live(ana, 'presence');
    expect((await pres(dom, { postId: p })).body).toEqual({ partner: { here: false, postId: null } });
    expect(toAna()).toEqual([{ type: 'mixar.live', id: mx, what: 'presence', here: true, postId: p }]);
    expect((await pres(ana, { postId: p })).body).toEqual({ partner: { here: true, postId: p } });
    expect(live(dom, 'presence')).toEqual([{ type: 'mixar.live', id: mx, what: 'presence', here: true, postId: p }]);
    // O batimento com o mesmo item não manda nada; mudar de item manda.
    await pres(dom, { postId: p });
    expect(toAna()).toHaveLength(1);
    await pres(dom, { postId: q });
    expect(toAna()[1]).toEqual({ type: 'mixar.live', id: mx, what: 'presence', here: true, postId: q });
    expect((await pres(ana, { postId: p })).body).toEqual({ partner: { here: true, postId: q } });
    // Um item que não é do Mixar conta como «no Mixar, sem item».
    await pres(dom, { postId: uuidv7() });
    expect(toAna()[2]).toEqual({ type: 'mixar.live', id: mx, what: 'presence', here: true, postId: null });
    // Sair.
    await pres(dom, { leave: true });
    expect(toAna()[3]).toEqual({ type: 'mixar.live', id: mx, what: 'presence', here: false, postId: null });
    expect((await pres(ana, { postId: p })).body).toEqual({ partner: { here: false, postId: null } });
    // O terceiro.
    await api().post(`/api/v1/mixar/${mx}/presence`).set(auth(rui)).send({ postId: p }).expect(404);
    await api().post(`/api/v1/mixar/${mx}/presence`).set(auth(dom)).send({ postId: 'x' }).expect(400);
  });

  it('a exportação traz os meus comentários (não os do outro) e o que guardei à mão', async () => {
    const { dom, ana } = u;
    const r = (await api().get('/api/v1/me/export').set(auth(dom)).expect(200)).body;
    expect(r.mixarComments).toEqual(expect.arrayContaining([expect.objectContaining({ mixarId: mx, postId: items[0], body: 'Pois é' })]));
    expect(JSON.stringify(r.mixarComments)).not.toContain('Isto é muito bom');
    expect(JSON.stringify(r.mixarComments)).not.toContain('vou apagar');
    expect(r.mixarSaves.map((s: { postId: string }) => s.postId)).toEqual(expect.arrayContaining([items[4], items[5]]));
    const a = (await api().get('/api/v1/me/export').set(auth(ana)).expect(200)).body;
    expect(a.mixarSaves).toEqual([]);
  });

  it('limpeza: os comentários apagados há mais de 30 dias saem de vez (os denunciados por decidir ficam); sair do Mixar fecha tudo', async () => {
    const { dom, ana } = u;
    const keep = (await say(dom, items[9], 'denunciado e apagado').expect(201)).body.id as string;
    await api().post('/api/v1/reports').set(auth(ana)).send({ type: 'mixar_comment', id: keep, reason: 'spam' }).expect(204);
    await api().delete(`/api/v1/mixar/${mx}/comments/${keep}`).set(auth(dom)).expect(200);
    const count = async () => (await pool.query('SELECT count(*)::int AS n FROM social.mixar_comments WHERE mixar_id = $1 AND deleted_at IS NOT NULL', [mx])).rows[0].n as number;
    const before = await count();
    expect(before).toBeGreaterThanOrEqual(3);
    await social.purge();
    expect(await count()).toBe(before);
    await social.purge(new Date(Date.now() + 31 * 86_400_000));
    expect(await count()).toBe(1);

    await api().delete(`/api/v1/mixar/${mx}`).set(auth(ana)).expect(200);
    await comments(dom, items[0]).expect(404);
    await api().get(`/api/v1/mixar/${mx}/saved`).set(auth(dom)).expect(404);
    await api().post(`/api/v1/mixar/${mx}/more`).set(auth(dom)).expect(404);
    await api().post(`/api/v1/mixar/${mx}/presence`).set(auth(dom)).send({ postId: items[0] }).expect(404);
  });
});
