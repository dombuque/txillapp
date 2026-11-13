import { createHash, randomBytes } from 'crypto';
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { AppConfig, CONFIG } from '../config';
import { PG_POOL } from '../db/db.module';
import { RealtimeBus } from '../realtime/realtime-bus';
import { Scheduler } from '../realtime/scheduler';

/** Quanto tempo se espera por mais letras antes de contar uma pesquisa (a app pesquisa enquanto se escreve). */
export const SEARCH_SETTLE_MS = 6_000;
/** As pesquisas agregadas ficam 90 dias. */
export const SEARCH_RETENTION_DAYS = 90;

/**
 * Normaliza o texto pesquisado: minúsculas, sem acentos, sem @ ou # no início, espaços juntos, até 50 caracteres.
 * Devolve null para o que não se deve guardar: muito curto, emails, ligações e textos com muitos algarismos (telefones, documentos).
 */
export function normalizeSearchTerm(raw: string): string | null {
  let t = raw.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  t = t.replace(/^[\s@#]+/, '').replace(/\s+/g, ' ').trim().slice(0, 50).trim();
  if (t.length < 2) return null;
  if (/\S+@\S+\.\S+/.test(t)) return null;
  if (/(https?:\/\/|www\.)/.test(t)) return null;
  if ((t.match(/\d/g)?.length ?? 0) >= 6) return null;
  return t;
}

/** `key`/`value`: com Redis, a chave partilhada do termo à espera e o valor que esta instância lá pôs. */
interface Pending { term: string; empty: boolean; timer: NodeJS.Timeout; key?: string; value?: string }

/** A marca «esta pessoa já contou este termo hoje» dura um dia e pouco (o dia muda à meia-noite de Maputo). */
const SEEN_TTL_MS = 26 * 3_600_000;
const pendingKey = (userId: string) => `rt:ss:p:${userId}`;

/**
 * Contador agregado das pesquisas (para "o que a malta procura" e "pesquisas sem resultados" nas Análises).
 *
 * - Na base de dados fica só (dia, país, termo, vezes, vezes sem resultados): nenhuma conta, sessão ou hora.
 * - Não conta pesquisas de menores de 18 anos nem de quem desligou "Ajudar a melhorar o Txillapp".
 * - A app pesquisa enquanto se escreve ("pr", "pra", "praia"): espera-se uns segundos e conta-se só o termo final.
 * - Cada pessoa conta no máximo uma vez por termo e por dia (a marca para isso é um resumo, não o id, e dura um dia).
 * - Apaga-se ao fim de 90 dias.
 *
 * Com várias instâncias (Redis), as letras de uma pesquisa podem chegar a instâncias diferentes: o termo à espera e a marca
 * do dia ficam no RealtimeBus (com validade) e só quem pôs o último termo o conta. Sem Redis, tudo na memória.
 */
@Injectable()
export class SearchStatsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('SearchStats');
  private pending = new Map<string, Pending>();
  private seen = new Set<string>();
  private seenDay = '';
  private inflight = new Set<Promise<void>>();

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly bus: RealtimeBus,
    private readonly scheduler: Scheduler,
  ) {}

  onModuleInit() {
    this.scheduler.every('search.purge', 24 * 3_600_000, () => this.purge(), { firstAfterMs: 60_000 });
  }

  async onModuleDestroy() {
    await this.flush();
  }

  /** Uma pesquisa feita (já com o resultado). Nunca falha nem atrasa quem pesquisa. */
  note(userId: string, raw: string, empty: boolean) {
    const term = normalizeSearchTerm(raw);
    if (!term) return;
    if (this.bus.shared) return this.track(this.noteShared(userId, term, empty));
    const prev = this.pending.get(userId);
    if (prev) {
      clearTimeout(prev.timer);
      this.pending.delete(userId);
      // A continuar a escrever (ou a apagar) o mesmo termo: fica só o último. O mesmo termo duas vezes ("praia" e "@praia"):
      // conta uma vez, e só "sem resultados" se nenhuma das duas deu nada.
      const same = prev.term === term;
      const typing = term.startsWith(prev.term) || prev.term.startsWith(term);
      if (same) empty = empty && prev.empty;
      else if (!typing) this.track(this.write(userId, prev.term, prev.empty));
    }
    const timer = setTimeout(() => {
      this.pending.delete(userId);
      this.track(this.write(userId, term, empty));
    }, SEARCH_SETTLE_MS);
    timer.unref();
    this.pending.set(userId, { term, empty, timer });
  }

  /** O mesmo, com o termo à espera no Redis (as letras seguintes podem chegar a outra instância). */
  private async noteShared(userId: string, term: string, empty: boolean) {
    const key = pendingKey(userId);
    const mine = this.pending.get(userId);
    if (mine) {
      clearTimeout(mine.timer);
      this.pending.delete(userId);
    }
    const ttl = SEARCH_SETTLE_MS * 5;
    const nonce = randomBytes(6).toString('hex');
    let value = JSON.stringify({ term, empty, n: nonce });
    const prev = parsePending(await this.bus.swap(key, value, ttl));
    if (prev) {
      const same = prev.term === term;
      const typing = term.startsWith(prev.term) || prev.term.startsWith(term);
      if (same && empty && !prev.empty) {
        empty = false;
        value = JSON.stringify({ term, empty, n: nonce });
        await this.bus.setFlag(key, value, ttl);
      } else if (!same && !typing) await this.write(userId, prev.term, prev.empty);
    }
    const timer = setTimeout(() => {
      this.pending.delete(userId);
      this.track(this.settle(userId, key, value, term, empty));
    }, SEARCH_SETTLE_MS);
    timer.unref();
    this.pending.set(userId, { term, empty, timer, key, value });
  }

  /** Conta o termo se ainda for o último desta pessoa (senão, quem pôs o seguinte é que o conta). */
  private async settle(userId: string, key: string, value: string, term: string, empty: boolean) {
    if (await this.bus.takeIf(key, value)) await this.write(userId, term, empty);
  }

  /** Conta já o que está à espera (fim do processo e testes). */
  async flush() {
    await Promise.all([...this.inflight]);
    const all = [...this.pending.entries()];
    this.pending.clear();
    for (const [userId, p] of all) {
      clearTimeout(p.timer);
      if (p.key && p.value) await this.settle(userId, p.key, p.value, p.term, p.empty);
      else await this.write(userId, p.term, p.empty);
    }
    await Promise.all([...this.inflight]);
  }

  private track(p: Promise<void>) {
    const t = p.catch((e) => this.log.warn(`falha a contar uma pesquisa: ${(e as Error).message}`));
    this.inflight.add(t);
    void t.finally(() => this.inflight.delete(t));
  }

  async purge() {
    await this.pool.query(`DELETE FROM analytics.search_terms WHERE day < (now() AT TIME ZONE 'Africa/Maputo')::date - $1::int`, [SEARCH_RETENTION_DAYS]);
  }

  /** Esta pessoa ainda não contou este termo hoje? (e fica marcado). */
  private async firstToday(day: string, mark: string) {
    if (this.bus.shared) return this.bus.claimOnce(`rt:ss:seen:${mark}`, SEEN_TTL_MS);
    if (day !== this.seenDay || this.seen.size > 200_000) {
      this.seen.clear();
      this.seenDay = day;
    }
    if (this.seen.has(mark)) return false;
    this.seen.add(mark);
    return true;
  }

  private async write(userId: string, term: string, empty: boolean) {
    const day = new Date(Date.now() + 2 * 3_600_000).toISOString().slice(0, 10); // dia em Maputo (UTC+2, sem hora de verão)
    const mark = createHash('sha256').update(`${day}|${userId}|${term}`).digest('base64').slice(0, 16);
    if (!(await this.firstToday(day, mark))) return;
    await this.pool
      .query(
        `INSERT INTO analytics.search_terms (day, country, term, searches, empty)
         SELECT (now() AT TIME ZONE 'Africa/Maputo')::date, coalesce(u.country, '--'), $2, 1, $3::int
           FROM identity.users u
          WHERE u.id = $1 AND u.status = 'active' AND u.share_analytics
            AND u.birth_date IS NOT NULL AND u.birth_date <= current_date - interval '18 years'
         ON CONFLICT (day, country, term) DO UPDATE
           SET searches = analytics.search_terms.searches + 1, empty = analytics.search_terms.empty + EXCLUDED.empty`,
        [userId, term, empty ? 1 : 0],
      )
      .catch((e) => this.log.warn(`falha a contar uma pesquisa: ${(e as Error).message}`));
  }
}

function parsePending(raw: string | null): { term: string; empty: boolean } | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { term?: unknown; empty?: unknown };
    return typeof v.term === 'string' ? { term: v.term, empty: !!v.empty } : null;
  } catch {
    return null;
  }
}
