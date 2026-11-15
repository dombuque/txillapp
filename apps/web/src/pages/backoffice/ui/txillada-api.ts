import { boRaw } from '../../../lib/api';

/** Backoffice › Txilladas ao vivo (os lives, docs/txillada-contrato.md): a lista das que estão a decorrer e o «Cortar». */

export type TxReason = 'spam' | 'harassment' | 'hate' | 'nudity' | 'violence' | 'scam' | 'impersonation' | 'minor' | 'other';

export interface BoTxillada {
  id: string;
  host: { id: string; username: string; displayName: string; avatarUrl: string | null; verified: boolean; verifiedTier: string | null };
  title: string;
  audience: 'everyone' | 'followers' | 'close';
  status: 'live' | 'ended' | 'cut';
  startedAt: string;
  endedAt: string | null;
  viewers: number;
  peakViewers: number;
  cheers: number;
  comments: number;
  /** Denúncias por decidir desta Txillada e os motivos. */
  reports: { open: number; reasons: TxReason[] };
  /** Os últimos comentários (até 5), do mais antigo para o mais recente. */
  lastComments: { id: string; body: string; createdAt: string; username: string }[];
}

export const txApi = {
  list: (): Promise<{ items: BoTxillada[] }> => boRaw('/admin/txilladas'),
  cut: (id: string, reason: string): Promise<void> => boRaw(`/admin/txilladas/${id}/cut`, { method: 'POST', body: JSON.stringify({ reason }) }),
};
