/** No browser as notificações são as do browser (lib/push): estas funções não fazem nada. */
export const notificationsGranted = async () => false;
export const hasNativeToken = async () => false;
export const askNotifications = async () => false;
export const registerNativePush = async () => undefined;
export const unregisterNativePush = async () => undefined;
export const onNotificationOpen = (_go: (url: string) => void) => () => undefined;
