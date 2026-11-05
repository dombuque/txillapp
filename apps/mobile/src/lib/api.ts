import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { SITE_URL } from './config';

/** Resposta de entrada: a app nativa recebe também o token de renovação (guardado no cofre do telemóvel, nunca em texto simples). */
export interface PublicUser { id: string; username: string; displayName: string }
export interface AuthResult { accessToken: string; /** Só na app nativa; na web vai no cookie. */ refreshToken?: string; user: PublicUser }

export interface PostMedia { url: string; kind?: 'image' | 'video'; posterUrl?: string; width?: number | null; height?: number | null; durationMs?: number | null }
export interface Author { id: string; username: string; displayName: string; verified?: boolean; verifiedTier?: 'verified' | 'official' | null }
export interface Post {
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
  kind: 'post' | 'gift' | 'repost';
  repostOf?: Post | null;
  gift: { amount: number; recipient: { username: string; displayName: string } } | null;
}
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

async function raw(path: string, init: RequestInit = {}, retry = true) {
  const res = await call(path, init);
  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    await refreshSession();
    return raw(path, init, false);
  }
  return parse(res);
}

const post = (b: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(b) });

export const api = {
  async login(identifier: string, password: string): Promise<AuthResult> {
    const r = (await parse(await call('/auth/login', post({ identifier, password }), false))) as AuthResult;
    accessToken = r.accessToken;
    if (r.refreshToken) await refreshStore.set(r.refreshToken);
    return r;
  },
  async logout(): Promise<void> {
    const token = await refreshStore.get();
    if (token) await call('/auth/logout', { method: 'POST', headers: isWeb ? {} : { 'X-Refresh-Token': token } }, false).catch(() => undefined);
    accessToken = null;
    await refreshStore.clear();
  },
  feed: (cursor?: string): Promise<Page<Post>> => raw(`/feed${cursor ? `?cursor=${encodeURIComponent(cursor)}&limit=10` : '?limit=10'}`),
  cheer: (id: string): Promise<{ cheered: boolean; cheers: number }> => raw(`/posts/${id}/cheers`, post({})),
  markSeen: (ids: string[]): Promise<void> => raw('/feed/seen', post({ ids })),
};
