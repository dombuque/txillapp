/**
 * O convite «Encontra amigos nos teus contactos» no Início, para quem ainda não deu a permissão: de tempos a tempos, nunca
 * insistente. É um cartão da app (não a janela do sistema): «Procurar» abre «Amigos nos contactos», que pede a permissão.
 *  - «Agora não» guarda a data; volta a aparecer ao fim de 7, 21 e 45 dias; depois de 4 «Agora não», nunca mais.
 *  - Permissão dada: nunca mais.
 *  - Recusada de vez no sistema (o Android já não deixa pedir): aparece uma só vez, com «Abrir as definições».
 * O estado fica só neste aparelho. Funções puras (testadas no Node); quem lê o aparelho é o componente ContactsNudge.
 */

export const NUDGE_KEY = 'txill_contacts_nudge_v1';
/** Dias de espera depois de cada «Agora não» (o 1.º convite aparece logo). */
export const NUDGE_GAPS_DAYS: readonly number[] = [7, 21, 45];
/** Ao fim de tantos «Agora não», o convite não volta. */
export const NUDGE_MAX_DISMISSALS = 4;

export interface NudgeState { dismissed: number; lastAt: number; deniedShown: boolean }
export type ContactsPermission = { status: 'granted' | 'denied' | 'undetermined'; canAskAgain: boolean };

export const emptyNudge = (): NudgeState => ({ dismissed: 0, lastAt: 0, deniedShown: false });

export function readNudge(raw: string | null): NudgeState {
  try {
    const v = JSON.parse(raw ?? 'null') as Partial<NudgeState> | null;
    if (v && typeof v === 'object') return { dismissed: Number(v.dismissed) || 0, lastAt: Number(v.lastAt) || 0, deniedShown: !!v.deniedShown };
  } catch {
    /* valor por omissão */
  }
  return emptyNudge();
}

/** Que convite mostrar agora: 'ask' (procurar), 'settings' (recusado de vez: abrir as definições) ou null. */
export function nudgeMode(s: NudgeState, perm: ContactsPermission, now = Date.now()): 'ask' | 'settings' | null {
  if (perm.status === 'granted') return null;
  if (perm.status === 'denied' && !perm.canAskAgain) return s.deniedShown ? null : 'settings';
  if (s.dismissed >= NUDGE_MAX_DISMISSALS) return null;
  if (s.dismissed === 0) return 'ask';
  const gap = NUDGE_GAPS_DAYS[Math.min(s.dismissed, NUDGE_GAPS_DAYS.length) - 1] * 86_400_000;
  return now - s.lastAt >= gap ? 'ask' : null;
}

/** «Agora não»: mais um, com a data de hoje. No modo 'settings', fica marcado que já se mostrou. */
export const dismissNudge = (s: NudgeState, mode: 'ask' | 'settings', now = Date.now()): NudgeState =>
  mode === 'settings' ? { ...s, deniedShown: true, lastAt: now } : { ...s, dismissed: s.dismissed + 1, lastAt: now };
