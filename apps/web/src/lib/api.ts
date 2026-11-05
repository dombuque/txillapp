import type { AuthResponse } from '@txillapp/shared';

/** Access token só em memória (nunca localStorage); o refresh vive num cookie HttpOnly. */
/** Fotos de telemóvel têm 3 a 8 MB: reduz para 2048 px (JPEG 85%) antes de enviar. Envia mais depressa e poupa dados. */
async function shrinkImage(file: Blob): Promise<Blob> {
  const MAX = 2048;
  try {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return file;
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 900 * 1024) {
      bmp.close();
      return file;
    }
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.fillStyle = '#fff'; // PNG com transparência passa para fundo branco
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    return out && out.size < file.size ? out : file;
  } catch {
    return file; // se o browser não consegue, envia o original
  }
}

let accessToken: string | null = null;

/**
 * Sessão da equipa do backoffice: separada da rede social (outro login, outro token). Fica só neste separador (sessionStorage) e dura 8 h.
 */
const STAFF_KEY = 'txill.staff';
let staffToken: string | null = (() => {
  try {
    return sessionStorage.getItem(STAFF_KEY);
  } catch {
    return null;
  }
})();
export const staffSession = {
  has: () => !!staffToken,
  set(t: string) {
    staffToken = t;
    try {
      sessionStorage.setItem(STAFF_KEY, t);
    } catch { /* sem armazenamento: a sessão dura até fechar o separador */ }
  },
  clear() {
    staffToken = null;
    try {
      sessionStorage.removeItem(STAFF_KEY);
    } catch { /* nada a limpar */ }
    window.dispatchEvent(new Event('txill:staff-out'));
  },
};
/** Rotas da equipa (usam a sessão de equipa, nunca a da rede social). */
const isStaffPath = (p: string) => p.startsWith('/admin') || p === '/staff-auth/me' || p === '/staff-auth/logout' || p.startsWith('/venues/admin/') || /^\/venues\/[^/?]+\/verified/.test(p);
/** Cabeçalho de autorização para pedidos fora do `raw` (por exemplo, o canal em tempo real). */
export const authHeader = (): Record<string, string> => (accessToken ? { Authorization: `Bearer ${accessToken}` } : {});
export const setAccessToken = (t: string | null) => {
  accessToken = t;
};

import { tr } from './i18n';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    // As mensagens do servidor vêm em português: mostram-se no idioma escolhido (o que não tiver tradução fica como veio).
    super(typeof message === 'string' ? tr(message) : String(message));
  }
}

