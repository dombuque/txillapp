import { generateKeyPairSync, verify, type KeyObject } from 'node:crypto';
import http2 from 'node:http2';
import type { AddressInfo } from 'node:net';
import { Logger } from '@nestjs/common';
import { ringPush } from '../calls/call-push';
import {
  APNS_PRODUCTION_ORIGIN,
  APNS_SANDBOX_ORIGIN,
  ApnsSender,
  apnsCollapseId,
  apnsJwt,
  apnsOptionsFromEnv,
  apnsTokenIsDead,
  buildApnsRequest,
  looksLikeApnsToken,
  nativeRoute,
  parseApnsKey,
} from './apns';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const PEM = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
const TOKEN = 'a1'.repeat(32); // 64 hex
const FCM_TOKEN = 'dGVzdDpBUEE5MWJIX2ZjbS10b2tlbi1kZS10ZXN0ZS0xMjM0NTY3ODkw';

function decodeJwt(jwt: string, pub: KeyObject = publicKey) {
  const [h, p, s] = jwt.split('.');
  return {
    header: JSON.parse(Buffer.from(h, 'base64url').toString()),
    claims: JSON.parse(Buffer.from(p, 'base64url').toString()),
    valid: verify('sha256', Buffer.from(`${h}.${p}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')),
  };
}

/** Servidor APNs falso (HTTP/2 sem TLS): responde o que a fila mandar e guarda cada pedido. */
async function fakeApns() {
  const got: { headers: http2.IncomingHttpHeaders; body: Record<string, unknown> }[] = [];
  const replies: { status: number; reason?: string }[] = [];
  const server = http2.createServer();
  server.on('stream', (stream, headers) => {
    let data = '';
    stream.setEncoding('utf8');
    stream.on('data', (c: string) => (data += c));
    stream.on('end', () => {
      got.push({ headers, body: JSON.parse(data) });
      const r = replies.shift() ?? { status: 200 };
      stream.respond({ ':status': r.status, 'apns-id': 'x' });
      stream.end(r.reason ? JSON.stringify({ reason: r.reason }) : '');
    });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { got, replies, origin, close: () => new Promise<void>((ok) => server.close(() => ok())) };
}

describe('APNs: conteúdo e cabeçalhos', () => {
  it('chamada: alerta, prioridade 10, time-sensitive, toque, categoria, fio das chamadas, collapse-id e validade', () => {
    const now = 1_700_000_000_000;
    const m = ringPush({ id: 'abc', video: true, caller: { username: 'ana', displayName: 'Ana Teste' }, ttlSeconds: 45 });
    const { headers, payload } = buildApnsRequest({ ...m, category: 'calls' }, 'com.txillapp.app', now);
    expect(headers).toEqual({
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'apns-topic': 'com.txillapp.app',
      'apns-collapse-id': 'call-abc',
      'apns-expiration': String(1_700_000_000 + 45),
    });
    expect(payload).toEqual({
      aps: {
        alert: { title: 'Ana Teste', body: 'Videochamada' },
        sound: 'ring.wav',
        category: 'call',
        'interruption-level': 'time-sensitive',
        'thread-id': 'calls',
      },
      // O expo-notifications lê os dados de `body` no iPhone.
      body: { kind: 'call', callId: 'abc', from: 'ana', video: '1', url: '/call/abc?from=ana&video=1', tag: 'call-abc' },
    });
  });

  it('mensagem: fio por conversa, som normal, prioridade 10; seguidores com prioridade 5', () => {
    const msg = buildApnsRequest({ title: 'Zé', body: 'enviou-te uma mensagem', url: '/messages/ze', tag: 'chat:u1', category: 'messages' }, 'b');
    expect(msg.headers['apns-priority']).toBe('10');
    expect(msg.headers['apns-collapse-id']).toBe('chat:u1');
    expect(msg.headers['apns-expiration']).toBeUndefined();
    expect(msg.payload.aps).toEqual({ alert: { title: 'Zé', body: 'enviou-te uma mensagem' }, sound: 'default', 'thread-id': 'chat:u1' });
    const group = buildApnsRequest({ title: 'Malta', body: 'Zé: olá', url: '/messages/g/1', tag: 'group:1', category: 'messages' }, 'b');
    expect((group.payload.aps as Record<string, unknown>)['thread-id']).toBe('group:1');
    const follow = buildApnsRequest({ title: 'Zé', body: 'começou a seguir-te', url: '/u/ze', tag: 'follow:1', category: 'follows' }, 'b');
    expect(follow.headers['apns-priority']).toBe('5');
    expect((follow.payload.aps as Record<string, unknown>)['thread-id']).toBe('follows');
  });

  it('collapse-id com mais de 64 bytes vira um resumo fixo', () => {
    const long = 'x'.repeat(80);
    expect(apnsCollapseId(long)).toHaveLength(64);
    expect(apnsCollapseId(long)).toBe(apnsCollapseId(long));
    expect(apnsCollapseId('curto')).toBe('curto');
  });

  it('códigos: APNs (hex) vai à Apple, Android e iPhone com código FCM vão ao FCM', () => {
    expect(looksLikeApnsToken(TOKEN)).toBe(true);
    expect(looksLikeApnsToken(FCM_TOKEN)).toBe(false);
    expect(nativeRoute('ios', TOKEN)).toBe('apns');
    expect(nativeRoute('ios', FCM_TOKEN)).toBe('fcm');
    expect(nativeRoute('android', FCM_TOKEN)).toBe('fcm');
    expect(nativeRoute('android', TOKEN)).toBe('fcm');
  });

  it('erros que apagam o aparelho: 410, 400 BadDeviceToken e DeviceTokenNotForTopic (outros 400 não)', () => {
    expect(apnsTokenIsDead(410, 'Unregistered')).toBe(true);
    expect(apnsTokenIsDead(400, 'BadDeviceToken')).toBe(true);
    expect(apnsTokenIsDead(400, 'DeviceTokenNotForTopic')).toBe(true);
    expect(apnsTokenIsDead(400, 'BadCollapseId')).toBe(false);
    expect(apnsTokenIsDead(429, 'TooManyRequests')).toBe(false);
    expect(apnsTokenIsDead(500, 'InternalServerError')).toBe(false);
  });
});

describe('APNs: chave e configuração', () => {
  it('lê o PEM, o PEM numa linha com \\n e o ficheiro em base64', () => {
    expect(parseApnsKey(PEM).asymmetricKeyType).toBe('ec');
    expect(parseApnsKey(PEM.replace(/\n/g, '\\n')).asymmetricKeyType).toBe('ec');
    expect(parseApnsKey(Buffer.from(PEM).toString('base64')).asymmetricKeyType).toBe('ec');
    const body = PEM.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
    expect(parseApnsKey(body).asymmetricKeyType).toBe('ec');
    expect(() => parseApnsKey('isto-nao-e-uma-chave')).toThrow('não é válida');
    const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    expect(() => parseApnsKey(rsa)).toThrow('EC P-256');
  });

  it('sem configuração fica desligado com o motivo; produção e sandbox; o motivo nunca traz a chave', () => {
    expect(apnsOptionsFromEnv({}).options).toBeNull();
    expect(apnsOptionsFromEnv({ APNS_KEY_ID: 'K' }).problem).toContain('APNS_TEAM_ID');
    const bad = apnsOptionsFromEnv({ APNS_KEY_P8: 'SEGREDO-123', APNS_KEY_ID: 'K', APNS_TEAM_ID: 'T' });
    expect(bad.options).toBeNull();
    expect(bad.problem).not.toContain('SEGREDO');
    const prod = apnsOptionsFromEnv({ APNS_KEY_P8: PEM, APNS_KEY_ID: 'K', APNS_TEAM_ID: 'T', APNS_PRODUCTION: true });
    expect(prod.options?.origin).toBe(APNS_PRODUCTION_ORIGIN);
    expect(prod.options?.bundleId).toBe('com.txillapp.app');
    expect(apnsOptionsFromEnv({ APNS_KEY_P8: PEM, APNS_KEY_ID: 'K', APNS_TEAM_ID: 'T', APNS_PRODUCTION: false }).options?.origin).toBe(APNS_SANDBOX_ORIGIN);
    expect(apnsOptionsFromEnv({ APNS_KEY_PATH: '/nao/existe.p8', APNS_KEY_ID: 'K', APNS_TEAM_ID: 'T' }).problem).toContain('APNS_KEY_PATH');
  });

  it('JWT ES256 com kid (Key ID) e iss (Team ID), assinatura válida', () => {
    const { header, claims, valid } = decodeJwt(apnsJwt(privateKey, 'KEY1234567', 'TEAM123456', 1_700_000_000));
    expect(header).toEqual({ alg: 'ES256', kid: 'KEY1234567' });
    expect(claims).toEqual({ iss: 'TEAM123456', iat: 1_700_000_000 });
    expect(valid).toBe(true);
  });
});

describe('APNs: envio por HTTP/2 (servidor falso)', () => {
  let apns: Awaited<ReturnType<typeof fakeApns>>;
  let sender: ApnsSender;
  const warns: string[] = [];

  beforeAll(async () => {
    apns = await fakeApns();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation((m: unknown) => void warns.push(String(m)));
  });
  beforeEach(() => {
    apns.got.length = 0;
    apns.replies.length = 0;
    sender = new ApnsSender({ key: privateKey, keyId: 'KEY1234567', teamId: 'TEAM123456', bundleId: 'com.txillapp.app', origin: apns.origin, retryDelaysMs: [5, 5] });
  });
  afterEach(() => sender.close());
  afterAll(async () => {
    jest.restoreAllMocks();
    await apns.close();
  });

  it('200: caminho, cabeçalhos e JWT certos; o JWT fica guardado entre envios', async () => {
    const m = ringPush({ id: 'c1', video: false, caller: { username: 'ana', displayName: 'Ana' }, ttlSeconds: 45 });
    expect(await sender.send(TOKEN, m)).toBe('ok');
    expect(await sender.send(TOKEN, { title: 'Zé', body: 'olá', url: '/messages/ze', tag: 'chat:1', category: 'messages' })).toBe('ok');
    const [a, b] = apns.got;
    expect(a.headers[':method']).toBe('POST');
    expect(a.headers[':path']).toBe(`/3/device/${TOKEN}`);
    expect(a.headers['apns-topic']).toBe('com.txillapp.app');
    expect(a.headers['apns-push-type']).toBe('alert');
    expect(a.headers['apns-priority']).toBe('10');
    expect(a.headers['apns-collapse-id']).toBe('call-c1');
    expect(a.headers['content-type']).toBe('application/json');
    expect((a.body.aps as Record<string, unknown>)['interruption-level']).toBe('time-sensitive');
    const auth = String(a.headers.authorization);
    expect(auth.startsWith('bearer ')).toBe(true);
    const jwt = decodeJwt(auth.slice(7));
    expect(jwt.header.kid).toBe('KEY1234567');
    expect(jwt.claims.iss).toBe('TEAM123456');
    expect(jwt.valid).toBe(true);
    expect(b.headers.authorization).toBe(auth); // cache de 50 min
    expect((b.body.aps as Record<string, unknown>)['thread-id']).toBe('chat:1');
  });

  it('410 e 400 BadDeviceToken dizem "dead"; 400 por outro motivo é "error" (não apaga)', async () => {
    apns.replies.push({ status: 410, reason: 'Unregistered' }, { status: 400, reason: 'BadDeviceToken' }, { status: 400, reason: 'DeviceTokenNotForTopic' }, { status: 400, reason: 'PayloadTooLarge' });
    const m = { title: 't', body: 'b', url: '/' };
    expect(await sender.send(TOKEN, m)).toBe('dead');
    expect(await sender.send(TOKEN, m)).toBe('dead');
    expect(await sender.send(TOKEN, m)).toBe('dead');
    expect(await sender.send(TOKEN, m)).toBe('error');
    expect(apns.got).toHaveLength(4);
  });

  it('429 e 5xx tentam outra vez com espera; ao fim das tentativas fica "error"', async () => {
    apns.replies.push({ status: 429, reason: 'TooManyRequests' }, { status: 503, reason: 'ServiceUnavailable' });
    expect(await sender.send(TOKEN, { title: 't', body: 'b', url: '/' })).toBe('ok');
    expect(apns.got).toHaveLength(3);
    apns.got.length = 0;
    apns.replies.push({ status: 500 }, { status: 500 }, { status: 500 });
    expect(await sender.send(TOKEN, { title: 't', body: 'b', url: '/' })).toBe('error');
    expect(apns.got).toHaveLength(3); // 1 + 2 tentativas
  });

  it('403 ExpiredProviderToken renova o JWT uma vez', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'], now: 1_700_000_000_000 });
    sender.providerToken();
    jest.setSystemTime(1_700_000_000_000 + 1000 * 61); // iat diferente no token novo
    apns.replies.push({ status: 403, reason: 'ExpiredProviderToken' });
    expect(await sender.send(TOKEN, { title: 't', body: 'b', url: '/' })).toBe('ok');
    jest.useRealTimers();
    expect(apns.got).toHaveLength(2);
    expect(apns.got[0].headers.authorization).not.toBe(apns.got[1].headers.authorization);
  });

  it('o JWT renova-se passados 50 minutos', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'], now: 1_700_000_000_000 });
    const a = sender.providerToken();
    jest.setSystemTime(1_700_000_000_000 + 49 * 60_000);
    expect(sender.providerToken()).toBe(a);
    jest.setSystemTime(1_700_000_000_000 + 51 * 60_000);
    expect(sender.providerToken()).not.toBe(a);
    jest.useRealTimers();
  });

  it('código que não é APNs não sai; servidor em baixo dá "error" depois das tentativas', async () => {
    expect(await sender.send('nao-e-hex', { title: 't', body: 'b', url: '/' })).toBe('dead');
    expect(apns.got).toHaveLength(0);
    const off = new ApnsSender({ key: privateKey, keyId: 'K', teamId: 'T', bundleId: 'b', origin: 'http://127.0.0.1:1', retryDelaysMs: [1] });
    expect(await off.send(TOKEN, { title: 't', body: 'b', url: '/' })).toBe('error');
    off.close();
  });

  it('os registos nunca têm a chave, o JWT nem o código do aparelho', async () => {
    apns.replies.push({ status: 410, reason: 'Unregistered' }, { status: 400, reason: 'BadPriority' });
    await sender.send(TOKEN, { title: 't', body: 'b', url: '/' });
    await sender.send(TOKEN, { title: 't', body: 'b', url: '/' });
    const jwt = String(apns.got[0].headers.authorization).slice(7);
    const keyBody = PEM.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '').slice(10, 40);
    expect(warns.length).toBeGreaterThan(0);
    for (const w of warns) {
      expect(w).not.toContain(TOKEN);
      expect(w).not.toContain(jwt);
      expect(w).not.toContain(keyBody);
    }
  });
});
