// «Pedir revisão» de uma foto recusada pela verificação automática (o servidor só recusa com prova de nudez; se achas que
// se enganou, a foto vai para a moderação). Com o pedido vai o rascunho da publicação (publicação, mimo ou Zás): fica
// guardado no servidor e é publicado lá quando a foto for aprovada, mesmo com a app fechada. Usado pela faixa de
// publicação (PublishBanner / publishQueue). Sem dependências (os testes correm em Node: tests/photoAppeal.test.mjs).

/**
 * available: ainda se pode pedir · sending: a pedir · held: pedido feito com o rascunho (o servidor publica sozinho) ·
 * pending: pedido feito sem rascunho (a app continua a publicação quando a foto for aprovada, se estiver aberta) ·
 * published: aprovada e publicada pelo servidor · refused: a moderação manteve a recusa · failed: o pedido falhou.
 */
export type AppealState = 'available' | 'sending' | 'held' | 'pending' | 'published' | 'refused' | 'failed';

/** O rascunho que acompanha o pedido: o tipo e o mesmo corpo do endpoint de publicar (POST /posts, /stories, /instants). */
export type HeldDraft = { kind: 'post' | 'story' | 'instant'; payload: Record<string, unknown> };

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
    case 'held': return 'Pedido enviado. Publicamos sozinhos quando a equipa aprovar; podes fechar a app.';
    case 'pending': return 'Pedido de revisão enviado. Se a moderação aprovar a foto, a publicação segue sozinha.';
    case 'published': return 'A equipa aprovou a foto: já está publicado.';
    case 'refused': return 'A moderação reviu a foto e manteve a recusa.';
    default: return null;
  }
}

/** Pode tocar-se em «Pedir revisão»? */
export const canAppeal = (state: AppealState) => state === 'available' || state === 'failed';

/** A resposta de GET /media/:id/status enquanto se espera pela moderação. */
export interface AppealStatus { status: string; error?: string; held?: { status: string; error?: string } }

/**
 * O que fazer com essa resposta. Com rascunho guardado: 'published' (o servidor publicou) ou 'held_failed' (aprovada,
 * mas a publicação falhou ou o rascunho expirou: publica-se à mão). Sem rascunho: 'approved' (a app continua a
 * publicação). E 'refused' ou 'waiting' nos dois casos.
 */
export function appealOutcome(st: AppealStatus): 'approved' | 'published' | 'held_failed' | 'refused' | 'waiting' {
  if (st.status === 'deleted') return 'refused';
  if (st.status !== 'ready') return 'waiting';
  if (st.held?.status === 'published') return 'published';
  if (st.held?.status === 'held') return 'waiting'; // aprovada há instantes: o servidor está a publicar
  if (st.held?.status === 'failed' || st.held?.status === 'expired') return 'held_failed';
  return 'approved';
}
