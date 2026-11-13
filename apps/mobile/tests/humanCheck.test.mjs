// Prova de humano (Cloudflare Turnstile) e as respostas da segurança do servidor (src/lib/humanCheck.ts), mais as ligações
// nos ecrãs de entrar, criar conta e «Esqueci-me da senha». Sem a chave do site, nada muda; se o widget falhar, o pedido
// segue sem código (o servidor decide).
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const h = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'humanCheck.ts')).href);
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');

test('a chave do site: sem ela (ou com lixo) a prova fica desligada', () => {
  assert.equal(h.turnstileSiteKey(undefined), null);
  assert.equal(h.turnstileSiteKey(''), null);
  assert.equal(h.turnstileSiteKey('  '), null);
  assert.equal(h.turnstileSiteKey('<script>'), null);
  assert.equal(h.turnstileSiteKey('1x00000000000000000000AA'), '1x00000000000000000000AA'); // a chave de teste oficial
  assert.equal(h.turnstileSiteKey(' 0x4AAAAAAABkMYinukE8nzY \n'), '0x4AAAAAAABkMYinukE8nzY');
});

test('o identificador da instalação: aleatório, no formato que o servidor aceita', () => {
  const rnd = (n) => Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 255);
  const id = h.newInstallId(rnd);
  assert.equal(id.length, 32);
  assert.ok(h.isInstallId(id));
  assert.notEqual(h.newInstallId(() => new Uint8Array(32).fill(1)), id);
  assert.equal(h.isInstallId('curto'), false);
  assert.equal(h.isInstallId('x'.repeat(65)), false);
  assert.equal(h.isInstallId('com espaços e acentos á'.padEnd(20, 'a')), false);
  assert.equal(h.isInstallId(null), false);
});

test('o servidor pediu a prova de humano só com 403 human_check', () => {
  assert.equal(h.needsHumanCheck({ status: 403, code: 'human_check' }), true);
  assert.equal(h.needsHumanCheck({ status: 403, code: 'email_not_verified' }), false);
  assert.equal(h.needsHumanCheck({ status: 401 }), false);
  assert.equal(h.needsHumanCheck(null), false);
});

test('os textos: bloqueios e limites com a mensagem do servidor; o resto em português', () => {
  const locked = { status: 429, code: 'login_locked', message: 'Muitas tentativas falhadas nesta conta. Espera 15 minutos ou recupera a senha em «Esqueci-me da senha».' };
  assert.equal(h.securityErrorText(locked, 'login'), locked.message);
  for (const code of ['login_ip_locked', 'register_limit', 'email_check_limit', 'disposable_email', 'risk_limited']) {
    assert.equal(h.securityErrorText({ status: 400, code, message: 'texto do servidor' }, 'register'), 'texto do servidor');
  }
  assert.match(h.securityErrorText({ status: 403, code: 'human_check', message: 'x' }, 'register'), /pessoa/);
  assert.match(h.securityErrorText({ status: 503, code: 'busy' }, 'login'), /muita gente/);
  // O limite geral por minuto responde em inglês: nunca aparece «Too Many Requests».
  const tooMany = h.securityErrorText({ status: 429, message: 'ThrottlerException: Too Many Requests' }, 'login');
  assert.doesNotMatch(tooMany, /Too Many/);
  assert.match(tooMany, /Espera/);
  assert.equal(h.securityErrorText({ status: 401, message: 'Credenciais inválidas' }, 'login'), 'Hmm, essas credenciais não batem');
  assert.equal(h.securityErrorText({ status: 401, message: 'Outra coisa' }, 'forgot'), 'Outra coisa');
  assert.match(h.securityErrorText(null, 'login'), /Tenta outra vez/);
  assert.equal(h.registerStepFor({ code: 'disposable_email' }), 'email');
  assert.equal(h.registerStepFor({ code: 'register_limit' }), null);
});

test('as mensagens da WebView: só as conhecidas, e o código com um tamanho razoável', () => {
  assert.deepEqual(h.parseTurnstileMessage(JSON.stringify({ type: 'token', token: 'XXXX.DUMMY.TOKEN.XXXX' })), { type: 'token', token: 'XXXX.DUMMY.TOKEN.XXXX' });
  assert.equal(h.parseTurnstileMessage(JSON.stringify({ type: 'token', token: 'x' })), null);
  assert.equal(h.parseTurnstileMessage(JSON.stringify({ type: 'token' })), null);
  assert.deepEqual(h.parseTurnstileMessage('{"type":"interactive"}'), { type: 'interactive' });
  assert.equal(h.parseTurnstileMessage('{"type":"outra"}'), null);
  assert.equal(h.parseTurnstileMessage('não é json'), null);
});

test('a página do widget na app nativa: o script da Cloudflare, a chave e o modo invisível', () => {
  const html = h.turnstileHtml('1x00000000000000000000AA');
  assert.match(html, /challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?render=explicit/);
  assert.match(html, /sitekey: "1x00000000000000000000AA"/);
  assert.match(html, /appearance: 'interaction-only'/);
  assert.match(html, /ReactNativeWebView\.postMessage/);
  // A chave vai como texto JSON: não parte o script.
  assert.match(h.turnstileHtml('a"b'), /sitekey: "a\\"b"/);
});

test('os ecrãs: o código só vai quando há, e o login repete uma vez depois do 403 human_check', () => {
  const api = read('src/lib/api.ts');
  assert.match(api, /'X-Turnstile-Token': token/);
  assert.match(api, /'X-Install-Id': iid/);
  assert.match(api, /call\('\/auth\/login', \{ \.\.\.post\(\{ identifier, password \}\), headers: humanHeader\(turnstileToken\) \}/);
  const login = read('src/app/login.tsx');
  assert.match(login, /needsHumanCheck\(x\)\) throw x;\s*await signIn\(who, password, await human\.getToken\(\)\)/);
  assert.match(login, /\{human\.node\}/);
  const reg = read('src/app/register.tsx');
  assert.match(reg, /await signUp\(body, await human\.getToken\(\)\)/);
  assert.match(reg, /registerStepFor\(x\) === 'email'/);
  const forgot = read('src/app/forgot-password.tsx');
  assert.match(forgot, /api\.forgotPassword\(email\.trim\(\), await human\.getToken\(\)\)/);
  // O widget falha sem rebentar: getToken nunca lança, só devolve undefined.
  for (const f of ['src/components/HumanCheck.tsx', 'src/components/HumanCheck.web.tsx']) {
    const c = read(f);
    assert.match(c, /if \(!SITE_KEY\) return Promise\.resolve\(undefined\)/, f);
    assert.match(c, /finish\(undefined\)/, f);
    assert.match(c, /useSiteKey\(\)/, f);
  }
  // A chave do site: a da compilação, por extenso (o Expo só a põe assim), ou a que o servidor dá no /auth/config.
  const key = read('src/lib/turnstileKey.ts');
  assert.match(key, /process\.env\.EXPO_PUBLIC_TURNSTILE_SITEKEY/);
  assert.match(key, /c\.turnstileSiteKey/);
});
