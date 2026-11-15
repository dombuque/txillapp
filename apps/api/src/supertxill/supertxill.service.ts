import Anthropic from '@anthropic-ai/sdk';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { AppConfig, CONFIG } from '../config';
import { uuidv7 } from '../common/uuid7';
import { PG_POOL } from '../db/db.module';
import { TextFilter } from '../safety/text-filter.service';
import { blockedBetween, sameCountry } from '../social/visibility';
import { badge } from '../common/badge';
import { MSG, SYSTEM_PROMPT, systemPrompt } from './constants';
import { OllamaChat, OllamaError, OllamaMessage, ollamaClient, stripThinking, toolArgs } from './ollama';
import { SuperTxillTools, TOOLS } from './supertxill.tools';

export type Turn = { role: 'user' | 'assistant'; content: string };
export type Provider = 'ollama' | 'anthropic' | 'off';
export interface LlmCtx {
  userId: string;
  signal: AbortSignal;
}

/** Uma resposta presa há mais do que isto conta como falhada (o servidor reiniciou a meio, por exemplo). Tem de passar a fila e o tempo máximo. */
const STALE_MS = 6 * 60_000;
/** Quantas mensagens guarda cada pessoa. */
const KEEP = 60;
/** Quantas mensagens anteriores o modelo lê. */
const HISTORY = 20;
/** O tamanho máximo de uma resposta. */
export const MAX_REPLY = 1500;
/** Chamadas de ferramentas por resposta. */
export const MAX_TOOL_CALLS = 4;
/** Perguntas à espera na fila: acima disto a resposta é logo «está muita malta». */
const QUEUE_MAX = 40;
/** O resultado de uma ferramenta que o modelo lê (os modelos pequenos têm pouco contexto). */
const TOOL_OUT = 2500;
const TIMED_OUT = Symbol('timeout');

/** Corta no fim da última frase antes de `max` (ou na última palavra). */
export function clip(text: string, max = MAX_REPLY): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '), cut.lastIndexOf('\n'));
  return (end > max * 0.6 ? cut.slice(0, end + 1) : cut.slice(0, cut.lastIndexOf(' ')) + '…').trim();
}

/**
 * O SuperTxill: a IA do Txillapp, na barra de pesquisa (como a Meta IA no Instagram). Não é uma conta nem uma conversa com alguém.
 * A pergunta é guardada logo e a resposta é preparada em segundo plano: a pessoa pode fechar o ecrã e vê-la quando voltar.
 * Com o Ollama (um modelo aberto no nosso servidor, nada sai para fora) pode consultar a app através das ferramentas
 * (supertxill.tools.ts), sempre como a pessoa que pergunta e só com o que ela já pode ver. Nunca lê mensagens de ninguém.
 * Grátis, com limite por dia e um teto mensal.
 */
