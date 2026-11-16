import { post, raw, type Badged } from '@/lib/api';
import type { MixarTopic } from '@/lib/api.mixar';

/**
 * Mixar: avisos e descoberta (0170, docs/mixar-contrato.md «Avisos e descoberta»): a abertura sincronizada (a bolinha azul
 * igual em todos os aparelhos) e as sugestões «Faz um Mixar com…».
 */

/** Uma pessoa sugerida: falamos muito, seguimo-nos e os gostos batem (`match` de 0 a 100, os temas em comum até 3). */
export interface MixarSuggestion extends Badged {
  username: string;
  displayName: string;
  hasAvatar: boolean;
  match: number;
  common: MixarTopic[];
}

export const mixarAvisosApi = {
  /** Abri o Mixar (idempotente): devolve a abertura guardada. 404 em servidores antigos (a app usa então só o aparelho). */
  open: (id: string): Promise<{ openedAt: string }> => raw(`/mixar/${id}/open`, post({})),
  /** Até 3 sugestões. */
  suggestions: (): Promise<{ items: MixarSuggestion[] }> => raw('/mixar/suggestions'),
  /** «Agora não»: esta pessoa sai das sugestões durante 30 dias (guardado no servidor). */
  dismiss: (username: string): Promise<void> => raw(`/mixar/suggestions/${encodeURIComponent(username)}/dismiss`, post({})),
};

export const mixarAvisosKeys = {
  suggestions: () => ['mixar-suggestions'] as const,
};
