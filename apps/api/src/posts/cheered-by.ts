import type { Pool } from 'pg';
import { badge, type Badge } from '../common/badge';
import { canView } from '../social/visibility';

/**
 * Uma das (até) três pessoas de «Brindado por @fulano e outras N pessoas». `close`: está nos meus amigos próximos;
 * `following`: sigo-a (sem amigos próximos que brindaram, flutuam as pessoas que sigo).
 */
export interface CheeredByUser extends Badge {
  username: string;
  displayName: string;
  avatarUrl: string | null;
  close: boolean;
  following: boolean;
}

/** «Brindado por…» de uma publicação: até 3 pessoas e quantos brindes tem (o mesmo número de `cheers`). */
export interface CheeredBy {
  users: CheeredByUser[];
  total: number;
}

/** Quantas pessoas aparecem na publicação (os avatares empilhados e os nomes). */
export const CHEERED_BY_MAX = 3;
/** Os brindes mais recentes de cada publicação onde se procuram os amigos próximos e quem sigo. */
export const CHEERED_BY_SCAN = 500;
/** Numa publicação com mais brindes do que isso: os amigos próximos procuram-se também pela lista (os primeiros tantos). */
export const CHEERED_BY_CLOSE_LIST = 150;
/** Publicações por consulta: o custo estimado cresce com elas, e uma página grande (50, mais os originais) passava os 100 000. */
const CHUNK = 25;

/**
 * «Brindado por @fulano e outras N pessoas», para uma página de publicações numa só consulta. Só nas publicações em que o
 * dono deixa quem vê ver quem brindou (`cheers_list`, a mesma regra de `GET /posts/:id/people/cheers`); nas outras fica
 * `null` (a app mostra só a contagem). Quem aparece, por esta ordem: os meus amigos próximos que brindaram, depois quem eu
 * sigo, depois os mais recentes; nunca eu, nunca quem tem bloqueio comigo, uma conta desativada ou uma conta privada que
 * eu não siga (canView, como na lista).
 *
 * O custo de cada publicação tem teto, tenha ela dez brindes ou cem mil: os amigos próximos e quem sigo procuram-se nos
 * CHEERED_BY_SCAN brindes mais recentes (pelo índice cheers_post_created_idx, 0163; com menos brindes do que isso, em
 * todos); numa publicação com mais, os amigos próximos procuram-se também pela lista (cada um pela chave do brinde), para
 * não se perderem os de há mais tempo. Os recentes param nos três primeiros que se podem mostrar. Três de cada lado chegam:
 * os três mais recentes já são três pessoas diferentes. (Custo estimado baixo também de propósito: acima de 100 000 o
 * Postgres liga o JIT, que sozinho custa quase um segundo.)
 */
export async function cheeredByOf(pool: Pool, viewerId: string, rows: Record<string, any>[]): Promise<Map<string, CheeredBy | null>> {
  const out = new Map<string, CheeredBy | null>();
  const ids: string[] = [];
  const counts: number[] = [];
  for (const r of rows) {
    const id = r.id as string;
    if (out.has(id)) continue;
    const total = Number(r.cheers ?? 0);
    if (r.cheers_list !== true) out.set(id, null);
    else {
      out.set(id, { users: [], total });
      if (total > 0) {
        ids.push(id);
        counts.push(total);
      }
    }
  }
  if (!ids.length) return out;
  const n = CHEERED_BY_MAX;
  // Os brindes mais recentes da publicação (até CHEERED_BY_SCAN) e, deles, quem está na lista.
  const recentIn = (rank: number, list: string, owner: string, member: string) => `
           (SELECT c.user_id AS who, ${rank} AS rank, c.created_at AS at
              FROM (SELECT c0.user_id, c0.created_at FROM content.cheers c0 WHERE c0.post_id = pid.id ORDER BY c0.created_at DESC LIMIT ${CHEERED_BY_SCAN}) c
              JOIN ${list} l ON l.${owner} = $1 AND l.${member} = c.user_id
              JOIN identity.users a ON a.id = c.user_id
             WHERE ${canView('a')} ORDER BY c.created_at DESC LIMIT ${n})`;
  const found: Record<string, any>[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { rows: part } = await pool.query(
      `SELECT pid.id AS post_id, a.username, a.display_name, (a.avatar_media_id IS NOT NULL) AS has_avatar, a.verified, a.verified_tier,
              EXISTS (SELECT 1 FROM social.close_friends cf WHERE cf.owner_id = $1 AND cf.friend_id = a.id) AS close,
              EXISTS (SELECT 1 FROM social.follows fo WHERE fo.follower_id = $1 AND fo.followee_id = a.id) AS following
         FROM unnest($2::uuid[], $3::int[]) WITH ORDINALITY AS pid(id, cheers, n)
         CROSS JOIN LATERAL (
           SELECT s.who, min(s.rank) AS rank, max(s.at) AS at FROM (
             ${recentIn(0, 'social.close_friends', 'owner_id', 'friend_id')}
             UNION ALL
             (SELECT x.who, 0, x.at
                FROM (SELECT cl.friend_id FROM social.close_friends cl WHERE cl.owner_id = $1 LIMIT ${CHEERED_BY_CLOSE_LIST}) l
                CROSS JOIN LATERAL (
                  SELECT c.user_id AS who, c.created_at AS at FROM content.cheers c JOIN identity.users a ON a.id = c.user_id
                   WHERE c.post_id = pid.id AND c.user_id = l.friend_id AND ${canView('a')} OFFSET 0
                ) x
               WHERE pid.cheers > ${CHEERED_BY_SCAN} ORDER BY x.at DESC LIMIT ${n})
             UNION ALL
             ${recentIn(1, 'social.follows', 'follower_id', 'followee_id')}
             UNION ALL
             (SELECT c.user_id, 2, c.created_at
                FROM content.cheers c JOIN identity.users a ON a.id = c.user_id
               WHERE c.post_id = pid.id AND c.user_id <> $1 AND ${canView('a')} ORDER BY c.created_at DESC LIMIT ${n})
           ) s GROUP BY s.who ORDER BY min(s.rank), max(s.at) DESC LIMIT ${n}
         ) k
         JOIN identity.users a ON a.id = k.who
        ORDER BY pid.n, k.rank, k.at DESC`,
      [viewerId, ids.slice(i, i + CHUNK), counts.slice(i, i + CHUNK)],
    );
    found.push(...part);
  }
  for (const f of found) {
    out.get(f.post_id as string)!.users.push({
      username: f.username as string,
      displayName: f.display_name as string,
      avatarUrl: f.has_avatar ? `/api/v1/avatars/${encodeURIComponent(f.username as string)}` : null,
      ...badge(f.verified, f.verified_tier),
      close: f.close === true,
      following: f.following === true,
    });
  }
  return out;
}
