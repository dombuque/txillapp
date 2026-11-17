// Abrir a app sem rede (src/lib/offlineSession.ts e src/lib/auth.tsx): um erro de rede ao confirmar a sessão não tira a
// pessoa da conta; a app abre com a conta da última vez e confirma quando a rede voltar. Só um 401 termina a sessão.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const o = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'offlineSession.ts')).href);
const e = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'chatErrors.ts')).href);
const read = (...p) => readFileSync(path.join(ROOT, 'src', ...p), 'utf8');

test('offlineUserOf: a conta guardada com id e @ (o nome, se faltar, é o @); sem id não abre assim', () => {
  assert.deepEqual(o.offlineUserOf({ id: 'u1', username: 'sara', displayName: 'Sara Machel', refreshToken: 'segredo' }), { id: 'u1', username: 'sara', displayName: 'Sara Machel' });
  assert.deepEqual(o.offlineUserOf({ id: 'u1', username: 'sara' }), { id: 'u1', username: 'sara', displayName: 'sara' });
  assert.equal(o.offlineUserOf({ username: 'sara', displayName: 'Sara' }), null);
  assert.equal(o.offlineUserOf(null), null);
});

test('sessionEnded: só o 401; rede, 5xx e erros sem resposta não terminam a sessão', () => {
  assert.equal(o.sessionEnded({ status: 401 }), true);
  for (const x of [new TypeError('Load failed'), { status: 500 }, { status: 503 }, { status: 429 }, new Error('timeout'), null]) assert.equal(o.sessionEnded(x), false);
  assert.equal(o.SESSION_RECHECK_MS, 15_000);
});

test('auth: sem rede abre com a conta da última vez, por confirmar, e confirma quando a rede volta', () => {
  const auth = read('lib', 'auth.tsx');
  assert.match(auth, /if \(!cancelled && !sessionEnded\(e\)\)/);
  assert.match(auth, /offlineUserOf\(await accounts\.current\(\)/);
  assert.match(auth, /if \(cached\) \{ setUser\(cached\); setUnconfirmed\(true\); \} else setOffline\(true\);/);
  // Voltar a confirmar: rede de volta, primeiro plano e de 15 em 15 s; o 401 termina pelo handler de sempre.
  assert.match(auth, /setInterval\(\(\) => void check\(\), SESSION_RECHECK_MS\)/);
  assert.match(auth, /addEventListener\('online', onOnline\)/);
  assert.match(auth, /setSessionExpiredHandler\(\(\) => \{[\s\S]{0,400}?setUser\(null\);\s*setUnconfirmed\(false\);/);
  // Sessão terminada pelo servidor: as mensagens à espera desta conta saem do aparelho.
  assert.match(auth, /setSessionExpiredHandler\(\(\) => \{[\s\S]{0,400}?forgetOutboxUser\(userIdRef\.current\)/);
});

test('offlineWithPending: sem resposta do servidor e com mensagens à espera, a conversa abre; 403 e 404 tapam', () => {
  assert.equal(e.offlineWithPending(new TypeError('Load failed'), 2), true);
  assert.equal(e.offlineWithPending({ status: 503 }, 1), true);
  assert.equal(e.offlineWithPending(new TypeError('Load failed'), 0), false);
  assert.equal(e.offlineWithPending({ status: 404 }, 3), false);
  assert.equal(e.offlineWithPending({ status: 403 }, 3), false);
});

test('mensagens recusadas («Não enviada») saem do aparelho ao fim de 30 dias', () => {
  const src = readFileSync(new URL('../src/lib/chatPending.ts', import.meta.url), 'utf8');
  assert.match(src, /export const FAILED_KEEP_MS = 30 \* 24 \* 3600_000;/);
  assert.match(src, /s\.state === 'failed' && Date\.now\(\) - Date\.parse\(s\.at\) > FAILED_KEEP_MS/);
});
