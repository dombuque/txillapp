// Entrar, criar conta, repor a senha e confirmar o email (src/app/login.tsx, register.tsx, reset-password.tsx,
// verify-email.tsx): o "seguinte" do teclado leva ao campo seguinte, os botões não aceitam dois toques, os textos falam
// por "tu" como o resto da app e no computador o logótipo não aparece duas vezes.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(ROOT, 'src', 'app', f), 'utf8');

test('entrar: o aviso de campos vazios fala por "tu" e a ligação "Esqueceste a senha?" tem toque de 44 px', () => {
  const src = read('login.tsx');
  assert.doesNotMatch(src, /Por favor preencha/);
  assert.match(src, /Escreve o teu @ \(ou email\) e a senha/);
  assert.match(src, /forgot: \{[^}]*paddingVertical: 12/);
  assert.match(src, /onSubmitEditing=\{\(\) => pass\.current\?\.focus\(\)\}\s*submitBehavior="submit"/);
});

test('criar conta: um só replace (o do Gate) e o botão não volta a acender depois de criar', () => {
  const src = read('register.tsx');
  const next = src.slice(src.indexOf('async function next()'), src.indexOf('function back()'));
  assert.doesNotMatch(next, /router\.replace\('\/'\)/);
  assert.doesNotMatch(next, /finally/);
  assert.match(next, /if \(busy\) return;/);
});

test('repor a senha: "seguinte" vai para o segundo campo, sem dois envios e com aviso de link incompleto', () => {
  const src = read('reset-password.tsx');
  assert.match(src, /onSubmitEditing=\{\(\) => second\.current\?\.focus\(\)\}/);
  assert.match(src, /ref=\{second\}/);
  assert.match(src, /if \(busy \|\| done\) return;/);
  assert.match(src, /Este link está incompleto/);
});

test('no computador o logótipo só aparece no painel da marca', () => {
  for (const f of ['reset-password.tsx', 'verify-email.tsx', 'forgot-password.tsx']) {
    assert.match(read(f), /\{wide \? null : <View style=\{\{ paddingTop: 40 \}\} accessibilityRole="header"><Wordmark/, f);
  }
});
