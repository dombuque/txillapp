// A fila da faixa de notas, em Mensagens (como no Instagram): primeiro quem tem nota, depois as pessoas com quem já
// conversei, mesmo sem nota. Sem dependências (os testes correm em Node: tests/notesRow.test.mjs).

/** Quantas fotos cabem na faixa, no máximo (fora a minha nota, que vai sempre à frente). */
export const NOTES_ROW_MAX = 60;

export type NotesRowEntry<N, P> = { kind: 'note'; key: string; note: N } | { kind: 'person'; key: string; person: P };

const norm = (u: string) => u.trim().toLowerCase();

/**
 * Monta a fila: as notas na ordem do servidor e depois as pessoas (o servidor já as manda pela ordem certa, a começar
 * pelas conversas mais em baixo na lista). Sem repetidos (o username não distingue maiúsculas; quem tem nota ganha),
 * sem mim, e no máximo `max`. `people` pode não vir (servidor antigo).
 */
export function notesRow<N extends { username: string }, P extends { username: string }>(
  items: readonly N[] | null | undefined,
  people: readonly P[] | null | undefined,
  me?: string | null,
  max: number = NOTES_ROW_MAX,
): NotesRowEntry<N, P>[] {
  const seen = new Set<string>();
  if (me) seen.add(norm(me));
  const out: NotesRowEntry<N, P>[] = [];
  const room = Math.max(0, Math.floor(max));
  const take = (username: unknown) => {
    if (out.length >= room || typeof username !== 'string' || !username.trim()) return '';
    const k = norm(username);
    if (seen.has(k)) return '';
    seen.add(k);
    return k;
  };
  for (const note of Array.isArray(items) ? items : []) {
    const k = take(note?.username);
    if (k) out.push({ kind: 'note', key: `n:${k}`, note });
  }
  for (const person of Array.isArray(people) ? people : []) {
    const k = take(person?.username);
    if (k) out.push({ kind: 'person', key: `p:${k}`, person });
  }
  return out;
}
