/** O id do ficheiro de um mimo a partir do endereço da media (`/api/v1/media/<id>`, às vezes com `?w=`). */
export function storyMediaId(url: string | null | undefined): string | null {
  const m = /\/media\/([0-9a-f-]{36})/i.exec(String(url ?? ''));
  return m ? m[1].toLowerCase() : null;
}

/** Abrir o visor no mimo certo: a resposta no chat leva o ficheiro do mimo (`?m=`). */
export function storyHref(username: string, storyUrl: string | null | undefined): string {
  const id = storyMediaId(storyUrl);
  return `/stories/${encodeURIComponent(username)}${id ? `?m=${id}` : ''}`;
}

/** Onde começar: o mimo pedido (se ainda existir) ou, sem ele, o que o visor já escolhia. */
export function startIndex(stories: { mediaUrl: string }[], wanted: string | null | undefined, fallback: number): number {
  const id = wanted ? String(wanted).toLowerCase() : '';
  if (!id) return fallback;
  const i = stories.findIndex((s) => storyMediaId(s.mediaUrl) === id);
  return i >= 0 ? i : fallback;
}

/**
 * Já dá para escolher por onde começar? Só com uma lista pedida depois de o visor abrir, ou quando já não há pedido a
 * correr (sem rede fica a que houver). Com a lista antiga em memória, os mimos já vistos podiam vir como novos e o visor
 * começava sempre do primeiro.
 */
export function freshEnough(dataUpdatedAt: number, openedAt: number, fetching: boolean): boolean {
  return dataUpdatedAt >= openedAt || !fetching;
}

/**
 * Como a foto de um mimo enche o ecrã. Uma foto quase com a forma do ecrã (um 9:16 num iPhone de 19,5:9, um 3:4 num ecrã
 * mais largo) fica a encher, como no Instagram: corta-se um pouco dos lados e não sobram margens com o fundo desfocado.
 * Uma foto muito diferente (deitada, quadrada) aparece inteira, com o fundo desfocado à volta.
 */
export function storyFit(photoRatio: number | null | undefined, boxRatio: number): 'cover' | 'contain' {
  if (!photoRatio || !boxRatio || !Number.isFinite(photoRatio) || !Number.isFinite(boxRatio)) return 'contain';
  const r = photoRatio / boxRatio;
  return r >= 0.72 && r <= 1.38 ? 'cover' : 'contain';
}
