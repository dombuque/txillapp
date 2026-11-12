import { raw, type Comment, type Page, type Post } from '@/lib/api';
import type { RemixKind } from '@/lib/remix';

/** O comentário para o autocolante do «Responder com tcheka» (o autor traz `hasAvatar`). */
export type ReplyComment = Comment & { author: Comment['author'] & { hasAvatar?: boolean } };

/** Remix das tchekas: a lista «Duetos e respostas» e o comentário a que se responde (servidor: posts/remix.ts). */
export const remixApi = {
  remixes: (postId: string, kind?: RemixKind | null, cursor?: string | null): Promise<Page<Post>> => {
    const q = new URLSearchParams();
    if (kind) q.set('kind', kind);
    if (cursor) q.set('cursor', cursor);
    const s = q.toString();
    return raw(`/posts/${postId}/remixes${s ? `?${s}` : ''}`);
  },
  comment: (id: string): Promise<ReplyComment> => raw(`/comments/${id}`),
};
