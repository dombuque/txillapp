/** Existe bloqueio entre os dois, em qualquer sentido? */
export const blockedBetween = (a: string, b: string) =>
  `EXISTS (SELECT 1 FROM social.blocks bk WHERE (bk.blocker_id = ${a} AND bk.blocked_id = ${b}) OR (bk.blocker_id = ${b} AND bk.blocked_id = ${a}))`;

/**
 * Regra única de privacidade: o conteúdo de uma pessoa é visível se a conta está activa, não há bloqueio entre
 * as partes, e (o perfil é público, é o próprio ou o espectador é seguidor aceite).
 * Usar em TODA a query que devolve conteúdo de outra pessoa.
 *
 * @param author alias SQL da tabela identity.users do autor
 * @param viewer placeholder do id do espectador (por omissão $1)
 */
export const canView = (author = 'u', viewer = '$1') =>
  `(${author}.status = 'active' AND NOT ${blockedBetween(`${author}.id`, viewer)} AND (${author}.is_private = false OR ${author}.id = ${viewer} OR EXISTS (` +
  `SELECT 1 FROM social.follows vf WHERE vf.follower_id = ${viewer} AND vf.followee_id = ${author}.id)))`;

/**
 * Definição do tipo "todos / quem eu sigo / ninguém" (comentários, presentes, respostas a stories).
 * Verdadeiro se o espectador pode, segundo a definição do dono. O próprio dono pode sempre.
 */
export const allowedBy = (owner: string, column: string, viewer = '$1') =>
  `(${owner}.id = ${viewer} OR ${owner}.${column} = 'everyone' OR (${owner}.${column} = 'following' AND EXISTS (` +
  `SELECT 1 FROM social.follows af WHERE af.follower_id = ${owner}.id AND af.followee_id = ${viewer})))`;
