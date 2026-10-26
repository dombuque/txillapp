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
/** Cabeçalho de autorização para pedidos fora do `raw` (por exemplo, o canal em tempo real). */
export const authHeader = (): Record<string, string> => (accessToken ? { Authorization: `Bearer ${accessToken}` } : {});
export const setAccessToken = (t: string | null) => {
  accessToken = t;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface Post {
  id: string;
  body: string;
  locationLabel: string | null;
  media: { url: string; tags: PhotoTag[]; kind?: 'image' | 'video'; posterUrl?: string; durationMs?: number | null; width?: number | null; height?: number | null }[];
  createdAt: string;
  author: { id: string; username: string; displayName: string; verified?: boolean };
  cheers: number;
  comments: number;
  gifts: number;
  cheered: boolean;
  /** Preenchido nos posts "X presenteou Y". */
  gift: { amount: number; recipient: { username: string; displayName: string } } | null;
  /** Conforme as definições do autor. */
  canComment: boolean;
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
  author: { id: string; username: string; displayName: string; verified?: boolean };
  cheers: number;
  cheered: boolean;
  replyCount: number;
}
export interface Profile {
  id: string;
  verified?: boolean;
  /** Só vem preenchido se a pessoa escolheu mostrá-lo (ou sou eu). */
  gender?: Gender | null;
  username: string;
  displayName: string;
  bio: string | null;
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
  /** Só para o autor: quantas respostas/reacções recebeu. */
  replyCount: number | null;
  /** Comentários públicos (o número é visível a quem vê o story). */
  commentCount: number;
  /** O autor aceita respostas deste espectador? */
  canReply: boolean;
}
export type Gender = 'female' | 'male' | 'other' | 'unspecified';
export type ReportType = 'post' | 'comment' | 'story' | 'user' | 'message' | 'media';
export type ReportReason = 'spam' | 'harassment' | 'hate' | 'nudity' | 'violence' | 'scam' | 'impersonation' | 'minor' | 'other';
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
  lastMessage: { body: string; kind: 'text' | 'story_reply' | 'story_reaction' | 'image' | 'voice'; fromMe: boolean; at: string };
  unread: number;
}
export interface ChatMessage {
  id: string;
  fromMe: boolean;
  body: string;
  kind: 'text' | 'story_reply' | 'story_reaction' | 'image' | 'voice';
  storyUrl: string | null;
  /** Foto ou voz do chat: URL assinado e temporário. */
  mediaUrl: string | null;
  durationMs: number | null;
  at: string;
}
export interface ChatThread {
  person: { username: string; displayName: string; hasAvatar: boolean };
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
  isAdmin: boolean;
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
export interface StorySettings {
  replies: Who;
  hidden: { username: string; displayName: string }[];
}
export type GiftVisibility = 'silent' | 'private' | 'public';
export type NotificationKind = 'blocked' | 'follow' | 'follow_request' | 'request_accepted' | 'gift' | 'comment' | 'reply' | 'story_reply' | 'repost' | 'mention' | 'tag';
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
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...init.headers,
    },
  });
  // Access token expirado: renova uma vez e repete o pedido.
  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
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
  login: (b: unknown): Promise<AuthResponse> => raw('/auth/login', post(b)),
  // Partilha o pedido em curso: dois refresh com o mesmo token (StrictMode, vários separadores) seriam tratados como reutilização.
  refresh: (): Promise<AuthResponse> => refreshOnce(),
  logout: (): Promise<void> => raw('/auth/logout', { method: 'POST' }),

  profile: (username: string): Promise<Profile> => raw(`/users/${encodeURIComponent(username)}`),
  userPosts: (username: string, cursor?: string): Promise<Page<Post>> => raw(`/users/${encodeURIComponent(username)}/posts${qs(cursor, 18)}`),
  follow: (username: string): Promise<FollowState> => raw(`/users/${encodeURIComponent(username)}/follow`, post({})),
  unfollow: (username: string): Promise<FollowState> => raw(`/users/${encodeURIComponent(username)}/follow`, { method: 'DELETE' }),
  followers: (username: string, cursor?: string, q?: string): Promise<Page<Person>> => raw(`/users/${encodeURIComponent(username)}/followers${qs(cursor, undefined, q)}`),
  following: (username: string, cursor?: string, q?: string): Promise<Page<Person>> => raw(`/users/${encodeURIComponent(username)}/following${qs(cursor, undefined, q)}`),
  updateMe: (b: { displayName?: string; bio?: string; isPrivate?: boolean }): Promise<{ id: string; username: string; displayName: string; bio: string | null; isPrivate: boolean }> =>
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
  createPost: (b: { body: string; locationLabel?: string; mediaIds: string[]; tags?: { index: number; username: string; x: number; y: number }[] }): Promise<Post> => raw('/posts', post(b)),
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

  privacy: (): Promise<PrivacySettings> => raw('/settings/privacy'),
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
  storiesOf: (username: string): Promise<Story[]> => raw(`/stories/user/${encodeURIComponent(username)}`),
  createStory: (mediaId: string, caption: string, audience: 'all' | 'close_friends' = 'all'): Promise<Story> => raw('/stories', post({ mediaId, caption, audience })),
  closeFriends: (): Promise<{ username: string; displayName: string; hasAvatar: boolean }[]> => raw('/stories/close-friends'),
  addCloseFriend: (username: string): Promise<void> => raw(`/stories/close-friends/${encodeURIComponent(username)}`, { method: 'PUT' }),
  removeCloseFriend: (username: string): Promise<void> => raw(`/stories/close-friends/${encodeURIComponent(username)}`, { method: 'DELETE' }),
  mentionable: (q: string): Promise<{ username: string; displayName: string; hasAvatar: boolean; following: boolean; verified?: boolean }[]> => raw(`/mentionable?q=${encodeURIComponent(q)}`),
  viewStory: (id: string): Promise<void> => raw(`/stories/${id}/view`, post({})),
  deleteStory: (id: string): Promise<void> => raw(`/stories/${id}`, { method: 'DELETE' }),
  replyStory: (id: string, body: string): Promise<{ id: string; kind: 'reply' | 'reaction' }> => raw(`/stories/${id}/replies`, post({ body })),
  storyReplies: (id: string): Promise<{ id: string; body: string; kind: 'reply' | 'reaction'; createdAt: string; author: { username: string; displayName: string } }[]> =>
    raw(`/stories/${id}/replies`),
  storyViewers: (id: string): Promise<{ username: string; displayName: string; viewedAt: string }[]> => raw(`/stories/${id}/viewers`),

  nearbyPlaces: (lat: number, lng: number): Promise<NearbyPlaces> => raw(`/places/nearby?lat=${lat}&lng=${lng}`),
  postPeople: (postId: string, kind: PeopleKind): Promise<{ username: string; displayName: string; hasAvatar: boolean; verified: boolean; at: string }[]> => raw(`/posts/${postId}/people/${kind}`),
  chatList: (): Promise<Conversation[]> => raw('/chat/conversations'),
  chatUnread: (): Promise<{ conversations: number }> => raw('/chat/unread'),
  chatThread: (username: string, cursor?: string): Promise<ChatThread> => raw(`/chat/with/${encodeURIComponent(username)}${cursor ? `?cursor=${cursor}` : ''}`),
  chatSend: (username: string, msg: { body?: string; kind?: 'text' | 'image' | 'voice'; mediaId?: string; durationMs?: number }): Promise<{ id: string }> =>
    raw(`/chat/with/${encodeURIComponent(username)}`, post(msg)),
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
  getPost: (id: string): Promise<Post> => raw(`/posts/${id}`),
  report: (type: Exclude<ReportType, 'media'>, id: string, reason: ReportReason, note?: string): Promise<void> => raw('/reports', post({ type, id, reason, note })),
  removePost: (id: string): Promise<void> => raw(`/posts/${id}`, { method: 'DELETE' }),
  adminQueue: (): Promise<ReportQueueItem[]> => raw('/admin/reports'),
  adminResolve: (type: ReportType, id: string, action: 'dismiss' | 'remove' | 'suspend'): Promise<void> => raw('/admin/reports/resolve', post({ type, id, action })),
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
  reels: (cursor?: string): Promise<Page<Post>> => raw(`/feed/reels${cursor ? `?cursor=${cursor}&limit=6` : '?limit=6'}`),
  /**
   * Envia um vídeo curto: mostra o progresso do envio, espera pela conversão no servidor (MP4 até 60 s)
   * e devolve o id do ficheiro pronto a usar numa publicação.
   */
  async uploadVideo(file: File, on: { progress: (fraction: number) => void; stage: (s: 'uploading' | 'processing') => void }): Promise<string> {
    const mime = ['video/mp4', 'video/quicktime', 'video/webm'].includes(file.type) ? file.type : 'video/mp4';
    const { assetId, uploadUrl } = await raw('/media/uploads', post({ mime, size: file.size }));
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
  shareToStory: (postId: string, audience: 'all' | 'close_friends' = 'all'): Promise<Story> => raw('/stories/share', post({ postId, audience })),
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
