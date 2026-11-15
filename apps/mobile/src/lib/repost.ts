/**
 * Repostar (sem React, para os testes em node): «Deixar repostar as minhas publicações» (0156). Quem publicou pode não deixar
 * que os outros repostem as suas publicações (tal como estão ou com comentário): a API manda `canRepost: false` e a opção
 * «Repostar» não aparece (nem «Repostar com comentário»). Numa citação conta também o autor do original citado; num repost
 * simples, o do original (a API já o junta). O próprio autor pode sempre repostar as suas. Publicações em cache sem o campo
 * continuam a mostrar a opção (a API responde 403 com a mensagem, que a folha mostra).
 */

export interface RepostablePost {
  /** Quem vê pode repostar (a API). Sem o campo: como antes, pode. */
  canRepost?: boolean;
  /** Já repostei (o repost simples): o botão fica, para o desfazer, mesmo que já não se possa repostar. */
  reposted?: boolean;
}

/** Pode-se repostar (simples ou com comentário). */
export const canRepost = (p: RepostablePost | null | undefined) => !!p && p.canRepost !== false;

/** O botão «Repostar» aparece: pode-se repostar, ou há um repost meu para desfazer. */
export const showRepostButton = (p: RepostablePost | null | undefined) => canRepost(p) || !!p?.reposted;

/** A mensagem da API (403) quando quem publicou não deixa repostar. */
export const REPOST_BLOCKED = 'Quem publicou não deixa repostar as suas publicações.';

/** GET/PUT /posts/me/repost-settings. `private`: a conta é privada (servidores antigos podem não mandar). */
export interface RepostSettings { allow: boolean; private?: boolean }

/** A linha «Deixar repostar as minhas publicações» nas Definições → Conteúdo. */
export function repostSetting(s: RepostSettings | null | undefined): { on: boolean; disabled: boolean; description: string } {
  if (!s) return { on: false, disabled: true, description: 'Outras pessoas podem repostar as tuas publicações no perfil delas, tal como estão ou com um comentário.' };
  if (!s.allow) return { on: false, disabled: false, description: 'Desligado: só tu podes repostar as tuas publicações. Os reposts que já existem ficam.' };
  return {
    on: true,
    disabled: false,
    description: s.private
      ? 'Quem te segue pode repostar as tuas publicações, tal como estão ou com um comentário. A tua conta é privada: o repost só o vê quem te segue.'
      : 'Quem vê as tuas publicações pode repostá-las no perfil, tal como estão ou com um comentário.',
  };
}
