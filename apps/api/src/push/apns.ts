import { createHash, createPrivateKey, sign, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http2 from 'node:http2';
import { Logger } from '@nestjs/common';
import type { FcmPush } from './fcm';

/**
 * Envio direto para o iPhone pelo APNs (Apple Push Notification service), em HTTP/2 com autenticação por token (chave .p8).
 *
 * Porquê: a app (expo-notifications, `getDevicePushTokenAsync`) regista no iPhone o código APNs do aparelho (64 hex), que o
 * FCM não aceita (sem o SDK da Firebase na app). Antes ia tudo pelo FCM, que respondia "registration token" inválido, e o
 * aparelho era apagado: nada tocava com a app fechada. Agora o código APNs vai para a Apple e o resto continua no FCM.
 *
 * O que a app lê: o expo-notifications, no iPhone, tira os dados de uma notificação remota de `userInfo.body` (um objeto),
 * por isso os dados (kind, callId, from, url, tag…) vão em `body`, ao lado de `aps`.
 */

export interface ApnsOptions {
  key: KeyObject;
  keyId: string;
  teamId: string;
  bundleId: string;
  /** https://api.push.apple.com, https://api.sandbox.push.apple.com, ou outro (testes, HTTP/2 sem TLS). */
  origin: string;
  /** Esperas antes de tentar outra vez (429, 5xx, falha de rede). Por omissão 0,5 s e 2 s. */
  retryDelaysMs?: number[];
  /** Quanto se espera por cada resposta. */
  timeoutMs?: number;
}

/** O que se envia ao iPhone: o mesmo que ao FCM, mais a categoria das preferências e o fio (conversa) opcional. */
export interface ApnsPush extends FcmPush {
  category?: string;
  /** `thread-id` (agrupa as notificações no iPhone). Sem isto, deduz-se da etiqueta (ver `apnsThread`). */
  thread?: string;
}

export type ApnsResult = 'ok' | 'dead' | 'error';

export const APNS_PRODUCTION_ORIGIN = 'https://api.push.apple.com';
export const APNS_SANDBOX_ORIGIN = 'https://api.sandbox.push.apple.com';
/** A Apple aceita o token até 60 min e não quer um novo mais de uma vez a cada 20 min: renova-se aos 50. */
export const APNS_JWT_TTL_MS = 50 * 60_000;

/** Um código APNs: 32 bytes em hexadecimal (64 caracteres; a Apple diz que pode crescer). Os do FCM nunca são só hex. */
export const looksLikeApnsToken = (token: string) => /^[0-9a-f]{64,200}$/i.test(token);

/** Para onde vai cada aparelho da app nativa: iPhone com código APNs vai à Apple; o resto (Android, ou iPhone com código FCM) ao FCM. */
export function nativeRoute(platform: string, token: string): 'apns' | 'fcm' {
  return platform === 'ios' && looksLikeApnsToken(token) ? 'apns' : 'fcm';
}

/**
 * Lê a chave .p8: o PEM (com quebras de linha verdadeiras ou `\n` escritos numa linha, como num .env), o ficheiro todo em
 * base64, ou só o miolo em base64. Tem de ser uma chave EC P-256 (as da Apple são). Lança erro sem mostrar a chave.
 */
export function parseApnsKey(raw: string): KeyObject {
  const text = raw.trim().replace(/\\n/g, '\n').replace(/\r/g, '');
  let key: KeyObject;
  try {
    if (text.includes('-----BEGIN')) key = createPrivateKey({ key: text, format: 'pem' });
    else {
      const buf = Buffer.from(text.replace(/\s+/g, ''), 'base64');
      const decoded = buf.toString('utf8');
      key = decoded.includes('-----BEGIN') ? createPrivateKey({ key: decoded, format: 'pem' }) : createPrivateKey({ key: buf, format: 'der', type: 'pkcs8' });
    }
  } catch {
    throw new Error('a chave APNs (.p8) não é válida');
  }
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new Error('a chave APNs (.p8) não é uma chave EC P-256');
  return key;
}

export interface ApnsEnv {
  APNS_KEY_P8?: string;
  APNS_KEY_PATH?: string;
  APNS_KEY_ID?: string;
  APNS_TEAM_ID?: string;
  APNS_BUNDLE_ID?: string;
  APNS_PRODUCTION?: boolean;
  APNS_ORIGIN?: string;
}

/** Monta as opções a partir das variáveis de ambiente. Sem configuração (ou com ela errada) devolve o motivo, sem a chave. */
export function apnsOptionsFromEnv(env: ApnsEnv): { options: ApnsOptions | null; problem?: string } {
  const hasKey = !!(env.APNS_KEY_P8 || env.APNS_KEY_PATH);
  if (!hasKey && !env.APNS_KEY_ID && !env.APNS_TEAM_ID) return { options: null, problem: 'sem APNS_KEY_P8 (ou APNS_KEY_PATH), APNS_KEY_ID e APNS_TEAM_ID' };
  const missing = [!hasKey && 'APNS_KEY_P8 (ou APNS_KEY_PATH)', !env.APNS_KEY_ID && 'APNS_KEY_ID', !env.APNS_TEAM_ID && 'APNS_TEAM_ID'].filter(Boolean);
  if (missing.length) return { options: null, problem: `falta ${missing.join(', ')}` };
  let raw: string;
  try {
    raw = env.APNS_KEY_P8 ?? readFileSync(env.APNS_KEY_PATH!, 'utf8');
  } catch {
    return { options: null, problem: 'não foi possível ler o ficheiro de APNS_KEY_PATH' };
  }
  try {
    return {
      options: {
        key: parseApnsKey(raw),
        keyId: env.APNS_KEY_ID!,
        teamId: env.APNS_TEAM_ID!,
        bundleId: env.APNS_BUNDLE_ID || 'com.txillapp.app',
        origin: env.APNS_ORIGIN ?? (env.APNS_PRODUCTION === false ? APNS_SANDBOX_ORIGIN : APNS_PRODUCTION_ORIGIN),
      },
    };
  } catch (e) {
    return { options: null, problem: (e as Error).message };
  }
}

/** O token do fornecedor (JWT ES256): cabeçalho com `kid` (o Key ID) e corpo com `iss` (o Team ID) e `iat`. */
export function apnsJwt(key: KeyObject, keyId: string, teamId: string, nowSec = Math.floor(Date.now() / 1000)): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const input = `${b64({ alg: 'ES256', kid: keyId })}.${b64({ iss: teamId, iat: nowSec })}`;
  const sig = sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `${input}.${sig}`;
}

