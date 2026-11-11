// "1 publicação nova" por baixo do nome, no cabeçalho da conversa (como no Instagram): o que a pessoa publicou e eu
// ainda não vi. Sem dependências (os testes correm em Node: tests/chatNewPosts.test.mjs).

export interface NewPosts { count: number; latestId: string | null }

/** "1 publicação nova", "3 publicações novas"; a partir de 10, "9+ publicações novas". Vazio quando não há. */
export function newPostsText(count: number | null | undefined): string {
  if (!count || !(count > 0)) return '';
  if (count >= 10) return '9+ publicações novas';
  const n = Math.floor(count);
  return n === 1 ? '1 publicação nova' : `${n} publicações novas`;
}

/** O que o leitor de ecrã diz: "1 publicação nova de Ana, abrir". */
export function newPostsLabel(count: number | null | undefined, name: string): string {
  const text = newPostsText(count);
  return text ? `${text} de ${name}, abrir` : '';
}

/** Para onde vai o toque: uma só → a publicação; várias (ou sem id) → o perfil da pessoa. null quando não há nada. */
export function newPostsTarget(np: NewPosts | null | undefined, username: string): string | null {
  if (!np || !(np.count > 0)) return null;
  if (np.count === 1 && np.latestId) return `/p/${np.latestId}`;
  return `/u/${username}`;
}

export type HeaderLine = 'typing' | 'newPosts' | 'online' | 'presence';

/** O que vai por baixo do nome: "a escrever…" ganha; depois as publicações novas; depois "Online" ou "Ativo há…". */
export function headerLine(s: { typing: boolean; newPosts?: NewPosts | null; online?: boolean | null }): HeaderLine {
  if (s.typing) return 'typing';
  if (s.newPosts && s.newPosts.count > 0) return 'newPosts';
  return s.online ? 'online' : 'presence';
}
