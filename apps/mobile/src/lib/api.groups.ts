/**
 * TxillGroups: os grupos de chat com nome, tipo, capa, Plano (viagem, festa, fim de semana), álbum e vaquinha de Txills.
 * Só usa `raw`/`post` de '@/lib/api'. As conversas e os membros continuam em '@/lib/api.grupos'.
 */
import { post, raw, type GroupSummary } from '@/lib/api';
import { newKey } from '@/lib/api.extra';
import type { GroupThread } from '@/lib/api.grupos';
import type { IconName } from '@/components/Icon';
import type { GroupVisibility, JoinMode, JoinState, MapPlace } from '@/lib/groupAccess';

export type GroupKind = 'viagem' | 'festa' | 'fim_de_semana' | 'outro';
export type Rsvp = 'going' | 'maybe' | 'not_going';

export const GROUP_KINDS: { id: GroupKind; label: string; icon: IconName }[] = [
  { id: 'viagem', label: 'Viagem', icon: 'map' },
  { id: 'festa', label: 'Festa', icon: 'party' },
  { id: 'fim_de_semana', label: 'Fim de semana', icon: 'sun' },
  { id: 'outro', label: 'Outro', icon: 'sparkles' },
];
export const kindInfo = (k: GroupKind | null | undefined) => GROUP_KINDS.find((x) => x.id === k) ?? GROUP_KINDS[3];

export interface VenueRef { slug: string; name: string; avatarUrl: string | null }
/** Resumo do Plano que vem na lista e no cabeçalho do grupo. */
export interface PlanSummary { destination: string | null; startsOn: string | null; endsOn: string | null; going: number; maybe: number; notGoing: number; myRsvp: Rsvp | null }
export interface PotSummary { balance: number; goal: number | null; venue?: (VenueRef & { acceptsTxills?: boolean }) | null }

/**
 * Campos novos do TxillGroup (lista e conversa). Opcionais: o servidor antigo não os manda.
 * O tipo vem em `groupKind` (na lista `kind` já é 'group'); na conversa vem também em `kind`.
 */
export interface GroupExtras {
  groupKind?: GroupKind;
  description?: string | null;
  coverUrl?: string | null;
  plan?: PlanSummary | null;
  pot?: PotSummary | null;
  /** Foto de perfil do grupo (redonda; a capa é a foto larga). */
  avatarUrl?: string | null;
  /** 'public' = qualquer pessoa entra logo; 'private' = só por convite ou pedido aprovado. */
  visibility?: GroupVisibility;
  /** Aparece em "À tua volta" (o público aparece sempre). */
  showOnMap?: boolean;
  /** Só para administradores: pedidos para entrar por responder. */
  pendingRequests?: number;
  /** O ponto marcado no mapa (já arredondado a ~500 m pelo servidor); null = sem ponto (aparece no local do Plano, se houver). */
  mapPlace?: { lat: number; lng: number; label: string | null } | null;
  /** O grupo já tem onde aparecer em "À tua volta" (ponto marcado ou local do Plano com posição). */
  mapReady?: boolean;
}
export type TxillGroupSummary = GroupSummary & GroupExtras;
export type TxillGroupInfo = GroupThread['group'] & GroupExtras & { kind?: GroupKind };
/** O tipo de um TxillGroup, venha de onde vier. */
export const groupKindOf = (g: { groupKind?: GroupKind; kind?: string } | null | undefined): GroupKind | undefined =>
  g?.groupKind ?? (g?.kind && g.kind !== 'group' ? (g.kind as GroupKind) : undefined);

export interface PlanPerson { username: string; displayName: string; hasAvatar: boolean; status: Rsvp }
export interface PollOption { id: string; text: string; votes: number; voters: string[] }
export interface Poll { id: string; question: string; multiple: boolean; closed: boolean; closesAt?: string | null; options: PollOption[]; myVotes: string[]; createdBy: string | null; at?: string }
export interface Who { username: string; displayName: string; hasAvatar?: boolean }
export interface ChecklistItem { id: string; text: string; done: boolean; assignee: Who | null; createdBy?: string | null; at?: string }
/** Despesas em meticais (até 2 casas decimais, ex.: 1250.5). Não mexem em Txills: são só contas. */
export interface Expense { id: string; description: string; amountMzn: number; paidBy: Who; splitAmong: string[]; createdBy: string | null; at: string; canDelete?: boolean }
export interface Balance { username: string; displayName: string; net: number }
export interface Settlement { from: string; to: string; amount: number }

