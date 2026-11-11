import * as SecureStore from 'expo-secure-store';
import { accounts } from './accounts';
import { kvGet, kvSet } from './kv';
import { Platform } from 'react-native';
import { SITE_URL } from './config';

/** Resposta de entrada: a app nativa recebe também o token de renovação (guardado no cofre do telemóvel, nunca em texto simples). */
export interface PublicUser { id: string; username: string; displayName: string }
export interface AuthResult { accessToken: string; /** Só na app nativa; na web vai no cookie. */ refreshToken?: string; user: PublicUser }

export interface PostMedia { url: string; kind?: 'image' | 'video'; posterUrl?: string; width?: number | null; height?: number | null; durationMs?: number | null; tags?: { username: string }[] }
/** Tcheka = uma publicação com um único vídeo. Fotos e vídeos juntos são um carrossel normal (abre como publicação). */
export const isTcheka = (p: { media: { kind?: string }[] } | null | undefined) => !!p && p.media.length === 1 && p.media[0]?.kind === 'video';
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
  /** Publicada como um local (página): mostra-se com o nome e o logótipo da página. */
  venue?: { slug: string; name: string; kind: string; verified: boolean; avatarUrl: string | null } | null;
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
export type NotificationKind = 'blocked' | 'follow' | 'follow_request' | 'request_accepted' | 'gift' | 'comment' | 'reply' | 'story_reply' | 'repost' | 'mention' | 'tag' | 'verified' | 'venue_invite' | 'missed_call' | 'venue_payment' | 'venue_review' | 'group_join_request' | 'group_join_accepted' | 'group_member_joined' | 'group_admin_granted' | 'geleira_cheer';
export interface AppNotification {
  id: string;
  kind: NotificationKind;
  /** TxillGroups: o grupo vem em `data.groupId/groupName`; aceita-se também ao nível de cima, se o servidor o mandar aí. */
  groupId?: string;
  groupName?: string;
  data: { amount?: number; note?: string; snippet?: string; postId?: string; commentId?: string; storyId?: string; replyKind?: 'reply' | 'reaction' | 'comment'; venueSlug?: string; venueName?: string; role?: 'admin' | 'editor'; groupId?: string; groupName?: string; video?: boolean; callId?: string; decision?: 'approved' | 'rejected' };
  createdAt: string;
  read: boolean;
  actor: { username: string; displayName: string; isPrivate?: boolean; following?: boolean; requested?: boolean };
  thumb?: { url: string; video: boolean } | null;
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
/** Quem me pode ligar (chamadas de voz e vídeo). */
export type CallsWho = 'everyone' | 'following' | 'mutual' | 'off';
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
  /** Quem me pode ligar (calls_allowed no servidor). */
  callsAllowed?: CallsWho;
  /** "Esconder o meu IP nas chamadas": só pelo servidor de chamadas do Txillapp. */
  callsRelayOnly?: boolean;
  /** Aceitou a versão em vigor dos Termos (falso depois de uma atualização: a app pede de novo). */
  termsAccepted?: boolean;
  repostsVisible: Viewers;
  cheersVisible: Viewers;
  giftsVisible: Viewers;
  showConnections: 'everyone' | 'followers' | 'me';
  suggestable: boolean;
  /** Já viu (ou saltou) a visita guiada. */
  welcomed?: boolean;
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
  /** Locais (páginas) com esse nome ou nessa cidade. */
  venues?: import('./api.locais').Venue[];
}
export interface TrendingTag { tag: string; posts: number; rising?: boolean }
export type MsgKind = 'text' | 'story_reply' | 'story_reaction' | 'image' | 'voice' | 'video' | 'sticker' | 'location' | 'post' | 'gift' | 'zas_reply' | 'call';
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
  /** Localização de um sítio escolhido: o nome e a morada (servidores antigos não mandam). */
  placeName?: string | null;
  placeAddress?: string | null;
  viewOnce?: boolean;
  opened?: boolean;
  replyTo?: { id: string; gone: true } | { id: string; gone: false; fromMe: boolean; name: string; kind: MsgKind; body: string } | null;
  reactions?: { reaction: string; count: number; mine: boolean }[];
  /** Apagada para todos: o servidor manda só o aviso ("Esta mensagem foi apagada") e nada do que tinha. */
  deleted?: boolean;
  /** Editada depois de enviada ("editada" ao lado da hora). */
  edited?: boolean;
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
  /** Por ler só porque a marquei à mão (sem mensagens novas para contar): a lista mostra um ponto e não um número. */
  marked?: boolean;
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
  /** Publicações da pessoa que ainda não vi (últimos 7 dias): "1 publicação nova" no cabeçalho. Servidores antigos não mandam. */
  newPosts?: { count: number; latestId: string | null };
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
  /** Stickers por cima do mimo (centro e largura em fração do ecrã, rotação em graus). */
  stickers?: { id: string; x: number; y: number; s: number; r: number }[];
}
export interface StoryComment { id: string; body: string; createdAt: string; mine: boolean; canDelete: boolean; author: { username: string; displayName: string; hasAvatar: boolean } }
export interface TrayUser { username: string; displayName: string; isMe: boolean; count: number; seenCount: number; seen: boolean; closeFriends: boolean; latestAt: string }
export interface Page<T> { items: T[]; nextCursor: string | null }

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