/** Agrupar no iPhone: uma conversa ou grupo por fio, as chamadas juntas, o resto pela categoria. */
export function apnsThread(m: ApnsPush): string | undefined {
  if (m.thread) return m.thread;
  const tag = m.tag ?? '';
  if (/^(chat|group):/.test(tag)) return tag;
  const kind = m.data?.kind;
  if (tag.startsWith('call-') || kind === 'call' || kind === 'missed_call') return 'calls';
  return m.category;
}

/** `apns-collapse-id` tem no máximo 64 bytes: etiquetas maiores passam a um resumo (a mesma etiqueta dá sempre o mesmo). */
export function apnsCollapseId(tag: string): string {
  return Buffer.byteLength(tag) <= 64 ? tag : createHash('sha256').update(tag).digest('hex');
}

/** Categorias que chegam logo (prioridade 10); o resto (seguidores, brindes…) vai com 5, como a Apple sugere. */
const URGENT = new Set(['messages', 'calls']);

/** Monta os cabeçalhos e o conteúdo para a Apple. Separado do envio para se poder testar sem rede. */
export function buildApnsRequest(m: ApnsPush, bundleId: string, nowMs = Date.now()): { headers: Record<string, string>; payload: Record<string, unknown> } {
  const isCall = m.actionCategory === 'call' || m.data?.kind === 'call' || m.data?.kind === 'missed_call';
  const urgent = isCall || !m.category || URGENT.has(m.category);
  const thread = apnsThread(m);
  const headers: Record<string, string> = {
    'apns-push-type': 'alert',
    'apns-priority': urgent ? '10' : '5',
    'apns-topic': bundleId,
    ...(m.tag ? { 'apns-collapse-id': apnsCollapseId(m.tag) } : {}),
    ...(m.ttlSeconds ? { 'apns-expiration': String(Math.floor(nowMs / 1000) + m.ttlSeconds) } : {}),
  };
  const aps: Record<string, unknown> = {
    alert: { title: m.title, body: m.body },
    sound: m.ios?.sound ?? 'default',
    ...(m.actionCategory ? { category: m.actionCategory } : {}),
    ...(m.ios?.interruptionLevel ? { 'interruption-level': m.ios.interruptionLevel } : {}),
    ...(thread ? { 'thread-id': thread } : {}),
  };
  return { headers, payload: { aps, body: { ...(m.data ?? {}), url: m.url, ...(m.tag ? { tag: m.tag } : {}) } } };
}

