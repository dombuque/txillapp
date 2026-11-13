import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { referencedAmong } from '../media/media-refs';
import { MediaService } from '../media/media.service';
import { UNUSED_MEDIA_HOURS } from '../media/unused-media.service';

/** Os dados da própria pessoa, num ficheiro JSON legível (portabilidade). Nunca inclui senhas nem dados de terceiros além do @. */
@Injectable()
export class ExportService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly media: MediaService,
  ) {}

  /**
   * «Envios por publicar»: os ficheiros que enviei e que ainda não estão em uso em lado nenhum (media-refs.ts), como os
   * clipes e o vídeo de uma montagem que não publiquei ou a foto de uma publicação que não chegou a sair. Apagam-se
   * sozinhos UNUSED_MEDIA_HOURS depois do envio (UnusedMediaService); até lá, vão aqui com um endereço para os descarregar
   * (as fotos e os vídeos públicos pelo endereço normal, os do chat por um endereço assinado e temporário).
   */
  async pendingUploads(userId: string) {
    const { rows } = await this.pool.query(
      `SELECT id, mime, purpose, status, size_bytes, duration_ms, created_at FROM content.media_assets
        WHERE owner_id = $1 AND status <> 'deleted' ORDER BY created_at`,
      [userId],
    );
    const used = new Set<string>();
    for (let i = 0; i < rows.length; i += 1000) for (const id of await referencedAmong(this.pool, rows.slice(i, i + 1000).map((r) => r.id as string))) used.add(id);
    return rows
      .filter((r) => !used.has(r.id as string))
      .map((r) => {
        const mime = r.mime as string;
        const ready = r.status === 'ready';
        const url = !ready ? null : r.purpose === 'public' ? `/api/v1/media/${r.id as string}` : r.purpose === 'chat' ? this.media.chatUrl(r.id as string) : null;
        return {
          id: r.id as string,
          kind: mime.startsWith('image/') ? 'photo' : mime.startsWith('video/') ? 'video' : 'audio',
          mime,
          status: r.status as string,
          sizeBytes: Number(r.size_bytes),
          durationMs: (r.duration_ms as number | null) ?? null,
          uploadedAt: new Date(r.created_at as string).toISOString(),
          deletedAfter: new Date(new Date(r.created_at as string).getTime() + UNUSED_MEDIA_HOURS * 3_600_000).toISOString(),
          url,
        };
      });
  }

  async build(userId: string) {
    const q = async (sql: string) => (await this.pool.query(sql, [userId])).rows;
    const [profile] = await q(
      `SELECT username, display_name AS "displayName", email, bio, city, website, gender, show_gender AS "showGender", birth_date AS "birthDate", is_private AS "isPrivate",
              country, created_at AS "joinedAt", terms_version AS "termsVersion", terms_accepted_at AS "termsAcceptedAt"
         FROM identity.users WHERE id = $1`,
    );
    const settings = (
      await q(
        `SELECT comments_allowed AS "commentsAllowed", gifts_allowed AS "giftsAllowed", mentions_allowed AS "mentionsAllowed", dms_allowed AS "dmsAllowed", calls_allowed AS "callsAllowed",
                reposts_visible AS "repostsVisible", cheers_visible AS "cheersVisible", gifts_visible AS "giftsVisible",
                show_connections AS "showConnections", suggestable, story_replies AS "storyReplies", remix_allowed AS "remixAllowed",
                geleira_visibility AS "geleiraVisibility", geleira_cheers_public AS "geleiraCheersPublic", gelada_book_public AS "geladaBookPublic"
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
                (SELECT COALESCE(json_agg('/api/v1/media/' || pm.media_id ORDER BY pm.position), '[]'::json) FROM content.post_media pm WHERE pm.post_id = p.id) AS photos,
                (SELECT json_build_object('postId', rx.original_id, 'kind', rx.kind, 'commentId', rx.comment_id) FROM content.post_remixes rx WHERE rx.post_id = p.id) AS "remixOf"
           FROM content.posts p WHERE p.author_id = $1 ORDER BY p.id`,
      ),
      comments: await q(`SELECT c.id, c.post_id AS "postId", c.body, c.gif, c.created_at AS "createdAt" FROM content.comments c WHERE c.author_id = $1 ORDER BY c.id`),
      stories: await q(`SELECT s.id, s.caption, s.audience, s.music, s.stickers, s.created_at AS "createdAt", s.expires_at AS "expiresAt" FROM content.stories s WHERE s.author_id = $1 ORDER BY s.id`),
      storyComments: await q(`SELECT id, story_id AS "storyId", body, created_at AS "createdAt" FROM content.story_comments WHERE author_id = $1 ORDER BY id`),
      brindes: await q(`SELECT post_id AS "postId", created_at AS "createdAt" FROM content.cheers WHERE user_id = $1 ORDER BY created_at`),
      commentCheers: await q(`SELECT comment_id AS "commentId", created_at AS "createdAt" FROM content.comment_cheers WHERE user_id = $1 ORDER BY created_at`).catch(() => []),
      // As mensagens que enviei, nas conversas a dois (`to` = o @ da outra pessoa) e nos TxillGroups (`group` = o nome do grupo),
      // com a hora da edição, o ponto, o nome e a morada do sítio e até quando durava a partilha em direto (o que está guardado).
      // Mensagens temporárias: `expiresAt` diz até quando existem; as que já expiraram não entram.
      // As que recebi não entram: são dados de quem as escreveu.
      messagesSent: await q(
        `SELECT m.id, o.username AS "to", g.name AS "group", m.kind, m.body, m.created_at AS "createdAt", m.edited_at AS "editedAt",
                m.lat, m.lng, m.place_name AS "placeName", m.place_address AS "placeAddress", m.live_until AS "liveUntil", m.gif, m.expires_at AS "expiresAt"
           FROM social.messages m
           LEFT JOIN social.conversations c ON c.id = m.conversation_id
           LEFT JOIN identity.users o ON o.id = CASE WHEN c.user_a = $1 THEN c.user_b ELSE c.user_a END
           LEFT JOIN social.groups g ON g.id = m.group_id
          WHERE m.sender_id = $1 AND m.deleted_at IS NULL AND (m.expires_at IS NULL OR m.expires_at > now()) ORDER BY m.id`,
      ),
      // "Apagar para mim": que mensagens escondi e quando (só o id: o conteúdo das dos outros não é meu).
      messagesHiddenForMe: await q(`SELECT message_id AS id, created_at AS "hiddenAt" FROM social.message_hidden WHERE user_id = $1 ORDER BY created_at`),
      following: (await q(`SELECT u.username FROM social.follows f JOIN identity.users u ON u.id = f.followee_id WHERE f.follower_id = $1 ORDER BY u.username`)).map((r) => r.username),
      followers: (await q(`SELECT u.username FROM social.follows f JOIN identity.users u ON u.id = f.follower_id WHERE f.followee_id = $1 ORDER BY u.username`)).map((r) => r.username),
      blocked: (await q(`SELECT u.username FROM social.blocks b JOIN identity.users u ON u.id = b.blocked_id WHERE b.blocker_id = $1 ORDER BY u.username`)).map((r) => r.username),
      closeFriends: (await q(`SELECT u.username FROM social.close_friends cf JOIN identity.users u ON u.id = cf.friend_id WHERE cf.owner_id = $1 ORDER BY u.username`)).map((r) => r.username),
      geleira: await q(
        `SELECT i.name, i.kind, i.category, ui.rating, ui.favorite, ui.visibility
           FROM taste.user_items ui JOIN taste.items i ON i.id = ui.item_id WHERE ui.user_id = $1 ORDER BY i.kind, i.name`,
      ),
      // Brindes à geleira: os que dei (a quem) e os que recebi (de quem).
      geleiraCheersGiven: await q(
        `SELECT o.username AS "to", c.source_post_id AS "fromPostId", c.created_at AS "createdAt" FROM taste.geleira_cheers c JOIN identity.users o ON o.id = c.owner_id WHERE c.user_id = $1 ORDER BY c.created_at`,
      ).catch(() => []),
      geleiraCheersReceived: await q(
        `SELECT u.username AS "from", c.source_post_id AS "fromPostId", c.created_at AS "createdAt" FROM taste.geleira_cheers c JOIN identity.users u ON u.id = c.user_id WHERE c.owner_id = $1 ORDER BY c.created_at`,
      ).catch(() => []),
      // As partilhas da geleira (0143): cada post com o retrato dos gostos tal como foi publicado (e se já foi apagado).
      geleiraShares: await q(
        `SELECT p.id AS "postId", p.body, p.geleira->'items' AS items, (p.geleira->>'total')::int AS total, p.created_at AS "createdAt", p.removed_at AS "removedAt"
           FROM content.posts p WHERE p.author_id = $1 AND p.geleira IS NOT NULL ORDER BY p.id`,
      ).catch(() => []),
      // Brindes aos itens da geleira (no perfil ou no cartão de um post da geleira): os que dei e os que recebi.
      geleiraItemCheersGiven: await q(
        `SELECT o.username AS "to", i.name AS item, c.source_post_id AS "fromPostId", c.created_at AS "createdAt"
           FROM taste.geleira_item_cheers c JOIN identity.users o ON o.id = c.owner_id JOIN taste.items i ON i.id = c.item_id WHERE c.user_id = $1 ORDER BY c.created_at`,
      ).catch(() => []),
      geleiraItemCheersReceived: await q(
        `SELECT u.username AS "from", i.name AS item, c.source_post_id AS "fromPostId", c.created_at AS "createdAt"
           FROM taste.geleira_item_cheers c JOIN identity.users u ON u.id = c.user_id JOIN taste.items i ON i.id = c.item_id WHERE c.owner_id = $1 ORDER BY c.created_at`,
      ).catch(() => []),
      // «Paga-me uma» (0145): os pedidos que fiz e que recebi (a bebida, por onde, o estado), o livro das geladas (o que devo e
      // o que me devem, com a prova do «Já paguei»), as rodadas que abri, em que entrei ou que paguei, e os avisos de sexta.
      geladaRequestsSent: await q(
        `SELECT r.id, o.username AS "to", r.drink_name AS drink, r.alcoholic, r.channel, r.post_id AS "postId", r.status, r.created_at AS "createdAt", r.answered_at AS "answeredAt"
           FROM taste.gelada_requests r JOIN identity.users o ON o.id = r.recipient_id WHERE r.requester_id = $1 ORDER BY r.created_at`,
      ).catch(() => []),
      geladaRequestsReceived: await q(
        `SELECT r.id, o.username AS "from", r.drink_name AS drink, r.alcoholic, r.channel, r.post_id AS "postId", r.status, r.created_at AS "createdAt", r.answered_at AS "answeredAt"
           FROM taste.gelada_requests r JOIN identity.users o ON o.id = r.requester_id WHERE r.recipient_id = $1 ORDER BY r.created_at`,
      ).catch(() => []),
      geladaBook: await q(
        `SELECT d.id, (d.debtor_id = $1) AS "iOwe", o.username AS "with", d.drink_name AS drink, d.alcoholic, d.source, d.status,
                d.paid_claimed_at AS "paidClaimedAt", d.paid_media_id AS "proofPhotoId", v.slug AS "proofVenue", d.paid_venue_near AS "proofVenueNear", d.created_at AS "createdAt", d.closed_at AS "closedAt"
           FROM taste.gelada_debts d JOIN identity.users o ON o.id = CASE WHEN d.debtor_id = $1 THEN d.creditor_id ELSE d.debtor_id END
           LEFT JOIN content.venues v ON v.id = d.paid_venue_id
          WHERE d.debtor_id = $1 OR d.creditor_id = $1 ORDER BY d.created_at`,
      ).catch(() => []),
      geladaRounds: await q(
        `SELECT r.id, r.group_id AS "groupId", (r.opened_by = $1) AS "openedByMe", (r.payer_id = $1) AS "iPaid", e.drink_name AS "myDrink", r.status, r.created_at AS "createdAt", r.closed_at AS "closedAt"
           FROM taste.gelada_rounds r LEFT JOIN taste.gelada_round_entries e ON e.round_id = r.id AND e.user_id = $1
          WHERE r.opened_by = $1 OR r.payer_id = $1 OR e.user_id IS NOT NULL ORDER BY r.created_at`,
      ).catch(() => []),
      // O nível da geleira (0146): o último cálculo, com o detalhe de onde vêm os pontos (geladas, brindes, sítios, rodadas, gostos).
      geleiraLevel: (await q(`SELECT points, level, breakdown, computed_at AS "computedAt" FROM taste.geleira_levels WHERE user_id = $1`).catch(() => []))[0] ?? null,
      geladaFridays: await q(`SELECT friday, kind, sent_at AS "sentAt" FROM taste.gelada_fridays WHERE user_id = $1 ORDER BY friday`).catch(() => []),
      // Chamadas feitas e recebidas (só o registo: o som e a imagem nunca passam pelo servidor).
      calls: await q(
        `SELECT c.id, (c.caller_id = $1) AS outgoing, o.username AS "with", c.video, c.status, c.created_at AS "createdAt", c.started_at AS "startedAt", c.ended_at AS "endedAt"
           FROM social.calls c JOIN identity.users o ON o.id = CASE WHEN c.caller_id = $1 THEN c.callee_id ELSE c.caller_id END
          WHERE c.caller_id = $1 OR c.callee_id = $1 ORDER BY c.id`,
      ).catch(() => []),
      musicFavorites: await q(`SELECT track_id AS "trackId", track, created_at AS "createdAt" FROM content.music_favorites WHERE user_id = $1 ORDER BY created_at`).catch(() => []),
      musicDislikes: await q(`SELECT track_id AS "trackId", created_at AS "createdAt" FROM content.music_dislikes WHERE user_id = $1 ORDER BY created_at`).catch(() => []),
      // Programa de artistas (0131): o meu pedido de artista, as minhas faixas (com os totais de usos), cada aceitação da licença
      // (versão, resumo do texto e data), as denúncias de direitos que fiz e as faixas de artistas que usei.
      artist: (await q(
        `SELECT stage_name AS "stageName", styles, links, rights_kind AS "rightsKind", label_name AS "labelName", rights_statement AS "rightsStatement",
                status, review_reason AS "reason", created_at AS "createdAt", updated_at AS "updatedAt", approved_at AS "approvedAt"
           FROM content.artist_profiles WHERE user_id = $1`,
      ).catch(() => []))[0] ?? null,
      artistTracks: await q(
        `SELECT t.id, t.title, t.styles, t.explicit, t.status, (t.hold_at IS NOT NULL) AS "onHold", t.duration_ms AS "durationMs", t.preview_start_ms AS "previewStartMs",
                t.preview_ms AS "previewMs", t.license_version AS "licenseVersion", t.created_at AS "createdAt", t.approved_at AS "approvedAt", t.withdrawn_at AS "withdrawnAt",
                t.removed_at AS "removedAt", (SELECT count(*) FROM content.artist_track_uses u WHERE u.track_id = t.id)::int AS uses,
                (SELECT count(DISTINCT u.user_id) FROM content.artist_track_uses u WHERE u.track_id = t.id)::int AS people
           FROM content.artist_tracks t WHERE t.artist_id = $1 ORDER BY t.created_at`,
      ).catch(() => []),
      musicLicenseAcceptances: await q(
        `SELECT l.track_id AS "trackId", t.title, l.version, l.text_sha256 AS "textSha256", l.accepted_at AS "acceptedAt"
           FROM content.artist_track_licenses l JOIN content.artist_tracks t ON t.id = l.track_id WHERE l.user_id = $1 ORDER BY l.accepted_at`,
      ).catch(() => []),
      copyrightReportsFiled: await q(
        `SELECT t.title, c.claimant_name AS "claimantName", c.contact_email AS "contactEmail", c.relation, c.details, c.status, c.created_at AS "createdAt"
           FROM content.artist_track_claims c JOIN content.artist_tracks t ON t.id = c.track_id WHERE c.reporter_id = $1 ORDER BY c.created_at`,
      ).catch(() => []),
      artistTracksUsed: await q(
        `SELECT t.title, ap.stage_name AS artist, u.surface, u.created_at AS "createdAt"
           FROM content.artist_track_uses u JOIN content.artist_tracks t ON t.id = u.track_id LEFT JOIN content.artist_profiles ap ON ap.user_id = t.artist_id
          WHERE u.user_id = $1 ORDER BY u.created_at`,
      ).catch(() => []),
      // Sons das tchekas (0133): «Deixar usar o meu som», os meus sons originais (de que tcheka saíram, quantas tchekas os usam,
      // se estão em análise ou foram tirados), os sons que usei nas minhas tchekas e as denúncias de sons que fiz.
      soundReuse: ((await q(`SELECT sound_reuse FROM identity.users WHERE id = $1`).catch(() => []))[0]?.sound_reuse as boolean | undefined) ?? null,
      sounds: await q(
        `SELECT s.id, s.title, s.duration_ms AS "durationMs", s.source_post_id AS "sourcePostId", s.created_at AS "createdAt", s.hold_at AS "heldAt",
                s.removed_at AS "removedAt", s.removed_reason AS "removedReason",
                (SELECT count(*) FROM content.posts p WHERE p.sound_id = s.id AND p.removed_at IS NULL)::int AS uses
           FROM content.sounds s WHERE s.owner_id = $1 AND s.kind = 'original' ORDER BY s.created_at`,
      ).catch(() => []),
      soundsUsed: await q(
        `SELECT p.id AS "postId", s.id AS "soundId", s.kind, s.title, p.created_at AS "createdAt"
           FROM content.posts p JOIN content.sounds s ON s.id = p.sound_id WHERE p.author_id = $1 ORDER BY p.created_at`,
      ).catch(() => []),
      soundReportsFiled: await q(
        `SELECT r.sound_id AS "soundId", r.reason, r.note, r.status, r.created_at AS "createdAt" FROM content.sound_reports r WHERE r.reporter_id = $1 ORDER BY r.created_at`,
      ).catch(() => []),
      // Locais: os que criei, os que giro (e o papel), os que sigo e os meus check-ins.
      // Com a morada e a posição no mapa (e se o local aparece no mapa), que são dados que a pessoa deu.
      venuesOwned: await q(`SELECT slug, name, kind, address, city, lat, lng, show_on_map AS "showOnMap", created_at AS "createdAt" FROM content.venues WHERE owner_id = $1 ORDER BY created_at`).catch(() => []),
      venuesManaged: await q(
        `SELECT v.slug, v.name, m.role, m.status, m.created_at AS "since" FROM content.venue_managers m JOIN content.venues v ON v.id = m.venue_id WHERE m.user_id = $1 ORDER BY m.created_at`,
      ).catch(() => []),
      venuesFollowed: await q(`SELECT v.slug, v.name, f.created_at AS "since" FROM content.venue_follows f JOIN content.venues v ON v.id = f.venue_id WHERE f.user_id = $1 ORDER BY f.created_at`).catch(() => []),
      checkins: await q(`SELECT v.slug, v.name, c.created_at AS "createdAt" FROM content.checkins c JOIN content.venues v ON v.id = c.venue_id WHERE c.user_id = $1 ORDER BY c.created_at`).catch(() => []),
      // Bombar: os locais cujos destaques pediste para não ver.
      boostsHidden: await q(`SELECT v.slug, v.name, h.created_at AS "since" FROM content.boost_hidden h JOIN content.venues v ON v.id = h.venue_id WHERE h.user_id = $1 ORDER BY h.created_at`).catch(() => []),
      // Bombar: as vezes que um destaque me foi mostrado ou em que toquei (o local só vê totais).
      boostViews: await q(
        `SELECT v.slug, v.name, c.target_kind AS "target", i.kind, i.surface, i.created_at AS "createdAt"
           FROM content.boost_impressions i JOIN content.boost_campaigns c ON c.id = i.campaign_id JOIN content.venues v ON v.id = c.venue_id
          WHERE i.user_id = $1 ORDER BY i.created_at`,
      ).catch(() => []),
      // Convites: o meu código, quem me convidou e quem convidei (sem a impressão da rede).
      invites: {
        code: (await q(`SELECT code, active, created_at AS "createdAt" FROM social.invite_codes WHERE user_id = $1`).catch(() => []))[0] ?? null,
        invitedBy: (await q(`SELECT u.username, r.status, r.created_at AS "joinedAt" FROM social.referrals r JOIN identity.users u ON u.id = r.inviter_id WHERE r.invitee_id = $1`).catch(() => []))[0] ?? null,
        invited: await q(
          `SELECT u.username, r.status, r.reason, r.amount, r.created_at AS "joinedAt", r.qualified_at AS "activeAt", r.paid_at AS "paidAt"
             FROM social.referrals r JOIN identity.users u ON u.id = r.invitee_id WHERE r.inviter_id = $1 ORDER BY r.created_at`,
        ).catch(() => []),
      },
      // Estatísticas de uso ("Ajudar a melhorar o Txillapp"): as 10 000 mais recentes.
      usageStats: await q(
        `SELECT name, props, platform, app_version AS "appVersion", session_id AS "sessionId", at FROM analytics.events WHERE user_id = $1 ORDER BY at DESC LIMIT 10000`,
      ).catch(() => []),
      // Os perfis que visitei (um registo por perfil e por dia, para as estatísticas do perfil de cada um). Quem visitou o meu
      // perfil não entra: são dados de outras pessoas, e nas estatísticas só aparecem totais.
      profileVisits: await q(
        `SELECT u.username, v.day FROM social.profile_views v JOIN identity.users u ON u.id = v.profile_id WHERE v.viewer_id = $1 ORDER BY v.day DESC LIMIT 10000`,
      ).catch(() => []),
      // Lembretes de regresso que recebi: quando, que etapa, por onde (push ou e-mail), de que tipo e quando voltei.
      // O texto não se guarda. `remindersOn`: se estão ligados (Definições → Notificações).
      comebackReminders: {
        remindersOn: !((await q(`SELECT off FROM social.notification_prefs WHERE user_id = $1`).catch(() => []))[0]?.off as string[] | undefined)?.includes('comeback'),
        sent: await q(
          `SELECT sent_at AS "sentAt", stage, channel, kind, returned_at AS "returnedAt" FROM social.comeback_reminders WHERE user_id = $1 AND channel <> 'pending' ORDER BY sent_at`,
        ).catch(() => []),
      },
      // Como afinei o algoritmo do Explorar e das Tchekas.
      feedSettings: (await q(`SELECT following, freshness, media, variety, hide_seen AS "hideSeen", calm FROM social.feed_settings WHERE user_id = $1`).catch(() => []))[0] ?? null,
      topicPrefs: await q(`SELECT topic, pref FROM social.explore_prefs WHERE user_id = $1 ORDER BY topic`).catch(() => []),
      peoplePrefs: await q(`SELECT u.username, e.pref FROM social.explore_people e JOIN identity.users u ON u.id = e.person_id WHERE e.user_id = $1 ORDER BY u.username`).catch(() => []),
      postFeedback: await q(`SELECT post_id AS "postId", value, created_at AS "createdAt" FROM content.post_feedback WHERE user_id = $1 ORDER BY created_at`).catch(() => []),
      paymentOrders: await q(
        `SELECT id, package_id AS "packageId", txills, amount_minor AS "amountMinor", currency, provider, status, phone_tail AS "phoneTail", created_at AS "createdAt", paid_at AS "paidAt"
           FROM payments.orders WHERE user_id = $1 ORDER BY created_at`,
      ).catch(() => []),
      // Compras pela loja (App Store / Google Play): a verificação paga e o Bombar, com cada compra, renovação e reembolso.
      storePurchases: await q(
        `SELECT ip.store, ip.product_id AS "productId", ip.kind, ip.status, ip.environment, ip.transaction_id AS "transactionId",
                ip.original_transaction_id AS "originalTransactionId", ip.order_id AS "orderId", ip.expires_at AS "expiresAt", ip.auto_renew AS "autoRenew",
                ip.campaign_id AS "campaignId", ip.created_at AS "createdAt", ip.updated_at AS "updatedAt",
                coalesce((SELECT json_agg(json_build_object('type', e.type, 'amountMinor', e.amount_minor, 'currency', e.currency, 'at', e.created_at) ORDER BY e.created_at)
                            FROM payments.iap_events e WHERE e.purchase_id = ip.id AND e.transaction_ref IS NOT NULL), '[]') AS events
           FROM payments.iap_purchases ip WHERE ip.user_id = $1 ORDER BY ip.created_at`,
      ).catch(() => []),
      paidVerification: (await q(
        `SELECT eligible_at AS "eligibleAt", applied, previous_verified AS "previousVerified", previous_tier AS "previousTier", applied_at AS "appliedAt"
           FROM payments.paid_verification WHERE user_id = $1`,
      ).catch(() => []))[0] ?? null,
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
      // Envios por publicar: fotos, vídeos e áudios que enviei e ainda não estão em uso; apagam-se sozinhos 48 horas depois.
      pendingUploads: await this.pendingUploads(userId),
      // Publicações guardadas à espera da revisão de uma foto recusada (0144): o tipo, o rascunho e o estado.
      heldPublications: await q(
        `SELECT kind, media_id AS "mediaId", payload, status, created_at AS "createdAt", expires_at AS "expiresAt", decided_at AS "decidedAt", error
           FROM content.held_publications WHERE owner_id = $1 ORDER BY created_at`,
      ),
      reportsFiled: await q(`SELECT target_type AS "type", reason, status, created_at AS "createdAt" FROM social.reports WHERE reporter_id = $1 ORDER BY created_at`),
      // O que a moderação removeu do que publiquei (0121): o tipo, o texto, o motivo e se foi reposto. Nunca quem da equipa o fez.
      moderationRemovals: await q(
        `SELECT target_type AS "type", body, reason, removed_at AS "removedAt", restored_at AS "restoredAt"
           FROM content.moderation_removals WHERE author_id = $1 ORDER BY removed_at`,
      ).catch(() => []),
      wallet: await q(
        `SELECT t.id, t.created_at AS "createdAt", t.type, e.amount
           FROM ledger.entries e JOIN ledger.accounts a ON a.id = e.account_id JOIN ledger.transactions t ON t.id = e.transaction_id
          WHERE a.user_id = $1 ORDER BY t.created_at`,
      ).catch(() => []),
    };
  }
}
