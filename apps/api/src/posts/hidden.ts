/**
 * «Ocultar publicação» (0169): o autor esconde uma publicação sua e volta a mostrá-la quando quiser (como o «Arquivar»).
 * Enquanto está oculta (`hidden_at`), para os outros é como uma publicação apagada: não sai no feed, no perfil, na pesquisa,
 * nas hashtags, nos sítios, nos sons, nos Reels, nos reposts, nos mimos que a partilharam nem nas conversas, e pelo link dá
 * «Esta publicação não está disponível». Ninguém a brinda, comenta, presenteia, reposta nem guarda (404, como uma apagada).
 * O autor vê-a no separador «Ocultas» do perfil e pelo link. A equipa (moderação e backoffice) continua a vê-la.
 *
 * Use estes predicados em vez de `removed_at IS NULL` sempre que a consulta lê publicações para as mostrar a alguém.
 */

/** A publicação está à vista de todos: nem apagada nem oculta pelo autor. */
export const shownPost = (p = 'p') => `(${p}.removed_at IS NULL AND ${p}.hidden_at IS NULL)`;

/** À vista de quem vê (`viewer`, por omissão $1): as ocultas, só o próprio autor. */
export const shownPostTo = (p = 'p', viewer = '$1') => `(${p}.removed_at IS NULL AND (${p}.hidden_at IS NULL OR ${p}.author_id = ${viewer}))`;

/** A resposta (409) de `POST /posts/:id/hide` com uma campanha do Bombar a decorrer (ou marcada) nesta publicação. */
export const HIDE_BOOSTED = 'Esta publicação está a bombar. Podes ocultá-la quando o Bombar acabar.';

/** Uma campanha do Bombar a decorrer ou marcada (ainda não acabou) sobre a publicação `p`. */
export const ACTIVE_BOOST_SQL = (p = 'p') =>
  `EXISTS (SELECT 1 FROM content.boost_campaigns bc WHERE bc.post_id = ${p}.id AND bc.status IN ('active', 'pending') AND bc.ends_at > now() AND bc.stopped_at IS NULL)`;