export interface Post {
  /** Faixa de licença aberta, com o crédito do autor. */
  music?: Track | null;
  /** Código curto para links limpos (txillapp.com/p/Ab3xK9q). */
  code: string;
  id: string;
  body: string;
  locationLabel: string | null;
  media: { url: string; tags: PhotoTag[]; kind?: 'image' | 'video'; posterUrl?: string; durationMs?: number | null; width?: number | null; height?: number | null }[];
  createdAt: string;
  /** Posição (arredondada) do sítio escolhido; serve para o mapa e para ver publicações perto. */
  locationGeo?: { lat: number; lng: number } | null;
  /** Guardada por mim (privado). */
  saved?: boolean;
  author: { id: string; username: string; displayName: string; verified?: boolean; verifiedTier?: 'verified' | 'official' | null };
  cheers: number;
  comments: number;
  gifts: number;
  cheered: boolean;
  /** Preenchido nos posts "X presenteou Y". */
  gift: { amount: number; recipient: { username: string; displayName: string; hasAvatar: boolean; verified?: boolean; verifiedTier?: 'verified' | 'official' | null } } | null;
  /** Conforme as definições do autor. */
  canComment: boolean;
  commentsOff?: boolean;
  editedAt?: string | null;
  canGift: boolean;
  /** Eu sigo o autor? Só se presenteia quem se segue. */
  authorFollowed: boolean;
  /** O dono deixa-me ver QUEM repostou / brindou / presenteou? */
  lists: { reposts: boolean; cheers: boolean; gifts: boolean };
  kind: 'post' | 'gift' | 'repost';
  reposts: number;
  reposted: boolean;
  /** Preenchido nos reposts: a publicação original. */
  repostOf?: Post | null;
  /** Só no feed: de onde vem e se já foi vista numa sessão anterior. */
  feed?: { source: 'following' | 'self' | 'discover'; seen: boolean };
}
export interface Comment {
  id: string;
  postId: string;
  parentId: string | null;
  body: string;
  createdAt: string;
  author: { id: string; username: string; displayName: string; verified?: boolean; verifiedTier?: 'verified' | 'official' | null };
  cheers: number;
  cheered: boolean;
  replyCount: number;
}
export interface Profile {
  id: string;
  verified?: boolean;
  verifiedTier?: 'verified' | 'official' | null;
  /** Só vem preenchido se a pessoa escolheu mostrá-lo (ou sou eu). */
  gender?: Gender | null;
  username: string;
  displayName: string;
  bio: string | null;
  website?: string | null;
  city?: string | null;
  joinedAt: string;
  hasAvatar: boolean;
  isMe: boolean;
  isPrivate: boolean;
  following: boolean;
  followsYou: boolean;
  requested: boolean;
  /** Como no X: o cabeçalho continua visível, com o aviso de bloqueio. */
  blockedByMe: boolean;
  blockedMe: boolean;
  /** Falso num perfil privado para quem não é seguidor aceite (e em bloqueios). */
  canView: boolean;
  /** A lista de seguidores/seguindo está acessível a este espectador. */
  canSeeConnections: boolean;
  pendingRequests: number;
  activeStories: number;
  counts: { posts: number; followers: number; following: number };
}
export interface PhotoTag {
  username: string;
  displayName: string;
  x: number;
  y: number;
}
export interface Person {
  username: string;
  displayName: string;
  following: boolean;
  followsYou: boolean;
  isPrivate?: boolean;
  requested?: boolean;
}
export interface Suggestion {
  username: string;
  displayName: string;
  isPrivate: boolean;
  requested: boolean;
  followsYou: boolean;
  mutual: number;
  reason: string;
}
export interface FollowState {
  following: boolean;
  requested: boolean;
  followers: number;
}
export type Availability<R extends string> = { available: true } | { available: false; reason: R };
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
export interface TrayUser {
  username: string;
  displayName: string;
  isMe: boolean;
  count: number;
  /** Quantos já foram vistos (o anel mostra esses segmentos a cinzento). */
  seenCount: number;
  seen: boolean;
  /** Todos os stories activos são só para amigos próximos (anel verde). */
  closeFriends: boolean;
  latestAt: string;
}
export interface StoryComment {
  id: string;
  body: string;
  createdAt: string;
  mine: boolean;
  canDelete: boolean;
  author: { username: string; displayName: string; hasAvatar: boolean };
}
export interface Story {
  id: string;
  /** Música do story (faixa de licença aberta ou clipe próprio). */
  music?: Track | null;
  mediaUrl: string;
  caption: string | null;
  audience: 'all' | 'close_friends';
  /** 'video' quando o story é um reel partilhado. */
  mediaKind: 'image' | 'video';
  durationMs: number | null;
  /** Partilhado de uma publicação: de quem e qual. */
  sharedFrom: { postId: string; username: string; displayName: string } | null;
  createdAt: string;
  expiresAt: string;
  author: { username: string; displayName: string };
  seen: boolean;
  viewCount: number | null;
  /** Este espectador já brindou o story? E, só para o autor, quantos brindes. */
  cheered?: boolean;
  cheerCount?: number | null;
  /** Só para o autor: quantas respostas/reacções recebeu. */
  replyCount: number | null;
  /** Comentários públicos (o número é visível a quem vê o story). */
  commentCount: number;
  /** O autor aceita respostas deste espectador? */
  canReply: boolean;
  commentsOff?: boolean;
}
export type Gender = 'female' | 'male' | 'other' | 'unspecified';
export type ReportType = 'post' | 'comment' | 'story' | 'user' | 'message' | 'media';
export type ReportReason = 'spam' | 'harassment' | 'hate' | 'nudity' | 'violence' | 'scam' | 'impersonation' | 'minor' | 'other';
export interface BoMe { teams: string[]; permissions: string[]; catalog: { id: string; name: string; description: string }[] }
export interface BoStaffMember { id: string; email: string; name: string; teams: string[]; active: boolean; pending: boolean; lastLogin: string | null; createdAt: string }
export interface StaffSetupInfo { email: string; name: string; secret: string; otpauth: string }
export interface BoUserRow { id: string; username: string; display_name: string; email: string; status: 'active' | 'suspended' | 'deleted'; is_admin: boolean; created_at: string; country: string | null; verified: boolean; posts: number; followers: number; reports: number; last_seen: string | null }
export interface BoUserSheet {
  user: { id: string; username: string; display_name: string; email: string; status: 'active' | 'suspended' | 'deleted'; is_admin: boolean; is_private: boolean; created_at: string; country: string | null; terms_version: string | null; email_verified_at: string | null; has_avatar: boolean; posts: number; followers: number; following: number; messages: number; sessions: number; last_seen: string | null; txills: string };
  reportsAgainst: { target_type: string; target_id: string; reason: string; status: string; resolution: string | null; resolution_note: string | null; created_at: string; reporter: string | null }[];
  invite: { invited: number; paid: number; came_from: { status: string; reason: string | null; inviter: string } | null };
  notes: { id: string; body: string; created_at: string; author: string | null }[];
  history: { action: string; metadata: Record<string, unknown>; created_at: string; actor: string | null }[];
}
export interface BoDecided { type: string; id: string; reports: number; reasons: string[]; resolvedAt: string; resolution: string; note: string | null; decidedBy: string | null; owner: string | null; preview: string }
export interface BoAuditRow { id: string; action: string; target: string | null; metadata: Record<string, unknown>; created_at: string; actor: string | null }
export interface ReportQueueItem {
  type: ReportType;
  id: string;
  reports: number;
  reasons: ReportReason[];
  firstAt: string;
  owner: { username: string; displayName: string; status: string; strikes: number } | null;
  preview: string;
  /** Foto assinalada pela verificação automática. */
  imageUrl: string | null;
}
export interface AdminStats {
  days: number;
  totals: { users: number; posts: number; comments: number; messages: number; follows: number };
  active: { dau: number; wau: number; mau: number };
  retention: { d1: number | null; d7: number | null; d1Base: number; d7Base: number };
  funnel: { signed: number; posted: number; followed: number; cheered: number };
  feed: { seen: number; cheers: number; comments: number; hidden: number; engagementRate: number | null; hideRate: number | null };
  series: Record<'signups' | 'posts' | 'comments' | 'cheers' | 'messages' | 'opens', { day: string; value: number }[]>;
  perf: { metric: string; p75: number; n: number }[];
  screens: { path: string; n: number }[];
  errors: { message: string; n: number }[];
  platform: { platform: 'browser' | 'pwa'; users: number }[];
}
export type Who = 'everyone' | 'following' | 'off';
export interface Conversation {
  username: string;
  displayName: string;
  hasAvatar: boolean;
  lastMessage: { body: string; kind: ChatMessage['kind']; fromMe: boolean; at: string };
  presence?: Presence | null;
  /** Pedido de mensagem (de quem não sigo): só aparece na caixa de pedidos. */
  request?: boolean;
  unread: number;
}
export type NoteAudience = 'mutual' | 'close_friends';
export interface Track { kind?: 'clip'; mediaId?: string; id: string; title: string; artist: string; url: string; landing: string | null; license: string; licenseUrl: string | null; durationMs: number | null; cover: string | null }
/** O que se envia ao servidor: uma faixa de licença aberta inteira, ou só os dados do clipe próprio. */
export const musicPayload = (t: Track | null | undefined) => (!t ? undefined : t.kind === 'clip' ? { kind: 'clip' as const, mediaId: t.mediaId!, durationMs: t.durationMs ?? 1000, title: t.title } : t);
export interface InvitesInfo {
  code: string;
  link: string;
  stats: { invited: number; active: number; pending: number; paid: number; earned: number; today: number };
  rules: { reward: number; perDay: number; maxPaid: number; holdDays: number };
  eligible: boolean;
  note: string | null;
}
export interface Note {
  music?: Track | null; username: string; displayName: string; hasAvatar: boolean; body: string; audience: NoteAudience; createdAt: string; expiresAt: string; cheers?: number; cheered?: boolean }
