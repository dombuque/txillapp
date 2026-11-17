import { blockedBetween } from '../social/visibility';

/**
 * A nota de outra pessoa que `viewer` pode ver agora (SQL; `n` = social.notes, `u` = identity.users do autor): ainda dentro
 * das 24 horas, o autor ativo, sem bloqueio em nenhum sentido, `viewer` segue o autor (o público 'mutual' = quem me segue,
 * «Seguidores» na app) e, numa nota 'close_friends', está na lista de amigos próximos do autor. Partilhado pelas notas
 * (NotesService) e pela moderação (quem pode denunciar uma nota).
 */
export const noteVisibleTo = (n = 'n', u = 'u', viewer = '$1') => `(${n}.expires_at > now() AND ${u}.status = 'active' AND ${u}.id <> ${viewer}
  AND NOT ${blockedBetween(`${u}.id`, viewer)}
  AND EXISTS (SELECT 1 FROM social.follows nvf WHERE nvf.follower_id = ${viewer} AND nvf.followee_id = ${u}.id)
  AND (${n}.audience <> 'close_friends' OR EXISTS (SELECT 1 FROM social.close_friends nvc WHERE nvc.owner_id = ${n}.user_id AND nvc.friend_id = ${viewer})))`;

/** Quanto tempo uma nota fica guardada depois de deixar de se ver (a limpeza de hora a hora apaga-a a seguir). */
export const NOTE_KEEP_AFTER_EXPIRY = '24 hours';
