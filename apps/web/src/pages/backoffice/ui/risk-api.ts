import { boRaw } from '../../../lib/api';

/** Backoffice › Contas suspeitas: a fila das contas novas com pontuação de risco alta e as decisões da equipa. */

export type RiskState = 'flagged' | 'limited' | 'cleared' | 'suspended';
export type RiskDecision = 'clear' | 'limit' | 'suspend';

export interface RiskItem {
  user: { id: string; username: string; displayName: string; emailDomain: string | null; emailVerified: boolean; createdAt: string; status: string };
  score: number;
  signals: { id: string; label: string; points: number }[];
  state: RiskState;
  client: 'web' | 'app' | 'other' | null;
  human: boolean;
  flaggedAt: string | null;
  limitedUntil: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  related: { sameIp: number; sameDevice: number; sameEmail: number };
  activity: { following: number; posts: number; messages: number; reports: number; invitedBy: string | null };
}

export interface RiskQueue {
  items: RiskItem[];
  counts: Record<RiskState, number>;
  nextCursor: string | null;
}

export const RISK_TABS: { id: RiskState; label: string; tone?: 'red' | 'amber' }[] = [
  { id: 'flagged', label: 'Por rever', tone: 'red' },
  { id: 'limited', label: 'Limitadas', tone: 'amber' },
  { id: 'cleared', label: 'Verdadeiras' },
  { id: 'suspended', label: 'Suspensas' },
];

/** O tom da pontuação: 80+ vermelho, 50+ âmbar. */
export const scoreTone = (s: number): 'red' | 'amber' | 'zinc' => (s >= 80 ? 'red' : s >= 50 ? 'amber' : 'zinc');

export const riskApi = {
  queue: (state: RiskState, cursor?: string) =>
    boRaw(`/admin/risk?${new URLSearchParams({ state, ...(cursor ? { cursor } : {}) }).toString()}`) as Promise<RiskQueue>,
  decide: (userId: string, decision: RiskDecision, reason: string) =>
    boRaw(`/admin/risk/${userId}/decide`, { method: 'POST', body: JSON.stringify({ decision, reason }) }) as Promise<{ state: RiskState }>,
};
