import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { uuidv7 } from '../common/uuid7';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { RealtimeBus } from '../realtime/realtime-bus';
import type { MixarLiveEvent } from './mixar-social.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';

interface U { token: string; id: string; username: string; ip: string }

/**
 * Privacidade do Mixar e os pendentes (0179, docs/mixar-contrato.md «Privacidade (0179)»), de ponta a ponta:
 *  1. as três escolhas na conta: «Mostrar que estou a ver contigo» (a presença não se anuncia), «Aparecer nas sugestões de
 *     Mixar» (não apareço no «Faz um Mixar com…» dos outros) e «Deixar que o resumo da semana me inclua» (o outro não
 *     partilha nem descarrega o cartão), por omissão ligadas e na exportação;
 *  2. eliminar a conta tira o id da pessoa de `mixar_items.fans`, de quem propôs e de quem terminou;
 *  3. os comentários de quem saiu do Mixar do grupo continuam com o nome; uma conta que já não está ativa aparece como
 *     «Conta eliminada»; eliminar a conta leva os comentários;
 *  4. os Mixar de grupo não contam para os 20 Mixar a dois (o grupo tem o seu limite: um aberto de cada vez).
 *
 * Os temas (malabares, capoeira, patinagem) não são usados por mais nenhum teste; no fim as publicações deste teste saem.
 */
