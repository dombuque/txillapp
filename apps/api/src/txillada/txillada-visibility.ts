import { canView, notReportedBy } from '../social/visibility';

/**
 * Quem pode ver uma Txillada (`t` = content.txilladas, `h` = identity.users do anfitrião, `v` = o espectador): o próprio
 * anfitrião; ou quem passa em canView() (conta ativa, sem bloqueios, conta privada → só seguidores) e no público escolhido:
 * 'everyone' (Pública: quem pode ver o perfil), 'friends' (Para amigos, 0167: quem o anfitrião segue e o segue a ele),
 * 'close' (Para amigos com «Só amigos próximos»: a lista dos mimos do anfitrião), 'paid' (Privada, 0167: quem pode ver o
 * perfil vê que existe; para entrar paga, ver txilladaTicket) ou 'followers' (as linhas e as apps antigas: quem segue). As
 * expulsões ficam à parte (txilladaBanned): quem foi expulso recebe 403, não 404.
 */
export const txilladaVisible = (t = 't', h = 'h', v = '$1') =>
  `(${t}.host_id = ${v} OR (${canView(h, v)} AND (
      ${t}.audience IN ('everyone', 'paid')
      OR (${t}.audience = 'friends' AND EXISTS (SELECT 1 FROM social.follows txf WHERE txf.follower_id = ${v} AND txf.followee_id = ${t}.host_id)
                                    AND EXISTS (SELECT 1 FROM social.follows txg WHERE txg.follower_id = ${t}.host_id AND txg.followee_id = ${v}))
      OR (${t}.audience = 'followers' AND EXISTS (SELECT 1 FROM social.follows txf WHERE txf.follower_id = ${v} AND txf.followee_id = ${t}.host_id))
      OR (${t}.audience = 'close' AND EXISTS (SELECT 1 FROM social.close_friends txc WHERE txc.owner_id = ${t}.host_id AND txc.friend_id = ${v})))))`;

/**
 * Pode entrar (0167)? Numa Txillada paga: o anfitrião, quem tem a entrada paga (txillada_tickets) e quem foi convidado para
 * transmitir (0165: um convite à espera, a transmitir, ou transmitiu e saiu pelo próprio pé). Nas outras, sempre. A equipa da
 * moderação vê pelo backoffice; na app paga como toda a gente.
 */
export const txilladaTicket = (t = 't', v = '$1') =>
  `(${t}.audience <> 'paid' OR ${t}.host_id = ${v}
     OR EXISTS (SELECT 1 FROM content.txillada_tickets txk WHERE txk.txillada_id = ${t}.id AND txk.user_id = ${v})
     OR EXISTS (SELECT 1 FROM content.txillada_guests txq WHERE txq.txillada_id = ${t}.id AND txq.user_id = ${v}
                  AND (txq.status = 'accepted' OR (txq.kind = 'invite' AND txq.status IN ('pending', 'left')))))`;

/** O espectador foi expulso desta Txillada? */
export const txilladaBanned = (t = 't', v = '$1') => `EXISTS (SELECT 1 FROM content.txillada_bans txb WHERE txb.txillada_id = ${t}.id AND txb.user_id = ${v})`;

/**
 * `live: { id, price? } | null` de uma pessoa (`u` = identity.users) para o espectador `v`: a Txillada que ela tem a decorrer, se
 * o espectador a pode ver, não foi expulso e não a denunciou (como em GET /txilladas/live). `price` só numa paga (0167) em que o
 * espectador ainda não tem a entrada: a roda mostra o cadeado e o preço. Barato: usa o índice único das 'live' por anfitrião (no máximo uma linha).
 */
export const liveOf = (u = 'u', v = '$1') =>
  `(SELECT json_strip_nulls(json_build_object('id', ltx.id, 'price', CASE WHEN ltx.audience = 'paid' AND NOT ${txilladaTicket('ltx', v)} THEN ltx.price END)) FROM content.txilladas ltx
     WHERE ltx.host_id = ${u}.id AND ltx.status = 'live' AND ${txilladaVisible('ltx', u, v)} AND NOT ${txilladaBanned('ltx', v)}
       AND ${notReportedBy('txillada', 'ltx.id', v)} LIMIT 1)`;

/**
 * `nextTxillada` de uma pessoa (`u` = identity.users) para o espectador `v` (Txillada agendada, 0176): o próximo agendamento
 * dela em 'scheduled' que o espectador pode ver (o mesmo público da Txillada), em JSON `{ id, startsAt, title, reminded }`.
 * Barato: usa o índice parcial (host_id, starts_at) dos 'scheduled'.
 */
export const nextTxilladaOf = (u = 'u', v = '$1') =>
  `(SELECT json_build_object('id', ns.id, 'startsAt', ns.starts_at, 'title', ns.title,
            'reminded', EXISTS (SELECT 1 FROM content.txillada_schedule_reminders nr WHERE nr.schedule_id = ns.id AND nr.user_id = ${v}))
      FROM content.txillada_schedules ns
     WHERE ns.host_id = ${u}.id AND ns.status = 'scheduled' AND ${txilladaVisible('ns', u, v)}
     ORDER BY ns.starts_at LIMIT 1)`;
