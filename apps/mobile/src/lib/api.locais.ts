import { post, raw, type Post } from '@/lib/api';

export type VenueKind = 'bar' | 'restaurante' | 'discoteca' | 'cafe' | 'hotel' | 'evento' | 'outro';
export type ManagerRole = 'admin' | 'editor';
/** O que eu sou nesta página: dono, administrador, editor ou nada. */
export type VenueRole = 'owner' | ManagerRole | null;

/** A página de um local (bar, restaurante, discoteca…), como as páginas do Facebook. */
export interface Venue {
  id: string;
  slug: string;
  name: string;
  kind: VenueKind;
  city: string | null;
  about: string | null;
  address: string | null;
  hours: string | null;
  phone: string | null;
  whatsapp: string | null;
  website: string | null;
  avatarUrl: string | null;
  coverUrl: string | null;
  verified: boolean;
  /** Aprovação pela equipa: em análise, aprovado ou recusado (o motivo só o vê quem gere). */
  reviewStatus?: 'pending' | 'approved' | 'rejected';
  reviewNote?: string | null;
  lat: number | null;
  lng: number | null;
  /** Aparece no mapa do À tua volta (por omissão sim; servidor antigo não manda o campo). */
  showOnMap?: boolean;
  checkins: number;
  checkinsToday: number;
  followers: number;
  posts: number;
  following: boolean;
  role: VenueRole;
  /** Dono ou gestor ativo. */
  mine: boolean;
  canEdit: boolean;
  canPost: boolean;
  /** Convite por aceitar para gerir esta página. */
  invite: ManagerRole | null;
  /** Só os gestores o recebem (para imprimir o QR). */
  qrToken?: string;
  checkedIn: boolean;
  /** O local aceita pagamentos em Txills. */
  acceptsTxills: boolean;
  /** Saldo de Txills do local; só os gestores o recebem. */
  txillsBalance?: number;
  owner?: { username: string; displayName: string };
  createdAt: string;
}

export interface VenueManager { username: string; displayName: string; hasAvatar: boolean; role: 'owner' | ManagerRole; status: 'pending' | 'active'; since?: string }
export interface VenueInsights {
  followers: number; followersWeek: number; checkins: number; checkinsWeek: number; peopleMonth: number;
  posts: number; cheers: number; comments: number; mentions: number; days: { day: string; checkins: number }[];
}
export interface VenueProfileInput {
  name?: string; kind?: VenueKind; city?: string | null; about?: string | null; address?: string | null; hours?: string | null;
  phone?: string | null; whatsapp?: string | null; website?: string | null; lat?: number | null; lng?: number | null;
  avatarMediaId?: string | null; coverMediaId?: string | null;
  /** Aparecer no mapa do À tua volta (por omissão sim). */
  showOnMap?: boolean;
  /** Ligar ou desligar os pagamentos em Txills (dono e administradores). */
  acceptsTxills?: boolean;
}

/** Resposta de um pagamento a um local: o id da transação e o meu saldo depois de pagar. */
export interface VenuePayResult { transactionId: string; balance: number }
/** Um pagamento recebido pelo local: de uma pessoa ou do cofre de um grupo. */
export interface VenuePayment {
  from: { username: string; displayName: string } | { group: { id: string; name: string } };
  amount: number;
  note: string | null;
  at: string;
}
export interface VenuePaymentsPage { items: VenuePayment[]; balance: number; nextCursor: string | null }

/** Tipos novos de movimentos na carteira (pagamentos a locais e cofres dos grupos). */
export type WalletTxType = 'welcome_bonus' | 'transfer' | 'gift' | 'invite' | 'topup' | 'venue_payment' | 'group_contribution' | 'group_refund';
/**
 * Os campos que os movimentos novos trazem a mais: o local (venue_payment) ou o grupo (group_contribution, group_refund).
 * O resto do movimento é o de `WalletView['history']` em api.ts.
 */
export interface WalletTxExtra {
  /** slug e kind a null se o local já não existir (fica o nome guardado no movimento). */
  venue?: { slug: string | null; name: string; kind?: VenueKind | string | null } | null;
  group?: { id: string; name: string } | null;
  /** Do lado de quem recebe um pagamento feito por uma pessoa. */
  from?: { username: string; displayName: string } | null;
  /** O texto já pronto que o servidor manda (reserva, se o cliente não conhecer o tipo). */
  label?: string;
}

