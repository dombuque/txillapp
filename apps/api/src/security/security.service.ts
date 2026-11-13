import { ForbiddenException, HttpException, HttpStatus, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Request } from 'express';
import { Pool, PoolClient } from 'pg';
import { createHash } from 'node:crypto';
import { describeDevice, sessionUserAgent } from '../common/device';
import { uuidv7 } from '../common/uuid7';
import { AppConfig, CONFIG } from '../config';
import { PG_POOL } from '../db/db.module';
import { Scheduler } from '../realtime/scheduler';
import { HashGate } from './hash-gate';
import { securityEvents } from './metrics';
import { fingerprint, netPrints } from './net';
import { RATE_STORE, RateStore } from './rate-store';
import { LOGIN, MAIL_LIMITS, REGISTER, SECURITY_RETENTION_DAYS } from './rules';
import { HumanResult, TurnstileService } from './turnstile.service';

/** O que a segurança precisa de saber de cada pedido (sem guardar o IP: só as impressões). */
export interface ReqContext {
  /** Impressão do IP (/64 no IPv6) e da rede (/24 ou /48); null quando o IP é interno (testes, worker). */
  ip: string | null;
  net: string | null;
  /** Impressão da instalação da app (cabeçalho X-Install-Id), se veio. */
  device: string | null;
  /** «Android · app Txillapp 1.45», para os eventos e os emails. */
  deviceLabel: string;
  client: 'web' | 'app' | 'other';
  turnstileToken?: string;
  /** A prova de humano é obrigatória para este pedido (ligada e não é a app nativa antiga). */
  humanRequired: boolean;
}

export type SecurityEventKind =
  | 'login_failed' | 'login_locked' | 'login_blocked' | 'ip_locked' | 'human_failed' | 'human_missing' | 'human_unavailable'
  | 'register_limited' | 'register_disposable' | 'email_check_limited' | 'mail_limited' | 'risk_flagged' | 'risk_limited'
  | 'refresh_reuse' | 'new_login' | 'hash_busy';

/** Erro 429 com o tempo de espera (cabeçalho Retry-After e `retryAfter` em segundos no corpo). */
export function tooMany(code: string, message: string, until?: Date | null) {
  const retryAfter = until ? Math.max(1, Math.ceil((until.getTime() - Date.now()) / 1000)) : undefined;
  return new HttpException({ statusCode: 429, code, message, ...(retryAfter ? { retryAfter } : {}) }, HttpStatus.TOO_MANY_REQUESTS);
}

/** «15 minutos», «2 horas». */
export function waitText(until: Date): string {
  const min = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60_000));
  if (min < 60) return `${min} minuto${min === 1 ? '' : 's'}`;
  const h = Math.ceil(min / 60);
  return `${h} hora${h === 1 ? '' : 's'}`;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 32);

/**
 * Segurança das contas: o contexto de cada pedido (impressões do IP, da rede e do aparelho), os eventos (tabela com prazo
 * + métricas do Prometheus), a prova de humano, os travões do login, do registo e dos emails, e a limpeza dos prazos.
 */
