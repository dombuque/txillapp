import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { staffLogin } from '../staff/staff-test';
import { MSG } from './constants';
import { classify } from '../common/topics';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { SuperTxillService } from './supertxill.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';

interface U { token: string; id: string; username: string }

describe('SuperTxill: a IA na barra de pesquisa, em segundo plano, com limites (integração, IA simulada)', () => {
  let app: INestApplication;
  let pool: Pool;
  let bot: SuperTxillService;
  const run = Date.now().toString(36);
  let n = 0;
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  const thread = async (x: U) => (await pool.query('SELECT role, body FROM social.ai_messages WHERE user_id = $1 ORDER BY id', [x.id])).rows as { role: string; body: string }[];
  const waitFor = async (x: U, count: number) => {
    for (let i = 0; i < 40; i++) {
      const t = await thread(x);
      if (t.length >= count) return t;
      await new Promise((r) => setTimeout(r, 150));
    }
    return thread(x);
  };

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}${n++}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').set('X-Forwarded-For', `10.9.0.${(n % 250) + 1}`).send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: 'password-bem-longa-1', birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'e'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test', ANTHROPIC_API_KEY: 'x'.repeat(30), SUPERTXILL_DAILY_LIMIT: '3' }));
    await app.init();
    bot = app.get(SuperTxillService);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('o SuperTxill não é uma conta (nem aparece nas conversas); pergunta, resposta em segundo plano, só com o que a pessoa lhe perguntou; histórico e apagar', async () => {
    const a = await signup('sta');
    expect((await pool.query("SELECT 1 FROM identity.users WHERE username = 'supertxill'")).rowCount).toBe(0);
    await api().post('/api/v1/chat/with/supertxill').set(auth(a)).send({ kind: 'text', body: 'olá' }).expect(404);
    expect((await api().get('/api/v1/chat/conversations').set(auth(a)).expect(200)).body).toEqual([]);

    const seen: { role: string; content: string }[][] = [];
    bot.llm = async (h) => { seen.push(h); return 'Fixe! Experimenta uma nota curta.'; };
    const r = await api().post('/api/v1/supertxill/ask').set(auth(a)).send({ text: 'Dá-me uma ideia para uma nota' }).expect(201);
    expect(r.body.id).toBeTruthy();
    // Logo a seguir: pergunta guardada e a resposta a caminho.
    const first = (await api().get('/api/v1/supertxill').set(auth(a)).expect(200)).body;
    expect(first.messages[0]).toMatchObject({ role: 'user', body: 'Dá-me uma ideia para uma nota' });
    expect(first.enabled).toBe(true);
    const t = await waitFor(a, 2);
    expect(t.map((m) => m.body)).toContain('Fixe! Experimenta uma nota curta.');
    expect(seen[0]).toEqual([{ role: 'user', content: 'Dá-me uma ideia para uma nota' }]);
    const done = (await api().get('/api/v1/supertxill').set(auth(a)).expect(200)).body;
    expect(done.pending).toBe(false);
    // Cada pessoa só vê o seu histórico.
    const b = await signup('stb');
    expect((await api().get('/api/v1/supertxill').set(auth(b)).expect(200)).body.messages).toEqual([]);
    // Apagar.
    await api().post('/api/v1/supertxill/clear').set(auth(a)).expect(204);
    expect((await thread(a)).length).toBe(0);
  });

  it('limite diário (resposta simpática, sem chamar a IA); o texto ofensivo não entra; o resultado da IA passa pelo filtro; se falhar, mensagem segura', async () => {
    const a = await signup('stc');
    let calls = 0;
    bot.llm = async () => { calls++; return 'ok'; };
    for (let i = 0; i < 3; i++) {
      await api().post('/api/v1/supertxill/ask').set(auth(a)).send({ text: `pergunta ${i}` }).expect(201);
      await waitFor(a, (i + 1) * 2);
    }
    expect(calls).toBe(3);
    await api().post('/api/v1/supertxill/ask').set(auth(a)).send({ text: 'mais uma' }).expect(201);
    expect((await waitFor(a, 8)).map((m) => m.body)).toContain(MSG.daily);
    expect(calls).toBe(3);
    // Pergunta ofensiva: nem chega a ser guardada.
    const x = await signup('std');
    await api().post('/api/v1/supertxill/ask').set(auth(x)).send({ text: "vou matar-te seu filho da puta" }).expect(422);
    // Resposta ofensiva da IA: substituída.
    bot.llm = async () => 'vou matar-te seu filho da puta';
    await api().post('/api/v1/supertxill/ask').set(auth(x)).send({ text: 'diz algo' }).expect(201);
    expect((await waitFor(x, 2)).map((m) => m.body)).toEqual(['diz algo', MSG.refused]);
    // A IA falha.
    const y = await signup('ste');
    bot.llm = async () => { throw new Error('rede em baixo'); };
    await api().post('/api/v1/supertxill/ask').set(auth(y)).send({ text: 'olá' }).expect(201);
    expect((await waitFor(y, 2)).map((m) => m.body)).toContain(MSG.error);
    // Sem sessão não entra.
    await api().get('/api/v1/supertxill').expect(401);
    await api().post('/api/v1/supertxill/ask').send({ text: 'x' }).expect(401);
  });

  it('"Para ti": recomenda quem malta parecida com a pessoa segue, sem expor nomes, e respeita não-sugerível e bloqueios', async () => {
    const me = await signup('ml0');
    const peer = await signup('ml1'); // segue o mesmo que eu
    const star = await signup('ml2'); // seguido pelo peer, ainda não por mim
    const hidden = await signup('ml3'); // seguido pelo peer mas não aceita ser sugerido
    const common = await signup('ml4'); // seguido por mim e pelo peer
    const follow = (a: U, b: U) => api().post(`/api/v1/users/${b.username}/follow`).set(auth(a)).expect((r) => { if (r.status >= 400) throw new Error(`follow ${r.status}`); });
    await follow(me, common);
    await follow(peer, common);
    await follow(peer, star);
    await follow(peer, hidden);
    await pool.query('UPDATE identity.users SET suggestable = false WHERE id = $1', [hidden.id]);
    const list = (await api().get('/api/v1/supertxill/for-you').set(auth(me)).expect(200)).body as { username: string; reason: string }[];
    const names = list.map((x) => x.username);
    expect(names).toContain(star.username);
    expect(names).not.toContain(hidden.username);
    expect(names).not.toContain(common.username);
    expect(names).not.toContain(me.username);
    expect(names.indexOf(star.username)).toBeLessThan(names.indexOf(peer.username) === -1 ? 999 : names.indexOf(peer.username) + 1);
    expect(list.find((x) => x.username === star.username)!.reason).not.toContain(peer.username);
    await api().put(`/api/v1/blocks/${star.username}`).set(auth(me)).expect((r) => { if (r.status >= 400) throw new Error(`block ${r.status}`); });
    const after = ((await api().get('/api/v1/supertxill/for-you').set(auth(me)).expect(200)).body as { username: string }[]).map((x) => x.username);
    expect(after).not.toContain(star.username);
    await api().get('/api/v1/supertxill/for-you').expect(401);
  });

  it('preferências de notificações: desligar uma categoria deixa de criar essas notificações; os pedidos de seguir ficam sempre', async () => {
    const a = await signup('nf0');
    const b = await signup('nf1');
    const c = await signup('nf2');
    const d = (await api().get('/api/v1/notifications/settings').set(auth(a)).expect(200)).body;
    expect(d.off).toEqual([]);
    expect(d.categories).toContain('comments');
    await api().put('/api/v1/notifications/settings').set(auth(a)).send({ off: ['follows', 'gifts'] }).expect(204);
    await api().put('/api/v1/notifications/settings').set(auth(a)).send({ off: ['coisa-inventada'] }).expect(400);
    await api().post(`/api/v1/users/${a.username}/follow`).set(auth(b)).expect((r) => { if (r.status >= 400) throw new Error(`follow ${r.status}`); });
    expect((await pool.query("SELECT 1 FROM social.notifications WHERE user_id = $1 AND kind = 'follow'", [a.id])).rowCount).toBe(0);
    await api().put('/api/v1/notifications/settings').set(auth(a)).send({ off: [] }).expect(204);
    await api().post(`/api/v1/users/${a.username}/follow`).set(auth(c)).expect((r) => { if (r.status >= 400) throw new Error(`follow ${r.status}`); });
    expect((await pool.query("SELECT 1 FROM social.notifications WHERE user_id = $1 AND kind = 'follow'", [a.id])).rowCount).toBe(1);
    await api().get('/api/v1/notifications/settings').expect(401);
  });

  it('editar publicação (só o autor, filtro, marcada como editada) e comentários desativados por publicação e por story', async () => {
    const a = await signup('ed0');
    const b = await signup('ed1');
    const post = (await api().post('/api/v1/posts').set(auth(a)).set('Idempotency-Key', `ed-${run}`).send({ body: 'olá #um' }).expect(201)).body;
    const e = (await api().patch(`/api/v1/posts/${post.id}`).set(auth(a)).send({ body: 'olá editado #dois' }).expect(200)).body;
    expect(e.body).toBe('olá editado #dois');
    expect(e.editedAt).toBeTruthy();
    expect((await pool.query('SELECT tag FROM content.post_tags WHERE post_id = $1', [post.id])).rows.map((r) => r.tag)).toEqual(['dois']);
    await api().patch(`/api/v1/posts/${post.id}`).set(auth(b)).send({ body: 'roubado' }).expect(404);
    await api().patch(`/api/v1/posts/${post.id}`).set(auth(a)).send({ body: 'vou matar-te seu filho da puta' }).expect(422);
    await api().patch(`/api/v1/posts/${post.id}`).set(auth(a)).send({ body: '  ' }).expect(400);
    // Comentários.
    await api().post(`/api/v1/posts/${post.id}/comments`).set(auth(b)).send({ body: 'fixe' }).expect(201);
    const off = (await api().patch(`/api/v1/posts/${post.id}`).set(auth(a)).send({ commentsOff: true }).expect(200)).body;
    expect(off.commentsOff).toBe(true);
    expect(off.canComment).toBe(false);
    await api().post(`/api/v1/posts/${post.id}/comments`).set(auth(b)).send({ body: 'outra' }).expect(403);
    await api().patch(`/api/v1/posts/${post.id}`).set(auth(a)).send({ commentsOff: false }).expect(200);
    await api().post(`/api/v1/posts/${post.id}/comments`).set(auth(b)).send({ body: 'agora sim' }).expect(201);
  });

  it('visualização única em grupos: cada pessoa abre uma vez; o conteúdo só some quando todos abriram', async () => {
    const a = await signup('go0');
    const b = await signup('go1');
    const c = await signup('go2');
    for (const u of [b, c]) {
      await api().post(`/api/v1/users/${u.username}/follow`).set(auth(a)).expect((r) => { if (r.status >= 400) throw new Error(`follow ${r.status}`); });
      await api().post(`/api/v1/users/${a.username}/follow`).set(auth(u)).expect((r) => { if (r.status >= 400) throw new Error(`follow ${r.status}`); });
    }
    const g = (await api().post('/api/v1/chat/groups').set(auth(a)).send({ name: 'Grupo único', members: [b.username, c.username] }).expect(201)).body as { id: string };
    const sent = (await api().post(`/api/v1/chat/groups/${g.id}/messages`).set(auth(a)).send({ kind: 'text', body: 'segredo', once: true }).expect(201)).body as { id: string };
    const view = async (u: U) => ((await api().get(`/api/v1/chat/groups/${g.id}`).set(auth(u)).expect(200)).body.items as { id: string; body: string; viewOnce: boolean; opened: boolean }[]).find((m) => m.id === sent.id)!;
    expect(await view(b)).toMatchObject({ body: '', viewOnce: true, opened: false });
    expect(await view(a)).toMatchObject({ viewOnce: true, opened: false });
    await api().post(`/api/v1/chat/messages/${sent.id}/open`).set(auth(a)).expect(404); // o autor não abre a sua
    const first = await api().post(`/api/v1/chat/messages/${sent.id}/open`).set(auth(b)).expect(200);
    expect(first.body.body).toBe('segredo');
    await api().post(`/api/v1/chat/messages/${sent.id}/open`).set(auth(b)).expect(410); // cada pessoa abre uma vez
    expect(await view(b)).toMatchObject({ opened: true, body: '' });
    expect(await view(c)).toMatchObject({ opened: false });
    expect(await view(a)).toMatchObject({ opened: true });
    expect((await pool.query('SELECT body FROM social.messages WHERE id = $1', [sent.id])).rows[0].body).toBe('segredo'); // a c ainda não abriu
    const second = await api().post(`/api/v1/chat/messages/${sent.id}/open`).set(auth(c)).expect(200);
    expect(second.body.body).toBe('segredo');
    expect((await pool.query('SELECT body FROM social.messages WHERE id = $1', [sent.id])).rows[0].body).toBe(''); // todos abriram: apagado
    // Quem não é do grupo não abre.
    const out = await signup('go3');
    await api().post(`/api/v1/chat/messages/${sent.id}/open`).set(auth(out)).expect(404);
  });

  it('posts por sítio: no mesmo sítio e perto (só com o ponto do sítio, arredondado); respeita bloqueios', async () => {
    const a = await signup('pl0');
    const b = await signup('pl1');
    const mk = async (u: U, body: string, label: string, lat?: number, lng?: number) =>
      (await api().post('/api/v1/posts').set(auth(u)).set('Idempotency-Key', `pl-${run}-${body}`).send({ body, locationLabel: label, locationLat: lat, locationLng: lng }).expect(201)).body as { id: string };
    const p1 = await mk(a, `um${run}`, `Praia do Tofo ${run}`, -23.8512345, 35.5443211);
    await mk(a, `dois${run}`, `praia do tofo ${run}`, -23.8512, 35.5443);
    const p3 = await mk(a, `tres${run}`, 'Barra', -23.8, 35.5); // perto (~7 km)
    await mk(a, `quatro${run}`, 'Maputo', -25.96, 32.58); // longe
    expect((await pool.query('SELECT location_lat, location_lng FROM content.posts WHERE id = $1', [p1.id])).rows[0]).toEqual({ location_lat: -23.85, location_lng: 35.54 }); // arredondado a 2 casas (~1 km)
    const at = (await api().get(`/api/v1/feed/place?label=Praia%20do%20Tofo%20${run}&mode=at`).set(auth(b)).expect(200)).body as { items: { id: string; body: string }[]; hasNear: boolean };
    expect(at.items.map((x) => x.body).sort()).toEqual([`dois${run}`, `um${run}`]);
    expect(at.hasNear).toBe(true);
    const near = (await api().get(`/api/v1/feed/place?label=Praia%20do%20Tofo%20${run}&mode=near`).set(auth(b)).expect(200)).body as { items: { id: string; body: string }[] };
    expect(near.items.map((x) => x.body).filter((x) => x.endsWith(run)).sort()).toEqual([`dois${run}`, `tres${run}`, `um${run}`]);
    expect(near.items.some((x) => x.body === `quatro${run}`)).toBe(false);
    expect(p3.id).toBeTruthy();
    await api().put(`/api/v1/blocks/${a.username}`).set(auth(b)).expect((r) => { if (r.status >= 400) throw new Error(`block ${r.status}`); });
    expect(((await api().get(`/api/v1/feed/place?label=Praia%20do%20Tofo%20${run}&mode=at`).set(auth(b)).expect(200)).body as { items: unknown[] }).items).toEqual([]);
    await api().get('/api/v1/feed/place?label=x').expect(401);
  });

  it('sítios e segurança: menores ficam fora da descoberta e sem posição; o ponto só vem de posts que se podem ver; dá para tirar o local', async () => {
    const adult = await signup('sa0');
    const viewer = await signup('sa1');
    const minorName = `sm${run}${n++}`.slice(0, 28);
    const rm = await api().post('/api/v1/auth/register').set('X-Forwarded-For', `10.9.1.${(n % 250) + 1}`).send({ email: `${minorName}@example.com`, username: minorName, displayName: 'Menor Teste', password: 'password-bem-longa-1', birthDate: `${new Date().getUTCFullYear() - 16}-01-01`, acceptTerms: true }).expect(201);
    const minor: U = { token: rm.body.accessToken, id: rm.body.user.id, username: minorName };
    const label = `Escola Teste ${run}`;
    const mk = async (u: U, body: string, lat?: number, lng?: number) =>
      (await api().post('/api/v1/posts').set(auth(u)).send({ body, locationLabel: label, locationLat: lat, locationLng: lng }).expect(201)).body as { id: string };
    const mp = await mk(minor, `menor${run}`, -25.9, 32.5);
    const ap = await mk(adult, `adulto${run}`, -25.9, 32.5);
    expect((await pool.query('SELECT location_lat FROM content.posts WHERE id = $1', [mp.id])).rows[0].location_lat).toBeNull(); // menor: sem posição
    const at = (await api().get(`/api/v1/feed/place?label=${encodeURIComponent(label)}&mode=at`).set(auth(viewer)).expect(200)).body as { items: { body: string }[] };
    expect(at.items.map((x) => x.body)).toEqual([`adulto${run}`]); // o post do menor não aparece
    // O ponto do sítio não se deduz de posts que o espectador não pode ver (conta privada).
    await pool.query('UPDATE identity.users SET is_private = true WHERE id = $1', [adult.id]);
    const hidden = (await api().get(`/api/v1/feed/place?label=${encodeURIComponent(label)}&mode=near`).set(auth(viewer)).expect(200)).body as { hasNear: boolean; center: unknown; items: unknown[] };
    expect(hidden.hasNear).toBe(false);
    expect(hidden.center).toBeNull();
    expect(hidden.items).toEqual([]);
    await pool.query('UPDATE identity.users SET is_private = false WHERE id = $1', [adult.id]);
    // Tirar o local.
    await api().patch(`/api/v1/posts/${ap.id}`).set(auth(adult)).send({ clearLocation: true }).expect(200);
    expect((await pool.query('SELECT location_label, location_lat FROM content.posts WHERE id = $1', [ap.id])).rows[0]).toEqual({ location_label: null, location_lat: null });
  });

  it('estatísticas do próprio perfil: alcance, interações, visitas, destaque; público só com gente suficiente e sem identificar ninguém', async () => {
    const owner = await signup('in0');
    const fan = await signup('in1');
    const post = (await api().post('/api/v1/posts').set(auth(owner)).send({ body: `estatistica${run}` }).expect(201)).body as { id: string };
    await api().post('/api/v1/feed/seen').set(auth(fan)).send({ ids: [post.id] }).expect((r) => { if (r.status >= 400) throw new Error(`seen ${r.status}`); });
    await api().post(`/api/v1/posts/${post.id}/cheers`).set(auth(fan)).expect((r) => { if (r.status >= 400) throw new Error(`cheer ${r.status}`); });
    await api().post(`/api/v1/posts/${post.id}/comments`).set(auth(fan)).send({ body: 'fixe' }).expect(201);
    await api().get(`/api/v1/users/${owner.username}`).set(auth(fan)).expect(200); // visita ao perfil
    await api().get(`/api/v1/users/${owner.username}`).set(auth(fan)).expect(200); // a mesma pessoa no mesmo dia conta uma vez
    await api().get(`/api/v1/users/${owner.username}`).set(auth(owner)).expect(200); // o dono não conta
    await new Promise((r) => setTimeout(r, 300));
    const g = (await api().get('/api/v1/insights?days=7&tz=120').set(auth(owner)).expect(200)).body;
    expect(g.days).toBe(7);
    expect(g.overview).toMatchObject({ reach: 1, interactions: 2, profileVisitors: 1, followers: 0 });
    expect(g.interactions).toMatchObject({ cheers: 1, comments: 1 });
    expect(g.series).toHaveLength(7);
    expect(g.hours).toHaveLength(24);
    expect(g.top[0]).toMatchObject({ id: post.id, cheers: 1, comments: 1, reach: 1 });
    expect(g.audience).toMatchObject({ enough: false, minimum: 20 });
    // Cada pessoa só vê as suas: o fan não tem nada.
    const f = (await api().get('/api/v1/insights?days=bad').set(auth(fan)).expect(200)).body;
    expect(f.days).toBe(30);
    expect(f.overview.reach).toBe(0);
    await api().get('/api/v1/insights').expect(401);
    // Com seguidores que cheguem, o público aparece (agregado).
    for (let k = 0; k < 20; k++) {
      const u = await signup(`ig${k}`);
      await api().post(`/api/v1/users/${owner.username}/follow`).set(auth(u)).expect((r) => { if (r.status >= 400) throw new Error(`follow ${r.status}`); });
    }
    const big = (await api().get('/api/v1/insights?days=30').set(auth(owner)).expect(200)).body;
    expect(big.audience.enough).toBe(true);
    expect(big.overview.followers).toBe(20);
    expect(big.overview.newFollowers).toBe(20);
    expect(JSON.stringify(big.audience)).not.toContain(owner.username);
  });

  it('guardar publicações: privado, lista pessoal por ordem, e o que deixa de se poder ver sai da lista', async () => {
    const a = await signup('sv0');
    const b = await signup('sv1');
    const p1 = (await api().post('/api/v1/posts').set(auth(a)).send({ body: `guardar1${run}` }).expect(201)).body as { id: string };
    const p2 = (await api().post('/api/v1/posts').set(auth(a)).send({ body: `guardar2${run}` }).expect(201)).body as { id: string };
    expect((await api().put(`/api/v1/posts/${p1.id}/save`).set(auth(b)).expect(200)).body.saved).toBe(true);
    await api().put(`/api/v1/posts/${p1.id}/save`).set(auth(b)).expect(200); // repetir não duplica
    await api().put(`/api/v1/posts/${p2.id}/save`).set(auth(b)).expect(200);
    const list = (await api().get('/api/v1/feed/saved').set(auth(b)).expect(200)).body as { items: { id: string; saved: boolean }[] };
    expect(list.items.map((x) => x.id)).toEqual([p2.id, p1.id]); // o mais recente primeiro
    expect(list.items.every((x) => x.saved)).toBe(true);
    // Privado: o autor não vê nada disto e o seu próprio post não aparece como guardado.
    expect(((await api().get('/api/v1/feed/saved').set(auth(a)).expect(200)).body as { items: unknown[] }).items).toEqual([]);
    expect(((await api().get(`/api/v1/posts/${p1.id}`).set(auth(a)).expect(200)).body as { saved: boolean }).saved).toBe(false);
    await api().put(`/api/v1/posts/${p1.id}/save`).expect(401);
    // Tirar dos guardados.
    expect((await api().delete(`/api/v1/posts/${p1.id}/save`).set(auth(b)).expect(200)).body.saved).toBe(false);
    // Se o autor bloqueia, deixa de se ver.
    await api().put(`/api/v1/blocks/${b.username}`).set(auth(a)).expect((r) => { if (r.status >= 400) throw new Error(`block ${r.status}`); });
    expect(((await api().get('/api/v1/feed/saved').set(auth(b)).expect(200)).body as { items: unknown[] }).items).toEqual([]);
    await api().put(`/api/v1/posts/${p2.id}/save`).set(auth(b)).expect(404);
  });

  it('Explorar: temas, "Para ti" que aprende com o que se brinda, só o que se pode ver (sem menores nem bloqueados)', async () => {
    await pool.query("UPDATE content.posts SET topics = '{}' WHERE topics && ARRAY['bebidas','desporto'] AND body NOT LIKE '%' || $1 || '%'", [run]);
    const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
    const up = async (u: U) => {
      const r = await api().post('/api/v1/media/uploads').set(auth(u)).send({ mime: 'image/png', size: PNG.length }).expect(201);
      await api().put(r.body.uploadUrl).set('Content-Type', 'image/png').send(PNG).expect(200);
      return r.body.assetId as string;
    };
    const author = await signup('xa0');
    const author2 = await signup('xa1');
    const me = await signup('xv0');
    const mk = async (u: U, body: string) => {
      const mediaId = await up(u);
      return (await api().post('/api/v1/posts').set(auth(u)).send({ body, mediaIds: [mediaId] }).expect(201)).body as { id: string };
    };
    const futebol = await mk(author, `Golo no estadio hoje, grande jogo de futebol ${run}`);
    const cerveja = await mk(author2, `Uma cerveja gelada com a malta no bar ${run}`);
    const t = (await pool.query('SELECT id, topics FROM content.posts WHERE id = ANY($1)', [[futebol.id, cerveja.id]])).rows;
    expect(t.find((x) => x.id === futebol.id).topics).toContain('desporto');
    expect(t.find((x) => x.id === cerveja.id).topics).toContain('bebidas');
    // Por tema.
    const des = (await api().get('/api/v1/feed/explore?topic=desporto').set(auth(me)).expect(200)).body as { items: { id: string }[] };
    expect(des.items.map((x) => x.id)).toContain(futebol.id);
    expect(des.items.map((x) => x.id)).not.toContain(cerveja.id);
    const topics = (await api().get('/api/v1/feed/explore/topics').set(auth(me)).expect(200)).body as { id: string; label: string }[];
    expect(topics.map((x) => x.id)).toEqual(expect.arrayContaining(['desporto', 'bebidas']));
    // "Para ti": depois de brindar desporto, o desporto sobe acima do resto.
    await api().post(`/api/v1/posts/${futebol.id}/cheers`).set(auth(me)).expect((r) => { if (r.status >= 400) throw new Error(`cheer ${r.status}`); });
    const author3 = await signup('xa2');
    const outro = await mk(author3, `Futebol de rua, golo bonito ${run}`);
    const fy = (await api().get('/api/v1/feed/explore').set(auth(me)).expect(200)).body as { items: { id: string }[] };
    const ids = fy.items.map((x) => x.id);
    expect(ids).toContain(outro.id);
    expect(ids.indexOf(outro.id)).toBeLessThan(ids.indexOf(cerveja.id) === -1 ? 999 : ids.indexOf(cerveja.id));
    expect(ids).not.toContain(me.id);
    // Bloqueio: o autor bloqueado desaparece.
    await api().put(`/api/v1/blocks/${author3.username}`).set(auth(me)).expect((r) => { if (r.status >= 400) throw new Error(`block ${r.status}`); });
    expect(((await api().get('/api/v1/feed/explore').set(auth(me)).expect(200)).body as { items: { id: string }[] }).items.map((x) => x.id)).not.toContain(outro.id);
    await api().get('/api/v1/feed/explore').expect(401);
  });

  it('temas: o humor é classificado por assunto e as hashtags pesam mais', () => {
    expect(classify('Quando o chefe marca reunião na sexta-feira à tarde kkk')).toEqual(expect.arrayContaining(['humor-trabalho']));
    expect(classify('A minha namorada quando eu esqueço o aniversário')).toEqual(expect.arrayContaining(['humor-relacoes']));
    expect(classify('O chapa hoje estava cheio e o trânsito parado, só em Maputo')).toEqual(expect.arrayContaining(['humor-rua']));
    expect(classify('o meu filho com a birra na loja')).toEqual(expect.arrayContaining(['humor-familia']));
    expect(classify('Matapa com caranguejo para o almoço')).toContain('comida');
    expect(classify('bom dia', ['futebol'])).toContain('desporto');
    expect(classify('Texto sem nada de especial aqui')).toEqual([]);
    expect(classify('golo golo golo futebol campeonato jogo equipa estadio treino cerveja').length).toBeLessThanOrEqual(3);
  });

  it('ensinar o algoritmo: preferências por tema e interessado / não interessado', async () => {
    await pool.query("UPDATE content.posts SET topics = '{}' WHERE topics && ARRAY['bebidas','desporto'] AND body NOT LIKE '%' || $1 || '%'", [run]);
    const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
    const up = async (u: U) => {
      const r = await api().post('/api/v1/media/uploads').set(auth(u)).send({ mime: 'image/png', size: PNG.length }).expect(201);
      await api().put(r.body.uploadUrl).set('Content-Type', 'image/png').send(PNG).expect(200);
      return r.body.assetId as string;
    };
    const au = await signup('al0');
    const me = await signup('al1');
    const mk = async (body: string) => {
      const mediaId = await up(au);
      return (await api().post('/api/v1/posts').set(auth(au)).send({ body, mediaIds: [mediaId] }).expect(201)).body as { id: string };
    };
    const a = await mk(`Cerveja gelada no bar com a malta ${run}`);
    const b = await mk(`Golo de futebol no estadio ${run}`);
    const ids = async (topic: string) => ((await api().get(`/api/v1/feed/explore?topic=${topic}&limit=30`).set(auth(me)).expect(200)).body as { items: { id: string }[] }).items.map((x) => x.id);
    expect(await ids('bebidas')).toContain(a.id);
    expect(await ids('desporto')).toContain(b.id);
    // Não interessado: esconde a publicação.
    await api().put(`/api/v1/posts/${a.id}/interest`).set(auth(me)).send({ value: -1 }).expect(200);
    expect(await ids('bebidas')).not.toContain(a.id);
    await api().put(`/api/v1/posts/${b.id}/interest`).set(auth(me)).send({ value: 5 }).expect(400);
    // Preferências por tema.
    expect((await api().put('/api/v1/feed/prefs').set(auth(me)).send({ topic: 'desporto', pref: 1 }).expect(200)).body).toEqual({ desporto: 1 });
    await api().put('/api/v1/feed/prefs').set(auth(me)).send({ topic: 'tema-inventado', pref: 1 }).expect(400);
    expect((await api().get('/api/v1/feed/prefs').set(auth(me)).expect(200)).body).toEqual({ desporto: 1 });
    // Repor.
    await api().delete('/api/v1/feed/prefs').set(auth(me)).expect(204);
    expect((await api().get('/api/v1/feed/prefs').set(auth(me)).expect(200)).body).toEqual({});
    expect(await ids('bebidas')).toContain(a.id); // voltou a aparecer
    await api().put(`/api/v1/posts/${a.id}/interest`).send({ value: 1 }).expect(401);
  });

  it('perfil completo: mostra o que falta e sobe quando se preenche', async () => {
    const a = await signup('pc0');
    const b = await signup('pc1');
    const c = await signup('pc2');
    const d = await signup('pc3');
    const g0 = (await api().get('/api/v1/users/me/completeness').set(auth(a)).expect(200)).body as { percent: number; steps: { id: string; done: boolean }[] };
    expect(g0.percent).toBe(0);
    expect(g0.steps.map((x) => x.id)).toEqual(['photo', 'bio', 'post', 'follow', 'geleira']);
    await api().patch('/api/v1/users/me').set(auth(a)).send({ bio: 'Malta do Txilla' }).expect(200);
    await api().post('/api/v1/posts').set(auth(a)).send({ body: `primeiro ${run}` }).expect(201);
    for (const u of [b, c, d]) await api().post(`/api/v1/users/${u.username}/follow`).set(auth(a)).expect((r) => { if (r.status >= 400) throw new Error(`follow ${r.status}`); });
    const g1 = (await api().get('/api/v1/users/me/completeness').set(auth(a)).expect(200)).body as { percent: number; steps: { id: string; done: boolean }[] };
    expect(g1.steps.filter((x) => x.done).map((x) => x.id)).toEqual(['bio', 'post', 'follow']);
    expect(g1.percent).toBe(60);
    await api().get('/api/v1/users/me/completeness').expect(401);
  });

  it('story com vídeo: aceita até 30 s e recusa mais longo', async () => {
    const a = await signup('sv9');
    const dir = mkdtempSync(join(tmpdir(), 'txstory-'));
    const make = (secs: number) => {
      const f = join(dir, `v${secs}.mp4`);
      execFileSync(ffmpegPath as unknown as string, ['-y', '-f', 'lavfi', '-i', `testsrc=size=320x568:rate=10:duration=${secs}`, '-f', 'lavfi', '-i', `sine=frequency=440:duration=${secs}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', f], { stdio: 'ignore' });
      return readFileSync(f);
    };
    const upload = async (bytes: Buffer) => {
      const r = await api().post('/api/v1/media/uploads').set(auth(a)).send({ mime: 'video/mp4', size: bytes.length }).expect(201);
      await api().put(r.body.uploadUrl).set('Content-Type', 'video/mp4').send(bytes).expect(200);
      const id = r.body.assetId as string;
      await api().post(`/api/v1/media/${id}/complete`).set(auth(a)).expect(200);
      for (let n = 0; n < 80; n++) {
        const st = (await api().get(`/api/v1/media/${id}/status`).set(auth(a)).expect(200)).body as { status: string };
        if (st.status !== 'processing') break;
        await new Promise((res) => setTimeout(res, 500));
      }
      return id;
    };
    const short = await upload(make(2));
    const ok = (await api().post('/api/v1/stories').set(auth(a)).send({ mediaId: short }).expect(201)).body as { mediaKind: string };
    expect(ok.mediaKind).toBe('video');
    const long = await upload(make(33));
    const bad = await api().post('/api/v1/stories').set(auth(a)).send({ mediaId: long }).expect(400);
    expect(JSON.stringify(bad.body)).toContain('30 segundos');
  });

  it('locais: criar, página, check-in só com o QR do local, um de 6 em 6 horas, selo só pela equipa', async () => {
    const owner = await signup('vo0');
    const fan = await signup('vo1');
    const name = `Bar do Teste ${run}`;
    const v = (await api().post('/api/v1/venues').set(auth(owner)).send({ name, kind: 'bar', city: 'Maputo', lat: -25.9692, lng: 32.5732 }).expect(201)).body as { slug: string; qrToken?: string; mine: boolean; verified: boolean };
    expect(v.mine).toBe(true);
    expect(v.verified).toBe(false);
    expect(v.qrToken).toHaveLength(24);
    // Os outros veem a página, mas nunca o código do QR.
    const seen = (await api().get(`/api/v1/venues/${v.slug}`).set(auth(fan)).expect(200)).body as { qrToken?: string; mine: boolean; name: string };
    expect(seen).toMatchObject({ mine: false, name });
    expect(seen.qrToken).toBeUndefined();
    expect(((await api().get(`/api/v1/venues/find?name=${encodeURIComponent(name.toLowerCase())}`).set(auth(fan)).expect(200)).body as { slug: string }).slug).toBe(v.slug);
    // Check-in: código errado não entra; o certo entra uma vez.
    await api().post(`/api/v1/venues/${v.slug}/checkin`).set(auth(fan)).send({ token: 'codigo-errado-123456' }).expect(403);
    const ok = (await api().post(`/api/v1/venues/${v.slug}/checkin`).set(auth(fan)).send({ token: v.qrToken }).expect(201)).body as { checkins: number; checkedIn: boolean };
    expect(ok).toMatchObject({ checkins: 1, checkedIn: true });
    await api().post(`/api/v1/venues/${v.slug}/checkin`).set(auth(fan)).send({ token: v.qrToken }).expect(409);
    // Se o dono muda o QR, o código antigo deixa de servir.
    const rot = (await api().post(`/api/v1/venues/${v.slug}/qr/rotate`).set(auth(owner)).expect(201)).body as { qrToken: string };
    expect(rot.qrToken).not.toBe(v.qrToken);
    await api().post(`/api/v1/venues/${v.slug}/qr/rotate`).set(auth(fan)).expect(403); // só o dono e os administradores
    // Selo: só a equipa.
    await api().put(`/api/v1/venues/${v.slug}/verified`).set(auth(fan)).send({ verified: true }).expect(401);
    const st = { Authorization: `Bearer ${(await staffLogin(app, 'selo')).token}` };
    await api().put(`/api/v1/venues/${v.slug}/verified`).set(st).send({ verified: true }).expect(200);
    expect(((await api().get(`/api/v1/venues/${v.slug}`).set(auth(fan)).expect(200)).body as { verified: boolean }).verified).toBe(true);
    const pending = (await api().get('/api/v1/venues/admin/list').set(auth(fan)).expect(401));
    expect(pending.status).toBe(401);
    const all = (await api().get('/api/v1/venues/admin/list?filter=all').set(st).expect(200)).body as { slug: string; verified: boolean }[];
    expect(all.find((x) => x.slug === v.slug)).toMatchObject({ verified: true });
    expect((await pool.query("SELECT 1 FROM audit.audit_log WHERE action = 'moderation.venue_verified' AND metadata->>'slug' = $1", [v.slug])).rowCount).toBe(1);
    // Limite de locais por pessoa e texto ofensivo.
    for (const n of ['Dois', 'Tres']) await api().post('/api/v1/venues').set(auth(owner)).send({ name: `${n} Local ${run}`, kind: 'cafe' }).expect(201);
    await api().post('/api/v1/venues').set(auth(owner)).send({ name: `Quatro Local ${run}`, kind: 'cafe' }).expect(403);
    await api().post('/api/v1/venues').set(auth(fan)).send({ name: 'vou matar-te seu filho da puta', kind: 'bar' }).expect(422);
    await api().get('/api/v1/venues/mine').expect(401);
  });

  it('construir o algoritmo: opções guardadas e validadas, pessoas a ver mais/menos, e o Explorar e os Reels continuam a responder com cada opção', async () => {
    const a = await signup('al0');
    const b = await signup('al1');
    const d = (await api().get('/api/v1/feed/settings').set(auth(a)).expect(200)).body;
    expect(d).toEqual({ following: 'balanced', freshness: 'balanced', media: 'all', variety: 'normal', hideSeen: false, calm: false });
    await api().put('/api/v1/feed/settings').set(auth(a)).send({ freshness: 'inventado' }).expect(400);
    const s = (await api().put('/api/v1/feed/settings').set(auth(a)).send({ following: 'more', freshness: 'recent', media: 'videos', variety: 'high', hideSeen: true, calm: true }).expect(200)).body;
    expect(s).toEqual({ following: 'more', freshness: 'recent', media: 'videos', variety: 'high', hideSeen: true, calm: true });
    // Só se mexe no que se manda.
    expect((await api().put('/api/v1/feed/settings').set(auth(a)).send({ calm: false }).expect(200)).body).toMatchObject({ following: 'more', calm: false });
    // O Explorar e os Reels respondem com estas opções (a consulta de classificação usa-as todas).
    await api().get('/api/v1/feed/explore').set(auth(a)).expect(200);
    await api().get('/api/v1/feed/reels').set(auth(a)).expect(200);
    // Pessoas: ver mais / menos; não a mim; nome que não existe.
    await api().put('/api/v1/feed/people').set(auth(a)).send({ username: a.username, pref: 1 }).expect(400);
    await api().put('/api/v1/feed/people').set(auth(a)).send({ username: 'nao-existe-mesmo', pref: 1 }).expect(404);
    expect((await api().put('/api/v1/feed/people').set(auth(a)).send({ username: `@${b.username}`, pref: -1 }).expect(200)).body).toMatchObject([{ username: b.username, pref: -1 }]);
    await api().get('/api/v1/feed/explore').set(auth(a)).expect(200);
    expect((await api().put('/api/v1/feed/people').set(auth(a)).send({ username: b.username, pref: 0 }).expect(200)).body).toEqual([]);
    // Repor apaga tudo.
    await api().put('/api/v1/feed/people').set(auth(a)).send({ username: b.username, pref: 1 }).expect(200);
    await api().delete('/api/v1/feed/prefs').set(auth(a)).expect(204);
    expect((await api().get('/api/v1/feed/settings').set(auth(a)).expect(200)).body.following).toBe('balanced');
    expect((await api().get('/api/v1/feed/people').set(auth(a)).expect(200)).body).toEqual([]);
    await api().get('/api/v1/feed/settings').expect(401);
  });
});
