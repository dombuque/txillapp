import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { AppConfig, CONFIG } from '../config';
import { PG_POOL } from '../db/db.module';
import { referencedAmong } from './media-refs';
import { MediaService } from './media.service';

/** Um envio que não chega a ser usado (publicação, mensagem, mimo, foto de perfil…) apaga-se ao fim deste prazo. */
export const UNUSED_MEDIA_HOURS = 48;
/** De quanto em quanto tempo a limpeza corre. */
export const UNUSED_EVERY_MS = 60 * 60_000;
/** Quantos ficheiros se veem de cada vez (por ordem do id) e quantos se apagam em cada transação. */
const WINDOW = 500;
const BATCH = 50;
/** Em cada passagem, no máximo isto de janelas (a seguinte continua de onde esta parou). */
const MAX_WINDOWS = 40;
const START = '00000000-0000-0000-0000-000000000000';

/**
 * Envios por publicar: fotos, vídeos e áudios enviados que nunca chegaram a ser usados (a publicação ou o mimo não se
 * publicou, o envio de uma mensagem falhou, os clipes e a voz-off da montagem no servidor, o vídeo montado que não foi
 * publicado…). Nunca aparecem a ninguém; ao fim de UNUSED_MEDIA_HOURS sem uso são apagados, do armazenamento e da base
 * de dados. «Em uso» é a lista de media-refs.ts (também os pedidos de montagem ainda ativos e as fotos com uma denúncia por
 * decidir). Não há rascunhos no servidor: os do estúdio ficam só no aparelho. As fotos recusadas pela verificação
 * automática ('rejected') não entram aqui: têm o prazo próprio de 7 dias (MediaService.sweepDeleted). Uma foto aprovada
 * num pedido de revisão conta as 48 horas a partir da aprovação (appeal_decided_at).
 *
 * Cada lote: bloqueia as linhas (FOR UPDATE SKIP LOCKED: quem esteja nesse instante a pôr o ficheiro numa publicação tem
 * a linha bloqueada pela chave estrangeira e o ficheiro fica para a próxima), volta a ver os usos já com o bloqueio, e só
 * então passa os que continuam sem uso a 'deleted' (deixam de se poder usar). Depois sai o ficheiro do armazenamento e a
 * linha. Se o servidor cair a meio, a linha fica como 'deleted' e a varredura do MediaService tira o ficheiro.
 * Corre de hora a hora; nos testes não arranca sozinha (chama-se `run()`).
 */
@Injectable()
export class UnusedMediaService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('EnviosPorPublicar');
  private timer?: NodeJS.Timeout;
  private first?: NodeJS.Timeout;
  private cursor = START;
  private running: Promise<number> | null = null;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly media: MediaService,
  ) {}

  onModuleInit() {
    if (this.config.NODE_ENV === 'test') return;
    const tick = () => void this.run().catch((e) => this.log.warn(`falha na limpeza: ${(e as Error).message}`));
    this.first = setTimeout(tick, 5 * 60_000);
    this.first.unref();
    this.timer = setInterval(tick, UNUSED_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.first) clearTimeout(this.first);
    if (this.timer) clearInterval(this.timer);
  }

  /** Uma passagem (até MAX_WINDOWS janelas, a continuar de onde a anterior parou). Devolve quantos ficheiros apagou. */
  run(): Promise<number> {
    this.running ??= this.pass().finally(() => (this.running = null));
    return this.running;
  }

  private async pass(): Promise<number> {
    let deleted = 0;
    let seen = 0;
    for (let w = 0; w < MAX_WINDOWS; w++) {
      const { rows } = await this.pool.query(
        `SELECT id FROM content.media_assets
          WHERE id > $1 AND status NOT IN ('deleted', 'rejected') AND COALESCE(appeal_decided_at, created_at) < now() - make_interval(hours => $2)
          ORDER BY id LIMIT $3`,
        [this.cursor, UNUSED_MEDIA_HOURS, WINDOW],
      );
      const ids = rows.map((r) => r.id as string);
      seen += ids.length;
      if (ids.length) {
        const used = await referencedAmong(this.pool, ids);
        const unused = ids.filter((id) => !used.has(id));
        for (let i = 0; i < unused.length; i += BATCH) deleted += await this.deleteBatch(unused.slice(i, i + BATCH));
      }
      // Chegou ao fim: a próxima passagem recomeça do princípio.
      if (ids.length < WINDOW) {
        this.cursor = START;
        break;
      }
      this.cursor = ids[ids.length - 1];
    }
    if (deleted) this.log.log(`apagados ${deleted} envios por publicar com mais de ${UNUSED_MEDIA_HOURS} h (vistos ${seen})`);
    return deleted;
  }

  /** Apaga os ficheiros dados que continuem sem uso (vê outra vez com as linhas bloqueadas). Devolve quantos apagou. */
  private async deleteBatch(ids: string[]): Promise<number> {
    const client = await this.pool.connect();
    let gone: { id: string; purpose: string }[] = [];
    try {
      await client.query('BEGIN');
      const locked = (await client.query(
        `SELECT id FROM content.media_assets
          WHERE id = ANY($1::uuid[]) AND status NOT IN ('deleted', 'rejected') AND COALESCE(appeal_decided_at, created_at) < now() - make_interval(hours => $2)
          FOR UPDATE SKIP LOCKED`,
        [ids, UNUSED_MEDIA_HOURS],
      )).rows.map((r) => r.id as string);
      const used = await referencedAmong(client, locked);
      const free = locked.filter((id) => !used.has(id));
      if (free.length) {
        gone = (await client.query(
          `UPDATE content.media_assets SET status = 'deleted' WHERE id = ANY($1::uuid[]) RETURNING id, purpose`,
          [free],
        )).rows as { id: string; purpose: string }[];
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
    let n = 0;
    for (const g of gone) {
      await this.media.purgeFiles(g.id, g.purpose);
      try {
        await this.pool.query(`DELETE FROM content.media_assets WHERE id = $1 AND status = 'deleted'`, [g.id]);
        n++;
      } catch (e) {
        // Uma referência que a lista não conhece (o teste das migrações devia tê-la apanhado): fica a linha, sem o ficheiro.
        await this.pool.query('UPDATE content.media_assets SET purged_at = now() WHERE id = $1', [g.id]).catch(() => undefined);
        this.log.warn(`não consegui apagar a linha do ficheiro ${g.id}: ${(e as Error).message}`);
      }
    }
    return n;
  }
}
