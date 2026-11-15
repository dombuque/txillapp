/**
 * Que @nomes existem (contas ativas), para o RichText só fazer link dos que existem: um @ de alguém que não existe fica
 * texto normal (abrir dava «Essa pessoa não existe»). Os pedidos juntam-se: os textos que aparecem ao mesmo tempo (o feed,
 * os comentários) fazem um só GET /mentions/exist com até 20 nomes, e cada nome fica guardado.
 *
 * Só importa tipos (o node corre este ficheiro direto nos testes).
 */

export const MENTION_BATCH = 20;
const WAIT_MS = 30;

export function createMentionChecker(fetchExisting: (names: string[]) => Promise<string[]>) {
  const known = new Map<string, boolean>();
  let queue = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let waiting: { names: string[]; done: (r: Record<string, boolean>) => void }[] = [];

  // Sem resposta (sem rede): não se sabe e não se guarda; nesta vez conta como «existe», para não estragar menções boas.
  const answer = (names: string[]) => Object.fromEntries(names.map((n) => [n, known.get(n) ?? true]));

  async function flush() {
    timer = null;
    const ask = [...queue];
    const mine = waiting;
    queue = new Set();
    waiting = [];
    for (let i = 0; i < ask.length; i += MENTION_BATCH) {
      const chunk = ask.slice(i, i + MENTION_BATCH);
      try {
        const got = new Set((await fetchExisting(chunk)).map((n) => n.toLowerCase()));
        for (const n of chunk) known.set(n, got.has(n));
      } catch { /* fica por saber */ }
    }
    for (const w of mine) w.done(answer(w.names));
  }

  return function check(raw: string[]): Promise<Record<string, boolean>> {
    const names = [...new Set(raw.map((n) => n.toLowerCase()))];
    const missing = names.filter((n) => !known.has(n));
    if (!missing.length) return Promise.resolve(answer(names));
    return new Promise((done) => {
      for (const n of missing) queue.add(n);
      waiting.push({ names, done });
      if (!timer) timer = setTimeout(() => void flush(), WAIT_MS);
    });
  };
}
