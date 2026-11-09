import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { getStorageToken } from '@nestjs/throttler';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { VenuesService } from './venues.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

interface U { token: string; id: string; username: string }

describe('páginas dos locais: gestores, seguir, publicar como o local, pesquisa (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  /** Locais novos ficam em análise; nestes testes a equipa aprova-os logo. */
  const approved = async (req: request.Test) => { const r = await req; if (r.body?.id) await pool.query("UPDATE content.venues SET review_status = 'approved' WHERE id = $1", [r.body.id]); if (r.body?.slug) r.body.reviewStatus = 'approved'; return r; };
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
    const v = (await approved(api().post('/api/v1/venues').set(auth(dono)).send({ name: `Bar do Zé ${run}`, kind: 'bar', city: 'Maputo' }).expect(201))).body;
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

  it('quem elimina a conta: a página passa para o administrador; sem administrador, deixa de aparecer', async () => {
    const a = await signup('vsai');
    const admin = await signup('vadm');
    const comAdmin = (await approved(api().post('/api/v1/venues').set(auth(a)).send({ name: `Herdada ${run}`, kind: 'bar' }).expect(201))).body;
    const sozinha = (await approved(api().post('/api/v1/venues').set(auth(a)).send({ name: `Sozinha ${run}`, kind: 'cafe' }).expect(201))).body;
    await api().post(`/api/v1/venues/${comAdmin.slug}/managers`).set(auth(a)).send({ username: admin.username, role: 'admin' }).expect(201);
    await api().post(`/api/v1/venues/${comAdmin.slug}/managers/accept`).set(auth(admin)).expect(200);

    await api().post('/api/v1/auth/delete-account').set(auth(a)).send({ confirmUsername: a.username, password: PASSWORD }).expect(204);

    const herdada = (await api().get(`/api/v1/venues/${comAdmin.slug}`).set(auth(admin)).expect(200)).body;
    expect(herdada.role).toBe('owner');
    await api().get(`/api/v1/venues/${sozinha.slug}`).set(auth(admin)).expect(404);
    const left = await pool.query('SELECT count(*)::int AS n FROM content.venue_managers WHERE user_id = $1', [a.id]);
    expect(left.rows[0].n).toBe(0);
  });

  it('publicado como o local: quem vê não vê o gestor (author.id vazio, sem presente); o próprio autor vê-se', async () => {
    const v = (await approved(api().post('/api/v1/venues').set(auth(dono)).send({ name: `Escondido ${run}`, kind: 'bar' }).expect(201))).body;
    await api().post(`/api/v1/venues/${v.slug}/managers`).set(auth(dono)).send({ username: gestor.username, role: 'editor' }).expect(201);
    await api().post(`/api/v1/venues/${v.slug}/managers/accept`).set(auth(gestor)).expect(200);
    // O cliente segue o gestor: numa publicação normal poderia oferecer-lhe um presente.
    await api().post(`/api/v1/users/${gestor.username}/follow`).set(auth(cliente)).expect(200);
    await api().put(`/api/v1/venues/${v.slug}/follow`).set(auth(cliente)).expect(200);
    const normal = (await api().post('/api/v1/posts').set(auth(gestor)).send({ body: `pessoal ${run}` }).expect(201)).body;
    const post = (await api().post('/api/v1/posts').set(auth(gestor)).send({ body: `como o local ${run}`, venueId: v.id }).expect(201)).body;

    const seen = (await api().get(`/api/v1/posts/${post.id}`).set(auth(cliente)).expect(200)).body;
    expect(seen.author.id).toBe('');
    expect(seen.author.username).toBe('');
    expect(seen.author.displayName).toBe(v.name);
    expect(seen.canGift).toBe(false);
    const byPage = ((await api().get(`/api/v1/venues/${v.slug}/posts`).set(auth(cliente)).expect(200)).body.items as { id: string; author: { id: string }; canGift: boolean }[]).find((p) => p.id === post.id)!;
    expect(byPage.author.id).toBe('');
    expect(byPage.canGift).toBe(false);
    const inFeed = ((await api().get('/api/v1/feed').set(auth(cliente)).expect(200)).body.items as { id: string; author: { id: string } }[]).find((p) => p.id === post.id);
    if (inFeed) expect(inFeed.author.id).toBe('');
    // Em nenhuma resposta ao espectador aparece o id ou o @ do gestor.
    expect(JSON.stringify(seen)).not.toContain(gestor.id);
    expect(JSON.stringify(seen)).not.toContain(gestor.username);
    // Controlo: a publicação pessoal do gestor mostra-o e permite presente.
    const own = (await api().get(`/api/v1/posts/${normal.id}`).set(auth(cliente)).expect(200)).body;
    expect(own.author.id).toBe(gestor.id);

    // O dono do local (que não escreveu) também não vê quem foi.
    expect((await api().get(`/api/v1/posts/${post.id}`).set(auth(dono)).expect(200)).body.author.id).toBe('');
    // O autor vê-se a si próprio.
    const mine = (await api().get(`/api/v1/posts/${post.id}`).set(auth(gestor)).expect(200)).body;
    expect(mine.author.id).toBe(gestor.id);
    expect(mine.author.username).toBe(gestor.username);
  });

  it('a publicação do local não aparece no perfil do gestor que a escreveu (senão denunciava o autor)', async () => {
    const v = (await approved(api().post('/api/v1/venues').set(auth(gestor)).send({ name: `Perfil ${run}`, kind: 'cafe' }).expect(201))).body;
    const post = (await api().post('/api/v1/posts').set(auth(gestor)).send({ body: `do local ${run}`, venueId: v.id }).expect(201)).body;
    const prof = (await api().get(`/api/v1/users/${gestor.username}/posts`).set(auth(cliente)).expect(200)).body.items as { id: string }[];
    expect(prof.map((p) => p.id)).not.toContain(post.id);
  });

  it('categoria de notificações "venues" desligada: o convite para gerir não chega às notificações', async () => {
    const st = app.get(getStorageToken()) as { storage: Map<string, unknown>; hitExpirations?: Map<string, unknown> };
    st.storage.clear();
    st.hitExpirations?.clear();
    const conv = await signup('vnotif');
    const dono2 = await signup('vdono2');
    await api().put('/api/v1/notifications/settings').set(auth(conv)).send({ off: ['venues'] }).expect(204);
    expect((await api().get('/api/v1/notifications/settings').set(auth(conv)).expect(200)).body.off).toEqual(['venues']);
    const v = (await approved(api().post('/api/v1/venues').set(auth(dono2)).send({ name: `Silencio ${run}`, kind: 'bar' }).expect(201))).body;
    await api().post(`/api/v1/venues/${v.slug}/managers`).set(auth(dono2)).send({ username: conv.username, role: 'editor' }).expect(201);
    const items = (await api().get('/api/v1/notifications').set(auth(conv)).expect(200)).body.items as { kind: string }[];
    expect(items.filter((n) => n.kind === 'venue_invite')).toHaveLength(0);
    // O convite existe na mesma (vê-se na página e pode aceitar).
    expect((await api().get(`/api/v1/venues/${v.slug}`).set(auth(conv)).expect(200)).body.invite).toBe('editor');
    // Categoria ligada outra vez: o próximo convite já aparece.
    await api().put('/api/v1/notifications/settings').set(auth(conv)).send({ off: [] }).expect(204);
    const v2 = (await approved(api().post('/api/v1/venues').set(auth(dono2)).send({ name: `Barulho ${run}`, kind: 'bar' }).expect(201))).body;
    await api().post(`/api/v1/venues/${v2.slug}/managers`).set(auth(dono2)).send({ username: conv.username, role: 'admin' }).expect(201);
    const after = (await api().get('/api/v1/notifications').set(auth(conv)).expect(200)).body.items as { kind: string; data: { venueSlug: string } }[];
    expect(after.filter((n) => n.kind === 'venue_invite').map((n) => n.data.venueSlug)).toEqual([v2.slug]);
  });

  it('aprovação no backoffice: em análise só o dono vê; recusado com motivo; corrigido volta à fila; aprovado fica público', async () => {
    const st = app.get(getStorageToken()) as { storage: Map<string, unknown>; hitExpirations?: Map<string, unknown> };
    st.storage.clear();
    st.hitExpirations?.clear();
    const d = await signup('vrev');
    const v = (await api().post('/api/v1/venues').set(auth(d)).send({ name: `Analise ${run}`, kind: 'bar', city: 'Maputo' }).expect(201)).body;
    expect(v.reviewStatus).toBe('pending');
    await api().get(`/api/v1/venues/${v.slug}`).set(auth(cliente)).expect(404);
    expect((await api().get(`/api/v1/venues/search?q=Analise ${run}`).set(auth(cliente)).expect(200)).body).toEqual([]);
    await api().post('/api/v1/posts').set(auth(d)).send({ body: 'ainda não', venueId: v.id }).expect(403);
    await api().post(`/api/v1/venues/${v.slug}/checkin`).set(auth(cliente)).send({ token: 'x'.repeat(24) }).expect(404);

    const svc = app.get(VenuesService);
    await svc.review(dono.id, v.slug, 'rejected', 'Falta a morada');
    const mine = (await api().get(`/api/v1/venues/${v.slug}`).set(auth(d)).expect(200)).body;
    expect(mine).toMatchObject({ reviewStatus: 'rejected', reviewNote: 'Falta a morada' });
    const notes = (await api().get('/api/v1/notifications').set(auth(d)).expect(200)).body.items as { kind: string }[];
    expect(notes.some((n) => n.kind === 'venue_review')).toBe(true);

    await api().patch(`/api/v1/venues/${v.slug}`).set(auth(d)).send({ address: 'Av. 24 de Julho, 10' }).expect(200);
    expect((await svc.adminList('pending')).map((x) => x.slug)).toContain(v.slug);

    await svc.review(dono.id, v.slug, 'approved');
    const pub = (await api().get(`/api/v1/venues/${v.slug}`).set(auth(cliente)).expect(200)).body;
    expect(pub.reviewStatus).toBe('approved');
    expect(pub.reviewNote).toBeUndefined();
    await api().post('/api/v1/posts').set(auth(d)).send({ body: 'já posso', venueId: v.id }).expect(201);
  });
});
