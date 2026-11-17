/**
 * Sair de um ecrã de criação sem perder o trabalho sem aviso (o × e o botão de voltar do Android).
 *
 * No editor do mimo a foto ou o vídeo acabou de ser tirado: fechar perde-o sempre, por isso pergunta-se sempre.
 * "Tirar outra" só perde o que se juntou (legenda, stickers, textos, música): pergunta-se só quando há alguma coisa.
 */
import { t } from '@/lib/i18n';
export interface MimoEdits {
  caption: string;
  stickers: number;
  /** Os textos escritos por cima (contam à parte dos stickers). */
  texts?: number;
  music: boolean;
}

export const mimoEdited = (e: MimoEdits): boolean => e.caption.trim().length > 0 || e.stickers > 0 || (e.texts ?? 0) > 0 || e.music;

/** O texto da pergunta, igual ao resto da app (título com "?", Cancelar e o botão vermelho). */
export function discardCopy(kind: 'mimo' | 'retake' | 'video', video = false) {
  if (kind === 'video') return { title: t('Descartar o vídeo?'), message: t('O vídeo que gravaste perde-se.'), keep: t('Continuar'), discard: t('Descartar') };
  if (kind === 'retake') return { title: t('Tirar outra?'), message: t('A legenda, os stickers, os textos e a música que juntaste perdem-se.'), keep: t('Cancelar'), discard: t('Tirar outra') };
  return { title: t('Descartar o mimo?'), message: video ? t('O vídeo e o que lhe juntaste perdem-se.') : t('A foto e o que lhe juntaste perdem-se.'), keep: t('Continuar a editar'), discard: t('Descartar') };
}
