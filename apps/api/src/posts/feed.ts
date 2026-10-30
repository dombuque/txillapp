import { BadRequestException } from '@nestjs/common';
import { blockedBetween, canView, sameCountry } from '../social/visibility';

/**
 * Feed por relevância (como nas redes sociais). Em vez de "o mais recente primeiro", cada publicação recebe uma pontuação:
 *
 *   frescura (cai a meio a cada ~12 h)
 * + quem é o autor para ti (quem segues pesa muito; quem tens brindado/comentado nos últimos 30 dias, também)
 * + interação com a publicação (brindes, comentários, reposts, presentes), com teto, e que decai mais devagar
 * + um pouco de variedade (um empurrão pequeno e estável durante a sessão, que muda de sessão para sessão)
 * − o que já viste (desce muito; só volta quando já não há novidades)
 * − a 2.ª, 3.ª… publicação seguida do mesmo autor (não enche o ecrã de uma pessoa só)
 *
 * Sugestões: além de quem segues, entram publicações públicas recentes de outras contas, com um pequeno desconto.
 * A paginação usa (pontuação, id) fixos durante a sessão: o início da sessão vem no cursor, por isso o que vais vendo
 * não muda a ordem das páginas seguintes.
 */

export interface FeedCursor {
  /** Pontuação da última publicação da página anterior. */
  s: number;
  id: string;
  /** Início da sessão (ISO): congela "o que já viste" e a variedade. */
  t: string;
}

export function encodeCursor(c: FeedCursor) {
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}

export function decodeCursor(token: string | undefined): FeedCursor | null {
  if (!token) return null;
  try {
    const c = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
    const okTime = typeof c.t === 'string' && !Number.isNaN(Date.parse(c.t)) && Date.parse(c.t) <= Date.now() + 60_000;
    if (typeof c.s === 'number' && Number.isFinite(c.s) && /^[0-9a-f-]{36}$/.test(c.id) && okTime) return c as FeedCursor;
  } catch {
    /* cai no erro abaixo */
  }
  throw new BadRequestException('cursor inválido');
}

/**
 * Candidatos e pontuação. Parâmetros: $1 = pessoa, $2 = início da sessão, $3 = variedade (texto da sessão).
 * Parâmetros extra: $6 = limite, $7 = só vídeos (Reels), $8 = desconto de quem não sigo. Devolve (id, score, source, seen) já com a penalização por autor repetido.
 */
/** A publicação tem um vídeo (para a lista de Reels). */
const VIDEO_POST = `EXISTS (SELECT 1 FROM content.post_media vpm JOIN content.media_assets vma ON vma.id = vpm.media_id WHERE vpm.post_id = p.id AND vma.mime LIKE 'video/%')`;

