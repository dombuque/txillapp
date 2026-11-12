/**
 * Os object URLs (`blob:`) que o estúdio cria: os dos rascunhos reabertos e os dos ficheiros juntados ou substituídos lá
 * dentro (testado em tests/studioDrafts.test.mjs). Cada um liberta-se (`URL.revokeObjectURL`) quando já nenhum passo do
 * histórico o usa (desfazer pode trazer de volta um clipe apagado ou substituído) e todos ao sair do estúdio.
 * Os URLs que vêm de fora (os clipes da câmara, que são do ecrã de criar) não são do estúdio e não se tocam.
 */
export interface UrlKeeper {
  /** Passa a ser do estúdio (só `blob:`). */
  own(uri: string | null | undefined): void;
  /** Liberta os do estúdio que já não estão em `inUse`. Devolve os libertados. */
  sweep(inUse: Iterable<string>): string[];
  /** Liberta todos (ao sair). */
  releaseAll(): string[];
  owned(): string[];
}

export function createUrlKeeper(revoke: (uri: string) => void = (u) => { try { URL.revokeObjectURL(u); } catch { /* já livre */ } }): UrlKeeper {
  const mine = new Set<string>();
  const drop = (u: string) => { mine.delete(u); revoke(u); };
  return {
    own(uri) { if (uri && uri.startsWith('blob:')) mine.add(uri); },
    sweep(inUse) {
      const keep = new Set(inUse);
      const out = [...mine].filter((u) => !keep.has(u));
      out.forEach(drop);
      return out;
    },
    releaseAll() { const out = [...mine]; out.forEach(drop); return out; },
    owned: () => [...mine],
  };
}

/** Todos os URLs que algum passo do histórico usa. */
export function urlsInUse(states: { uri: string }[][]): Set<string> {
  const s = new Set<string>();
  for (const l of states) for (const c of l) s.add(c.uri);
  return s;
}
