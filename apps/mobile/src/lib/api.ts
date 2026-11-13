import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { accounts } from './accounts';
import { kvGet, kvSet } from './kv';
import { Platform } from 'react-native';
import { SITE_URL } from './config';
import { friendlyFetchError } from './netError';
import { uploadRequest } from './signedMedia';
import { track, trackOk, trackThrottled } from './analytics';
import type { SponsoredSlot } from './api.boosts';

/** Resposta de entrada: a app nativa recebe também o token de renovação (guardado no cofre do telemóvel, nunca em texto simples). */
export interface PublicUser {
  id: string; username: string; displayName: string;
  /** Conta com o selo de verificado (e qual: o azul ou o da conta oficial). Respostas antigas não o trazem. */
  verified?: boolean; verifiedTier?: 'verified' | 'official' | 'paid' | null;
}
export interface AuthResult { accessToken: string; /** Só na app nativa; na web vai no cookie. */ refreshToken?: string; user: PublicUser }

export interface PostMedia { url: string; kind?: 'image' | 'video'; posterUrl?: string; width?: number | null; height?: number | null; durationMs?: number | null; tags?: ({ username: string; displayName?: string } & Badged)[] }
/** Tcheka = uma publicação com um único vídeo. Fotos e vídeos juntos são um carrossel normal (abre como publicação). */
export const isTcheka = (p: { media: { kind?: string }[] } | null | undefined) => !!p && p.media.length === 1 && p.media[0]?.kind === 'video';
/** Selo de verificado: os mesmos campos que a API manda nos posts e no perfil. */
export type VerifiedTier = 'verified' | 'official' | 'paid' | null;
export interface Badged { verified?: boolean; verifiedTier?: VerifiedTier }
export interface Author { id: string; username: string; displayName: string; verified?: boolean; verifiedTier?: 'verified' | 'official' | 'paid' | null }
export interface Post {
  /** Música da publicação (licença aberta ou clipe próprio). */
  music?: import('./api.music').Track | null;
  /** O som da tcheka (abre /som/:id). Só nas tchekas e quando o som existe para quem vê; servidores antigos não mandam. */
  sound?: import('./api.sounds').PostSound | null;
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
  gift: { amount: number; recipient: { username: string; displayName: string } & Badged } | null;
  /** Remix (0134): de que tcheka é dueto, ou a que comentário responde. Servidores antigos não mandam. */
  remixOf?: import('./remix').RemixOf | null;
  /** A tcheka usava um som que foi tirado: 'author' («Som retirado pelo autor») ou 'rights' (por direitos de autor). O vídeo fica sem som. */
  soundRemoved?: 'author' | 'rights' | null;
  /** O dono deixa fazer dueto (tchekas) e responder com tcheka aos comentários. */
  canRemix?: boolean;
  /** Quantos duetos e respostas com tcheka tem. */
  remixes?: number;
  /** A geleira partilhada (0143): o retrato dos gostos com os brindes de cada um. Servidores antigos não mandam. */
  geleira?: import('./api.geleira').PostGeleira | null;
  /** «Paga-me uma» publicado (0145): a bebida e o estado de cada pessoa identificada. Servidores antigos não mandam. */
  gelada?: import('./api.gelada').PostGelada | null;
}
export interface Comment {
  id: string;
  postId: string;
  parentId: string | null;
  body: string;
  /** GIF do GIPHY no comentário (com ou sem texto). Servidores antigos não mandam. */
  gif?: import('./gifs').ChatGif | null;
  createdAt: string;
  author: Author;
  cheers: number;
  cheered: boolean;
  replyCount: number;
  editedAt?: string | null;
  authorFollowed?: boolean;
  /** Dá para responder a este comentário com uma tcheka. */
  canRemix?: boolean;
  /** «Respondeu com uma tcheka»: quantas e a mais recente. */
  tchekaReplies?: { count: number; postId: string } | null;
}
export type GiftVisibility = 'silent' | 'private' | 'public';
export type ReportReason = 'spam' | 'harassment' | 'hate' | 'nudity' | 'violence' | 'scam' | 'impersonation' | 'minor' | 'other';
/** O que se denuncia: `user` e `venue` vão pelo id (uuid), nunca pelo @ ou pelo slug. `story` é um mimo, `story_comment` um comentário num mimo e `instant` um Zás. */
export type ReportType = 'post' | 'comment' | 'story' | 'story_comment' | 'instant' | 'user' | 'message' | 'venue';
export type NotificationKind = 'blocked' | 'follow' | 'follow_request' | 'request_accepted' | 'gift' | 'comment' | 'reply' | 'story_reply' | 'repost' | 'mention' | 'tag' | 'verified' | 'venue_invite' | 'missed_call' | 'venue_payment' | 'venue_review' | 'group_join_request' | 'group_join_accepted' | 'group_member_joined' | 'group_admin_granted' | 'geleira_cheer' | 'cheer' | 'invite_joined'
  // Avisos da equipa do Txillapp (0121): conteúdo removido ou reposto, e aviso da moderação (data.type, data.reason).
  | 'content_removed' | 'content_restored' | 'moderation_warning'
  // Programa de artistas (0131): a equipa decidiu o pedido de artista ou uma faixa (data.what, data.decision, data.title, data.reason).
  | 'music_review'
  // «Paga-me uma» (0145): pediram-me numa publicação (data.requestId, data.postId, data.soft), responderam ao meu pedido
  // publicado (data.answer) e «Já paguei» / confirmação (data.debtId, data.step).
  | 'gelada_tag' | 'gelada_answer' | 'gelada_paid'
  // Remix das tchekas (0134): dueto com a minha tcheka ou resposta com tcheka (data.remixKind, data.role, data.postId = o remix).
  | 'remix'
  // Direitos (0140): um som meu suspenso, retirado ou reposto (data.soundId, data.decision, data.reason, data.note); o autor
  // da tcheka original retirou o meu dueto (data.postId = o dueto).
  | 'sound_review' | 'remix_takedown';
