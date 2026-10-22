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
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
export interface TrayUser {
  username: string;
  displayName: string;
  isMe: boolean;
  count: number;
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

let refreshing: Promise<AuthResponse> | null = null;
function refreshOnce() {
  return (refreshing ??= raw('/auth/refresh', { method: 'POST' }, false)
    .then((r: AuthResponse) => {
      accessToken = r.accessToken;
      return r;
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

  feed: (cursor?: string): Promise<Page<Post>> => raw(`/posts${qs(cursor, 10)}`),
  createPost: (b: { body: string; locationLabel?: string; mediaIds: string[] }): Promise<Post> => raw('/posts', post(b)),
  cheer: (id: string): Promise<{ cheered: boolean; cheers: number }> => raw(`/posts/${id}/cheers`, post({})),
  gift: (id: string, amount: number, key: string): Promise<{ post: Post }> =>
    raw(`/posts/${id}/gifts`, post({ amount }, { 'Idempotency-Key': key })),

  comments: (postId: string, cursor?: string): Promise<Page<Comment>> => raw(`/posts/${postId}/comments${qs(cursor, 15)}`),
  replies: (commentId: string, cursor?: string): Promise<Page<Comment>> => raw(`/comments/${commentId}/replies${qs(cursor, 10)}`),
  addComment: (postId: string, body: string, parentId?: string): Promise<Comment> =>
    raw(`/posts/${postId}/comments`, post({ body, parentId })),
  cheerComment: (id: string): Promise<{ cheered: boolean; cheers: number }> => raw(`/comments/${id}/cheers`, post({})),
  deleteComment: (id: string): Promise<void> => raw(`/comments/${id}`, { method: 'DELETE' }),

  /** Presentear alguém com Txills (demonstração), opcionalmente anunciando no feed. */
  giftUser: (b: { toUsername: string; amount: number; note?: string; publish: boolean }, key: string): Promise<{ post: Post | null }> =>
    raw('/gifts', post(b, { 'Idempotency-Key': key })),

  stories: (): Promise<TrayUser[]> => raw('/stories'),
  storiesOf: (username: string): Promise<Story[]> => raw(`/stories/user/${encodeURIComponent(username)}`),
  createStory: (mediaId: string, caption: string): Promise<Story> => raw('/stories', post({ mediaId, caption })),
  viewStory: (id: string): Promise<void> => raw(`/stories/${id}/view`, post({})),
  deleteStory: (id: string): Promise<void> => raw(`/stories/${id}`, { method: 'DELETE' }),
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
