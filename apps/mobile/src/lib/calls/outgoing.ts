/**
 * Quem liga: «A chamar…» até o telemóvel do outro lado dizer que a chamada lhe chegou (evento `ringing` do servidor,
 * POST /calls/:id/ringing do outro lado), e «A tocar…» a partir daí, como no WhatsApp. Sem entrega ao fim de
 * UNREACHABLE_MS aparece uma linha discreta «Sem resposta do telemóvel de X»; a chamada continua a chamar até ao fim
 * do tempo de toque de sempre (não desliga sozinha mais cedo).
 *
 * Sem react-native, para os testes (tests/callRinging.test.mjs). O session.ts usa estas regras.
 */
import type { CallState } from './types';

/** Sem entrega há este tempo: mostra-se a linha «Sem resposta do telemóvel de X». */
export const UNREACHABLE_MS = 15_000;

type View = Pick<CallState, 'phase' | 'outgoing' | 'callId' | 'delivered' | 'unreachable'>;

/** O texto por baixo do nome, enquanto liga: ainda sem resposta do servidor, a chamar, ou já a tocar do outro lado. */
export function outgoingLabel(s: Pick<CallState, 'callId' | 'delivered'>): string {
  if (!s.callId) return 'A ligar…';
  return s.delivered ? 'A tocar…' : 'A chamar…';
}

/** A linha discreta quando o telemóvel do outro lado não responde (null: não se mostra). */
export function unreachableText(s: Pick<CallState, 'phase' | 'delivered' | 'unreachable' | 'peer'>): string | null {
  if (s.phase !== 'outgoing' || s.delivered || !s.unreachable) return null;
  const who = s.peer?.displayName?.trim() || (s.peer?.username ? `@${s.peer.username}` : '');
  return who ? `Sem resposta do telemóvel de ${who}` : 'Sem resposta do telemóvel';
}

/** Chegou o `ringing` desta chamada: o que muda no estado (null: nada, por exemplo noutra chamada ou já atendida). */
export function afterDelivered(s: View, callId: string): Partial<CallState> | null {
  if (s.phase !== 'outgoing' || !s.outgoing || s.callId !== callId || s.delivered) return null;
  return { delivered: true, unreachable: false };
}

/** Passou UNREACHABLE_MS sem entrega: o que muda (null: já chegou, ou já não está a chamar). */
export function afterUnreachable(s: View): Partial<CallState> | null {
  if (s.phase !== 'outgoing' || !s.outgoing || !s.callId || s.delivered || s.unreachable) return null;
  return { unreachable: true };
}
