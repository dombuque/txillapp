import { useEffect, useState } from 'react';
import { Alert, Platform } from 'react-native';

export type AlertButton = { text?: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => void };
export type AlertRequest = { id: number; title: string; message?: string; buttons: AlertButton[] };

let current: AlertRequest | null = null;
let n = 0;
const listeners = new Set<(r: AlertRequest | null) => void>();
const emit = () => listeners.forEach((l) => l(current));

/**
 * Na web o `Alert.alert` do React Native não faz nada (por isso apagar, sair da conta, etc. deixavam de funcionar).
 * Aqui passa a abrir a caixa de confirmação da app (`AlertHost`), com os mesmos botões.
 */
export function installWebAlert() {
  if (Platform.OS !== 'web') return;
  Alert.alert = (title: string, message?: string, buttons?: AlertButton[]) => {
    current = { id: ++n, title, message, buttons: buttons && buttons.length ? buttons : [{ text: 'OK' }] };
    emit();
  };
}

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
