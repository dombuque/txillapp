// O registo do service worker (public/register-sw.js): com o service worker bloqueado ou indisponível (modo privado,
// definições do Safari, testes com o service worker bloqueado) o registo pode vir vazio, e o reg.update() rebentava
// («Cannot read properties of undefined (reading 'update')») cada vez que a app voltava a estar à vista.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(path.join(ROOT, 'public', 'register-sw.js'), 'utf8');

/** Corre o register-sw.js com um navegador a fingir; `reg` é o que o register() devolve. */
async function run(reg, { throws = false } = {}) {
  const on = {};
  const listen = (k) => (ev, fn) => { (on[k + ev] ||= []).push(fn); };
  const errors = [];
  let updates = 0;
  const realReg = reg === 'ok' ? { update: () => { updates++; if (throws) throw new Error('x'); return Promise.resolve(); } } : reg;
  const ctx = {
    navigator: { serviceWorker: { controller: null, addEventListener: listen('sw:'), register: () => Promise.resolve(realReg) } },
    window: { addEventListener: listen('w:') },
    document: { visibilityState: 'visible', addEventListener: listen('d:') },
    location: { reload() {} },
    setInterval: () => 0,
  };
  vm.runInNewContext(SRC, ctx);
  for (const fn of on['w:load'] || []) fn();
  await new Promise((r) => setTimeout(r, 0));
  for (const k of ['d:visibilitychange', 'w:focus', 'w:pageshow']) for (const fn of on[k] || []) { try { fn(); } catch (e) { errors.push(e); } }
  return { errors, updates };
}

test('registo vazio (service worker indisponível): nada rebenta ao voltar à app', async () => {
  for (const reg of [undefined, null, {}]) {
    const r = await run(reg);
    assert.equal(r.errors.length, 0, String(reg));
  }
});

test('com registo, pergunta por versão nova ao voltar à app, e um erro do update() não sai cá para fora', async () => {
  const ok = await run('ok');
  assert.equal(ok.errors.length, 0);
  assert.equal(ok.updates, 3);
  const bad = await run('ok', { throws: true });
  assert.equal(bad.errors.length, 0);
});

test('o register-sw.js verifica o registo antes de .update()', () => {
  assert.match(SRC, /if \(!reg \|\| typeof reg\.update !== 'function'\) return;/);
});