/** Avisos de "conta por ativar" (403 email_not_verified): a folha "Ativa a tua conta" ouve isto em qualquer ecrã. */
const needVerifyListeners = new Set<() => void>();
/** Abrir a folha "Ativa a tua conta" a partir de um botão (ex.: o aviso no topo do feed). */
export function openActivate() {
  for (const f of needVerifyListeners) f();
}
export function onNeedVerify(f: () => void) {
  needVerifyListeners.add(f);
  return () => { needVerifyListeners.delete(f); };
}

const REFRESH_KEY = 'txill.refresh';
const isWeb = Platform.OS === 'web';
let accessToken: string | null = null;
let onExpired: (() => void) | null = null;
export const setSessionExpiredHandler = (f: (() => void) | null) => { onExpired = f; };
export const setAccessToken = (t: string | null) => { accessToken = t; };

/**
 * Como renovar a sessão da conta ativa (há várias contas por aparelho: ver lib/accounts). Devolve os cabeçalhos do pedido.
 * Telemóvel: o token guardado no cofre. Browser: só o id da conta (o token está num cookie HttpOnly que a página não lê);
 * uma conta antiga que ainda tenha o token na página manda-o uma vez e ele passa para o cookie. Sem contas, quem vinha do
 * site antigo ainda tem o cookie geral: a primeira renovação usa-o.
 */
const COOKIE_TRIED = 'tx_cookie_tried';
/** No browser: a conta ativa (vai no cabeçalho X-Account para o servidor saber de que sessão se trata). */
let webAccountId: string | null = null;
export const refreshStore = {
  get: async (): Promise<Record<string, string> | null> => {
    const cur = await accounts.current();
    if (!isWeb) return cur?.refreshToken ? { 'X-Refresh-Token': cur.refreshToken } : null;
    if (cur) {
      webAccountId = cur.id ?? null;
      const h: Record<string, string> = {};
      if (cur.id) h['X-Account'] = cur.id;
      if (cur.refreshToken) h['X-Refresh-Token'] = cur.refreshToken;
      return Object.keys(h).length ? h : null;
    }
    if (!(await kvGet(COOKIE_TRIED))) return {};
    return null;
  },
  /** Guarda a sessão como conta ativa. No browser nunca se guarda o token. */
  save: async (r: AuthResult) => {
    if (isWeb) {
      webAccountId = r.user.id;
      await accounts.upsert({ username: r.user.username, displayName: r.user.displayName, id: r.user.id, refreshToken: '' });
      return;
    }
    if (r.refreshToken) await accounts.upsert({ username: r.user.username, displayName: r.user.displayName, id: r.user.id, refreshToken: r.refreshToken });
  },
  clear: async () => {
    const cur = await accounts.current();
    if (cur) await accounts.remove(cur.username);
    webAccountId = null;
    if (isWeb) await kvSet(COOKIE_TRIED, '1');
  },
};

const baseHeaders: Record<string, string> = { 'Content-Type': 'application/json', 'X-Requested-With': 'txillapp', 'X-Client': isWeb ? 'txillapp-web' : 'txillapp-mobile' };

async function call(path: string, init: RequestInit = {}, auth = true): Promise<Response> {
  return fetch(`${SITE_URL}/api/v1${path}`, {
    ...(isWeb ? { credentials: 'include' as const } : {}),
    ...init,
    headers: { ...baseHeaders, ...(isWeb && webAccountId ? { 'X-Account': webAccountId } : {}), ...(auth && accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...(init.headers as Record<string, string> | undefined) },
  });
}

async function parse(res: Response) {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string | string[]; code?: string };
    if (res.status === 403 && body.code === 'email_not_verified') for (const f of needVerifyListeners) f();
    throw new ApiError(res.status, Array.isArray(body.message) ? body.message[0] : body.message ?? 'Erro inesperado', body.code);
  }
  if (res.status === 204) return undefined;
  const text = await res.text();
  return text ? JSON.parse(text) : undefined;
}

