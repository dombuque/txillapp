import { boBlob, boRaw } from '../../../lib/api';

/** Cliente da área «Conteúdo e moderação» do backoffice (fila de queixas, conteúdo, catálogo da Geleira e auditoria). */

/** 'story_comment' (comentário num mimo) e 'instant' (Zás) desde a 0125. */
export type ModReportType = 'post' | 'comment' | 'story' | 'user' | 'message' | 'media' | 'venue' | 'story_comment' | 'instant';
export type ModReason = 'spam' | 'harassment' | 'hate' | 'nudity' | 'violence' | 'scam' | 'impersonation' | 'minor' | 'other';
export type ModAction = 'dismiss' | 'remove' | 'warn' | 'suspend';
export type ModSort = 'severity' | 'oldest' | 'newest' | 'reports';

export interface ModMedia { id: string; video: boolean; nsfw: number | null; url: string; review?: boolean }
export interface ModTextHit { rule: string; label: string; term: string }
export interface ModAuthorCtx { reportedItems?: number; actioned?: number; openItems?: number; warnings?: number; removals?: number; suspensions?: number }
export interface ModMessageCopy { kind: string; body: string; placeName: string | null; placeAddress: string | null; editedAt: string | null; gifUrl: string | null }

export interface ModQueueItem {
  type: ModReportType;
  id: string;
  reports: number;
  reasons: ModReason[];
  severity: number;
  automatic: boolean;
  firstAt: string;
  lastAt: string;
  resolvedAt: string | null;
  resolution: string | null;
  resolutionNote: string | null;
  decidedBy: string | null;
  owner: ({ id: string; username: string; displayName: string; status: string } & ModAuthorCtx) | null;
  preview: string;
  media: ModMedia[];
  nsfw: number | null;
  textHits: ModTextHit[];
  postId: string | null;
  venueSlug: string | null;
  /** null = à vista; 'moderation' = removido pela equipa; 'author' = apagado pelo autor; 'expired' (mimo); 'gone' = já não existe. */
  removed: null | 'moderation' | 'author' | 'expired' | 'gone';
  reported: ModMessageCopy | null;
  current: (Omit<ModMessageCopy, 'gifUrl'> & { kind: string | null; deleted: boolean }) | null;
}
export interface ModQueueDetail {
  reports: { id: string; reason: ModReason; note: string | null; status: string; resolution: string | null; resolutionNote: string | null; at: string; resolvedAt: string | null; reporter: string | null; decidedBy: string | null }[];
  history: { action: string; target: string; reason: string | null; at: string; actor: string | null }[];
  past: { type: ModReportType; id: string; reports: number; reasons: ModReason[]; status: string; resolution: string | null; at: string }[];
}
export interface ModDecideResult { done: { type: string; id: string }[]; failed: { type: string; id: string; error: string }[] }

export type ContentType = 'post' | 'comment' | 'story';
export interface ModContentItem {
  type: ContentType;
  id: string;
  tcheka: boolean;
  gift: boolean;
  body: string;
  createdAt: string;
  postId: string | null;
  author: ({ id: string; username: string; displayName: string; status: string } & ModAuthorCtx) | null;
  media: ModMedia[];
  nsfw: number | null;
  nsfwFlagged: boolean;
  textHits: ModTextHit[];
  openReports: number;
  state: 'visible' | 'removed' | 'deleted' | 'expired';
  removal: { reason: string; at: string; by: string | null } | null;
}
export interface ModContentFilter { type?: string; q?: string; author?: string; tag?: string; from?: string; to?: string; state?: string; flag?: string }

export interface CatalogItem {
  id: string; slug: string; name: string; kind: 'vibe' | 'bebida' | 'comida' | 'sitio'; category: string; alcoholic: boolean; status: 'pending' | 'curated' | 'rejected';
  countries: string[] | null; createdAt: string; suggestedBy: string | null; suggestedCountry: string | null; fans: number; duplicateOf: string | null;
}
export interface CatalogList { items: CatalogItem[]; counts: Record<string, number>; categories: { kind: string; category: string; count: number }[]; countries: { country: string; count: number }[] }

export interface AuditRow {
  id: string; action: string; target: string | null; targetLabel: string | null; ownerLabel: string | null; metadata: Record<string, unknown>;
  created_at: string; actor: string | null; actorName: string | null; actorStaff: boolean;
}
export interface AuditFilter { actor?: string; action?: string; target?: string; from?: string; to?: string }

const qs = (o: Record<string, string | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};
const postJson = (b: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(b) });

export const modApi = {
  queue: (f: { status: string; type?: string; reason?: string; sort?: string; q?: string }): Promise<{ counts: Record<string, number>; items: ModQueueItem[] }> =>
    boRaw(`/admin/mod/queue${qs(f)}`),
  detail: (type: ModReportType, id: string): Promise<ModQueueDetail> => boRaw(`/admin/mod/queue/${type}/${id}`),
  decide: (items: { type: ModReportType; id: string }[], action: ModAction, note: string, notify: boolean): Promise<ModDecideResult> =>
    boRaw('/admin/mod/queue/decide', postJson({ items, action, note: note || undefined, notify })),
  content: (f: ModContentFilter, cursor?: string): Promise<{ items: ModContentItem[]; nextCursor: string | null; rules: { id: string; label: string }[]; nsfwThreshold: number }> =>
    boRaw(`/admin/mod/content${qs({ ...f, cursor } as Record<string, string | undefined>)}`),
  remove: (type: ContentType, id: string, reason: string, notify: boolean): Promise<{ ok: true }> => boRaw(`/admin/mod/content/${type}/${id}/remove`, postJson({ reason, notify })),
  restore: (type: ContentType, id: string, reason: string, notify: boolean): Promise<{ ok: true; expired: boolean }> => boRaw(`/admin/mod/content/${type}/${id}/restore`, postJson({ reason, notify })),
  catalog: (f: { status: string; kind?: string; q?: string; country?: string }): Promise<CatalogList> => boRaw(`/admin/catalog${qs(f)}`),
  catalogDecide: (ids: string[], approve: boolean, reason?: string): Promise<{ changed: number }> => boRaw('/admin/catalog/decide', postJson({ ids, approve, reason: reason || undefined })),
  catalogEdit: (id: string, b: Partial<Pick<CatalogItem, 'name' | 'kind' | 'category' | 'alcoholic' | 'countries'>> & { reason: string }): Promise<void> =>
    boRaw(`/admin/catalog/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
  catalogCreate: (b: Pick<CatalogItem, 'name' | 'kind' | 'category' | 'alcoholic' | 'countries'> & { reason: string }): Promise<{ id: string }> => boRaw('/admin/catalog', postJson(b)),
  audit: (f: AuditFilter, cursor?: string): Promise<{ items: AuditRow[]; nextCursor: string | null }> => boRaw(`/admin/audit/search${qs({ ...f, cursor } as Record<string, string | undefined>)}`),
  auditFacets: (): Promise<{ staff: { id: string; name: string; username: string }[]; actions: { action: string; count: number }[] }> => boRaw('/admin/audit/facets'),
  auditCsv: (f: AuditFilter): Promise<Blob> => boBlob(`/admin/audit/export${qs(f as Record<string, string | undefined>)}`),
};
