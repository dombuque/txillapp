import { requireOptionalNativeModule, type EventSubscription } from 'expo';
import { Platform } from 'react-native';
import { createCallServiceSync, type CallServiceNative } from './callService';
import { getCall, hangUp, onCallState } from './session';

interface TxCallServiceModule extends CallServiceNative {
  addListener(event: 'onHangUp', listener: () => void): EventSubscription;
}

/** O módulo local modules/call-service. Só existe no Android; num APK feito antes dele, também não. */
const native = Platform.OS === 'android' ? requireOptionalNativeModule<TxCallServiceModule>('TxCallService') : null;

/**
 * Liga o serviço das chamadas ao estado da chamada (Android). Devolve a função que desliga tudo.
 * No iPhone e na web não faz nada.
 */
export function installCallService(): () => void {
  if (!native) return () => undefined;
  // Se o JS recarregou a meio de uma chamada, pode ter ficado um serviço sem dono: começa limpo.
  try { native.stop(); } catch { /* nada a parar */ }
  const svc = createCallServiceSync(native);
  svc.sync(getCall());
  const off = onCallState(() => svc.sync(getCall()));
  // «Desligar» na notificação.
  const sub = native.addListener('onHangUp', () => hangUp());
  return () => {
    off();
    sub.remove();
    svc.dispose();
  };
}
