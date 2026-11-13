import { Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import client from 'prom-client';
import { newInstanceId } from '../common/role';
import { registry } from '../observability/metrics';

/**
 * O tempo real do Txillapp (docs/escala.md, «Tempo real»): os eventos para cada pessoa (o canal SSE), os sinais entre
 * instâncias e o estado curto partilhado (quem está ligado, a conversa à vista, «a escrever»…).
 *
 * Duas implementações com a mesma interface:
 *   - MemoryRealtimeBus: tudo na memória do processo (sem REDIS_URL: desenvolvimento, testes, uma instância só);
 *   - RedisRealtimeBus: os eventos e os sinais passam pelo pub/sub do Redis (chegam às ligações SSE de todas as instâncias)
 *     e o estado vive no Redis com TTL. Se o Redis falhar, cada operação cai para a memória local (degrada para
 *     «uma instância só» em vez de partir): os eventos continuam a chegar a quem está ligado à mesma instância.
 *
 * Os eventos entregam-se SEMPRE logo às ligações da própria instância (síncrono, como o Subject de antes); o Redis só leva
 * o evento às outras (cada uma ignora o que ela própria publicou).
 */
export abstract class RealtimeBus {
  /** true quando o estado e os eventos são partilhados entre instâncias (Redis). */
  abstract readonly shared: boolean;
  /** O nome desta instância (de onde vêm os eventos que ela publica). */
  readonly instance = newInstanceId();
  protected readonly log = new Logger('Tempo real');

  private readonly subs = new Map<string, Set<(event: unknown) => void>>();
  private readonly signalSubs = new Map<string, Set<(data?: string) => void>>();
  /** Ligações SSE abertas NESTA instância, por pessoa. */
  protected readonly local = new Map<string, number>();
  /** Estado curto na memória (o de sempre sem Redis; a reserva quando o Redis falha). */
  protected readonly flags = new Map<string, { value: string; exp: number }>();
  protected readonly sets = new Map<string, Map<string, number>>();

  // ───────────── eventos por pessoa ─────────────

  /** Recebe os eventos para `to` (um id de pessoa). Devolve a função que deixa de receber. */
  subscribe(to: string, cb: (event: unknown) => void): () => void {
    let s = this.subs.get(to);
    if (!s) this.subs.set(to, (s = new Set()));
    s.add(cb);
    return () => {
      s!.delete(cb);
      if (!s!.size && this.subs.get(to) === s) this.subs.delete(to);
    };
  }

  /** Publica um evento para `to`: entrega já às ligações desta instância e, com Redis, às das outras. */
  publish(to: string, event: unknown): void {
    published.inc({ kind: 'event' });
    this.deliver(to, event);
    this.publishRemote(to, event);
  }

  protected deliver(to: string, event: unknown) {
    const s = this.subs.get(to);
    if (!s) return;
    for (const cb of [...s]) {
      try {
        cb(event);
      } catch (e) {
        this.log.warn(`falha a entregar um evento: ${(e as Error).message}`);
      }
    }
  }

  protected abstract publishRemote(to: string, event: unknown): void;

  // ───────────── sinais entre instâncias ─────────────

  /** Avisa todas as instâncias (esta incluída, já): «há trabalho na fila», «a cache do catálogo mudou»… */
  signal(name: string, data?: string): void {
    published.inc({ kind: 'signal' });
    this.deliverSignal(name, data);
    this.signalRemote(name, data);
  }

  onSignal(name: string, cb: (data?: string) => void): () => void {
    let s = this.signalSubs.get(name);
    if (!s) this.signalSubs.set(name, (s = new Set()));
    s.add(cb);
    return () => void s!.delete(cb);
  }

  protected deliverSignal(name: string, data?: string) {
    for (const cb of [...(this.signalSubs.get(name) ?? [])]) {
      try {
        cb(data);
      } catch (e) {
        this.log.warn(`falha a tratar o sinal ${name}: ${(e as Error).message}`);
      }
    }
  }

  protected abstract signalRemote(name: string, data?: string): void;

  // ───────────── quem está ligado ─────────────

  /** Uma ligação SSE abriu nesta instância. */
  connect(userId: string): void {
    const n = (this.local.get(userId) ?? 0) + 1;
    this.local.set(userId, n);
    sseConnections.inc();
    if (n === 1) this.markOnline(userId);
  }

  /** Uma ligação SSE fechou nesta instância. Devolve true se era a última DESTA instância. */
  disconnect(userId: string): boolean {
    const n = (this.local.get(userId) ?? 1) - 1;
    if (this.local.has(userId)) sseConnections.dec();
    if (n <= 0) {
      this.local.delete(userId);
      this.markOffline(userId);
    } else this.local.set(userId, n);
    return n <= 0;
  }

  /** Ligações SSE abertas nesta instância (todas as pessoas). */
  localConnections(): number {
    let n = 0;
    for (const v of this.local.values()) n += v;
    return n;
  }

  protected isLocal(userId: string) {
    return (this.local.get(userId) ?? 0) > 0;
  }

  protected abstract markOnline(userId: string): void;
  protected abstract markOffline(userId: string): void;
  /** A pessoa tem o canal aberto em alguma instância? */
  abstract isOnline(userId: string): Promise<boolean>;
  /** Dos ids pedidos, os que têm o canal aberto em alguma instância. */
  abstract onlineAmong(userIds: string[]): Promise<Set<string>>;

  // ───────────── estado curto (chave → valor, com validade) ─────────────

  abstract setFlag(key: string, value: string, ttlMs: number): Promise<void>;
  abstract getFlag(key: string): Promise<string | null>;
  abstract delFlag(key: string): Promise<void>;
  /** Guarda só se ainda não existir (true = ficou guardado agora): «conta uma vez por dia», etc. */
  abstract claimOnce(key: string, ttlMs: number): Promise<boolean>;
  /** Guarda o valor novo e devolve o que lá estava. */
  abstract swap(key: string, value: string, ttlMs: number): Promise<string | null>;
  /** Apaga só se o valor ainda for este (true = apagou). */
  abstract takeIf(key: string, value: string): Promise<boolean>;

  // ───────────── conjuntos com hora («a escrever» num post) ─────────────

  /** Marca `member` em `set` agora; o conjunto inteiro expira ao fim de `ttlMs` sem novas marcas. */
  abstract touch(set: string, member: string, ttlMs: number, now?: number): Promise<void>;
  /** Quem foi marcado em `set` há menos de `windowMs` (e esquece os mais antigos). */
  abstract recent(set: string, windowMs: number, now?: number): Promise<string[]>;

  /** Para os testes e o fim do processo. */
  async close(): Promise<void> {}

  // ───────────── a versão em memória (partilhada pelas duas implementações) ─────────────

  protected memSet(key: string, value: string, ttlMs: number) {
    this.flags.set(key, { value, exp: Date.now() + ttlMs });
    if (this.flags.size > 50_000) this.memPrune();
  }
  protected memGet(key: string): string | null {
    const f = this.flags.get(key);
    if (!f) return null;
    if (f.exp <= Date.now()) {
      this.flags.delete(key);
      return null;
    }
    return f.value;
  }
  private memPrune() {
    const now = Date.now();
    for (const [k, f] of this.flags) if (f.exp <= now) this.flags.delete(k);
  }
  protected memTouch(set: string, member: string, now: number) {
    let m = this.sets.get(set);
    if (!m) this.sets.set(set, (m = new Map()));
    m.set(member, now);
  }
  protected memRecent(set: string, windowMs: number, now: number): string[] {
    const m = this.sets.get(set);
    if (!m) return [];
    const out: string[] = [];
    for (const [id, at] of m) {
      if (now - at < windowMs) out.push(id);
      else m.delete(id);
    }
    if (!m.size) this.sets.delete(set);
    return out;
  }
}

const published = new client.Counter({ name: 'realtime_published_total', help: 'Eventos e sinais publicados no tempo real', labelNames: ['kind'] as const, registers: [registry] });
const sseConnections = new client.Gauge({ name: 'realtime_sse_connections', help: 'Ligações SSE abertas nesta instância', registers: [registry] });
const redisErrors = new client.Counter({ name: 'realtime_redis_errors_total', help: 'Operações do tempo real que falharam no Redis (caíram para a memória)', labelNames: ['op'] as const, registers: [registry] });

/** Sem Redis: tudo nesta instância (o comportamento de sempre). */
export class MemoryRealtimeBus extends RealtimeBus {
  readonly shared = false;
  protected publishRemote() {}
  protected signalRemote() {}
  protected markOnline() {}
  protected markOffline() {}
  async isOnline(userId: string) {
    return this.isLocal(userId);
  }
  async onlineAmong(userIds: string[]) {
    return new Set(userIds.filter((id) => this.isLocal(id)));
  }
  async setFlag(key: string, value: string, ttlMs: number) {
    this.memSet(key, value, ttlMs);
  }
  async getFlag(key: string) {
    return this.memGet(key);
  }
  async delFlag(key: string) {
    this.flags.delete(key);
  }
  async claimOnce(key: string, ttlMs: number) {
    if (this.memGet(key) !== null) return false;
    this.memSet(key, '1', ttlMs);
    return true;
  }
  async swap(key: string, value: string, ttlMs: number) {
    const old = this.memGet(key);
    this.memSet(key, value, ttlMs);
    return old;
  }
  async takeIf(key: string, value: string) {
    if (this.memGet(key) !== value) return false;
    this.flags.delete(key);
    return true;
  }
  async touch(set: string, member: string, _ttlMs: number, now = Date.now()) {
    this.memTouch(set, member, now);
  }
  async recent(set: string, windowMs: number, now = Date.now()) {
    return this.memRecent(set, windowMs, now);
  }
}

/** Canais e chaves no Redis (tudo com o prefixo `rt:`). */
const EVENTS = 'rt:ev';
const SIGNALS = 'rt:sig';
const onlineKey = (id: string) => `rt:on:${id}`;
/** Quanto tempo uma instância conta como «tem esta pessoa ligada» sem renovar (renova de 20 em 20 s). */
export const ONLINE_TTL_MS = 60_000;
const HEARTBEAT_MS = 20_000;
const TAKE_IF = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`;

/**
 * Com Redis. Quem está ligado: um conjunto ordenado por pessoa (`rt:on:<id>`), com um membro por instância e a hora até
 * quando vale; cada instância renova as suas pessoas de 20 em 20 s, por isso uma instância que morre deixa de contar ao
 * fim de 60 s. A conversa à vista, «a escrever» e as marcas «uma vez» são chaves com TTL.
 */
export class RedisRealtimeBus extends RealtimeBus {
  readonly shared = true;
  private readonly heartbeat: NodeJS.Timeout;
  private lastWarn = 0;

  constructor(
    private readonly redis: Redis,
    private readonly sub: Redis,
  ) {
    super();
    this.sub.on('message', (channel: string, raw: string) => this.onMessage(channel, raw));
    void this.sub.subscribe(EVENTS, SIGNALS).catch((e) => this.warn('subscribe', e));
    this.heartbeat = setInterval(() => void this.renew(), HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  private warn(op: string, e: unknown) {
    redisErrors.inc({ op });
    const now = Date.now();
    if (now - this.lastWarn > 60_000) {
      this.lastWarn = now;
      this.log.warn(`Redis indisponível (${op}): ${(e as Error).message}. A usar a memória desta instância.`);
    }
  }

  private onMessage(channel: string, raw: string) {
    let m: { o?: string; t?: string; e?: unknown; n?: string; d?: string };
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (m.o === this.instance) return; // já entregue cá dentro quando foi publicado
    if (channel === EVENTS && typeof m.t === 'string') this.deliver(m.t, m.e);
    else if (channel === SIGNALS && typeof m.n === 'string') this.deliverSignal(m.n, typeof m.d === 'string' ? m.d : undefined);
  }

  protected publishRemote(to: string, event: unknown) {
    this.redis.publish(EVENTS, JSON.stringify({ o: this.instance, t: to, e: event })).catch((e) => this.warn('publish', e));
  }

  protected signalRemote(name: string, data?: string) {
    this.redis.publish(SIGNALS, JSON.stringify({ o: this.instance, n: name, d: data })).catch((e) => this.warn('signal', e));
  }

  protected markOnline(userId: string) {
    this.redis
      .multi()
      .zadd(onlineKey(userId), Date.now() + ONLINE_TTL_MS, this.instance)
      .pexpire(onlineKey(userId), ONLINE_TTL_MS)
      .exec()
      .catch((e) => this.warn('online', e));
  }

  protected markOffline(userId: string) {
    this.redis.zrem(onlineKey(userId), this.instance).catch((e) => this.warn('offline', e));
  }

  /** Renova as pessoas ligadas a esta instância (e tira as entradas vencidas). */
  private async renew() {
    const ids = [...this.local.keys()];
    if (!ids.length) return;
    const exp = Date.now() + ONLINE_TTL_MS;
    for (let i = 0; i < ids.length; i += 500) {
      const p = this.redis.pipeline();
      for (const id of ids.slice(i, i + 500)) p.zadd(onlineKey(id), exp, this.instance).pexpire(onlineKey(id), ONLINE_TTL_MS);
      await p.exec().catch((e) => this.warn('renew', e));
    }
  }

  async isOnline(userId: string) {
    if (this.isLocal(userId)) return true;
    try {
      return (await this.redis.zcount(onlineKey(userId), Date.now(), '+inf')) > 0;
    } catch (e) {
      this.warn('isOnline', e);
      return false;
    }
  }

  async onlineAmong(userIds: string[]) {
    const out = new Set(userIds.filter((id) => this.isLocal(id)));
    const rest = userIds.filter((id) => !out.has(id));
    if (!rest.length) return out;
    try {
      const now = Date.now();
      const p = this.redis.pipeline();
      for (const id of rest) p.zcount(onlineKey(id), now, '+inf');
      const res = (await p.exec()) ?? [];
      rest.forEach((id, i) => {
        const [err, n] = res[i] ?? [];
        if (!err && Number(n) > 0) out.add(id);
      });
    } catch (e) {
      this.warn('onlineAmong', e);
    }
    return out;
  }

  async setFlag(key: string, value: string, ttlMs: number) {
    try {
      await this.redis.set(key, value, 'PX', ttlMs);
    } catch (e) {
      this.warn('set', e);
      this.memSet(key, value, ttlMs);
    }
  }

  async getFlag(key: string) {
    try {
      return await this.redis.get(key);
    } catch (e) {
      this.warn('get', e);
      return this.memGet(key);
    }
  }

  async delFlag(key: string) {
    this.flags.delete(key);
    await this.redis.del(key).catch((e) => this.warn('del', e));
  }

  async claimOnce(key: string, ttlMs: number) {
    try {
      return (await this.redis.set(key, '1', 'PX', ttlMs, 'NX')) === 'OK';
    } catch (e) {
      this.warn('claimOnce', e);
      if (this.memGet(key) !== null) return false;
      this.memSet(key, '1', ttlMs);
      return true;
    }
  }

  async swap(key: string, value: string, ttlMs: number) {
    try {
      const [[err, old]] = ((await this.redis.multi().get(key).set(key, value, 'PX', ttlMs).exec()) ?? [[new Error('sem resposta'), null]]) as [Error | null, string | null][];
      if (err) throw err;
      return old;
    } catch (e) {
      this.warn('swap', e);
      const old = this.memGet(key);
      this.memSet(key, value, ttlMs);
      return old;
    }
  }

  async takeIf(key: string, value: string) {
    try {
      return Number(await this.redis.eval(TAKE_IF, 1, key, value)) === 1;
    } catch (e) {
      this.warn('takeIf', e);
      if (this.memGet(key) !== value) return false;
      this.flags.delete(key);
      return true;
    }
  }

  async touch(set: string, member: string, ttlMs: number, now = Date.now()) {
    try {
      await this.redis.multi().zadd(set, now, member).pexpire(set, ttlMs).exec();
    } catch (e) {
      this.warn('touch', e);
      this.memTouch(set, member, now);
    }
  }

  async recent(set: string, windowMs: number, now = Date.now()) {
    try {
      const res = (await this.redis.multi().zremrangebyscore(set, '-inf', now - windowMs).zrangebyscore(set, `(${now - windowMs}`, '+inf').exec()) ?? [];
      const [err, ids] = res[1] ?? [new Error('sem resposta'), null];
      if (err) throw err;
      return ids as string[];
    } catch (e) {
      this.warn('recent', e);
      return this.memRecent(set, windowMs, now);
    }
  }

  async close() {
    clearInterval(this.heartbeat);
    // Esta instância deixa de ter pessoas ligadas (as outras não esperam 60 s para o saber).
    const ids = [...this.local.keys()];
    if (ids.length) {
      const p = this.redis.pipeline();
      for (const id of ids) p.zrem(onlineKey(id), this.instance);
      await p.exec().catch(() => undefined);
    }
    this.local.clear();
  }
}
