import { Platform } from 'react-native';

/**
 * Rascunhos de publicações (iguais aos do site, apps/web/src/lib/draft.ts): vários por conta, só neste aparelho.
 * Chave `utilizador:hora`; o mais recente primeiro.
 *
 * LIMITAÇÃO (a resolver): a app ainda não tem armazenamento local para textos grandes.
 * Nem @react-native-async-storage/async-storage nem expo-file-system estão em package.json, e o expo-secure-store não serve
 * (limite pequeno por valor). Por isso:
 *   - na web os rascunhos ficam no localStorage do browser (persistem);
 *   - na app nativa ficam só em memória (valem enquanto a app está aberta, perdem-se ao fechá-la).
 * Para persistir na app nativa: `npx expo install @react-native-async-storage/async-storage` e trocar `native` mais abaixo
 * por um backend com getItem/setItem desse pacote (é o único sítio a mudar).
 *
 * As fotos guardam-se como endereços (uri) dos ficheiros escolhidos, não os bytes. Na web os endereços `blob:` morrem ao
 * recarregar a página, por isso lá só o texto e o local são recuperáveis; na app nativa os ficheiros da cache costumam durar.
 */
export interface Draft {
  body: string;
  place: string;
  /** Endereços das fotos/vídeo escolhidos (mesma ordem em `video`). */
  photos: { uri: string; video?: boolean; mime?: string; durationMs?: number; signed?: boolean }[];
  /** Pessoas identificadas em cada foto (mesma ordem de `photos`). */
  tags?: { username: string; displayName: string; x: number; y: number }[][];
  savedAt: number;
}
export interface DraftItem extends Draft { key: string }

const STORE_KEY = 'txill.drafts.v1';
type All = Record<string, Draft>;

interface Backend { read(): Promise<All>; write(all: All): Promise<void> }

let memory: All = {};
const native: Backend = {
  read: async () => memory,
  write: async (all) => { memory = all; },
};
const web: Backend = {
  read: async () => {
    try {
      return JSON.parse(globalThis.localStorage?.getItem(STORE_KEY) ?? '{}') as All;
    } catch {
      return {};
    }
  },
  write: async (all) => {
    try {
      globalThis.localStorage?.setItem(STORE_KEY, JSON.stringify(all));
    } catch {
      /* cheio ou bloqueado: falha em silêncio, como no site */
    }
  },
};
const backend: Backend = Platform.OS === 'web' ? web : native;

/** Chave nova para um rascunho desta conta. */
export const newDraftKey = (username: string) => `${username}:${Date.now()}`;

/** Os rascunhos desta conta, do mais recente para o mais antigo. */
export async function listDrafts(username: string): Promise<DraftItem[]> {
  const all = await backend.read();
  return Object.entries(all)
    .filter(([k]) => k === username || k.startsWith(`${username}:`))
    .map(([key, d]) => ({ ...d, key }))
    .sort((a, b) => b.savedAt - a.savedAt);
}

export async function loadDraft(key: string): Promise<DraftItem | undefined> {
  const d = (await backend.read())[key];
  return d ? { ...d, key } : undefined;
}

export async function saveDraft(key: string, d: Omit<Draft, 'savedAt'>): Promise<void> {
  const all = await backend.read();
  await backend.write({ ...all, [key]: { ...d, savedAt: Date.now() } });
}

export async function clearDraft(key: string): Promise<void> {
  const { [key]: _gone, ...rest } = await backend.read();
  await backend.write(rest);
}
