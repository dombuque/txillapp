/**
 * «Poupar megas» (Definições → Dados e megas): as regras, sem React Native, para se testarem no Node.
 *  - 'off': como sempre; 'mobile': só nos dados móveis (ou quando o browser pede «Poupar dados»); 'always': sempre.
 *  - Ativo: fotos mais leves (480 px nos cartões, 720 px no ecrã inteiro, nunca mais), os vídeos do feed não arrancam
 *    sozinhos (capa e ▶) e não se descarrega o mimo nem a tcheka seguinte antes do tempo.
 * O estado ativo fica aqui num valor do módulo, para o `sized()` (lib/config) o ler sem hooks.
 */

export type DataSaverMode = 'off' | 'mobile' | 'always';
export const DATA_SAVER_MODES: readonly DataSaverMode[] = ['off', 'mobile', 'always'];
export const DATA_SAVER_KEY = 'txill_data_saver_v1';

/** A rede de agora: dados móveis, e se o browser pede para poupar dados (o «Save-Data» do Chrome). */
export interface NetworkNow { cellular: boolean; saveData: boolean }

export const readMode = (raw: string | null | undefined): DataSaverMode => (DATA_SAVER_MODES.includes(raw as DataSaverMode) ? (raw as DataSaverMode) : 'off');

/** O modo está a poupar agora? */
export function saverActive(mode: DataSaverMode, net: NetworkNow): boolean {
  if (mode === 'always') return true;
  if (mode === 'mobile') return net.cellular || net.saveData;
  return false;
}

/** A largura de foto a pedir com o modo ativo: até 480 nos cartões, até 720 no ecrã inteiro (nunca se aumenta). */
export function savedWidth(width: number): number {
  if (width > 720) return 720;
  if (width > 480) return 480;
  return width;
}

let active = false;
const listeners = new Set<() => void>();

export const isSaving = (): boolean => active;
export function setSaving(on: boolean): void {
  if (on === active) return;
  active = on;
  listeners.forEach((l) => l());
}
export function onSavingChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** O aviso «Estás nos dados móveis» no Início: uma só vez, a quem tem o modo desligado e está nos dados móveis. */
export const shouldHintSaver = (mode: DataSaverMode, net: NetworkNow, alreadyShown: boolean): boolean => mode === 'off' && net.cellular && !alreadyShown;
export const DATA_SAVER_HINT_KEY = 'txill_data_saver_hint_v1';
