/**
 * Memória dos vídeos no telemóvel (expo-video).
 *
 * No Android cada leitor é um ExoPlayer com o seu próprio LoadControl. Sem `bufferOptions`, o expo-video deixa os valores
 * do media3: 50 s de vídeo à frente e um teto de ~128 MB por leitor, tudo em byte[] no heap Java (192 MB num Samsung).
 * E um leitor começa a carregar mal é criado (com a fonte), mesmo parado e fora do ecrã. No Início, o feed montava uma
 * dúzia de vídeos de uma vez (a lista desenha 3 ecrãs para cima e para baixo, mais os vídeos dos carrosséis): cada um a
 * guardar até 50 s e com o seu descodificador. O heap enchia e a app fechava com OutOfMemoryError (no OkHttp ou no
 * ExoPlayer, conforme quem pedisse memória por último).
 *
 * Daí duas regras:
 *  - no feed, só há leitor para o vídeo que se está a ver (`feedVideoLive`); os outros mostram a capa;
 *  - todos os leitores têm um teto de memória (`limitBuffer`, com os perfis de `VIDEO_BUFFER`).
 */

export interface VideoBufferOptions {
  /** Segundos à frente do que está a tocar. */
  preferredForwardBufferDuration: number;
  /** Teto de bytes em memória (Android). */
  maxBufferBytes: number;
  /** Segundos que é preciso ter para arrancar (ou continuar depois de parar a carregar). */
  minBufferForPlayback: number;
  /** false: o teto de bytes ganha ao tempo (é o que protege a memória). */
  prioritizeTimeOverSizeThreshold: boolean;
}

const MB = 1024 * 1024;

export const VIDEO_BUFFER = {
  /** Vídeos do feed e dos carrosséis: curtos, um de cada vez. */
  feed: { preferredForwardBufferDuration: 8, maxBufferBytes: 6 * MB, minBufferForPlayback: 1, prioritizeTimeOverSizeThreshold: false },
  /** Tchekas (ecrã inteiro): a lista tem a que se vê e as vizinhas montadas. */
  reel: { preferredForwardBufferDuration: 15, maxBufferBytes: 12 * MB, minBufferForPlayback: 1.5, prioritizeTimeOverSizeThreshold: false },
  /** Vídeos nas bolhas da conversa: parados até a pessoa tocar. */
  chat: { preferredForwardBufferDuration: 10, maxBufferBytes: 4 * MB, minBufferForPlayback: 1, prioritizeTimeOverSizeThreshold: false },
  /** Um só vídeo em ecrã inteiro (mimo, visor, pré-visualização). */
  full: { preferredForwardBufferDuration: 20, maxBufferBytes: 24 * MB, minBufferForPlayback: 1.5, prioritizeTimeOverSizeThreshold: false },
} as const satisfies Record<string, VideoBufferOptions>;

export type VideoBufferKind = keyof typeof VIDEO_BUFFER;

/** Põe o teto de memória num leitor (sem rebentar se o leitor já foi libertado ou a plataforma não tiver a opção). */
export function limitBuffer(player: { bufferOptions?: unknown }, kind: VideoBufferKind): void {
  try {
    player.bufferOptions = { ...VIDEO_BUFFER[kind] };
  } catch { /* leitor libertado ou web: nada a fazer */ }
}

/**
 * O vídeo do feed tem leitor? Só quando o post está à vista (60% do cartão, dito pela lista, e o ecrã à frente) e é a
 * foto/vídeo em cena no carrossel. Ao sair, o leitor é libertado (memória e descodificador) e volta a capa.
 */
export function feedVideoLive({ active, inView }: { active: boolean; inView: boolean }): boolean {
  return active && inView;
}

/**
 * Nas listas de tchekas (ecrã inteiro, uma por página) só a que está em cena e as vizinhas têm o Reel montado (e o seu
 * leitor). O FlatList não desmontava as que ficavam para trás: cada tcheka vista guardava o leitor, o buffer e o
 * descodificador até sair do ecrã (no emulador, 7 leitores criados e nenhum libertado em 8 deslizes).
 */
export function reelMounted(index: number, active: number): boolean {
  return Math.abs(index - active) <= 1;
}
