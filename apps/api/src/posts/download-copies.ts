import type { Pool, PoolClient } from 'pg';

/**
 * As cópias guardadas que deixam de ser permitidas quando `userId` desliga «Deixar guardar» ou passa a conta a privada: as das
 * publicações dele e as dos duetos de outros feitos com o vídeo dele. Tira as linhas e marca os ficheiros como apagados (saem
 * do armazenamento já, em PostDownloadService.purge, ou na limpeza de sempre, MediaService.sweepDeleted). Devolve os ids dos
 * ficheiros. Na mesma transação de quem muda a definição.
 */
export async function dropDownloadCopies(db: Pool | PoolClient, userId: string): Promise<string[]> {
  const { rows } = await db.query(
    `WITH gone AS (
       DELETE FROM content.post_downloads d
        WHERE d.post_id IN (SELECT id FROM content.posts WHERE author_id = $1)
           OR d.post_id IN (SELECT rx.post_id FROM content.post_remixes rx JOIN content.posts o ON o.id = rx.original_id
                             WHERE rx.kind = 'duet' AND o.author_id = $1)
       RETURNING d.media_id)
     UPDATE content.media_assets m SET status = 'deleted' FROM gone WHERE m.id = gone.media_id RETURNING m.id`,
    [userId],
  );
  return rows.map((r) => r.id as string);
}
