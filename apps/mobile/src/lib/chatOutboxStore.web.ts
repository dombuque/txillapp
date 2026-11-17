/** Na web as mensagens à espera de rede (lib/chatPending) ficam no localStorage deste browser, por conta (ver chatOutboxStore.ts). */
const key = (user: string) => `txill.chatOutbox.${user}`;

export function loadOutbox(user: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key(user)) ?? null;
  } catch {
    return null;
  }
}

/** `null` apaga (sem nada à espera, ou ao terminar sessão). */
export function saveOutbox(user: string, data: string | null): void {
  try {
    if (data === null) globalThis.localStorage?.removeItem(key(user));
    else globalThis.localStorage?.setItem(key(user), data);
  } catch {
    /* browser sem espaço ou em modo privado: fica só em memória */
  }
}
