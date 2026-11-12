import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { badge } from '../common/badge';
import { blockedBetween, canView } from '../social/visibility';
import { tchekaPost } from './feed';

/**
 * Remix das tchekas (0134): o «Dueto» (o meu vídeo lado a lado com a tcheka de outra pessoa) e o «Responder com tcheka»
 * (responder a um comentário com uma tcheka, com o comentário num autocolante por cima do vídeo).
 *
 * Quem deixa: «Deixar fazer duetos e respostas com as minhas tchekas» (identity.users.remix_allowed, ligado por omissão).
 * Numa conta privada nunca vale (o remix é público e levava o conteúdo para fora dos seguidores). O próprio pode sempre.
 */
export type RemixKind = 'duet' | 'reply';

export const remixSchema = z
  .object({
    postId: z.string().uuid(),
    kind: z.enum(['duet', 'reply']),
    commentId: z.string().uuid().optional(),
    /** Onde fica o autocolante do comentário (só nas respostas): 0–1 do vídeo, a partir do canto de cima à esquerda. */
    sticker: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional(),
  })
  .refine((r) => (r.kind === 'reply') === !!r.commentId, { message: 'Uma resposta leva o comentário; um dueto não', path: ['commentId'] });
export type RemixInput = z.infer<typeof remixSchema>;

/** O dono `u` deixa `viewer` fazer remix do que é dele? (SQL; o próprio pode sempre). */
export const remixAllowed = (u = 'u', viewer = '$1') => `(${u}.id = ${viewer} OR (NOT ${u}.is_private AND ${u}.remix_allowed))`;

/** O que se guarda e quem se avisa depois de criar a publicação. */
export interface CheckedRemix {
  input: RemixInput;
  originalAuthorId: string;
  commentAuthorId: string | null;
  /** A música do original (para o dueto ficar com o som do original quando não se escolhe outra). */
  originalMusic: Record<string, unknown> | null;
}

/**
 * Valida o remix antes de publicar: a publicação nova é uma tcheka (um vídeo só); o original existe, está visível para
 * quem faz o remix (privacidade e bloqueios), é uma publicação normal (não um repost, presente ou de um local) e o dono deixa;
 * num dueto o original é uma tcheka; numa resposta o comentário é dessa publicação, de uma conta ativa sem bloqueio, e
 * quem o escreveu também deixa.
 */
export async function checkRemix(pool: Pool | PoolClient, userId: string, r: RemixInput, mediaIds: string[]): Promise<CheckedRemix> {
  if (mediaIds.length !== 1) throw new BadRequestException('Um dueto ou uma resposta é uma tcheka: um vídeo só');
  const vid = await pool.query(`SELECT 1 FROM content.media_assets WHERE id = $1 AND mime LIKE 'video/%'`, [mediaIds[0]]);
  if (!vid.rowCount) throw new BadRequestException('Um dueto ou uma resposta é uma tcheka: um vídeo só');
  const o = (
    await pool.query(
      `SELECT p.author_id, p.kind, p.venue_id, p.music, ${tchekaPost()} AS tcheka, ${remixAllowed()} AS allowed
         FROM content.posts p JOIN identity.users u ON u.id = p.author_id AND p.removed_at IS NULL
        WHERE p.id = $2 AND ${canView()}`,
      [userId, r.postId],
    )
  ).rows[0];
  if (!o) throw new NotFoundException('Publicação não encontrada');
  if (o.kind !== 'post' || o.venue_id) throw new BadRequestException('Só dá para fazer remix de tchekas e publicações de pessoas');
  if (!o.allowed) throw new ForbiddenException('Esta pessoa não deixa fazer duetos nem responder com tchekas');
  let commentAuthorId: string | null = null;
  if (r.kind === 'duet') {
    if (!o.tcheka) throw new BadRequestException('Só dá para fazer dueto com uma tcheka');
  } else {
    const c = (
      await pool.query(
        `SELECT c.author_id, ${remixAllowed()} AS allowed, (u.status = 'active' AND NOT ${blockedBetween('u.id', '$1')}) AS ok
           FROM content.comments c JOIN identity.users u ON u.id = c.author_id WHERE c.id = $2 AND c.post_id = $3`,
        [userId, r.commentId, r.postId],
      )
    ).rows[0];
    if (!c || !c.ok) throw new NotFoundException('Comentário não encontrado');
    if (!c.allowed) throw new ForbiddenException('Quem escreveu este comentário não deixa responder com tchekas');
    commentAuthorId = c.author_id as string;
  }
  return { input: r, originalAuthorId: o.author_id as string, commentAuthorId, originalMusic: (o.music as Record<string, unknown> | null) ?? null };
}

