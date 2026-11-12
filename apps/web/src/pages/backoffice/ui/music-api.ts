import { boRaw } from '../../../lib/api';

/** Cliente de Backoffice › Música (catálogo curado do seletor de música). Contrato em docs/musica.md, secção 5. */

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

export const musicApi = {
  list: (f: { sort?: MusicSort; status?: MusicStatusFilter; style?: string; q?: string }): Promise<MusicAdminList> => boRaw(`/admin/music${qs(f)}`),
  setStatus: (id: string, status: MusicStatus, reason: string): Promise<void> => boRaw('/admin/music/status', postJson({ id, status, reason })),
  refresh: (reason?: string): Promise<MusicRefreshResult> => boRaw('/admin/music/refresh', postJson({ reason: reason || undefined })),
};
