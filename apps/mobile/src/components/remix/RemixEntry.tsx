import { remixMode } from '@/lib/remix';
import { DuetStudio } from './DuetStudio';
import { ReplyStudio } from './ReplyStudio';

/**
 * O estúdio de remix para os parâmetros do /tcheka/nova: `?dueto=<postId>` abre o dueto e `?resposta=<commentId>` o
 * «Responder com tcheka». Sem estes parâmetros devolve null e o ecrã segue com o estúdio normal (equipa do estúdio):
 *
 *   const remix = remixStudioFor(useLocalSearchParams());
 *   if (remix) return remix;
 */
export function remixStudioFor(params: { dueto?: string | string[]; resposta?: string | string[] }) {
  const m = remixMode(params);
  if (!m) return null;
  return m.kind === 'duet' ? <DuetStudio key={m.postId} postId={m.postId} /> : <ReplyStudio key={m.commentId} commentId={m.commentId} />;
}