export interface AppNotification {
  id: string;
  kind: NotificationKind;
  /** TxillGroups: o grupo vem em `data.groupId/groupName`; aceita-se também ao nível de cima, se o servidor o mandar aí. */
  groupId?: string;
  groupName?: string;
  data: { amount?: number; note?: string; snippet?: string; postId?: string; commentId?: string; storyId?: string; target?: 'post' | 'comment'; tcheka?: boolean; replyKind?: 'reply' | 'reaction' | 'comment'; venueSlug?: string; venueName?: string; role?: 'admin' | 'editor'; groupId?: string; groupName?: string; video?: boolean; callId?: string; decision?: 'approved' | 'rejected'; type?: string; reason?: string; /** Brinde a um gosto da geleira (0143). */ itemId?: string; itemName?: string; /** «Paga-me uma» (0145). */ requestId?: string; debtId?: string; soft?: boolean; answer?: 'accept' | 'decline' | 'owe'; step?: 'claimed' | 'confirmed' };
  createdAt: string;
  read: boolean;
  /** `staff`: aviso da equipa do Txillapp (o servidor mostra-o como «txillapp»; não há perfil para abrir). */
  actor: { username: string; displayName: string; isPrivate?: boolean; following?: boolean; requested?: boolean; staff?: boolean } & Badged;
  thumb?: { url: string; video: boolean } | null;
  /** Só nos brindes (`cheer`): quantos ainda estão postos nesta linha e os dois últimos a brindar. */
  cheer?: { count: number; actors: ({ username: string; displayName: string } & Badged)[] };
}
export type ProfileTab = 'all' | 'reels' | 'reposts' | 'gifts' | 'saved';
export type MentionSuggestContext = 'post' | 'group' | 'story' | 'zas' | 'chat';
export interface MentionSuggestion extends Badged { username: string; displayName: string; hasAvatar: boolean; reason?: 'conversa' | 'segues-te' | 'segue-te' | 'amigo-proximo' | 'neste-post' | 'no-grupo' }
export interface Person extends Badged { username: string; displayName: string; following: boolean; followsYou: boolean; isPrivate?: boolean; requested?: boolean }
export interface InvitesInfo {
  code: string;
  link: string;
  stats: { invited: number; active: number; pending: number; paid: number; earned: number; today: number };
  rules: { reward: number; perDay: number; maxPaid: number; holdDays: number };
  eligible: boolean;
  note: string | null;
  /**
   * Para desenhar o cartão do convite no aparelho (servidor antigo não manda). `items`: só os da geleira à vista de todos
   * (vazio se a geleira ou a conta não forem públicas); `adult`: false → nada de álcool no cartão.
   */
  card?: { displayName: string; username: string; hasAvatar: boolean; verified?: boolean; verifiedTier?: VerifiedTier; adult: boolean; geleiraPublic: boolean; items: { name: string; kind: string; category: string; alcoholic: boolean; favorite: boolean }[] };
}
/** O convite visto por quem ainda não tem conta (página /c/CÓDIGO e registo). */
export interface InvitePreview extends Badged { username: string; displayName: string; hasAvatar?: boolean; items?: string[]; reward?: number; phrase?: string }
export interface WalletView {
  currency: string;
  balance: number;
  history: { id: string; amount: number; type: string; createdAt: string; counterparty: ({ username: string; displayName: string } & Badged) | null; note: string | null }[];
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
  /** «Deixar fazer duetos e respostas com as minhas tchekas» (numa conta privada não vale). Servidores antigos não mandam. */
  remixAllowed?: boolean;
  /** Já viu (ou saltou) a visita guiada. */
  welcomed?: boolean;
}
export interface StorySettings { replies: Who; hidden: ({ username: string; displayName: string } & Badged)[] }
/** Uma sessão em /auth/sessions. `kind` e `mobile` só vêm nos servidores novos (lib/aparelhos adivinha pelo nome nos antigos). */
export interface DeviceSession { id: string; device: string; kind?: 'app' | 'pwa' | 'browser' | 'unknown'; mobile?: boolean; firstSeen: string; lastUsed: string; current: boolean }
export type DocType = 'id_card' | 'passport' | 'driver_licence' | 'residence' | 'other';
export interface VerificationStatus {
  items: { key: string; label: string; ok: boolean; hint: string }[];
  eligible: boolean;
  verified: boolean;
  tier: 'verified' | 'official' | 'paid' | null;
  /** 'paid_eligible': a moderação confirmou a identidade para a verificação paga (o selo azul vem com a subscrição). */
  request: { id: string; kind: string; status: 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'paid_eligible'; reason: string | null; createdAt: string } | null;
  retryAfter: string | null;
  /** Aprovado para a verificação paga (o mesmo que `verification.eligible` em GET /iap/catalog). Só nos servidores novos. */
  paidEligible?: boolean;
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
  verifiedTier?: 'verified' | 'official' | 'paid' | null;
  /** Programa de artistas: a etiqueta «Artista» (não é o selo de verificado), o nome artístico, os estilos e as ligações. */
  artist?: { stageName: string; styles: string[]; links: { kind: string; url: string }[] } | null;
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
  people: ({ username: string; displayName: string; isPrivate: boolean; following: boolean; requested: boolean; followsYou: boolean } & Badged)[];
  posts: Post[];
  tags: { tag: string; posts: number }[];
  /** Locais (páginas) com esse nome ou nessa cidade. */
  venues?: import('./api.locais').Venue[];
}
export interface TrendingTag { tag: string; posts: number; rising?: boolean }
export type MsgKind = 'text' | 'story_reply' | 'story_reaction' | 'image' | 'voice' | 'video' | 'sticker' | 'location' | 'post' | 'gift' | 'zas_reply' | 'call' | 'gif' | 'system' | 'gelada' | 'rodada';
export interface ChatMessage {
  id: string;
  fromMe: boolean;
  body: string;
  kind: MsgKind;
  giftAmount?: number | null;
  /** GIF do GIPHY (kind 'gif'): { id, w, h, url, still?, title? }. */
  gif?: import('./gifs').ChatGif | null;
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
  /** Mensagens temporárias: quando deixa de existir (null ou ausente = fica). Passada esta hora, sai da conversa. */
  expiresAt?: string | null;
  /** Aviso de sistema (kind 'system'): o que mudou. O texto, já para quem o vê, vem em `body`. */
  system?: { type: 'ttl'; ttl: number | null } | null;
  /** «Paga-me uma» (kind 'gelada'): o pedido como eu o vejo; null = a conta de uma das partes foi eliminada. */
  gelada?: import('./api.gelada').GeladaRequest | null;
  /** Rodada no TxillGroup (kind 'rodada'); null = já não existe. */
  rodada?: import('./api.gelada').GeladaRound | null;
  at: string;
}
export interface Presence { online: boolean; lastSeen: string | null }
export interface Conversation extends Badged {
  username: string;
  displayName: string;
  hasAvatar: boolean;
  /** `empty`: limpei a conversa e não chegou nada depois ("Sem mensagens"). Servidores antigos não mandam. */
  lastMessage: { body: string; kind: MsgKind; fromMe: boolean; at: string; empty?: boolean };
  /** Mensagens temporárias: quanto dura cada mensagem nova (segundos), ou null (desligadas). */
  ttl?: number | null;
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
  preview: ({ username: string; displayName: string; hasAvatar: boolean } & Badged)[];
  /** `cleared`: está vazia porque a limpei ("Sem mensagens"); `empty` sem `cleared` = grupo novo, sem mensagens. */
  lastMessage: { body: string; kind: MsgKind; fromMe: boolean; senderName: string | null; at: string; empty: boolean; cleared?: boolean };
  /** Mensagens temporárias: quanto dura cada mensagem nova (segundos), ou null (desligadas). */
  ttl?: number | null;
  unread: number;
}
export interface ChatThread {
  relation?: { iFollow: boolean; theyFollow: boolean; request: boolean; left: number | null };
  /** Publicações da pessoa que ainda não vi (últimos 7 dias): "1 publicação nova" no cabeçalho. Servidores antigos não mandam. */
  newPosts?: { count: number; latestId: string | null };
  person: { username: string; displayName: string; hasAvatar: boolean; canGift?: boolean; presence?: Presence | null } & Badged;
  blocked: boolean;
  /** Mensagens temporárias nesta conversa (segundos: 86400, 604800 ou 7776000), ou null. Servidores antigos não mandam. */
  ttl?: number | null;
  otherRead: string | null;
  items: ChatMessage[];
  nextCursor: string | null;
  /**
   * A nota ativa da pessoa, se eu a puder ver (por baixo da foto do cabeçalho). Só na 1.ª página; servidores antigos
   * não mandam.
   */
  peerNote?: { body: string; music: import('./api.music').Track | null; createdAt: string; expiresAt: string; cheered: boolean } | null;
  /**
   * Sem nota, a bio do perfil da pessoa (tal como está, até 150 caracteres), se eu puder ver o perfil e não houver
   * bloqueio; vai no mesmo balão. Só na 1.ª página; servidores antigos não mandam.
   */
  peerBio?: string | null;
}
export interface Story {
  id: string;
  mediaUrl: string;
  caption: string | null;
  audience: 'all' | 'close_friends';
  mediaKind: 'image' | 'video';
  durationMs: number | null;
  sharedFrom: ({ postId: string; username: string; displayName: string } & Badged) | null;
  createdAt: string;
  expiresAt: string;
  author: { username: string; displayName: string } & Badged;
  seen: boolean;
  viewCount: number | null;
  cheered?: boolean;
  cheerCount?: number | null;
  replyCount?: number | null;
  commentCount: number;
  commentsOff?: boolean;
  /** O espectador pode responder? */
  canReply: boolean;
  music?: { id: string; title: string; artist: string; url: string; kind?: 'clip'; source?: string; artistUsername?: string | null } | null;
  /** Stickers por cima do mimo (centro e largura em fração do ecrã, rotação em graus). */
  stickers?: { id: string; x: number; y: number; s: number; r: number }[];
}
export interface StoryComment { id: string; body: string; createdAt: string; mine: boolean; canDelete: boolean; author: { username: string; displayName: string; hasAvatar: boolean } & Badged }
export interface TrayUser extends Badged { username: string; displayName: string; isMe: boolean; count: number; seenCount: number; seen: boolean; closeFriends: boolean; latestAt: string }
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

