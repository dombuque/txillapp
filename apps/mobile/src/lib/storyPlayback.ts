/**
 * Quando é que o mimo está em pausa (a barra de progresso pára, o vídeo e a música param).
 * `background`: a app saiu do ecrã (ou o separador do browser ficou escondido). Antes a barra continuava a correr por
 * trás e, ao voltar, já se tinha passado para o mimo seguinte (ou para a pessoa seguinte) sem o teres visto.
 */
export interface StoryPauseState {
  held: boolean;
  typing: boolean;
  panelOpen: boolean;
  away: boolean;
  background: boolean;
}

export function storyPaused(s: StoryPauseState): boolean {
  return s.held || s.typing || s.panelOpen || s.away || s.background;
}
