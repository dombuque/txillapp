import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';

/** Os dados da própria pessoa, num ficheiro JSON legível (portabilidade). Nunca inclui senhas nem dados de terceiros além do @. */
@Injectable()
export class ExportService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async build(userId: string) {
    const q = async (sql: string) => (await this.pool.query(sql, [userId])).rows;
    const [profile] = await q(
      `SELECT username, display_name AS "displayName", email, bio, gender, show_gender AS "showGender", birth_date AS "birthDate", is_private AS "isPrivate",
              created_at AS "joinedAt", terms_version AS "termsVersion", terms_accepted_at AS "termsAcceptedAt"
         FROM identity.users WHERE id = $1`,
    );
    const settings = (
      await q(
        `SELECT comments_allowed AS "commentsAllowed", gifts_allowed AS "giftsAllowed", mentions_allowed AS "mentionsAllowed", dms_allowed AS "dmsAllowed", calls_allowed AS "callsAllowed",
                reposts_visible AS "repostsVisible", cheers_visible AS "cheersVisible", gifts_visible AS "giftsVisible",
                show_connections AS "showConnections", suggestable, story_replies AS "storyReplies"
           FROM identity.users WHERE id = $1`,
      )
    )[0];
    return {
      exportedAt: new Date().toISOString(),
      note: 'Estes são os teus dados no Txillapp. Não inclui senhas.',
      profile,
      settings,
      posts: await q(
        `SELECT p.id, p.kind, p.body, p.location_label AS "locationLabel", p.music, (SELECT v.slug FROM content.venues v WHERE v.id = p.venue_id) AS "postedAsVenue", p.created_at AS "createdAt", p.removed_at AS "removedAt",
                (SELECT COALESCE(json_agg('/api/v1/media/' || pm.media_id ORDER BY pm.position), '[]'::json) FROM content.post_media pm WHERE pm.post_id = p.id) AS photos
           FROM content.posts p WHERE p.author_id = $1 ORDER BY p.id`,
      ),
      comments: await q(`SELECT c.id, c.post_id AS "postId", c.body, c.created_at AS "createdAt" FROM content.comments c WHERE c.author_id = $1 ORDER BY c.id`),
      stories: await q(`SELECT s.id, s.caption, s.audience, s.music, s.stickers, s.created_at AS "createdAt", s.expires_at AS "expiresAt" FROM content.stories s WHERE s.author_id = $1 ORDER BY s.id`),
      storyComments: await q(`SELECT id, story_id AS "storyId", body, created_at AS "createdAt" FROM content.story_comments WHERE author_id = $1 ORDER BY id`),
      brindes: await q(`SELECT post_id AS "postId", created_at AS "createdAt" FROM content.cheers WHERE user_id = $1 ORDER BY created_at`),
      messagesSent: await q(
        `SELECT m.id, o.username AS "to", m.kind, m.body, m.created_at AS "createdAt"
           FROM social.messages m JOIN social.conversations c ON c.id = m.conversation_id
           JOIN identity.users o ON o.id = CASE WHEN c.user_a = $1 THEN c.user_b ELSE c.user_a END
          WHERE m.sender_id = $1 AND m.deleted_at IS NULL ORDER BY m.id`,
      ),
      following: (await q(`SELECT u.username FROM social.follows f JOIN identity.users u ON u.id = f.followee_id WHERE f.follower_id = $1 ORDER BY u.username`)).map((r) => r.username),
      followers: (await q(`SELECT u.username FROM social.follows f JOIN identity.users u ON u.id = f.follower_id WHERE f.followee_id = $1 ORDER BY u.username`)).map((r) => r.username),
      blocked: (await q(`SELECT u.username FROM social.blocks b JOIN identity.users u ON u.id = b.blocked_id WHERE b.blocker_id = $1 ORDER BY u.username`)).map((r) => r.username),
      closeFriends: (await q(`SELECT u.username FROM social.close_friends cf JOIN identity.users u ON u.id = cf.friend_id WHERE cf.owner_id = $1 ORDER BY u.username`)).map((r) => r.username),
      geleira: await q(
        `SELECT i.name, i.kind, i.category, ui.rating, ui.favorite, ui.visibility
           FROM taste.user_items ui JOIN taste.items i ON i.id = ui.item_id WHERE ui.user_id = $1 ORDER BY i.kind, i.name`,
      ),
      // Chamadas feitas e recebidas (só o registo: o som e a imagem nunca passam pelo servidor).
      calls: await q(
        `SELECT c.id, (c.caller_id = $1) AS outgoing, o.username AS "with", c.video, c.status, c.created_at AS "createdAt", c.started_at AS "startedAt", c.ended_at AS "endedAt"
           FROM social.calls c JOIN identity.users o ON o.id = CASE WHEN c.caller_id = $1 THEN c.callee_id ELSE c.caller_id END
          WHERE c.caller_id = $1 OR c.callee_id = $1 ORDER BY c.id`,
      ).catch(() => []),
      musicFavorites: await q(`SELECT track_id AS "trackId", track, created_at AS "createdAt" FROM content.music_favorites WHERE user_id = $1 ORDER BY created_at`).catch(() => []),
      // Locais: os que criei, os que giro (e o papel), os que sigo e os meus check-ins.
      venuesOwned: await q(`SELECT slug, name, kind, city, created_at AS "createdAt" FROM content.venues WHERE owner_id = $1 ORDER BY created_at`).catch(() => []),
      venuesManaged: await q(
        `SELECT v.slug, v.name, m.role, m.status, m.created_at AS "since" FROM content.venue_managers m JOIN content.venues v ON v.id = m.venue_id WHERE m.user_id = $1 ORDER BY m.created_at`,
      ).catch(() => []),
      venuesFollowed: await q(`SELECT v.slug, v.name, f.created_at AS "since" FROM content.venue_follows f JOIN content.venues v ON v.id = f.venue_id WHERE f.user_id = $1 ORDER BY f.created_at`).catch(() => []),
      checkins: await q(`SELECT v.slug, v.name, c.created_at AS "createdAt" FROM content.checkins c JOIN content.venues v ON v.id = c.venue_id WHERE c.user_id = $1 ORDER BY c.created_at`).catch(() => []),
      // Como afinei o algoritmo do Explorar e das Tchekas.
      feedSettings: (await q(`SELECT following, freshness, media, variety, hide_seen AS "hideSeen", calm FROM social.feed_settings WHERE user_id = $1`).catch(() => []))[0] ?? null,
      topicPrefs: await q(`SELECT topic, pref FROM social.explore_prefs WHERE user_id = $1 ORDER BY topic`).catch(() => []),
      peoplePrefs: await q(`SELECT u.username, e.pref FROM social.explore_people e JOIN identity.users u ON u.id = e.person_id WHERE e.user_id = $1 ORDER BY u.username`).catch(() => []),
      postFeedback: await q(`SELECT post_id AS "postId", value, created_at AS "createdAt" FROM content.post_feedback WHERE user_id = $1 ORDER BY created_at`).catch(() => []),
      paymentOrders: await q(
        `SELECT id, package_id AS "packageId", txills, amount_minor AS "amountMinor", currency, provider, status, phone_tail AS "phoneTail", created_at AS "createdAt", paid_at AS "paidAt"
           FROM payments.orders WHERE user_id = $1 ORDER BY created_at`,
      ).catch(() => []),
      // TxillGroups: as minhas respostas ao plano, votos, tarefas da lista, despesas que paguei ou em que tenho parte, e o que meti nos cofres.
      groupRsvps: await q(
        `SELECT g.name AS "group", r.status, r.updated_at AS "updatedAt" FROM social.group_rsvps r JOIN social.groups g ON g.id = r.group_id WHERE r.user_id = $1 ORDER BY r.updated_at`,
      ).catch(() => []),
      // Os meus pedidos para entrar em TxillGroups (ainda à espera de resposta).
      groupJoinRequests: await q(
        `SELECT g.name AS "group", jr.created_at AS "createdAt" FROM social.group_join_requests jr JOIN social.groups g ON g.id = jr.group_id WHERE jr.user_id = $1 ORDER BY jr.created_at`,
      ).catch(() => []),
      groupPollVotes: await q(
        `SELECT g.name AS "group", p.question, o.text AS "option", v.created_at AS "createdAt"
           FROM social.group_poll_votes v JOIN social.group_poll_options o ON o.id = v.option_id
           JOIN social.group_polls p ON p.id = v.poll_id JOIN social.groups g ON g.id = p.group_id
          WHERE v.user_id = $1 ORDER BY v.created_at`,
      ).catch(() => []),
      groupPollsCreated: await q(
        `SELECT g.name AS "group", p.question, p.multiple, p.created_at AS "createdAt", p.closed_at AS "closedAt"
           FROM social.group_polls p JOIN social.groups g ON g.id = p.group_id WHERE p.created_by = $1 ORDER BY p.created_at`,
      ).catch(() => []),
      groupChecklist: await q(
        `SELECT g.name AS "group", c.text, c.done, (c.created_by = $1) AS "createdByMe", (c.assignee_id = $1) AS "assignedToMe", c.created_at AS "createdAt"
           FROM social.group_checklist c JOIN social.groups g ON g.id = c.group_id
          WHERE c.created_by = $1 OR c.assignee_id = $1 ORDER BY c.created_at`,
      ).catch(() => []),
      // Despesas em meticais (valores em cêntimos, como na base de dados).
      groupExpenses: await q(
        `SELECT g.name AS "group", e.description, e.amount_cents AS "amountCents", (e.paid_by = $1) AS "paidByMe",
                (SELECT s.share_cents FROM social.group_expense_shares s WHERE s.expense_id = e.id AND s.user_id = $1) AS "myShareCents", e.created_at AS "createdAt"
           FROM social.group_expenses e JOIN social.groups g ON g.id = e.group_id
          WHERE e.paid_by = $1 OR e.created_by = $1 OR EXISTS (SELECT 1 FROM social.group_expense_shares s WHERE s.expense_id = e.id AND s.user_id = $1)
          ORDER BY e.created_at`,
      ).catch(() => []),
      potContributions: await q(
        `SELECT t.metadata->>'groupName' AS "group", (t.metadata->>'amount')::bigint AS amount, t.created_at AS "createdAt"
           FROM ledger.transactions t WHERE t.type = 'group_contribution' AND t.actor_id = $1 ORDER BY t.created_at`,
      ).catch(() => []),
      // À tua volta: quem me pode ver no mapa, a última quadrícula guardada (nunca a posição exata) e os eventos em que marquei interesse.
      nearbySettings: (await q(`SELECT visibility, updated_at AS "updatedAt" FROM nearby.settings WHERE user_id = $1`).catch(() => []))[0] ?? null,
      nearbyPresence: (await q(`SELECT cell_lat AS "cellLat", cell_lng AS "cellLng", updated_at AS "updatedAt" FROM nearby.presence WHERE user_id = $1`).catch(() => []))[0] ?? null,
      eventInterest: await q(
        `SELECT v.slug AS venue, e.title, e.starts_at AS "startsAt", i.created_at AS "createdAt"
           FROM content.venue_event_interest i JOIN content.venue_events e ON e.id = i.event_id JOIN content.venues v ON v.id = e.venue_id
          WHERE i.user_id = $1 ORDER BY i.created_at`,
      ).catch(() => []),
      reportsFiled: await q(`SELECT target_type AS "type", reason, status, created_at AS "createdAt" FROM social.reports WHERE reporter_id = $1 ORDER BY created_at`),
      wallet: await q(
        `SELECT t.id, t.created_at AS "createdAt", t.type, e.amount
           FROM ledger.entries e JOIN ledger.accounts a ON a.id = e.account_id JOIN ledger.transactions t ON t.id = e.transaction_id
          WHERE a.user_id = $1 ORDER BY t.created_at`,
      ).catch(() => []),
    };
  }
}