export interface GroupSummary {
  kind: 'group';
  id: string;
  name: string;
  members: number;
  preview: { username: string; displayName: string; hasAvatar: boolean }[];
  lastMessage: { body: string; kind: ChatMessage['kind']; fromMe: boolean; senderName: string | null; at: string; empty: boolean };
  unread: number;
}
export interface GroupMember { username: string; displayName: string; hasAvatar: boolean; role: 'admin' | 'member' }
export interface GroupThread {
  group: { id: string; name: string; myRole: 'admin' | 'member'; members: GroupMember[] };
  items: (ChatMessage & { sender: { username: string; displayName: string; hasAvatar: boolean } })[];
  nextCursor: string | null;
}
export interface ChatMessage {
  id: string;
  fromMe: boolean;
  body: string;
  kind: 'text' | 'story_reply' | 'story_reaction' | 'image' | 'voice' | 'video' | 'sticker' | 'location' | 'post' | 'gift';
  /** Presente enviado na conversa: quanto (a nota vai no texto). */
  giftAmount?: number | null;
  /** Publicação partilhada (só em mensagens do tipo post; null se já não a posso ver). */
  post?: Post | null;
  storyUrl: string | null;
  /** Foto ou voz do chat: URL assinado e temporário. */
  mediaUrl: string | null;
  durationMs: number | null;
  /** Onda da mensagem de voz: níveis 0–9 em texto. */
  waveform?: string | null;
  /** Localização partilhada (só em mensagens de localização). */
  lat?: number | null;
  lng?: number | null;
  /** Visualização única: o conteúdo só se lê ao abrir, uma vez. */
  viewOnce?: boolean;
  opened?: boolean;
  /** Localização em direto ainda a decorrer, e até quando. */
  live?: boolean;
  liveUntil?: string | null;
  /** Mensagem a que esta responde (um excerto). */
  replyTo?: { id: string; gone: true } | { id: string; gone: false; fromMe: boolean; name: string; kind: ChatMessage['kind']; body: string } | null;
  /** Reações: uma por pessoa; aqui agrupadas. */
  reactions?: { reaction: string; count: number; mine: boolean }[];
  at: string;
}
/** Instants: foto tirada na hora, 24 h, vista uma só vez. */
export interface InstantItem { id: string; url: string; caption: string; at: string; expiresAt: string; views?: number; reactions?: { reaction: string; count: number }[] }
export interface InstantTray {
  mine: { count: number; views: number; endsAt: string | null };
  others: { username: string; displayName: string; hasAvatar: boolean; count: number; latestAt: string; close: boolean; preview: string | null }[];
}
/** Online agora, ou a hora a que foi visto pela última vez. null = escondido por uma das partes. */
export interface Presence { online: boolean; lastSeen: string | null }
/** Como estamos um com o outro no chat: o aviso "não te segue", o pedido de mensagem e quantas mensagens ainda posso mandar a quem não responde. */
export interface ChatRelation { iFollow: boolean; theyFollow: boolean; request: boolean; left: number | null }
export interface ChatThread {
  relation?: ChatRelation;
  person: { username: string; displayName: string; hasAvatar: boolean; canGift?: boolean; presence?: Presence | null };
  blocked: boolean;
  /** Último id que a outra pessoa já leu. */
  otherRead: string | null;
  items: ChatMessage[];
  nextCursor: string | null;
}
export type Viewers = 'everyone' | 'followers' | 'off';
export type PeopleKind = 'reposts' | 'cheers' | 'gifts';
export interface PrivacySettings {
  isPrivate: boolean;
  /** Estatísticas de utilização próprias (sem terceiros). */
  shareAnalytics: boolean;
  /** Mostrar quando estou online (e ver a dos outros). */
  showPresence: boolean;
  /** Deixar que quem tem o meu email nos contactos me encontre. */
  findByContacts: boolean;
  isAdmin: boolean;
  /** Já viu (ou saltou) a visita guiada. */
  welcomed: boolean;
  /** Contas antigas: falta a data de nascimento / aceitar os termos em vigor. */
  birthDateSet: boolean;
  termsAccepted: boolean;
  /** null = ainda não escolheu. */
  gender: Gender | null;
  showGender: boolean;
  commentsAllowed: Who;
  giftsAllowed: Who;
  mentionsAllowed: Who;
  dmsAllowed: Who;
  repostsVisible: Viewers;
  cheersVisible: Viewers;
  giftsVisible: Viewers;
  showConnections: 'everyone' | 'followers' | 'me';
  suggestable: boolean;
}
export type TasteKind = 'vibe' | 'bebida' | 'comida' | 'sitio';
/** Quem vê a geleira (inteira): todos, seguidores, amigos próximos ou só eu. */
export type TasteVisibility = 'everyone' | 'followers' | 'close_friends' | 'me';
export interface TasteItem { id: string; slug: string; name: string; kind: TasteKind; category: string; alcoholic: boolean; pending: boolean }
export interface CatalogItem extends TasteItem { mine: boolean; rating: number | null; favorite: boolean; fans: number; region: 'local' | 'global' | 'foreign' }
export interface MyTaste extends TasteItem { rating: number | null; favorite: boolean }
export interface TheirTaste extends TasteItem { rating: number | null; favorite: boolean }
export interface StorySettings {
  replies: Who;
  hidden: { username: string; displayName: string }[];
}
export type GiftVisibility = 'silent' | 'private' | 'public';
export interface GeleiraLevel { points: number; level: number; title: string; toNext: number | null; nextTitle: string | null }
export interface PaymentPackage { id: string; name: string; txills: number; priceMinor: number; currency: string }
export interface PaymentsConfig { providers: { id: 'sandbox' | 'mpesa' | 'emola' | 'card'; label: string; needsPhone: boolean }[]; packages: PaymentPackage[] }
export interface PaymentOrder { id: string; packageId: string; txills: number; amountMinor: number; currency: string; provider: string; status: 'pending' | 'paid' | 'failed' | 'cancelled' | 'expired'; phoneTail: string | null; createdAt: string; paidAt: string | null }
export type ProfileTab = 'all' | 'reels' | 'reposts' | 'gifts' | 'saved';
export interface VerificationStatus {
  items: { key: string; label: string; ok: boolean; hint: string }[];
  eligible: boolean;
  verified: boolean;
  tier: 'verified' | 'official' | null;
  request: { id: string; kind: string; status: 'pending' | 'approved' | 'rejected' | 'withdrawn'; reason: string | null; createdAt: string } | null;
  retryAfter: string | null;
}
export interface VerificationItem {
  id: string;
  kind: 'person' | 'business';
  fullName: string;
  proof: string;
  createdAt: string;
  user: { username: string; displayName: string; bio: string; hasAvatar: boolean; followers: number };
  docUrl: string | null;
  selfieUrl: string | null;
}
export type NotificationKind = 'blocked' | 'follow' | 'follow_request' | 'request_accepted' | 'gift' | 'comment' | 'reply' | 'story_reply' | 'repost' | 'mention' | 'tag' | 'verified';
export interface AppNotification {
  id: string;
  kind: NotificationKind;
  data: { amount?: number; note?: string; snippet?: string; postId?: string; commentId?: string; storyId?: string; replyKind?: 'reply' | 'reaction' | 'comment' };
  createdAt: string;
  read: boolean;
  actor: { username: string; displayName: string };
}
export interface DeviceSession {
  id: string;
  device: string;
  firstSeen: string;
  lastUsed: string;
  current: boolean;
}
export interface SearchResults {
  query: string;
  people: { username: string; displayName: string; verified?: boolean; isPrivate: boolean; following: boolean; requested: boolean; followsYou: boolean }[];
  posts: Post[];
  tags: TagCount[];
}
export interface TagCount {
  tag: string;
  posts: number;
}
export interface TrendingTag extends TagCount {
  authors: number;
  /** A maioria das publicações é das últimas 12 h. */
  rising: boolean;
}
export interface TagPage {
  tag: string;
  posts: number;
  authors: number;
  items: Post[];
  nextCursor: string | null;
}
export interface NearbyPlaces {
  area: string | null;
  city: string | null;
  places: { name: string; kind: string; distanceM: number; lat: number; lng: number }[];
}
export interface WalletView {
  currency: string;
  demo: boolean;
  balance: number;
  history: {
    id: string;
    amount: number;
    type: 'welcome_bonus' | 'transfer' | 'gift';
    createdAt: string;
    counterparty: { username: string; displayName: string } | null;
    note: string | null;
  }[];
}

/** Chamado só quando o servidor diz de forma definitiva que a sessão acabou (401). Falhas de rede/servidor não contam. */
let onSessionExpired: (() => void) | null = null;
export const setSessionExpiredHandler = (fn: (() => void) | null) => {
  onSessionExpired = fn;
};

let refreshing: Promise<AuthResponse> | null = null;
function refreshOnce() {
  return (refreshing ??= raw('/auth/refresh', { method: 'POST' }, false)
    .then((r: AuthResponse) => {
      accessToken = r.accessToken;
      return r;
    })
    .catch((e) => {
      if (e instanceof ApiError && e.status === 401) {
        accessToken = null;
        onSessionExpired?.();
      }
      throw e;
    })
    .finally(() => {
      refreshing = null;
    }));
}

