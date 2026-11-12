import { boRaw } from '../../../lib/api';

/** Cliente da área «Música dos artistas» do backoffice (programa de artistas moçambicanos, 0128): pedidos, faixas e direitos. */

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
