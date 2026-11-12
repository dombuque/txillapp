import { post, raw } from '@/lib/api';
import { track, trackOk } from '@/lib/analytics';

/**
 * Chamadas à API que ainda não estão em api.ts (cópia das do site, apps/web/src/lib/api.ts).
 * Quando alguém juntar isto a api.ts, basta apagar este ficheiro e trocar os imports.
 */

export interface InsightsBucket { label: string; value: number; pct: number }
export interface Insights {
  days: number;
  overview: { reach: number; reachDelta: number; interactions: number; interactionsDelta: number; followers: number; newFollowers: number; newFollowersDelta: number; profileVisitors: number; profileVisitorsDelta: number; storyViews: number };
  interactions: { cheers: number; comments: number; reposts: number; gifts: number; storyCheers: number; storyReplies: number };
  series: { day: string; reach: number; interactions: number; followers: number }[];
  hours: { hour: number; value: number }[];
  weekdays: { dow: number; value: number }[];
  top: { id: string; code: string; body: string; mediaUrl: string | null; video: boolean; tcheka?: boolean; createdAt: string; cheers: number; comments: number; reposts: number; gifts: number; reach: number }[];
  audience: { enough: false; minimum: number; followers: number } | { enough: true; followers: number; gender: InsightsBucket[]; ages: InsightsBucket[]; countries: InsightsBucket[]; cities: InsightsBucket[]; interests: InsightsBucket[] };
}

export interface PaymentPackage { id: string; name: string; txills: number; priceMinor: number; currency: string }
export interface PaymentsConfig { /** Interruptor da recarga nas versões das lojas (ver lib/storeRules.ts). Servidores antigos não o mandam. */ storeTopup?: boolean; providers: { id: 'sandbox' | 'mpesa' | 'emola' | 'card'; label: string; needsPhone: boolean }[]; packages: PaymentPackage[] }
export interface PaymentOrder { id: string; packageId: string; txills: number; amountMinor: number; currency: string; provider: string; status: 'pending' | 'paid' | 'failed' | 'cancelled' | 'expired'; phoneTail: string | null; createdAt: string; paidAt: string | null }

export interface ChatSendBody { body?: string; kind?: 'text' | 'post'; replyTo?: string }

/** Identificador aleatório (v4) para o cabeçalho Idempotency-Key; não depende de crypto.randomUUID (que o Hermes pode não ter). */
export const newKey = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = Math.floor(Math.random() * 16);
  return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
});

export const extraApi = {
  insights: (days: 7 | 30 | 90, tz: number): Promise<Insights> => raw(`/insights?days=${days}&tz=${tz}`),
  paymentsConfig: (): Promise<PaymentsConfig> => raw('/payments/config'),
  paymentsOrders: (): Promise<PaymentOrder[]> => raw('/payments/orders'),
  paymentsOrder: (id: string): Promise<PaymentOrder> => raw(`/payments/orders/${id}`),
  paymentsCreate: (b: { packageId: string; provider: string; phone?: string }, key: string): Promise<PaymentOrder> =>
    raw('/payments/orders', { ...post(b), headers: { 'Idempotency-Key': key } }),
  paymentsCancel: (id: string): Promise<void> => raw(`/payments/orders/${id}/cancel`, post({})),
  paymentsSandboxPay: (id: string): Promise<PaymentOrder> => raw(`/payments/orders/${id}/sandbox-pay`, post({})),
  chatGroupSend: (id: string, msg: ChatSendBody): Promise<{ id: string }> =>
    trackOk(raw(`/chat/groups/${id}/messages`, post(msg)), 'message_send', () => {
      if (msg.kind === 'post') track('share', { target: 'chat' });
      return { kind: msg.kind ?? 'text', group: true };
    }),
  shareToStory: (postId: string, audience: 'all' | 'close_friends' = 'all', caption = '', stickers: { id: string; x: number; y: number; s: number; r: number }[] = []): Promise<{ id: string }> =>
    trackOk(raw('/stories/share', post({ postId, audience, caption, stickers })), 'share', () => {
      track('story_create', { source: 'share', closeFriends: audience === 'close_friends' });
      return { target: 'story' };
    }),
};
