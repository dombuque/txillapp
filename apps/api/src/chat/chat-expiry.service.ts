import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { Scheduler } from '../realtime/scheduler';
import { AppConfig, CONFIG } from '../config';
import { PG_POOL } from '../db/db.module';
import { ChatEvents } from './chat.events';
import { wipeMessage } from './chat.service';

/** De quanto em quanto tempo a limpeza corre (as expiradas já não aparecem a ninguém; isto só as apaga de vez). */
export const EXPIRY_EVERY_MS = 5 * 60_000;

/**
 * Mensagens temporárias (0123): apaga de vez as mensagens que passaram do `expires_at`, pelo mesmo caminho do "Apagar
 * para todos" (wipeMessage: o ficheiro passa a 'deleted' e sai do armazenamento na varredura do MediaService, a sondagem,
 * as reações e as vistas vão-se) e depois a própria linha. Um presente fica só como linha vazia, sem aviso (`gift_tx`
 * impede que o mesmo presente volte a entrar na conversa), como na remoção pela moderação.
 * Desde o `expires_at` que já ninguém as vê (as consultas usam notExpired); no fim, as conversas e os grupos com
 * mensagens apagadas recebem 'deleted' para os ecrãs abertos se porem em dia.
 * Corre de 5 em 5 minutos; nos testes não arranca sozinha (chama-se `run()`).
 */
@Injectable()
export class ChatExpiryService implements OnModuleInit {
  private readonly log = new Logger('MensagensTemporarias');

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly events: ChatEvents,
    private readonly scheduler: Scheduler,
  ) {}

  onModuleInit() {
    this.scheduler.every('chat.expiry', EXPIRY_EVERY_MS, () => this.run());
  }

  /** Apaga até `limit` mensagens expiradas. Devolve quantas apagou. */
  async run(limit = 500): Promise<number> {
    const { rows } = await this.pool.query(
      `SELECT id FROM social.messages WHERE expires_at IS NOT NULL AND expires_at <= now() ORDER BY expires_at LIMIT $1`,
      [limit],
    );
    const convs = new Set<string>();
    const groups = new Set<string>();
    let done = 0;
    for (const r of rows) {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        // Bloqueada (e saltada se outra limpeza ou um "Apagar para todos" já lhe pegou).
        const m = (
          await client.query(
            `SELECT conversation_id, group_id, gift_tx FROM social.messages WHERE id = $1 AND expires_at IS NOT NULL AND expires_at <= now() FOR UPDATE SKIP LOCKED`,
            [r.id],
          )
        ).rows[0];
        if (!m) {
          await client.query('ROLLBACK');
          continue;
        }
        await wipeMessage(client, r.id as string, false);
        if (m.gift_tx) await client.query('UPDATE social.messages SET expires_at = NULL WHERE id = $1', [r.id]);
        else await client.query('DELETE FROM social.messages WHERE id = $1', [r.id]);
        await client.query('COMMIT');
        done++;
        if (m.group_id) groups.add(m.group_id as string);
        else if (m.conversation_id) convs.add(m.conversation_id as string);
      } catch (e) {
        await client.query('ROLLBACK').catch(() => undefined);
        this.log.warn(`não consegui apagar ${r.id}: ${(e as Error).message}`);
      } finally {
        client.release();
      }
    }
    await this.announce([...convs], [...groups]);
    return done;
  }

  /** Os ecrãs abertos voltam a pedir as conversas e os grupos onde saíram mensagens. */
  private async announce(convs: string[], groups: string[]) {
    if (convs.length) {
      const { rows } = await this.pool.query(
        `SELECT c.user_a, c.user_b, a.username AS name_a, b.username AS name_b
           FROM social.conversations c JOIN identity.users a ON a.id = c.user_a JOIN identity.users b ON b.id = c.user_b WHERE c.id = ANY($1::uuid[])`,
        [convs],
      );
      for (const c of rows) {
        this.events.emit(c.user_a as string, { type: 'deleted', from: c.name_b as string });
        this.events.emit(c.user_b as string, { type: 'deleted', from: c.name_a as string });
      }
    }
    if (groups.length) {
      const { rows } = await this.pool.query('SELECT group_id, user_id FROM social.group_members WHERE group_id = ANY($1::uuid[])', [groups]);
      for (const m of rows) this.events.emit(m.user_id as string, { type: 'deleted', group: m.group_id as string });
    }
  }
}
