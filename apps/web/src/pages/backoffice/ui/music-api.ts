import { boRaw } from '../../../lib/api';

/**
 * Clientes de Backoffice › Música. Dois blocos com permissões diferentes:
 * - `catalogApi` (catalog.manage): o catálogo curado do seletor de música (docs/musica.md, secção 5);
 * - `musicApi` (music.manage): o programa de artistas moçambicanos (0131), pedidos, faixas e direitos de autor.
 */

export type MusicStatus = 'active' | 'hidden' | 'featured';
export type MusicSort = 'uses' | 'dislikes' | 'quality' | 'recent';
export type MusicStatusFilter = 'all' | 'featured' | 'hidden' | 'downranked';

export interface MusicAdminItem {
  id: string; title: string; artist: string; source: string; license: string; licenseUrl: string | null; landing: string | null;
  styles: string[]; kind: 'music' | 'sound'; duration: number; previewUrl: string; cover: string | null; artistUsername?: string;
  status: MusicStatus; statusReason: string | null; statusAt: string | null;
  quality: number; uses7d: number; uses30d: number; dislikes: number; downranked: boolean;
}

export interface MusicAdminList {
  threshold: { minPeople: number; rule: string };
  refreshedAt: string | null;
  total: number;
  styles: { id: string; label: string }[];
  sources: { id: string; enabled: boolean; tracks: number; lastError: string | null; note: string }[];
  items: MusicAdminItem[];
}

export interface MusicRefreshResult { added: number; updated: number; total: number; sources: Record<string, { ok: boolean; tracks: number; error?: string }> }

const qs = (o: Record<string, string | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};
const postJson = (b: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(b) });

export const catalogApi = {
  list: (f: { sort?: MusicSort; status?: MusicStatusFilter; style?: string; q?: string }): Promise<MusicAdminList> => boRaw(`/admin/music${qs(f)}`),
  setStatus: (id: string, status: MusicStatus, reason: string): Promise<void> => boRaw('/admin/music/status', postJson({ id, status, reason })),
  refresh: (reason?: string): Promise<MusicRefreshResult> => boRaw('/admin/music/refresh', postJson({ reason: reason || undefined })),
};

/* ───────────── Programa de artistas (music.manage): pedidos de artista, faixas e direitos de autor ───────────── */

export type ArtistStatus = 'pending' | 'approved' | 'rejected' | 'revoked';
export type TrackStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'removed' | 'held';
export type ClaimStatus = 'open' | 'upheld' | 'dismissed';

export interface ArtistLink { kind: string; url: string }

export interface ArtistRequest {
  userId: string;
  user: { username: string; displayName: string; followers: number };
  tracks: number;
  status: string;
  stageName: string;
  styles: string[];
  links: ArtistLink[];
  rightsKind: 'label' | 'self';
  labelName: string | null;
  rightsStatement: string;
  hasProof: boolean;
  reason: string | null;
  createdAt: string;
  reviewedAt: string | null;
  proofUrl: string | null;
  updatedAt: string;
}

export interface ArtistTrackItem {
  id: string;
  title: string;
  artist: { userId: string; username: string; stageName: string; rightsKind: string; labelName: string | null };
  styles: string[];
  explicit: boolean;
  status: string;
  onHold: boolean;
  openClaims: number;
  reason: string | null;
  durationMs: number;
  previewStartMs: number;
  previewMs: number;
  previewUrl: string | null;
  originalUrl: string | null;
  cover: string | null;
  license: { version: string; sha256: string; acceptedAt: string } | null;
  uses: number;
  people: number;
  createdAt: string;
}

export interface RightsClaim {
  id: string;
  track: { id: string; title: string; status: string; artist: string; artistUsername: string; previewUrl: string | null };
  reporter: string | null;
  claimantName: string;
  contactEmail: string;
  relation: 'owner' | 'label' | 'representative' | 'other';
  details: string;
  status: string;
  decisionNote: string | null;
  createdAt: string;
}

export interface MusicSummary { artists: number; tracks: number; claims: number }

const post = (b: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(b) });

export const musicApi = {
  summary: (): Promise<MusicSummary> => boRaw('/admin/music/summary'),
  artists: (status: ArtistStatus): Promise<ArtistRequest[]> => boRaw(`/admin/music/artists?status=${status}`),
  decideArtist: (userId: string, action: 'approve' | 'reject' | 'revoke', reason?: string): Promise<void> => boRaw(`/admin/music/artists/${userId}/decide`, post({ action, reason })),
  tracks: (status: TrackStatus): Promise<ArtistTrackItem[]> => boRaw(`/admin/music/tracks?status=${status}`),
  decideTrack: (id: string, action: 'approve' | 'reject' | 'remove' | 'restore', reason?: string): Promise<void> => boRaw(`/admin/music/tracks/${id}/decide`, post({ action, reason })),
  claims: (status: ClaimStatus): Promise<RightsClaim[]> => boRaw(`/admin/music/claims?status=${status}`),
  decideClaim: (id: string, action: 'uphold' | 'dismiss', reason: string): Promise<void> => boRaw(`/admin/music/claims/${id}/decide`, post({ action, reason })),
};

export const RELATION_LABEL: Record<RightsClaim['relation'], string> = { owner: 'Titular dos direitos', label: 'Editora', representative: 'Representante', other: 'Outra relação' };
export const LINK_LABEL: Record<string, string> = {
  instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', youtube: 'YouTube', spotify: 'Spotify', apple_music: 'Apple Music',
  audiomack: 'Audiomack', boomplay: 'Boomplay', deezer: 'Deezer', site: 'Site',
};
export const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
/** Só ligações https viram links (o servidor já recusa o resto). */
export const safeHref = (u: string | null | undefined) => (u && /^https:\/\//i.test(u) ? u : null);
