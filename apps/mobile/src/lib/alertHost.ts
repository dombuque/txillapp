import { useEffect, useState } from 'react';
import { Alert } from 'react-native';

export type AlertButton = { text?: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => void };
export type AlertRequest = { id: number; title: string; message?: string; buttons: AlertButton[]; onDismiss?: () => void };

let current: AlertRequest | null = null;
let n = 0;
const listeners = new Set<(r: AlertRequest | null) => void>();
const emit = () => listeners.forEach((l) => l(current));

/**
 * Abre a caixa de confirmação da app (`AlertHost`). Se já houver uma aberta, a nova substitui-a e a antiga é dada como
 * fechada sem resposta (`onDismiss`), para quem espera por ela (lib/confirm) não ficar à espera para sempre.
 */
export function openAlert(title: string, message?: string, buttons?: AlertButton[], onDismiss?: () => void) {
  const prev = current;
  current = { id: ++n, title, message, buttons: buttons && buttons.length ? buttons : [{ text: 'OK' }], onDismiss };
  emit();
  prev?.onDismiss?.();
}

/**
 * O `Alert.alert` do React Native passa a abrir a caixa da app (`AlertHost`), com os mesmos botões, em todo o lado:
 * na web o original não fazia nada (apagar, sair da conta… deixavam de funcionar) e no APK era a caixa do Android,
 * com outro aspeto. Assim o mesmo «Apagar?» é igual no telemóvel e no site.
 */
export function installAlert() {
  Alert.alert = (title: string, message?: string, buttons?: AlertButton[]) => openAlert(title, message, buttons);
}

/** Nome antigo de `installAlert` (antes só se ligava na web). */
export const installWebAlert = installAlert;

export function closeAlert(btn?: AlertButton) {
  current = null;
  emit();
  btn?.onPress?.();
}

export function useAlertRequest(): AlertRequest | null {
  const [r, setR] = useState<AlertRequest | null>(current);
  useEffect(() => {
    listeners.add(setR);
    return () => void listeners.delete(setR);
  }, []);
  return r;
}
