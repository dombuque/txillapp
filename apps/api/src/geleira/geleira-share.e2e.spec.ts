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
interface GItem { id: string; name: string; alcoholic: boolean; cheers: number; cheered: boolean }
interface GPost { id: string; code: string; body: string; kind: string; cheers: number; cheered: boolean; geleira: { level: number; total: number; items: GItem[] } | null }

describe('partilhar a geleira como publicação e brindes que contam no perfil (0143, integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  const u: Record<string, U> = {};
  const item: Record<string, string> = {};
  let post: GPost;

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  const share = (x: U, body: Record<string, unknown> = { geleira: true }) => api().post('/api/v1/posts').set(auth(x)).send(body);
  const getPost = (viewer: U, id: string) => api().get(`/api/v1/posts/${id}`).set(auth(viewer));
  const cheerOnPost = (viewer: U, postId: string, itemId: string, on = true) =>
    (on ? api().put(`/api/v1/posts/${postId}/geleira/items/${itemId}/cheer`) : api().delete(`/api/v1/posts/${postId}/geleira/items/${itemId}/cheer`)).set(auth(viewer));
  const cheerOnProfile = (viewer: U, owner: U, itemId: string, on = true) =>
    (on ? api().put(`/api/v1/users/${owner.username}/geleira/items/${itemId}/cheer`) : api().delete(`/api/v1/users/${owner.username}/geleira/items/${itemId}/cheer`)).set(auth(viewer));
  const theirGeleira = async (viewer: U, owner: U) => (await api().get(`/api/v1/users/${owner.username}/geleira`).set(auth(viewer)).expect(200)).body as GItem[];
  const level = async (viewer: U, owner: U) => (await api().get(`/api/v1/users/${owner.username}/geleira/level`).set(auth(viewer)).expect(200)).body as { cheers: number; cheered: boolean };
  const geleiraNotices = async (owner: U, actor: U) =>
    (await pool.query(`SELECT count(*)::int AS n FROM social.notifications WHERE user_id = $1 AND actor_id = $2 AND kind = 'geleira_cheer'`, [owner.id, actor.id])).rows[0].n as number;
  const names = (p: GPost) => p.geleira!.items.map((i) => i.name);

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'h'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    for (const n of ['gsana', 'gsbia', 'gsteo', 'gssem', 'gsrui', 'gscar']) u[n] = await signup(n);
    // gsteo tem 15 anos; gssem não tem data de nascimento: nenhum dos dois vê bebidas alcoólicas.
    await pool.query(`UPDATE identity.users SET birth_date = current_date - interval '15 years' WHERE id = $1`, [u.gsteo.id]);
    await pool.query('UPDATE identity.users SET birth_date = NULL WHERE id = $1', [u.gssem.id]);
    const { rows } = await pool.query(`SELECT slug, id FROM taste.items WHERE slug IN ('beb-laurentina', 'beb-coca-cola', 'com-matapa', 'com-pasteis-nata')`);
    for (const r of rows) item[r.slug as string] = r.id as string;
    expect(Object.keys(item)).toHaveLength(4);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('geleira vazia não se partilha, e a explicação diz porquê', async () => {
    const r = await share(u.gsana).expect(400);
    expect(r.body.message).toBe('A tua geleira está vazia. Junta bebidas ou comidas antes de a partilhar.');
  });

  it('partilhar: o post leva o retrato da geleira (ordem, nomes, desenho), sem precisar de texto; não leva fotos', async () => {
    const { gsana } = u;
    await api().put(`/api/v1/geleira/me/items/${item['beb-laurentina']}`).set(auth(gsana)).send({ rating: 5, favorite: true }).expect(204);
    await api().put(`/api/v1/geleira/me/items/${item['beb-coca-cola']}`).set(auth(gsana)).send({ rating: 3 }).expect(204);
    await api().put(`/api/v1/geleira/me/items/${item['com-matapa']}`).set(auth(gsana)).send({ rating: 4 }).expect(204);

    await share(gsana, { geleira: true, mediaIds: ['00000000-0000-4000-8000-000000000000'] }).expect(400);
    post = (await share(gsana, { geleira: true, body: 'A minha geleira, malta 🥂' }).expect(201)).body;
    expect(post.kind).toBe('post');
    expect(post.body).toBe('A minha geleira, malta 🥂');
    // Pela ordem do perfil: favoritos, depois a nota.
    expect(names(post)).toEqual(['Laurentina', 'Matapa', 'Coca-Cola']);
    expect(post.geleira!.total).toBe(3);
    expect(post.geleira!.items[0]).toMatchObject({ id: item['beb-laurentina'], slug: 'beb-laurentina', kind: 'bebida', alcoholic: true, favorite: true, rating: 5, cheers: 0, cheered: false });

    // Legenda opcional.
    const empty = (await share(gsana).expect(201)).body as GPost;
    expect(empty.body).toBe('');
    expect(empty.geleira!.items).toHaveLength(3);
    // Pode-se tirar a legenda depois (um post da geleira não precisa de texto).
    await api().patch(`/api/v1/posts/${post.id}`).set(auth(gsana)).send({ body: '' }).expect(200);
    await api().patch(`/api/v1/posts/${post.id}`).set(auth(gsana)).send({ body: 'A minha geleira, malta 🥂' }).expect(200);
    await api().delete(`/api/v1/posts/${empty.id}`).set(auth(gsana)).expect(204);
  });

  it('o retrato não muda quando a geleira muda depois', async () => {
    const { gsana, gsbia } = u;
    await api().put(`/api/v1/geleira/me/items/${item['com-pasteis-nata']}`).set(auth(gsana)).send({}).expect(204);
    await api().delete(`/api/v1/geleira/me/items/${item['beb-coca-cola']}`).set(auth(gsana)).expect(204);
    expect(names((await getPost(gsbia, post.id).expect(200)).body)).toEqual(['Laurentina', 'Matapa', 'Coca-Cola']);
    await api().put(`/api/v1/geleira/me/items/${item['beb-coca-cola']}`).set(auth(gsana)).send({ rating: 3 }).expect(204);
  });

  it('bebidas alcoólicas: só quem tem 18 anos as vê no cartão (menor ou sem data de nascimento não)', async () => {
    const adult = (await getPost(u.gsbia, post.id).expect(200)).body as GPost;
    expect(names(adult)).toContain('Laurentina');
    expect(adult.geleira!.total).toBe(3);
    for (const minor of [u.gsteo, u.gssem]) {
      const p = (await getPost(minor, post.id).expect(200)).body as GPost;
      expect(names(p)).toEqual(['Matapa', 'Coca-Cola']);
      expect(p.geleira!.items.some((i) => i.alcoholic)).toBe(false);
      expect(p.geleira!.total).toBe(2);
      // Nem no perfil da autora (lista de publicações).
      const list = (await api().get(`/api/v1/users/${u.gsana.username}/posts?tab=posts`).set(auth(minor)).expect(200)).body as { items: GPost[] };
      const mine = list.items.find((x) => x.id === post.id)!;
      expect(names(mine)).toEqual(['Matapa', 'Coca-Cola']);
      // E não brinda o que não vê.
      expect((await cheerOnPost(minor, post.id, item['beb-laurentina']).expect(404)).body.message).toBe('Esse gosto não está nesta geleira');
    }
    expect(JSON.stringify((await api().get(`/api/v1/users/${u.gsana.username}/posts`).set(auth(u.gsteo)).expect(200)).body)).not.toContain('Laurentina');
  });

  it('brindar um item no post conta no perfil; a mesma pessoa só conta uma vez, venha de onde vier', async () => {
    const { gsana, gsbia } = u;
    const matapa = item['com-matapa'];
    expect((await cheerOnPost(gsbia, post.id, matapa).expect(200)).body).toEqual({ itemId: matapa, cheered: true, cheers: 1 });
    expect((await cheerOnPost(gsbia, post.id, matapa).expect(200)).body).toEqual({ itemId: matapa, cheered: true, cheers: 1 }); // repetir
    // No perfil, o mesmo brinde.
    expect((await theirGeleira(gsbia, gsana)).find((i) => i.id === matapa)).toMatchObject({ cheers: 1, cheered: true });
    expect((await api().get('/api/v1/geleira/me').set(auth(gsana)).expect(200)).body.find((i: GItem) => i.id === matapa)).toMatchObject({ cheers: 1 });
    // Brindar outra vez, agora no perfil: continua 1.
    expect((await cheerOnProfile(gsbia, gsana, matapa).expect(200)).body).toEqual({ itemId: matapa, cheered: true, cheers: 1 });
    const { rows } = await pool.query('SELECT source_post_id FROM taste.geleira_item_cheers WHERE owner_id = $1 AND item_id = $2 AND user_id = $3', [gsana.id, matapa, gsbia.id]);
    expect(rows).toEqual([{ source_post_id: post.id }]);
    // Tirar no perfil tira também no post (é o mesmo brinde).
    expect((await cheerOnProfile(gsbia, gsana, matapa, false).expect(200)).body).toEqual({ itemId: matapa, cheered: false, cheers: 0 });
    expect(((await getPost(gsbia, post.id).expect(200)).body as GPost).geleira!.items.find((i) => i.id === matapa)).toMatchObject({ cheers: 0, cheered: false });
    await cheerOnPost(gsbia, post.id, matapa).expect(200);
    await cheerOnPost(u.gsteo, post.id, matapa).expect(200);
    const seen = ((await getPost(gsbia, post.id).expect(200)).body as GPost).geleira!.items.find((i) => i.id === matapa)!;
    expect(seen).toMatchObject({ cheers: 2, cheered: true });

    // Avisos: um só por pessoa (como nos brindes à geleira), com o nome do item.
    expect(await geleiraNotices(gsana, gsbia)).toBe(1);
    const n = (await pool.query(`SELECT data FROM social.notifications WHERE user_id = $1 AND actor_id = $2 AND kind = 'geleira_cheer'`, [gsana.id, gsbia.id])).rows[0].data;
    expect(n).toMatchObject({ itemId: matapa, itemName: 'Matapa', postId: post.id });

    // A própria geleira não; um item que não está no retrato também não.
    expect((await cheerOnPost(gsana, post.id, matapa).expect(400)).body.message).toBe('Não podes brindar a tua própria geleira');
    await cheerOnPost(gsbia, post.id, item['com-pasteis-nata']).expect(404);
    // No perfil, o pastel de nata já está na geleira: dá para brindar lá.
    expect((await cheerOnProfile(gsbia, gsana, item['com-pasteis-nata']).expect(200)).body.cheers).toBe(1);
  });

  it('brindar o post todo aparece no perfil como brinde à geleira, sem duplicar nem avisar duas vezes', async () => {
    const { gsana, gsbia, gscar } = u;
    const before = (await level(gsana, gsana)).cheers;
    // gsbia: brinda o post (e já tinha brindado um item): a geleira passa a ter o brinde dela, com a ligação ao post.
    expect((await api().post(`/api/v1/posts/${post.id}/cheers`).set(auth(gsbia)).expect(200)).body).toMatchObject({ cheered: true });
    expect((await level(gsana, gsana)).cheers).toBe(before + 1);
    expect(await level(gsbia, gsana)).toMatchObject({ cheered: true });
    const list = (await api().get(`/api/v1/users/${gsana.username}/geleira/cheers`).set(auth(gsana)).expect(200)).body.items as { username: string; post?: { code: string } }[];
    expect(list.find((i) => i.username === gsbia.username)).toMatchObject({ post: { code: post.code } });
    // Brindar também no perfil não conta outra vez.
    await api().put(`/api/v1/users/${gsana.username}/geleira/cheer`).set(auth(gsbia)).expect(200);
    expect((await level(gsana, gsana)).cheers).toBe(before + 1);
    expect(await geleiraNotices(gsana, gsbia)).toBe(1);

    // gscar: brinda o post primeiro (o aviso é o do post) e depois um item: nenhum aviso de geleira a mais.
    await api().post(`/api/v1/posts/${post.id}/cheers`).set(auth(gscar)).expect(200);
    expect((await level(gsana, gsana)).cheers).toBe(before + 2);
    await cheerOnPost(gscar, post.id, item['beb-laurentina']).expect(200);
    expect(await geleiraNotices(gsana, gscar)).toBe(0);
    // Tirar o brinde ao post tira o brinde à geleira que veio dele.
    expect((await api().post(`/api/v1/posts/${post.id}/cheers`).set(auth(gscar)).expect(200)).body).toMatchObject({ cheered: false });
    expect((await level(gsana, gsana)).cheers).toBe(before + 1);
    // Mas não o que foi dado no perfil (gsbia brindou nos dois sítios).
    await api().post(`/api/v1/posts/${post.id}/cheers`).set(auth(gsbia)).expect(200);
    expect(await level(gsbia, gsana)).toMatchObject({ cheered: true });
    await api().post(`/api/v1/posts/${post.id}/cheers`).set(auth(gsbia)).expect(200);
    await api().post(`/api/v1/posts/${post.id}/cheers`).set(auth(gscar)).expect(200);
    expect((await level(gsana, gsana)).cheers).toBe(before + 2);
  });

  it('privacidade: conta privada e bloqueios valem para o post da geleira e para os brindes nele', async () => {
    const { gsana, gsrui, gsbia } = u;
    const matapa = item['com-matapa'];
    await api().put(`/api/v1/blocks/${gsrui.username}`).set(auth(gsana)).expect(200);
    await getPost(gsrui, post.id).expect(404);
    await cheerOnPost(gsrui, post.id, matapa).expect(404);
    await api().post(`/api/v1/posts/${post.id}/cheers`).set(auth(gsrui)).expect(404);
    await api().delete(`/api/v1/blocks/${gsrui.username}`).set(auth(gsana)).expect(200);
    // Bloqueio no outro sentido.
    await api().put(`/api/v1/blocks/${gsana.username}`).set(auth(gsrui)).expect(200);
    await cheerOnPost(gsrui, post.id, matapa).expect(404);
    await api().delete(`/api/v1/blocks/${gsana.username}`).set(auth(gsrui)).expect(200);

    await pool.query('UPDATE identity.users SET is_private = true WHERE id = $1', [gsana.id]);
    await getPost(gsrui, post.id).expect(404);
    await cheerOnPost(gsrui, post.id, matapa).expect(404);
    // O cartão do link e a pré-visualização pública também deixam de existir.
    await api().get(`/api/v1/share/card/geleira/${post.code}`).expect(404);
    await api().get(`/api/v1/public/posts/${post.code}`).expect(404);
    // Quem segue continua a ver.
    await pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [gsbia.id, gsana.id]);
    await getPost(gsbia, post.id).expect(200);
    await pool.query('DELETE FROM social.follows WHERE follower_id = $1 AND followee_id = $2', [gsbia.id, gsana.id]);
    await pool.query('UPDATE identity.users SET is_private = false WHERE id = $1', [gsana.id]);
  });

  it('o link partilhado: cartão com a imagem da geleira, sem álcool; a pré-visualização pública também', async () => {
    const page = await api().get(`/api/v1/share/p/${post.code}`).expect(200);
    expect(page.text).toContain(`/api/v1/share/card/geleira/${post.code}`);
    expect(page.text).toContain('A geleira de gsana Teste');
    const img = await api().get(`/api/v1/share/card/geleira/${post.code}`).buffer(true).parse((res, cb) => { const b: Buffer[] = []; res.on('data', (c: Buffer) => b.push(c)); res.on('end', () => cb(null, Buffer.concat(b))); }).expect(200);
    expect(img.headers['content-type']).toContain('image/png');
    expect((img.body as Buffer).subarray(1, 4).toString()).toBe('PNG');
    const pub = (await api().get(`/api/v1/public/posts/${post.code}`).expect(200)).body;
    expect(pub.geleira.items.map((i: { name: string }) => i.name)).toEqual(['Matapa', 'Coca-Cola']);
    expect(JSON.stringify(pub)).not.toContain('Laurentina');
  });

  it('a exportação de dados traz as partilhas da geleira e os brindes aos itens', async () => {
    const mine = (await api().get('/api/v1/me/export').set(auth(u.gsana)).expect(200)).body;
    expect(mine.geleiraShares.map((s: { postId: string }) => s.postId)).toContain(post.id);
    expect(mine.geleiraShares.find((s: { postId: string }) => s.postId === post.id).items.map((i: { name: string }) => i.name)).toEqual(['Laurentina', 'Matapa', 'Coca-Cola']);
    expect(mine.geleiraItemCheersReceived).toEqual(expect.arrayContaining([expect.objectContaining({ from: u.gsbia.username, item: 'Matapa', fromPostId: post.id })]));
    const theirs = (await api().get('/api/v1/me/export').set(auth(u.gsbia)).expect(200)).body;
    expect(theirs.geleiraItemCheersGiven).toEqual(expect.arrayContaining([expect.objectContaining({ to: u.gsana.username, item: 'Matapa' })]));
  });

  it('apagar o post: os brindes continuam a contar no perfil, sem a ligação ao post', async () => {
    const { gsana, gsbia } = u;
    const matapa = item['com-matapa'];
    const before = (await level(gsana, gsana)).cheers;
    const itemBefore = (await theirGeleira(gsbia, gsana)).find((i) => i.id === matapa)!.cheers;
    await api().delete(`/api/v1/posts/${post.id}`).set(auth(gsana)).expect(204);
    expect((await level(gsana, gsana)).cheers).toBe(before);
    expect((await theirGeleira(gsbia, gsana)).find((i) => i.id === matapa)!.cheers).toBe(itemBefore);
    const left = await pool.query('SELECT count(*)::int AS n FROM taste.geleira_item_cheers WHERE source_post_id = $1', [post.id]);
    expect(left.rows[0].n).toBe(0);
    const g = await pool.query('SELECT count(*)::int AS n FROM taste.geleira_cheers WHERE source_post_id = $1', [post.id]);
    expect(g.rows[0].n).toBe(0);
    const list = (await api().get(`/api/v1/users/${gsana.username}/geleira/cheers`).set(auth(gsana)).expect(200)).body.items as { post?: unknown }[];
    expect(list.every((i) => i.post === undefined)).toBe(true);
    // O post já não existe: nem se vê, nem se brinda nele.
    await getPost(gsbia, post.id).expect(404);
    await cheerOnPost(gsbia, post.id, matapa, false).expect(404);
  });

  it('apagar a conta: os brindes aos itens (dados e recebidos) e o retrato dos posts saem', async () => {
    const { gscar } = u;
    // gscar partilha a geleira e recebe um brinde; depois apaga a conta.
    await api().put(`/api/v1/geleira/me/items/${item['com-matapa']}`).set(auth(gscar)).send({}).expect(204);
    const p = (await share(gscar).expect(201)).body as GPost;
    await cheerOnPost(u.gsbia, p.id, item['com-matapa']).expect(200);
    await api().post('/api/v1/auth/delete-account').set(auth(gscar)).send({ confirmUsername: gscar.username, password: PASSWORD }).expect(204);
    const c = await pool.query('SELECT count(*)::int AS n FROM taste.geleira_item_cheers WHERE owner_id = $1 OR user_id = $1', [gscar.id]);
    expect(c.rows[0].n).toBe(0);
    const g = await pool.query('SELECT geleira FROM content.posts WHERE id = $1', [p.id]);
    expect(g.rows[0].geleira).toBeNull();
  });
});