export const RANKED_SQL = `
  WITH net AS (
    -- Rede: as minhas publicações e as de quem sigo (últimos 10 dias).
    SELECT p.id FROM content.posts p
     WHERE p.removed_at IS NULL AND p.created_at > $2::timestamptz - interval '10 days' AND p.created_at <= $2::timestamptz
       AND (p.author_id = $1 OR EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = $1 AND f.followee_id = p.author_id))
       AND (NOT $7::boolean OR ${VIDEO_POST})
     ORDER BY p.created_at DESC LIMIT 400
  ), pool AS (
    -- Sugestões: as publicações públicas mais recentes de outras contas (últimos 3 dias).
    SELECT p.id FROM content.posts p JOIN identity.users u ON u.id = p.author_id
     WHERE p.removed_at IS NULL AND p.kind = 'post' AND NOT u.is_private AND u.status = 'active'
       AND p.created_at > $2::timestamptz - interval '3 days' AND p.created_at <= $2::timestamptz
       AND p.author_id <> $1 AND NOT ${blockedBetween('p.author_id', '$1')}
       AND ${sameCountry('p.country')}
       AND (NOT $7::boolean OR ${VIDEO_POST})
     ORDER BY p.created_at DESC LIMIT 150
  ), ids AS (
    SELECT id FROM net UNION SELECT id FROM pool
  ), aff AS (
    -- O que tens feito com cada autor nos últimos 30 dias.
    SELECT author_id, sum(w)::float AS n FROM (
      SELECT cp.author_id, 1 AS w FROM content.cheers c JOIN content.posts cp ON cp.id = c.post_id
       WHERE c.user_id = $1 AND c.created_at > now() - interval '30 days'
      UNION ALL
      SELECT cp.author_id, 2 FROM content.comments cm JOIN content.posts cp ON cp.id = cm.post_id
       WHERE cm.author_id = $1 AND cm.created_at > now() - interval '30 days'
      UNION ALL
      SELECT cp.author_id, 3 FROM content.posts rp JOIN content.posts cp ON cp.id = rp.repost_of
       WHERE rp.author_id = $1 AND rp.kind = 'repost' AND rp.created_at > now() - interval '30 days'
      UNION ALL
      SELECT g.recipient_id, 3 FROM content.gifts g WHERE g.sender_id = $1 AND g.created_at > now() - interval '30 days'
    ) x GROUP BY author_id
  ), base AS (
    SELECT p.id, p.author_id,
           EXTRACT(EPOCH FROM ($2::timestamptz - p.created_at)) / 3600.0 AS age_h,
           (p.author_id = $1) AS is_self,
           EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = $1 AND f.followee_id = p.author_id) AS followed,
           COALESCE(a.n, 0) AS affinity,
           ((SELECT count(*) FROM content.cheers c WHERE c.post_id = p.id)
            + 2 * (SELECT count(*) FROM content.comments c WHERE c.post_id = p.id)
            + 3 * (SELECT count(*) FROM content.posts rp WHERE rp.repost_of = p.id AND rp.kind = 'repost' AND rp.removed_at IS NULL)
            + 2 * (SELECT count(*) FROM content.gifts g WHERE g.post_id = p.id))::float AS engagement,
           EXISTS (SELECT 1 FROM content.post_media pm WHERE pm.post_id = p.id) AS has_media,
           EXISTS (SELECT 1 FROM content.feed_impressions i WHERE i.user_id = $1 AND i.post_id = p.id AND i.seen_at < $2::timestamptz) AS seen,
           ((abs(hashtext(p.id::text || $1::text || $3::text)) % 1000) / 1000.0) AS jitter
      FROM ids JOIN content.posts p ON p.id = ids.id
      JOIN identity.users u ON u.id = p.author_id
      LEFT JOIN aff a ON a.author_id = p.author_id
     WHERE ${canView('u', '$1')}
       AND NOT EXISTS (SELECT 1 FROM content.feed_impressions h WHERE h.user_id = $1 AND h.post_id = p.id AND h.hidden)
  ), scored AS (
    SELECT b.*,
           exp(-b.age_h / 18.0)
           + CASE WHEN b.followed THEN 0.9 WHEN b.is_self THEN 0.6 ELSE $8::float END
           + 0.35 * ln(1 + b.affinity)
           + 0.4 * LEAST(ln(1 + b.engagement), 2.5) * exp(-b.age_h / 72.0)
           + CASE WHEN b.has_media THEN 0.08 ELSE 0 END
           + 0.12 * b.jitter
           - CASE WHEN b.seen THEN 1.6 ELSE 0 END AS raw
      FROM base b
  ), ranked AS (
    SELECT s.*, round((s.raw - 0.5 * (row_number() OVER (PARTITION BY s.author_id ORDER BY s.raw DESC) - 1))::numeric, 6) AS score
      FROM scored s
  )
  SELECT id, score::float AS score, seen,
         CASE WHEN is_self THEN 'self' WHEN followed THEN 'following' ELSE 'discover' END AS source
    FROM ranked
   WHERE $4::numeric IS NULL OR (score, id) < ($4::numeric, $5::uuid)
   ORDER BY score DESC, id DESC
   LIMIT $6`;
