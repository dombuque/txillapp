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
  mediaUrl: string | null;
  createdAt: string;
  author: { id: string; username: string; displayName: string };
  cheers: number;
  comments: number;
  gifts: number;
  cheered: boolean;
}
export interface Comment {
  id: string;
  body: string;
  createdAt: string;
  author: { username: string; displayName: string };
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
  return res.status === 204 ? undefined : res.json();
}

const post = (b: unknown, extra: HeadersInit = {}): RequestInit => ({ method: 'POST', body: JSON.stringify(b), headers: extra });
const newKey = () => crypto.randomUUID();

export const api = {
  register: (b: unknown): Promise<AuthResponse> => raw('/auth/register', post(b)),
  login: (b: unknown): Promise<AuthResponse> => raw('/auth/login', post(b)),
  refresh: (): Promise<AuthResponse> => raw('/auth/refresh', { method: 'POST' }, false),
  logout: (): Promise<void> => raw('/auth/logout', { method: 'POST' }),

  feed: (cursor?: string): Promise<{ items: Post[]; nextCursor: string | null }> =>
    raw(`/posts?limit=10${cursor ? `&cursor=${cursor}` : ''}`),
  createPost: (b: { body: string; locationLabel?: string; mediaId?: string }): Promise<Post> => raw('/posts', post(b)),
  cheer: (id: string): Promise<{ cheered: boolean; cheers: number }> => raw(`/posts/${id}/cheers`, post({})),
  comments: (id: string): Promise<Comment[]> => raw(`/posts/${id}/comments`),
  addComment: (id: string, body: string): Promise<Comment[]> => raw(`/posts/${id}/comments`, post({ body })),
  gift: (id: string, amount: number, key: string): Promise<{ post: Post }> =>
    raw(`/posts/${id}/gifts`, post({ amount }, { 'Idempotency-Key': key })),

  wallet: (): Promise<WalletView> => raw('/wallet'),
  transfer: (toUsername: string, amount: number, note: string | undefined, key: string) =>
    raw('/wallet/transfers', post({ toUsername, amount, note }, { 'Idempotency-Key': key })),

  /** Fluxo de upload pré-assinado: pede URL temporário e envia os bytes directamente para ele. */
  async uploadImage(file: File): Promise<string> {
    const { assetId, uploadUrl } = await raw('/media/uploads', post({ mime: file.type, size: file.size }));
    const res = await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
    if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => ({}))).message ?? 'Falha no upload');
    return assetId;
  },
  newKey,
};
