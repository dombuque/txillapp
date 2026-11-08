import { Platform, useWindowDimensions } from 'react-native';

/** A partir desta largura (no browser) a app usa o modo computador: barra lateral, conteúdo largo, sem a barra de baixo. */
export const DESKTOP_MIN = 1024;

export function useDesktop(): boolean {
  const { width } = useWindowDimensions();
  return Platform.OS === 'web' && width >= DESKTOP_MIN;
}

/** Medidas do modo computador: barra lateral com nomes (≥ 1264) ou só ícones, e a coluna da direita do Início (≥ 1180). */
export function useDesktopSizes() {
  const { width } = useWindowDimensions();
  const desktop = Platform.OS === 'web' && width >= DESKTOP_MIN;
  return { desktop, labels: width >= 1264, rightRail: width >= 1180 };
}