/**
 * Para a lista "Os teus aparelhos" mostrar "Android · app Txillapp 1.25" ou "iPhone · Safari (app instalada)": a versão e a
 * plataforma da app nativa, ou se a versão web está instalada no ecrã principal. Nada mais (nem IP, nem modelo do telemóvel).
 */
function deviceHeaders(): Record<string, string> {
  try {
    if (!isWeb) {
      const v = (Constants.expoConfig?.version ?? Constants.nativeApplicationVersion ?? '').trim();
      const p = Platform.OS === 'ios' ? ((Platform as unknown as { isPad?: boolean }).isPad ? 'ipad' : 'ios') : 'android';
      return { ...(/^\d{1,3}\.\d{1,3}(\.\d{1,4})?$/.test(v) ? { 'X-App-Version': v } : {}), 'X-App-Platform': p };
    }
    const standalone = typeof window !== 'undefined' && ((navigator as unknown as { standalone?: boolean }).standalone === true || !!window.matchMedia?.('(display-mode: standalone)').matches);
    return standalone ? { 'X-App-Display': 'standalone' } : {};
  } catch {
    return {};
  }
}

const baseHeaders: Record<string, string> = { 'Content-Type': 'application/json', 'X-Requested-With': 'txillapp', 'X-Client': isWeb ? 'txillapp-web' : 'txillapp-mobile', ...deviceHeaders() };

