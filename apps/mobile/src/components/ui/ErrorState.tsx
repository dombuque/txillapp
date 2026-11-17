import type { StyleProp, ViewStyle } from 'react-native';
import { EmptyState } from '../Empty';

export type ErrorStateProps = {
  /** O que não carregou («as mensagens», «a carteira»…): o título fica «Ups, não consegui carregar {what}». */
  what?: string;
  /** Título próprio (em vez do de `what`). */
  title?: string;
  /** Por omissão «Verifica a ligação e tenta outra vez.» */
  text?: string;
  /** Sem `onRetry` não há botão (só quando não há nada a repetir). */
  onRetry?: () => void;
  retryLabel?: string;
  dark?: boolean;
  style?: StyleProp<ViewStyle>;
};

export const errorTitle = (what?: string) => (what ? `Ups, não consegui carregar ${what}` : 'Ups, algo falhou');
export const ERROR_TEXT = 'Verifica a ligação e tenta outra vez.';

/**
 * Erro que bloqueia o ecrã: ícone `alert`, «Ups, não consegui carregar…», «Verifica a ligação e tenta outra vez.» e o
 * botão cinzento «Tentar outra vez». Erros passageiros (uma ação que falhou) vão para `showToast`.
 */
export function ErrorState({ what, title, text, onRetry, retryLabel = 'Tentar outra vez', dark, style }: ErrorStateProps) {
  return (
    <EmptyState
      icon="alert"
      title={title ?? errorTitle(what)}
      text={text ?? ERROR_TEXT}
      action={onRetry ? { label: retryLabel, onPress: onRetry, kind: 'secondary' } : undefined}
      dark={dark}
      style={style}
    />
  );
}