describe('Mixar, privacidade e pendentes (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}`, 'X-Forwarded-For': x.ip });
  const posts: string[] = [];
  const published: { to: string; e: MixarLiveEvent }[] = [];
  let n = 0;

  async function signup(name: string, display?: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    n++;
    const ip = `10.179.${n >> 8}.${n & 255}`;
    const r = await api().post('/api/v1/auth/register').set('X-Forwarded-For', ip)
      .send({ email: `${username}@example.com`, username, displayName: display ?? `${name[0].toUpperCase()}${name.slice(1)} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
    return { token: r.body.accessToken, id: r.body.user.id, username, ip };
  }
  const follow = (a: U, b: U) => api().post(`/api/v1/users/${b.username}/follow`).set(auth(a)).expect(200);
  const mutual = async (a: U, b: U) => { await follow(a, b); await follow(b, a); };
  const prefs = (x: U, topics: string[]) => Promise.all(topics.map((t) => pool.query('INSERT INTO social.explore_prefs (user_id, topic, pref) VALUES ($1, $2, 1) ON CONFLICT DO NOTHING', [x.id, t])));
  const setPrivacy = (x: U, b: object) => api().patch('/api/v1/settings/privacy').set(auth(x)).send(b).expect(200);
  const live = (x: U, mx: string, what: string) => published.filter((p) => p.to === x.id && p.e.type === 'mixar.live' && p.e.id === mx && p.e.what === what).map((p) => p.e);

  /** Um Mixar a dois ativo (convite pela API e aceite). */
  async function pair(a: U, b: U): Promise<string> {
    await mutual(a, b);
    const id = (await api().post('/api/v1/mixar/invite').set(auth(a)).send({ username: b.username }).expect(201)).body.id as string;
    await api().post(`/api/v1/mixar/${id}/accept`).set(auth(b)).expect(200);
    return id;
  }
  /** Mensagens trocadas entre os dois (para as sugestões), `fromA` delas escritas por `a`. */
  async function talk(a: U, b: U, count: number, fromA: number) {
    const [x, y] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
    const conv = (
      await pool.query(
        `INSERT INTO social.conversations (id, user_a, user_b, last_message_at) VALUES ($1, $2, $3, now())
         ON CONFLICT (user_a, user_b) DO UPDATE SET last_message_at = EXCLUDED.last_message_at RETURNING id`,
        [uuidv7(), x, y],
      )
    ).rows[0].id as string;
    for (let i = 0; i < count; i++) {
      await pool.query(`INSERT INTO social.messages (id, conversation_id, sender_id, body, created_at) VALUES ($1, $2, $3, 'olá', now() - make_interval(mins => $4))`, [uuidv7(), conv, i < fromA ? a.id : b.id, count - i]);
    }
  }
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
    const bus = app.get(RealtimeBus);
    const publish = bus.publish.bind(bus);
    jest.spyOn(bus, 'publish').mockImplementation((to: string, e: unknown) => {
      published.push({ to, e: e as MixarLiveEvent });
      publish(to, e);
    });
    await pool.query(`UPDATE content.posts SET removed_at = now(), removed_by = 'author' WHERE topics && ARRAY['malabares', 'capoeira', 'patinagem'] AND removed_at IS NULL`);
    // 20 autores com 2 tchekas cada: chega para a seleção do Mixar do grupo.
    for (let i = 0; i < 20; i++) {
      const a = await signup(`pa${i}x`);
      for (let k = 0; k < 2; k++) await tcheka(a, [['malabares', 'capoeira', 'patinagem'][(i + k) % 3]], 1 + i + k);
    }
  }, 300_000);

  afterAll(async () => {
    if (posts.length) await pool.query(`UPDATE content.posts SET removed_at = now(), removed_by = 'author' WHERE id = ANY($1::uuid[]) AND removed_at IS NULL`, [posts]);
    await app.close();
    await pool.end();
  });

  it('as três escolhas vêm ligadas, mudam-se em /settings/privacy e vão na exportação', async () => {
    const x = await signup('pdef');
    const p = (await api().get('/api/v1/settings/privacy').set(auth(x)).expect(200)).body;
    expect(p).toMatchObject({ mixarPresence: true, mixarSuggestable: true, mixarWeekInclude: true });
    const q = (await setPrivacy(x, { mixarPresence: false, mixarWeekInclude: false })).body;
    expect(q).toMatchObject({ mixarPresence: false, mixarSuggestable: true, mixarWeekInclude: false });
    await api().patch('/api/v1/settings/privacy').set(auth(x)).send({ mixarSuggestable: 'nao' }).expect(400);
    const e = (await api().get('/api/v1/me/export').set(auth(x)).expect(200)).body;
    expect(e.settings).toMatchObject({ mixarPresence: false, mixarSuggestable: true, mixarWeekInclude: false });
  });

  it('1a. «Mostrar que estou a ver contigo» desligada: a minha presença não se guarda nem se anuncia; eu continuo a ver o outro', async () => {
    const dom = await signup('vdom', 'Dom Teste');
    const ana = await signup('vana', 'Ana Teste');
    const mx = await pair(dom, ana);
    const pres = (x: U, b: object) => api().post(`/api/v1/mixar/${mx}/presence`).set(auth(x)).send(b).expect(200);

    // Por omissão (como antes): a Ana chega e o Dom sabe.
    await pres(ana, { postId: null });
    expect(live(dom, mx, 'presence')).toEqual([{ type: 'mixar.live', id: mx, what: 'presence', here: true, postId: null }]);
    expect((await pres(dom, { postId: null })).body.partner).toEqual({ here: true, postId: null });

    // A Ana desliga: na repetição seguinte sai para o Dom (um «saiu») e depois nunca mais aparece.
    await setPrivacy(ana, { mixarPresence: false });
    const mine = (await pres(ana, { postId: null })).body;
    expect(mine.partner).toEqual({ here: true, postId: null }); // ela continua a ver o Dom
    expect(live(dom, mx, 'presence')).toEqual([
      { type: 'mixar.live', id: mx, what: 'presence', here: true, postId: null },
      { type: 'mixar.live', id: mx, what: 'presence', here: false, postId: null },
    ]);
    await pres(ana, { postId: null });
    await pres(ana, { leave: true });
    expect(live(dom, mx, 'presence')).toHaveLength(2);
    expect((await pres(dom, { postId: null })).body.partner).toEqual({ here: false, postId: null });

    // Volta a ligar: aparece outra vez.
    await setPrivacy(ana, { mixarPresence: true });
    await pres(ana, { postId: null });
    expect(live(dom, mx, 'presence')[2]).toEqual({ type: 'mixar.live', id: mx, what: 'presence', here: true, postId: null });
    expect((await pres(dom, { postId: null })).body.partner).toEqual({ here: true, postId: null });
  });

  it('1b. «Aparecer nas sugestões de Mixar» desligada: não apareço no «Faz um Mixar com…» de ninguém, mas convidam-me na mesma', async () => {
    const me = await signup('ssug', 'Sug Teste');
    const lia = await signup('slia', 'Lia Teste');
    await prefs(me, ['malabares', 'capoeira']);
    await prefs(lia, ['malabares', 'capoeira']);
    await mutual(me, lia);
    await talk(me, lia, 12, 6);
    const list = async () => ((await api().get('/api/v1/mixar/suggestions').set(auth(me)).expect(200)).body.items as { username: string }[]).map((s) => s.username);
    expect(await list()).toEqual([lia.username]);
    await setPrivacy(lia, { mixarSuggestable: false });
    expect(await list()).toEqual([]);
    // A escolha é só sobre aparecer: a Lia continua a ver as dela e continua a poder ser convidada.
    await api().post('/api/v1/mixar/invite').set(auth(me)).send({ username: lia.username }).expect(201);
  });

  it('1c. «Deixar que o resumo da semana me inclua» desligada: o outro vê o resumo mas não o partilha nem descarrega; eu ainda partilho', async () => {
    const dom = await signup('wdom', 'Dom Teste');
    const ana = await signup('wana', 'Ana Teste');
    const mx = await pair(dom, ana);
    expect((await api().get(`/api/v1/mixar/${mx}/week`).set(auth(dom)).expect(200)).body.shareable).toBe(true);

    await setPrivacy(ana, { mixarWeekInclude: false });
    const w = (await api().get(`/api/v1/mixar/${mx}/week`).set(auth(dom)).expect(200)).body;
    expect(w).toMatchObject({ shareable: false, label: expect.any(String) });
    for (const to of ['zas', 'story']) {
      const r = (await api().post(`/api/v1/mixar/${mx}/week/share`).set(auth(dom)).send({ to }).expect(403)).body;
      expect(r).toMatchObject({ code: 'mixar_week_not_shareable', message: 'A outra pessoa não deixa partilhar o resumo da semana do vosso Mixar' });
    }
    const img = await api().get(`/api/v1/mixar/${mx}/week/image`).set(auth(dom)).expect(403);
    expect(img.body.code).toBe('mixar_week_not_shareable');
    // Nada ficou publicado em nome do Dom.
    expect((await pool.query('SELECT count(*)::int AS n FROM content.stories WHERE author_id = $1', [dom.id])).rows[0].n).toBe(0);
    expect((await pool.query('SELECT count(*)::int AS n FROM social.instants WHERE author_id = $1', [dom.id])).rows[0].n).toBe(0);

    // A Ana desligou só para si: o Dom deixa, por isso ela partilha.
    expect((await api().get(`/api/v1/mixar/${mx}/week`).set(auth(ana)).expect(200)).body.shareable).toBe(true);
    await api().post(`/api/v1/mixar/${mx}/week/share`).set(auth(ana)).send({ to: 'story' }).expect(201);

    // Volta a ligar: o Dom partilha.
    await setPrivacy(ana, { mixarWeekInclude: true });
    await api().post(`/api/v1/mixar/${mx}/week/share`).set(auth(dom)).send({ to: 'story' }).expect(201);
  }, 60_000);

  describe('Mixar de grupo: quem sai, apagar a conta e o limite', () => {
    const g: Record<string, U> = {};
    let group = '';
    let mx = '';

    beforeAll(async () => {
      for (const k of ['rui', 'dom', 'ana', 'zeca']) g[k] = await signup(`g${k}9`, `${k[0].toUpperCase()}${k.slice(1)} Teste`);
      const all = Object.values(g);
      for (const a of all) for (const b of all) if (a !== b) await follow(a, b);
      await prefs(g.rui, ['malabares']);
      await prefs(g.dom, ['malabares', 'capoeira']);
      await prefs(g.ana, ['capoeira', 'patinagem']);
      await prefs(g.zeca, ['patinagem']);
      group = (await api().post('/api/v1/chat/groups').set(auth(g.rui)).send({ name: 'Malta do Malabar', members: [g.dom.username, g.ana.username, g.zeca.username] }).expect(201)).body.id;
      // O Rui propõe; Dom e Ana entram (começa com 3, com os gostos do Rui); o Zeca entra depois.
      mx = (await api().post(`/api/v1/mixar/grupo/${group}`).set(auth(g.rui)).expect(201)).body.id;
      await api().post(`/api/v1/mixar/${mx}/accept`).set(auth(g.dom)).expect(200);
      await api().post(`/api/v1/mixar/${mx}/accept`).set(auth(g.ana)).expect(200);
      await api().post(`/api/v1/mixar/${mx}/accept`).set(auth(g.zeca)).expect(200);
    }, 120_000);

    it('3. os comentários de quem saiu do Mixar do grupo ficam, com o nome; uma conta que já não está ativa aparece como «Conta eliminada»', async () => {
      const feed = (await api().get(`/api/v1/mixar/${mx}/feed?limit=24`).set(auth(g.rui)).expect(200)).body.items as { post: { id: string } }[];
      expect(feed.length).toBeGreaterThan(0);
      const item = feed[0].post.id;
      await api().post(`/api/v1/mixar/${mx}/items/${item}/comments`).set(auth(g.rui)).send({ body: 'Este é dos bons' }).expect(201);
      await api().post(`/api/v1/mixar/${mx}/items/${item}/comments`).set(auth(g.dom)).send({ body: 'Concordo' }).expect(201);
      // O Rui sai do Mixar (continua no grupo); ficam 3 e o Mixar continua.
      await api().delete(`/api/v1/mixar/${mx}`).set(auth(g.rui)).expect(200);
      expect((await pool.query('SELECT status FROM social.mixars WHERE id = $1', [mx])).rows[0].status).toBe('active');
      const comments = async () => (await api().get(`/api/v1/mixar/${mx}/items/${item}/comments`).set(auth(g.ana)).expect(200)).body.items as { body: string; author: { username: string; displayName: string; hasAvatar: boolean; verified: boolean } }[];
      expect((await comments()).map((c) => [c.body, c.author.username, c.author.displayName])).toEqual([
        ['Este é dos bons', g.rui.username, 'Rui Teste'],
        ['Concordo', g.dom.username, 'Dom Teste'],
      ]);
      // Uma conta que já não está ativa: sem @, foto nem selo, «Conta eliminada» (como no chat).
      await pool.query(`UPDATE identity.users SET status = 'deleted' WHERE id = $1`, [g.rui.id]);
      try {
        expect((await comments())[0].author).toEqual({ username: '', displayName: 'Conta eliminada', hasAvatar: false, verified: false, verifiedTier: null });
      } finally {
        await pool.query(`UPDATE identity.users SET status = 'active' WHERE id = $1`, [g.rui.id]);
      }
    });

    it('2. eliminar a conta tira o id da pessoa da razão dos itens (fans), de quem propôs e de quem terminou; os comentários saem com ela', async () => {
      const withRui = async () => (await pool.query('SELECT count(*)::int AS n FROM social.mixar_items WHERE mixar_id = $1 AND $2::uuid = ANY(fans)', [mx, g.rui.id])).rows[0].n as number;
      expect(await withRui()).toBeGreaterThan(0); // o Rui estava quando se fez a seleção
      // Um Mixar antigo do grupo que o Rui terminou (para ver o ended_by).
      const old = uuidv7();
      await pool.query(`INSERT INTO social.mixars (id, group_id, invited_by, status, ended_at, ended_by) VALUES ($1, $2, $3, 'ended', now(), $3)`, [old, group, g.rui.id]);
      expect((await api().get(`/api/v1/mixar/${mx}`).set(auth(g.dom)).expect(200)).body.group.proposedBy).toMatchObject({ username: g.rui.username });

      await api().post('/api/v1/auth/delete-account').set(auth(g.rui)).send({ confirmUsername: g.rui.username, password: PASSWORD }).expect(204);

      expect(await withRui()).toBe(0);
      // Os outros fãs ficam (só sai o id do Rui).
      expect((await pool.query('SELECT count(*)::int AS n FROM social.mixar_items WHERE mixar_id = $1 AND cardinality(fans) > 0', [mx])).rows[0].n).toBeGreaterThan(0);
      const rows = (await pool.query('SELECT id, invited_by, ended_by FROM social.mixars WHERE id = ANY($1::uuid[]) ORDER BY id', [[mx, old]])).rows;
      for (const r of rows) expect(r).toMatchObject({ invited_by: null, ended_by: null });
      expect((await pool.query('SELECT count(*)::int AS n FROM social.mixar_comments WHERE user_id = $1', [g.rui.id])).rows[0].n).toBe(0);
      // O Mixar continua para os outros três, sem quem propôs.
      const m = (await api().get(`/api/v1/mixar/${mx}`).set(auth(g.dom)).expect(200)).body;
      expect(m).toMatchObject({ status: 'active', group: { proposedBy: null } });
      expect(m.group.people.map((p: { username: string }) => p.username).sort()).toEqual([g.ana.username, g.dom.username, g.zeca.username].sort());
      // Nenhuma coluna de pessoas do Mixar guarda ainda o id do Rui.
      const left = (await pool.query(
        `SELECT (SELECT count(*) FROM social.mixars WHERE $1 IN (user_a, user_b, invited_by, ended_by))
              + (SELECT count(*) FROM social.mixar_items WHERE $1 = ANY(fans))
              + (SELECT count(*) FROM social.mixar_members WHERE user_id = $1)
              + (SELECT count(*) FROM social.mixar_saves WHERE saved_by = $1) AS n`,
        [g.rui.id],
      )).rows[0].n;
      expect(Number(left)).toBe(0);
    });

    it('4. os Mixar de grupo não contam para os 20 Mixar a dois; o grupo tem o seu limite (um aberto de cada vez)', async () => {
      const full = await signup('lfull');
      const a = await signup('lgra');
      const b = await signup('lgrb');
      for (const [x, y] of [[full, a], [full, b], [a, b]] as const) await mutual(x, y);
      // 20 Mixar a dois ativos (direto na base).
      const people = (await pool.query(`SELECT id FROM identity.users WHERE status = 'active' AND id NOT IN ($1, $2, $3) ORDER BY id LIMIT 20`, [full.id, a.id, b.id])).rows.map((r) => r.id as string);
      for (const p of people) {
        const [x, y] = full.id < p ? [full.id, p] : [p, full.id];
        await pool.query(`INSERT INTO social.mixars (id, user_a, user_b, invited_by, status, accepted_at) VALUES ($1, $2, $3, $4, 'active', now()) ON CONFLICT DO NOTHING`, [uuidv7(), x, y, p]);
      }
      const pairs = async (u: U) => (await pool.query(`SELECT count(*)::int AS n FROM social.mixars WHERE (user_a = $1 OR user_b = $1) AND status = 'active'`, [u.id])).rows[0].n as number;
      expect(await pairs(full)).toBe(20);
      expect((await api().post('/api/v1/mixar/invite').set(auth(full)).send({ username: a.username }).expect(429)).body.message).toBe('Já tens 20 Mixar ativos. Sai de um para começar outro');

      // Com 20 a dois, propõe e entra num Mixar de grupo.
      const tri = (await api().post('/api/v1/chat/groups').set(auth(full)).send({ name: 'Trio do Limite', members: [a.username, b.username] }).expect(201)).body.id as string;
      const gm = (await api().post(`/api/v1/mixar/grupo/${tri}`).set(auth(full)).expect(201)).body.id as string;
      await api().post(`/api/v1/mixar/${gm}/accept`).set(auth(a)).expect(200);
      await api().post(`/api/v1/mixar/${gm}/accept`).set(auth(b)).expect(200);
      expect((await api().get(`/api/v1/mixar/${gm}`).set(auth(full)).expect(200)).body.status).toBe('active');
      // O do grupo não gastou nenhum dos 20.
      expect(await pairs(full)).toBe(20);
      expect(await pairs(a)).toBe(0);
      // Quem está no Mixar do grupo convida para um a dois (os do grupo não contam).
      await api().post('/api/v1/mixar/invite').set(auth(a)).send({ username: b.username }).expect(201);
      // O limite do grupo: um aberto de cada vez.
      const again = await api().post(`/api/v1/mixar/grupo/${tri}`).set(auth(a)).expect(409);
      expect(again.body).toMatchObject({ message: 'Este grupo já tem um Mixar', id: gm });
    }, 60_000);
  });
});