/**
 * No browser: as outras contas guardadas que ainda tenham o token na página passam-no para o cookie HttpOnly delas
 * (uma renovação cada) e o token é apagado daqui. Não mexe na conta ativa nem na sessão aberta.
 */
export async function migrateWebAccounts(): Promise<void> {
  if (!isWeb) return;
  const cur = await accounts.current();
  for (const a of await accounts.list()) {
    if (!a.refreshToken || a.username === cur?.username) continue;
    try {
      const res = await fetch(`${SITE_URL}/api/v1/auth/refresh`, { method: 'POST', credentials: 'include', headers: { ...baseHeaders, ...(a.id ? { 'X-Account': a.id } : {}), 'X-Refresh-Token': a.refreshToken } });
      if (res.ok) {
        const r = (await res.json()) as AuthResult;
        await accounts.patch(a.username, { id: r.user.id, refreshToken: '' });
      } else if (res.status === 401) {
        await accounts.remove(a.username); // a sessão dessa conta já tinha terminado
      }
    } catch { /* sem rede: fica para a próxima */ }
  }
}

/** Cabeçalhos de um pedido com sessão (para descarregar ficheiros fora do `raw`). */
export const authHeaders = (): Record<string, string> => ({ ...baseHeaders, ...(isWeb && webAccountId ? { 'X-Account': webAccountId } : {}), ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) });
/** Um pedido com sessão que devolve a resposta tal e qual (ficheiros); com a sessão caducada renova uma vez. */
export async function fetchAuthed(path: string): Promise<Response> {
  let res = await call(path);
  if (res.status === 401) {
    await refreshSession();
    res = await call(path);
  }
  return res;
}

let refreshing: Promise<AuthResult> | null = null;
/** Renova a sessão com o token guardado. Só um 401 definitivo termina a sessão; falhas de rede não deslogam ninguém. */
export function refreshSession(): Promise<AuthResult> {
  return (refreshing ??= (async () => {
    const headers = await refreshStore.get();
    if (!headers) throw new ApiError(401, 'Sem sessão');
    const res = await call('/auth/refresh', { method: 'POST', headers }, false);
    const r = (await parse(res)) as AuthResult;
    accessToken = r.accessToken;
    await refreshStore.save(r);
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

export interface GoogleNeedsUsername { needsUsername: true; signupToken: string; displayName: string; suggestedUsername: string }

/** Código de convite guardado até o registo acabar (localStorage na web, cofre na app nativa). */
const INVITE_KEY = 'tx_invite';
export const inviteStore = {
  async get(): Promise<string> {
    try {
      return (isWeb ? localStorage.getItem(INVITE_KEY) : await SecureStore.getItemAsync(INVITE_KEY)) ?? '';
    } catch {
      return '';
    }
  },
  async set(code: string): Promise<void> {
    try {
      if (isWeb) localStorage.setItem(INVITE_KEY, code);
      else await SecureStore.setItemAsync(INVITE_KEY, code);
    } catch { /* sem armazenamento: só vale a ligação aberta */ }
  },
  async clear(): Promise<void> {
    try {
      if (isWeb) localStorage.removeItem(INVITE_KEY);
      else await SecureStore.deleteItemAsync(INVITE_KEY);
    } catch { /* nada */ }
  },
};

export const post = (b: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(b) });

export interface MediaState { status: string; error?: string }

/**
 * Espera que o ficheiro fique pronto. As fotos ficam logo; um vídeo é convertido no servidor (MP4 até 60 s) e só depois
 * pode entrar numa publicação, num mimo ou numa conversa. `first` é a resposta do /complete; `onWait` avisa quando começa a espera.
 */
export async function waitMediaReady(id: string, first: MediaState, onWait?: () => void): Promise<void> {
  let st = first;
  const started = Date.now();
  while ((st.status === 'processing' || st.status === 'uploaded') && Date.now() - started < 5 * 60_000) {
    onWait?.();
    await new Promise((r) => setTimeout(r, Date.now() - started < 10_000 ? 1000 : 2500));
    st = (await raw(`/media/${id}/status`)) as MediaState;
  }
  if (st.status === 'ready') return;
  if (st.status === 'processing') throw new ApiError(504, 'O vídeo ainda está a ser preparado. Tenta outra vez daqui a pouco.');
  throw new ApiError(422, st.error ?? 'Não consegui preparar este ficheiro. Tenta outro.');
}

/**
 * Envia os bytes de um ficheiro para o URL assinado (PUT) com XMLHttpRequest. No telemóvel o Blob fica no armazém nativo
 * e o XHR manda-o de lá diretamente. Não se usa o `fetch` aqui: no Expo 58 o `fetch` global é o expo/fetch, que lê o Blob
 * de volta para JS através do FileReader (base64) e o copia várias vezes. Com uma foto grande (por exemplo, um recorte do
 * Google Fotos no mimo) o Android ficava sem memória (OutOfMemoryError no FileReaderModule) e a app fechava.
 */
export function putBlob(url: string, blob: Blob, mime: string, onProgress?: (p: number) => void): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', url);
    x.setRequestHeader('Content-Type', mime);
    if (onProgress) x.upload.onprogress = (e) => { if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total); };
    x.onload = () => {
      if (x.status >= 200 && x.status < 300) return resolve();
      let msg = 'Não consegui enviar o ficheiro';
      try { msg = (JSON.parse(x.responseText) as { message?: string }).message ?? msg; } catch { /* resposta sem JSON */ }
      reject(new ApiError(x.status, msg));
    };
    x.onerror = () => reject(new ApiError(0, 'Sem ligação. Vê a rede e tenta outra vez.'));
    x.ontimeout = () => reject(new ApiError(0, 'O envio demorou demasiado. Tenta outra vez.'));
    x.send(blob);
  });
}

