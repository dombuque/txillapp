// Para os testes que importam módulos da app (src/lib/*.ts) que por sua vez importam com o atalho «@/» (ex. '@/lib/marca'):
// resolve «@/x» para src/x.ts, como o Metro e o TypeScript fazem. Importar no topo do teste, antes dos import() da app.
import { registerHooks } from 'node:module';

const src = (p) => new URL(`../src/${p}`, import.meta.url).href;

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith('@/')) return next(src(/\.[cm]?[jt]sx?$/.test(spec) ? spec.slice(2) : `${spec.slice(2)}.ts`), ctx);
    return next(spec, ctx);
  },
});