export interface PotContribution { username: string; displayName: string; amount: number; at: string }
export interface PotPayment { venue: { slug: string; name: string } | null; amount: number; note: string | null; at: string; by?: Who | null }
export interface PotView {
  balance: number;
  goal: number | null;
  venue: (VenueRef & { acceptsTxills?: boolean }) | null;
  contributions: PotContribution[];
  /** O que cada um pôs desde a última devolução (a base da devolução). */
  totalByMember: { username: string; displayName: string; amount: number }[];
  payments: PotPayment[];
  refunds?: { amount: number; at: string; by?: Who | null }[];
  /** Sou admin: posso mudar a meta, pagar e devolver. */
  canManage?: boolean;
}

export interface GroupPlan {
  destination: string | null;
  venue: VenueRef | null;
  startsOn: string | null;
  endsOn: string | null;
  rsvps: PlanPerson[];
  polls: Poll[];
  checklist: ChecklistItem[];
  expenses: { items: Expense[]; balances: Balance[]; settlements: Settlement[]; total?: number };
  pot: PotView | null;
}

/** Fotos e vídeos da conversa (sem os de visualização única), os mais recentes primeiro. */
export interface AlbumItem {
  id: string;
  kind: 'image' | 'video';
  mediaUrl: string;
  durationMs?: number | null;
  sender?: Who | null;
  at: string;
}
export interface AlbumPage { items: AlbumItem[]; nextCursor: string | null }

/** Um local na pesquisa (para o destino do Plano e o local da vaquinha). */
export interface VenueHit { slug: string; name: string; city?: string | null; avatarUrl: string | null; kind?: string; acceptsTxills?: boolean }

/** `avatarMediaId` (foto de perfil) vai no mesmo pedido da capa. */
export interface GroupFields { name: string; kind: GroupKind; description?: string | null; coverMediaId?: string | null; avatarMediaId?: string | null }

/** O que quem não está no grupo vê (GET /chat/groups/:id/public; 404 se for privado oculto ou se houver bloqueio). */
export interface PublicGroup {
  id: string;
  name: string;
  groupKind: GroupKind | null;
  description: string | null;
  coverUrl: string | null;
  avatarUrl?: string | null;
  destination: string | null;
  venueName: string | null;
  startsOn: string | null;
  endsOn: string | null;
  members: number;
  visibility?: GroupVisibility;
  joinMode?: JoinMode;
  me: JoinState;
  /** Onde o grupo aparece no mapa ("Costa do Sol", ou o nome do local do Plano). */
  placeLabel?: string | null;
}
export interface JoinRequest { username: string; displayName: string; avatarUrl: string | null; createdAt: string }

const g = (id: string) => `/chat/groups/${encodeURIComponent(id)}`;
const patch = (b: unknown): RequestInit => ({ method: 'PATCH', body: JSON.stringify(b) });
const put = (b: unknown): RequestInit => ({ method: 'PUT', body: JSON.stringify(b) });
const del: RequestInit = { method: 'DELETE' };

