import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { mentionableBy } from '../notifications/notifications.service';
import { blockedBetween, canView, inMyNetwork } from './visibility';
import { badge, type VerifiedTier } from '../common/badge';
import { RealtimeBus } from '../realtime/realtime-bus';
import { txilladaBanned, txilladaTicket, txilladaVisible } from '../txillada/txillada-visibility';
import { TX_WATCH_MS, txWatchKey, watchIds } from '../txillada/txillada-watch';

export type MentionContext = 'post' | 'group' | 'story' | 'zas' | 'chat' | 'txillada';
export type MentionReason = 'conversa' | 'segues-te' | 'segue-te' | 'amigo-proximo' | 'neste-post' | 'no-grupo'
  // Contexto 'txillada' (txillada-voltar): o anfitrião, quem está a transmitir, quem está a ver, quem comentou lá.
  | 'anfitriao' | 'a-transmitir' | 'a-ver' | 'comentou';

export interface MentionSuggestion {
  username: string;
  displayName: string;
  hasAvatar: boolean;
  verified?: boolean;
  verifiedTier?: VerifiedTier | null;
  reason?: MentionReason;
  /** Só no contexto 'txillada': já lá está (o anfitrião, a transmitir, ou a ver quando isso se pode mostrar). */
  inTxillada?: boolean;
  /** Só no contexto 'txillada': não está lá e podia entrar se a convidassem (a menção num comentário vira convite). */
  invitable?: boolean;
}

const LIMIT = 8;

/**
 * A razão que se mostra (discreta) por baixo do nome. A consulta guarda, por pessoa, o menor "rank" das parcelas que
 * somou: o contexto ganha a tudo, depois a conversa, os amigos próximos e por fim o seguir.
 * Seguir só num sentido (eu sigo) não tem razão: é o caso normal e não diz nada.
 */
const REASONS: Record<number, MentionReason> = {
  // A Txillada (ranks negativos: ganham a tudo, e o anfitrião ganha a quem transmite, que ganha a quem vê e a quem comentou).
  [-4]: 'anfitriao', [-3]: 'a-transmitir', [-2]: 'a-ver', [-1]: 'comentou',
  1: 'neste-post', 2: 'no-grupo', 3: 'conversa', 4: 'amigo-proximo', 5: 'segues-te', 6: 'segue-te',
};

/** "João", "joão", "JOAO" → "joao" (o mesmo que content.f_unaccent + lower no PostgreSQL, para os casos comuns). */
export const foldTerm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const escapeLike = (s: string) => s.replace(/[\\%_]/g, '\\$&');

/** O nome em palavras simples, para procurar pelo início de qualquer palavra: "Sára Mª-Lopes" → " sara m lopes". */
const NAME_WORDS = `(' ' || regexp_replace(lower(content.f_unaccent(u.display_name)), '[^a-z0-9]+', ' ', 'g'))`;