async function raw(path: string, init: RequestInit = {}, retry = true): Promise<any> {
  const res = await fetch(`/api/v1${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'txillapp',
      ...(isStaffPath(path) ? (staffToken ? { Authorization: `Bearer ${staffToken}` } : {}) : path.startsWith('/staff-auth/') ? {} : accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...init.headers,
    },
  });
  // Sessão de equipa caducada ou retirada: volta ao login do backoffice (sem tentar renovar a da rede social).
  if (res.status === 401 && isStaffPath(path)) {
    if (staffToken) staffSession.clear();
    throw new ApiError(401, 'A sessão da equipa terminou. Entra outra vez.');
  }
  // Access token expirado: renova uma vez e repete o pedido.
  if (res.status === 401 && retry && !path.startsWith('/auth/') && !path.startsWith('/staff-auth/')) {
    await refreshOnce();
    return raw(path, init, false);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.message ?? 'Erro inesperado');
  }
  if (res.status === 204) return undefined;
  const text = await res.text();
  return text ? JSON.parse(text) : undefined;
}

const post = (b: unknown, extra: HeadersInit = {}): RequestInit => ({ method: 'POST', body: JSON.stringify(b), headers: extra });
/** crypto.randomUUID só existe em contextos seguros (HTTPS/localhost): em http://IP-da-rede (teste no telemóvel) usa getRandomValues. */
const newKey = () => {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
};
const qs = (cursor?: string, limit?: number, q?: string) => {
  const p = new URLSearchParams();
  if (limit) p.set('limit', String(limit));
  if (cursor) p.set('cursor', cursor);
  if (q) p.set('q', q);
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const api = {
  register: (b: unknown): Promise<AuthResponse> => raw('/auth/register', post(b)),
  aiForYou: (): Promise<Omit<Suggestion, 'mutual'>[]> => raw('/supertxill/for-you'),
  notifySettings: (): Promise<{ categories: string[]; off: string[] }> => raw('/notifications/settings'),
  saveNotifySettings: (off: string[]): Promise<void> => raw('/notifications/settings', { method: 'PUT', body: JSON.stringify({ off }) }),
  invites: (): Promise<InvitesInfo> => raw('/invites/me'),
  invitePreview: (code: string): Promise<{ username: string; displayName: string }> => raw(`/invites/preview/${encodeURIComponent(code)}`),
  login: (b: unknown): Promise<AuthResponse> => raw('/auth/login', post(b)),
  // Partilha o pedido em curso: dois refresh com o mesmo token (StrictMode, vários separadores) seriam tratados como reutilização.
  refresh: (): Promise<AuthResponse> => refreshOnce(),
  logout: (): Promise<void> => raw('/auth/logout', { method: 'POST' }),
  emailStatus: (): Promise<{ required: boolean; verified: boolean }> => raw('/auth/email/status'),
  resendVerification: (): Promise<{ sent: boolean }> => raw('/auth/email/resend', { method: 'POST' }),
  verifyEmail: (token: string): Promise<{ ok: boolean }> => raw('/auth/email/verify', post({ token })),
  forgotPassword: (email: string): Promise<{ ok: boolean }> => raw('/auth/password/forgot', post({ email })),
  resetPassword: (token: string, newPassword: string): Promise<{ ok: boolean }> => raw('/auth/password/reset', post({ token, newPassword })),

  profile: (username: string): Promise<Profile> => raw(`/users/${encodeURIComponent(username)}`),
  userPosts: (username: string, cursor?: string, tab: ProfileTab = 'all'): Promise<Page<Post>> => raw(`/users/${encodeURIComponent(username)}/posts${qs(cursor, 18)}${(qs(cursor, 18) ? '&' : '?')}tab=${tab}`),
  follow: (username: string): Promise<FollowState> => raw(`/users/${encodeURIComponent(username)}/follow`, post({})),
  unfollow: (username: string): Promise<FollowState> => raw(`/users/${encodeURIComponent(username)}/unfollow`, post({})),
  followers: (username: string, cursor?: string, q?: string): Promise<Page<Person>> => raw(`/users/${encodeURIComponent(username)}/followers${qs(cursor, undefined, q)}`),
  following: (username: string, cursor?: string, q?: string): Promise<Page<Person>> => raw(`/users/${encodeURIComponent(username)}/following${qs(cursor, undefined, q)}`),
  updateMe: (b: { displayName?: string; bio?: string; isPrivate?: boolean; website?: string; city?: string }): Promise<{ id: string; username: string; displayName: string; bio: string | null; isPrivate: boolean; website: string | null; city: string | null }> =>
    raw('/users/me', { method: 'PATCH', body: JSON.stringify(b) }),
  suggestions: (): Promise<Suggestion[]> => raw('/suggestions/people'),
  dismissSuggestion: (username: string): Promise<void> => raw(`/suggestions/people/${encodeURIComponent(username)}/dismiss`, post({})),
  followRequests: (): Promise<{ username: string; displayName: string; requestedAt: string }[]> => raw('/follow-requests'),
  acceptRequest: (username: string): Promise<void> => raw(`/follow-requests/${encodeURIComponent(username)}/accept`, post({})),
  declineRequest: (username: string): Promise<void> => raw(`/follow-requests/${encodeURIComponent(username)}/decline`, post({})),

  authConfig: (): Promise<{ googleClientId: string | null }> => raw('/auth/config'),
  usernameAvailable: (u: string): Promise<Availability<'invalid' | 'reserved' | 'taken'> & { suggestions?: string[] }> =>
    raw(`/auth/username-available?username=${encodeURIComponent(u)}`),
  emailAvailable: (e: string): Promise<Availability<'invalid' | 'taken'>> => raw(`/auth/email-available?email=${encodeURIComponent(e)}`),
  /** Devolve a sessão, ou `needsUsername` para contas novas (a pessoa escolhe o @ a seguir). */
  googleLogin: (idToken: string): Promise<AuthResponse | { needsUsername: true; signupToken: string; displayName: string; suggestedUsername: string }> =>
    raw('/auth/google', post({ idToken })),
  googleComplete: (signupToken: string, username: string, gender: Gender, birthDate: string): Promise<AuthResponse> =>
    raw('/auth/google/complete', post({ signupToken, username, gender, birthDate, acceptTerms: true })),
  setConsent: (birthDate: string): Promise<PrivacySettings> => raw('/users/me/consent', { method: 'PUT', body: JSON.stringify({ birthDate, acceptTerms: true }) }),

  feed: (cursor?: string): Promise<Page<Post>> => raw(`/feed${qs(cursor, 10)}`),
  markSeen: (ids: string[]): Promise<void> => raw('/feed/seen', post({ ids })),
  hideFromFeed: (postId: string): Promise<void> => raw('/feed/hide', post({ postId })),
  createPost: (b: { body: string; music?: Track | null; locationLabel?: string; locationLat?: number; locationLng?: number; locationCoarse?: boolean; mediaIds: string[]; tags?: { index: number; username: string; x: number; y: number }[] }): Promise<Post> => raw('/posts', post({ ...b, music: musicPayload(b.music) })),
  cheer: (id: string): Promise<{ cheered: boolean; cheers: number }> => raw(`/posts/${id}/cheers`, post({})),
  /** Presente numa publicação: discreto, mensagem privada ao destinatário, ou post no feed. */
  gift: (id: string, amount: number, key: string, note = '', visibility: GiftVisibility = 'silent'): Promise<{ transactionId: string; post: Post; announcement: Post | null }> =>
    raw(`/posts/${id}/gifts`, post({ amount, note, visibility }, { 'Idempotency-Key': key })),
  repost: (id: string, body = ''): Promise<Post> => raw(`/posts/${id}/repost`, post({ body })),
  unrepost: (id: string): Promise<{ reposted: boolean; reposts: number }> => raw(`/posts/${id}/repost`, { method: 'DELETE' }),

  comments: (postId: string, cursor?: string): Promise<Page<Comment>> => raw(`/posts/${postId}/comments${qs(cursor, 15)}`),
  replies: (commentId: string, cursor?: string): Promise<Page<Comment>> => raw(`/comments/${commentId}/replies${qs(cursor, 10)}`),
  addComment: (postId: string, body: string, parentId?: string): Promise<Comment> =>
    raw(`/posts/${postId}/comments`, post({ body, parentId })),
  cheerComment: (id: string): Promise<{ cheered: boolean; cheers: number }> => raw(`/comments/${id}/cheers`, post({})),
  deleteComment: (id: string): Promise<void> => raw(`/comments/${id}`, { method: 'DELETE' }),

  /** Presentear alguém com Txills (demonstração), de onde quer que seja. */
  giftUser: (b: { toUsername: string; amount: number; note?: string; visibility: GiftVisibility }, key: string): Promise<{ transactionId: string; replayed: boolean; post: Post | null }> =>
    raw('/gifts', post(b, { 'Idempotency-Key': key })),
  /** Decidir publicar DEPOIS de ter enviado o presente. */
  publishGift: (transactionId: string, note?: string): Promise<{ post: Post }> => raw(`/gifts/${transactionId}/publish`, post({ note })),

  notifications: (cursor?: string): Promise<Page<AppNotification>> => raw(`/notifications${qs(cursor)}`),
  unreadCount: (): Promise<{ count: number }> => raw('/notifications/unread-count'),
  markNotificationsRead: (): Promise<void> => raw('/notifications/read', post({})),

  search: (q: string): Promise<SearchResults> => raw(`/search?q=${encodeURIComponent(q)}`),

  geleiraCatalog: (q: string, kind?: TasteKind): Promise<CatalogItem[]> => raw(`/geleira/catalog?q=${encodeURIComponent(q)}${kind ? `&kind=${kind}` : ''}`),
  geleiraMine: (): Promise<MyTaste[]> => raw('/geleira/me'),
  geleiraOf: (username: string): Promise<TheirTaste[]> => raw(`/users/${encodeURIComponent(username)}/geleira`),
  geleiraPut: (itemId: string, b: { rating?: number | null; favorite?: boolean }): Promise<void> =>
    raw(`/geleira/me/items/${itemId}`, { method: 'PUT', body: JSON.stringify(b) }),
  geleiraRemove: (itemId: string): Promise<void> => raw(`/geleira/me/items/${itemId}`, { method: 'DELETE' }),
  geleiraSuggest: (b: { name: string; kind: TasteKind; category: string; alcoholic?: boolean }): Promise<TasteItem> => raw('/geleira/items', post(b)),
  geleiraSettings: (): Promise<{ matching: boolean; visibility: TasteVisibility }> => raw('/geleira/me/settings'),
  setGeleiraSettings: (b: { matching?: boolean; visibility?: TasteVisibility }): Promise<{ matching: boolean; visibility: TasteVisibility }> => raw('/geleira/me/settings', { method: 'PUT', body: JSON.stringify(b) }),
  setWelcomed: (): Promise<PrivacySettings> => raw('/users/me/welcomed', { method: 'PUT' }),
  privacy: (): Promise<PrivacySettings> => raw('/settings/privacy'),
  /** País onde a pessoa está agora (pelo IP). */
  geo: (): Promise<{ country: string | null }> => raw('/health/geo'),
  setPrivacy: (b: Partial<PrivacySettings>): Promise<PrivacySettings> => raw('/settings/privacy', { method: 'PATCH', body: JSON.stringify(b) }),
  blocked: (): Promise<{ username: string; displayName: string }[]> => raw('/blocks'),
  block: (username: string): Promise<{ username: string; displayName: string }[]> => raw(`/blocks/${encodeURIComponent(username)}`, { method: 'PUT' }),
  unblock: (username: string): Promise<{ username: string; displayName: string }[]> => raw(`/blocks/${encodeURIComponent(username)}`, { method: 'DELETE' }),
  setAvatar: (mediaId: string): Promise<{ hasAvatar: boolean }> => raw('/users/me/avatar', { method: 'PUT', body: JSON.stringify({ mediaId }) }),
  clearAvatar: (): Promise<{ hasAvatar: boolean }> => raw('/users/me/avatar', { method: 'DELETE' }),
  storySettings: (): Promise<StorySettings> => raw('/stories/settings'),
  setStoryReplies: (replies: Who): Promise<StorySettings> => raw('/stories/settings', { method: 'PATCH', body: JSON.stringify({ replies }) }),
  hideStoryFrom: (username: string): Promise<StorySettings> => raw(`/stories/hidden/${encodeURIComponent(username)}`, { method: 'PUT' }),
  unhideStoryFrom: (username: string): Promise<StorySettings> => raw(`/stories/hidden/${encodeURIComponent(username)}`, { method: 'DELETE' }),

  changePassword: (currentPassword: string, newPassword: string): Promise<AuthResponse> => raw('/auth/password', post({ currentPassword, newPassword })),
  sessions: (): Promise<DeviceSession[]> => raw('/auth/sessions'),
  revokeSession: (id: string): Promise<void> => raw(`/auth/sessions/${id}`, { method: 'DELETE' }),
  revokeOtherSessions: (): Promise<void> => raw('/auth/sessions/revoke-others', post({})),
  deleteAccount: (confirmUsername: string, password?: string): Promise<void> => raw('/auth/delete-account', post({ confirmUsername, password })),

  stories: (): Promise<TrayUser[]> => raw('/stories'),
  instants: (): Promise<InstantTray> => raw('/instants'),
  instantsOf: (username: string): Promise<InstantItem[]> => raw(`/instants/of/${encodeURIComponent(username)}`),
  instantCreate: (mediaId: string, caption: string, audience: 'friends' | 'close' = 'friends'): Promise<{ id: string; expiresAt: string }> => raw('/instants', post({ mediaId, caption, audience })),
  instantView: (id: string): Promise<void> => raw(`/instants/${id}/view`, post({})),
  instantReact: (id: string, reaction: string): Promise<void> => raw(`/instants/${id}/reaction`, { method: 'PUT', body: JSON.stringify({ reaction }) }),
  instantViewers: (id: string): Promise<{ username: string; displayName: string; hasAvatar: boolean; at: string; reaction?: string | null }[]> => raw(`/instants/${id}/viewers`),
  instantDelete: (id: string): Promise<void> => raw(`/instants/${id}`, { method: 'DELETE' }),
  storiesOf: (username: string): Promise<Story[]> => raw(`/stories/user/${encodeURIComponent(username)}`),
  createStory: (mediaId: string, caption: string, audience: 'all' | 'close_friends' = 'all', music?: Track | null): Promise<Story> => raw('/stories', post({ mediaId, caption, audience, music: musicPayload(music) })),
  closeFriends: (): Promise<{ username: string; displayName: string; hasAvatar: boolean }[]> => raw('/stories/close-friends'),
  addCloseFriend: (username: string): Promise<void> => raw(`/stories/close-friends/${encodeURIComponent(username)}`, { method: 'PUT' }),
  removeCloseFriend: (username: string): Promise<void> => raw(`/stories/close-friends/${encodeURIComponent(username)}`, { method: 'DELETE' }),
  mentionsExist: (names: string[]): Promise<string[]> => raw(`/mentions/exist?names=${encodeURIComponent(names.join(','))}`),
  mentionable: (q: string): Promise<{ username: string; displayName: string; hasAvatar: boolean; following: boolean; verified?: boolean }[]> => raw(`/mentionable?q=${encodeURIComponent(q)}`),
  viewStory: (id: string): Promise<void> => raw(`/stories/${id}/view`, post({})),
  savePost: (id: string): Promise<{ saved: boolean }> => raw(`/posts/${id}/save`, { method: 'PUT' }),
  unsavePost: (id: string): Promise<{ saved: boolean }> => raw(`/posts/${id}/save`, { method: 'DELETE' }),
  savedPosts: (cursor?: string): Promise<{ items: Post[]; nextCursor: string | null }> => raw(`/feed/saved${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
  completeness: (): Promise<{ percent: number; steps: { id: 'photo' | 'bio' | 'post' | 'follow' | 'geleira'; done: boolean }[] }> => raw('/users/me/completeness'),
  insights: (days: 7 | 30 | 90, tz: number): Promise<Insights> => raw(`/insights?days=${days}&tz=${tz}`),
  boVenues: (filter: 'pending' | 'all'): Promise<{ slug: string; name: string; kind: string; city: string | null; verified: boolean; owner: string; checkins: number; createdAt: string }[]> => raw(`/venues/admin/list?filter=${filter}`),
  boVerifyVenue: (slug: string, verified: boolean): Promise<{ slug: string; verified: boolean }> => raw(`/venues/${encodeURIComponent(slug)}/verified`, { method: 'PUT', body: JSON.stringify({ verified }) }),
  venue: (slug: string): Promise<Venue> => raw(`/venues/${encodeURIComponent(slug)}`),
  findVenue: (name: string): Promise<Venue | null> => raw(`/venues/find?name=${encodeURIComponent(name)}`),
  myVenues: (): Promise<Venue[]> => raw('/venues/mine'),
  createVenue: (b: { name: string; kind: string; city?: string; about?: string }): Promise<Venue> => raw('/venues', post(b)),
  venueCheckin: (slug: string, token: string): Promise<Venue> => raw(`/venues/${encodeURIComponent(slug)}/checkin`, post({ token })),
  rotateVenueQr: (slug: string): Promise<Venue> => raw(`/venues/${encodeURIComponent(slug)}/qr/rotate`, post({})),
  placePosts: (label: string, mode: 'at' | 'near', cursor?: string): Promise<{ label: string; mode: 'at' | 'near'; hasNear: boolean; center: { lat: number; lng: number } | null; items: Post[]; nextCursor: string | null }> =>
    raw(`/feed/place?label=${encodeURIComponent(label)}&mode=${mode}${cursor ? `&cursor=${cursor}` : ''}`),
  updatePost: (id: string, b: { body?: string; commentsOff?: boolean; clearLocation?: boolean }): Promise<Post> => raw(`/posts/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
  setStoryComments: (id: string, commentsOff: boolean): Promise<{ commentsOff: boolean }> => raw(`/stories/${id}`, { method: 'PATCH', body: JSON.stringify({ commentsOff }) }),
  deleteStory: (id: string): Promise<void> => raw(`/stories/${id}`, { method: 'DELETE' }),
  replyStory: (id: string, body: string): Promise<{ id: string; kind: 'reply' | 'reaction' }> => raw(`/stories/${id}/replies`, post({ body })),
  storyReplies: (id: string): Promise<{ id: string; body: string; kind: 'reply' | 'reaction'; createdAt: string; author: { username: string; displayName: string } }[]> =>
    raw(`/stories/${id}/replies`),
  storyViewers: (id: string): Promise<{ username: string; displayName: string; viewedAt: string; cheered?: boolean }[]> => raw(`/stories/${id}/viewers`),
  cheerStory: (id: string, on: boolean): Promise<{ cheered: boolean }> => raw(`/stories/${id}/cheer`, { method: on ? 'PUT' : 'DELETE' }),

  nearbyPlaces: (lat: number, lng: number): Promise<NearbyPlaces> => raw(`/places/nearby?lat=${lat}&lng=${lng}`),
  postPeople: (postId: string, kind: PeopleKind): Promise<{ username: string; displayName: string; hasAvatar: boolean; verified: boolean; at: string }[]> => raw(`/posts/${postId}/people/${kind}`),
  chatList: (): Promise<Conversation[]> => raw('/chat/conversations'),
  notes: (): Promise<{ mine: Note | null; items: Note[] }> => raw('/notes'),
  setNote: (body: string, music?: Track | null): Promise<void> => raw('/notes/me', { method: 'PUT', body: JSON.stringify({ body, music: musicPayload(music) }) }),
  searchMusic: (q: string): Promise<Track[]> => raw(`/music/search?q=${encodeURIComponent(q)}`),
  deleteNote: (): Promise<void> => raw('/notes/me', { method: 'DELETE' }),
  cheerNote: (username: string): Promise<{ cheered: boolean; cheers: number }> => raw(`/notes/${encodeURIComponent(username)}/cheer`, post({})),
  replyNote: (username: string, text: string): Promise<{ id: string }> => raw(`/notes/${encodeURIComponent(username)}/reply`, post({ text })),
  chatGroups: (): Promise<GroupSummary[]> => raw('/chat/groups'),
  chatGroupThread: (id: string, cursor?: string): Promise<GroupThread> => raw(`/chat/groups/${id}${cursor ? `?cursor=${cursor}` : ''}`),
  chatGroupSend: (id: string, msg: { body?: string; kind?: ChatMessage['kind']; mediaId?: string; durationMs?: number; waveform?: string; lat?: number; lng?: number; replyTo?: string }): Promise<{ id: string }> =>
    raw(`/chat/groups/${id}/messages`, post(msg)),
  chatGroupCreate: (name: string, members: string[]): Promise<{ id: string }> => raw('/chat/groups', post({ name, members })),
  chatGroupRename: (id: string, name: string): Promise<void> => raw(`/chat/groups/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  chatGroupAdd: (id: string, members: string[]): Promise<void> => raw(`/chat/groups/${id}/members`, post({ members })),
  chatGroupRemove: (id: string, username: string): Promise<void> => raw(`/chat/groups/${id}/members/${encodeURIComponent(username)}`, { method: 'DELETE' }),
  chatUnread: (): Promise<{ conversations: number; requests?: number }> => raw('/chat/unread'),
  chatThread: (username: string, cursor?: string): Promise<ChatThread> => raw(`/chat/with/${encodeURIComponent(username)}${cursor ? `?cursor=${cursor}` : ''}`),
  chatSend: (username: string, msg: { body?: string; kind?: ChatMessage['kind']; mediaId?: string; durationMs?: number; waveform?: string; lat?: number; lng?: number; once?: boolean; liveMinutes?: 15 | 60 | 480; replyTo?: string }): Promise<{ id: string }> =>
    raw(`/chat/with/${encodeURIComponent(username)}`, post(msg)),
  /** Abrir uma mensagem de visualização única: devolve o conteúdo uma vez. */
  chatOpen: (id: string): Promise<{ kind: ChatMessage['kind']; body: string; mediaUrl: string | null; durationMs: number | null; waveform: string | null }> => raw(`/chat/messages/${id}/open`, post({})),
  chatLiveUpdate: (id: string, lat: number, lng: number): Promise<void> => raw(`/chat/messages/${id}/location`, { method: 'PUT', body: JSON.stringify({ lat, lng }) }),
  chatReact: (id: string, reaction: string): Promise<void> => raw(`/chat/messages/${id}/reaction`, { method: 'PUT', body: JSON.stringify({ reaction }) }),
  chatUnreact: (id: string): Promise<void> => raw(`/chat/messages/${id}/reaction`, { method: 'DELETE' }),
  chatLiveStop: (id: string): Promise<void> => raw(`/chat/messages/${id}/live`, { method: 'DELETE' }),
  chatAccept: (username: string): Promise<void> => raw(`/chat/with/${encodeURIComponent(username)}/accept`, post({})),
  chatDecline: (username: string): Promise<void> => raw(`/chat/with/${encodeURIComponent(username)}/decline`, post({})),
  chatActive: (key: string | null): Promise<void> => raw('/chat/active', { method: 'PUT', body: JSON.stringify({ key }) }),
  chatTyping: (username: string): Promise<void> => raw(`/chat/with/${encodeURIComponent(username)}/typing`, post({})),
  chatDelete: (id: string): Promise<void> => raw(`/chat/messages/${id}`, { method: 'DELETE' }),
  /** Envia uma foto ou gravação para o chat (ficheiro privado). */
  async uploadChatFile(original: Blob, originalMime: string): Promise<string> {
    const shrunk = originalMime.startsWith('image/') ? await shrinkImage(original as File) : original;
    const file = shrunk;
    const mime = shrunk.type || originalMime;
    const { assetId, uploadUrl } = await raw('/media/uploads', post({ mime, size: file.size, purpose: 'chat' }));
    const res = await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': mime } });
    if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => ({}))).message ?? 'Falha no envio');
    await raw(`/media/${assetId}/complete`, post({}));
    return assetId;
  },
  storyComments: (id: string): Promise<StoryComment[]> => raw(`/stories/${id}/comments`),
  commentStory: (id: string, body: string): Promise<{ id: string }> => raw(`/stories/${id}/comments`, post({ body })),
  deleteStoryComment: (commentId: string): Promise<void> => raw(`/stories/comments/${commentId}`, { method: 'DELETE' }),
  /** Abre pelo id ou pelo código curto dos links. */
  getPost: (idOrCode: string): Promise<Post> => raw(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrCode) ? `/posts/${idOrCode}` : `/posts/code/${encodeURIComponent(idOrCode)}`),
  report: (type: Exclude<ReportType, 'media'>, id: string, reason: ReportReason, note?: string): Promise<void> => raw('/reports', post({ type, id, reason, note })),
  removePost: (id: string): Promise<void> => raw(`/posts/${id}`, { method: 'DELETE' }),
  adminQueue: (): Promise<ReportQueueItem[]> => raw('/admin/reports'),
  typingPing: (postId: string): Promise<void> => raw('/presence/typing', post({ postId })),
  typers: async (postId: string): Promise<string[]> => ((await raw(`/presence/typing?postId=${postId}`)) as { names: string[] }).names,
  geleiraLevel: (username: string): Promise<GeleiraLevel> => raw(`/users/${encodeURIComponent(username)}/geleira/level`),
  matchContacts: (hashes: string[]): Promise<Suggestion[]> => raw('/contacts/match', post({ hashes })),
  paymentsConfig: (): Promise<PaymentsConfig> => raw('/payments/config'),
  paymentsOrders: (): Promise<PaymentOrder[]> => raw('/payments/orders'),
  paymentsOrder: (id: string): Promise<PaymentOrder> => raw(`/payments/orders/${id}`),
  paymentsCreate: (b: { packageId: string; provider: string; phone?: string }, key: string): Promise<PaymentOrder> => raw('/payments/orders', post(b, { 'Idempotency-Key': key })),
  paymentsCancel: (id: string): Promise<void> => raw(`/payments/orders/${id}/cancel`, post({})),
  paymentsSandboxPay: (id: string): Promise<PaymentOrder> => raw(`/payments/orders/${id}/sandbox-pay`, post({})),
  verificationStatus: (): Promise<VerificationStatus> => raw('/verification/me'),
  verificationRequest: (b: { kind: 'person' | 'business'; fullName: string; proof: string; docMediaId: string; selfieMediaId: string }): Promise<void> => raw('/verification/request', post(b)),
  verificationWithdraw: (): Promise<void> => raw('/verification/request', { method: 'DELETE' }),
  adminVerifications: (): Promise<VerificationItem[]> => raw('/admin/verifications'),
  verificationDecide: (id: string, action: 'approve' | 'reject', reason?: string, tier?: 'verified' | 'official'): Promise<void> => raw(`/admin/verifications/${id}/decide`, post({ action, reason, tier })),
  adminResolve: (type: ReportType, id: string, action: 'dismiss' | 'remove' | 'suspend', note?: string): Promise<void> => raw('/admin/reports/resolve', post({ type, id, action, note })),
  boOverview: (): Promise<Record<string, number>> => raw('/admin/overview'),
  boMe: (): Promise<BoMe> => raw('/admin/me'),
  boStaff: (): Promise<BoStaffMember[]> => raw('/admin/staff'),
  boInvite: (email: string, name: string, teams: string[]): Promise<{ accountId: string; setupUrl: string; expiresInMinutes: number }> => raw('/admin/staff/invite', post({ email, name, teams })),
  boSetTeams: (id: string, teams: string[], reason: string): Promise<void> => raw(`/admin/staff/${id}/teams`, post({ teams, reason })),
  boSetActive: (id: string, active: boolean, reason: string): Promise<void> => raw(`/admin/staff/${id}/active`, post({ active, reason })),
  boResetAccess: (id: string, reason: string): Promise<{ setupUrl: string; expiresInMinutes: number }> => raw(`/admin/staff/${id}/reset`, post({ reason })),
  staffLogin: (email: string, password: string, code: string): Promise<{ token: string }> => raw('/staff-auth/login', post({ email, password, code })),
  staffSetupInfo: (token: string): Promise<StaffSetupInfo> => raw(`/staff-auth/setup?token=${encodeURIComponent(token)}`),
  staffSetup: (token: string, password: string, code: string): Promise<{ token: string }> => raw('/staff-auth/setup', post({ token, password, code })),
  staffMe: (): Promise<{ email: string; name: string }> => raw('/staff-auth/me'),
  staffLogout: (): Promise<void> => raw('/staff-auth/logout', { method: 'POST' }),
  boUsers: (q: string, status: string, cursor?: string): Promise<{ items: BoUserRow[]; nextCursor: string | null }> =>
    raw(`/admin/users?${new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}), ...(cursor ? { cursor } : {}) }).toString()}`),
  boUser: (id: string): Promise<BoUserSheet> => raw(`/admin/users/${id}`),
  boVerifyEmail: (id: string, reason: string): Promise<void> => raw(`/admin/users/${id}/verify-email`, post({ reason })),
  boSuspend: (id: string, reason: string): Promise<void> => raw(`/admin/users/${id}/suspend`, post({ reason })),
  boReactivate: (id: string, reason: string): Promise<void> => raw(`/admin/users/${id}/reactivate`, post({ reason })),
  boNote: (id: string, body: string): Promise<void> => raw(`/admin/users/${id}/notes`, post({ body })),
  boDecided: (status: 'actioned' | 'dismissed', cursor?: string): Promise<{ items: BoDecided[]; nextCursor: string | null }> =>
    raw(`/admin/reports/decided?${new URLSearchParams({ status, ...(cursor ? { cursor } : {}) }).toString()}`),
  boAudit: (action: string, actor: string, cursor?: string): Promise<{ items: BoAuditRow[]; nextCursor: string | null }> =>
    raw(`/admin/audit?${new URLSearchParams({ ...(action ? { action } : {}), ...(actor ? { actor } : {}), ...(cursor ? { cursor } : {}) }).toString()}`),
  /** Ficheiro com todos os meus dados (JSON). */
  async exportData(): Promise<Blob> {
    const res = await fetch('/api/v1/me/export', { headers: authHeader() });
    if (!res.ok) throw new ApiError(res.status, res.status === 429 ? 'Já descarregaste vários ficheiros. Tenta daqui a pouco.' : 'Não consegui preparar o ficheiro');
    return res.blob();
  },
  pushKey: (): Promise<{ publicKey: string | null }> => raw('/push/key'),
  pushSubscribe: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }): Promise<void> => raw('/push/subscribe', post(sub)),
  pushTest: (): Promise<void> => raw('/push/test', post({})),
  pushUnsubscribe: (endpoint: string): Promise<void> => raw('/push/subscribe', { method: 'DELETE', body: JSON.stringify({ endpoint }) }),
  trending: (): Promise<{ tags: TrendingTag[] }> => raw('/search/trending'),
  searchTags: (q: string): Promise<{ tags: TagCount[] }> => raw(`/search/tags?q=${encodeURIComponent(q)}`),
  tagPage: (tag: string, sort: 'recent' | 'top', cursor?: string): Promise<TagPage> => raw(`/tags/${encodeURIComponent(tag)}?sort=${sort}&limit=10${cursor ? `&cursor=${cursor}` : ''}`),
  adminStats: (days: number): Promise<AdminStats> => raw(`/admin/stats?days=${days}`),
  explore: (topic: string | null, cursor?: string): Promise<Page<Post>> => raw(`/feed/explore?limit=18${topic ? `&topic=${encodeURIComponent(topic)}` : ''}${cursor ? `&cursor=${cursor}` : ''}`),
  setInterest: (id: string, value: 1 | -1): Promise<{ value: number }> => raw(`/posts/${id}/interest`, { method: 'PUT', body: JSON.stringify({ value }) }),
  explorePrefs: (): Promise<Record<string, number>> => raw('/feed/prefs'),
  exploreActivity: (): Promise<{ id: string; label: string }[]> => raw('/feed/algorithm'),
  setExplorePref: (topic: string, pref: -1 | 0 | 1): Promise<Record<string, number>> => raw('/feed/prefs', { method: 'PUT', body: JSON.stringify({ topic, pref }) }),
  resetExplore: (): Promise<void> => raw('/feed/prefs', { method: 'DELETE' }),
  exploreTopics: (all = false): Promise<{ id: string; label: string; count: number }[]> => raw(`/feed/explore/topics${all ? '?all=1' : ''}`),
  reels: (cursor?: string): Promise<Page<Post>> => raw(`/feed/reels${cursor ? `?cursor=${cursor}&limit=6` : '?limit=6'}`),
  /**
   * Envia um vídeo curto: mostra o progresso do envio, espera pela conversão no servidor (MP4 até 60 s)
   * e devolve o id do ficheiro pronto a usar numa publicação.
   */
  async uploadVideo(file: File, on: { progress: (fraction: number) => void; stage: (s: 'uploading' | 'processing') => void }, purpose: 'public' | 'chat' = 'public'): Promise<string> {
    const mime = ['video/mp4', 'video/quicktime', 'video/webm'].includes(file.type) ? file.type : 'video/mp4';
    const { assetId, uploadUrl } = await raw('/media/uploads', post({ mime, size: file.size, purpose }));
    on.stage('uploading');
    await new Promise<void>((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('PUT', uploadUrl);
      x.setRequestHeader('Content-Type', mime);
      x.upload.onprogress = (e) => e.lengthComputable && on.progress(e.loaded / e.total);
      x.onload = () => {
        if (x.status < 300) return resolve();
        let msg = 'Falha no envio do vídeo';
        try {
          msg = JSON.parse(x.responseText).message ?? msg;
        } catch {
          /* resposta sem JSON */
        }
        reject(new ApiError(x.status, msg));
      };
      x.onerror = () => reject(new ApiError(0, 'Sem ligação. Tenta outra vez.'));
      x.send(file);
    });
    on.stage('processing');
    let st: { status: string; error?: string } = await raw(`/media/${assetId}/complete`, post({}));
    for (let i = 0; st.status === 'processing' && i < 180; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      st = await raw(`/media/${assetId}/status`);
    }
    if (st.status !== 'ready') throw new ApiError(422, st.error ?? 'Não consegui processar o vídeo.');
    return assetId;
  },
  shareToStory: (postId: string, audience: 'all' | 'close_friends' = 'all', caption = ''): Promise<Story> => raw('/stories/share', post({ postId, audience, caption })),
  untagMe: (postId: string): Promise<Post> => raw(`/posts/${postId}/tags/me`, { method: 'DELETE' }),
  hotPlaces: (): Promise<{ name: string; posts: number }[]> => raw('/places/hot'),
  searchPlaces: (q: string, at?: { lat: number; lng: number }): Promise<{ name: string; sub: string; kind: string }[]> =>
    raw(`/places/search?q=${encodeURIComponent(q)}${at ? `&lat=${at.lat}&lng=${at.lng}` : ''}`),

  wallet: (): Promise<WalletView> => raw('/wallet'),

  /** Fluxo de upload pré-assinado: pede URL temporário e envia os bytes directamente para ele. */
  async uploadImage(original: File): Promise<string> {
    const file = await shrinkImage(original);
    const { assetId, uploadUrl } = await raw('/media/uploads', post({ mime: file.type, size: file.size }));
    const res = await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
    if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => ({}))).message ?? 'Falha no upload');
    await raw(`/media/${assetId}/complete`, post({})); // valida o ficheiro (no armazenamento na nuvem)
    return assetId;
  },
  newKey,
};

