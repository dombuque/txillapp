import { post, raw } from '@/lib/api';
import type { TasteVisibility } from '@/lib/api.geleira';

/** Definições da geleira (quem a vê) e notificações push: iguais às funções do `api` do site. */
export const settingsApi = {
  geleiraSettings: (): Promise<{ matching: boolean; visibility: TasteVisibility }> => raw('/geleira/me/settings'),
  setGeleiraSettings: (b: { matching?: boolean; visibility?: TasteVisibility }): Promise<{ matching: boolean; visibility: TasteVisibility }> => raw('/geleira/me/settings', { method: 'PUT', body: JSON.stringify(b) }),
};

export interface ContactMatch { username: string; displayName: string; isPrivate: boolean; requested: boolean; followsYou: boolean; mutual: number; reason: string }

export const pushApi = {
  pushKey: (): Promise<{ publicKey: string | null }> => raw('/push/key'),
  pushSubscribe: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }): Promise<void> => raw('/push/subscribe', post(sub)),
  pushTest: (): Promise<void> => raw('/push/test', post({})),
  pushUnsubscribe: (endpoint: string): Promise<void> => raw('/push/subscribe', { method: 'DELETE', body: JSON.stringify({ endpoint }) }),
  matchContacts: (hashes: string[]): Promise<ContactMatch[]> => raw('/contacts/match', post({ hashes })),
};
