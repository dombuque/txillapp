import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import http from 'http';
import request from 'supertest';
import { Pool } from 'pg';
import { Subscription } from 'rxjs';
import webpush from 'web-push';
import { AppConfig, CONFIG, loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { ChatEvents, type CallEvent, type StreamEvent } from '../chat/chat.events';
import { CallsService } from './calls.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
/** Toque curto nos testes (em produção são 45 s). */
const RING_S = 2;

interface U { token: string; id: string; username: string }

describe('chamadas de voz e vídeo 1:1 (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  let events: ChatEvents;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  const u: Record<string, U> = {};
  const subs: Subscription[] = [];
  /** Avisos Web Push que sairiam (o envio é simulado). */
  const pushes: { endpoint: string; payload: Record<string, string> }[] = [];
  const keys = webpush.generateVAPIDKeys();
  const subscribe = (x: U) => api().post('/api/v1/push/subscribe').set(auth(x)).send({ endpoint: `https://push.example.com/${run}/${x.username}`, keys: { p256dh: 'p'.repeat(20), auth: 'a'.repeat(16) } }).expect(204);

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  const follow = (a: U, b: U) => pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [a.id, b.id]);
  const mutual = async (a: U, b: U) => { await follow(a, b); await follow(b, a); };
  const call = (from: U, to: U, video = false) => api().post('/api/v1/calls').set(auth(from)).send({ username: to.username, video });
  /** Os eventos de chamada que chegam ao canal desta pessoa. */
  function listen(x: U) {
    const got: CallEvent[] = [];
    subs.push(events.forUser(x.id).subscribe((e: StreamEvent) => { if (e.type === 'call') got.push(e); }));
    return got;
  }
  const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    jest.spyOn(webpush, 'sendNotification').mockImplementation(async (sub, payload) => {
      pushes.push({ endpoint: (sub as { endpoint: string }).endpoint, payload: JSON.parse(String(payload)) });
      return { statusCode: 201, body: '', headers: {} };
    });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'k'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test', CALL_RING_SECONDS: String(RING_S), VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey }));
    await app.init();
    events = app.get(ChatEvents);
    for (const n of ['la', 'lb', 'lc', 'ld', 'le', 'lf', 'lg', 'lh', 'li', 'lj']) u[n] = await signup(n);
  }, 60_000);

  afterAll(async () => {
    for (const s of subs) s.unsubscribe();
    await tick(300); // avisos que ainda estão a sair
    await app.close();
    await pool.end();
    jest.restoreAllMocks();
  });

  it('privacidade: por omissão só quem se segue um ao outro; "following", "everyone" e "off"; e não se liga a si próprio', async () => {
    const { la, lb } = u;
    expect((await api().get('/api/v1/settings/privacy').set(auth(lb)).expect(200)).body.callsAllowed).toBe('mutual');
    await follow(la, lb); // só la segue lb
    const r = await call(la, lb).expect(403);
    expect(r.body.message).toMatch(/segue/);
    // "following": lb tem de seguir quem liga
    await api().patch('/api/v1/settings/privacy').set(auth(lb)).send({ callsAllowed: 'following' }).expect(200);
    await call(la, lb).expect(403);
    await api().patch('/api/v1/settings/privacy').set(auth(lb)).send({ callsAllowed: 'everyone' }).expect(200);
    const ok = (await call(la, lb).expect(201)).body;
    await api().post(`/api/v1/calls/${ok.id}/end`).set(auth(la)).expect(200);
    // "off" recusa toda a gente, mesmo quem se segue um ao outro
    await mutual(la, lb);
    await api().patch('/api/v1/settings/privacy').set(auth(lb)).send({ callsAllowed: 'off' }).expect(200);
    expect((await call(la, lb).expect(403)).body.message).toBe('Esta pessoa não está a receber chamadas');
    await api().patch('/api/v1/settings/privacy').set(auth(lb)).send({ callsAllowed: 'qualquer' }).expect(400);
    await api().patch('/api/v1/settings/privacy').set(auth(lb)).send({ callsAllowed: 'mutual' }).expect(200);
    const again = (await call(la, lb).expect(201)).body;
    await api().post(`/api/v1/calls/${again.id}/end`).set(auth(la)).expect(200);
    await call(la, la).expect(400);
    await api().post('/api/v1/calls').set(auth(la)).send({ username: 'ninguem-com-este-nome', video: false }).expect(404);
    await api().post('/api/v1/calls').send({ username: lb.username, video: false }).expect(401);
  });

  it('bloqueios: em qualquer sentido, não se liga', async () => {
    const { lc, ld } = u;
    await mutual(lc, ld);
    await api().put(`/api/v1/blocks/${lc.username}`).set(auth(ld)).expect(200);
    await call(lc, ld).expect(403);
    await call(ld, lc).expect(403);
    await api().delete(`/api/v1/blocks/${lc.username}`).set(auth(ld)).expect(200);
    await mutual(lc, ld); // bloquear desfaz o seguir
    const c = (await call(lc, ld).expect(201)).body;
    await api().post(`/api/v1/calls/${c.id}/end`).set(auth(lc)).expect(200);
  });

  it('ocupado: quem já está numa chamada (a tocar ou em curso) responde 409', async () => {
    const { le, lf, lg } = u;
    await mutual(le, lf);
    await mutual(lg, lf);
    await mutual(le, lg);
    const c = (await call(le, lf).expect(201)).body;
    expect((await call(lg, lf).expect(409)).body.message).toBe('Está noutra chamada'); // quem recebe está ocupado
    await call(lg, le).expect(409); // quem liga também
    await call(le, lg).expect(409); // e não faz duas chamadas ao mesmo tempo
    await api().post(`/api/v1/calls/${c.id}/accept`).set(auth(lf)).expect(200);
    await call(lg, lf).expect(409); // em curso também conta
    await api().post(`/api/v1/calls/${c.id}/end`).set(auth(lf)).expect(200);
    const free = (await call(lg, lf).expect(201)).body;
    await api().post(`/api/v1/calls/${free.id}/end`).set(auth(lg)).expect(200);
  });

  it('toca, atende, passa os sinais, desliga com a duração; e aparece no histórico dos dois', async () => {
    const { la, lb } = u;
    const atA = listen(la);
    const atB = listen(lb);
    await subscribe(lb);
    const c = (await call(la, lb, true).expect(201)).body;
    expect(c).toMatchObject({ video: true, peer: { username: lb.username, displayName: 'lb Teste', hasAvatar: false } });
    expect(c.iceServers[0].urls).toEqual(['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302']);
    await tick();
    expect(atB).toEqual([{ type: 'call', event: 'ring', callId: c.id, video: true, from: { username: la.username, displayName: 'la Teste', hasAvatar: false } }]);
    // Aviso no telemóvel de quem recebe: os campos da chamada ao nível de cima.
    expect(pushes.find((x) => x.payload.callId === c.id)?.payload).toEqual({
      kind: 'call', callId: c.id, from: la.username, video: '1', title: 'la Teste', body: 'Videochamada', url: `/call/${c.id}?from=${la.username}&video=1`, tag: `call-${c.id}`,
    });

    // Só quem recebe atende; quem está de fora nem vê a chamada.
    await api().post(`/api/v1/calls/${c.id}/accept`).set(auth(la)).expect(403);
    await api().post(`/api/v1/calls/${c.id}/accept`).set(auth(u.lj)).expect(404);
    await api().post(`/api/v1/calls/not-a-uuid/accept`).set(auth(lb)).expect(400);

    // A oferta pode seguir ainda a tocar.
    const offer = { sdp: 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n', type: 'offer' };
    await api().post(`/api/v1/calls/${c.id}/signal`).set(auth(la)).send({ type: 'offer', data: offer }).expect(204);
    const acc = (await api().post(`/api/v1/calls/${c.id}/accept`).set(auth(lb)).expect(200)).body;
    expect(acc.iceServers.length).toBeGreaterThanOrEqual(1);
    await api().post(`/api/v1/calls/${c.id}/accept`).set(auth(lb)).expect(409); // já não está a tocar
    await api().post(`/api/v1/calls/${c.id}/signal`).set(auth(lb)).send({ type: 'answer', data: { sdp: 'v=0', type: 'answer' } }).expect(204);
    const ice = { candidate: 'candidate:1 1 udp 2122260223 192.168.1.2 54321 typ host', sdpMid: '0', sdpMLineIndex: 0 };
    await api().post(`/api/v1/calls/${c.id}/signal`).set(auth(la)).send({ type: 'ice', data: ice }).expect(204);
    await api().post(`/api/v1/calls/${c.id}/signal`).set(auth(la)).send({ type: 'bye', data: {} }).expect(400);
    await api().post(`/api/v1/calls/${c.id}/signal`).set(auth(la)).send({ type: 'ice', data: { big: 'x'.repeat(70_000) } }).expect(400);
    await api().post(`/api/v1/calls/${c.id}/signal`).set(auth(u.lj)).send({ type: 'ice', data: ice }).expect(404);
    await tick();
    const fromA = { username: la.username, displayName: 'la Teste', hasAvatar: false };
    const fromB = { username: lb.username, displayName: 'lb Teste', hasAvatar: false };
    expect(atB.filter((e) => e.event === 'signal')).toEqual([
      { type: 'call', event: 'signal', callId: c.id, video: true, from: fromA, signal: { type: 'offer', data: offer } },
      { type: 'call', event: 'signal', callId: c.id, video: true, from: fromA, signal: { type: 'ice', data: ice } },
    ]);
    expect(atA).toEqual([
      { type: 'call', event: 'accepted', callId: c.id, video: true, from: fromB },
      { type: 'call', event: 'signal', callId: c.id, video: true, from: fromB, signal: { type: 'answer', data: { sdp: 'v=0', type: 'answer' } } },
    ]);

    // 3 segundos de conversa
    await pool.query("UPDATE social.calls SET started_at = now() - interval '3 seconds' WHERE id = $1", [c.id]);
    const end = (await api().post(`/api/v1/calls/${c.id}/end`).set(auth(lb)).expect(200)).body;
    expect(end).toEqual({ status: 'ended', durationS: 3 });
    await tick();
    expect(atA[atA.length - 1]).toEqual({ type: 'call', event: 'ended', callId: c.id, video: true, from: fromB, reason: 'ended' });
    // Desligar outra vez não faz mal; sinais depois do fim já não passam.
    expect((await api().post(`/api/v1/calls/${c.id}/end`).set(auth(la)).expect(200)).body).toEqual({ status: 'ended', durationS: 3 });
    await api().post(`/api/v1/calls/${c.id}/signal`).set(auth(la)).send({ type: 'ice', data: ice }).expect(409);

    const histA = (await api().get('/api/v1/calls').set(auth(la)).expect(200)).body;
    expect(histA.items[0]).toMatchObject({ id: c.id, video: true, direction: 'out', status: 'ended', peer: fromB, durationS: 3 });
    expect(typeof histA.items[0].startedAt).toBe('string');
    const histB = (await api().get('/api/v1/calls').set(auth(lb)).expect(200)).body;
    expect(histB.items[0]).toMatchObject({ id: c.id, direction: 'in', status: 'ended', peer: fromA });
    expect(histB.nextCursor).toBeNull();
    // As anteriores (canceladas no primeiro teste) também lá estão, sem duração.
    expect(histA.items.some((i: { status: string; durationS: number | null }) => i.status === 'cancelled' && i.durationS === null)).toBe(true);
    await api().get('/api/v1/calls?cursor=lixo').set(auth(la)).expect(400);

    // A chamada ficou registada na conversa dos dois (mensagem 'call' de quem ligou, com a duração).
    await tick(150);
    const conv = (await api().get(`/api/v1/chat/with/${lb.username}`).set(auth(la)).expect(200)).body;
    const items = (conv.items ?? conv.messages ?? conv) as { kind: string; body: string; fromMe: boolean }[];
    const logged = items.filter((m) => m.kind === 'call').map((m) => ({ ...JSON.parse(m.body), fromMe: m.fromMe }));
    expect(logged).toContainEqual({ video: true, status: 'ended', durationS: 3, fromMe: true });
  });

  it('o evento chega pelo canal SSE do chat com o formato combinado', async () => {
    const { la, lb } = u;
    await app.listen(0);
    const port = (app.getHttpServer().address() as { port: number }).port;
    const received: Record<string, unknown>[] = [];
    const req = http.get({ port, path: '/api/v1/chat/stream', headers: { Authorization: `Bearer ${lb.token}`, Accept: 'text/event-stream' } }, (res) => {
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        for (const line of chunk.split('\n')) if (line.startsWith('data:')) received.push(JSON.parse(line.slice(5)));
      });
    });
    try {
      await tick(300);
      const c = (await call(la, lb).expect(201)).body;
      await api().post(`/api/v1/calls/${c.id}/end`).set(auth(la)).expect(200); // desistiu: cancelada
      await tick(300);
      const calls = received.filter((e) => e.type === 'call');
      expect(calls).toEqual([
        { type: 'call', event: 'ring', callId: c.id, video: false, from: { username: la.username, displayName: 'la Teste', hasAvatar: false } },
        { type: 'call', event: 'ended', callId: c.id, video: false, from: { username: la.username, displayName: 'la Teste', hasAvatar: false }, reason: 'cancelled' },
      ]);
      // Para quem recebia, desistir antes de atender é uma chamada perdida.
      const n = (await api().get('/api/v1/notifications').set(auth(lb)).expect(200)).body.items as { kind: string; data: { callId?: string } }[];
      expect(n.some((x) => x.kind === 'missed_call' && x.data.callId === c.id)).toBe(true);
    } finally {
      req.destroy();
    }
  });

  it('recusar com uma resposta rápida: a mensagem vai para o chat de quem ligou', async () => {
    const { lc, ld } = u;
    const atC = listen(lc);
    const c = (await call(lc, ld).expect(201)).body;
    await api().post(`/api/v1/calls/${c.id}/decline`).set(auth(lc)).send({}).expect(403); // só quem recebe recusa
    await api().post(`/api/v1/calls/${c.id}/decline`).set(auth(ld)).send({ message: 'x'.repeat(201) }).expect(400);
    const r = (await api().post(`/api/v1/calls/${c.id}/decline`).set(auth(ld)).send({ message: 'Estou numa reunião, ligo depois' }).expect(200)).body;
    expect(r).toEqual({ status: 'declined', messageSent: true });
    await api().post(`/api/v1/calls/${c.id}/decline`).set(auth(ld)).send({}).expect(409);
    await tick();
    expect(atC).toContainEqual({ type: 'call', event: 'declined', callId: c.id, video: false, from: { username: ld.username, displayName: 'ld Teste', hasAvatar: false } });
    const t = (await api().get(`/api/v1/chat/with/${ld.username}`).set(auth(lc)).expect(200)).body;
    expect(t.items[0]).toMatchObject({ fromMe: false, kind: 'text', body: 'Estou numa reunião, ligo depois' });

    // Sem mensagem também recusa; desligar enquanto toca, do lado de quem recebe, conta como recusada.
    const c2 = (await call(lc, ld).expect(201)).body;
    expect((await api().post(`/api/v1/calls/${c2.id}/decline`).set(auth(ld)).expect(200)).body).toEqual({ status: 'declined', messageSent: false });
    const c3 = (await call(lc, ld).expect(201)).body;
    expect((await api().post(`/api/v1/calls/${c3.id}/end`).set(auth(ld)).expect(200)).body).toEqual({ status: 'declined', durationS: null });
    await tick();
    expect(atC[atC.length - 1]).toMatchObject({ event: 'ended', callId: c3.id, reason: 'declined' });
  });

  it('ninguém atende: ao fim do tempo fica perdida, avisa os dois e deixa a notificação de chamada perdida', async () => {
    const { lh, li } = u;
    await mutual(lh, li);
    const atH = listen(lh);
    const atI = listen(li);
    await subscribe(li);
    const c = (await call(lh, li, true).expect(201)).body;
    await tick(RING_S * 1000 + 600);
    const fromH = { username: lh.username, displayName: 'lh Teste', hasAvatar: false };
    const fromI = { username: li.username, displayName: 'li Teste', hasAvatar: false };
    expect(atI[atI.length - 1]).toEqual({ type: 'call', event: 'ended', callId: c.id, video: true, from: fromH, reason: 'missed' });
    expect(atH[atH.length - 1]).toEqual({ type: 'call', event: 'ended', callId: c.id, video: true, from: fromI, reason: 'missed' });
    await api().post(`/api/v1/calls/${c.id}/accept`).set(auth(li)).expect(409);
    // O aviso de chamada perdida substitui o que tocava (mesma etiqueta).
    const mine = pushes.filter((x) => x.payload.callId === c.id).map((x) => x.payload);
    expect(mine.map((x) => x.kind)).toEqual(['call', 'missed_call']);
    expect(mine[1]).toEqual({ kind: 'missed_call', callId: c.id, from: lh.username, video: '1', title: 'lh Teste', body: 'Videochamada perdida', url: '/calls', tag: `call-${c.id}` });
    const n = (await api().get('/api/v1/notifications').set(auth(li)).expect(200)).body.items as { kind: string; data: { callId?: string; video?: boolean }; actor: { username: string } }[];
    expect(n.find((x) => x.kind === 'missed_call' && x.data.callId === c.id)).toMatchObject({ actor: { username: lh.username }, data: { video: true } });
    expect((await api().get('/api/v1/calls').set(auth(li)).expect(200)).body.items[0]).toMatchObject({ id: c.id, direction: 'in', status: 'missed', durationS: null });
    // já livres: podem voltar a ligar
    const again = (await call(li, lh).expect(201)).body;
    await api().post(`/api/v1/calls/${again.id}/end`).set(auth(li)).expect(200);
  });

  it('a varredura apanha chamadas a tocar que ficaram para trás (ex.: o servidor reiniciou) e chamadas caídas', async () => {
    const { lh, li } = u;
    const svc = app.get(CallsService);
    const stale = '01900000-0000-7000-8000-' + Date.now().toString(16).padStart(12, '0').slice(-12);
    await pool.query("INSERT INTO social.calls (id, caller_id, callee_id, video, created_at) VALUES ($1, $2, $3, false, now() - interval '5 minutes')", [stale, lh.id, li.id]);
    await call(lh, li).expect(409); // conta como ocupado até ser varrida
    await svc.sweep();
    expect((await pool.query('SELECT status FROM social.calls WHERE id = $1', [stale])).rows[0].status).toBe('missed');

    // Em curso, mas os dois sem canal em tempo real há mais de 2 minutos: caída.
    const c = (await call(lh, li).expect(201)).body;
    await api().post(`/api/v1/calls/${c.id}/accept`).set(auth(li)).expect(200);
    const atH = listen(lh);
    const t0 = Date.now();
    await svc.sweep(t0);
    await svc.sweep(t0 + 60_000);
    expect((await pool.query('SELECT status FROM social.calls WHERE id = $1', [c.id])).rows[0].status).toBe('active');
    await svc.sweep(t0 + 130_000);
    expect((await pool.query('SELECT status FROM social.calls WHERE id = $1', [c.id])).rows[0].status).toBe('ended');
    await tick();
    expect(atH[atH.length - 1]).toMatchObject({ event: 'ended', callId: c.id, reason: 'lost' });
  });

  it('servidores ICE: só STUN sem TURN; com TURN_URLS e TURN_SECRET, credenciais temporárias do coturn', async () => {
    const { la } = u;
    const stunOnly = (await api().get('/api/v1/calls/ice').set(auth(la)).expect(200)).body;
    expect(stunOnly).toEqual({ iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }], relayOnly: false });
    await api().get('/api/v1/calls/ice').expect(401);

    // As duas variáveis entram pela configuração (e são opcionais).
    const parsed = loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'k'.repeat(40), TURN_URLS: 'turn:turn.exemplo.co.mz:3478, turns:turn.exemplo.co.mz:5349', TURN_SECRET: 'segredo-do-coturn' });
    expect(parsed.TURN_URLS).toContain('turns:');
    expect(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'k'.repeat(40) }).TURN_SECRET).toBeUndefined();

    const cfg = app.get<AppConfig>(CONFIG);
    cfg.TURN_URLS = parsed.TURN_URLS;
    cfg.TURN_SECRET = parsed.TURN_SECRET;
    try {
      const before = Math.floor(Date.now() / 1000);
      const r = (await api().get('/api/v1/calls/ice').set(auth(la)).expect(200)).body.iceServers as { urls: string[]; username?: string; credential?: string }[];
      expect(r).toHaveLength(2);
      const turn = r[1];
      expect(turn.urls).toEqual(['turn:turn.exemplo.co.mz:3478', 'turns:turn.exemplo.co.mz:5349']);
      const [exp, uid] = turn.username!.split(':');
      expect(uid).toBe(la.id);
      expect(Number(exp) - before).toBeGreaterThanOrEqual(6 * 3600 - 2);
      expect(Number(exp) - before).toBeLessThanOrEqual(6 * 3600 + 2);
      expect(turn.credential).toBe(createHmac('sha1', 'segredo-do-coturn').update(turn.username!).digest('base64'));
      // "Esconder o meu IP nas chamadas": só com TURN configurado.
      expect((await api().get('/api/v1/calls/ice').set(auth(la)).expect(200)).body.relayOnly).toBe(false);
      await api().patch('/api/v1/settings/privacy').set(auth(la)).send({ callsRelayOnly: true }).expect(200);
      expect((await api().get('/api/v1/calls/ice').set(auth(la)).expect(200)).body.relayOnly).toBe(true);
      // Também vêm ao ligar.
      await mutual(la, u.lj);
      const c = (await call(la, u.lj).expect(201)).body;
      expect(c.iceServers).toHaveLength(2);
      await api().post(`/api/v1/calls/${c.id}/end`).set(auth(la)).expect(200);
    } finally {
      cfg.TURN_URLS = undefined;
      cfg.TURN_SECRET = undefined;
    }
    // Sem TURN, nunca pede só relay (a chamada não ligaria).
    expect((await api().get('/api/v1/calls/ice').set(auth(la)).expect(200)).body.relayOnly).toBe(false);
  });

  it('apagar do histórico: uma ou todas, só do meu lado; quando os dois apagam, desaparece; mais de 12 meses sai sozinha', async () => {
    const a = u.lg, b = u.lh;
    await mutual(a, b);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const c = (await call(a, b).expect(201)).body;
      await api().post(`/api/v1/calls/${c.id}/end`).set(auth(a)).expect(200);
      ids.push(c.id);
    }
    const hist = async (x: U) => ((await api().get('/api/v1/calls').set(auth(x)).expect(200)).body.items.map((c: { id: string }) => c.id) as string[]).filter((id) => ids.includes(id));

    await api().delete(`/api/v1/calls/${ids[0]}`).set(auth(a)).expect(200);
    expect(await hist(a)).not.toContain(ids[0]);
    expect(await hist(b)).toContain(ids[0]);
    await api().delete(`/api/v1/calls/${ids[0]}`).set(auth(u.la)).expect(404); // não é dela

    await api().delete(`/api/v1/calls/${ids[0]}`).set(auth(b)).expect(200);
    expect((await pool.query('SELECT 1 FROM social.calls WHERE id = $1', [ids[0]])).rowCount).toBe(0);

    const all = (await api().delete('/api/v1/calls').set(auth(a)).expect(200)).body;
    expect(all.removed).toBeGreaterThanOrEqual(2);
    expect(await hist(a)).toEqual([]);
    expect(await hist(b)).toEqual(expect.arrayContaining([ids[1], ids[2]]));

    await pool.query(`UPDATE social.calls SET created_at = now() - interval '13 months' WHERE id = $1`, [ids[1]]);
    await app.get(CallsService).purgeOld();
    expect(await hist(b)).toEqual([ids[2]]);
  });
});