export interface InsightsBucket { label: string; value: number; pct: number }
export interface Insights {
  days: number;
  overview: { reach: number; reachDelta: number; interactions: number; interactionsDelta: number; followers: number; newFollowers: number; newFollowersDelta: number; profileVisitors: number; profileVisitorsDelta: number; storyViews: number };
  interactions: { cheers: number; comments: number; reposts: number; gifts: number; storyCheers: number; storyReplies: number };
  series: { day: string; reach: number; interactions: number; followers: number }[];
  hours: { hour: number; value: number }[];
  weekdays: { dow: number; value: number }[];
  top: { id: string; code: string; body: string; mediaUrl: string | null; video: boolean; createdAt: string; cheers: number; comments: number; reposts: number; gifts: number; reach: number }[];
  audience: { enough: false; minimum: number; followers: number } | { enough: true; followers: number; gender: InsightsBucket[]; ages: InsightsBucket[]; countries: InsightsBucket[]; cities: InsightsBucket[]; interests: InsightsBucket[] };
}

export interface Venue {
  id: string;
  slug: string;
  name: string;
  kind: 'bar' | 'restaurante' | 'discoteca' | 'cafe' | 'hotel' | 'evento' | 'outro';
  city: string | null;
  about: string | null;
  verified: boolean;
  lat: number | null;
  lng: number | null;
  checkins: number;
  checkinsToday: number;
  mine: boolean;
  /** Só o dono o recebe. */
  qrToken?: string;
  checkedIn: boolean;
}
