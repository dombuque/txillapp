import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';

/**
 * Onde vivem os contadores e os bloqueios da segurança. Hoje é o PostgreSQL (partilhado por todas as réplicas da API); a
 * equipa da escala pode ligar aqui o Redis (INCR + PEXPIRE para os contadores, SET com PX para os bloqueios) com uma classe
 * que cumpra esta interface e um `{ provide: RATE_STORE, useClass: RedisRateStore }` no SecurityModule. As regras não mudam.
 */
export interface RateStore {
  /** Soma 1 ao contador da chave (janela fixa de `windowMs`, que começa no primeiro toque) e devolve o total. */
  hit(key: string, windowMs: number): Promise<number>;
  /** O total atual (0 se a janela acabou ou nunca começou). */
  peek(key: string): Promise<number>;
  /** Vários totais de uma vez (mesma ordem). */
  peekMany(keys: string[]): Promise<number[]>;
  /** Apaga só os contadores (o bloqueio, se houver, continua). */
  clearCounters(...keys: string[]): Promise<void>;
  /** Apaga contadores e bloqueios (por exemplo, depois de recuperar a senha). */
  reset(...keys: string[]): Promise<void>;
  /**
   * Bloqueia a chave. Espera progressiva: o bloqueio n (em 24 h) dura `baseMs × 2^(n-1)`, até `maxMs`. Devolve até quando.
   */
  lock(key: string, baseMs: number, maxMs: number): Promise<{ until: Date; strikes: number }>;
  /** Até quando a chave está bloqueada, ou null. Para várias chaves devolve o fim mais tarde. */
  lockedUntil(...keys: string[]): Promise<Date | null>;
}

export const RATE_STORE = Symbol('RATE_STORE');

@Injectable()
export class PgRateStore implements RateStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async hit(key: string, windowMs: number): Promise<number> {
    const { rows } = await this.pool.query(
      `INSERT INTO security.counters AS c (key, hits, expires_at) VALUES ($1, 1, now() + make_interval(secs => $2::double precision / 1000))
       ON CONFLICT (key) DO UPDATE SET
         hits = CASE WHEN c.expires_at <= now() THEN 1 ELSE c.hits + 1 END,
         expires_at = CASE WHEN c.expires_at <= now() THEN EXCLUDED.expires_at ELSE c.expires_at END
       RETURNING hits`,
      [key, windowMs],
    );
    return rows[0].hits as number;
  }

  async peek(key: string): Promise<number> {
    return (await this.peekMany([key]))[0];
  }

  async peekMany(keys: string[]): Promise<number[]> {
    if (!keys.length) return [];
    const { rows } = await this.pool.query('SELECT key, hits FROM security.counters WHERE key = ANY($1) AND expires_at > now()', [keys]);
    const by = new Map(rows.map((r) => [r.key as string, r.hits as number]));
    return keys.map((k) => by.get(k) ?? 0);
  }

  async clearCounters(...keys: string[]): Promise<void> {
    if (keys.length) await this.pool.query('DELETE FROM security.counters WHERE key = ANY($1)', [keys]);
  }

  async reset(...keys: string[]): Promise<void> {
    if (!keys.length) return;
    await this.pool.query('DELETE FROM security.counters WHERE key = ANY($1)', [keys]);
    await this.pool.query('DELETE FROM security.locks WHERE key = ANY($1)', [keys]);
  }

  async lock(key: string, baseMs: number, maxMs: number): Promise<{ until: Date; strikes: number }> {
    const { rows } = await this.pool.query(
      `WITH prev AS (SELECT strikes FROM security.locks WHERE key = $1 AND forget_at > now())
       INSERT INTO security.locks AS l (key, until, strikes, forget_at)
       VALUES ($1,
               now() + make_interval(secs => LEAST($3::double precision, $2::double precision * power(2, COALESCE((SELECT strikes FROM prev), 0))) / 1000),
               COALESCE((SELECT strikes FROM prev), 0) + 1,
               now() + make_interval(secs => LEAST($3::double precision, $2::double precision * power(2, COALESCE((SELECT strikes FROM prev), 0))) / 1000) + interval '24 hours')
       ON CONFLICT (key) DO UPDATE SET until = EXCLUDED.until, strikes = EXCLUDED.strikes, forget_at = EXCLUDED.forget_at
       RETURNING until, strikes`,
      [key, baseMs, maxMs],
    );
    return { until: new Date(rows[0].until), strikes: rows[0].strikes as number };
  }

  async lockedUntil(...keys: string[]): Promise<Date | null> {
    if (!keys.length) return null;
    const { rows } = await this.pool.query('SELECT max(until) AS until FROM security.locks WHERE key = ANY($1) AND until > now()', [keys]);
    return rows[0]?.until ? new Date(rows[0].until) : null;
  }
}
