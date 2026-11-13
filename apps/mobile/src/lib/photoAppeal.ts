// «Pedir revisão» de uma foto recusada pela verificação automática (o servidor só recusa com prova de nudez; se achas que
// se enganou, a foto vai para a moderação e, aprovada, a publicação segue sozinha). Usado pela faixa de publicação
// (PublishBanner / publishQueue). Sem dependências (os testes correm em Node: tests/photoAppeal.test.mjs).

/** available: ainda se pode pedir · sending: a pedir · pending: à espera da moderação · refused: a moderação manteve a recusa · failed: o pedido falhou. */
export type AppealState = 'available' | 'sending' | 'pending' | 'refused' | 'failed';

/** O id da foto recusada (resposta 422 com `code: 'nudity_rejected'` e `assetId`), ou null se o erro for outro. */
export function rejectedPhotoId(e: unknown): string | null {
  if (!e || typeof e !== 'object') return null;
  const x = e as { status?: number; code?: string; extra?: { assetId?: unknown } };
  if (x.status !== 422 || x.code !== 'nudity_rejected') return null;
  return typeof x.extra?.assetId === 'string' ? x.extra.assetId : null;
}

/** O texto da faixa enquanto há um pedido de revisão (null: fica a mensagem de erro do servidor). */
export function appealText(state: AppealState): string | null {
  switch (state) {
    case 'sending': return 'A pedir a revisão…';
    case 'pending': return 'Pedido de revisão enviado. Se a moderação aprovar a foto, a publicação segue sozinha.';
    case 'refused': return 'A moderação reviu a foto e manteve a recusa.';
    default: return null;
  }
}

/** Pode tocar-se em «Pedir revisão»? */
export const canAppeal = (state: AppealState) => state === 'available' || state === 'failed';

/** O que fazer com a resposta ao estado da foto enquanto se espera pela moderação. */
export function appealOutcome(status: string): 'approved' | 'refused' | 'waiting' {
  if (status === 'ready') return 'approved';
  if (status === 'deleted') return 'refused';
  return 'waiting';
}
