import { BadRequestException, HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Pool } from 'pg';
import { z } from 'zod';
import { uuidv7 } from '../common/uuid7';
import { PG_POOL } from '../db/db.module';
import { createSchema as instantSchema } from '../instants/instants.controller';
import { InstantsService } from '../instants/instants.service';
import { createSchema as postSchema } from '../posts/posts.controller';
import { PostsService } from '../posts/posts.service';
import { createSchema as storySchema } from '../stories/stories.controller';
import { StoriesService } from '../stories/stories.service';

export { HELD_PUBLICATIONS } from './held-token';

/** Quanto tempo uma publicação fica guardada à espera da revisão da foto (como a própria foto recusada). */
export const HELD_DAYS = 7;

/**
 * O rascunho que acompanha um pedido de revisão: o tipo e o MESMO corpo que a app mandaria ao endpoint de publicar
 * (POST /posts — publicação ou tcheka —, POST /stories — mimo —, POST /instants — Zás), validado com o mesmo esquema.
 */
export const heldDraftSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('post'), payload: postSchema }),
  z.object({ kind: z.literal('story'), payload: storySchema }),
  z.object({ kind: z.literal('instant'), payload: instantSchema }),
]);
export type HeldDraft = z.infer<typeof heldDraftSchema>;

export type HeldOutcome = { status: 'published'; kind: HeldDraft['kind']; resultId: string } | { status: 'failed'; kind: HeldDraft['kind']; error: string };

/** Os ficheiros de um rascunho. */
export const draftMedia = (d: HeldDraft): string[] => (d.kind === 'post' ? d.payload.mediaIds : [d.payload.mediaId]);

/**
 * Publicações guardadas no servidor enquanto a foto recusada está em revisão (0144): a pessoa pode fechar a app. Aprovada a
 * foto, publica-se aqui com o mesmo serviço do endpoint (o Zás e o mimo contam as 24 horas a partir daí); removida, ou
 * passados HELD_DAYS dias, descarta-se.
 */
@Injectable()
export class HeldPublicationsService {
  private readonly log = new Logger('PublicacoesGuardadas');

  constructor(@Inject(PG_POOL) private readonly pool: Pool, private readonly moduleRef: ModuleRef) {}

  /** Valida o rascunho (esquema do endpoint, a foto em revisão lá dentro, os outros ficheiros meus e ainda vivos). */
  async check(owner: string, mediaId: string, input: unknown): Promise<HeldDraft> {
    const parsed = heldDraftSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException(`Rascunho inválido: ${parsed.error.issues[0]?.message ?? 'formato'}`);
    const d = parsed.data;
    const media = draftMedia(d);
    if (!media.includes(mediaId)) throw new BadRequestException('O rascunho tem de levar a foto em revisão');
    const others = media.filter((m) => m !== mediaId);
    if (others.length) {
      const ok = await this.pool.query(
        `SELECT count(*)::int AS n FROM content.media_assets WHERE id = ANY($1::uuid[]) AND owner_id = $2 AND status IN ('ready', 'uploaded', 'processing')`,
        [others, owner],
      );
      if (ok.rows[0].n !== new Set(others).size) throw new BadRequestException('Algum dos outros ficheiros da publicação já não existe');
    }
    return d;
  }

  async hold(owner: string, mediaId: string, d: HeldDraft) {
    await this.pool.query(
      `INSERT INTO content.held_publications (id, owner_id, kind, media_id, payload, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $6))`,
      [uuidv7(), owner, d.kind, mediaId, d.payload, HELD_DAYS],
    );
  }

  /** O estado da publicação guardada mais recente desta foto (para a faixa da app). */
  async stateOf(mediaId: string): Promise<{ status: string; kind: string; resultId: string | null; error: string | null } | null> {
    const r = (await this.pool.query('SELECT status, kind, result_id, error FROM content.held_publications WHERE media_id = $1 ORDER BY created_at DESC LIMIT 1', [mediaId])).rows[0];
    return r ? { status: r.status, kind: r.kind, resultId: r.result_id ?? null, error: r.error ?? null } : null;
  }

  /** A foto foi aprovada: publica o que estava guardado. Devolve o resultado, ou null se não havia nada guardado. */
  async publishFor(mediaId: string): Promise<HeldOutcome | null> {
    const row = (await this.pool.query(
      `UPDATE content.held_publications SET status = 'published', decided_at = now()
        WHERE media_id = $1 AND status = 'held' AND expires_at > now() RETURNING id, owner_id, kind, payload`,
      [mediaId],
    )).rows[0];
    if (!row) return null;
    const kind = row.kind as HeldDraft['kind'];
    try {
      const resultId = await this.publish(row.owner_id as string, { kind, payload: row.payload } as HeldDraft);
      await this.pool.query('UPDATE content.held_publications SET result_id = $2 WHERE id = $1', [row.id, resultId]);
      return { status: 'published', kind, resultId };
    } catch (e) {
      const error = e instanceof HttpException ? e.message : 'Erro inesperado';
      if (!(e instanceof HttpException)) this.log.error(`não consegui publicar a publicação guardada ${row.id}: ${(e as Error).message}`);
      await this.pool.query(`UPDATE content.held_publications SET status = 'failed', error = $2 WHERE id = $1`, [row.id, error]);
      return { status: 'failed', kind, error };
    }
  }

  /** A foto foi removida pela moderação: o que estava guardado descarta-se. Devolve true se havia alguma coisa. */
  async discardFor(mediaId: string): Promise<boolean> {
    const r = await this.pool.query(`UPDATE content.held_publications SET status = 'discarded', decided_at = now() WHERE media_id = $1 AND status = 'held'`, [mediaId]);
    return !!r.rowCount;
  }

  /** Passados HELD_DAYS dias, descarta-se (os outros ficheiros deixam de contar como em uso). */
  async expire() {
    const r = await this.pool.query(`UPDATE content.held_publications SET status = 'expired', decided_at = now() WHERE status = 'held' AND expires_at <= now()`);
    return r.rowCount ?? 0;
  }

  /** Publica com o mesmo serviço que o endpoint usaria. Devolve o id do que ficou publicado. */
  private async publish(owner: string, d: HeldDraft): Promise<string> {
    const get = <T>(t: new (...a: never[]) => T) => this.moduleRef.get(t, { strict: false });
    if (d.kind === 'post') {
      const b = d.payload;
      const p = (await get(PostsService).create(owner, b.body, b.locationLabel, b.mediaIds, b.tags, b.music ?? null, b.locationLat != null && b.locationLng != null ? { lat: b.locationLat, lng: b.locationLng, coarse: b.locationCoarse } : null, b.venueId ?? null, b.soundId ?? null, b.remixOf ?? null, b.music !== undefined)) as { id: string };
      return p.id;
    }
    if (d.kind === 'story') {
      const b = d.payload;
      const s = (await get(StoriesService).create(owner, b.mediaId, b.caption, b.audience, b.music ?? null, b.stickers)) as { id: string };
      return s.id;
    }
    const b = d.payload;
    return (await get(InstantsService).create(owner, b.mediaId, b.caption, b.audience)).id;
  }
}
