import { boContasFile, boContasRaw } from '../../../lib/api';

/** Backoffice › Contas: os pedidos e os tipos da lista de contas, da ficha e das sessões. */

export type AccountStatus = 'active' | 'suspended' | 'deleted';
export type AccountSort = 'recent' | 'oldest' | 'last_seen' | 'reports' | 'followers' | 'username';

export interface AccountFilters {
  q?: string;
  status?: string;
  verified?: string;
  country?: string;
  from?: string;
  to?: string;
  reports?: boolean;
  minors?: boolean;
  sort?: string;
}

export interface AccountRow {
  id: string;
  username: string;
  display_name: string;
  email: string;
  status: AccountStatus;
  is_admin: boolean;
  created_at: string;
  country: string | null;
  verified: boolean;
  badge: 'verified' | 'official' | 'paid' | null;
  minor: boolean;
  posts: number;
  followers: number;
  reports: number;
  reports_open: number;
  last_seen: string | null;
}

export interface AccountSheet {
  user: {
    id: string; username: string; display_name: string; email: string; status: AccountStatus; is_admin: boolean; is_private: boolean;
    created_at: string; country: string | null; city: string | null; terms_version: string | null; terms_accepted_at: string | null;
    email_verified_at: string | null; badge: 'verified' | 'official' | 'paid' | null; has_avatar: boolean; age: number | null; minor: boolean;
    posts: number; posts_removed: number; stories: number; comments: number; followers: number; following: number; messages: number;
    sessions: number; last_seen: string | null; last_active: string | null; txills: string;
  };
  recentPosts: { id: string; body: string; created_at: string; removed_at: string | null; removed_by: string | null; kind: string; media: number }[];
  reportsAgainst: { target_type: string; target_id: string; reason: string; status: string; resolution: string | null; resolution_note: string | null; created_at: string; reporter: string | null }[];
  reportsMade: { target_type: string; target_id: string; reason: string; status: string; created_at: string; target_owner: string | null }[];
  reportCounts: { against: number; against_open: number; made: number };
  invite: { invited: number; paid: number; came_from: { status: string; reason: string | null; inviter: string } | null };
  notes: { id: string; body: string; created_at: string; author: string | null; author_name: string | null }[];
  history: { action: string; metadata: Record<string, unknown>; created_at: string; actor: string | null; actor_name: string | null; by_staff: boolean }[];
}

export type SessionState = 'active' | 'ended' | 'expired';
export interface AccountSession {
  id: string;
  device: string;
  kind: 'app' | 'pwa' | 'browser' | 'unknown';
  mobile: boolean;
  loginAt: string;
  lastActiveAt: string;
  expiresAt: string;
  endedAt: string | null;
  state: SessionState;
}
export interface AccountSessions {
  sessions: AccountSession[];
  devices: { platform: 'android' | 'ios'; createdAt: string; updatedAt: string }[];
  webPush: number;
}

/** Os filtros como parâmetros do pedido (os vazios ficam de fora). */
export function filterParams(f: AccountFilters): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(f)) {
    if (v === true) out[k] = '1';
    else if (typeof v === 'string' && v.trim()) out[k] = v.trim();
  }
  return out;
}

const post = (b: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(b) });

export const contasApi = {
  list: (f: AccountFilters, cursor?: string) =>
    boContasRaw(`/admin/users?${new URLSearchParams({ ...filterParams(f), ...(cursor ? { cursor } : {}) }).toString()}`) as Promise<{ items: AccountRow[]; nextCursor: string | null }>,
  sheet: (id: string) => boContasRaw(`/admin/users/${id}`) as Promise<AccountSheet>,
  sessions: (id: string) => boContasRaw(`/admin/users/${id}/sessions`) as Promise<AccountSessions>,
  revokeSession: (id: string, family: string, reason: string) => boContasRaw(`/admin/users/${id}/sessions/${family}/revoke`, post({ reason })) as Promise<void>,
  revokeAll: (id: string, reason: string) => boContasRaw(`/admin/users/${id}/sessions/revoke-all`, post({ reason })) as Promise<{ sessions: number }>,
  /** Descarrega o CSV (o browser guarda o ficheiro). */
  async exportCsv(f: AccountFilters) {
    const { blob, name } = await boContasFile(`/admin/users/export.csv?${new URLSearchParams(filterParams(f)).toString()}`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name ?? 'contas.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5_000);
  },
};

/** Onde está a app (o site principal), para abrir perfis e publicações. Em admin.txillapp.com é txillapp.com. */
export function appUrl(path: string) {
  const h = typeof window !== 'undefined' ? window.location.hostname : '';
  return h.startsWith('admin.') ? `https://${h.slice(6)}${path}` : path;
}

/** "Angola", "Portugal"… a partir do código do país. */
export function countryName(code: string | null | undefined) {
  if (!code) return '—';
  try {
    return new Intl.DisplayNames(['pt-PT'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}