/** O artigo certo antes do nome do local ("ao Bar do Ponto", "à discoteca"). */
export const aoLocal = (kind?: string | null) => (kind === 'discoteca' ? 'à' : 'ao');
/** Os primeiros 8 caracteres do id da transação, em maiúsculas, para o recibo. */
export const shortTx = (id: string) => id.replace(/-/g, '').slice(0, 8).toUpperCase();

export interface PlacePage { label: string; mode: 'at' | 'near'; hasNear: boolean; center: { lat: number; lng: number } | null; items: Post[]; nextCursor: string | null }

export const KIND_LABEL: Record<string, string> = { bar: 'Bar', restaurante: 'Restaurante', discoteca: 'Discoteca', cafe: 'Café', hotel: 'Hotel', evento: 'Evento', outro: 'Outro' };
export const KINDS = ['bar', 'restaurante', 'discoteca', 'cafe', 'hotel', 'evento', 'outro'] as const;
export const ROLE_LABEL: Record<'owner' | ManagerRole, string> = { owner: 'Dono', admin: 'Administrador', editor: 'Editor' };

const s = (slug: string) => encodeURIComponent(slug);

export const locaisApi = {
  venue: (slug: string): Promise<Venue> => raw(`/venues/${s(slug)}`),
  findVenue: (name: string): Promise<Venue | null> => raw(`/venues/find?name=${encodeURIComponent(name)}`),
  myVenues: (): Promise<Venue[]> => raw('/venues/mine'),
  myInvites: (): Promise<Venue[]> => raw('/venues/invites'),
  searchVenues: (q: string): Promise<Venue[]> => raw(`/venues/search?q=${encodeURIComponent(q)}`),
  discover: (at?: { lat: number; lng: number } | null): Promise<{ nearby: Venue[]; popular: Venue[] }> => raw(`/venues/discover${at ? `?lat=${at.lat}&lng=${at.lng}` : ''}`),
  createVenue: (b: VenueProfileInput & { name: string; kind: VenueKind }): Promise<Venue> => raw('/venues', post(b)),
  updateVenue: (slug: string, b: VenueProfileInput): Promise<Venue> => raw(`/venues/${s(slug)}`, { method: 'PATCH', body: JSON.stringify(b) }),
  venuePosts: (slug: string, cursor?: string): Promise<{ items: Post[]; nextCursor: string | null }> => raw(`/venues/${s(slug)}/posts${cursor ? `?cursor=${cursor}` : ''}`),
  followVenue: (slug: string, on: boolean): Promise<Venue> => raw(`/venues/${s(slug)}/follow`, { method: on ? 'PUT' : 'DELETE' }),
  managers: (slug: string): Promise<VenueManager[]> => raw(`/venues/${s(slug)}/managers`),
  invite: (slug: string, username: string, role: ManagerRole): Promise<VenueManager[]> => raw(`/venues/${s(slug)}/managers`, post({ username, role })),
  answerInvite: (slug: string, accept: boolean): Promise<Venue> => raw(`/venues/${s(slug)}/managers/${accept ? 'accept' : 'decline'}`, post({})),
  setRole: (slug: string, username: string, role: ManagerRole): Promise<VenueManager[]> => raw(`/venues/${s(slug)}/managers/${encodeURIComponent(username)}`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  removeManager: (slug: string, username: string): Promise<VenueManager[] | { left: true }> => raw(`/venues/${s(slug)}/managers/${encodeURIComponent(username)}`, { method: 'DELETE' }),
  insights: (slug: string): Promise<VenueInsights> => raw(`/venues/${s(slug)}/insights`),
  venueCheckin: (slug: string, token: string): Promise<Venue> => raw(`/venues/${s(slug)}/checkin`, post({ token })),
  rotateVenueQr: (slug: string): Promise<Venue> => raw(`/venues/${s(slug)}/qr/rotate`, post({})),
  /** Pagar ao local com Txills; a mesma `idempotencyKey` nunca paga duas vezes. */
  payVenue: (slug: string, b: { amount: number; note?: string; idempotencyKey: string }): Promise<VenuePayResult> =>
    raw(`/venues/${s(slug)}/pay`, { ...post(b), headers: { 'Idempotency-Key': b.idempotencyKey } }),
  /** Os pagamentos recebidos pelo local (só gestores). */
  venuePayments: (slug: string, cursor?: string): Promise<VenuePaymentsPage> =>
    raw(`/venues/${s(slug)}/payments${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
  placePosts: (label: string, mode: 'at' | 'near', cursor?: string): Promise<PlacePage> =>
    raw(`/feed/place?label=${encodeURIComponent(label)}&mode=${mode}${cursor ? `&cursor=${cursor}` : ''}`),
};
