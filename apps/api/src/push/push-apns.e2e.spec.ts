import 'reflect-metadata';
import { generateKeyPairSync, randomBytes, verify } from 'node:crypto';
import http2 from 'node:http2';
import type { AddressInfo } from 'node:net';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import webpush from 'web-push';
import { ringPush } from '../calls/call-push';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { FcmSender } from './fcm';
import { PushService } from './push.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';

/**
 * iPhone pelo APNs, Android pelo FCM e browser pelo Web Push, com um servidor APNs falso (HTTP/2 local, sem TLS).
 * Antes, os códigos APNs dos iPhones iam para o FCM, que os recusava, e o aparelho era apagado.
 */
describe('push: encaminhamento iPhone (APNs) / Android (FCM) / web', () => {
  let app: INestApplication;
  let pool: Pool;
  let server: http2.Http2Server;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const vapid = webpush.generateVAPIDKeys();
  const apnsGot: { path: string; headers: http2.IncomingHttpHeaders; body: { aps: Record<string, unknown>; body: Record<string, string> } }[] = [];
  /** Códigos a que o servidor falso responde 410 Unregistered. */
  const gone = new Set<string>();
  const fcmGot: { token: string; platform: string; title: string }[] = [];
  const webGot: string[] = [];
  const iosA = randomBytes(32).toString('hex');
  const iosGone = randomBytes(32).toString('hex');
  const iosFcm = `fcm-ios-${run}-${'y'.repeat(30)}`; // iPhone com código FCM (não hex): continua no FCM
  const android = `fcm-android-${run}-${'x'.repeat(30)}`;
  let me: { token: string; id: string };

  beforeAll(async () => {
    server = http2.createServer();
    server.on('stream', (stream, headers) => {
      let data = '';
      stream.setEncoding('utf8');
      stream.on('data', (c: string) => (data += c));
      stream.on('end', () => {
        const path = String(headers[':path']);
        apnsGot.push({ path, headers, body: JSON.parse(data) });
        const dead = gone.has(path.split('/').pop()!);
        stream.respond({ ':status': dead ? 410 : 200 });
        stream.end(dead ? JSON.stringify({ reason: 'Unregistered', timestamp: Date.now() }) : '');
      });
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    jest.spyOn(FcmSender.prototype, 'send').mockImplementation(async (token, m, platform) => {
      fcmGot.push({ token, platform: platform ?? 'android', title: m.title });
      return 'ok';
    });
    jest.spyOn(webpush, 'sendNotification').mockImplementation(async (s) => {
      webGot.push((s as { endpoint: string }).endpoint);
      return { statusCode: 201, body: '', headers: {} };
    });

    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(
      loadConfig({
        DATABASE_URL: DB,
        JWT_ACCESS_SECRET: 'p'.repeat(40),
        NODE_ENV: 'test',
        MEDIA_DIR: './uploads-test',
        VAPID_PUBLIC_KEY: vapid.publicKey,
        VAPID_PRIVATE_KEY: vapid.privateKey,
        FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({ project_id: 'p', client_email: 'x@p.iam.gserviceaccount.com', private_key: 'falsa' }),
        // Numa linha com \n, como fica no .env do servidor.
        APNS_KEY_P8: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString().replace(/\n/g, '\\n'),
        APNS_KEY_ID: 'KEY1234567',
        APNS_TEAM_ID: 'TEAM123456',
        APNS_PRODUCTION: 'false',
        APNS_ORIGIN: origin,
      }),
    );
    await app.init();
    const username = `apns${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: 'Apns Teste', password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    me = { token: r.body.accessToken, id: r.body.user.id };
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
    await new Promise<void>((ok) => server.close(() => ok()));
    jest.restoreAllMocks();
  });

  const auth = () => ({ Authorization: `Bearer ${me.token}` });
  const devices = async () => (await pool.query('SELECT token FROM social.push_devices WHERE user_id = $1 ORDER BY token', [me.id])).rows.map((r) => r.token as string);
  const reset = () => { apnsGot.length = 0; fcmGot.length = 0; webGot.length = 0; };

  it('cada aparelho vai pelo seu caminho; o 410 da Apple apaga só esse iPhone', async () => {
    for (const [token, platform] of [[iosA, 'ios'], [iosGone, 'ios'], [iosFcm, 'ios'], [android, 'android']]) {
      await api().post('/api/v1/push/device').set(auth()).send({ token, platform }).expect(204);
    }
    await api().post('/api/v1/push/subscribe').set(auth()).send({ endpoint: `https://push.example.com/${run}`, keys: { p256dh: 'p'.repeat(20), auth: 'a'.repeat(16) } }).expect(204);
    gone.add(iosGone);
    reset();

    await api().post('/api/v1/push/test').set(auth()).expect(204);

    expect(apnsGot.map((g) => g.path).sort()).toEqual([`/3/device/${iosA}`, `/3/device/${iosGone}`].sort());
    expect(fcmGot.map((f) => [f.token, f.platform]).sort()).toEqual([[android, 'android'], [iosFcm, 'ios']].sort());
    expect(webGot).toEqual([`https://push.example.com/${run}`]);

    const g = apnsGot.find((x) => x.path.endsWith(iosA))!;
    expect(g.headers['apns-topic']).toBe('com.txillapp.app');
    expect(g.headers['apns-push-type']).toBe('alert');
    expect(g.headers['apns-priority']).toBe('10');
    expect(g.headers['apns-collapse-id']).toBe('test');
    expect(g.body.aps.alert).toEqual({ title: 'Notificações ligadas', body: 'Funciona! Agora chegam a este telemóvel.' });
    expect(g.body.body.url).toBe('/settings');

    // JWT: ES256, kid = Key ID, iss = Team ID, assinado com a chave .p8.
    const [h, p, s] = String(g.headers.authorization).replace(/^bearer /, '').split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'ES256', kid: 'KEY1234567' });
    expect(JSON.parse(Buffer.from(p, 'base64url').toString()).iss).toBe('TEAM123456');
    expect(verify('sha256', Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'))).toBe(true);

    // O 410 apagou só o iPhone que a Apple deu como desaparecido; o Android e o iPhone com código FCM ficam.
    expect(await devices()).toEqual([iosA, iosFcm, android].sort());

    // A app volta a registar-se ao abrir: o iPhone apagado regressa e volta a receber.
    gone.delete(iosGone);
    await api().post('/api/v1/push/device').set(auth()).send({ token: iosGone, platform: 'ios' }).expect(204);
    expect(await devices()).toContain(iosGone);
  });

  it('chamada no iPhone: time-sensitive, toque, botões, fio das chamadas e dados para a app em `body`', async () => {
    reset();
    const push = app.get(PushService);
    await push.send(me.id, { ...ringPush({ id: `call${run}`, video: true, caller: { username: 'ana', displayName: 'Ana' }, ttlSeconds: 45 }), category: 'calls' });
    const g = apnsGot.find((x) => x.path.endsWith(iosA))!;
    expect(g.headers['apns-priority']).toBe('10');
    expect(g.headers['apns-collapse-id']).toBe(`call-call${run}`);
    expect(Number(g.headers['apns-expiration'])).toBeGreaterThan(Date.now() / 1000);
    expect(g.body.aps).toMatchObject({ sound: 'ring.wav', category: 'call', 'interruption-level': 'time-sensitive', 'thread-id': 'calls' });
    expect(g.body.body).toMatchObject({ kind: 'call', callId: `call${run}`, from: 'ana', video: '1' });

    // Reenvios só Web Push não vão ao iPhone.
    reset();
    await push.send(me.id, ringPush({ id: `call${run}`, video: true, caller: { username: 'ana', displayName: 'Ana' }, ttlSeconds: 45, repeat: true }));
    expect(apnsGot).toHaveLength(0);
    expect(fcmGot).toHaveLength(0);
    expect(webGot).toHaveLength(1);
  });

  it('respeita as preferências: mensagens desligadas não chegam a nenhum aparelho', async () => {
    const push = app.get(PushService);
    await push.setOff(me.id, ['messages']);
    reset();
    await push.send(me.id, { title: 'Zé', body: 'enviou-te uma mensagem', url: '/messages/ze', tag: 'chat:ze', category: 'messages' });
    expect(apnsGot.length + fcmGot.length + webGot.length).toBe(0);
    await push.setOff(me.id, []);
    await push.send(me.id, { title: 'Zé', body: 'enviou-te uma mensagem', url: '/messages/ze', tag: 'chat:ze', category: 'messages' });
    expect(apnsGot.find((x) => x.path.endsWith(iosA))!.body.aps['thread-id']).toBe('chat:ze');
  });
});

describe('push: sem configuração APNs', () => {
  it('não envia nem apaga os iPhones (ficam à espera da chave)', async () => {
    await migrate(DB);
    const pool = new Pool({ connectionString: DB });
    const sent: string[] = [];
    const spy = jest.spyOn(FcmSender.prototype, 'send').mockImplementation(async (token) => {
      sent.push(token);
      return 'dead';
    });
    const app = await createApp(
      loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'p'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test', FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({ project_id: 'p', client_email: 'x@p.iam.gserviceaccount.com', private_key: 'falsa' }) }),
    );
    await app.init();
    try {
      const run = `n${Date.now().toString(36)}`;
      const r = await request(app.getHttpServer()).post('/api/v1/auth/register').send({ email: `${run}@example.com`, username: run, displayName: 'Sem Apns', password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
      const ios = randomBytes(32).toString('hex');
      await request(app.getHttpServer()).post('/api/v1/push/device').set({ Authorization: `Bearer ${r.body.accessToken}` }).send({ token: ios, platform: 'ios' }).expect(204);
      await app.get(PushService).send(r.body.user.id, { title: 't', body: 'b', url: '/' });
      expect(sent).toEqual([]); // antes ia ao FCM, que o dava como morto
      expect((await pool.query('SELECT 1 FROM social.push_devices WHERE token = $1', [ios])).rowCount).toBe(1);
    } finally {
      spy.mockRestore();
      await app.close();
      await pool.end();
    }
  }, 60_000);
});
