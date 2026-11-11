/**
 * A lógica das sugestões de @menções (components/MentionSuggest.tsx): que "@palavra" se está a escrever no cursor,
 * como trocá-la pelo @username escolhido e como andar na lista com o teclado.
 * Sem imports da app: os testes (tests/mentions.test.mjs) correm-no direto no Node.
 */

/** O "@par" que está a ser escrito: `start` é o @, `end` o fim da palavra, `query` o que já se escreveu até ao cursor. */
export interface MentionToken {
  start: number;
  end: number;
  query: string;
}

/** Letras (com acentos, para procurar pelo nome), números, "_" e ".": o que pode vir depois do @. */
const WORD = /[\p{L}\p{N}_.]/u;
/**
 * As mesmas regras do RichText e do servidor: o @ não conta se vier colado a uma letra, número, "_", ".", "&", "#"
 * ou outro "@" (é um email, "a@b.com", ou está a meio de uma palavra).
 */
const GLUED = /[\p{L}\p{N}_.&#@]/u;
/** Um @username tem no máximo 30 caracteres: depois disso já não é uma menção. */
const MAX = 30;

/** A "@palavra" em que está o cursor, ou null (sem @, email, @ a meio de palavra, cursor depois de um espaço…). */
export function activeMention(text: string, cursor: number): MentionToken | null {
  const at = Math.max(0, Math.min(cursor, text.length));
  let i = at;
  while (i > 0 && WORD.test(text[i - 1])) i--;
  if (i === 0 || text[i - 1] !== '@') return null;
  const start = i - 1;
  if (start > 0 && GLUED.test(text[start - 1])) return null;
  let end = at;
  while (end < text.length && WORD.test(text[end])) end++;
  const query = text.slice(start + 1, at);
  if (query.length > MAX || end - start - 1 > MAX) return null;
  return { start, end, query };
}

/**
 * Troca a "@palavra" por "@username " e diz onde fica o cursor (logo a seguir ao espaço).
 * Se já houver um espaço a seguir, não se põe outro.
 */
export function applyMention(text: string, token: MentionToken, username: string): { text: string; cursor: number } {
  const before = text.slice(0, token.start);
  const after = text.slice(token.end);
  const mention = `@${username}`;
  if (/^\s/.test(after)) return { text: before + mention + after, cursor: before.length + mention.length + 1 };
  return { text: `${before}${mention} ${after}`, cursor: before.length + mention.length + 1 };
}

/** ↑/↓ na lista: dá a volta nas pontas; sem itens fica em 0. */
export function moveHighlight(index: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return (((index + delta) % count) + count) % count;
}

export type MentionReason = 'conversa' | 'segues-te' | 'segue-te' | 'amigo-proximo' | 'neste-post' | 'no-grupo';

/** A razão discreta por baixo do nome. */
export function reasonLabel(reason?: MentionReason | null): string | null {
  switch (reason) {
    case 'conversa': return 'Conversam';
    case 'segues-te': return 'Seguem-se';
    case 'segue-te': return 'Segue-te';
    case 'amigo-proximo': return 'Amigo próximo';
    case 'neste-post': return 'Neste post';
    case 'no-grupo': return 'No grupo';
    default: return null;
  }
}
