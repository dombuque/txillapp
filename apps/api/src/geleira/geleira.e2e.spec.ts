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

describe('Geleira: gostos, privacidade, menores e boas-vindas (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (u: U) => ({ Authorization: `Bearer ${u.token}` });
  const u: Record<string, U> = {};

  async function signup(name: string, birthDate = '1990-06-15'): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate, acceptTerms: true }).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  const catalog = async (v: U, q = '', kind?: string) => (await api().get('/api/v1/geleira/catalog').query({ q, kind }).set(auth(v)).expect(200)).body as { id: string; name: string; alcoholic: boolean; mine: boolean; pending: boolean }[];
  const idOf = async (v: U, name: string) => (await catalog(v, name)).find((i) => i.name === name)!.id;
  const theirs = async (viewer: U, of: U) => (await api().get(`/api/v1/users/${of.username}/geleira`).set(auth(viewer)).expect(200)).body as { name: string; rating: number | null }[];

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'g'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    for (const n of ['ga', 'gb', 'gc']) u[n] = await signup(n);
    u.minor = await signup('gm', `${new Date().getUTCFullYear() - 15}-01-01`);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('o catálogo vem curado e a pesquisa ignora acentos e maiúsculas', async () => {
    expect((await catalog(u.ga)).length).toBeGreaterThan(90);
    expect((await catalog(u.ga, 'PASTEIS DE NATA')).map((i) => i.name)).toContain('Pastéis de nata');
    expect((await catalog(u.ga, 'camarao')).map((i) => i.name)).toContain('Camarão ao piri-piri');
  });

  it('juntar, dar nota, favorito e visibilidade; repetir o pedido dá o mesmo resultado', async () => {
    const matapa = await idOf(u.ga, 'Matapa');
    for (let n = 0; n < 2; n++) await api().put(`/api/v1/geleira/me/items/${matapa}`).set(auth(u.ga)).send({ rating: 5, favorite: true }).expect(204);
    const mine = (await api().get('/api/v1/geleira/me').set(auth(u.ga)).expect(200)).body;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ name: 'Matapa', rating: 5, favorite: true });
    await api().put(`/api/v1/geleira/me/items/${matapa}`).set(auth(u.ga)).send({ rating: 6 }).expect(400);
    // Alterar só o favorito não apaga a nota.
    await api().put(`/api/v1/geleira/me/items/${matapa}`).set(auth(u.ga)).send({ favorite: false }).expect(204);
    expect((await api().get('/api/v1/geleira/me').set(auth(u.ga))).body[0]).toMatchObject({ rating: 5, favorite: false });
  });

  it('privacidade da geleira inteira: todos, seguidores, amigos próximos ou só eu; efeito imediato', async () => {
    const xima = await idOf(u.ga, 'Xima com caril');
    await api().put(`/api/v1/geleira/me/items/${xima}`).set(auth(u.ga)).send({ rating: 4 }).expect(204);
    const set = (visibility: string) => api().put('/api/v1/geleira/me/settings').set(auth(u.ga)).send({ visibility }).expect(200);
    await api().put('/api/v1/geleira/me/settings').set(auth(u.ga)).send({ visibility: 'segredo' }).expect(400);

    await set('everyone');
    expect((await theirs(u.gb, u.ga)).length).toBeGreaterThan(0); // gb ainda não segue
    await set('followers');
    expect(await theirs(u.gb, u.ga)).toEqual([]); // não segue: vazio (não se distingue de "sem nada")
    await api().post(`/api/v1/users/${u.ga.username}/follow`).set(auth(u.gb)).expect(200);
    expect((await theirs(u.gb, u.ga)).length).toBeGreaterThan(0);
    await set('close_friends');
    expect(await theirs(u.gb, u.ga)).toEqual([]); // segue, mas não é amigo próximo
    await pool.query('INSERT INTO social.close_friends (owner_id, friend_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [u.ga.id, u.gb.id]);
    expect((await theirs(u.gb, u.ga)).length).toBeGreaterThan(0);
    await set('me');
    expect(await theirs(u.gb, u.ga)).toEqual([]);
    expect((await api().get('/api/v1/geleira/me').set(auth(u.ga))).body.length).toBeGreaterThan(0); // o dono vê sempre
    await set('everyone');
    await pool.query('DELETE FROM social.close_friends WHERE owner_id = $1', [u.ga.id]);
  });

  it('bloqueados e contas privadas não veem a geleira', async () => {
    await api().put(`/api/v1/blocks/${u.gc.username}`).set(auth(u.ga)).expect(200);
    await api().get(`/api/v1/users/${u.ga.username}/geleira`).set(auth(u.gc)).expect(404);
    await api().delete(`/api/v1/blocks/${u.gc.username}`).set(auth(u.ga)).expect(200);
    await api().patch('/api/v1/settings/privacy').set(auth(u.ga)).send({ isPrivate: true }).expect(200);
    await api().get(`/api/v1/users/${u.ga.username}/geleira`).set(auth(u.gc)).expect(404);
    await api().patch('/api/v1/settings/privacy').set(auth(u.ga)).send({ isPrivate: false }).expect(200);
  });

  it('menores não têm álcool: nem veem, nem juntam, nem sugerem', async () => {
    const adult = await catalog(u.gb, 'Laurentina');
    expect(adult[0]?.alcoholic).toBe(true);
    expect((await catalog(u.minor)).some((i) => i.alcoholic)).toBe(false);
    await api().put(`/api/v1/geleira/me/items/${adult[0].id}`).set(auth(u.minor)).send({ rating: 3 }).expect(404);
    await api().post('/api/v1/geleira/items').set(auth(u.minor)).send({ name: 'Cerveja nova', kind: 'bebida', category: 'cerveja', alcoholic: true }).expect(400);
    // Um adulto junta Laurentina; o menor não a vê na geleira dele (nem dele para ela).
    await api().put(`/api/v1/geleira/me/items/${adult[0].id}`).set(auth(u.gb)).send({ rating: 4 }).expect(204);
    expect((await theirs(u.minor, u.gb)).some((i) => i.name === 'Laurentina')).toBe(false);
    expect((await theirs(u.gc, u.gb)).some((i) => i.name === 'Laurentina')).toBe(true);
  });

  it('item sugerido fica pendente (só o autor o vê), sem duplicados, e a moderação aprova', async () => {
    const nome = `Bar do Ze ${run}`;
    const body = { name: nome, kind: 'sitio', category: 'noite' };
    const a = (await api().post('/api/v1/geleira/items').set(auth(u.gb)).send(body).expect(201)).body;
    expect(a.pending).toBe(true);
    const again = (await api().post('/api/v1/geleira/items').set(auth(u.gb)).send({ ...body, name: nome.toUpperCase() }).expect(201)).body;
    expect(again.id).toBe(a.id);
    // Outra pessoa não o vê no catálogo nem o consegue juntar.
    expect((await catalog(u.gc, nome)).some((i) => i.id === a.id)).toBe(false);
    await api().put(`/api/v1/geleira/me/items/${a.id}`).set(auth(u.gc)).send({}).expect(404);
    // Nem na geleira pública de quem o tem, enquanto pendente.
    expect((await theirs(u.gc, u.gb)).some((i) => i.name === nome)).toBe(false);
    await api().get('/api/v1/admin/geleira').set(auth(u.gb)).expect(403);
    await pool.query('UPDATE identity.users SET is_admin = true WHERE id = $1', [u.ga.id]);
    expect((await api().get('/api/v1/admin/geleira').set(auth(u.ga)).expect(200)).body.some((i: { id: string }) => i.id === a.id)).toBe(true);
    await api().post(`/api/v1/admin/geleira/${a.id}`).set(auth(u.ga)).send({ approve: true }).expect(204);
    expect((await theirs(u.gc, u.gb)).some((i) => i.name === nome)).toBe(true);
    await pool.query('UPDATE identity.users SET is_admin = false WHERE id = $1', [u.ga.id]);
  });

  it('bebidas por país: as do país vêm primeiro e as de outros países ficam marcadas como estrangeiras', async () => {
    await pool.query(`UPDATE identity.users SET country = 'MZ' WHERE id = $1`, [u.ga.id]);
    const mz = await catalog(u.ga, '', 'bebida');
    const reg = (name: string) => (mz as unknown as { name: string; region: string }[]).find((i) => i.name === name)?.region;
    expect(reg('Laurentina')).toBe('local');
    expect(reg('Cuca')).toBe('foreign');
    expect(reg('Heineken')).toBe('global');
    // As locais vêm antes das globais.
    const names = mz.map((i) => i.name);
    expect(names.indexOf('Laurentina')).toBeLessThan(names.indexOf('Heineken'));
    await pool.query(`UPDATE identity.users SET country = 'AO' WHERE id = $1`, [u.ga.id]);
    expect((await catalog(u.ga, 'Cuca', 'bebida') as unknown as { region: string }[])[0].region).toBe('local');
    await pool.query(`UPDATE identity.users SET country = NULL WHERE id = $1`, [u.ga.id]);
    expect((await catalog(u.ga, 'Cuca', 'bebida') as unknown as { region: string }[])[0].region).toBe('global');
    await pool.query(`UPDATE identity.users SET country = 'MZ' WHERE id = $1`, [u.ga.id]);
  });

  it('limite de 200 itens por pessoa', async () => {
    const ids = (await pool.query(`SELECT id FROM taste.items WHERE status = 'curated' AND NOT alcoholic LIMIT 1`)).rows.map((r) => r.id);
    expect(ids.length).toBe(1);
    // Enche com itens aprovados sintéticos.
    await pool.query(
      `INSERT INTO taste.items (id, slug, name, kind, category) SELECT md5('lim' || g)::uuid, 'lim-' || g || '-${run}', 'Lim ' || g, 'comida', 'rua' FROM generate_series(1, 200) g`,
    );
    await pool.query(`INSERT INTO taste.user_items (user_id, item_id) SELECT $1, id FROM taste.items WHERE slug LIKE 'lim-%-${run}'`, [u.gc.id]);
    const extra = await idOf(u.gc, 'Matapa');
    await api().put(`/api/v1/geleira/me/items/${extra}`).set(auth(u.gc)).send({ rating: 3 }).expect(409);
    // Mudar um que já tem continua a funcionar.
    const have = (await pool.query(`SELECT item_id FROM taste.user_items WHERE user_id = $1 LIMIT 1`, [u.gc.id])).rows[0].item_id;
    await api().put(`/api/v1/geleira/me/items/${have}`).set(auth(u.gc)).send({ rating: 2 }).expect(204);
    await pool.query(`DELETE FROM taste.user_items WHERE user_id = $1`, [u.gc.id]);
    await pool.query(`DELETE FROM taste.items WHERE slug LIKE 'lim-%-${run}'`);
  });

  it('definições, exportação e eliminar conta cobrem a geleira', async () => {
    expect((await api().put('/api/v1/geleira/me/settings').set(auth(u.gb)).send({ matching: false }).expect(200)).body).toEqual({ matching: false, visibility: 'everyone' });
    const exp = (await api().get('/api/v1/me/export').set(auth(u.gb))).body;
    expect(JSON.stringify(exp)).toContain('Laurentina');
    await api().post('/api/v1/auth/delete-account').set(auth(u.gb)).send({ confirmUsername: u.gb.username, password: PASSWORD }).expect(204);
    const left = await pool.query('SELECT count(*)::int AS n FROM taste.user_items WHERE user_id = $1', [u.gb.id]);
    expect(left.rows[0].n).toBe(0);
  });

  it('visita guiada: conta nova ainda não foi recebida; saltar guarda no servidor', async () => {
    expect((await api().get('/api/v1/settings/privacy').set(auth(u.gc)).expect(200)).body.welcomed).toBe(false);
    const done = (await api().put('/api/v1/users/me/welcomed').set(auth(u.gc)).expect(200)).body;
    expect(done.welcomed).toBe(true);
    expect((await api().get('/api/v1/settings/privacy').set(auth(u.gc))).body.welcomed).toBe(true);
  });

  it('nível da geleira: pontos premeiam álcool e vibes de festa; título do topo respeita a idade; quem não pode ver não vê', async () => {
    const { ga, gb } = u;
    const level = (viewer: U, of: U) => api().get(`/api/v1/users/${of.username}/geleira/level`).set(auth(viewer));
    await api().put('/api/v1/geleira/me/settings').set(auth(ga)).send({ visibility: 'everyone' }).expect(200);
    await pool.query('DELETE FROM taste.user_items WHERE user_id = $1', [ga.id]);
    const mine = (await level(ga, ga).expect(200)).body;
    expect(mine.level).toBe(0);
    expect(mine.title).toBe('Geleira seca');

    // Uma cerveja (álcool, 4 pontos) pesa mais do que uma água (1 ponto).
    const beer = (await pool.query(`SELECT id FROM taste.items WHERE status = 'curated' AND kind = 'bebida' AND alcoholic LIMIT 1`)).rows[0].id as string;
    const water = (await pool.query(`SELECT id FROM taste.items WHERE status = 'curated' AND kind = 'bebida' AND NOT alcoholic LIMIT 1`)).rows[0].id as string;
    await pool.query(`INSERT INTO taste.user_items (user_id, item_id) VALUES ($1, $2), ($1, $3)`, [ga.id, beer, water]);
    await pool.query('UPDATE ledger.accounts SET balance = 0 WHERE user_id = $1', [ga.id]);
    expect((await level(gb, ga).expect(200)).body).toMatchObject({ points: 5, level: 1, title: 'A txilar', toNext: 5, txillContribution: 0 });
    // Os Txills também contam: 1 ponto por cada 200, até 15.
    await pool.query('UPDATE ledger.accounts SET balance = 1000 WHERE user_id = $1', [ga.id]);
    expect((await level(gb, ga).expect(200)).body).toMatchObject({ points: 10, level: 2, txillContribution: 5 });
    await pool.query('UPDATE ledger.accounts SET balance = 100000 WHERE user_id = $1', [ga.id]);
    expect((await level(gb, ga).expect(200)).body.txillContribution).toBe(15); // tem teto
    await pool.query('UPDATE ledger.accounts SET balance = 0 WHERE user_id = $1', [ga.id]);

    // O título do topo depende da idade (sem nunca mostrar a data): 20 anos, 35 e 60.
    await pool.query(`UPDATE taste.user_items SET favorite = true WHERE user_id = $1`, [ga.id]); // +2 pontos
    await pool.query(`INSERT INTO taste.user_items (user_id, item_id, favorite) SELECT $1, i.id, true FROM taste.items i WHERE i.status = 'curated' AND i.alcoholic AND i.id <> $2 LIMIT 12`, [ga.id, beer]);
    const top = async (birth: string) => {
      await pool.query('UPDATE identity.users SET birth_date = $2 WHERE id = $1', [ga.id, birth]);
      return (await level(gb, ga).expect(200)).body;
    };
    const year = new Date().getUTCFullYear();
    const young = await top(`${year - 20}-01-01`);
    expect(young).toMatchObject({ level: 4, title: 'Lenda da paulada', toNext: null });
    expect((await top(`${year - 35}-01-01`)).title).toBe('Mestre da paulada');
    expect((await top(`${year - 60}-01-01`)).title).toBe('Madala da paulada');
    expect(JSON.stringify(young)).not.toMatch(/birth|19\d\d-|20\d\d-/);

    // Visibilidade: só eu → os outros não veem.
    await api().put('/api/v1/geleira/me/settings').set(auth(ga)).send({ visibility: 'me' }).expect(200);
    await level(gb, ga).expect(404);
    await level(ga, ga).expect(200);
  });
});
