/** País onde a pessoa está agora (atualizado a cada pedido a partir do IP). */
const viewerCountry = (viewer: string) => `(SELECT vc.country FROM identity.users vc WHERE vc.id = ${viewer})`;

/** O conteúdo/conta é do mesmo país onde o espectador está agora? */
export const sameCountry = (column: string, viewer = '$1') => `${column} IS NOT DISTINCT FROM ${viewerCountry(viewer)}`;

/**
 * Rede do espectador para DESCOBERTA (pesquisa, hashtags, reels, sugestões): cada país é a sua própria rede.
 * Entra o que é do mesmo país, o que é do próprio e o de quem ele segue (esses vêm de onde estiverem).
 * Junta-se sempre a canView(): a privacidade continua a mandar.
 */
export const inMyNetwork = (authorId = 'p.author_id', country = 'p.country', viewer = '$1') =>
  `(${authorId} = ${viewer} OR ${sameCountry(country, viewer)} OR EXISTS (SELECT 1 FROM social.follows nf WHERE nf.follower_id = ${viewer} AND nf.followee_id = ${authorId}))`;

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

/**
 * Lista de quem interagiu (reposts, brindes, presentes): "todos / só quem me segue / ninguém", segundo a definição do dono.
 * O próprio dono vê sempre.
 */
export const listVisibleTo = (owner: string, column: string, viewer = '$1') =>
  `(${owner}.id = ${viewer} OR ${owner}.${column} = 'everyone' OR (${owner}.${column} = 'followers' AND EXISTS (` +
  `SELECT 1 FROM social.follows lf WHERE lf.follower_id = ${viewer} AND lf.followee_id = ${owner}.id)))`;
