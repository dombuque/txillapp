// Ativar a conta com o código de 6 dígitos do e-mail, escrito na app (0182), logo a seguir a criar a conta.
import { test } from 'node:test';
import './fixtures/alias.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

test('o painel de ativar: código de 6 dígitos com o teclado numérico e a sugestão do sistema, confirma sozinho aos 6', () => {
  const s = read('components/ActivateSheet.tsx');
  assert.match(s, /export const codeDigits = \(s: string\): string => s\.replace\(\/\\D\/g, ''\)\.slice\(0, 6\);/);
  assert.match(s, /textContentType="oneTimeCode"/);
  assert.match(s, /autoComplete="one-time-code"/);
  assert.match(s, /if \(d\.length === 6 && !confirm\.isPending\) confirm\.mutate\(d\);/);
  // O link continua a valer: com o painel aberto, vê de 4 em 4 s se a conta já foi ativada.
  assert.match(s, /refetchInterval: open \? 4000 : false/);
  assert.match(s, /disabled=\{wait > 0\}/);
  assert.match(read('lib/api.ts'), /verifyEmailCode: \(code: string\): Promise<\{ ok: true \}> => raw\('\/auth\/email\/verify-code', post\(\{ code \}\)\)/);
});

test('criar conta abre logo o painel do código', () => {
  assert.match(read('app/register.tsx'), /setTimeout\(openActivate, 600\);/);
});

test('boas-vindas: primeiro «Segue a malta» (meta de 3), e só depois de a conta estar confirmada', () => {
  const s = read('components/WelcomeTour.tsx');
  assert.match(s, /export const FOLLOW_GOAL = 3;/);
  assert.match(s, /const \[i, setI\] = useState\(-1\);/);
  assert.match(s, /const ready = !!email\.data && \(email\.data\.verified \|\| !email\.data\.required\);/);
  assert.match(s, /queryKey: \['welcome-suggestions'\], queryFn: feedApi\.suggestions, staleTime: Infinity/);
});
