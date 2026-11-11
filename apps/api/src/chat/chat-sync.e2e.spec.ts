import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import http from 'http';
import request from 'supertest';
import { Pool } from 'pg';
import { Subscription } from 'rxjs';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { ChatEvents, type StreamEvent } from './chat.events';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';

interface U { token: string; id: string; username: string }
type Ev = { type: string; from?: string; group?: string; self?: boolean };

/**
 * A mesma conta em vários aparelhos (telemóvel e computador, ou duas sessões): o que eu faço numa conversa (enviar,
 * editar, apagar, reagir, ler, abrir, aceitar…) chega também aos meus outros aparelhos, como eco `self: true` com `from`
 * = o OUTRO lado (a chave da conversa na app). Quem está do outro lado recebe o evento normal, sem `self`.
 * O "a escrever…" nunca volta para mim.
 */
describe('sincronização entre aparelhos da mesma conta (eco self no tempo real)', () => {
  let app: INestApplication;
  let pool: Pool;
  let ev: ChatEvents;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  const u: Record<string, U> = {};
  const got = new Map<string, Ev[]>();
  const subs: Subscription[] = [];

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  const send = async (from: U, to: U, body: string, extra: Record<string, unknown> = {}) =>
    (await api().post(`/api/v1/chat/with/${to.username}`).set(auth(from)).send({ body, ...extra }).expect(201)).body.id as string;
  /** Eventos que cada pessoa recebeu (subscrição direta ao canal, como uma ligação SSE). */
  const of = (x: U) => got.get(x.id) ?? [];
  const reset = () => { for (const k of got.keys()) got.set(k, []); };
  const tick = () => new Promise((r) => setTimeout(r, 50));
  const selfOf = (x: U) => of(x).filter((e) => e.self);

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 's'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    ev = app.get(ChatEvents);
    for (const n of ['sya', 'syb', 'syc', 'syx']) u[n] = await signup(n);
    // sya, syb e syc seguem-se; syx é um desconhecido (para os pedidos de mensagem).
    const ids = ['sya', 'syb', 'syc'].map((n) => u[n].id);
    for (const a of ids) for (const b of ids) if (a !== b) await pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [a, b]);
    for (const x of Object.values(u)) {
      got.set(x.id, []);
      subs.push(ev.forUser(x.id).subscribe((e: StreamEvent) => { if ((e as Ev).type !== 'ping') got.get(x.id)!.push(e as Ev); }));
    }
  }, 60_000);

  afterAll(async () => {
    subs.forEach((s) => s.unsubscribe());
    await app.close();
    await pool.end();
  });

  it('SSE: duas ligações da mesma conta recebem o eco do que envio; o outro lado recebe sem self; o "a escrever" não volta para mim', async () => {
    const { sya: a, syb: b } = u;
    await app.listen(0);
    const port = (app.getHttpServer().address() as { port: number }).port;
    const open = (x: U) => {
      const out: Ev[] = [];
      const req = http.get({ port, path: '/api/v1/chat/stream', headers: { Authorization: `Bearer ${x.token}`, Accept: 'text/event-stream' } }, (res) => {
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          for (const line of chunk.split('\n')) if (line.startsWith('data:')) out.push(JSON.parse(line.slice(5)));
        });
      });
      return { out, req };
    };
    const phone = open(a);
    const laptop = open(a);
    const other = open(b);
    try {
      await new Promise((r) => setTimeout(r, 400));
      await send(a, b, 'olá dos dois aparelhos');
      await api().post(`/api/v1/chat/with/${b.username}/typing`).set(auth(a)).expect(204);
      await new Promise((r) => setTimeout(r, 400));
      for (const dev of [phone, laptop]) {
        expect(dev.out).toContainEqual({ type: 'message', from: b.username, self: true });
        expect(dev.out.some((e) => e.type === 'typing')).toBe(false);
      }
      expect(other.out).toContainEqual({ type: 'message', from: a.username });
      expect(other.out.some((e) => e.self)).toBe(false);
      expect(other.out).toContainEqual({ type: 'typing', from: a.username });
    } finally {
      phone.req.destroy();
      laptop.req.destroy();
      other.req.destroy();
    }
  });

  it('conversas: enviar, editar, apagar para todos, reagir, ler, abrir visualização única, apagar para mim, por ler e limpar', async () => {
    const { sya: a, syb: b } = u;
    const mine = { type: 'message', from: b.username, self: true };

    // Enviar (também presentes, partilhas, sítios… passam todos pelo mesmo sítio): eco para mim, normal para a outra pessoa.
    reset();
    const id = await send(a, b, 'primeira');
    await tick();
    expect(of(a)).toEqual([mine]);
    expect(of(b)).toEqual([{ type: 'message', from: a.username }]);

    // Editar.
    reset();
    await api().patch(`/api/v1/chat/messages/${id}`).set(auth(a)).send({ body: 'primeira (editada)' }).expect(200);
    await tick();
    expect(of(a)).toEqual([{ type: 'edited', from: b.username, self: true }]);
    expect(of(b)).toEqual([{ type: 'edited', from: a.username }]);

    // Reagir (quem reage é o b: o eco vai para o b com from = a).
    reset();
    await api().put(`/api/v1/chat/messages/${id}/reaction`).set(auth(b)).send({ reaction: ':amor:' }).expect(204);
    await api().delete(`/api/v1/chat/messages/${id}/reaction`).set(auth(b)).expect(204);
    await tick();
    expect(of(b)).toEqual([{ type: 'message', from: a.username, self: true }, { type: 'message', from: a.username, self: true }]);
    expect(of(a)).toEqual([{ type: 'message', from: b.username }, { type: 'message', from: b.username }]);

    // Ler: o b abre a conversa → o a sabe que foi lido; os outros aparelhos do b tiram o "por ler" (read + self).
    reset();
    await api().get(`/api/v1/chat/with/${a.username}`).set(auth(b)).expect(200);
    await tick();
    expect(of(b)).toEqual([{ type: 'read', from: a.username, self: true }]);
    expect(of(a)).toEqual([{ type: 'read', from: b.username }]);
    // Abrir outra vez sem nada novo: nada muda, ninguém é avisado.
    reset();
    await api().get(`/api/v1/chat/with/${a.username}`).set(auth(b)).expect(200);
    await tick();
    expect(of(a)).toEqual([]);
    expect(of(b)).toEqual([]);

    // Marcar como por ler e abrir de novo (tira a marca): só os meus aparelhos.
    reset();
    await api().post(`/api/v1/chat/with/${a.username}/unread`).set(auth(b)).expect(200);
    await api().get(`/api/v1/chat/with/${a.username}`).set(auth(b)).expect(200);
    await tick();
    expect(of(b)).toEqual([{ type: 'read', from: a.username, self: true }, { type: 'read', from: a.username, self: true }]);
    expect(of(a)).toEqual([]);

    // Apagar para todos.
    reset();
    await api().delete(`/api/v1/chat/messages/${id}`).set(auth(a)).expect((r) => expect(r.status).toBeLessThan(300));
    await tick();
    expect(of(a)).toEqual([{ type: 'deleted', from: b.username, self: true }]);
    expect(of(b)).toEqual([{ type: 'deleted', from: a.username }]);

    // Apagar para mim: só os meus aparelhos.
    const other = await send(b, a, 'para apagar só do meu lado');
    reset();
    await api().post(`/api/v1/chat/messages/${other}/hide`).set(auth(a)).expect((r) => expect(r.status).toBeLessThan(300));
    await tick();
    expect(of(a)).toEqual([{ type: 'deleted', from: b.username, self: true }]);
    expect(of(b)).toEqual([]);

    // Visualização única: o b abre → o a sabe ('read'); os aparelhos do b mostram "Aberta".
    const once = await send(a, b, 'só uma vez', { once: true });
    reset();
    await api().post(`/api/v1/chat/messages/${once}/open`).set(auth(b)).expect(200);
    await tick();
    expect(of(b)).toEqual([{ type: 'message', from: a.username, self: true }]);
    expect(of(a)).toEqual([{ type: 'read', from: b.username }]);

    // Localização em direto: cada posição nova e o "Parar" também chegam aos meus outros aparelhos.
    const live = await send(a, b, '', { kind: 'location', lat: -25.9, lng: 32.5, liveMinutes: 15 });
    reset();
    await api().put(`/api/v1/chat/messages/${live}/location`).set(auth(a)).send({ lat: -25.91, lng: 32.51 }).expect((r) => expect(r.status).toBeLessThan(300));
    await api().delete(`/api/v1/chat/messages/${live}/live`).set(auth(a)).expect((r) => expect(r.status).toBeLessThan(300));
    await tick();
    expect(of(a)).toEqual([mine, mine]);
    expect(of(b)).toEqual([{ type: 'message', from: a.username }, { type: 'message', from: a.username }]);

    // Apagar a conversa do meu lado: só os meus aparelhos.
    reset();
    await api().delete(`/api/v1/chat/with/${b.username}`).set(auth(a)).expect((r) => expect(r.status).toBeLessThan(300));
    await tick();
    expect(of(a)).toEqual([{ type: 'deleted', from: b.username, self: true }]);
    expect(of(b)).toEqual([]);

    // Registo de chamada: quem ligou recebe o eco; quem recebeu, o normal.
    reset();
    await app.get((await import('./chat.service')).ChatService).logCall(a.id, b.id, { video: false, status: 'missed', durationS: null });
    await tick();
    expect(of(a)).toEqual([mine]);
    expect(of(b)).toEqual([{ type: 'message', from: a.username }]);

    // O "a escrever…" vai só para o outro lado.
    reset();
    await api().post(`/api/v1/chat/with/${b.username}/typing`).set(auth(a)).expect(204);
    await tick();
    expect(of(a)).toEqual([]);
    expect(of(b)).toEqual([{ type: 'typing', from: a.username }]);
  });

  it('pedidos de mensagem: aceitar e recusar põem os meus outros aparelhos em dia', async () => {
    const { sya: a, syx: x } = u;
    await send(x, a, 'olá, não nos conhecemos');
    reset();
    await api().post(`/api/v1/chat/with/${x.username}/accept`).set(auth(a)).expect((r) => expect(r.status).toBeLessThan(300));
    await api().post(`/api/v1/chat/with/${x.username}/decline`).set(auth(a)).expect((r) => expect(r.status).toBeLessThan(300));
    await tick();
    expect(of(a)).toEqual([{ type: 'message', from: x.username, self: true }, { type: 'message', from: x.username, self: true }]);
    expect(of(x)).toEqual([]);
  });

  it('grupos: criar, enviar, editar, reagir, ler e apagar chegam também aos meus outros aparelhos', async () => {
    const { sya: a, syb: b, syc: c } = u;
    reset();
    const group = (await api().post('/api/v1/chat/groups').set(auth(a)).send({ name: `Sync ${run}`, members: [b.username, c.username] }).expect(201)).body.id as string;
    await tick();
    expect(of(a)).toEqual([{ type: 'message', group, self: true }]);
    for (const x of [b, c]) expect(of(x)).toEqual([{ type: 'message', group }]);

    const mine = { type: 'message', group, self: true };
    reset();
    const id = (await api().post(`/api/v1/chat/groups/${group}/messages`).set(auth(a)).send({ body: 'olá grupo' }).expect(201)).body.id as string;
    await tick();
    expect(of(a)).toEqual([mine]);
    for (const x of [b, c]) expect(of(x)).toEqual([{ type: 'message', group }]);

    reset();
    await api().patch(`/api/v1/chat/messages/${id}`).set(auth(a)).send({ body: 'olá grupo!' }).expect(200);
    await tick();
    expect(of(a)).toEqual([{ type: 'edited', group, self: true }]);
    for (const x of [b, c]) expect(of(x)).toEqual([{ type: 'edited', group }]);

    reset();
    await api().put(`/api/v1/chat/messages/${id}/reaction`).set(auth(b)).send({ reaction: ':rir:' }).expect(204);
    await tick();
    expect(of(b)).toEqual([{ type: 'message', group, self: true }]);
    for (const x of [a, c]) expect(of(x)).toEqual([{ type: 'message', group }]);

    // Ler o grupo: só os meus aparelhos (a lista tira o "por ler"); repetir sem nada novo não avisa.
    reset();
    await api().get(`/api/v1/chat/groups/${group}`).set(auth(c)).expect(200);
    await api().get(`/api/v1/chat/groups/${group}`).set(auth(c)).expect(200);
    await tick();
    expect(of(c)).toEqual([{ type: 'read', group, self: true }]);
    for (const x of [a, b]) expect(of(x)).toEqual([]);

    // Visualização única no grupo: quem abre recebe o eco.
    const once = (await api().post(`/api/v1/chat/groups/${group}/messages`).set(auth(a)).send({ body: 'segredo', once: true }).expect(201)).body.id as string;
    reset();
    await api().post(`/api/v1/chat/messages/${once}/open`).set(auth(b)).expect(200);
    await tick();
    expect(of(b)).toEqual([mine]);
    expect(of(a)).toEqual([{ type: 'message', group }]);

    reset();
    await api().delete(`/api/v1/chat/messages/${id}`).set(auth(a)).expect((r) => expect(r.status).toBeLessThan(300));
    await tick();
    expect(of(a)).toEqual([{ type: 'deleted', group, self: true }]);
    for (const x of [b, c]) expect(of(x)).toEqual([{ type: 'deleted', group }]);

    // Sair do grupo pelo próprio pé: o grupo some dos meus outros aparelhos; os outros membros põem-se em dia.
    reset();
    await api().delete(`/api/v1/chat/groups/${group}/members/${c.username}`).set(auth(c)).expect((r) => expect(r.status).toBeLessThan(300));
    await tick();
    expect(of(c)).toEqual([{ type: 'deleted', group, self: true }]);
    for (const x of [a, b]) expect(of(x)).toEqual([{ type: 'read', group }]);

    // O "a escrever" e qualquer eco nunca levam `typing`.
    expect(selfOf(a).concat(selfOf(b), selfOf(c)).some((e) => e.type === 'typing')).toBe(false);
  });
});
