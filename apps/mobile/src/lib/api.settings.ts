import { post, raw, type Badged } from '@/lib/api';
import type { TasteVisibility } from '@/lib/api.geleira';

/**
 * Definições da geleira (quem a vê; `cheersPublic`: quem a vê vê também quem a brindou, que um servidor antigo não manda)
 * e notificações push: iguais às funções do `api` do site.
 */
/** `bookPublic`: quem vê a geleira vê também o livro das geladas (0145; desligado por omissão; servidor antigo não manda). */
export interface GeleiraSettings { matching: boolean; visibility: TasteVisibility; cheersPublic?: boolean; bookPublic?: boolean }
export const settingsApi = {
  geleiraSettings: (): Promise<GeleiraSettings> => raw('/geleira/me/settings'),
  setGeleiraSettings: (b: { matching?: boolean; visibility?: TasteVisibility; cheersPublic?: boolean; bookPublic?: boolean }): Promise<GeleiraSettings> => raw('/geleira/me/settings', { method: 'PUT', body: JSON.stringify(b) }),
};

export interface ContactMatch extends Badged { username: string; displayName: string; isPrivate: boolean; requested: boolean; followsYou: boolean; mutual: number; reason: string }

export const pushApi = {
  pushKey: (): Promise<{ publicKey: string | null }> => raw('/push/key'),
  pushSubscribe: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }): Promise<void> => raw('/push/subscribe', post(sub)),
  pushTest: (): Promise<void> => raw('/push/test', post({})),
  pushUnsubscribe: (endpoint: string): Promise<void> => raw('/push/subscribe', { method: 'DELETE', body: JSON.stringify({ endpoint }) }),
  matchContacts: (hashes: string[]): Promise<ContactMatch[]> => raw('/contacts/match', post({ hashes })),
};
