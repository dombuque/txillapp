/**
 * No telemóvel, `@/lib/studio/magicAnalyze` é este ficheiro (o Metro escolhe o `.native.ts`): a mesma API do site sem nada
 * do browser (<img>, <video>, canvas, Web Audio), para o código do site não entrar na app. A análise a sério está em
 * magicAnalyzeNative.ts; o estúdio nativo passa-a à `MagicMontage` com a grelha dos frames e os envios.
 */
import { coarseToFine, neutralItem, type MagicPhase, type MagicSource, type MusicInfo, type WaveId } from './magic';
import { analyzeMusicNativeMagic, analyzeSourcesNative, clearNativeMagicCache } from './magicAnalyzeNative';

export interface AnalyzeOptions {
  budgetMs?: number;
  onPhase?: (phase: MagicPhase, state: 'start' | 'done') => void;
  signal?: { cancelled: boolean };
}

export { coarseToFine };
export const neutral = (s: MagicSource) => neutralItem(s);
export const clearMagicCache = () => clearNativeMagicCache();
export const analyzeSources = (sources: MagicSource[], opts: AnalyzeOptions = {}) => analyzeSourcesNative(sources, opts);
export const analyzeMusic = (url: string | null | undefined, wave: WaveId, windowS: number, _opts: AnalyzeOptions = {}): Promise<MusicInfo | null> => analyzeMusicNativeMagic(url, wave, windowS);
