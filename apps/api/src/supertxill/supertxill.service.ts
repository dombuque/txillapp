import Anthropic from '@anthropic-ai/sdk';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { ChatEvents } from '../chat/chat.events';
import { ChatService } from '../chat/chat.service';
import { AppConfig, CONFIG } from '../config';
import { PG_POOL } from '../db/db.module';
import { TextFilter } from '../safety/text-filter.service';
import { MSG, SUPERTXILL_ID, SUPERTXILL_USERNAME, SYSTEM_PROMPT } from './constants';

type Turn = { role: 'user' | 'assistant'; content: string };

/**
 * O SuperTxill: a IA do Txillapp, no chat. Quando alguém lhe escreve, a resposta é preparada em segundo plano (com «a escrever…»)
 * e chega como mensagem normal. Só vê a conversa com a própria pessoa: nunca lê as outras conversas, contas ou Txills.
 * Grátis para quem usa, com limite por pessoa/dia e um teto mensal para toda a app.
 */
@Injectable()
export class SuperTxillService implements OnModuleInit {
  private readonly log = new Logger('SuperTxill');
  private client?: Anthropic;
  private running = 0;
  private readonly queue: Array<() => Promise<void>> = [];
  /** Substituível (nos testes): recebe o histórico e devolve a resposta. */
  llm: (history: Turn[]) => Promise<string> = (h) => this.callClaude(h);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly chat: ChatService,
    private readonly events: ChatEvents,
    private readonly filter: TextFilter,
  ) {}

  onModuleInit() {
    this.chat.setBotHandler((userId) => this.enqueue(userId));
  }

  get enabled() {
    return !!this.config.ANTHROPIC_API_KEY;
  }

  /** Fila em segundo plano: poucas respostas ao mesmo tempo, para não rebentar o limite de pedidos nem o custo. */
  private enqueue(userId: string) {
    this.queue.push(() => this.reply(userId));
    this.pump();
  }
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
    const r = await this.pool.query(
      `INSERT INTO social.bot_budget (month, n) VALUES ($1, 1) ON CONFLICT (month) DO UPDATE SET n = social.bot_budget.n + 1 RETURNING n`,
      [month],
    );
    return (r.rows[0].n as number) <= this.config.SUPERTXILL_MONTHLY_CAP;
  }

  /** O que foi dito nesta conversa (só entre a pessoa e o SuperTxill), do mais antigo para o mais recente. */
  private async history(userId: string): Promise<Turn[]> {
    const { rows } = await this.pool.query(
      `SELECT m.sender_id, m.body FROM social.messages m
         JOIN social.conversations c ON c.id = m.conversation_id
        WHERE c.user_a = LEAST($1::uuid, $2::uuid) AND c.user_b = GREATEST($1::uuid, $2::uuid)
          AND m.deleted_at IS NULL AND m.kind = 'text' AND m.view_once = false AND m.body <> ''
        ORDER BY m.id DESC LIMIT 12`,
      [userId, SUPERTXILL_ID],
    );
    const turns: Turn[] = rows.reverse().map((r) => ({ role: r.sender_id === SUPERTXILL_ID ? ('assistant' as const) : ('user' as const), content: String(r.body).slice(0, 1500) }));
    while (turns.length && turns[0].role !== 'user') turns.shift(); // a API começa sempre por uma mensagem da pessoa
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

  /** Prepara e envia a resposta a quem escreveu. Nunca deixa a pessoa sem resposta: em caso de falha, diz que falhou. */
  private async reply(userId: string) {
    const user = (await this.pool.query('SELECT username FROM identity.users WHERE id = $1 AND status = \'active\'', [userId])).rows[0];
    if (!user) return;
    const say = (text: string) => this.chat.send(SUPERTXILL_ID, user.username as string, { kind: 'text', body: text });

    if (!this.enabled) return void (await say(MSG.off));
    if (!(await this.underDailyLimit(userId))) return void (await say(MSG.daily));
    if (!(await this.underMonthlyCap())) return void (await say(MSG.monthly));

    // «A escrever…» enquanto a resposta é preparada.
    const ping = () => this.events.emit(userId, { type: 'typing', from: SUPERTXILL_USERNAME });
    ping();
    const tick = setInterval(ping, 3000);
    let text: string;
    try {
      text = (await this.llm(await this.history(userId))).slice(0, 1800).trim();
      if (!text) text = MSG.error;
      // Nunca devolve conteúdo que as regras da app não deixariam enviar.
      if (this.filter.check(text)) text = MSG.refused;
    } catch (e) {
      this.log.warn(`a IA falhou: ${(e as Error).message}`);
      text = MSG.error;
    } finally {
      clearInterval(tick);
    }
    await say(text);
  }
}
