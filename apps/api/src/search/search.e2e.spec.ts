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

describe('hashtags, em alta e pesquisa melhor (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const tagA = `praia${run}`; // únicas desta execução
  const tagB = `cafe${run}`;
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  const u: Record<string, U> = {};

  async function signup(name: string, displayName = name): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  const post = async (a: U, body: string) => (await api().post('/api/v1/posts').set(auth(a)).send({ body }).expect(201)).body as { id: string };
  const get = async (x: U, path: string) => (await api().get(`/api/v1/${path}`).set(auth(x)).expect(200)).body;

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'h'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    u.sa = await signup('sa', `Margarida ${run}`);
    u.sb = await signup('sb');
    u.sc = await signup('sc');
    u.sp = await signup('sp'); // conta privada
    await api().patch('/api/v1/settings/privacy').set(auth(u.sp)).send({ isPrivate: true }).expect(200);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('hashtags: extrai sem acentos nem maiúsculas, lista na página da tag e respeita privacidade', async () => {
    const { sa, sb, sc, sp } = u;
    const p1 = await post(sa, `Dia de #${tagA[0].toUpperCase()}${tagA.slice(1)} e #${tagB} 🍻 #Ç #a email@x.com#nao`);
    const p2 = await post(sb, `Outra #${tagA} com amigos`);
    const priv = await post(sp, `conta privada #${tagA}`);
    const tags = (await pool.query('SELECT tag FROM content.post_tags WHERE post_id = $1 ORDER BY tag', [p1.id])).rows.map((r) => r.tag);
    expect(tags).toEqual([tagB, tagA].sort()); // "#Ç", "#a" (curtas) e "x.com#nao" (colada) não contam

    const page = await get(sc, `tags/${tagA}`);
    expect(page).toMatchObject({ tag: tagA, posts: 2, authors: 2 }); // a privada não conta
    const ids = page.items.map((i: { id: string }) => i.id);
    expect(ids).toEqual([p2.id, p1.id]); // mais recentes primeiro
    expect(ids).not.toContain(priv.id);
    expect((await get(u.sa, `tags/${tagA.toUpperCase()}`)).tag).toBe(tagA); // maiúsculas dão na mesma

    // quem segue a conta privada já a vê na página da tag
    await api().post(`/api/v1/users/${sp.username}/follow`).set(auth(sc)).expect(200);
    await api().post(`/api/v1/follow-requests/${sc.username}/accept`).set(auth(sp)).expect((r) => expect([200, 204]).toContain(r.status));
    expect((await get(sc, `tags/${tagA}`)).items.map((i: { id: string }) => i.id)).toContain(priv.id);

    await api().get('/api/v1/tags/x').set(auth(sc)).expect(404); // curta demais
    await api().delete(`/api/v1/posts/${p2.id}`).set(auth(sb)).expect(204);
    expect((await get(sc, `tags/${tagA}`)).items.map((i: { id: string }) => i.id)).not.toContain(p2.id); // apagada some
  });

  it('em alta: hashtags públicas recentes, mais contas diferentes pesa mais; autocompletar por prefixo', async () => {
    const { sa, sb, sc } = u;
    const hot = `quente${run}`;
    const solo = `solo${run}`;
    for (const x of [sa, sb, sc]) await post(x, `a malta toda em #${hot}`);
    await post(sa, `#${solo} #${solo} sozinho`);
    await post(sa, `#${solo} outra`);
    await post(sa, `#${solo} mais uma`);
    // a cache de tendências dura 1 minuto: este teste usa uma instância nova
    const t = (await get(sa, 'search/trending')).tags as { tag: string; authors: number }[];
    const hotIdx = t.findIndex((x) => x.tag === hot);
    const soloIdx = t.findIndex((x) => x.tag === solo);
    expect(hotIdx).toBeGreaterThanOrEqual(0);
    if (soloIdx >= 0) expect(hotIdx).toBeLessThan(soloIdx); // 3 contas diferentes batem 1 conta com 3 publicações
    expect(t[hotIdx].authors).toBe(3);

    const auto = (await get(sa, `search/tags?q=quen`)).tags as { tag: string }[];
    expect(auto.map((x) => x.tag)).toContain(hot);
    expect((await get(sa, `search/tags?q=%25`)).tags).toEqual([]);
  });

  it('pesquisa: texto completo sem acentos e por prefixo; nomes parecidos; "#" pesquisa só hashtags', async () => {
    const { sa, sb } = u;
    const word = `abacaxi${run}`;
    const p = await post(sa, `Hoje comi muito ${word} na praia, amanhã há mais`);
    const found = async (q: string) => ((await get(sb, `search?q=${encodeURIComponent(q)}`)).posts as { id: string }[]).map((x) => x.id);
    expect(await found(word)).toContain(p.id);
    expect(await found(word.slice(0, 9))).toContain(p.id); // prefixo
    expect(await found(`amanha ${word}`)).toContain(p.id); // sem acento e várias palavras
    expect(await found('amanhã')).toContain(p.id);

    // nomes: "Margarita" ≈ "Margarida <run>"
    const people = ((await get(sb, `search?q=${encodeURIComponent('Margarita ' + run)}`)).people as { username: string }[]).map((x) => x.username);
    expect(people).toContain(sa.username);

    const onlyTags = await get(sb, `search?q=${encodeURIComponent('#' + tagA.slice(0, 7))}`);
    expect(onlyTags.people).toEqual([]);
    expect(onlyTags.tags.map((t: { tag: string }) => t.tag)).toContain(tagA);
    expect((await get(sb, 'search/suggest?q=Marg')).people.length).toBeLessThanOrEqual(5);
  });
});
