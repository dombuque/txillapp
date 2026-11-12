/** Um ficheiro de música escolhido para carregar (programa de artistas). */
export interface PickedAudio { uri: string; mime: string; name: string; size: number; durationMs: number | null }

/**
 * Na app do telemóvel ainda não há escolha de ficheiros de áudio (precisa de um módulo nativo novo): carrega-se pelo site,
 * no mesmo ecrã (txillapp.com/artista/carregar). A versão do site está em pickAudio.web.ts.
 */
export const canPickAudio = false;

export async function pickAudio(): Promise<PickedAudio | null> {
  return null;
}