/**
 * Abre um ficheiro local (file:// ou content://) como Blob para o enviar. No telemóvel lê-se com XMLHttpRequest
 * (`responseType: 'blob'`): o React Native copia o ficheiro uma só vez, direto para o armazém nativo de Blobs, sem passar
 * os bytes pelo JS. O `fetch(uri).blob()` do expo/fetch juntava a foto em Java, passava-a para JS e copiava-a de volta, e
 * essas cópias só saíam da memória quando o JS limpasse (com 10 fotos grandes numa publicação, o Android ficava sem memória).
 * No site, e se o XHR falhar, usa-se o fetch.
 */
export async function readLocalBlob(uri: string): Promise<Blob> {
  if (!isWeb && !/^(https?|blob|data):/i.test(uri)) {
    const viaXhr = await new Promise<Blob | null>((resolve) => {
      const x = new XMLHttpRequest();
      x.responseType = 'blob';
      x.onload = () => { const b = x.response as Blob | null; resolve(b && b.size > 0 ? b : null); };
      x.onerror = () => resolve(null);
      x.open('GET', uri);
      x.send();
    });
    if (viaXhr) return viaXhr;
  }
  return (await fetch(uri)).blob();
}

/** Larga já os bytes de um Blob nativo (no telemóvel ficam no armazém do React Native até o JS os limpar). */
export function releaseBlob(blob: Blob | null | undefined) {
  try { (blob as { close?: () => void } | null | undefined)?.close?.(); } catch { /* já largado */ }
}

/** Envia uma foto, vídeo ou áudio do chat (privado): pede o URL assinado, envia os bytes, confirma e espera que fique pronto. Devolve o id do ficheiro. */
export async function uploadMedia(uri: string, mime: string, purpose: 'public' | 'chat' = 'chat', onWait?: () => void): Promise<string> {
  const blob = await readLocalBlob(uri);
  let up: { assetId: string; uploadUrl: string };
  try {
    up = (await raw('/media/uploads', post({ mime, size: blob.size, purpose }))) as { assetId: string; uploadUrl: string };
    const url = /^https?:\/\//.test(up.uploadUrl) ? up.uploadUrl : `${SITE_URL}${up.uploadUrl}`;
    await putBlob(url, blob, mime);
  } finally {
    releaseBlob(blob);
  }
  await waitMediaReady(up.assetId, (await raw(`/media/${up.assetId}/complete`, { method: 'POST' })) as MediaState, onWait);
  return up.assetId;
}

export const uploadChatMedia = (uri: string, mime: string) => uploadMedia(uri, mime, 'chat');