@Injectable()
export class SecurityService implements OnModuleInit {
  private readonly log = new Logger('Segurança');
  private readonly salt: string;
  readonly hashGate: HashGate;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(RATE_STORE) readonly store: RateStore,
    readonly turnstile: TurnstileService,
    private readonly scheduler: Scheduler,
  ) {
    // O mesmo segredo do servidor, noutro uso: as impressões não servem fora daqui.
    this.salt = sha(`security|${config.JWT_ACCESS_SECRET}`);
    this.hashGate = new HashGate(config.ARGON2_CONCURRENCY, config.ARGON2_QUEUE, 10_000);
  }

  /** A limpeza dos prazos: de 10 em 10 minutos, só no worker (ou sem ROLE), pelo Scheduler da escala. */
  onModuleInit() {
    this.scheduler.every('security.purge', 10 * 60_000, () => this.purge());
  }

  /** A impressão de um valor qualquer (um identificador de login, um email). */
  print(kind: string, value: string) {
    return fingerprint(this.salt, kind, value.trim().toLowerCase());
  }

  context(req: Request): ReqContext {
    const n = netPrints(this.salt, req.ip);
    const rawDevice = req.headers['x-install-id'];
    const device = typeof rawDevice === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(rawDevice) ? fingerprint(this.salt, 'device', rawDevice) : null;
    const x = req.headers['x-client'];
    return {
      ip: n?.ip ?? null,
      net: n?.net ?? null,
      device,
      deviceLabel: describeDevice(sessionUserAgent(req.headers)).label.slice(0, 80),
      client: x === 'txillapp-web' ? 'web' : x === 'txillapp-mobile' ? 'app' : 'other',
      turnstileToken: TurnstileService.tokenOf(req),
      humanRequired: this.turnstile.required(req),
    };
  }

  /** Regista um evento (tabela com prazo de 90 dias) e soma-o nas métricas. Nunca falha o pedido. */
  async event(kind: SecurityEventKind, ctx: Partial<ReqContext> | null, userId?: string | null, metadata: Record<string, unknown> = {}, client?: PoolClient) {
    securityEvents.inc({ kind });
    try {
      await (client ?? this.pool).query(
        'INSERT INTO security.events (id, kind, user_id, ip_hash, net_hash, device, metadata) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [uuidv7(), kind, userId ?? null, ctx?.ip ?? null, ctx?.net ?? null, ctx?.deviceLabel ?? null, metadata],
      );
    } catch (e) {
      this.log.warn(`evento ${kind}: ${(e as Error).message}`);
    }
  }

  /** Para o audit_log (não se apaga): os eventos importantes (bloqueios, decisões). */
  async audit(actorId: string | null, action: string, target: string | null, metadata: Record<string, unknown> = {}) {
    await this.pool
      .query('INSERT INTO audit.audit_log (id, actor_id, action, target, metadata) VALUES ($1, $2, $3, $4, $5)', [uuidv7(), actorId, action, target, metadata])
      .catch((e) => this.log.warn(`auditoria ${action}: ${(e as Error).message}`));
  }

  /**
   * Prova de humano. `force`: pedir mesmo na app nativa (no login, depois de várias falhas, quando a app já a sabe fazer).
   * Lança 403 `human_check` quando falta ou falhou; devolve o resultado quando passa (ou não é precisa).
   */
  async requireHuman(ctx: ReqContext, action: string, force = false): Promise<HumanResult> {
    if (!this.turnstile.enabled) return 'off';
    const needed = ctx.humanRequired || force;
    if (!needed && !ctx.turnstileToken) return 'missing';
    const r = await this.turnstile.verify(ctx.turnstileToken);
    if (r === 'passed' || r === 'unavailable') {
      if (r === 'unavailable') void this.event('human_unavailable', ctx, null, { action });
      return r;
    }
    void this.event(r === 'missing' ? 'human_missing' : 'human_failed', ctx, null, { action });
    if (!needed && r === 'missing') return r;
    throw new ForbiddenException({
      code: 'human_check',
      message: r === 'missing' ? 'Confirma que és uma pessoa e tenta outra vez.' : 'Não conseguimos confirmar que és uma pessoa. Tenta outra vez.',
    });
  }

  /* ───── login ───── */

  private loginKeys(ctx: ReqContext, identifier: string) {
    const id = this.print('login', identifier);
    return { id: `login:id:${id}`, ip: ctx.ip ? `login:ip:${ctx.ip}` : null };
  }

  /**
   * Antes do argon2: o IP ou a conta estão bloqueados? (429 sem gastar CPU). Muitas falhas recentes? (pede a prova de humano).
   * A conta é o identificador escrito (email ou @), exista ou não: a resposta é igual para contas que não existem.
   */
  async beforeLogin(ctx: ReqContext, identifier: string, userId: string | null) {
    const k = this.loginKeys(ctx, identifier);
    const acct = userId ? `login:acct:${userId}` : null;
    const ipLock = k.ip ? await this.store.lockedUntil(k.ip) : null;
    if (ipLock) {
      void this.event('login_blocked', ctx, null, { by: 'ip' });
      throw tooMany('login_ip_locked', `Muitas tentativas falhadas a partir desta rede. Espera ${waitText(ipLock)} e tenta outra vez.`, ipLock);
    }
    const idLock = await this.store.lockedUntil(...[k.id, acct].filter((x): x is string => !!x));
    if (idLock) {
      void this.event('login_blocked', ctx, userId, { by: 'account' });
      throw tooMany('login_locked', `Muitas tentativas falhadas nesta conta. Espera ${waitText(idLock)} ou recupera a senha em «Esqueci-me da senha».`, idLock);
    }
    if (this.turnstile.enabled) {
      const [idFails, ipFails] = await this.store.peekMany([k.id, k.ip ?? '']);
      const suspicious = idFails >= LOGIN.ACCOUNT_HUMAN_AFTER || ipFails >= LOGIN.IP_HUMAN_AFTER;
      // Na app nativa só se pede quando ela já sabe fazer a prova (mandou um código antes) ou quando é obrigatória.
      if (suspicious) await this.requireHuman(ctx, 'login', !!ctx.turnstileToken || ctx.client !== 'app');
    }
  }

  /** Uma falha de login: soma aos contadores e, se passou do limite, bloqueia (com espera progressiva). */
  async loginFailed(ctx: ReqContext, identifier: string, userId: string | null): Promise<{ locked: Date | null }> {
    const k = this.loginKeys(ctx, identifier);
    const idFails = await this.store.hit(k.id, LOGIN.WINDOW_MS);
    const acctFails = userId ? await this.store.hit(`login:acct:${userId}`, LOGIN.WINDOW_MS) : 0;
    const ipFails = k.ip ? await this.store.hit(k.ip, LOGIN.WINDOW_MS) : 0;
    void this.event('login_failed', ctx, userId, { fails: Math.max(idFails, acctFails) });
    let locked: Date | null = null;
    if (k.ip && ipFails >= LOGIN.IP_LOCK_AFTER) {
      const l = await this.store.lock(k.ip, LOGIN.IP_LOCK_BASE_MS, LOGIN.IP_LOCK_MAX_MS);
      await this.store.clearCounters(k.ip);
      void this.event('ip_locked', ctx, null, { strikes: l.strikes, until: l.until });
    }
    if (idFails >= LOGIN.ACCOUNT_LOCK_AFTER || acctFails >= LOGIN.ACCOUNT_LOCK_AFTER) {
      const l = await this.store.lock(k.id, LOGIN.ACCOUNT_LOCK_BASE_MS, LOGIN.ACCOUNT_LOCK_MAX_MS);
      if (userId) await this.store.lock(`login:acct:${userId}`, LOGIN.ACCOUNT_LOCK_BASE_MS, LOGIN.ACCOUNT_LOCK_MAX_MS);
      // Os contadores recomeçam: depois do bloqueio há outra vez N tentativas (e o bloqueio seguinte dura o dobro).
      await this.store.clearCounters(k.id, ...(userId ? [`login:acct:${userId}`] : []));
      locked = l.until;
      void this.event('login_locked', ctx, userId, { strikes: l.strikes, until: l.until });
      if (userId) void this.audit(userId, 'auth.login_locked', `user:${userId}`, { strikes: l.strikes, until: l.until.toISOString() });
    }
    return { locked };
  }

  /** Login certo: as falhas desta conta são esquecidas (as do IP não: podem ser de outra pessoa na mesma rede). */
  async loginSucceeded(identifier: string, userId: string) {
    const id = `login:id:${this.print('login', identifier)}`;
    await this.store.clearCounters(id, `login:acct:${userId}`);
  }

  /** Recuperou a senha pelo email: os bloqueios da conta acabam (é a saída para quem foi bloqueado por um ataque). */
  async unlockAccount(userId: string, identifiers: string[]) {
    const keys = [`login:acct:${userId}`, ...identifiers.filter(Boolean).map((i) => `login:id:${this.print('login', i)}`)];
    await this.store.reset(...keys);
  }

  /** Só uma vez em cada `everyMs` por chave (avisos por email). Devolve true se pode avançar. */
  async once(key: string, everyMs: number): Promise<boolean> {
    return (await this.store.hit(`once:${key}`, everyMs)) === 1;
  }

  /* ───── registo ───── */

  /** Limites de contas novas por IP (hora e dia) e por rede (dia). Lança 429; os IP internos não contam. */
  async registerGate(ctx: ReqContext) {
    if (!ctx.ip) return;
    const keys = [`reg:ip:h:${ctx.ip}`, `reg:ip:d:${ctx.ip}`, `reg:net:d:${ctx.net}`];
    const [h, d, n] = await this.store.peekMany(keys);
    // A app antiga, sem prova de humano (quando ela está ligada), tem metade da folga.
    const f = this.turnstile.enabled && !ctx.turnstileToken ? 0.5 : 1;
    const over = h >= Math.ceil(REGISTER.PER_IP_HOUR * f) ? 'ip_hora' : d >= Math.ceil(REGISTER.PER_IP_DAY * f) ? 'ip_dia' : n >= Math.ceil(REGISTER.PER_NET_DAY * f) ? 'rede_dia' : null;
    if (over) {
      void this.event('register_limited', ctx, null, { by: over });
      throw tooMany('register_limit', 'Já foram criadas muitas contas a partir desta rede. Tenta outra vez mais tarde.');
    }
    await this.store.hit(keys[0], 3600_000);
    await this.store.hit(keys[1], 24 * 3600_000);
    await this.store.hit(keys[2], 24 * 3600_000);
  }

  /** «Este email já tem conta?»: limite por IP (o email é dado pessoal; o @ é público). */
  async emailCheckGate(ctx: ReqContext) {
    if (!ctx.ip) return;
    const n = await this.store.hit(`emailcheck:${ctx.ip}`, 3600_000);
    if (n > REGISTER.EMAIL_CHECKS_PER_IP_HOUR) {
      if (n === REGISTER.EMAIL_CHECKS_PER_IP_HOUR + 1) void this.event('email_check_limited', ctx);
      throw tooMany('email_check_limit', 'Muitas verificações seguidas. Espera um bocado e tenta outra vez.');
    }
  }

  /** Emails para o mesmo endereço (recuperar a senha, apagar a conta): no máximo 3 por hora. Devolve se pode enviar. */
  async mailAllowed(kind: string, email: string, ctx?: ReqContext | null): Promise<boolean> {
    const n = await this.store.hit(`mail:${kind}:${this.print('mail', email)}`, 3600_000);
    if (n > MAIL_LIMITS.PER_ADDRESS_HOUR) {
      if (n === MAIL_LIMITS.PER_ADDRESS_HOUR + 1) void this.event('mail_limited', ctx ?? null, null, { kind });
      return false;
    }
    return true;
  }

  /* ───── prazos ───── */

  /** Apaga o que passou do prazo (ver a migração 0149). Corre de 10 em 10 minutos. */
  async purge() {
    const days = String(SECURITY_RETENTION_DAYS);
    const c = await this.pool.query('DELETE FROM security.counters WHERE expires_at < now()');
    const l = await this.pool.query('DELETE FROM security.locks WHERE forget_at < now() AND until < now()');
    const e = await this.pool.query(`DELETE FROM security.events WHERE created_at < now() - ($1 || ' days')::interval`, [days]);
    const r = await this.pool.query(
      `UPDATE security.account_risk SET ip_hash = NULL, net_hash = NULL, device_hash = NULL, email_hash = NULL
        WHERE created_at < now() - ($1 || ' days')::interval AND (ip_hash IS NOT NULL OR net_hash IS NOT NULL OR device_hash IS NOT NULL OR email_hash IS NOT NULL)`,
      [days],
    );
    return { counters: c.rowCount ?? 0, locks: l.rowCount ?? 0, events: e.rowCount ?? 0, prints: r.rowCount ?? 0 };
  }
}
