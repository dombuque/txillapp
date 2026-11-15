import { canView, notReportedBy } from '../social/visibility';

/**
 * Quem pode ver uma Txillada (`t` = content.txilladas, `h` = identity.users do anfitrião, `v` = o espectador): o próprio
 * anfitrião; ou quem passa em canView() (conta ativa, sem bloqueios, conta privada → só seguidores) e no público escolhido:
 * 'everyone' (quem pode ver o perfil), 'followers' (quem segue) ou 'close' (os amigos próximos do anfitrião, a mesma lista
 * dos mimos). As expulsões ficam à parte (txilladaBanned): quem foi expulso recebe 403, não 404.
 */
export const txilladaVisible = (t = 't', h = 'h', v = '$1') =>
  `(${t}.host_id = ${v} OR (${canView(h, v)} AND (
      ${t}.audience = 'everyone'
      OR (${t}.audience = 'followers' AND EXISTS (SELECT 1 FROM social.follows txf WHERE txf.follower_id = ${v} AND txf.followee_id = ${t}.host_id))
      OR (${t}.audience = 'close' AND EXISTS (SELECT 1 FROM social.close_friends txc WHERE txc.owner_id = ${t}.host_id AND txc.friend_id = ${v})))))`;

/** O espectador foi expulso desta Txillada? */
export const txilladaBanned = (t = 't', v = '$1') => `EXISTS (SELECT 1 FROM content.txillada_bans txb WHERE txb.txillada_id = ${t}.id AND txb.user_id = ${v})`;

/**
 * `live: { id } | null` de uma pessoa (`u` = identity.users) para o espectador `v`: a Txillada que ela tem a decorrer, se o
 * espectador a pode ver, não foi expulso e não a denunciou (como em GET /txilladas/live). Barato: usa o índice único das
 * 'live' por anfitrião (no máximo uma linha).
 */
export const liveOf = (u = 'u', v = '$1') =>
  `(SELECT json_build_object('id', ltx.id) FROM content.txilladas ltx
     WHERE ltx.host_id = ${u}.id AND ltx.status = 'live' AND ${txilladaVisible('ltx', u, v)} AND NOT ${txilladaBanned('ltx', v)}
       AND ${notReportedBy('txillada', 'ltx.id', v)} LIMIT 1)`;
