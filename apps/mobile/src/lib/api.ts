import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { SITE_URL } from './config';

/** Resposta de entrada: a app nativa recebe também o token de renovação (guardado no cofre do telemóvel, nunca em texto simples). */
export interface PublicUser { id: string; username: string; displayName: string }
export interface AuthResult { accessToken: string; /** Só na app nativa; na web vai no cookie. */ refreshToken?: string; user: PublicUser }

export interface PostMedia { url: string; kind?: 'image' | 'video'; posterUrl?: string; width?: number | null; height?: number | null; durationMs?: number | null; tags?: { username: string }[] }
export interface Author { id: string; username: string; displayName: string; verified?: boolean; verifiedTier?: 'verified' | 'official' | null }
export interface Post {
  /** Música da publicação (licença aberta ou clipe próprio). */
  music?: import('./api.music').Track | null;
  id: string;
  code: string;
  body: string;
  locationLabel: string | null;
  media: PostMedia[];
  createdAt: string;
  author: Author;
  cheers: number;
  comments: number;
  cheered: boolean;
  reposts: number;
  reposted: boolean;
  gifts: number;
  saved?: boolean;
  canGift: boolean;
  canComment?: boolean;
  commentsOff?: boolean;
  editedAt?: string | null;
  lists?: { reposts: boolean; cheers: boolean; gifts: boolean };
  feed?: { source: 'following' | 'self' | 'discover'; seen: boolean };
  kind: 'post' | 'gift' | 'repost';
  repostOf?: Post | null;
  gift: { amount: number; recipient: { username: string; displayName: string } } | null;
}
export interface Comment {
  id: string;
  postId: string;
  parentId: string | null;
  body: string;
  createdAt: string;
  author: Author;
  cheers: number;
  cheered: boolean;
  replyCount: number;
  editedAt?: string | null;
  authorFollowed?: boolean;
}
export type GiftVisibility = 'silent' | 'private' | 'public';
export type ReportReason = 'spam' | 'harassment' | 'hate' | 'nudity' | 'violence' | 'scam' | 'impersonation' | 'minor' | 'other';
export type ReportType = 'post' | 'comment' | 'story' | 'user' | 'message';
export type NotificationKind = 'blocked' | 'follow' | 'follow_request' | 'request_accepted' | 'gift' | 'comment' | 'reply' | 'story_reply' | 'repost' | 'mention' | 'tag' | 'verified';
export interface AppNotification {
  id: string;
  kind: NotificationKind;
  data: { amount?: number; note?: string; snippet?: string; postId?: string; commentId?: string; storyId?: string; replyKind?: 'reply' | 'reaction' | 'comment' };
  createdAt: string;
  read: boolean;
  actor: { username: string; displayName: string };
}
export type ProfileTab = 'all' | 'reels' | 'reposts' | 'gifts' | 'saved';
export interface Person { username: string; displayName: string; following: boolean; followsYou: boolean; isPrivate?: boolean; requested?: boolean; verified?: boolean }
export interface InvitesInfo {
  code: string;
  link: string;
  stats: { invited: number; active: number; pending: number; paid: number; earned: number; today: number };
  rules: { reward: number; perDay: number; maxPaid: number; holdDays: number };
  eligible: boolean;
  note: string | null;
}
export interface WalletView {
  currency: string;
  balance: number;
  history: { id: string; amount: number; type: string; createdAt: string; counterparty: { username: string; displayName: string } | null; note: string | null }[];
}
export interface TagPage { tag: string; posts: number; authors: number; items: Post[]; nextCursor: string | null }
function qsp(cursor?: string, q?: string) {
  const p = [cursor ? `cursor=${encodeURIComponent(cursor)}` : '', q ? `q=${encodeURIComponent(q)}` : ''].filter(Boolean).join('&');
  return p ? `?${p}` : '';
}
export type Who = 'everyone' | 'following' | 'off';
export type Viewers = 'everyone' | 'followers' | 'off';
export type Gender = 'female' | 'male' | 'other' | 'unspecified';
export interface PrivacySettings {
  isPrivate: boolean;
  shareAnalytics: boolean;
  showPresence: boolean;
  findByContacts: boolean;
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
export interface StorySettings { replies: Who; hidden: { username: string; displayName: string }[] }
export interface DeviceSession { id: string; device: string; firstSeen: string; lastUsed: string; current: boolean }
export type DocType = 'id_card' | 'passport' | 'driver_licence' | 'residence' | 'other';
export interface VerificationStatus {
  items: { key: string; label: string; ok: boolean; hint: string }[];
  eligible: boolean;
  verified: boolean;
  tier: 'verified' | 'official' | null;
  request: { id: string; kind: string; status: 'pending' | 'approved' | 'rejected' | 'withdrawn'; reason: string | null; createdAt: string } | null;
  retryAfter: string | null;
}
export interface FeedSettings {
  following: 'less' | 'balanced' | 'more';
  freshness: 'recent' | 'balanced' | 'popular';
  media: 'all' | 'photos' | 'videos';
  variety: 'low' | 'normal' | 'high';
  hideSeen: boolean;
  calm: boolean;
}
export interface FeedPerson { username: string; displayName: string; hasAvatar: boolean; pref: number }
export interface FollowState { following: boolean; requested: boolean; followers: number }
export interface Profile {
  id: string;
  verified?: boolean;
  verifiedTier?: 'verified' | 'official' | null;
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
  blockedByMe: boolean;
  blockedMe: boolean;
  canView: boolean;
  canSeeConnections: boolean;
  pendingRequests: number;
  activeStories: number;
  counts: { posts: number; followers: number; following: number };
}
export interface SearchResults {
  query: string;
  people: { username: string; displayName: string; verified?: boolean; isPrivate: boolean; following: boolean; requested: boolean; followsYou: boolean }[];
  posts: Post[];
  tags: { tag: string; posts: number }[];
}
export interface TrendingTag { tag: string; posts: number; rising?: boolean }
export type MsgKind = 'text' | 'story_reply' | 'story_reaction' | 'image' | 'voice' | 'video' | 'sticker' | 'location' | 'post' | 'gift';
export interface ChatMessage {
  id: string;
  fromMe: boolean;
  body: string;
  kind: MsgKind;
  giftAmount?: number | null;
  post?: Post | null;
  storyUrl: string | null;
  mediaUrl: string | null;
  durationMs: number | null;
  waveform?: string | null;
  lat?: number | null;
  lng?: number | null;
  viewOnce?: boolean;
  opened?: boolean;
  replyTo?: { id: string; gone: true } | { id: string; gone: false; fromMe: boolean; name: string; kind: MsgKind; body: string } | null;
  reactions?: { reaction: string; count: number; mine: boolean }[];
  at: string;
}
export interface Presence { online: boolean; lastSeen: string | null }
export interface Conversation {
  username: string;
  displayName: string;
  hasAvatar: boolean;
  lastMessage: { body: string; kind: MsgKind; fromMe: boolean; at: string };
  presence?: Presence | null;
  request?: boolean;
  unread: number;
}
export interface GroupSummary {
  kind: 'group';
  id: string;
  name: string;
  members: number;
  preview: { username: string; displayName: string; hasAvatar: boolean }[];
  lastMessage: { body: string; kind: MsgKind; fromMe: boolean; senderName: string | null; at: string; empty: boolean };
  unread: number;
}
export interface ChatThread {
  relation?: { iFollow: boolean; theyFollow: boolean; request: boolean; left: number | null };
  person: { username: string; displayName: string; hasAvatar: boolean; canGift?: boolean; presence?: Presence | null };
  blocked: boolean;
  otherRead: string | null;
  items: ChatMessage[];
  nextCursor: string | null;
}
export interface Story {
  id: string;
  mediaUrl: string;
  caption: string | null;
  audience: 'all' | 'close_friends';
  mediaKind: 'image' | 'video';
  durationMs: number | null;
  sharedFrom: { postId: string; username: string; displayName: string } | null;
  createdAt: string;
  expiresAt: string;
  author: { username: string; displayName: string };
  seen: boolean;
  viewCount: number | null;
  cheered?: boolean;
  cheerCount?: number | null;
  replyCount?: number | null;
  commentCount: number;
  commentsOff?: boolean;
  /** O espectador pode responder? */
  canReply: boolean;
  music?: { id: string; title: string; artist: string; url: string; kind?: 'clip' } | null;
}
export interface StoryComment { id: string; body: string; createdAt: string; mine: boolean; canDelete: boolean; author: { username: string; displayName: string; hasAvatar: boolean } }
export interface TrayUser { username: string; displayName: string; isMe: boolean; count: number; seenCount: number; seen: boolean; closeFriends: boolean; latestAt: string }
export interface Page<T> { items: T[]; nextCursor: string | null }

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const REFRESH_KEY = 'txill.refresh';
const isWeb = Platform.OS === 'web';
let accessToken: string | null = null;
let onExpired: (() => void) | null = null;
export const setSessionExpiredHandler = (f: (() => void) | null) => { onExpired = f; };
export const setAccessToken = (t: string | null) => { accessToken = t; };

/** Token de renovação: no cofre do telemóvel (app nativa). Na web não se guarda nada: a sessão vive num cookie HttpOnly do servidor. */
export const refreshStore = {
  get: (): Promise<string | null> => (isWeb ? Promise.resolve('cookie') : SecureStore.getItemAsync(REFRESH_KEY).catch(() => null)),
  set: (t: string) => (isWeb ? Promise.resolve() : SecureStore.setItemAsync(REFRESH_KEY, t).catch(() => undefined)),
  clear: () => (isWeb ? Promise.resolve() : SecureStore.deleteItemAsync(REFRESH_KEY).catch(() => undefined)),
};

const baseHeaders: Record<string, string> = { 'Content-Type': 'application/json', 'X-Requested-With': 'txillapp', ...(isWeb ? {} : { 'X-Client': 'txillapp-mobile' }) };

async function call(path: string, init: RequestInit = {}, auth = true): Promise<Response> {
  return fetch(`${SITE_URL}/api/v1${path}`, {
    ...(isWeb ? { credentials: 'include' as const } : {}),
    ...init,
    headers: { ...baseHeaders, ...(auth && accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...(init.headers as Record<string, string> | undefined) },
  });
}

async function parse(res: Response) {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
    throw new ApiError(res.status, Array.isArray(body.message) ? body.message[0] : body.message ?? 'Erro inesperado');
  }
  if (res.status === 204) return undefined;
  const text = await res.text();
  return text ? JSON.parse(text) : undefined;
}

let refreshing: Promise<AuthResult> | null = null;
/** Renova a sessão com o token guardado. Só um 401 definitivo termina a sessão; falhas de rede não deslogam ninguém. */
export function refreshSession(): Promise<AuthResult> {
  return (refreshing ??= (async () => {
    const token = await refreshStore.get();
    if (!token) throw new ApiError(401, 'Sem sessão');
    const res = await call('/auth/refresh', { method: 'POST', headers: isWeb ? {} : { 'X-Refresh-Token': token } }, false);
    const r = (await parse(res)) as AuthResult;
    accessToken = r.accessToken;
    if (r.refreshToken) await refreshStore.set(r.refreshToken);
    return r;
  })()
    .catch(async (e) => {
      if (e instanceof ApiError && e.status === 401) {
        accessToken = null;
        await refreshStore.clear();
        onExpired?.();
      }
      throw e;
    })
    .finally(() => {
      refreshing = null;
    }));
}

export async function raw(path: string, init: RequestInit = {}, retry = true) {
  const res = await call(path, init);
  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    await refreshSession();
    return raw(path, init, false);
  }
  return parse(res);
}

