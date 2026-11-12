/**
 * Sair de um ecrã de criação sem perder o trabalho sem aviso (o × e o botão de voltar do Android).
 *
 * No editor do mimo a foto ou o vídeo acabou de ser tirado: fechar perde-o sempre, por isso pergunta-se sempre.
 * "Tirar outra" só perde o que se juntou (legenda, stickers, música): pergunta-se só quando há alguma coisa.
 */
export interface MimoEdits {
  caption: string;
  stickers: number;
  music: boolean;
}

export const mimoEdited = (e: MimoEdits): boolean => e.caption.trim().length > 0 || e.stickers > 0 || e.music;

/** O texto da pergunta, igual ao resto da app (título com "?", Cancelar e o botão vermelho). */
export function discardCopy(kind: 'mimo' | 'retake' | 'video', video = false) {
  if (kind === 'video') return { title: 'Descartar o vídeo?', message: 'O vídeo que gravaste perde-se.', keep: 'Continuar', discard: 'Descartar' };
  if (kind === 'retake') return { title: 'Tirar outra?', message: 'A legenda, os stickers e a música que juntaste perdem-se.', keep: 'Cancelar', discard: 'Tirar outra' };
  return { title: 'Descartar o mimo?', message: video ? 'O vídeo e o que lhe juntaste perdem-se.' : 'A foto e o que lhe juntaste perdem-se.', keep: 'Continuar a editar', discard: 'Descartar' };
}
