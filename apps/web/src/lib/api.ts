import type { AuthResponse } from '@txillapp/shared';

/** Access token só em memória (nunca localStorage); o refresh vive num cookie HttpOnly. */
let accessToken: string | null = null;
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
  media: { url: string }[];
  createdAt: string;
  author: { id: string; username: string; displayName: string };
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
  kind: 'post' | 'gift' | 'repost';
  reposts: number;
  reposted: boolean;
  /** Preenchido nos reposts: a publicação original. */
  repostOf?: Post | null;
}
export interface Comment {
  id: string;
  postId: string;
  parentId: string | null;
  body: string;
  createdAt: string;
  author: { id: string; username: string; displayName: string };
  cheers: number;
  cheered: boolean;
  replyCount: number;
}
export interface Profile {
  id: string;
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
  latestAt: string;
}
export interface Story {
  id: string;
  mediaUrl: string;
  caption: string | null;
  createdAt: string;
  expiresAt: string;
  author: { username: string; displayName: string };
  seen: boolean;
  viewCount: number | null;
  /** Só para o autor: quantas respostas/reacções recebeu. */
  replyCount: number | null;
  /** O autor aceita respostas deste espectador? */
  canReply: boolean;
}
export type Who = 'everyone' | 'following' | 'off';
export interface PrivacySettings {
  isPrivate: boolean;
  commentsAllowed: Who;
  giftsAllowed: Who;
  showConnections: 'everyone' | 'followers' | 'me';
  suggestable: boolean;
}
export interface StorySettings {
  replies: Who;
  hidden: { username: string; displayName: string }[];
}
export type GiftVisibility = 'silent' | 'private' | 'public';
export type NotificationKind = 'blocked' | 'follow' | 'follow_request' | 'request_accepted' | 'gift' | 'comment' | 'reply' | 'story_reply' | 'repost';
export interface AppNotification {
  id: string;
  kind: NotificationKind;
  data: { amount?: number; note?: string; snippet?: string; postId?: string; replyKind?: 'reply' | 'reaction' };
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
  people: { username: string; displayName: string; isPrivate: boolean; following: boolean; requested: boolean; followsYou: boolean }[];
  posts: Post[];
}
export interface NearbyPlaces {
  area: string | null;
  city: string | null;
  places: { name: string; kind: string; distanceM: number }[];
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
const newKey = () => crypto.randomUUID();
const qs = (cursor?: string, limit?: number) => `?${limit ? `limit=${limit}&` : ''}${cursor ? `cursor=${cursor}` : ''}`;

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
  followers: (username: string, cursor?: string): Promise<Page<Person>> => raw(`/users/${encodeURIComponent(username)}/followers${qs(cursor)}`),
  following: (username: string, cursor?: string): Promise<Page<Person>> => raw(`/users/${encodeURIComponent(username)}/following${qs(cursor)}`),
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
  googleComplete: (signupToken: string, username: string): Promise<AuthResponse> => raw('/auth/google/complete', post({ signupToken, username })),

  feed: (cursor?: string): Promise<Page<Post>> => raw(`/posts${qs(cursor, 10)}`),
  createPost: (b: { body: string; locationLabel?: string; mediaIds: string[] }): Promise<Post> => raw('/posts', post(b)),
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
  createStory: (mediaId: string, caption: string): Promise<Story> => raw('/stories', post({ mediaId, caption })),
  viewStory: (id: string): Promise<void> => raw(`/stories/${id}/view`, post({})),
  deleteStory: (id: string): Promise<void> => raw(`/stories/${id}`, { method: 'DELETE' }),
  replyStory: (id: string, body: string): Promise<{ id: string; kind: 'reply' | 'reaction' }> => raw(`/stories/${id}/replies`, post({ body })),
  storyReplies: (id: string): Promise<{ id: string; body: string; kind: 'reply' | 'reaction'; createdAt: string; author: { username: string; displayName: string } }[]> =>
    raw(`/stories/${id}/replies`),
  storyViewers: (id: string): Promise<{ username: string; displayName: string; viewedAt: string }[]> => raw(`/stories/${id}/viewers`),

  nearbyPlaces: (lat: number, lng: number): Promise<NearbyPlaces> => raw(`/places/nearby?lat=${lat}&lng=${lng}`),

  wallet: (): Promise<WalletView> => raw('/wallet'),

  /** Fluxo de upload pré-assinado: pede URL temporário e envia os bytes directamente para ele. */
  async uploadImage(file: File): Promise<string> {
    const { assetId, uploadUrl } = await raw('/media/uploads', post({ mime: file.type, size: file.size }));
    const res = await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
    if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => ({}))).message ?? 'Falha no upload');
    return assetId;
  },
  newKey,
};