@Injectable()
export class SuperTxillService {
  private readonly log = new Logger('SuperTxill');
  private client?: Anthropic;
  private running = 0;
  private readonly queue: Array<() => Promise<void>> = [];
  /** O modelo aceita `think` (raciocínio à parte)? Desliga-se sozinho se o Ollama disser que não. */
  private think = true;
  /** Substituível (nos testes): recebe o histórico e devolve a resposta. */
  llm: (history: Turn[], ctx: LlmCtx) => Promise<string> = (h, ctx) => (this.provider === 'anthropic' ? this.callClaude(h, ctx.signal) : this.callOllama(h, ctx));
  /** Substituível (nos testes): o pedido ao Ollama (POST /api/chat). */
  chat: OllamaChat;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly filter: TextFilter,
    private readonly tools: SuperTxillTools,
  ) {
    this.chat = config.OLLAMA_URL ? ollamaClient(config.OLLAMA_URL, config.OLLAMA_TOKEN) : async () => { throw new Error('OLLAMA_URL em falta'); };
  }

  /** Quem responde: o que está em SUPERTXILL_PROVIDER, ou ollama se houver OLLAMA_URL, senão anthropic se houver chave, senão ninguém. */
  get provider(): Provider {
    const c = this.config;
    if (c.SUPERTXILL_PROVIDER === 'off') return 'off';
    if (c.SUPERTXILL_PROVIDER === 'ollama') return c.OLLAMA_URL ? 'ollama' : 'off';
    if (c.SUPERTXILL_PROVIDER === 'anthropic') return c.ANTHROPIC_API_KEY ? 'anthropic' : 'off';
    return c.OLLAMA_URL ? 'ollama' : c.ANTHROPIC_API_KEY ? 'anthropic' : 'off';
  }

  get enabled() {
    return this.provider !== 'off';
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
    if (this.queue.length >= QUEUE_MAX) {
      await this.save(userId, 'assistant', MSG.busy);
      return { id };
    }
    this.queue.push(() => this.answer(userId));
    this.pump();
    return { id };
  }

  /**
   * Fila em segundo plano: poucas respostas ao mesmo tempo (SUPERTXILL_CONCURRENCY, por omissão 1). O modelo corre em CPU
   * na máquina da Txillada e os lives têm prioridade; o resto espera a sua vez.
   */
  private pump() {
    while (this.running < this.config.SUPERTXILL_CONCURRENCY && this.queue.length) {
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
    const { rows } = await this.pool.query('SELECT role, body FROM social.ai_messages WHERE user_id = $1 ORDER BY id DESC LIMIT $2', [userId, HISTORY]);
    const turns: Turn[] = rows.reverse().map((r) => ({ role: r.role as 'user' | 'assistant', content: String(r.body).slice(0, 1500) }));
    while (turns.length && turns[0].role !== 'user') turns.shift();
    return turns;
  }

  /** O dia, a hora (Maputo) e o primeiro nome da pessoa: só dados dela, para os planos fazerem sentido. */
  private async context(userId: string): Promise<string> {
    const r = (await this.pool.query('SELECT display_name FROM identity.users WHERE id = $1', [userId])).rows[0];
    const now = new Date().toLocaleString('pt-PT', { timeZone: 'Africa/Maputo', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
    const name = String(r?.display_name ?? '').split(/\s+/)[0].replace(/[^\p{L}\p{N}' -]/gu, '').slice(0, 30);
    return `Em Maputo é ${now}.${name ? ` A pessoa chama-se ${name}.` : ''}`;
  }

  /**
   * Ollama (/api/chat) com ferramentas: o modelo pede dados da app (no máximo MAX_TOOL_CALLS chamadas), a API corre-as como
   * a pessoa e devolve os resultados; no fim responde em texto. O raciocínio (`think`) fica à parte e nunca se guarda.
   */
  private async callOllama(history: Turn[], ctx: LlmCtx): Promise<string> {
    const messages: OllamaMessage[] = [{ role: 'system', content: systemPrompt({ tools: true, ctx: await this.context(ctx.userId) }) }, ...history];
    let calls = 0;
    for (let round = 0; round <= MAX_TOOL_CALLS; round++) {
      const withTools = calls < MAX_TOOL_CALLS;
      const res = await this.ollama(messages, withTools, ctx.signal);
      const m = res.message;
      const wanted = withTools ? (m.tool_calls ?? []) : [];
      if (!wanted.length) {
        const text = stripThinking(m.content ?? '');
        if (text || !withTools) return text;
        // Sem texto nem ferramentas: pede-se a resposta outra vez, já sem ferramentas.
        calls = MAX_TOOL_CALLS;
        continue;
      }
      messages.push({ role: 'assistant', content: m.content ?? '', tool_calls: wanted });
      for (const c of wanted) {
        if (calls >= MAX_TOOL_CALLS) break;
        calls++;
        const out = await this.tools.run(ctx.userId, c.function.name, toolArgs(c), { forYou: (u) => this.forYou(u, 8) });
        messages.push({ role: 'tool', tool_name: c.function.name, content: JSON.stringify(out).slice(0, TOOL_OUT) });
      }
    }
    // Gastou as chamadas todas: uma última vez, sem ferramentas, para responder com o que tem.
    return stripThinking((await this.ollama(messages, false, ctx.signal)).message.content ?? '');
  }

  private async ollama(messages: OllamaMessage[], withTools: boolean, signal: AbortSignal) {
    const req = {
      model: this.config.OLLAMA_MODEL,
      messages,
      ...(withTools ? { tools: TOOLS } : {}),
      think: this.think,
      keep_alive: '24h',
      options: {
        temperature: 0.6,
        top_p: 0.9,
        num_ctx: 8192,
        num_predict: this.think ? 1400 : 500,
        ...(this.config.OLLAMA_NUM_THREAD ? { num_thread: this.config.OLLAMA_NUM_THREAD } : {}),
      },
    };
    try {
      return await this.chat(req, signal);
    } catch (e) {
      // Modelo sem raciocínio à parte: desliga e repete.
      if (this.think && e instanceof OllamaError && e.status === 400 && /think/i.test(e.message)) {
        this.think = false;
        this.log.log(`${this.config.OLLAMA_MODEL} não suporta think: sigo sem`);
        return this.chat({ ...req, think: false, options: { ...req.options, num_predict: 500 } }, signal);
      }
      throw e;
    }
  }

  private async callClaude(history: Turn[], signal: AbortSignal): Promise<string> {
    this.client ??= new Anthropic({ apiKey: this.config.ANTHROPIC_API_KEY, timeout: 45_000, maxRetries: 1 });
    const model = this.config.SUPERTXILL_MODEL;
    // Nos modelos com salvaguardas, se o pedido for recusado o servidor tenta outro modelo (ver a documentação da API).
    const withFallback = /^claude-(opus|fable|mythos|sonnet-5-5)/.test(model);
    const res = await this.client.beta.messages.create(
      {
        model,
        max_tokens: 700,
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: history,
        output_config: { effort: 'low' },
        ...(withFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      },
      { signal },
    );
    if (res.stop_reason === 'refusal') return MSG.refused;
    return res.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
  }

  /** O pedido ao modelo com tempo máximo (SUPERTXILL_TIMEOUT_MS): passado esse tempo, cancela e responde que demorou. */
  private async withTimeout(history: Turn[], userId: string): Promise<string | typeof TIMED_OUT> {
    const ac = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => {
        ac.abort();
        resolve(TIMED_OUT);
      }, this.config.SUPERTXILL_TIMEOUT_MS);
    });
    try {
      return await Promise.race([this.llm(history, { userId, signal: ac.signal }), late]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Prepara e guarda a resposta. Nunca deixa a pessoa sem resposta: em caso de falha, diz que falhou. */
  private async answer(userId: string) {
    const exists = (await this.pool.query("SELECT 1 FROM identity.users WHERE id = $1 AND status = 'active'", [userId])).rowCount;
    if (!exists) return;
    if (!this.enabled) return void (await this.save(userId, 'assistant', MSG.off));
    if (!(await this.underDailyLimit(userId))) return void (await this.save(userId, 'assistant', MSG.daily));
    if (!(await this.underMonthlyCap())) return void (await this.save(userId, 'assistant', MSG.monthly));
    let text: string;
    const t0 = Date.now();
    try {
      const out = await this.withTimeout(await this.history(userId), userId);
      if (out === TIMED_OUT) {
        this.log.warn(`a IA passou do tempo (${this.config.SUPERTXILL_TIMEOUT_MS} ms)`);
        text = MSG.timeout;
      } else {
        text = clip(out);
        if (!text) text = MSG.error;
        // Nunca devolve conteúdo que as regras da app não deixariam enviar.
        if (this.filter.check(text)) text = MSG.refused;
      }
    } catch (e) {
      this.log.warn(`a IA falhou: ${(e as Error).message}`);
      text = MSG.error;
    }
    this.log.debug(`resposta em ${Date.now() - t0} ms`);
    await this.save(userId, 'assistant', text);
  }
}
