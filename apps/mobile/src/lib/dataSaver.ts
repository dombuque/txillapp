import { useEffect, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { kvGet, kvSet } from './kv';
import { DATA_SAVER_KEY, isSaving, onSavingChange, readMode, saverActive, setSaving, type DataSaverMode, type NetworkNow } from './dataSaverRules';

/**
 * «Poupar megas»: o modo escolhido (neste aparelho) e a rede de agora decidem se a app está a poupar (lib/dataSaverRules).
 * Na app, a rede vem do expo-network; na web, do navigator.connection (Android/Chrome) e do «Poupar dados» do browser.
 */

let mode: DataSaverMode = 'off';
let net: NetworkNow = { cellular: false, saveData: false };
const modeListeners = new Set<() => void>();
const recompute = () => setSaving(saverActive(mode, net));

interface WebConnection { type?: string; effectiveType?: string; saveData?: boolean; addEventListener?: (e: string, f: () => void) => void }
const webConnection = (): WebConnection | null =>
  Platform.OS === 'web' && typeof navigator !== 'undefined' ? ((navigator as Navigator & { connection?: WebConnection }).connection ?? null) : null;

let started = false;
/** Lê o modo guardado e começa a seguir a rede (uma vez, no arranque da app). */
export function startDataSaver(): void {
  if (started) return;
  started = true;
  void kvGet(DATA_SAVER_KEY).then((raw) => {
    mode = readMode(raw);
    modeListeners.forEach((l) => l());
    recompute();
  });
  if (Platform.OS === 'web') {
    const c = webConnection();
    const read = () => {
      const x = webConnection();
      net = { cellular: x?.type === 'cellular' || x?.effectiveType === '2g' || x?.effectiveType === 'slow-2g', saveData: !!x?.saveData };
      recompute();
    };
    read();
    c?.addEventListener?.('change', read);
    return;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Network = require('expo-network') as typeof import('expo-network');
    const apply = (type?: string) => { net = { cellular: type === Network.NetworkStateType.CELLULAR, saveData: false }; recompute(); };
    void Network.getNetworkStateAsync().then((s) => apply(s.type)).catch(() => undefined);
    Network.addNetworkStateListener((s) => apply(s.type));
  } catch {
    /* app antiga sem o módulo: fica como na escolha 'always' / 'off' */
  }
}

export const dataSaverMode = (): DataSaverMode => mode;
export const onCellular = (): boolean => net.cellular;

export async function setDataSaverMode(m: DataSaverMode): Promise<void> {
  mode = m;
  modeListeners.forEach((l) => l());
  recompute();
  await kvSet(DATA_SAVER_KEY, m);
}

const subscribeMode = (f: () => void) => { modeListeners.add(f); return () => void modeListeners.delete(f); };

/** O modo escolhido (para as Definições). */
export function useDataSaverMode(): DataSaverMode {
  useEffect(() => startDataSaver(), []);
  return useSyncExternalStore(subscribeMode, dataSaverMode, dataSaverMode);
}

/** A app está a poupar agora? (para os vídeos e as pré-descargas) */
export function useSaving(): boolean {
  useEffect(() => startDataSaver(), []);
  return useSyncExternalStore(onSavingChange, isSaving, isSaving);
}
