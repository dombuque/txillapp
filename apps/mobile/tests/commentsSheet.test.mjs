// Testes da folha de comentários (src/components/CommentsSheet.tsx).
// - Apagar um comentário rebentava o ecrã: havia um useState depois do `if (gone) return null` (a ordem dos hooks mudava).
// - O erro ao carregar não tinha "Tentar outra vez".
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(path.join(ROOT, 'src', 'components', 'CommentsSheet.tsx'), 'utf8');

/** O corpo de uma função de topo (do `function Nome(` até à função de topo seguinte). */
function body(name) {
  const i = src.indexOf(`function ${name}(`);
  assert.ok(i >= 0, name);
  const rest = src.slice(i + 1);
  const j = rest.search(/\n(?:export )?function /);
  return j < 0 ? rest : rest.slice(0, j);
}

test('Row: nenhum hook depois de um return antecipado', () => {
  const b = body('Row');
  const early = b.search(/\n\s*if \([^)]*\) return null;/);
  assert.ok(early > 0, 'há o return do comentário apagado');
  const after = b.slice(early, b.indexOf('\n  return (', early));
  assert.doesNotMatch(after, /\buse[A-Z]\w*\(/, 'hook depois do return antecipado');
  assert.match(b.slice(0, early), /const \[menu, setMenu\] = useState\(false\);/);
});

test('erro ao carregar: tem Tentar outra vez', () => {
  assert.match(src, /onPress=\{\(\) => void q\.refetch\(\)\}[^>]*><Text style=\{styles\.retryText\}>Tentar outra vez/);
});

test('Responder e brindar um comentário têm área de toque folgada', () => {
  assert.match(src, /onPress=\{\(\) => onReply\(c\)\} hitSlop=\{\{ top: 14, bottom: 14/);
  assert.match(src, /onPress=\{\(\) => void toggle\(\)\} hitSlop=\{12\}/);
});
