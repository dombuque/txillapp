// Deixar de seguir uma conta privada pergunta antes («Deixar de seguir @x?»): depois só se volta a ver com um pedido novo.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/components/FollowButton.tsx', import.meta.url), 'utf8');

test('FollowButton: conta privada que sigo pede confirmação antes de deixar de seguir', () => {
  assert.match(src, /import \{ confirm \} from '@\/lib\/confirm';/);
  assert.match(src, /if \(s\.following && isPrivate\) \{[\s\S]{0,400}?await confirm\(\{[\s\S]{0,300}?danger: true \}\);\s*if \(!ok\) return;/);
  // A pergunta vem antes de mudar o botão ou chamar a API.
  assert.ok(src.indexOf('await confirm(') < src.indexOf('api.unfollow('));
});
