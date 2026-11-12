import Anthropic from '@anthropic-ai/sdk';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { AppConfig, CONFIG } from '../config';
import { uuidv7 } from '../common/uuid7';
import { PG_POOL } from '../db/db.module';
import { TextFilter } from '../safety/text-filter.service';
import { blockedBetween, sameCountry } from '../social/visibility';
import { badge } from '../common/badge';
import { MSG, SYSTEM_PROMPT } from './constants';

type Turn = { role: 'user' | 'assistant'; content: string };

/** Uma resposta presa há mais do que isto conta como falhada (o servidor reiniciou a meio, por exemplo). */
const STALE_MS = 2 * 60_000;
/** Quantas mensagens guarda cada pessoa. */
const KEEP = 60;

/**
 * O SuperTxill: a IA do Txillapp, na barra de pesquisa (como a Meta IA no Instagram). Não é uma conta nem uma conversa com alguém.
 * A pergunta é guardada logo e a resposta é preparada em segundo plano: a pessoa pode fechar o ecrã e vê-la quando voltar.
 * Só vê o que a própria pessoa lhe perguntou: nunca mensagens, contas ou Txills de ninguém. Grátis, com limite por dia e um teto mensal.
 */
@Injectable()
export class SuperTxillService {
  private readonly log = new Logger('SuperTxill');
  private client?: Anthropic;
  private running = 0;
  private readonly queue: Array<() => Promise<void>> = [];
  /** Substituível (nos testes): recebe o histórico e devolve a resposta. */
  llm: (history: Turn[]) => Promise<string> = (h) => this.callClaude(h);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly filter: TextFilter,
  ) {}

  get enabled() {
    return !!this.config.ANTHROPIC_API_KEY;
  }

  /**
   * "Para ti": o modelo próprio do Txillapp, só com dados da app e a correr no nosso servidor (nada sai para fora).
   * Filtragem colaborativa sobre quem se segue: encontra as pessoas com gostos de seguir mais parecidos com os teus
   * (semelhança de cosseno entre as listas de seguidos) e recomenda quem elas seguem e tu ainda não.
   * Soma os gostos da geleira em comum (só de quem a tem visível e deixa usá-la) e se a pessoa já te segue.
   * Respeita: aceitar ser sugerido, bloqueios, país, quem já dispensaste.
   */
  async forYou(userId: string, limit = 12) {
    const { rows } = await this.pool.query(
      `WITH mine AS (SELECT followee_id FROM social.follows WHERE follower_id = $1),
            n AS (SELECT count(*)::float AS n FROM mine),
            sizes AS (SELECT follower_id, count(*)::float AS n FROM social.follows GROUP BY follower_id),
            sim AS (
              SELECT f.follower_id AS w, count(*)::float / sqrt(GREATEST((SELECT n FROM n), 1) * GREATEST(sz.n, 1)) AS s
                FROM social.follows f JOIN mine m ON m.followee_id = f.followee_id JOIN sizes sz ON sz.follower_id = f.follower_id
               WHERE f.follower_id <> $1 GROUP BY f.follower_id, sz.n ORDER BY s DESC LIMIT 60),
            cf AS (
              SELECT f.followee_id AS u, sum(sim.s) AS score
                FROM sim JOIN social.follows f ON f.follower_id = sim.w GROUP BY f.followee_id),
            taste AS (
              SELECT o.user_id AS u, count(*)::int AS shared, (array_agg(i.name ORDER BY o.favorite DESC, i.name))[1] AS item
                FROM taste.user_items me
                JOIN identity.users mu ON mu.id = $1 AND mu.geleira_matching
                JOIN taste.user_items o ON o.item_id = me.item_id AND o.user_id <> $1 AND o.visibility = 'everyone'
                JOIN identity.users ou ON ou.id = o.user_id AND ou.geleira_matching
                JOIN taste.items i ON i.id = me.item_id AND i.status = 'curated' AND NOT i.alcoholic
               WHERE me.user_id = $1 GROUP BY o.user_id)
       SELECT u.username, u.display_name, u.is_private, u.verified, u.verified_tier,
              COALESCE(cf.score, 0) AS cf, COALESCE(taste.shared, 0) AS shared, taste.item,
              EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = u.id AND f.followee_id = $1) AS follows_me,
              EXISTS (SELECT 1 FROM social.follow_requests r WHERE r.requester_id = $1 AND r.target_id = u.id) AS requested
         FROM identity.users u LEFT JOIN cf ON cf.u = u.id LEFT JOIN taste ON taste.u = u.id
        WHERE u.id <> $1 AND u.status = 'active' AND u.suggestable AND ${sameCountry('u.country')}
          AND NOT ${blockedBetween('u.id', '$1')}
          AND NOT EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = $1 AND f.followee_id = u.id)
          AND NOT EXISTS (SELECT 1 FROM social.suggestion_dismissals d WHERE d.user_id = $1 AND d.dismissed_id = u.id)
        ORDER BY (COALESCE(cf.score, 0) + 0.15 * COALESCE(taste.shared, 0) + CASE WHEN EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = u.id AND f.followee_id = $1) THEN 0.3 ELSE 0 END) DESC, u.id DESC
        LIMIT $2`,
      [userId, limit],
    );
    return rows.map((r) => ({
      username: r.username as string,
      displayName: r.display_name as string,
      ...badge(r.verified, r.verified_tier),
      isPrivate: r.is_private as boolean,
      requested: r.requested as boolean,
      followsYou: r.follows_me as boolean,
      // O "porquê" é sempre dado a partir de dados que a própria pessoa tem direito a ver.
      reason: r.shared > 0 ? `Também curte ${r.item as string}` : r.cf > 0 ? 'Malta com gostos parecidos aos teus segue' : r.follows_me ? 'Segue-te' : 'Novo no Txillapp',
    }));
  }

  /** O histórico da pessoa (do mais antigo para o mais recente) e se há uma resposta a caminho. */
  async thread(userId: string) {
    const { rows } = await this.pool.query('SELECT id, role, body, created_at FROM social.ai_messages WHERE user_id = $1 ORDER BY id DESC LIMIT 40', [userId]);
    const messages = rows.reverse().map((r) => ({ id: r.id as string, role: r.role as 'user' | 'assistant', body: r.body as string, at: r.created_at as string }));
    const last = messages[messages.length - 1];
    const pending = !!last && last.role === 'user' && Date.now() - new Date(last.at).getTime() < STALE_MS;
    return { messages, pending, enabled: this.enabled };
  }

  async clear(userId: string) {
    await this.pool.query('DELETE FROM social.ai_messages WHERE user_id = $1', [userId]);
  }

  private async save(userId: string, role: 'user' | 'assistant', body: string) {
    const id = uuidv7();
    await this.pool.query('INSERT INTO social.ai_messages (id, user_id, role, body) VALUES ($1, $2, $3, $4)', [id, userId, role, body.slice(0, 4000)]);
    // Guarda só as últimas mensagens.
    await this.pool.query('DELETE FROM social.ai_messages WHERE user_id = $1 AND id < (SELECT id FROM social.ai_messages WHERE user_id = $1 ORDER BY id DESC OFFSET $2 LIMIT 1)', [userId, KEEP]);
    return id;
  }

  /** A pessoa pergunta. Guarda a pergunta e prepara a resposta em segundo plano. */
  async ask(userId: string, text: string) {
    this.filter.assertClean(text);
    const id = await this.save(userId, 'user', text);
    this.queue.push(() => this.answer(userId));
    this.pump();
    return { id };
  }

  /** Fila em segundo plano: poucas respostas ao mesmo tempo, para não rebentar o limite de pedidos nem o custo. */
  private pump() {
    while (this.running < 3 && this.queue.length) {
      const job = this.queue.shift()!;
      this.running++;
      void job()
        .catch((e) => this.log.warn(`falha: ${(e as Error).message}`))
        .finally(() => {
          this.running--;
          this.pump();
        });
    }
  }

  /** Conta o uso de hoje; devolve falso se a pessoa já passou o limite diário. */
  private async underDailyLimit(userId: string): Promise<boolean> {
    const r = await this.pool.query(
      `INSERT INTO social.bot_usage (user_id, day, n) VALUES ($1, (now() AT TIME ZONE 'UTC')::date, 1)
       ON CONFLICT (user_id, day) DO UPDATE SET n = social.bot_usage.n + 1 RETURNING n`,
      [userId],
    );
    return (r.rows[0].n as number) <= this.config.SUPERTXILL_DAILY_LIMIT;
  }

  /** Conta o uso do mês; devolve falso se o teto mensal já foi atingido. */
  private async underMonthlyCap(): Promise<boolean> {
    const month = new Date().toISOString().slice(0, 7);
    const r = await this.pool.query(`INSERT INTO social.bot_budget (month, n) VALUES ($1, 1) ON CONFLICT (month) DO UPDATE SET n = social.bot_budget.n + 1 RETURNING n`, [month]);
    return (r.rows[0].n as number) <= this.config.SUPERTXILL_MONTHLY_CAP;
  }

  /** O que foi dito (só entre a pessoa e o SuperTxill), a começar por uma mensagem dela. */
  private async history(userId: string): Promise<Turn[]> {
    const { rows } = await this.pool.query('SELECT role, body FROM social.ai_messages WHERE user_id = $1 ORDER BY id DESC LIMIT 12', [userId]);
    const turns: Turn[] = rows.reverse().map((r) => ({ role: r.role as 'user' | 'assistant', content: String(r.body).slice(0, 1500) }));
    while (turns.length && turns[0].role !== 'user') turns.shift();
    return turns;
  }

  private async callClaude(history: Turn[]): Promise<string> {
    this.client ??= new Anthropic({ apiKey: this.config.ANTHROPIC_API_KEY, timeout: 45_000, maxRetries: 1 });
    const model = this.config.SUPERTXILL_MODEL;
    // Nos modelos com salvaguardas, se o pedido for recusado o servidor tenta outro modelo (ver a documentação da API).
    const withFallback = /^claude-(opus|fable|mythos|sonnet-5-5)/.test(model);
    const res = await this.client.beta.messages.create({
      model,
      max_tokens: 700,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: history,
      output_config: { effort: 'low' },
      ...(withFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    });
    if (res.stop_reason === 'refusal') return MSG.refused;
    return res.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
  }

  /** Prepara e guarda a resposta. Nunca deixa a pessoa sem resposta: em caso de falha, diz que falhou. */
  private async answer(userId: string) {
    const exists = (await this.pool.query("SELECT 1 FROM identity.users WHERE id = $1 AND status = 'active'", [userId])).rowCount;
    if (!exists) return;
    if (!this.enabled) return void (await this.save(userId, 'assistant', MSG.off));
    if (!(await this.underDailyLimit(userId))) return void (await this.save(userId, 'assistant', MSG.daily));
    if (!(await this.underMonthlyCap())) return void (await this.save(userId, 'assistant', MSG.monthly));
    let text: string;
    try {
      text = (await this.llm(await this.history(userId))).slice(0, 1800).trim();
      if (!text) text = MSG.error;
      // Nunca devolve conteúdo que as regras da app não deixariam enviar.
      if (this.filter.check(text)) text = MSG.refused;
    } catch (e) {
      this.log.warn(`a IA falhou: ${(e as Error).message}`);
      text = MSG.error;
    }
    await this.save(userId, 'assistant', text);
  }
}
