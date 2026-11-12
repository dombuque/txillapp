import { post, raw } from '@/lib/api';
import type { ArtistStatus, TrackStatus } from '@/lib/artists';

/** O pedido de artista (Sou artista). */
export interface ArtistApplication {
  status: ArtistStatus;
  stageName: string;
  styles: string[];
  links: { kind: string; url: string }[];
  rightsKind: 'label' | 'self';
  labelName: string | null;
  rightsStatement: string;
  hasProof: boolean;
  reason: string | null;
  createdAt: string;
  reviewedAt: string | null;
}
export interface MusicLicense { version: string; title: string; text: string; sha256: string }
export interface ArtistMe {
  artist: ArtistApplication | null;
  license: MusicLicense;
  styles: string[];
  linkKinds: string[];
  limits: { minTrackMs: number; maxTrackMs: number; minPreviewMs: number; maxPreviewMs: number };
  rightsContact: string;
}
/** Uma faixa minha, no Gerir (com os totais de usos). */
export interface MyTrack {
  id: string;
  title: string;
  styles: string[];
  explicit: boolean;
  status: TrackStatus;
  onHold: boolean;
  reason: string | null;
  durationMs: number;
  previewStartMs: number;
  previewMs: number;
  previewUrl: string | null;
  cover: string | null;
  licenseVersion: string;
  licenseAcceptedAt: string | null;
  uses: number;
  people: number;
  createdAt: string;
  approvedAt: string | null;
  withdrawnAt: string | null;
}
/** Faixa de um artista de Moçambique no seletor: a interface comum (docs/musica.md), `source: 'local'`. */
export interface LocalTrack {
  source: 'local';
  id: string;
  trackId: string;
  title: string;
  artist: string;
  artistUsername: string | null;
  duration: number;
  durationMs: number;
  previewUrl: string;
  url: string;
  cover: string | null;
  license: 'txillapp';
  licenseUrl: null;
  landing: null;
  styles: string[];
  explicit: boolean;
}

export const artistsApi = {
  me: (): Promise<ArtistMe> => raw('/artists/me'),
  apply: (b: { stageName: string; styles: string[]; links: { kind: string; url: string }[]; rightsKind: 'label' | 'self'; labelName?: string; rightsStatement: string; proofMediaId?: string }): Promise<ArtistApplication> =>
    raw('/artists/apply', post(b)),
  withdrawApplication: (): Promise<void> => raw('/artists/apply', { method: 'DELETE' }),
  tracks: (): Promise<MyTrack[]> => raw('/artists/tracks'),
  createTrack: (b: { title: string; audioMediaId: string; coverMediaId?: string; styles: string[]; previewStartMs: number; previewMs: number; explicit: boolean; licenseVersion: string; acceptLicense: true }): Promise<MyTrack> =>
    raw('/artists/tracks', post(b)),
  withdrawTrack: (id: string): Promise<{ status: 'withdrawn' }> => raw(`/artists/tracks/${id}/withdraw`, post({})),
  /** «Artistas de Moçambique» no seletor (filtros opcionais). */
  catalog: (opts: { q?: string; style?: string; artist?: string } = {}): Promise<LocalTrack[]> => {
    const p = new URLSearchParams();
    if (opts.q) p.set('q', opts.q);
    if (opts.style) p.set('style', opts.style);
    if (opts.artist) p.set('artist', opts.artist);
    const s = p.toString();
    return raw(`/music/local${s ? `?${s}` : ''}`);
  },
  /** Denunciar uma faixa por violação de direitos de autor (fica escondida enquanto a equipa analisa). */
  report: (id: string, b: { claimantName: string; contactEmail: string; relation: 'owner' | 'label' | 'representative' | 'other'; details: string }): Promise<{ reported: true }> =>
    raw(`/music/local/${encodeURIComponent(id)}/report`, post(b)),
};
