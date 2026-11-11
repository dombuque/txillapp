import { File, Paths } from 'expo-file-system';
import type { Queued } from './analytics';

/**
 * Onde ficam os eventos de uso por enviar (sem rede) na app nativa: um ficheiro pequeno na pasta da app (até 200 eventos).
 * O cofre (expo-secure-store) não serve: tem um limite pequeno por valor. Na web é o localStorage (analyticsStore.web.ts).
 * A escrita é síncrona para dar tempo de guardar antes de a app fechar por um erro fatal.
 */
const file = () => new File(Paths.document, 'tx-analytics-queue.json');

export function saveQueue(items: Queued[]): void {
  try {
    const f = file();
    if (!items.length) {
      if (f.exists) f.delete();
      return;
    }
    if (!f.exists) f.create({ intermediates: true });
    f.writeSync(JSON.stringify(items));
  } catch {
    /* sem espaço ou sem acesso: fica só em memória */
  }
}

export function loadQueue(): Queued[] {
  try {
    const f = file();
    return f.exists ? (JSON.parse(f.textSync()) as Queued[]) : [];
  } catch {
    return [];
  }
}
