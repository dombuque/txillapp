import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';

export interface SchemaBits {
  /** Os TxillGroups já têm tipo, capa, foto, visibilidade, mapa e plano (destino, local, datas). */
  groups: boolean;
  /** Os locais já dizem se aceitam Txills. */
  accepts: boolean;
}

const GROUP_COLUMNS = ['kind', 'cover_media_id', 'visibility', 'destination', 'plan_venue_id', 'starts_on', 'ends_on', 'show_on_map', 'avatar_media_id'];

/**
 * Colunas que outra equipa está a acrescentar: vê-se uma vez se existem e guarda-se a resposta.
 * Se ainda faltarem, volta-se a ver passado um minuto (a migração pode correr depois de o servidor arrancar).
 */
@Injectable()
export class SchemaProbe {
  private cached?: SchemaBits & { at: number };

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async bits(): Promise<SchemaBits> {
    const c = this.cached;
    if (c && ((c.groups && c.accepts) || Date.now() - c.at < 60_000)) return c;
    const { rows } = await this.pool.query(
      `SELECT table_schema, table_name, column_name FROM information_schema.columns
        WHERE (table_schema = 'social' AND table_name = 'groups' AND column_name = ANY($1))
           OR (table_schema = 'content' AND table_name = 'venues' AND column_name = 'accepts_txills')`,
      [GROUP_COLUMNS],
    );
    const groupCols = new Set(rows.filter((r) => r.table_name === 'groups').map((r) => r.column_name as string));
    this.cached = {
      at: Date.now(),
      groups: GROUP_COLUMNS.every((k) => groupCols.has(k)),
      accepts: rows.some((r) => r.table_name === 'venues'),
    };
    return this.cached;
  }

  /** Só para os testes: fingir que as colunas ainda não existem. */
  override(bits: SchemaBits | null) {
    this.cached = bits ? { ...bits, at: Number.MAX_SAFE_INTEGER } : undefined;
  }
}
