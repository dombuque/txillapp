import { useEffect, useRef } from 'react';
import { Modal as RNModal, Platform, type ModalProps } from 'react-native';
import { webBack } from '@/lib/webBack';

/** No iPhone (Safari e PWA) o arrastar para trás já mostra o ecrã de baixo: a camada fecha logo, sem animar outra vez. */
export const iosWeb =
  Platform.OS === 'web' &&
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

/**
 * Enquanto `active`, o «voltar» do browser (e arrastar para trás no PWA do iPhone) chama `onBack` em vez de sair do ecrã.
 * No telemóvel não faz nada: lá o botão voltar do Android já chega ao `onRequestClose` do Modal.
 */
export function useWebBack(active: boolean, onBack?: () => void) {
  const ref = useRef(onBack);
  ref.current = onBack;
  const on = active && !!onBack;
  useEffect(() => {
    if (Platform.OS !== 'web' || !on) return;
    return webBack()?.open(() => ref.current?.());
  }, [on]);
}

/**
 * O Modal do React Native, mas com o «voltar» da web: fecha a camada (o mesmo que o botão voltar do Android) e fica no ecrã.
 * `onWebBack` serve quando o «voltar» deve fazer outra coisa que não o `onRequestClose` (ex.: fechar sem animar).
 */
export function Modal({ onWebBack, ...props }: ModalProps & { onWebBack?: () => void }) {
  const close = props.onRequestClose as (() => void) | undefined;
  useWebBack(props.visible !== false, onWebBack ?? close);
  return <RNModal {...props} />;
}
