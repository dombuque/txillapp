import { ConflictException, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { uuidv7 } from '../common/uuid7';

/**
 * Remover e repor conteúdo pela moderação (0121), numa transação já aberta (`client`).
 *  • publicação (e tcheka): fica escondida (removed_at), como já era;
 *  • comentário: apaga-se (com as respostas e os brindes), mas fica uma cópia em content.moderation_removals para o repor;
 *  • mimo: deixa de se ver (o prazo passa para agora) e guarda-se o prazo original.
 * Cada remoção fica em content.moderation_removals, com o motivo, quem e quando; repor fecha essa linha.
 */
export const REMOVABLE_TYPES = ['post', 'comment', 'story'] as const;
export type RemovableType = (typeof REMOVABLE_TYPES)[number];

/** A cópia de um comentário removido apaga-se ao fim deste prazo (depois disso já não se repõe). */
export const REMOVAL_COPY_DAYS = 180;

export interface Removed { authorId: string | null; postId: string | null; body: string }

export async function removeContent(client: PoolClient, type: RemovableType, id: string, actor: string, reason: string): Promise<Removed> {
  let out: Removed;
  let snapshot: unknown = null;
  if (type === 'post') {
    const r = (await client.query(`UPDATE content.posts SET removed_at = now(), removed_by = 'moderation' WHERE id = $1 AND removed_at IS NULL RETURNING author_id, body`, [id])).rows[0];
    if (!r) throw new NotFoundException('Publicação não encontrada ou já removida');
    out = { authorId: r.author_id, postId: id, body: r.body ?? '' };
  } else if (type === 'comment') {
    const r = (await client.query('SELECT author_id, post_id, body FROM content.comments WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!r) throw new NotFoundException('Comentário não encontrado ou já removido');
    // O comentário primeiro e depois as respostas, para repor pela mesma ordem.
    const rows = (await client.query(
      `SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY (c.id = $1) DESC, c.id), '[]'::jsonb) AS rows FROM content.comments c WHERE c.id = $1 OR c.parent_id = $1`,
      [id],
    )).rows[0].rows;
    snapshot = { rows };
    await client.query('DELETE FROM content.comments WHERE id = $1', [id]);
    out = { authorId: r.author_id, postId: r.post_id, body: r.body ?? '' };
  } else {
    const r = (await client.query(
      `WITH old AS (SELECT id, expires_at, author_id, caption FROM content.stories WHERE id = $1 AND expires_at > now() FOR UPDATE)
       UPDATE content.stories s SET expires_at = now() FROM old WHERE s.id = old.id RETURNING old.expires_at, old.author_id, old.caption`,
      [id],
    )).rows[0];
    if (!r) throw new NotFoundException('Mimo não encontrado, já expirado ou já removido');
    snapshot = { expiresAt: new Date(r.expires_at as string).toISOString() };
    out = { authorId: r.author_id, postId: null, body: r.caption ?? '' };
  }
  await client.query(
    `INSERT INTO content.moderation_removals (id, target_type, target_id, author_id, post_id, body, snapshot, reason, removed_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [uuidv7(), type, id, out.authorId, out.postId, out.body.slice(0, 2000), snapshot, reason, actor],
  );
  return out;
}

export interface Restored extends Removed { /** O mimo já tinha passado das 24 horas: volta a existir, mas não aparece. */ expired: boolean }

export async function restoreContent(client: PoolClient, type: RemovableType, id: string, actor: string, reason: string): Promise<Restored> {
  const m = (await client.query(
    'SELECT id, author_id, post_id, body, snapshot FROM content.moderation_removals WHERE target_type = $1 AND target_id = $2 AND restored_at IS NULL FOR UPDATE',
    [type, id],
  )).rows[0];
  if (!m) throw new NotFoundException('Este conteúdo não foi removido pela moderação');
  let expired = false;
  if (type === 'post') {
    const r = await client.query(`UPDATE content.posts SET removed_at = NULL, removed_by = NULL WHERE id = $1 AND removed_by = 'moderation'`, [id]);
    if (!r.rowCount) throw new ConflictException('A publicação já não existe (o autor apagou-a ou eliminou a conta)');
  } else if (type === 'comment') {
    const rows = (m.snapshot as { rows?: Record<string, unknown>[] } | null)?.rows;
    if (!rows?.length) throw new ConflictException(`A cópia deste comentário já foi apagada (passaram ${REMOVAL_COPY_DAYS} dias)`);
    const post = await client.query('SELECT 1 FROM content.posts WHERE id = $1 AND removed_at IS NULL', [m.post_id]);
    if (!post.rowCount) throw new ConflictException('A publicação deste comentário já não existe');
    const [root, ...replies] = rows;
    const parent = root.parent_id as string | null;
    if (parent && !(await client.query('SELECT 1 FROM content.comments WHERE id = $1', [parent])).rowCount) throw new ConflictException('O comentário a que respondia já não existe');
    const alive = `EXISTS (SELECT 1 FROM identity.users u WHERE u.id = r.author_id AND u.status <> 'deleted')`;
    const ins = await client.query(
      `INSERT INTO content.comments SELECT r.* FROM jsonb_populate_recordset(NULL::content.comments, $1::jsonb) r WHERE ${alive} ON CONFLICT (id) DO NOTHING`,
      [JSON.stringify([root])],
    );
    if (!ins.rowCount) throw new ConflictException('O autor do comentário eliminou a conta');
    if (replies.length) {
      await client.query(
        `INSERT INTO content.comments SELECT r.* FROM jsonb_populate_recordset(NULL::content.comments, $1::jsonb) r WHERE ${alive} ON CONFLICT (id) DO NOTHING`,
        [JSON.stringify(replies)],
      );
    }
  } else {
    const at = (m.snapshot as { expiresAt?: string } | null)?.expiresAt;
    const r = await client.query('UPDATE content.stories SET expires_at = $2 WHERE id = $1 RETURNING expires_at <= now() AS expired', [id, at ?? new Date().toISOString()]);
    if (!r.rowCount) throw new ConflictException('O mimo já não existe');
    expired = !!r.rows[0].expired;
  }
  await client.query(
    'UPDATE content.moderation_removals SET restored_at = now(), restored_by = $2, restore_reason = $3, snapshot = NULL WHERE id = $1',
    [m.id, actor, reason],
  );
  return { authorId: m.author_id, postId: m.post_id, body: m.body ?? '', expired };
}

/** Apaga as cópias (e o texto) dos comentários removidos há mais de REMOVAL_COPY_DAYS (a linha da remoção fica, sem o conteúdo). */
export async function purgeRemovalCopies(client: { query: PoolClient['query'] }, days = REMOVAL_COPY_DAYS) {
  const r = await client.query(
    `UPDATE content.moderation_removals SET snapshot = NULL, body = NULL
      WHERE target_type = 'comment' AND (snapshot IS NOT NULL OR body IS NOT NULL) AND removed_at < now() - make_interval(days => $1)`,
    [days],
  );
  return r.rowCount ?? 0;
}
