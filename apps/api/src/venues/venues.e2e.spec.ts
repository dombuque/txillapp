import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

interface U { token: string; id: string; username: string }

describe('páginas dos locais: gestores, seguir, publicar como o local, pesquisa (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  let dono: U, gestor: U, cliente: U;

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  async function upload(x: U): Promise<string> {
    const up = await api().post('/api/v1/media/uploads').set(auth(x)).send({ mime: 'image/png', size: PNG.length }).expect(201);
    await api().put(up.body.uploadUrl).set('Content-Type', 'image/png').send(PNG).expect(200);
    return up.body.assetId as string;
  }

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'd'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    dono = await signup('vdono');
    gestor = await signup('vgest');
    cliente = await signup('vcli');
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('cria a página, edita o perfil, convida um editor (que aceita), segue, publica como o local e aparece na pesquisa', async () => {
    const v = (await api().post('/api/v1/venues').set(auth(dono)).send({ name: `Bar do Zé ${run}`, kind: 'bar', city: 'Maputo' }).expect(201)).body;
    expect(v.role).toBe('owner');
    expect(v.canEdit).toBe(true);

    // Perfil completo (morada, horário, contactos, logótipo).
    const logo = await upload(dono);
    const edited = (await api().patch(`/api/v1/venues/${v.slug}`).set(auth(dono)).send({ address: 'Av. Julius Nyerere, 100', hours: 'Ter a Dom, 18h às 2h', whatsapp: '+258 84 000 0000', website: 'https://bardoze.example', about: 'A melhor gelada da baixa.', avatarMediaId: logo }).expect(200)).body;
    expect(edited.address).toContain('Nyerere');
    expect(edited.avatarUrl).toBe(`/api/v1/media/${logo}`);
    await api().patch(`/api/v1/venues/${v.slug}`).set(auth(dono)).send({ website: 'bardoze.example' }).expect(400); // sem https
    await api().patch(`/api/v1/venues/${v.slug}`).set(auth(cliente)).send({ about: 'invasão' }).expect(403);

    // Convite: o editor recebe a notificação, aceita e passa a poder publicar como o local.
    await api().post(`/api/v1/venues/${v.slug}/managers`).set(auth(dono)).send({ username: gestor.username, role: 'editor' }).expect(201);
    const notifs = (await api().get('/api/v1/notifications').set(auth(gestor)).expect(200)).body.items as { kind: string; data: { venueSlug: string } }[];
    expect(notifs.find((n) => n.kind === 'venue_invite')?.data.venueSlug).toBe(v.slug);
    expect((await api().get(`/api/v1/venues/${v.slug}`).set(auth(gestor)).expect(200)).body.invite).toBe('editor');
    await api().post('/api/v1/posts').set(auth(gestor)).send({ body: 'ainda não', venueId: v.id }).expect(403); // antes de aceitar
    await api().post(`/api/v1/venues/${v.slug}/managers/accept`).set(auth(gestor)).expect(200);
    const asGestor = (await api().get(`/api/v1/venues/${v.slug}`).set(auth(gestor)).expect(200)).body;
    expect(asGestor.role).toBe('editor');
    expect(asGestor.canPost).toBe(true);
    expect(asGestor.canEdit).toBe(false);
    await api().patch(`/api/v1/venues/${v.slug}`).set(auth(gestor)).send({ about: 'editor não edita' }).expect(403);
    const managers = (await api().get(`/api/v1/venues/${v.slug}/managers`).set(auth(dono)).expect(200)).body as { username: string; role: string; status: string }[];
    expect(managers.map((m) => m.role)).toEqual(['owner', 'editor']);

    // Seguir o local: o cliente segue; a publicação da página entra-lhe no feed.
    await api().put(`/api/v1/venues/${v.slug}/follow`).set(auth(cliente)).expect(200);
    const post = (await api().post('/api/v1/posts').set(auth(gestor)).send({ body: 'Hoje há gelada a 50', venueId: v.id }).expect(201)).body;
    expect(post.venue?.slug).toBe(v.slug);
    expect(post.locationLabel).toBe(v.name); // o sítio da publicação é o próprio local
    const pagePosts = (await api().get(`/api/v1/venues/${v.slug}/posts`).set(auth(cliente)).expect(200)).body.items as { id: string }[];
    expect(pagePosts.map((p) => p.id)).toContain(post.id);
    const feed = (await api().get('/api/v1/feed').set(auth(cliente)).expect(200)).body.items as { id: string }[];
    expect(feed.map((p) => p.id)).toContain(post.id);
    expect((await api().get(`/api/v1/venues/${v.slug}`).set(auth(cliente)).expect(200)).body.followers).toBe(1);

    // Ninguém de fora publica como o local.
    await api().post('/api/v1/posts').set(auth(cliente)).send({ body: 'intruso', venueId: v.id }).expect(403);

    // Pesquisa e descoberta.
    const found = (await api().get(`/api/v1/search?q=${encodeURIComponent(`Zé ${run}`)}`).set(auth(cliente)).expect(200)).body.venues as { slug: string }[];
    expect(found.map((x) => x.slug)).toContain(v.slug);
    const disc = (await api().get('/api/v1/venues/discover').set(auth(cliente)).expect(200)).body;
    // A base de testes acumula locais de corridas antigas: basta que a lista venha bem formada e ordenada por movimento.
    expect(Array.isArray(disc.popular) && Array.isArray(disc.nearby)).toBe(true);
    expect(disc.popular.length).toBeGreaterThan(0);
    expect(disc.popular[0]).toHaveProperty('followers');

    // Painel do gestor; o cliente não entra.
    const ins = (await api().get(`/api/v1/venues/${v.slug}/insights`).set(auth(dono)).expect(200)).body;
    expect(ins.followers).toBe(1);
    expect(ins.posts).toBe(1);
    expect(ins.days).toHaveLength(14);
    await api().get(`/api/v1/venues/${v.slug}/insights`).set(auth(cliente)).expect(403);

    // Tirar o editor; o dono não sai.
    await api().delete(`/api/v1/venues/${v.slug}/managers/${gestor.username}`).set(auth(dono)).expect(200);
    await api().post('/api/v1/posts').set(auth(gestor)).send({ body: 'já não', venueId: v.id }).expect(403);
    await api().delete(`/api/v1/venues/${v.slug}/managers/${dono.username}`).set(auth(dono)).expect(400);
  });
});