export const groupsApi = {
  list: (): Promise<TxillGroupSummary[]> => raw('/chat/groups'),
  create: (f: GroupFields & { members: string[] }): Promise<{ id: string }> => raw('/chat/groups', post(f)),
  update: (id: string, f: Partial<GroupFields>): Promise<void> => raw(g(id), patch(f)),

  plan: (id: string): Promise<GroupPlan> => raw(`${g(id)}/plan`),
  setPlan: (id: string, b: { destination?: string | null; venueSlug?: string | null; startsOn?: string | null; endsOn?: string | null }): Promise<void> => raw(`${g(id)}/plan`, patch(b)),
  rsvp: (id: string, status: Rsvp): Promise<void> => raw(`${g(id)}/plan/rsvp`, put({ status })),

  createPoll: (id: string, b: { question: string; options: string[]; multiple?: boolean; closesAt?: string }): Promise<{ id: string }> => raw(`${g(id)}/polls`, post(b)),
  vote: (id: string, pollId: string, optionIds: string[]): Promise<void> => raw(`${g(id)}/polls/${pollId}/vote`, post({ optionIds })),
  closePoll: (id: string, pollId: string): Promise<void> => raw(`${g(id)}/polls/${pollId}/close`, post({})),

  addItem: (id: string, b: { text: string; assignee?: string | null }): Promise<{ id: string }> => raw(`${g(id)}/checklist`, post(b)),
  editItem: (id: string, itemId: string, b: { done?: boolean; text?: string; assignee?: string | null }): Promise<void> => raw(`${g(id)}/checklist/${itemId}`, patch(b)),
  deleteItem: (id: string, itemId: string): Promise<void> => raw(`${g(id)}/checklist/${itemId}`, del),

  addExpense: (id: string, b: { description: string; amountMzn: number; paidBy?: string; splitAmong?: string[] }): Promise<{ id: string }> => raw(`${g(id)}/expenses`, post(b)),
  deleteExpense: (id: string, expenseId: string): Promise<void> => raw(`${g(id)}/expenses/${expenseId}`, del),

  album: (id: string, cursor?: string): Promise<AlbumPage> => raw(`${g(id)}/album${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),

  pot: (id: string): Promise<PotView> => raw(`${g(id)}/pot`),
  setPot: (id: string, b: { goal?: number | null; venueSlug?: string | null }): Promise<void> => raw(`${g(id)}/pot`, patch(b)),
  contribute: (id: string, amount: number, idempotencyKey = newKey()): Promise<void> => raw(`${g(id)}/pot/contribute`, post({ amount, idempotencyKey })),
  pay: (id: string, b: { venueSlug: string; amount: number; note: string }, idempotencyKey = newKey()): Promise<void> => raw(`${g(id)}/pot/pay`, post({ ...b, idempotencyKey })),
  refund: (id: string, idempotencyKey = newKey()): Promise<void> => raw(`${g(id)}/pot/refund`, post({ idempotencyKey })),

  /**
   * Só administradores. O público fica sempre no mapa. `mapPlace` = o ponto marcado no mapa (o servidor arredonda-o a ~500 m;
   * null apaga-o). 400 "Escolhe onde é o grupo para aparecer em À tua volta" se ficar no mapa sem sítio.
   */
  setAccess: (id: string, b: { visibility?: GroupVisibility; showOnMap?: boolean; mapPlace?: MapPlace | null }): Promise<void> => raw(g(id), patch(b)),
  publicView: (id: string): Promise<PublicGroup> => raw(`${g(id)}/public`),
  /** Público: entra logo (`member`); privado no mapa: fica à espera de um administrador (`pending`). 409 se já for membro ou estiver cheio. */
  requestJoin: (id: string): Promise<{ status: 'pending' | 'member' }> => raw(`${g(id)}/join-requests`, post({})),
  cancelJoin: (id: string): Promise<void> => raw(`${g(id)}/join-requests/me`, del),
  joinRequests: (id: string): Promise<JoinRequest[]> => raw(`${g(id)}/join-requests`),
  acceptJoin: (id: string, username: string): Promise<{ status: 'member' }> => raw(`${g(id)}/join-requests/${encodeURIComponent(username)}/accept`, post({})),
  declineJoin: (id: string, username: string): Promise<void> => raw(`${g(id)}/join-requests/${encodeURIComponent(username)}/decline`, post({})),
  /** Só administradores. 409 "O grupo precisa de pelo menos um administrador" se o último se tentar retirar. */
  setMemberRole: (id: string, username: string, role: 'admin' | 'member'): Promise<{ username: string; role: 'admin' | 'member' }> =>
    raw(`${g(id)}/members/${encodeURIComponent(username)}`, patch({ role })),

  searchVenues: (q: string): Promise<VenueHit[]> => raw(`/venues/search?q=${encodeURIComponent(q)}`),
};

/** Chaves das queries do TxillGroup (o tempo real invalida-as por aqui). */
export const groupKeys = {
  plan: (id: string) => ['group-plan', id] as const,
  album: (id: string) => ['group-album', id] as const,
  pot: (id: string) => ['group-pot', id] as const,
  publicView: (id: string) => ['group-public', id] as const,
  joinRequests: (id: string) => ['group-join-requests', id] as const,
};

// ----- formatos -----
/** Meticais (até 2 casas): "1 250,50 MT". */
export const mzn = (v: number) => {
  const r = Math.round(v * 100) / 100;
  return `${r.toLocaleString('pt-PT', { minimumFractionDigits: Number.isInteger(r) ? 0 : 2, maximumFractionDigits: 2 })} MT`;
};
/** O valor escrito em meticais ("1250,5" → 1250.5); null se não for válido. */
export function parseMzn(text: string): number | null {
  const t = text.replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return null;
  const v = Math.round(Number(t) * 100) / 100;
  return v > 0 ? v : null;
}

export const txills = (n: number) => `${n.toLocaleString('pt-PT')} Txills`;

/** "31 dez" ou "31 dez · 2 jan" (as datas vêm como AAAA-MM-DD). */
export function dayOf(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
export function dateRange(start: string | null | undefined, end?: string | null): string | null {
  if (!start) return null;
  const f = (s: string) => dayOf(s).toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' }).replace('.', '');
  return end && end.slice(0, 10) !== start.slice(0, 10) ? `${f(start)} · ${f(end)}` : f(start);
}
/** "Daqui a 5 dias", "Amanhã", "Hoje", "Já passou". */
export function countdown(start: string | null | undefined, end?: string | null): string | null {
  if (!start) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const s = dayOf(start).getTime();
  const e = end ? dayOf(end).getTime() : s;
  const days = Math.round((s - today.getTime()) / 86_400_000);
  if (days > 1) return `Daqui a ${days} dias`;
  if (days === 1) return 'Amanhã';
  if (today.getTime() <= e) return days === 0 ? 'É hoje' : 'A decorrer';
  return 'Já passou';
}
export const toIsoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
