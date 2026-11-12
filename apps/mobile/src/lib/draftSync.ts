/**
 * O rascunho de um formulário preenchido a partir do servidor (ex.: Gerir o local → Perfil). Quando chega uma versão nova
 * dos dados (puxar para atualizar, voltar à app, outra parte do ecrã que invalida a cache), o formulário só passa para a
 * versão nova se a pessoa ainda não lhe mexeu; se já escreveu alguma coisa, fica o que ela escreveu.
 * `base` é a versão do servidor de onde o rascunho partiu.
 */
export function resyncDraft<T>(draft: T, base: T, incoming: T): T {
  return same(draft, base) ? incoming : draft;
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}
