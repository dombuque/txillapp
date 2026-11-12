import { post, raw, type Badged } from '@/lib/api';

/** Igual ao tipo `Suggestion` do site. */
export interface Suggestion extends Badged { username: string; displayName: string; isPrivate: boolean; requested: boolean; followsYou: boolean; mutual: number; reason: string }
export type PeopleKind = 'reposts' | 'cheers' | 'gifts';
export interface Completeness { percent: number; steps: { id: 'photo' | 'bio' | 'post' | 'follow' | 'geleira'; done: boolean }[] }
/** Etiqueta de pessoa numa foto (como no site). */
export interface PhotoTag extends Badged { username: string; displayName?: string; x?: number; y?: number }

export const feedApi = {
  suggestions: (): Promise<Suggestion[]> => raw('/suggestions/people'),
  dismissSuggestion: (username: string): Promise<void> => raw(`/suggestions/people/${encodeURIComponent(username)}/dismiss`, post({})),
  completeness: (): Promise<Completeness> => raw('/users/me/completeness'),
  setInterest: (id: string, value: 1 | -1): Promise<{ value: number }> => raw(`/posts/${id}/interest`, { method: 'PUT', body: JSON.stringify({ value }) }),
  postPeople: (postId: string, kind: PeopleKind): Promise<({ username: string; displayName: string; hasAvatar: boolean; verified: boolean; at: string } & Badged)[]> => raw(`/posts/${postId}/people/${kind}`),
};