export const api = {
  async login(identifier: string, password: string): Promise<AuthResult> {
    const r = (await parse(await call('/auth/login', post({ identifier, password }), false))) as AuthResult;
    accessToken = r.accessToken;
    await refreshStore.save(r);
    return r;
  },
  async register(b: { email: string; username: string; displayName: string; password: string; birthDate: string; acceptTerms: true; gender?: string; inviteCode?: string }): Promise<AuthResult> {
    const r = (await parse(await call('/auth/register', post(b), false))) as AuthResult;
    accessToken = r.accessToken;
    await refreshStore.save(r);
    return r;
  },
  authConfig: (): Promise<{ googleClientId: string | null }> => raw('/auth/config'),
  /** Devolve a sessão, ou `needsUsername` para contas novas (a pessoa escolhe o @ a seguir). */
  async googleLogin(idToken: string): Promise<AuthResult | GoogleNeedsUsername> {
    const r = (await parse(await call('/auth/google', post({ idToken }), false))) as AuthResult | GoogleNeedsUsername;
    if ('needsUsername' in r) return r;
    accessToken = r.accessToken;
    await refreshStore.save(r);
    return r;
  },
  async googleComplete(signupToken: string, username: string, gender: string, birthDate: string): Promise<AuthResult> {
    const r = (await parse(await call('/auth/google/complete', post({ signupToken, username, gender, birthDate, acceptTerms: true }), false))) as AuthResult;
    accessToken = r.accessToken;
    await refreshStore.save(r);
    return r;
  },
  usernameAvailable: (u: string): Promise<{ available: boolean; reason?: 'invalid' | 'reserved' | 'taken'; suggestions?: string[] }> => raw(`/auth/username-available?username=${encodeURIComponent(u)}`),
  emailAvailable: (e: string): Promise<{ available: boolean; reason?: 'invalid' | 'taken' }> => raw(`/auth/email-available?email=${encodeURIComponent(e)}`),
  forgotPassword: (email: string): Promise<{ ok: boolean }> => raw('/auth/password/forgot', post({ email })),
  invitePreview: (code: string): Promise<{ username: string; displayName: string }> => raw(`/invites/preview/${encodeURIComponent(code)}`),
  async logout(): Promise<void> {
    const headers = await refreshStore.get();
    if (headers) await call('/auth/logout', { method: 'POST', headers }, false).catch(() => undefined);
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
  chatSend: (username: string, msg: { body?: string; kind?: MsgKind; mediaId?: string; instantId?: string; durationMs?: number; waveform?: string; lat?: number; lng?: number; name?: string; address?: string; liveMinutes?: 15 | 60 | 480; once?: boolean; replyTo?: string }): Promise<{ id: string }> => raw(`/chat/with/${encodeURIComponent(username)}`, post(msg)),
  chatOpen: (id: string): Promise<{ kind: MsgKind; body: string; mediaUrl: string | null; durationMs: number | null; waveform: string | null }> => raw(`/chat/messages/${id}/open`, post({})),
  /** Apagar para todos (só as minhas): fica o aviso "Esta mensagem foi apagada". */
  chatDelete: (id: string): Promise<void> => raw(`/chat/messages/${id}`, { method: 'DELETE' }),
  /** Apagar para mim: só eu deixo de ver esta mensagem (minha ou de outra pessoa; também nos grupos). */
  chatHide: (id: string): Promise<void> => raw(`/chat/messages/${id}/hide`, post({})),
  /** Editar a minha mensagem de texto (nos primeiros 15 minutos). */
  chatEdit: (id: string, body: string): Promise<{ id: string; body: string; edited: true }> => raw(`/chat/messages/${id}`, { method: 'PATCH', body: JSON.stringify({ body }) }),
  /** Marcar a conversa como por ler (só para mim). */
  chatMarkUnread: (username: string): Promise<{ ok: true }> => raw(`/chat/with/${encodeURIComponent(username)}/unread`, post({})),
  /** Apagar a conversa só do meu lado (a outra pessoa continua a ver tudo). */
  chatClear: (username: string): Promise<{ ok: true }> => raw(`/chat/with/${encodeURIComponent(username)}`, { method: 'DELETE' }),
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
  acceptTerms: (): Promise<PrivacySettings> => raw('/users/me/terms', { method: 'PUT', body: JSON.stringify({ acceptTerms: true }) }),
  setWelcomed: (): Promise<PrivacySettings> => raw('/users/me/welcomed', { method: 'PUT' }),
  /** Esta conta ainda tem de confirmar o e-mail? (sem isso não publica, comenta nem conversa) */
  emailStatus: (): Promise<{ required: boolean; verified: boolean; email?: string }> => raw('/auth/email/status'),
  /** Corrigir o e-mail (só enquanto a conta não está ativada); manda o link para o novo. */
  changeEmail: (email: string): Promise<{ sent: boolean; email: string }> => raw('/auth/email/change', post({ email })),
  resendVerification: (): Promise<{ sent: boolean }> => raw('/auth/email/resend', { method: 'POST' }),
  /** "A escrever…" nos comentários de uma publicação. */
  typingPing: (postId: string): Promise<void> => raw('/presence/typing', post({ postId })),
  typers: async (postId: string): Promise<string[]> => ((await raw(`/presence/typing?postId=${postId}`)) as { names: string[] }).names,
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
    await refreshStore.save(r);
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
