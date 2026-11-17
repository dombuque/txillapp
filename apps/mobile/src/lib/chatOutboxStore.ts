import { File, Paths } from 'expo-file-system';

/**
 * Onde ficam as mensagens à espera de rede (lib/chatPending) na app nativa: um ficheiro pequeno por conta na pasta da app.
 * O cofre (expo-secure-store) não serve: tem um limite pequeno por valor. Na web é o localStorage (chatOutboxStore.web.ts).
 */
const file = (user: string) => new File(Paths.document, `tx-chat-outbox-${user.replace(/[^A-Za-z0-9_-]/g, '')}.json`);

export function loadOutbox(user: string): string | null {
  try {
    const f = file(user);
    return f.exists ? f.textSync() : null;
  } catch {
    return null;
  }
}

/** `null` apaga (sem nada à espera, ou ao terminar sessão). */
export function saveOutbox(user: string, data: string | null): void {
  try {
    const f = file(user);
    if (data === null) {
      if (f.exists) f.delete();
      return;
    }
    if (!f.exists) f.create({ intermediates: true });
    f.writeSync(data);
  } catch {
    /* sem espaço ou sem acesso: fica só em memória */
  }
}
