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
        `SELECT comments_allowed AS "commentsAllowed", gifts_allowed AS "giftsAllowed", mentions_allowed AS "mentionsAllowed", dms_allowed AS "dmsAllowed",
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
        `SELECT p.id, p.kind, p.body, p.location_label AS "locationLabel", p.created_at AS "createdAt", p.removed_at AS "removedAt",
                (SELECT COALESCE(json_agg('/api/v1/media/' || pm.media_id ORDER BY pm.position), '[]'::json) FROM content.post_media pm WHERE pm.post_id = p.id) AS photos
           FROM content.posts p WHERE p.author_id = $1 ORDER BY p.id`,
      ),
      comments: await q(`SELECT c.id, c.post_id AS "postId", c.body, c.created_at AS "createdAt" FROM content.comments c WHERE c.author_id = $1 ORDER BY c.id`),
      stories: await q(`SELECT s.id, s.caption, s.audience, s.created_at AS "createdAt", s.expires_at AS "expiresAt" FROM content.stories s WHERE s.author_id = $1 ORDER BY s.id`),
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
      reportsFiled: await q(`SELECT target_type AS "type", reason, status, created_at AS "createdAt" FROM social.reports WHERE reporter_id = $1 ORDER BY created_at`),
      wallet: await q(
        `SELECT t.id, t.created_at AS "createdAt", t.type, e.amount
           FROM ledger.entries e JOIN ledger.accounts a ON a.id = e.account_id JOIN ledger.transactions t ON t.id = e.transaction_id
          WHERE a.user_id = $1 ORDER BY t.created_at`,
      ).catch(() => []),
    };
  }
}
