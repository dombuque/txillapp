// O Android fecha a app inteira se um `accessibilityRole` tiver um valor que ele não conhece (ex.: "status":
// "Invalid accessibility role value: status" — foi o que fechava a app ao publicar, na faixa de progresso).
// Para papéis ARIA (status, navigation, dialog…) usa-se `role=`, que no Android é ignorado em vez de rebentar.
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Os valores que o Android aceita, lidos do próprio React Native (enum AccessibilityRole). */
function androidRoles() {
  const kt = path.join(ROOT, 'node_modules/react-native/ReactAndroid/src/main/java/com/facebook/react/uimanager/ReactAccessibilityDelegate.kt');
  const fallback = 'none button dropdownlist togglebutton link search image imagebutton keyboardkey text adjustable summary header alert checkbox combobox menu menubar menuitem progressbar radio radiogroup scrollbar spinbutton switch tab tabbar tablist timer list grid pager scrollview horizontalscrollview viewgroup webview drawerlayout slidingdrawer iconmenu toolbar';
  if (!existsSync(kt)) return new Set(fallback.split(' '));
  const src = readFileSync(kt, 'utf8');
  const body = src.slice(src.indexOf('enum class AccessibilityRole'));
  const list = body.slice(body.indexOf('{') + 1, body.indexOf(';'));
  return new Set(list.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
}

function files(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|jsx?)$/.test(n) && !/\.web\.[jt]sx?$/.test(n) ? [p] : [];
  });
}

test('nenhum accessibilityRole usa um valor que fecha a app no Android', () => {
  const ok = androidRoles();
  assert.ok(ok.has('button') && ok.has('header') && !ok.has('status'));
  const bad = [];
  const re = [
    /accessibilityRole=\{?\s*(?:[^'"{}<>]*?\?\s*)?['"]([a-zA-Z]+)['"](?:\s*:\s*['"]([a-zA-Z]+)['"])?/g,
    /accessibilityRole:\s*['"]([a-zA-Z]+)['"]/g,
  ];
  for (const f of files(path.join(ROOT, 'src'))) {
    const src = readFileSync(f, 'utf8');
    for (const r of re) {
      for (const m of src.matchAll(r)) {
        for (const v of [m[1], m[2]].filter(Boolean)) {
          if (!ok.has(v.toLowerCase())) bad.push(`${path.relative(ROOT, f)}: accessibilityRole "${v}"`);
        }
      }
    }
  }
  assert.deepEqual(bad, []);
});