/**
 * Sugestões de @menções enquanto se escreve: primeiro as pessoas com quem mais se interage, depois a pesquisa geral.
 *
 * Pontuação de proximidade (soma das parcelas; tudo limitado para uma só coisa não mandar sozinha):
 *   - conversa a dois, com mensagens nos DOIS sentidos nos últimos 90 dias (só as últimas 200 de cada conversa e as
 *     50 conversas mais recentes): 30 + até 25 pela frequência (1 ponto por cada 4 mensagens) + até 25 pela frescura
 *     (25 hoje, metade a cada ~10 dias). Vai de 30 a 80: uma conversa viva ganha sempre a um simples "segue-me" (8).
 *   - amigos próximos (a MINHA lista): 35. Não se usa o facto de a outra pessoa me ter na lista dela: essa lista é
 *     privada e subir quem me lá tem seria uma forma de a revelar.
 *   - seguir: mútuo 25; só eu sigo 15; só me segue 8.
 *   - nos últimos 90 dias, os meus brindes (2) e comentários (3) nas publicações dela, até 20; os dela nas minhas
 *     (1 e 2), até 12. Conta mais o que eu faço: diz mais sobre quem eu quero mencionar.
 *   - identificados juntos (eu identifiquei, identificou-me, ou os dois na mesma foto) e menções entre nós no último
 *     ano: 4 cada, até 15.
 *   - os perfis que EU visitei nos últimos 30 dias: 2 por dia, até 10. As visitas que fizeram ao meu perfil não
 *     entram: nunca se mostra quem visitou, e pô-las no topo das sugestões mostrava-o.
 * Contexto (o que se está a escrever):
 *   - publicação: o autor +100 e quem lá comentou (últimos 500 comentários) +60, com a razão "neste post";
 *   - grupo: SÓ membros (os outros nem entram), 40 a cada um e +4 por cada mensagem recente no grupo (das últimas 500),
 *     até +120: os mais ativos lá vêm primeiro e a proximidade desempata;
 *   - mimo (story) ou Zás: o autor +60; conversa: a outra pessoa +60.
 *   - Txillada (só se a posso ver e lá entrar): o anfitrião +100, quem transmite +90, quem está a ver +50 (numa paga só
 *     para o anfitrião: para os outros é segredo), quem lá comentou (últimos 300) +40; cada pessoa leva `inTxillada` e
 *     `invitable` (a menção num comentário vira convite).
 *
 * Ordem de grandeza: por pedido lê no máximo 50 conversas × 200 mensagens, 1000 seguidos e 1000 seguidores, e o que
 * eu fiz nos últimos 90 dias (com os índices da migração 0112). Hoje as tabelas são pequenas; isto aguenta milhares.
 */
