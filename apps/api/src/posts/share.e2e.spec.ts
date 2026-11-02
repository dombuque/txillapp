import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';

describe('links curtos e cartões de pré-visualização (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  let ana: { token: string; id: string; username: string };
  let rui: { token: string; id: string; username: string };
  const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });

  async function signup(name: string) {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste & Cia`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    return { token: r.body.accessToken as string, id: r.body.user.id as string, username };
  }

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 's'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    ana = await signup('shana');
    rui = await signup('shrui');
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('cada publicação tem um código curto; abre-se pelo código e pelo id antigo', async () => {
    const p = (await api().post('/api/v1/posts').set(auth(ana)).send({ body: 'Levei o Teddy a passear <na zona> & "arredores"' }).expect(201)).body;
    expect(p.code).toMatch(/^[A-HJ-NP-Za-km-z2-9]{7}$/);
    const byCode = (await api().get(`/api/v1/posts/code/${p.code}`).set(auth(rui)).expect(200)).body;
    expect(byCode.id).toBe(p.id);
    expect((await api().get(`/api/v1/posts/code/${p.id}`).set(auth(rui)).expect(200)).body.code).toBe(p.code); // links antigos (com o id)
    await api().get('/api/v1/posts/code/nao-existe-1').set(auth(rui)).expect(404);
    await api().get(`/api/v1/posts/code/${p.code}`).expect(401);
    // Dois posts nunca partilham código.
    const q = (await api().post('/api/v1/posts').set(auth(ana)).send({ body: 'outro' }).expect(201)).body;
    expect(q.code).not.toBe(p.code);
  });

  it('o cartão de pré-visualização (para os robôs do WhatsApp e outras redes) leva nome e texto, escapados, sem precisar de sessão', async () => {
    const p = (await api().post('/api/v1/posts').set(auth(ana)).send({ body: 'Levei o Teddy a passear <na zona> & "arredores"' }).expect(201)).body;
    const html = (await api().get(`/api/v1/share/p/${p.code}`).set('Host', 'txillapp.com').expect(200)).text as string;
    expect(html).toContain('property="og:title" content="shana Teste &amp; Cia no Txillapp"');
    expect(html).toContain('Levei o Teddy a passear &lt;na zona&gt; &amp; &quot;arredores&quot;');
    expect(html).toContain('property="og:url" content="https://txillapp.com/p/' + p.code + '"');
    expect(html).not.toContain('<na zona>'); // nunca HTML cru vindo de utilizadores
    expect(html).toContain('og:image');
    expect((await api().get(`/api/v1/share/p/${p.id}`).expect(200)).text).toContain('shana Teste'); // link antigo
  });

  it('conta privada, publicação apagada ou código desconhecido: cartão genérico, sem revelar nada', async () => {
    const p = (await api().post('/api/v1/posts').set(auth(rui)).send({ body: 'segredo da conta privada' }).expect(201)).body;
    await api().patch('/api/v1/settings/privacy').set(auth(rui)).send({ isPrivate: true }).expect(200);
    for (const code of [p.code, 'ZzZzZz9', 'a'.repeat(5)]) {
      const html = (await api().get(`/api/v1/share/p/${code}`).expect(200)).text as string;
      expect(html).toContain('Txillapp, a rede da malta');
      expect(html).not.toContain('segredo');
      expect(html).not.toContain('shrui');
    }
    await api().patch('/api/v1/settings/privacy').set(auth(rui)).send({ isPrivate: false }).expect(200);
    await pool.query('UPDATE content.posts SET removed_at = now() WHERE id = $1', [p.id]);
    expect((await api().get(`/api/v1/share/p/${p.code}`).expect(200)).text).not.toContain('segredo');
  });

  it('pré-visualização pública (sem sessão): só leitura, só de publicações públicas', async () => {
    const p = (await api().post('/api/v1/posts').set(auth(ana)).send({ body: 'olá a quem ainda não entrou' }).expect(201)).body;
    const view = (await api().get(`/api/v1/public/posts/${p.code}`).expect(200)).body;
    expect(view).toMatchObject({ code: p.code, kind: 'post', body: 'olá a quem ainda não entrou', author: { username: ana.username }, media: [], counts: { cheers: 0, comments: 0 } });
    expect(JSON.stringify(view)).not.toMatch(/email|password|id"/i); // sem dados internos
    await api().get(`/api/v1/public/posts/${p.id}`).expect(200); // links antigos, com o id
    await api().get('/api/v1/public/posts/nao-existe-1').expect(404);
    await pool.query('UPDATE identity.users SET is_private = true WHERE id = $1', [ana.id]);
    await api().get(`/api/v1/public/posts/${p.code}`).expect(404); // conta privada: não se vê
    await pool.query('UPDATE identity.users SET is_private = false WHERE id = $1', [ana.id]);
  });
});