/** A resposta da Apple quer dizer que o código do aparelho já não serve (para o apagar)? */
export function apnsTokenIsDead(status: number, reason: string): boolean {
  return status === 410 || (status === 400 && (reason === 'BadDeviceToken' || reason === 'DeviceTokenNotForTopic'));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class ApnsSender {
  private readonly log = new Logger('Push');
  private session: http2.ClientHttp2Session | null = null;
  private jwt: { value: string; at: number } | null = null;

  constructor(private readonly o: ApnsOptions | null) {}

  get enabled() {
    return !!this.o;
  }

  /** O JWT fica guardado 50 minutos (a Apple recusa tokens novos a cada envio). */
  providerToken(): string {
    if (this.jwt && Date.now() - this.jwt.at < APNS_JWT_TTL_MS) return this.jwt.value;
    const o = this.o!;
    this.jwt = { value: apnsJwt(o.key, o.keyId, o.teamId), at: Date.now() };
    return this.jwt.value;
  }

  /** Uma só ligação HTTP/2 para todos os envios (a Apple pede ligações duradouras); refaz-se se cair. */
  private connect(): http2.ClientHttp2Session {
    const cur = this.session;
    if (cur && !cur.closed && !cur.destroyed) return cur;
    const s = http2.connect(this.o!.origin);
    s.on('error', () => undefined); // o pedido em curso recebe o erro
    s.on('goaway', () => { if (this.session === s) this.session = null; });
    s.on('close', () => { if (this.session === s) this.session = null; });
    s.setTimeout(10 * 60_000, () => s.close()); // parada há muito: fecha
    s.unref(); // não segura o processo
    this.session = s;
    return s;
  }

  private request(path: string, headers: Record<string, string>, body: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      let s: http2.ClientHttp2Session;
      try {
        s = this.connect();
      } catch (e) {
        reject(e as Error);
        return;
      }
      const req = s.request({ ':method': 'POST', ':path': path, 'content-type': 'application/json', ...headers });
      let status = 0;
      let data = '';
      req.setEncoding('utf8');
      req.setTimeout(this.o!.timeoutMs ?? 10_000, () => {
        req.close(http2.constants.NGHTTP2_CANCEL);
        reject(new Error('sem resposta'));
      });
      req.on('response', (h) => { status = Number(h[':status'] ?? 0); });
      req.on('data', (c: string) => { data += c; });
      req.on('end', () => resolve({ status, body: data }));
      req.on('error', reject);
      req.end(body);
    });
  }

  /**
   * Envia a um iPhone. 'dead' só quando a Apple diz que o código já não serve (410 Unregistered, 400 BadDeviceToken ou
   * DeviceTokenNotForTopic): o aparelho é apagado e volta a registar-se quando a app abrir. 429, 5xx e falhas de rede
   * tentam outra vez com espera; 403 com o token do fornecedor expirado renova-o uma vez. Os registos nunca têm a chave,
   * o JWT nem o código do aparelho.
   */
  async send(deviceToken: string, m: ApnsPush): Promise<ApnsResult> {
    const o = this.o!;
    if (!looksLikeApnsToken(deviceToken)) return 'dead';
    const { headers, payload } = buildApnsRequest(m, o.bundleId);
    const body = JSON.stringify(payload);
    const delays = o.retryDelaysMs ?? [500, 2000];
    let renewed = false;
    let retries = 0;
    for (;;) {
      let status = 0;
      let reason = '';
      try {
        const r = await this.request(`/3/device/${deviceToken}`, { ...headers, authorization: `bearer ${this.providerToken()}` }, body);
        status = r.status;
        try {
          reason = String((JSON.parse(r.body || '{}') as { reason?: string }).reason ?? '');
        } catch {
          reason = '';
        }
      } catch (e) {
        reason = `rede: ${(e as Error).message}`;
      }
      if (status === 200) return 'ok';
      if (apnsTokenIsDead(status, reason)) {
        this.log.warn(`APNs ${status} ${reason || 'Unregistered'} (aparelho apagado)`);
        return 'dead';
      }
      if (status === 403 && /ProviderToken/.test(reason) && !renewed) {
        renewed = true;
        this.jwt = null;
        continue;
      }
      if ((status === 0 || status === 429 || status >= 500) && retries < delays.length) {
        await sleep(delays[retries++]);
        continue;
      }
      this.log.warn(`APNs ${status || 'sem resposta'}${reason ? ` ${reason.slice(0, 120)}` : ''}`);
      return 'error';
    }
  }

  close() {
    this.session?.close();
    this.session = null;
  }
}
