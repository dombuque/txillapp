// Terminar sessão nas Definições (src/lib/signOutRoute.ts, components/settings/useLeave.ts e o LogoutSheet): vai logo
// para o destino certo (outra conta guardada → Início; browser → apresentação; app instalada → entrar), um só toque conta
// e o ecrã das Definições não rebenta ao desenhar-se uma última vez já sem conta.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { afterSignOutRoute } = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'signOutRoute.ts')).href);
const read = (...p) => readFileSync(path.join(ROOT, 'src', ...p), 'utf8');

test('afterSignOutRoute: outra conta → Início; browser → apresentação; app instalada ou nativa → entrar', () => {
  assert.equal(afterSignOutRoute(true, false, true), '/');
  assert.equal(afterSignOutRoute(true, true, true), '/');
  assert.equal(afterSignOutRoute(false, true, false), '/');
  assert.equal(afterSignOutRoute(false, true, true), '/login');
  assert.equal(afterSignOutRoute(false, false, true), '/login');
});

test('signOut diz se passou para outra conta (para não abrir o ecrã de entrar e voltar logo atrás)', () => {
  const auth = read('lib', 'auth.tsx');
  assert.match(auth, /signOut: \(\) => Promise<boolean>/);
  assert.match(auth, /setUser\(r\.user\);\s*return true;/);
  assert.match(auth, /setUser\(null\);\s*return false;/);
});

test('as Definições saem pelo useLeave, nunca com router.replace("/login") às cegas', () => {
  for (const f of [['components', 'settings', 'SettingsHome.tsx'], ['app', 'settings', 'conta.tsx']]) {
    const src = read(...f);
    assert.doesNotMatch(src, /signOut\(\)\.then/, f.join('/'));
    assert.match(src, /useLeave\(\)/, f.join('/'));
  }
  assert.match(read('components', 'settings', 'useLeave.ts'), /afterSignOutRoute\(switched/);
});

test('sem conta (a meio de sair) o cartão do perfil e a Conta não usam user!', () => {
  const home = read('components', 'settings', 'SettingsHome.tsx');
  const conta = read('app', 'settings', 'conta.tsx');
  assert.doesNotMatch(home, /user!/);
  assert.doesNotMatch(conta, /user!/);
  assert.match(home, /if \(!user\) return null;/);
  assert.match(conta, /if \(!user\) return null;/);
});

test('LogoutSheet: um só toque conta, mostra que está a sair e volta a deixar tentar se falhar', () => {
  const src = read('components', 'settings', 'sheets.tsx');
  const sheet = src.slice(src.indexOf('export function LogoutSheet'), src.indexOf('/** Pessoas a quem escondo'));
  assert.match(sheet, /if \(busy\) return;/);
  assert.match(sheet, /disabled=\{busy\}/);
  assert.match(sheet, /ActivityIndicator/);
  assert.match(sheet, /Não consegui terminar a sessão/);
});
