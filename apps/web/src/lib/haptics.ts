import { isNative } from './native';

/**
 * Vibração de resposta ao toque. Na app usa o motor háptico do telemóvel (mais fino que a vibração do browser);
 * no browser usa `navigator.vibrate`, quando existe.
 */
export function buzz(ms = 10) {
  if (isNative()) {
    void import('@capacitor/haptics')
      .then(({ Haptics, ImpactStyle }) => Haptics.impact({ style: ms >= 18 ? ImpactStyle.Medium : ImpactStyle.Light }))
      .catch(() => undefined);
    return;
  }
  navigator.vibrate?.(ms);
}
