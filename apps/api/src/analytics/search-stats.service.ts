import { createHash } from 'crypto';
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { AppConfig, CONFIG } from '../config';
import { PG_POOL } from '../db/db.module';

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

interface Pending { term: string; empty: boolean; timer: NodeJS.Timeout }

/**
 * Contador agregado das pesquisas (para "o que a malta procura" e "pesquisas sem resultados" nas Análises).
 *
 * - Na base de dados fica só (dia, país, termo, vezes, vezes sem resultados): nenhuma conta, sessão ou hora.
 * - Não conta pesquisas de menores de 18 anos nem de quem desligou "Ajudar a melhorar o Txillapp".
 * - A app pesquisa enquanto se escreve ("pr", "pra", "praia"): espera-se uns segundos e conta-se só o termo final.
 * - Cada pessoa conta no máximo uma vez por termo e por dia (a marca para isso vive só na memória e é um resumo, não o id).
 * - Apaga-se ao fim de 90 dias.
 */
@Injectable()
export class SearchStatsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('SearchStats');
  private pending = new Map<string, Pending>();
  private seen = new Set<string>();
  private seenDay = '';
  private sweeper?: NodeJS.Timeout;
  private inflight = new Set<Promise<void>>();

  constructor(@Inject(PG_POOL) private readonly pool: Pool, @Inject(CONFIG) private readonly config: AppConfig) {}

  onModuleInit() {
    if (this.config.NODE_ENV === 'test') return;
    const run = () => void this.purge().catch((e) => this.log.warn(`falha a apagar pesquisas antigas: ${(e as Error).message}`));
    this.sweeper = setInterval(run, 24 * 3_600_000);
    this.sweeper.unref();
    setTimeout(run, 60_000).unref();
  }

  async onModuleDestroy() {
    if (this.sweeper) clearInterval(this.sweeper);
    await this.flush();
  }

  /** Uma pesquisa feita (já com o resultado). Nunca falha nem atrasa quem pesquisa. */
  note(userId: string, raw: string, empty: boolean) {
    const term = normalizeSearchTerm(raw);
    if (!term) return;
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

  /** Conta já o que está à espera (fim do processo e testes). */
  async flush() {
    const all = [...this.pending.entries()];
    this.pending.clear();
    for (const [userId, p] of all) {
      clearTimeout(p.timer);
      await this.write(userId, p.term, p.empty);
    }
    await Promise.all([...this.inflight]);
  }

  private track(p: Promise<void>) {
    this.inflight.add(p);
    void p.finally(() => this.inflight.delete(p));
  }

  async purge() {
    await this.pool.query(`DELETE FROM analytics.search_terms WHERE day < (now() AT TIME ZONE 'Africa/Maputo')::date - $1::int`, [SEARCH_RETENTION_DAYS]);
  }

  private async write(userId: string, term: string, empty: boolean) {
    const day = new Date(Date.now() + 2 * 3_600_000).toISOString().slice(0, 10); // dia em Maputo (UTC+2, sem hora de verão)
    if (day !== this.seenDay || this.seen.size > 200_000) {
      this.seen.clear();
      this.seenDay = day;
    }
    const mark = createHash('sha256').update(`${day}|${userId}|${term}`).digest('base64').slice(0, 16);
    if (this.seen.has(mark)) return;
    this.seen.add(mark);
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