async function call(path: string, init: RequestInit = {}, auth = true): Promise<Response> {
  try {
    return await fetch(`${SITE_URL}/api/v1${path}`, {
      ...(isWeb ? { credentials: 'include' as const } : {}),
      ...init,
      headers: { ...baseHeaders, ...(isWeb && webAccountId ? { 'X-Account': webAccountId } : {}), ...(auth && accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...(init.headers as Record<string, string> | undefined) },
    });
  } catch (e) {
    // Sem rede o fetch lança "Failed to fetch" / "Load failed" (em inglês), que ia parar ao ecrã (ex.: no login): passa a português.
    throw friendlyFetchError(e);
  }
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

/**
 * Envia uma foto, vídeo ou áudio do chat (privado): pede o URL assinado, envia os bytes, confirma e espera que fique pronto. Devolve o id do ficheiro.
 * `signed`: o ficheiro já leva a assinatura do Txillapp (saiu da câmara da app); o servidor não a volta a pôr ao guardar um mimo.
 */
export async function uploadMedia(uri: string, mime: string, purpose: 'public' | 'chat' | 'music' = 'chat', onWait?: () => void, signed?: boolean): Promise<string> {
  const blob = await readLocalBlob(uri);
  let up: { assetId: string; uploadUrl: string };
  try {
    up = (await raw('/media/uploads', post(uploadRequest(mime, blob.size, purpose, signed)))) as { assetId: string; uploadUrl: string };
    const url = /^https?:\/\//.test(up.uploadUrl) ? up.uploadUrl : `${SITE_URL}${up.uploadUrl}`;
    await putBlob(url, blob, mime);
  } finally {
    releaseBlob(blob);
  }
  await waitMediaReady(up.assetId, (await raw(`/media/${up.assetId}/complete`, { method: 'POST' })) as MediaState, onWait);
  return up.assetId;
}

export const uploadChatMedia = (uri: string, mime: string) => uploadMedia(uri, mime, 'chat');

/** ?cursor=…&read=0 das conversas (o servidor só marca como lida sem `read=0`). */
export function threadQuery(cursor: string | undefined, read: boolean): string {
  const p = [cursor ? `cursor=${cursor}` : '', read ? '' : 'read=0'].filter(Boolean);
  return p.length ? `?${p.join('&')}` : '';
}

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
  /** `appleEnabled`: o servidor tem o Iniciar sessão com a Apple configurado (APPLE_CLIENT_ID). Servidores antigos não mandam. */
  authConfig: (): Promise<{ googleClientId: string | null; appleEnabled?: boolean }> => raw('/auth/config'),
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
  /**
   * Iniciar sessão com a Apple (o botão ainda não está na app: falta o expo-apple-authentication e a conta Apple, ver
   * docs/lojas/app-store.md). `fullName` só vem da Apple na primeira vez. Conta nova: devolve `needsUsername`, como a Google.
   */
  async appleLogin(identityToken: string, nonce?: string, fullName?: string): Promise<AuthResult | GoogleNeedsUsername> {
    const r = (await parse(await call('/auth/apple', post({ identityToken, nonce, fullName }), false))) as AuthResult | GoogleNeedsUsername;
    if ('needsUsername' in r) return r;
    accessToken = r.accessToken;
    await refreshStore.save(r);
    return r;
  },
  /** Como a Google: a data de nascimento e a aceitação dos termos são obrigatórias no servidor (quem chama já mostrou os termos). */
  async appleComplete(signupToken: string, username: string, gender: string, birthDate: string): Promise<AuthResult> {
    const r = (await parse(await call('/auth/apple/complete', post({ signupToken, username, gender, birthDate, acceptTerms: true }), false))) as AuthResult;
    accessToken = r.accessToken;
    await refreshStore.save(r);
    return r;
  },
  usernameAvailable: (u: string): Promise<{ available: boolean; reason?: 'invalid' | 'reserved' | 'taken'; suggestions?: string[] }> => raw(`/auth/username-available?username=${encodeURIComponent(u)}`),
  emailAvailable: (e: string): Promise<{ available: boolean; reason?: 'invalid' | 'taken' }> => raw(`/auth/email-available?email=${encodeURIComponent(e)}`),
  forgotPassword: (email: string): Promise<{ ok: boolean }> => raw('/auth/password/forgot', post({ email })),
  invitePreview: (code: string): Promise<InvitePreview> => raw(`/invites/preview/${encodeURIComponent(code)}`),
  async logout(): Promise<void> {
    const headers = await refreshStore.get();
    if (headers) await call('/auth/logout', { method: 'POST', headers }, false).catch(() => undefined);
    accessToken = null;
    await refreshStore.clear();
  },
  /** `near` (opcional, 2 casas decimais): só para o servidor escolher os destaques do Bombar (`sponsored`); não se guarda. */
  feed: (cursor?: string, near?: { lat: number; lng: number } | null): Promise<Page<Post> & { sponsored?: SponsoredSlot[] }> =>
    raw(`/feed${cursor ? `?cursor=${encodeURIComponent(cursor)}&limit=10` : '?limit=10'}${near ? `&lat=${near.lat}&lng=${near.lng}` : ''}`),
  cheer: (id: string): Promise<{ cheered: boolean; cheers: number }> => trackOk(raw(`/posts/${id}/cheers`, post({})), 'cheer', (r) => r?.cheered && { target: 'post' }),
  gift: (id: string, amount: number, key: string, note = '', visibility: GiftVisibility = 'silent'): Promise<{ transactionId: string; post: Post; announcement: Post | null }> =>
    raw(`/posts/${id}/gifts`, { ...post({ amount, note, visibility }), headers: { 'Idempotency-Key': key } }),
  giftUser: (b: { toUsername: string; amount: number; note?: string; visibility: GiftVisibility }, key: string): Promise<{ transactionId: string; replayed: boolean; post: Post | null }> =>
    raw('/gifts', { ...post(b), headers: { 'Idempotency-Key': key } }),
  publishGift: (transactionId: string, note?: string): Promise<{ post: Post }> => raw(`/gifts/${transactionId}/publish`, post({ note })),
  repost: (id: string, body = ''): Promise<Post> => trackOk(raw(`/posts/${id}/repost`, post({ body })), 'repost', { quote: !!body.trim() }),
  unrepost: (id: string): Promise<{ reposted: boolean; reposts: number }> => raw(`/posts/${id}/repost`, { method: 'DELETE' }),
  markSeen: (ids: string[]): Promise<void> => raw('/feed/seen', post({ ids })),
  stories: (): Promise<TrayUser[]> => raw('/stories'),
  storiesOf: (username: string): Promise<Story[]> => raw(`/stories/user/${encodeURIComponent(username)}`),
  createStory: (mediaId: string, caption: string, audience: 'all' | 'close_friends' = 'all'): Promise<Story> => trackOk(raw('/stories', post({ mediaId, caption, audience })), 'story_create', { source: 'camera', closeFriends: audience === 'close_friends' }),
  viewStory: (id: string): Promise<void> => trackOk(raw(`/stories/${id}/view`, post({})), 'story_view'),
  deleteStory: (id: string): Promise<void> => raw(`/stories/${id}`, { method: 'DELETE' }),
  setStoryComments: (id: string, commentsOff: boolean): Promise<{ commentsOff: boolean }> => raw(`/stories/${id}`, { method: 'PATCH', body: JSON.stringify({ commentsOff }) }),
  replyStory: (id: string, body: string): Promise<{ id: string; kind: 'reply' | 'reaction' }> => trackOk(raw(`/stories/${id}/replies`, post({ body })), 'message_send', (r) => ({ kind: r?.kind === 'reaction' ? 'story_reaction' : 'story_reply', group: false })),
  storyReplies: (id: string): Promise<{ id: string; body: string; kind: 'reply' | 'reaction'; createdAt: string; author: { username: string; displayName: string } & Badged }[]> => raw(`/stories/${id}/replies`),
  storyViewers: (id: string): Promise<({ username: string; displayName: string; viewedAt: string; cheered?: boolean } & Badged)[]> => raw(`/stories/${id}/viewers`),
  cheerStory: (id: string, on: boolean): Promise<{ cheered: boolean }> => trackOk(raw(`/stories/${id}/cheer`, { method: on ? 'PUT' : 'DELETE' }), 'cheer', on && { target: 'story' }),
  storyComments: (id: string): Promise<StoryComment[]> => raw(`/stories/${id}/comments`),
  commentStory: (id: string, body: string): Promise<{ id: string }> => trackOk(raw(`/stories/${id}/comments`, post({ body })), 'comment', { target: 'story' }),
  deleteStoryComment: (commentId: string): Promise<void> => raw(`/stories/comments/${commentId}`, { method: 'DELETE' }),
  closeFriends: (): Promise<({ username: string; displayName: string; hasAvatar: boolean } & Badged)[]> => raw('/stories/close-friends'),
  addCloseFriend: (username: string): Promise<void> => raw(`/stories/close-friends/${encodeURIComponent(username)}`, { method: 'PUT' }),
  removeCloseFriend: (username: string): Promise<void> => raw(`/stories/close-friends/${encodeURIComponent(username)}`, { method: 'DELETE' }),
  /** Tchekas «Para ti»; com `following`, «A seguir» (só de quem segues). */
  reels: (cursor?: string, following = false): Promise<Page<Post>> => raw(`/feed/reels?limit=6${cursor ? `&cursor=${cursor}` : ''}${following ? '&following=1' : ''}`),
  createPost: (b: { body: string; locationLabel?: string; mediaIds: string[] }): Promise<Post> => trackOk(raw('/posts', post(b)), 'post_create', { media: b.mediaIds.length }),
  chatList: (): Promise<Conversation[]> => raw('/chat/conversations'),
  chatGroups: (): Promise<GroupSummary[]> => raw('/chat/groups'),
  /** `read: false`: só os dados, sem marcar como lida (pré-carregar, ou a conversa está por trás de outro ecrã). */
  chatThread: (username: string, cursor?: string, read = true): Promise<ChatThread> => raw(`/chat/with/${encodeURIComponent(username)}${threadQuery(cursor, read)}`),
  chatSend: (username: string, msg: { body?: string; kind?: MsgKind; mediaId?: string; instantId?: string; durationMs?: number; waveform?: string; lat?: number; lng?: number; name?: string; address?: string; liveMinutes?: 15 | 60 | 480; once?: boolean; replyTo?: string; gif?: import('./gifs').ChatGif }): Promise<{ id: string; expiresAt?: string | null }> =>
    trackOk(raw(`/chat/with/${encodeURIComponent(username)}`, post(msg)), 'message_send', () => {
      if (msg.kind === 'post') track('share', { target: 'chat' });
      return { kind: msg.kind ?? 'text', group: false, ...(msg.once ? { once: true } : {}) };
    }),
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
  /** Limpar a conversa só para mim: as mensagens até agora desaparecem para mim; a conversa fica na lista, vazia. */
  chatClearKeep: (username: string): Promise<{ ok: true }> => raw(`/chat/with/${encodeURIComponent(username)}/clear`, post({})),
  /** Mensagens temporárias (qualquer um dos dois): segundos (86400, 604800, 7776000) ou null para desligar. */
  chatSetTtl: (username: string, ttl: number | null): Promise<{ ttl: number | null }> => raw(`/chat/with/${encodeURIComponent(username)}/ttl`, { method: 'PUT', body: JSON.stringify({ ttl }) }),
  chatReact: (id: string, reaction: string): Promise<void> => raw(`/chat/messages/${id}/reaction`, { method: 'PUT', body: JSON.stringify({ reaction }) }),
  chatAccept: (username: string): Promise<void> => raw(`/chat/with/${encodeURIComponent(username)}/accept`, post({})),
  chatDecline: (username: string): Promise<void> => raw(`/chat/with/${encodeURIComponent(username)}/decline`, post({})),
  mentionable: (q: string): Promise<({ username: string; displayName: string; hasAvatar: boolean; following: boolean } & Badged)[]> => raw(`/mentionable?q=${encodeURIComponent(q)}`),
  /** Sugestões ao escrever @: as pessoas mais próximas primeiro; `context` + `id` sobem quem está na publicação/no grupo/no mimo. */
  mentionSuggest: (q: string, context?: MentionSuggestContext, id?: string): Promise<{ items: MentionSuggestion[] }> =>
    raw(`/mentions/suggest?q=${encodeURIComponent(q)}${context && id ? `&context=${context}&id=${encodeURIComponent(id)}` : ''}`),
  // A pesquisa corre a cada tecla: conta no máximo uma a cada 10 s (e nunca o que se escreveu).
  search: (q: string): Promise<SearchResults> => raw(`/search?q=${encodeURIComponent(q)}`).then((r) => (trackThrottled('search', 10_000, { mention: q.startsWith('@') }), r as SearchResults)),
  trending: (): Promise<{ tags: TrendingTag[] }> => raw('/search/trending'),
  hotPlaces: (): Promise<{ name: string; posts: number }[]> => raw('/places/hot'),
  explore: (topic: string | null, cursor?: string): Promise<Page<Post>> => raw(`/feed/explore?limit=18${topic ? `&topic=${encodeURIComponent(topic)}` : ''}${cursor ? `&cursor=${cursor}` : ''}`),
  exploreTopics: (all = false): Promise<{ id: string; label: string; count: number }[]> => raw(`/feed/explore/topics${all ? '?all=1' : ''}`),
  profile: (username: string): Promise<Profile> => raw(`/users/${encodeURIComponent(username)}`),
  userPosts: (username: string, cursor?: string, tab: ProfileTab = 'all'): Promise<Page<Post>> => raw(`/users/${encodeURIComponent(username)}/posts?limit=18${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}&tab=${tab}`),
  savedPosts: (cursor?: string): Promise<Page<Post>> => raw(`/feed/saved${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
  follow: (username: string): Promise<FollowState> => trackOk(raw(`/users/${encodeURIComponent(username)}/follow`, post({})), 'follow', (r) => ({ requested: !!r?.requested })),
  unfollow: (username: string): Promise<FollowState> => raw(`/users/${encodeURIComponent(username)}/unfollow`, post({})),
  block: (username: string): Promise<void> => raw(`/blocks/${encodeURIComponent(username)}`, { method: 'PUT' }),
  unblock: (username: string): Promise<({ username: string; displayName: string } & Badged)[]> => raw(`/blocks/${encodeURIComponent(username)}`, { method: 'DELETE' }),
  invites: (): Promise<InvitesInfo> => raw('/invites/me'),
  updateMe: (b: { displayName?: string; bio?: string; isPrivate?: boolean; website?: string; city?: string }): Promise<{ displayName: string }> => raw('/users/me', { method: 'PATCH', body: JSON.stringify(b) }),
  setAvatar: (mediaId: string): Promise<{ hasAvatar: boolean }> => raw('/users/me/avatar', { method: 'PUT', body: JSON.stringify({ mediaId }) }),
  clearAvatar: (): Promise<{ hasAvatar: boolean }> => raw('/users/me/avatar', { method: 'DELETE' }),
  followRequests: (): Promise<({ username: string; displayName: string; requestedAt: string } & Badged)[]> => raw('/follow-requests'),
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
  blocked: (): Promise<({ username: string; displayName: string } & Badged)[]> => raw('/blocks'),
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
  getPost: (idOrCode: string): Promise<Post> => trackOk(raw(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrCode) ? `/posts/${idOrCode}` : `/posts/code/${encodeURIComponent(idOrCode)}`), 'post_open'),
  notifications: (cursor?: string): Promise<Page<AppNotification>> => raw(`/notifications${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
  markNotificationsRead: (): Promise<void> => raw('/notifications/read', post({})),
  acceptRequest: (username: string): Promise<void> => raw(`/follow-requests/${encodeURIComponent(username)}/accept`, post({})),
  declineRequest: (username: string): Promise<void> => raw(`/follow-requests/${encodeURIComponent(username)}/decline`, post({})),
  comments: (postId: string, cursor?: string): Promise<Page<Comment>> => raw(`/posts/${postId}/comments?limit=15${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
  replies: (id: string, cursor?: string): Promise<Page<Comment>> => raw(`/comments/${id}/replies?limit=10${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
  addComment: (postId: string, body: string, parentId?: string, gif?: import('./gifs').ChatGif): Promise<Comment> => trackOk(raw(`/posts/${postId}/comments`, post({ body, parentId, ...(gif ? { gif } : null) })), 'comment', { target: 'post', reply: !!parentId, gif: !!gif }),
  editComment: (id: string, body: string): Promise<Comment> => raw(`/comments/${id}`, { method: 'PATCH', body: JSON.stringify({ body }) }),
  cheerComment: (id: string): Promise<{ cheered: boolean; cheers: number }> => trackOk(raw(`/comments/${id}/cheers`, post({})), 'cheer', (r) => r?.cheered && { target: 'comment' }),
  deleteComment: (id: string): Promise<void> => raw(`/comments/${id}`, { method: 'DELETE' }),
  report: (type: ReportType, id: string, reason: ReportReason, note?: string): Promise<void> => raw('/reports', post({ type, id, reason, note })),
  removePost: (id: string): Promise<void> => raw(`/posts/${id}`, { method: 'DELETE' }),
  /** O autor da tcheka original retira um dueto feito com ela (fica escondido para todos; o dono é avisado). */
  takeDownDuet: (id: string): Promise<void> => raw(`/posts/${id}/duet-takedown`, post({})),
  hideFromFeed: (postId: string): Promise<void> => raw('/feed/hide', post({ postId })),
  updatePost: (id: string, b: { body?: string; clearLocation?: boolean; commentsOff?: boolean }): Promise<Post> => raw(`/posts/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
  unreadCount: (): Promise<{ count: number }> => raw('/notifications/unread-count'),
  chatUnread: (): Promise<{ conversations: number }> => raw('/chat/unread'),
  savePost: (id: string): Promise<{ saved: boolean }> => raw(`/posts/${id}/save`, { method: 'PUT' }),
  unsavePost: (id: string): Promise<{ saved: boolean }> => raw(`/posts/${id}/save`, { method: 'DELETE' }),
};
