/**
 * Quando é que uma tcheka toca. Há duas coisas diferentes que antes andavam juntas num só `active`:
 * - `active`: é a tcheka em cena na lista (a que ocupa o ecrã). Ao deixar de o ser (deslizaste para outra) volta ao início.
 * - `onScreen`: o ecrã da Tcheka está à frente. Ao mudar de separador ou abrir outro ecrã por cima (o perfil do autor),
 *   só PÁRA; ao voltar, continua de onde estava (antes recomeçava do zero e perdia a pausa).
 */
export interface ReelState {
  active: boolean;
  onScreen: boolean;
  /** A app (ou o separador do browser) está à vista. */
  appVisible: boolean;
  userPaused: boolean;
  ended: boolean;
  /** A folha de partilhar está aberta (a pré-visualização é que toca). */
  sharing: boolean;
}

export function reelShouldPlay(s: ReelState): boolean {
  return s.active && s.onScreen && s.appVisible && !s.userPaused && !s.ended && !s.sharing;
}

/** Volta ao início (sem a pausa nem o fim de antes) só quando sai de cena na lista, não quando o ecrã fica por trás. */
export function reelResets(s: Pick<ReelState, 'active' | 'onScreen'>): boolean {
  return !s.active;
}
