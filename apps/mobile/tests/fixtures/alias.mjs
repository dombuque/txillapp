// O alias `@/` da app (tsconfig: "@/*" → "./src/*") para os testes que carregam módulos de src/ no Node: desde que os
// textos passaram por t() (import { t } from '@/lib/i18n'), muitos módulos importam pelo alias.
// Usar com `import './fixtures/alias.mjs';` no topo e os módulos de src/ com `await import(...)` (os import estáticos
// resolvem-se antes de este gancho existir).
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith('@/')) {
      const base = path.join(SRC, spec.slice(2));
      for (const f of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), base]) {
        if (existsSync(f)) return { url: pathToFileURL(f).href, shortCircuit: true };
      }
    }
    return next(spec, ctx);
  },
});
