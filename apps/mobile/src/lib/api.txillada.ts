/**
 * A API da Txillada (docs/txillada-contrato.md, prefixo /api/v1, com sessão). O vídeo vai pelo LiveKit (lib/txilladaRoom);
 * aqui só se pedem os acessos (token + url do LiveKit), o estado, os comentários, os brindes e a moderação.
 */
import { useQuery } from '@tanstack/react-query';
import { post, raw } from '@/lib/api';
import { txilladaEnabled, type TxilladaAudience, type TxilladaComment, type TxilladaDto } from '@/lib/txillada';
import type { FxPerson, ReactionKind } from '@/lib/txilladaFx';

export type { TxilladaAudience, TxilladaComment, TxilladaDto } from '@/lib/txillada';

/** O acesso ao LiveKit: o token assinado (com `canPublish` só para o anfitrião) e o endereço do servidor (wss://…). */
export interface TxilladaAccess { token: string; url: string }

const id = (s: string) => encodeURIComponent(s);

export const txilladaApi = {
  /** A Txillada está ligada neste servidor? Um servidor antigo (sem a rota) ou sem resposta: não está. */
  config: async (): Promise<{ enabled: boolean }> => {
    try {
      const r = (await raw('/txilladas/config')) as { enabled?: unknown } | undefined;
      return { enabled: r?.enabled === true };
    } catch {
      return { enabled: false };
    }
  },
  /** Abrir uma Txillada (409 se já tenho uma a decorrer; 403 com a razão se não posso; 503 se não está disponível). */
  start: (title: string, audience: TxilladaAudience): Promise<{ txillada: TxilladaDto } & TxilladaAccess> => raw('/txilladas', post({ title, audience })),
  /** As que estão a decorrer e posso ver (de quem sigo primeiro). */
  live: (): Promise<{ items: TxilladaDto[] }> => raw('/txilladas/live'),
  get: (txilladaId: string): Promise<TxilladaDto> => raw(`/txilladas/${id(txilladaId)}`),
  join: (txilladaId: string): Promise<TxilladaAccess> => raw(`/txilladas/${id(txilladaId)}/join`, post({})),
  end: (txilladaId: string): Promise<TxilladaDto> => raw(`/txilladas/${id(txilladaId)}/end`, post({})),
  /** Os 50 mais recentes (do mais antigo para o mais recente); com `after`, só os que vieram depois desse. */
  comments: (txilladaId: string, after?: string | null): Promise<{ items: TxilladaComment[] }> =>
    raw(`/txilladas/${id(txilladaId)}/comments${after ? `?after=${id(after)}` : ''}`),
  comment: (txilladaId: string, body: string): Promise<TxilladaComment> => raw(`/txilladas/${id(txilladaId)}/comments`, post({ body })),
  removeComment: (txilladaId: string, commentId: string): Promise<void> => raw(`/txilladas/${id(txilladaId)}/comments/${id(commentId)}`, { method: 'DELETE' }),
  /** Brindar um comentário (outra vez tira; no máximo 5 por segundo). A sala recebe `txillada.comment_cheer`. */
  cheerComment: (txilladaId: string, commentId: string): Promise<{ cheered: boolean; cheers: number }> =>
    raw(`/txilladas/${id(txilladaId)}/comments/${id(commentId)}/cheer`, post({})),
  cheer: (txilladaId: string): Promise<{ cheers: number }> => raw(`/txilladas/${id(txilladaId)}/cheer`, post({})),
  ban: (txilladaId: string, username: string): Promise<void> => raw(`/txilladas/${id(txilladaId)}/ban/${id(username)}`, post({})),
  report: (txilladaId: string, reason: string): Promise<void> => raw(`/txilladas/${id(txilladaId)}/report`, post({ reason })),
  /**
   * Uma reação rápida (👋 🍻 🔥 😂 ❤️) a quem está na sala, sem se guardar (o 🍻 conta como um brinde e devolve `cheers`).
   * `to`: só o anfitrião, com 👋, a responder a quem entrou.
   */
  react: (txilladaId: string, kind: ReactionKind, to?: string): Promise<{ sent: boolean; cheers?: number }> =>
    raw(`/txilladas/${id(txilladaId)}/react`, post(to ? { kind, to } : { kind })),
  /** Quem está a ver agora (sem quem tem um bloqueio comigo). */
  viewers: (txilladaId: string): Promise<{ items: FxPerson[]; total: number }> => raw(`/txilladas/${id(txilladaId)}/viewers`),
};

/** A chave da configuração no React Query (o mesmo valor serve Criar e o resto da app). */
export const TXILLADA_CONFIG_KEY = ['txillada-config'] as const;
export const txilladaKey = (txilladaId: string) => ['txillada', txilladaId] as const;

/** A Txillada está ligada? (GET /txilladas/config, guardado 5 min.) Desligada, nada da Txillada aparece. */
export function useTxilladaEnabled(): boolean {
  const q = useQuery({ queryKey: TXILLADA_CONFIG_KEY, queryFn: txilladaApi.config, staleTime: 5 * 60_000, retry: false });
  return txilladaEnabled(q.data);
}