/** Guarda a ligação, na mesma transação da publicação. O autocolante só nas respostas. */
export async function saveRemix(client: PoolClient, postId: string, c: CheckedRemix) {
  const s = c.input.kind === 'reply' ? c.input.sticker ?? { x: 0.08, y: 0.18 } : null;
  await client.query(
    'INSERT INTO content.post_remixes (post_id, original_id, kind, comment_id, sticker_x, sticker_y) VALUES ($1, $2, $3, $4, $5, $6)',
    [postId, c.input.postId, c.input.kind, c.input.kind === 'reply' ? c.input.commentId : null, s?.x ?? null, s?.y ?? null],
  );
}

/** A ligação do remix como sai na publicação (ver `remixLinks`). */
export interface RemixOf {
  postId: string;
  kind: RemixKind;
  commentId: string | null;
  /** Onde fica o autocolante do comentário (respostas). */
  sticker: { x: number; y: number } | null;
  /** O original ainda se vê (apagado, privado ou bloqueado: a tcheka fica, sem a ligação). */
  available: boolean;
  code: string | null;
  author: ({ username: string; displayName: string; hasAvatar: boolean } & ReturnType<typeof badge>) | null;
  /** O comentário respondido (avatar, @ e texto), se ainda existe e se vê. */
  comment: { id: string; body: string; author: { username: string; displayName: string; hasAvatar: boolean } & ReturnType<typeof badge> } | null;
}

/**
 * Para as linhas de FEED_SQL que são remix (`rx_original`): o original e o comentário, só se este espectador os pode ver.
 * Duas consultas por página, nunca uma por publicação.
 */
export async function remixLinks(pool: Pool, viewerId: string, rows: Record<string, any>[]): Promise<Map<string, RemixOf>> {
  const out = new Map<string, RemixOf>();
  const mine = rows.filter((r) => r.rx_original);
  if (!mine.length) return out;
  const origIds = [...new Set(mine.map((r) => r.rx_original as string))];
  const comIds = [...new Set(mine.map((r) => r.rx_comment as string | null).filter(Boolean))] as string[];
  const orig = new Map<string, Record<string, any>>();
  for (const o of (
    await pool.query(
      `SELECT p.id, p.short_code, u.username, u.display_name, (u.avatar_media_id IS NOT NULL) AS has_avatar, u.verified, u.verified_tier
         FROM content.posts p JOIN identity.users u ON u.id = p.author_id AND p.removed_at IS NULL WHERE p.id = ANY($2::uuid[]) AND ${canView()}`,
      [viewerId, origIds],
    )
  ).rows) orig.set(o.id as string, o);
  const coms = new Map<string, Record<string, any>>();
  if (comIds.length) {
    for (const c of (
      await pool.query(
        `SELECT c.id, c.body, u.username, u.display_name, (u.avatar_media_id IS NOT NULL) AS has_avatar, u.verified, u.verified_tier
           FROM content.comments c JOIN identity.users u ON u.id = c.author_id
          WHERE c.id = ANY($2::uuid[]) AND u.status = 'active' AND NOT ${blockedBetween('u.id', '$1')}`,
        [viewerId, comIds],
      )
    ).rows) coms.set(c.id as string, c);
  }
  for (const r of mine) {
    const o = orig.get(r.rx_original as string);
    const c = o && r.rx_comment ? coms.get(r.rx_comment as string) : undefined;
    out.set(r.id as string, {
      postId: r.rx_original as string,
      kind: r.rx_kind as RemixKind,
      commentId: (r.rx_comment as string | null) ?? null,
      sticker: r.rx_kind === 'reply' && r.rx_x != null ? { x: Number(r.rx_x), y: Number(r.rx_y) } : null,
      available: !!o,
      code: o ? (o.short_code as string) : null,
      author: o ? { username: o.username as string, displayName: o.display_name as string, hasAvatar: !!o.has_avatar, ...badge(o.verified, o.verified_tier) } : null,
      comment: c
        ? { id: c.id as string, body: String(c.body ?? ''), author: { username: c.username as string, displayName: c.display_name as string, hasAvatar: !!c.has_avatar, ...badge(c.verified, c.verified_tier) } }
        : null,
    });
  }
  return out;
}
