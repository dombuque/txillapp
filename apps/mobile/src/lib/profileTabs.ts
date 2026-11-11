/**
 * Separadores do perfil (Tudo, Tcheka, Reposts, Presentes e, no meu, Guardados): quais se veem e para onde vai um deslize.
 * Lógica pura, sem React, para se poder testar (tests/profileTabs.test.mjs). Os ícones e os nomes ficam no ProfileView.
 */

/** O mesmo que `ProfileTab` de lib/api (aqui sem importar a API, para os testes). */
export type ProfileTabId = 'all' | 'reels' | 'reposts' | 'gifts' | 'saved';

/** Todos os separadores, pela ordem do ecrã (é por esta ordem que um deslize passa de um para o outro). */
export const PROFILE_TAB_ORDER: ProfileTabId[] = ['all', 'reels', 'reposts', 'gifts', 'saved'];

/** Os separadores que esta pessoa tem: "Guardados" só no meu perfil (só eu vejo o que guardei). */
export function visibleProfileTabs(isMe: boolean): ProfileTabId[] {
  return PROFILE_TAB_ORDER.filter((t) => t !== 'saved' || isMe);
}

/**
 * Para onde vai um deslize: `dir = 1` o separador seguinte (dedo para a esquerda), `-1` o anterior. Salta os que não estão
 * em `visible` (anda pela ordem do ecrã até encontrar um que esteja). null = já está na ponta: no primeiro, para trás, o
 * gesto fica para quem estiver por fora (voltar atrás, ou na web mudar de menu); no último, para a frente, não faz nada.
 */
export function nextProfileTab(visible: readonly ProfileTabId[], current: ProfileTabId, dir: 1 | -1): ProfileTabId | null {
  const at = PROFILE_TAB_ORDER.indexOf(current);
  if (at < 0) return null;
  for (let i = at + dir; i >= 0 && i < PROFILE_TAB_ORDER.length; i += dir) {
    if (visible.includes(PROFILE_TAB_ORDER[i])) return PROFILE_TAB_ORDER[i];
  }
  return null;
}

/** Para que lados se pode deslizar a partir de `current` (o pan do telemóvel só ativa para esses lados). */
export function profileTabEdges(visible: readonly ProfileTabId[], current: ProfileTabId): { prev: boolean; next: boolean } {
  return { prev: nextProfileTab(visible, current, -1) !== null, next: nextProfileTab(visible, current, 1) !== null };
}