@Injectable()
export class MentionSuggestService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool, private readonly bus: RealtimeBus) {}

  async suggest(me: string, rawQ: string, context?: MentionContext, id?: string): Promise<{ items: MentionSuggestion[] }> {
    const folded = foldTerm(rawQ.replace(/^@/, '').trim()).slice(0, 30);
    const term = escapeLike(folded);

    // O contexto só conta se eu tiver acesso a ele (senão seria uma forma de saber de quem é uma publicação/um mimo).
    let postId: string | null = null;
    let groupId: string | null = null;
    let boost: { uid: string; s: number; r: number | null } | null = null;
    let tx: { id: string; hostId: string; guests: string[]; watchers: string[] } | null = null;
    if (context && id) {
      if (context === 'post') {
        const r = await this.pool.query(
          `SELECT p.author_id FROM content.posts p JOIN identity.users u ON u.id = p.author_id WHERE p.id = $2 AND p.removed_at IS NULL AND p.hidden_at IS NULL AND ${canView('u', '$1')}`,
          [me, id],
        );
        if (r.rows[0]) {
          postId = id;
          boost = { uid: r.rows[0].author_id, s: 100, r: 1 };
        }
      } else if (context === 'group') {
        const r = await this.pool.query('SELECT 1 FROM social.group_members WHERE group_id = $1 AND user_id = $2', [id, me]);
        if (!r.rowCount) return { items: [] }; // não sou do grupo: não digo quem é
        groupId = id;
      } else if (context === 'story' || context === 'zas') {
        const table = context === 'story' ? 'content.stories' : 'social.instants';
        const r = await this.pool.query(`SELECT x.author_id FROM ${table} x JOIN identity.users u ON u.id = x.author_id WHERE x.id = $2 AND ${canView('u', '$1')}`, [me, id]);
        if (r.rows[0]) boost = { uid: r.rows[0].author_id, s: 60, r: null };
      } else if (context === 'chat') {
        const r = await this.pool.query(
          'SELECT CASE WHEN user_a = $1 THEN user_b ELSE user_a END AS uid FROM social.conversations WHERE id = $2 AND (user_a = $1 OR user_b = $1)',
          [me, id],
        );
        if (r.rows[0]) boost = { uid: r.rows[0].uid, s: 60, r: 3 };
      } else if (context === 'txillada') {
        // Só se a posso ver e lá entrar (como o GET /txilladas/:id/comments); senão é como sem contexto.
        const r = await this.pool.query(
          `SELECT t.host_id, t.audience,
                  ARRAY(SELECT g.user_id FROM content.txillada_guests g WHERE g.txillada_id = t.id AND g.status = 'accepted') AS guests
             FROM content.txilladas t JOIN identity.users h ON h.id = t.host_id
            WHERE t.id = $2 AND ${txilladaVisible('t', 'h', '$1')} AND NOT ${txilladaBanned('t', '$1')} AND ${txilladaTicket('t', '$1')}`,
          [me, id],
        );
        const t = r.rows[0];
        if (t) {
          const hostId = t.host_id as string;
          const guests = (t.guests as string[]).filter((g) => g !== hostId);
          // Numa privada (paga), quem está a ver é segredo para todos menos o anfitrião: nem sobe nem se diz.
          const reveal = t.audience !== 'paid' || hostId === me;
          const watchers = reveal ? watchIds(await this.bus.recent(txWatchKey(id), TX_WATCH_MS)).filter((w) => w !== hostId && !guests.includes(w)) : [];
          tx = { id, hostId, guests, watchers };
          boost = { uid: hostId, s: 100, r: -4 };
        }
      }
    }

    const { rows } = await this.pool.query(
      `WITH
       conv AS (
         SELECT c.id, CASE WHEN c.user_a = $1 THEN c.user_b ELSE c.user_a END AS uid
           FROM social.conversations c
          WHERE (c.user_a = $1 OR c.user_b = $1) AND c.last_message_at > now() - interval '90 days'
          ORDER BY c.last_message_at DESC LIMIT 50),
       talk AS (
         SELECT conv.uid, count(*) AS n, max(m.created_at) AS last
           FROM conv CROSS JOIN LATERAL (
                  SELECT m.sender_id, m.created_at FROM social.messages m WHERE m.conversation_id = conv.id ORDER BY m.id DESC LIMIT 200) m
          WHERE m.created_at > now() - interval '90 days'
          GROUP BY conv.uid
         HAVING bool_or(m.sender_id = $1) AND bool_or(m.sender_id <> $1)),
       fo AS (SELECT followee_id AS uid FROM social.follows WHERE follower_id = $1 ORDER BY created_at DESC LIMIT 1000),
       fi AS (SELECT follower_id AS uid FROM social.follows WHERE followee_id = $1 ORDER BY created_at DESC LIMIT 1000),
       mine AS (SELECT id FROM content.posts WHERE author_id = $1 AND created_at > now() - interval '180 days' ORDER BY id DESC LIMIT 300),
       given AS (
         SELECT p.author_id AS uid, 2 * count(*) AS s FROM content.cheers c JOIN content.posts p ON p.id = c.post_id
          WHERE c.user_id = $1 AND c.created_at > now() - interval '90 days' AND p.author_id <> $1 GROUP BY 1
         UNION ALL
         SELECT p.author_id, 3 * count(*) FROM content.comments c JOIN content.posts p ON p.id = c.post_id
          WHERE c.author_id = $1 AND c.created_at > now() - interval '90 days' AND p.author_id <> $1 GROUP BY 1),
       got AS (
         SELECT c.user_id AS uid, count(*) AS s FROM mine JOIN content.cheers c ON c.post_id = mine.id
          WHERE c.created_at > now() - interval '90 days' AND c.user_id <> $1 GROUP BY 1
         UNION ALL
         SELECT c.author_id, 2 * count(*) FROM mine JOIN content.comments c ON c.post_id = mine.id
          WHERE c.created_at > now() - interval '90 days' AND c.author_id <> $1 GROUP BY 1),
       tie AS (
         SELECT t.tagged_id AS uid FROM mine JOIN content.photo_tags t ON t.post_id = mine.id
         UNION ALL
         SELECT p.author_id FROM content.photo_tags t JOIN content.posts p ON p.id = t.post_id WHERE t.tagged_id = $1 AND t.created_at > now() - interval '1 year'
         UNION ALL
         SELECT o.tagged_id FROM content.photo_tags t JOIN content.photo_tags o ON o.post_id = t.post_id AND o.tagged_id <> t.tagged_id
          WHERE t.tagged_id = $1 AND t.created_at > now() - interval '1 year'
         UNION ALL
         SELECT n.user_id FROM social.notifications n WHERE n.actor_id = $1 AND n.kind IN ('mention', 'tag') AND n.created_at > now() - interval '1 year'
         UNION ALL
         SELECT x.actor_id FROM (SELECT actor_id, kind, created_at FROM social.notifications WHERE user_id = $1 ORDER BY id DESC LIMIT 2000) x
          WHERE x.kind IN ('mention', 'tag') AND x.created_at > now() - interval '1 year'),
       ctx AS (
         SELECT $5::uuid AS uid, $6::float8 AS s, $7::int AS r WHERE $5::uuid IS NOT NULL
         UNION ALL
         SELECT c.author_id, 60, 1 FROM (SELECT author_id FROM content.comments WHERE post_id = $3::uuid ORDER BY id DESC LIMIT 500) c GROUP BY c.author_id
         UNION ALL
         SELECT gm.user_id, 40 + least(120, 4 * coalesce(a.n, 0)), 2
           FROM social.group_members gm
           LEFT JOIN (SELECT sender_id, count(*) AS n FROM (SELECT sender_id FROM social.messages WHERE group_id = $4::uuid ORDER BY id DESC LIMIT 500) x GROUP BY sender_id) a
             ON a.sender_id = gm.user_id
          WHERE gm.group_id = $4::uuid
         UNION ALL
         -- A Txillada: quem transmite +90, quem está a ver +50 (só quando se pode mostrar), quem lá comentou +40 (dos últimos
         -- 300 comentários; o anfitrião e quem transmite já sobem).
         SELECT g, 90, -3 FROM unnest($9::uuid[]) g
         UNION ALL
         SELECT w, 50, -2 FROM unnest($10::uuid[]) w
         UNION ALL
         SELECT c.author_id, 40, -1
           FROM (SELECT author_id FROM content.txillada_comments WHERE txillada_id = $8::uuid AND removed_at IS NULL ORDER BY id DESC LIMIT 300) c
          WHERE c.author_id <> $5::uuid AND c.author_id <> ALL($9::uuid[])
          GROUP BY c.author_id),
       pts AS (
         SELECT uid, s::float8 AS s, r::int AS r FROM ctx
         UNION ALL
         SELECT uid, 30 + least(25, n / 4.0) + 25 * exp(-extract(epoch FROM now() - last) / 86400.0 / 14), 3 FROM talk
         UNION ALL
         SELECT coalesce(fo.uid, fi.uid),
                CASE WHEN fo.uid IS NOT NULL AND fi.uid IS NOT NULL THEN 25 WHEN fo.uid IS NOT NULL THEN 15 ELSE 8 END,
                CASE WHEN fo.uid IS NOT NULL AND fi.uid IS NOT NULL THEN 5 WHEN fo.uid IS NULL THEN 6 END
           FROM fo FULL JOIN fi ON fi.uid = fo.uid
         UNION ALL
         SELECT friend_id, 35, 4 FROM social.close_friends WHERE owner_id = $1
         UNION ALL
         SELECT uid, least(20, sum(s)), NULL FROM given GROUP BY uid
         UNION ALL
         SELECT uid, least(12, sum(s)), NULL FROM got GROUP BY uid
         UNION ALL
         SELECT uid, least(15, 4 * count(*)), NULL FROM tie GROUP BY uid
         UNION ALL
         SELECT profile_id, least(10, 2 * count(*)), NULL FROM social.profile_views
          WHERE viewer_id = $1 AND day > current_date - 30 GROUP BY profile_id),
       score AS (SELECT uid, sum(s) AS s, min(r) AS r FROM pts WHERE uid <> $1 GROUP BY uid)
       SELECT u.id, u.username, u.display_name, u.verified, u.verified_tier, (u.avatar_media_id IS NOT NULL) AS has_avatar, sc.r
         FROM score sc JOIN identity.users u ON u.id = sc.uid
        WHERE ${mentionableBy('u', '$1')}
          AND ($4::uuid IS NULL OR EXISTS (SELECT 1 FROM social.group_members gm WHERE gm.group_id = $4::uuid AND gm.user_id = u.id))
          AND ($2 = '' OR lower(u.username::text) LIKE $2 || '%' ESCAPE '\\' OR ${NAME_WORDS} LIKE '% ' || $2 || '%' ESCAPE '\\')
        ORDER BY sc.s DESC, u.username ASC
        LIMIT ${LIMIT}`,
      [me, term, postId, groupId, boost?.uid ?? null, boost?.s ?? null, boost?.r ?? null, tx?.id ?? null, tx?.guests ?? [], tx?.watchers ?? []],
    );

    const ids: string[] = rows.map((r) => r.id);
    const items: MentionSuggestion[] = rows.map((r) => ({
      username: r.username,
      displayName: r.display_name,
      hasAvatar: r.has_avatar,
      ...badge(r.verified, r.verified_tier),
      ...(r.r != null && REASONS[r.r] ? { reason: REASONS[r.r] } : {}),
    }));

    // Pouca proximidade para o que se escreveu: completa com a pesquisa geral de pessoas (a mesma rede e as mesmas
    // regras do /search/suggest), sem repetir ninguém. Num grupo não: lá só se mencionam membros.
    if (folded && !groupId && items.length < LIMIT) {
      const more = await this.pool.query(
        `SELECT u.id, u.username, u.display_name, u.verified, u.verified_tier, (u.avatar_media_id IS NOT NULL) AS has_avatar,
                EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = $1 AND f.followee_id = u.id) AS following,
                greatest(similarity(lower(u.username::text), $3), similarity(lower(content.f_unaccent(u.display_name)), $3)) AS sim
           FROM identity.users u
          WHERE ${mentionableBy('u', '$1')} AND ${inMyNetwork('u.id', 'u.country')} AND u.id <> ALL($5::uuid[])
            AND (lower(u.username::text) LIKE '%' || $2 || '%' ESCAPE '\\' OR lower(content.f_unaccent(u.display_name)) LIKE '%' || $2 || '%' ESCAPE '\\'
                 OR (length($3) >= 4 AND (similarity(lower(u.username::text), $3) > 0.55 OR similarity(lower(content.f_unaccent(u.display_name)), $3) > 0.45)))
          ORDER BY (lower(u.username::text) = $3) DESC, (lower(u.username::text) LIKE $2 || '%' ESCAPE '\\' OR ${NAME_WORDS} LIKE '% ' || $2 || '%' ESCAPE '\\') DESC,
                   following DESC, sim DESC, (SELECT count(*) FROM social.follows f WHERE f.followee_id = u.id) DESC, u.username ASC
          LIMIT $4`,
        [me, term, folded, LIMIT - items.length, ids],
      );
      for (const r of more.rows) {
        ids.push(r.id);
        items.push({ username: r.username, displayName: r.display_name, hasAvatar: r.has_avatar, ...badge(r.verified, r.verified_tier) });
      }
    }
    if (tx && items.length) await this.txFlags(tx, ids, items);
    return { items };
  }

  /**
   * Contexto 'txillada': `inTxillada` (o anfitrião, quem transmite e quem está a ver, este só quando se pode mostrar) e
   * `invitable` (não está lá e podia entrar se a convidassem: conta ativa, vê a Txillada, não foi expulso, sem bloqueio com o
   * anfitrião). Os bloqueios comigo já os tira o mentionableBy.
   */
  private async txFlags(tx: { id: string; hostId: string; guests: string[]; watchers: string[] }, ids: string[], items: MentionSuggestion[]) {
    const inside = new Set([tx.hostId, ...tx.guests, ...tx.watchers]);
    const out = ids.filter((u) => !inside.has(u));
    const can = new Set<string>();
    if (out.length) {
      const { rows } = await this.pool.query(
        `SELECT u.id FROM identity.users u, content.txilladas t JOIN identity.users h ON h.id = t.host_id
          WHERE t.id = $1 AND u.id = ANY($2::uuid[]) AND u.status = 'active'
            AND ${txilladaVisible('t', 'h', 'u.id')} AND NOT ${txilladaBanned('t', 'u.id')} AND NOT ${blockedBetween('u.id', 'h.id')}`,
        [tx.id, out],
      );
      for (const r of rows) can.add(r.id as string);
    }
    items.forEach((it, i) => {
      it.inTxillada = inside.has(ids[i]);
      it.invitable = !it.inTxillada && can.has(ids[i]);
    });
  }
}
