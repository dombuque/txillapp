import type { Pool } from 'pg';

/** O texto de recurso do cartão do convite (kind 'mixar'), do ponto de vista de quem lê: o que vai no `body` e na lista. */
export const MIXAR_CARD_TEXT = { received: 'Convidou-te para um Mixar', sent: 'Convidaste para um Mixar' } as const;
export const mixarCardText = (mine: boolean) => (mine ? MIXAR_CARD_TEXT.sent : MIXAR_CARD_TEXT.received);

export type MixarStatus = 'pending' | 'active' | 'declined' | 'ended';
/** O cartão do Mixar numa mensagem do chat: sempre com o estado atual (não o do momento do envio). */
export interface MixarCard {
  id: string;
  status: MixarStatus;
  invitedByMe: boolean;
  /** «Dom + Ana»: o meu 1.º nome e o do outro. */
  name: string;
}

/**
 * Os cartões das mensagens kind 'mixar' (pelo id da mensagem), como `me` os vê. Uma mensagem sem Mixar (a conta de uma das
 * partes foi eliminada) não aparece no mapa: a conversa mostra `mixar: null`.
 */
export async function mixarCards(pool: Pick<Pool, 'query'>, me: string, messageIds: string[]): Promise<Map<string, MixarCard>> {
  const out = new Map<string, MixarCard>();
  if (!messageIds.length) return out;
  const { rows } = await pool.query(
    `SELECT x.id, x.message_id, x.status, (x.invited_by = $1) AS mine,
            split_part(mu.display_name, ' ', 1) AS my_name, split_part(o.display_name, ' ', 1) AS their_name
       FROM social.mixars x
       JOIN identity.users mu ON mu.id = $1
       JOIN identity.users o ON o.id = CASE WHEN x.user_a = $1 THEN x.user_b ELSE x.user_a END
      WHERE x.message_id = ANY($2::uuid[]) AND (x.user_a = $1 OR x.user_b = $1)`,
    [me, messageIds],
  );
  for (const r of rows) {
    out.set(r.message_id as string, { id: r.id as string, status: r.status as MixarStatus, invitedByMe: !!r.mine, name: `${r.my_name as string} + ${r.their_name as string}` });
  }
  return out;
}
