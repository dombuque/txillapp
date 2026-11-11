import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { staffLogin } from '../staff/staff-test';
import { textHits } from './text-filter';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

interface U { token: string; id: string; username: string }
interface S { token: string; userId: string }

describe('backoffice: fila de queixas, conteúdo, catálogo e auditoria (moderação de conteúdo)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  let n = 0;
  const api = () => request(app.getHttpServer());
  const auth = (x: { token: string }) => ({ Authorization: `Bearer ${x.token}` });
  const u: Record<string, U> = {};
  const st: Record<string, S> = {};

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}${n++}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').set('X-Forwarded-For', `10.9.1.${(n % 250) + 1}`).send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: 'password-bem-longa-1', birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  const post = async (a: U, body: string) => (await api().post('/api/v1/posts').set(auth(a)).send({ body }).expect(201)).body as { id: string };
  const comment = async (a: U, postId: string, body: string, parentId?: string) => (await api().post(`/api/v1/posts/${postId}/comments`).set(auth(a)).send({ body, parentId }).expect(201)).body as { id: string };
  const report = (x: U, type: string, id: string, reason = 'spam') => api().post('/api/v1/reports').set(auth(x)).send({ type, id, reason }).expect(204);
  async function story(a: U, caption: string) {
    const up = (await api().post('/api/v1/media/uploads').set(auth(a)).send({ mime: 'image/png', size: PNG.length }).expect(201)).body as { assetId: string; uploadUrl: string };
    await api().put(up.uploadUrl).set('Content-Type', 'image/png').send(PNG).expect(200);
    const s = (await api().post('/api/v1/stories').set(auth(a)).send({ mediaId: up.assetId, caption }).expect(201)).body as { id: string };
    return { id: s.id, mediaId: up.assetId };
  }
  const queue = async (s: S, query: Record<string, string> = {}) => (await api().get('/api/v1/admin/mod/queue').query(query).set(auth(s)).expect(200)).body as { counts: Record<string, number>; items: any[] };
  const content = async (s: S, query: Record<string, string> = {}) => (await api().get('/api/v1/admin/mod/content').query(query).set(auth(s)).expect(200)).body as { items: any[]; nextCursor: string | null };
  const notes = async (x: U) => (await api().get('/api/v1/notifications').set(auth(x)).expect(200)).body.items as { kind: string; data: any; actor: { username: string; displayName: string } }[];
  const audit = async (target: string) => (await pool.query('SELECT action, actor_id, metadata FROM audit.audit_log WHERE target = $1 ORDER BY id', [target])).rows;
  const waitNote = async (x: U, kind: string) => {
    for (let i = 0; i < 20; i++) {
      const l = (await notes(x)).filter((z) => z.kind === kind);
      if (l.length) return l;
      await new Promise((r) => setTimeout(r, 50));
    }
    return [];
  };

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'm'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    for (const k of ['ma', 'mb', 'mc', 'md', 'me']) u[k] = await signup(k);
    st.admin = await staffLogin(app, 'moda', ['administracao']);
    st.mod = await staffLogin(app, 'modm', ['moderacao']);
    st.sup = await staffLogin(app, 'mods', ['suporte']);
    st.aud = await staffLogin(app, 'modx', ['auditoria']);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('filtro de texto: apanha termos sem acentos e por palavra inteira', () => {
    expect(textHits('Lucro GARANTIDO, manda por M-Pesa').map((h) => h.rule)).toEqual(['burla', 'burla']);
    expect(textHits('computador')).toEqual([]); // «puta» dentro de outra palavra não conta
    expect(textHits('és um cabrão').map((h) => h.label)).toEqual(['Insulto']);
  });

  it('permissões: só quem tem a permissão certa; a moderação tem «content.moderate»', async () => {
    const me = (await api().get('/api/v1/admin/me').set(auth(st.mod)).expect(200)).body;
    expect(me.permissions).toEqual(expect.arrayContaining(['content.moderate', 'reports.decide', 'catalog.manage']));
    expect((await api().get('/api/v1/admin/me').set(auth(st.admin)).expect(200)).body.permissions).toContain('content.moderate');

    await api().get('/api/v1/admin/mod/queue').set(auth(u.ma)).expect(401); // sessão da rede social não vale
    await api().get('/api/v1/admin/mod/queue').set(auth(st.sup)).expect(403);
    await api().get('/api/v1/admin/mod/content').set(auth(st.sup)).expect(403);
    await api().get('/api/v1/admin/mod/content').set(auth(st.aud)).expect(403);
    await api().post('/api/v1/admin/mod/queue/decide').set(auth(st.sup)).send({ items: [{ type: 'post', id: u.ma.id }], action: 'dismiss' }).expect(403);
    await api().post(`/api/v1/admin/mod/content/post/${u.ma.id}/remove`).set(auth(st.sup)).send({ reason: 'teste' }).expect(403);
    await api().get('/api/v1/admin/catalog').set(auth(st.sup)).expect(403);
    await api().get('/api/v1/admin/audit/search').set(auth(st.mod)).expect(403); // a moderação não lê a auditoria
    await api().get('/api/v1/admin/audit/search').set(auth(st.aud)).expect(200);
    await api().get('/api/v1/admin/mod/content').set(auth(st.mod)).expect(200);
    await api().get('/api/v1/admin/mod/queue').query({ type: 'nada' }).set(auth(st.mod)).expect(400);
  });

  it('fila: filtros por tipo, motivo e pessoa; gravidade e idade; detalhe com o contexto do autor', async () => {
    const { ma, mb, mc, md } = u;
    const p1 = await post(ma, 'publicação com spam');
    const p2 = await post(ma, 'publicação com coisa grave');
    const cm = await comment(ma, p1.id, 'comentário maldoso');
    await report(mb, 'post', p1.id, 'spam');
    await report(mb, 'post', p2.id, 'violence');
    await report(mc, 'post', p2.id, 'violence');
    await report(md, 'comment', cm.id, 'harassment');

    const all = await queue(st.mod);
    const mine = all.items.filter((x) => x.owner?.username === ma.username);
    expect(mine.map((x) => x.id)).toEqual([p2.id, cm.id, p1.id]); // por gravidade: violência (2) > assédio > spam
    expect(mine[0]).toMatchObject({ type: 'post', reports: 2, reasons: ['violence'], preview: 'publicação com coisa grave', postId: p2.id, removed: null });
    expect(mine[0].severity).toBeGreaterThan(mine[1].severity);
    expect(mine[0].owner).toMatchObject({ reportedItems: 3, openItems: 3, suspensions: 0, warnings: 0 });
    expect(all.counts.post).toBeGreaterThanOrEqual(2);

    const comments = await queue(st.mod, { type: 'comment', q: ma.username });
    expect(comments.items.map((x) => x.id)).toEqual([cm.id]);
    expect(comments.items[0].postId).toBe(p1.id);
    expect((await queue(st.mod, { reason: 'spam', q: ma.username })).items.map((x) => x.id)).toEqual([p1.id]);
    expect((await queue(st.mod, { type: 'post,comment', sort: 'oldest', q: ma.username })).items.map((x) => x.id)).toEqual([p1.id, p2.id, cm.id]);
    expect((await queue(st.mod, { sort: 'reports', q: ma.username })).items[0].id).toBe(p2.id);

    const d = (await api().get(`/api/v1/admin/mod/queue/post/${p2.id}`).set(auth(st.mod)).expect(200)).body;
    expect(d.reports.map((r: { reporter: string }) => r.reporter).sort()).toEqual([mb.username, mc.username].sort());
    expect(d.past.map((x: { id: string }) => x.id).sort()).toEqual([p1.id, cm.id].sort());
    await api().get(`/api/v1/admin/mod/queue/post/${ma.id}`).set(auth(st.mod)).expect(404);
  });

  it('decisões em lote: arquivar várias, remover e avisar exigem motivo, tudo na auditoria; o autor é avisado em nome do Txillapp', async () => {
    const { mb, mc, md, me } = u;
    const a = await post(me, 'lote um');
    const b = await post(me, 'lote dois');
    const c = await post(me, 'lote três');
    const w = await post(me, 'para avisar');
    for (const p of [a, b, c, w]) await report(mb, 'post', p.id, 'spam');

    // Arquivar duas de uma vez.
    const r1 = (await api().post('/api/v1/admin/mod/queue/decide').set(auth(st.mod)).send({ items: [{ type: 'post', id: a.id }, { type: 'post', id: b.id }], action: 'dismiss' }).expect(200)).body;
    expect(r1.done).toHaveLength(2);
    expect(r1.failed).toEqual([]);
    expect((await pool.query(`SELECT DISTINCT status FROM social.reports WHERE target_id = ANY($1::uuid[])`, [[a.id, b.id]])).rows).toEqual([{ status: 'dismissed' }]);
    expect((await audit(`post:${a.id}`)).map((x) => [x.action, x.metadata.batch])).toEqual([['moderation.dismiss', 2]]);
    const batch = (await pool.query(`SELECT metadata FROM audit.audit_log WHERE action = 'moderation.batch' AND actor_id = $1`, [st.mod.userId])).rows;
    expect(batch.at(-1)?.metadata).toMatchObject({ action: 'dismiss', count: 2, done: 2, failed: 0 });

    // Remover sem motivo não; com motivo sim. Uma que já estava decidida falha sem travar as outras.
    await api().post('/api/v1/admin/mod/queue/decide').set(auth(st.mod)).send({ items: [{ type: 'post', id: c.id }], action: 'remove' }).expect(400);
    const r2 = (await api().post('/api/v1/admin/mod/queue/decide').set(auth(st.mod)).send({ items: [{ type: 'post', id: c.id }, { type: 'post', id: a.id }], action: 'remove', note: 'spam repetido' }).expect(200)).body;
    expect(r2.done).toEqual([{ type: 'post', id: c.id }]);
    expect(r2.failed).toEqual([expect.objectContaining({ id: a.id })]);
    await api().get(`/api/v1/posts/${c.id}`).set(auth(mc)).expect(404);
    const removed = await waitNote(me, 'content_removed');
    expect(removed[0]).toMatchObject({ data: { type: 'post', reason: 'spam repetido', postId: c.id }, actor: { username: 'txillapp', displayName: 'Txillapp' } });
    // A remoção pela fila também se pode desfazer na página «Conteúdo».
    expect((await content(st.mod, { state: 'removed', author: me.username })).items.map((x) => x.id)).toEqual([c.id]);

    // Avisar: o autor recebe o aviso com o motivo.
    await api().post('/api/v1/admin/mod/queue/decide').set(auth(st.mod)).send({ items: [{ type: 'post', id: w.id }], action: 'warn', note: 'linguagem a evitar' }).expect(200);
    expect((await waitNote(me, 'moderation_warning'))[0].data).toMatchObject({ type: 'post', reason: 'linguagem a evitar' });
    expect((await audit(`post:${w.id}`)).map((x) => x.action)).toEqual(['moderation.warn']);
    const ctx = (await queue(st.mod, { status: 'actioned', q: me.username })).items.find((x) => x.id === w.id);
    expect(ctx).toMatchObject({ resolution: 'warn', resolutionNote: 'linguagem a evitar', decidedBy: 'modm' }); // o nome da pessoa da equipa, não o @ interno
    expect(ctx.owner).toMatchObject({ warnings: 1, removals: 1 });

    // Suspender: a conta perde as sessões; uma conta de equipa não se suspende.
    const s = await post(md, 'suspender');
    await report(mb, 'post', s.id, 'scam');
    await api().post('/api/v1/admin/mod/queue/decide').set(auth(st.mod)).send({ items: [{ type: 'post', id: s.id }], action: 'suspend', note: 'burla' }).expect(200);
    expect((await pool.query('SELECT status FROM identity.users WHERE id = $1', [md.id])).rows[0].status).toBe('suspended');
    expect((await pool.query('SELECT count(*)::int AS n FROM identity.sessions WHERE user_id = $1 AND revoked_at IS NULL', [md.id])).rows[0].n).toBe(0);
    expect((await audit(`post:${s.id}`)).map((x) => [x.action, x.metadata.owner])).toEqual([['moderation.suspend', md.id]]);
  });

  it('conteúdo: pesquisa por texto, autor, hashtag e datas; o que o filtro de texto e o modelo de fotos assinalaram', async () => {
    const { mb, mc } = u;
    const p = await post(mb, `Praia ao fim da tarde #Verão${run}`);
    const scam = await post(mb, 'Lucro garantido! Envia por M-Pesa');
    const cm = await comment(mc, p.id, `que fixe #verao${run}`);
    const sto = await story(mb, 'mimo na praia');
    await pool.query('UPDATE content.media_assets SET nsfw_score = 0.7 WHERE id = $1', [sto.mediaId]);

    expect((await content(st.mod, { q: 'praia', author: mb.username })).items.map((x) => [x.type, x.id])).toEqual([['story', sto.id], ['post', p.id]]);
    expect((await content(st.mod, { tag: `#verao${run}` })).items.map((x) => x.id).sort()).toEqual([p.id, cm.id].sort());
    expect((await content(st.mod, { type: 'comment', author: mc.username })).items.map((x) => x.id)).toEqual([cm.id]);
    const flagged = (await content(st.mod, { flag: 'text', author: mb.username })).items;
    expect(flagged.map((x) => x.id)).toEqual([scam.id]);
    expect(flagged[0].textHits.map((h: { rule: string }) => h.rule)).toContain('burla');
    const nsfw = (await content(st.mod, { flag: 'nsfw', author: mb.username })).items;
    expect(nsfw.map((x) => x.id)).toEqual([sto.id]);
    expect(nsfw[0]).toMatchObject({ type: 'story', nsfwFlagged: true, media: [expect.objectContaining({ id: sto.mediaId })] });
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    expect((await content(st.mod, { author: mb.username, from: tomorrow })).items).toEqual([]);
    expect((await content(st.mod, { author: mb.username, to: tomorrow })).items.length).toBe(3);
    expect((await content(st.mod, { author: 'ninguem-assim' })).items).toEqual([]);
    await api().get('/api/v1/admin/mod/content').query({ from: 'ontem' }).set(auth(st.mod)).expect(400);
  });

  it('remover e repor (publicação, comentário com respostas e mimo), com motivo, aviso ao autor e auditoria', async () => {
    const { ma, mb, mc } = u;
    const p = await post(mb, 'para remover e repor');
    await report(ma, 'post', p.id, 'nudity');
    await api().post(`/api/v1/admin/mod/content/post/${p.id}/remove`).set(auth(st.mod)).send({}).expect(400); // sem motivo
    await api().post(`/api/v1/admin/mod/content/post/${p.id}/remove`).set(auth(st.mod)).send({ reason: 'foto imprópria' }).expect(200);
    await api().get(`/api/v1/posts/${p.id}`).set(auth(mc)).expect(404);
    await api().post(`/api/v1/admin/mod/content/post/${p.id}/remove`).set(auth(st.mod)).send({ reason: 'outra vez' }).expect(404); // já removida
    expect((await pool.query(`SELECT DISTINCT status, resolution FROM social.reports WHERE target_id = $1`, [p.id])).rows).toEqual([{ status: 'actioned', resolution: 'remove' }]);
    const row = (await content(st.mod, { author: mb.username, state: 'removed' })).items.find((x) => x.id === p.id);
    expect(row).toMatchObject({ state: 'removed', removal: { reason: 'foto imprópria' } });
    expect((await content(st.mod, { author: mb.username, state: 'visible' })).items.map((x) => x.id)).not.toContain(p.id);

    await api().post(`/api/v1/admin/mod/content/post/${p.id}/restore`).set(auth(st.mod)).send({ reason: 'foi um engano', notify: true }).expect(200);
    await api().get(`/api/v1/posts/${p.id}`).set(auth(mc)).expect(200);
    await api().post(`/api/v1/admin/mod/content/post/${p.id}/restore`).set(auth(st.mod)).send({ reason: 'de novo' }).expect(404);
    expect((await audit(`post:${p.id}`)).map((x) => [x.action, x.metadata.reason])).toEqual([['moderation.content_remove', 'foto imprópria'], ['moderation.content_restore', 'foi um engano']]);
    expect((await waitNote(mb, 'content_restored'))[0].data).toMatchObject({ type: 'post', postId: p.id });

    // Comentário com uma resposta: sai com a resposta e volta com ela.
    const host = await post(ma, 'publicação com conversa');
    const cm = await comment(mb, host.id, 'comentário duvidoso');
    const reply = await comment(mc, host.id, 'resposta', cm.id);
    await api().post(`/api/v1/admin/mod/content/comment/${cm.id}/remove`).set(auth(st.mod)).send({ reason: 'insulto', notify: false }).expect(200);
    expect((await pool.query('SELECT count(*)::int AS n FROM content.comments WHERE id = ANY($1::uuid[])', [[cm.id, reply.id]])).rows[0].n).toBe(0);
    expect((await content(st.mod, { type: 'comment', state: 'removed', author: mb.username })).items.map((x) => [x.id, x.body, x.postId])).toEqual([[cm.id, 'comentário duvidoso', host.id]]);
    await api().post(`/api/v1/admin/mod/content/comment/${cm.id}/restore`).set(auth(st.mod)).send({ reason: 'afinal está bem', notify: false }).expect(200);
    const back = (await api().get(`/api/v1/posts/${host.id}/comments`).set(auth(ma)).expect(200)).body;
    expect(JSON.stringify(back)).toContain(cm.id);
    expect((await pool.query('SELECT count(*)::int AS n FROM content.comments WHERE id = ANY($1::uuid[])', [[cm.id, reply.id]])).rows[0].n).toBe(2);
    expect((await audit(`comment:${cm.id}`)).map((x) => [x.action, x.metadata.notified])).toEqual([['moderation.content_remove', false], ['moderation.content_restore', false]]);

    // Mimo: deixa de se ver e volta com o prazo original.
    const s = await story(mb, 'mimo a remover');
    const before = (await pool.query('SELECT expires_at FROM content.stories WHERE id = $1', [s.id])).rows[0].expires_at;
    await api().post(`/api/v1/admin/mod/content/story/${s.id}/remove`).set(auth(st.mod)).send({ reason: 'imagem violenta' }).expect(200);
    expect((await pool.query('SELECT expires_at <= now() AS gone FROM content.stories WHERE id = $1', [s.id])).rows[0].gone).toBe(true);
    expect((await waitNote(mb, 'content_removed')).some((x) => x.data.type === 'story' && x.data.reason === 'imagem violenta')).toBe(true);
    const res = (await api().post(`/api/v1/admin/mod/content/story/${s.id}/restore`).set(auth(st.mod)).send({ reason: 'revisto' }).expect(200)).body;
    expect(res).toEqual({ ok: true, expired: false });
    expect((await pool.query('SELECT expires_at FROM content.stories WHERE id = $1', [s.id])).rows[0].expires_at.getTime()).toBe(new Date(before).getTime());
    await api().post(`/api/v1/admin/mod/content/nada/${s.id}/remove`).set(auth(st.mod)).send({ reason: 'tipo errado' }).expect(400);
  });

  it('catálogo da Geleira: sugestões por aprovar, editar com países, aprovar em lote, criar; tudo na auditoria', async () => {
    const { mc } = u;
    const s1 = (await api().post('/api/v1/geleira/items').set(auth(mc)).send({ name: `Sumo ${run} A`, kind: 'bebida', category: 'sumo' }).expect(201)).body;
    const s2 = (await api().post('/api/v1/geleira/items').set(auth(mc)).send({ name: `Sumo ${run} B`, kind: 'bebida', category: 'sumo' }).expect(201)).body;
    const pending = (await api().get('/api/v1/admin/catalog').query({ status: 'pending', q: run }).set(auth(st.mod)).expect(200)).body;
    expect(pending.items.map((x: { id: string }) => x.id).sort()).toEqual([s1.id, s2.id].sort());
    expect(pending.items[0]).toMatchObject({ suggestedBy: mc.username, status: 'pending' });

    await api().patch(`/api/v1/admin/catalog/${s1.id}`).set(auth(st.mod)).send({ countries: ['MZ'] }).expect(400); // sem motivo
    await api().patch(`/api/v1/admin/catalog/${s1.id}`).set(auth(st.mod)).send({ countries: ['MZ'], category: 'refrigerante', reason: 'só existe em Moçambique' }).expect(204);
    await api().patch(`/api/v1/admin/catalog/${s1.id}`).set(auth(st.mod)).send({ alcoholic: true, kind: 'comida', reason: 'teste' }).expect(400);
    const d = (await api().post('/api/v1/admin/catalog/decide').set(auth(st.mod)).send({ ids: [s1.id, s2.id], approve: true }).expect(200)).body;
    expect(d).toEqual({ changed: 2 });
    await api().post('/api/v1/admin/catalog/decide').set(auth(st.mod)).send({ ids: [s1.id], approve: false }).expect(404); // já não está pendente
    const mz = (await api().get('/api/v1/admin/catalog').query({ status: 'curated', country: 'MZ', q: run }).set(auth(st.mod)).expect(200)).body;
    expect(mz.items.map((x: { id: string; category: string }) => [x.id, x.category])).toEqual([[s1.id, 'refrigerante']]);

    const created = (await api().post('/api/v1/admin/catalog').set(auth(st.mod)).send({ name: `Petisco ${run}`, kind: 'comida', category: 'petisco', countries: ['MZ', 'PT'], reason: 'pedido da malta' }).expect(201)).body;
    await api().post('/api/v1/admin/catalog').set(auth(st.mod)).send({ name: `Petisco ${run}`, kind: 'comida', category: 'petisco', reason: 'repetido' }).expect(409);
    expect((await audit(`taste_item:${s1.id}`)).map((x) => x.action)).toEqual(['catalog.edit', 'catalog.approve']);
    expect((await audit(`taste_item:${s1.id}`))[0].metadata.changes).toMatchObject({ countries: { from: null, to: ['MZ'] }, category: { from: 'sumo', to: 'refrigerante' } });
    expect((await audit(`taste_item:${created.id}`)).map((x) => x.action)).toEqual(['catalog.create']);
  });

  it('auditoria: filtros por pessoa, ação, alvo e datas; exportar CSV fica registado', async () => {
    const { ma } = u;
    const p = await post(ma, 'para a auditoria');
    await api().post(`/api/v1/admin/mod/content/post/${p.id}/remove`).set(auth(st.admin)).send({ reason: 'teste da auditoria' }).expect(200);

    const search = async (q: Record<string, string>) => (await api().get('/api/v1/admin/audit/search').query(q).set(auth(st.aud)).expect(200)).body.items as any[];
    const byActor = await search({ actor: st.admin.userId, action: 'moderation.content_remove' });
    expect(byActor.map((x) => x.target)).toContain(`post:${p.id}`);
    expect(byActor[0]).toMatchObject({ actorStaff: true, actorName: 'moda', ownerLabel: `@${ma.username}`, metadata: { reason: 'teste da auditoria' } });
    expect((await search({ action: 'moderation.', target: p.id })).map((x) => x.action)).toEqual(['moderation.content_remove']);
    expect((await search({ target: `@${ma.username}`, action: 'moderation.content_remove' })).map((x) => x.target)).toContain(`post:${p.id}`);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    expect(await search({ target: p.id, from: tomorrow })).toEqual([]);
    expect((await search({ target: p.id, to: tomorrow })).length).toBe(1);
    await api().get('/api/v1/admin/audit/search').query({ action: 'DROP TABLE' }).set(auth(st.aud)).expect(400);

    const facets = (await api().get('/api/v1/admin/audit/facets').set(auth(st.aud)).expect(200)).body;
    expect(facets.staff.map((x: { id: string }) => x.id)).toContain(st.admin.userId);
    expect(facets.actions.map((x: { action: string }) => x.action)).toContain('moderation.content_remove');

    const csv = await api().get('/api/v1/admin/audit/export').query({ target: p.id }).set(auth(st.aud)).expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text.split('\r\n')[0]).toBe('﻿quando,quem,acao,alvo,conta,motivo,detalhe');
    expect(csv.text).toContain('"moderation.content_remove"');
    expect(csv.text).toContain('"teste da auditoria"');
    const exp = (await pool.query(`SELECT metadata FROM audit.audit_log WHERE action = 'backoffice.audit_export' AND actor_id = $1 ORDER BY id DESC LIMIT 1`, [st.aud.userId])).rows[0];
    expect(exp.metadata).toMatchObject({ filters: { target: p.id }, rows: 1 });
  });

  it('denunciar um local: só páginas aprovadas; na fila não se remove (decide-se em Locais)', async () => {
    const { ma, mb } = u;
    const v = (await pool.query(
      `INSERT INTO content.venues (id, slug, name, kind, owner_id, check_token, review_status) VALUES (gen_random_uuid(), $1, 'Bar do Teste', 'bar', $2, 'x', 'approved') RETURNING id`,
      [`bar-${run}`, ma.id],
    )).rows[0];
    await report(mb, 'venue', v.id, 'scam');
    const it = (await queue(st.mod, { type: 'venue' })).items.find((x) => x.id === v.id);
    expect(it).toMatchObject({ type: 'venue', venueSlug: `bar-${run}`, owner: expect.objectContaining({ username: ma.username }) });
    const r = (await api().post('/api/v1/admin/mod/queue/decide').set(auth(st.mod)).send({ items: [{ type: 'venue', id: v.id }], action: 'remove', note: 'não' }).expect(200)).body;
    expect(r.failed[0].error).toMatch(/Locais/);
    await api().post('/api/v1/admin/mod/queue/decide').set(auth(st.mod)).send({ items: [{ type: 'venue', id: v.id }], action: 'dismiss' }).expect(200);
    // Denunciar uma conta também funciona (o parâmetro de quem denuncia tem de ir na consulta).
    await report(mb, 'user', ma.id, 'impersonation');
    expect((await queue(st.mod, { type: 'user', q: ma.username })).items.map((x) => x.id)).toEqual([ma.id]);
  });
});