export const post = (b: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(b) });

/** Envia uma foto, vídeo ou áudio do chat (privado): pede o URL assinado, envia os bytes e confirma. Devolve o id do ficheiro. */
export async function uploadMedia(uri: string, mime: string, purpose: 'public' | 'chat' = 'chat'): Promise<string> {
  const blob = await (await fetch(uri)).blob();
  const up = (await raw('/media/uploads', post({ mime, size: blob.size, purpose }))) as { assetId: string; uploadUrl: string };
  const url = /^https?:\/\//.test(up.uploadUrl) ? up.uploadUrl : `${SITE_URL}${up.uploadUrl}`;
  const put = await fetch(url, { method: 'PUT', headers: { 'Content-Type': mime }, body: blob });
  if (!put.ok) throw new ApiError(put.status, 'Não consegui enviar o ficheiro');
  await raw(`/media/${up.assetId}/complete`, { method: 'POST' });
  return up.assetId;
}

export const uploadChatMedia = (uri: string, mime: string) => uploadMedia(uri, mime, 'chat');

export const api = {
  async login(identifier: string, password: string): Promise<AuthResult> {
    const r = (await parse(await call('/auth/login', post({ identifier, password }), false))) as AuthResult;
    accessToken = r.accessToken;
    if (r.refreshToken) await refreshStore.set(r.refreshToken);
    return r;
  },
  async register(b: { email: string; username: string; displayName: string; password: string; birthDate: string; acceptTerms: true; gender?: string; inviteCode?: string }): Promise<AuthResult> {
    const r = (await parse(await call('/auth/register', post(b), false))) as AuthResult;
    accessToken = r.accessToken;
    if (r.refreshToken) await refreshStore.set(r.refreshToken);
    return r;
  },
  usernameAvailable: (u: string): Promise<{ available: boolean; reason?: 'invalid' | 'reserved' | 'taken'; suggestions?: string[] }> => raw(`/auth/username-available?username=${encodeURIComponent(u)}`),
  emailAvailable: (e: string): Promise<{ available: boolean; reason?: 'invalid' | 'taken' }> => raw(`/auth/email-available?email=${encodeURIComponent(e)}`),
  forgotPassword: (email: string): Promise<{ ok: boolean }> => raw('/auth/password/forgot', post({ email })),
  invitePreview: (code: string): Promise<{ username: string; displayName: string }> => raw(`/invites/preview/${encodeURIComponent(code)}`),
  async logout(): Promise<void> {
    const token = await refreshStore.get();
    if (token) await call('/auth/logout', { method: 'POST', headers: isWeb ? {} : { 'X-Refresh-Token': token } }, false).catch(() => undefined);
    accessToken = null;
    await refreshStore.clear();
  },
  feed: (cursor?: string): Promise<Page<Post>> => raw(`/feed${cursor ? `?cursor=${encodeURIComponent(cursor)}&limit=10` : '?limit=10'}`),
  cheer: (id: string): Promise<{ cheered: boolean; cheers: number }> => raw(`/posts/${id}/cheers`, post({})),
  gift: (id: string, amount: number, key: string, note = '', visibility: GiftVisibility = 'silent'): Promise<{ transactionId: string; post: Post; announcement: Post | null }> =>
    raw(`/posts/${id}/gifts`, { ...post({ amount, note, visibility }), headers: { 'Idempotency-Key': key } }),
  giftUser: (b: { toUsername: string; amount: number; note?: string; visibility: GiftVisibility }, key: string): Promise<{ transactionId: string; replayed: boolean; post: Post | null }> =>
    raw('/gifts', { ...post(b), headers: { 'Idempotency-Key': key } }),
  publishGift: (transactionId: string, note?: string): Promise<{ post: Post }> => raw(`/gifts/${transactionId}/publish`, post({ note })),
  repost: (id: string, body = ''): Promise<Post> => raw(`/posts/${id}/repost`, post({ body })),
  unrepost: (id: string): Promise<{ reposted: boolean; reposts: number }> => raw(`/posts/${id}/repost`, { method: 'DELETE' }),
  markSeen: (ids: string[]): Promise<void> => raw('/feed/seen', post({ ids })),
  stories: (): Promise<TrayUser[]> => raw('/stories'),
  storiesOf: (username: string): Promise<Story[]> => raw(`/stories/user/${encodeURIComponent(username)}`),
  createStory: (mediaId: string, caption: string, audience: 'all' | 'close_friends' = 'all'): Promise<Story> => raw('/stories', post({ mediaId, caption, audience })),
  viewStory: (id: string): Promise<void> => raw(`/stories/${id}/view`, post({})),
  deleteStory: (id: string): Promise<void> => raw(`/stories/${id}`, { method: 'DELETE' }),
  setStoryComments: (id: string, commentsOff: boolean): Promise<{ commentsOff: boolean }> => raw(`/stories/${id}`, { method: 'PATCH', body: JSON.stringify({ commentsOff }) }),
  replyStory: (id: string, body: string): Promise<{ id: string; kind: 'reply' | 'reaction' }> => raw(`/stories/${id}/replies`, post({ body })),
  storyReplies: (id: string): Promise<{ id: string; body: string; kind: 'reply' | 'reaction'; createdAt: string; author: { username: string; displayName: string } }[]> => raw(`/stories/${id}/replies`),
  storyViewers: (id: string): Promise<{ username: string; displayName: string; viewedAt: string; cheered?: boolean }[]> => raw(`/stories/${id}/viewers`),
  cheerStory: (id: string, on: boolean): Promise<{ cheered: boolean }> => raw(`/stories/${id}/cheer`, { method: on ? 'PUT' : 'DELETE' }),
  storyComments: (id: string): Promise<StoryComment[]> => raw(`/stories/${id}/comments`),
  commentStory: (id: string, body: string): Promise<{ id: string }> => raw(`/stories/${id}/comments`, post({ body })),
  deleteStoryComment: (commentId: string): Promise<void> => raw(`/stories/comments/${commentId}`, { method: 'DELETE' }),
  closeFriends: (): Promise<{ username: string; displayName: string; hasAvatar: boolean }[]> => raw('/stories/close-friends'),
  addCloseFriend: (username: string): Promise<void> => raw(`/stories/close-friends/${encodeURIComponent(username)}`, { method: 'PUT' }),
  removeCloseFriend: (username: string): Promise<void> => raw(`/stories/close-friends/${encodeURIComponent(username)}`, { method: 'DELETE' }),
  reels: (cursor?: string): Promise<Page<Post>> => raw(`/feed/reels${cursor ? `?cursor=${cursor}&limit=6` : '?limit=6'}`),
  createPost: (b: { body: string; locationLabel?: string; mediaIds: string[] }): Promise<Post> => raw('/posts', post(b)),
  chatList: (): Promise<Conversation[]> => raw('/chat/conversations'),
  chatGroups: (): Promise<GroupSummary[]> => raw('/chat/groups'),
  chatThread: (username: string, cursor?: string): Promise<ChatThread> => raw(`/chat/with/${encodeURIComponent(username)}${cursor ? `?cursor=${cursor}` : ''}`),
  chatSend: (username: string, msg: { body?: string; kind?: MsgKind; mediaId?: string; durationMs?: number; waveform?: string; lat?: number; lng?: number; once?: boolean; replyTo?: string }): Promise<{ id: string }> => raw(`/chat/with/${encodeURIComponent(username)}`, post(msg)),
  chatOpen: (id: string): Promise<{ kind: MsgKind; body: string; mediaUrl: string | null; durationMs: number | null; waveform: string | null }> => raw(`/chat/messages/${id}/open`, post({})),
  chatDelete: (id: string): Promise<void> => raw(`/chat/messages/${id}`, { method: 'DELETE' }),
  chatReact: (id: string, reaction: string): Promise<void> => raw(`/chat/messages/${id}/reaction`, { method: 'PUT', body: JSON.stringify({ reaction }) }),
  chatAccept: (username: string): Promise<void> => raw(`/chat/with/${encodeURIComponent(username)}/accept`, post({})),
  chatDecline: (username: string): Promise<void> => raw(`/chat/with/${encodeURIComponent(username)}/decline`, post({})),
  mentionable: (q: string): Promise<{ username: string; displayName: string; hasAvatar: boolean; following: boolean; verified?: boolean }[]> => raw(`/mentionable?q=${encodeURIComponent(q)}`),
  search: (q: string): Promise<SearchResults> => raw(`/search?q=${encodeURIComponent(q)}`),
  trending: (): Promise<{ tags: TrendingTag[] }> => raw('/search/trending'),
  hotPlaces: (): Promise<{ name: string; posts: number }[]> => raw('/places/hot'),
  explore: (topic: string | null, cursor?: string): Promise<Page<Post>> => raw(`/feed/explore?limit=18${topic ? `&topic=${encodeURIComponent(topic)}` : ''}${cursor ? `&cursor=${cursor}` : ''}`),
  exploreTopics: (all = false): Promise<{ id: string; label: string; count: number }[]> => raw(`/feed/explore/topics${all ? '?all=1' : ''}`),
  profile: (username: string): Promise<Profile> => raw(`/users/${encodeURIComponent(username)}`),
  userPosts: (username: string, cursor?: string, tab: ProfileTab = 'all'): Promise<Page<Post>> => raw(`/users/${encodeURIComponent(username)}/posts?limit=18${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}&tab=${tab}`),
  savedPosts: (cursor?: string): Promise<Page<Post>> => raw(`/feed/saved${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
  follow: (username: string): Promise<FollowState> => raw(`/users/${encodeURIComponent(username)}/follow`, post({})),
  unfollow: (username: string): Promise<FollowState> => raw(`/users/${encodeURIComponent(username)}/unfollow`, post({})),
  block: (username: string): Promise<void> => raw(`/blocks/${encodeURIComponent(username)}`, { method: 'PUT' }),
  unblock: (username: string): Promise<{ username: string; displayName: string }[]> => raw(`/blocks/${encodeURIComponent(username)}`, { method: 'DELETE' }),
  invites: (): Promise<InvitesInfo> => raw('/invites/me'),
  updateMe: (b: { displayName?: string; bio?: string; isPrivate?: boolean; website?: string; city?: string }): Promise<{ displayName: string }> => raw('/users/me', { method: 'PATCH', body: JSON.stringify(b) }),
  setAvatar: (mediaId: string): Promise<{ hasAvatar: boolean }> => raw('/users/me/avatar', { method: 'PUT', body: JSON.stringify({ mediaId }) }),
  clearAvatar: (): Promise<{ hasAvatar: boolean }> => raw('/users/me/avatar', { method: 'DELETE' }),
  followRequests: (): Promise<{ username: string; displayName: string; requestedAt: string }[]> => raw('/follow-requests'),
  explorePrefs: (): Promise<Record<string, number>> => raw('/feed/prefs'),
  exploreActivity: (): Promise<{ id: string; label: string }[]> => raw('/feed/algorithm'),
  setExplorePref: (topic: string, pref: -1 | 0 | 1): Promise<Record<string, number>> => raw('/feed/prefs', { method: 'PUT', body: JSON.stringify({ topic, pref }) }),
  resetExplore: (): Promise<void> => raw('/feed/prefs', { method: 'DELETE' }),
  privacy: (): Promise<PrivacySettings> => raw('/settings/privacy'),
  setPrivacy: (b: Partial<PrivacySettings>): Promise<PrivacySettings> => raw('/settings/privacy', { method: 'PATCH', body: JSON.stringify(b) }),
  storySettings: (): Promise<StorySettings> => raw('/stories/settings'),
  setStoryReplies: (replies: Who): Promise<StorySettings> => raw('/stories/settings', { method: 'PATCH', body: JSON.stringify({ replies }) }),
  hideStoryFrom: (username: string): Promise<StorySettings> => raw(`/stories/hidden/${encodeURIComponent(username)}`, { method: 'PUT' }),
  unhideStoryFrom: (username: string): Promise<StorySettings> => raw(`/stories/hidden/${encodeURIComponent(username)}`, { method: 'DELETE' }),
  blocked: (): Promise<{ username: string; displayName: string }[]> => raw('/blocks'),
  geo: (): Promise<{ country: string | null }> => raw('/health/geo'),
  notifySettings: (): Promise<{ categories: string[]; off: string[] }> => raw('/notifications/settings'),
  saveNotifySettings: (off: string[]): Promise<void> => raw('/notifications/settings', { method: 'PUT', body: JSON.stringify({ off }) }),
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const r = (await parse(await call('/auth/password', post({ currentPassword, newPassword })))) as AuthResult;
    accessToken = r.accessToken;
    if (r.refreshToken) await refreshStore.set(r.refreshToken);
  },
  sessions: (): Promise<DeviceSession[]> => raw('/auth/sessions'),
  revokeSession: (id: string): Promise<void> => raw(`/auth/sessions/${id}`, { method: 'DELETE' }),
  revokeOtherSessions: (): Promise<void> => raw('/auth/sessions/revoke-others', post({})),
  deleteAccount: (confirmUsername: string, password?: string): Promise<void> => raw('/auth/delete-account', post({ confirmUsername, password })),
  async exportData(): Promise<string> {
    const res = await call('/me/export');
    if (!res.ok) throw new ApiError(res.status, res.status === 429 ? 'Já descarregaste vários ficheiros. Tenta daqui a pouco.' : 'Não consegui preparar o ficheiro');
    return res.text();
  },
  verificationStatus: (): Promise<VerificationStatus> => raw('/verification/me'),
  verificationRequest: (b: { kind: 'person' | 'business'; fullName: string; proof: string; docType: DocType; docMediaId: string; docBackMediaId?: string; faceMediaId: string; selfieMediaId: string }): Promise<void> => raw('/verification/request', post(b)),
  verificationWithdraw: (): Promise<void> => raw('/verification/request', { method: 'DELETE' }),
  nearbyPlaces: (lat: number, lng: number): Promise<{ area: string | null; city: string | null }> => raw(`/places/nearby?lat=${lat}&lng=${lng}`),
  feedSettings: (): Promise<FeedSettings> => raw('/feed/settings'),
  setFeedSettings: (b: Partial<FeedSettings>): Promise<FeedSettings> => raw('/feed/settings', { method: 'PUT', body: JSON.stringify(b) }),
  feedPeople: (): Promise<FeedPerson[]> => raw('/feed/people'),
  setFeedPerson: (username: string, pref: -1 | 0 | 1): Promise<FeedPerson[]> => raw('/feed/people', { method: 'PUT', body: JSON.stringify({ username, pref }) }),
  followers: (username: string, cursor?: string, q?: string): Promise<Page<Person>> => raw(`/users/${encodeURIComponent(username)}/followers${qsp(cursor, q)}`),
  following: (username: string, cursor?: string, q?: string): Promise<Page<Person>> => raw(`/users/${encodeURIComponent(username)}/following${qsp(cursor, q)}`),
  wallet: (): Promise<WalletView> => raw('/wallet'),
  tagPage: (tag: string, sort: 'recent' | 'top', cursor?: string): Promise<TagPage> => raw(`/tags/${encodeURIComponent(tag)}?sort=${sort}&limit=10${cursor ? `&cursor=${cursor}` : ''}`),
  getPost: (idOrCode: string): Promise<Post> => raw(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrCode) ? `/posts/${idOrCode}` : `/posts/code/${encodeURIComponent(idOrCode)}`),
  notifications: (cursor?: string): Promise<Page<AppNotification>> => raw(`/notifications${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
  markNotificationsRead: (): Promise<void> => raw('/notifications/read', post({})),
  acceptRequest: (username: string): Promise<void> => raw(`/follow-requests/${encodeURIComponent(username)}/accept`, post({})),
  declineRequest: (username: string): Promise<void> => raw(`/follow-requests/${encodeURIComponent(username)}/decline`, post({})),
  comments: (postId: string, cursor?: string): Promise<Page<Comment>> => raw(`/posts/${postId}/comments?limit=15${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
  replies: (id: string, cursor?: string): Promise<Page<Comment>> => raw(`/comments/${id}/replies?limit=10${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
  addComment: (postId: string, body: string, parentId?: string): Promise<Comment> => raw(`/posts/${postId}/comments`, post({ body, parentId })),
  editComment: (id: string, body: string): Promise<Comment> => raw(`/comments/${id}`, { method: 'PATCH', body: JSON.stringify({ body }) }),
  cheerComment: (id: string): Promise<{ cheered: boolean; cheers: number }> => raw(`/comments/${id}/cheers`, post({})),
  deleteComment: (id: string): Promise<void> => raw(`/comments/${id}`, { method: 'DELETE' }),
  report: (type: ReportType, id: string, reason: ReportReason, note?: string): Promise<void> => raw('/reports', post({ type, id, reason, note })),
  removePost: (id: string): Promise<void> => raw(`/posts/${id}`, { method: 'DELETE' }),
  hideFromFeed: (postId: string): Promise<void> => raw('/feed/hide', post({ postId })),
  updatePost: (id: string, b: { body?: string; clearLocation?: boolean; commentsOff?: boolean }): Promise<Post> => raw(`/posts/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
  unreadCount: (): Promise<{ count: number }> => raw('/notifications/unread-count'),
  chatUnread: (): Promise<{ conversations: number }> => raw('/chat/unread'),
  savePost: (id: string): Promise<{ saved: boolean }> => raw(`/posts/${id}/save`, { method: 'PUT' }),
  unsavePost: (id: string): Promise<{ saved: boolean }> => raw(`/posts/${id}/save`, { method: 'DELETE' }),
};
