// O leitor de QR (src/app/qr.tsx): o que se faz com o texto lido (src/lib/qrRead.ts). Ligação do Txillapp → o ecrã
// certo dentro da app; outra ligação → pergunta-se se abre no browser; o resto → só se mostra e copia.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import './fixtures/alias.mjs'; // o alias @/ (os módulos usam t() de @/lib/i18n)
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { readQr, qrAppPath } = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'qrRead.ts')).href);

test('o QR do perfil (txillapp.com/u/…) abre o perfil dentro da app', () => {
  assert.deepEqual(readQr('https://txillapp.com/u/sara.m'), { kind: 'app', path: '/u/sara.m', label: 'Perfil de @sara.m', href: 'https://txillapp.com/u/sara.m' });
  assert.equal(readQr('https://www.txillapp.com/u/sara/').path, '/u/sara');
  assert.equal(readQr('  https://TXILLAPP.com/u/sara#x \n').path, '/u/sara');
});

test('o QR do convite (/c/CÓDIGO) abre o convite; os outros ecrãs também', () => {
  assert.deepEqual(readQr('https://txillapp.com/c/AB12CD?ref=qr'), { kind: 'app', path: '/c/AB12CD?ref=qr', label: 'Convite', href: 'https://txillapp.com/c/AB12CD?ref=qr' });
  assert.equal(readQr('https://txillapp.com/p/Ab3xK9q').label, 'Publicação');
  assert.equal(readQr('https://txillapp.com/t/maputo').label, '#maputo');
  assert.equal(readQr('https://txillapp.com/tag/praia').path, '/tag/praia');
  assert.equal(readQr('https://txillapp.com/v/bar-do-ze').label, 'Local');
  // O QR do check-in de um local leva o código no ?k=: tem de chegar ao ecrã do local.
  assert.equal(readQr('https://txillapp.com/v/bar-do-ze?k=Ab12').path, '/v/bar-do-ze?k=Ab12');
  assert.equal(readQr('https://txillapp.com/txillada/abc123').label, 'Txillada');
  assert.equal(readQr('https://txillapp.com/g/xyz').label, 'TxillGroup');
  assert.equal(readQr('https://txillapp.com/termos').path, '/termos');
  assert.deepEqual(readQr('https://txillapp.com/'), { kind: 'app', path: '/', label: 'Txillapp', href: 'https://txillapp.com/' });
});

test('sem esquema, o esquema da app e @username sozinho', () => {
  assert.equal(readQr('txillapp.com/u/sara').path, '/u/sara');
  assert.equal(readQr('txillapp://u/sara').path, '/u/sara');
  assert.equal(readQr('txillapp:///p/abc').path, '/p/abc');
  assert.deepEqual(readQr('@sara_23'), { kind: 'app', path: '/u/sara_23', label: 'Perfil de @sara_23', href: '@sara_23' });
});

test('ecrãs que não existem ou caminhos estranhos do Txillapp não abrem dentro da app', () => {
  assert.equal(readQr('https://txillapp.com/u/').kind, 'url'); // /u sem ninguém
  assert.equal(readQr('https://txillapp.com/api/feed').kind, 'url');
  assert.equal(readQr('https://txillapp.com/u/../settings').kind, 'url');
  assert.equal(qrAppPath('/u//x'), null);
  assert.equal(readQr('txillapp://admin').kind, 'text');
});

test('no site, o próprio endereço (localhost, pré-visualização) também conta como Txillapp', () => {
  assert.equal(readQr('http://localhost:8081/u/sara').kind, 'text'); // sem os anfitriões do site, o localhost não é ligação
  assert.equal(readQr('http://localhost:8081/u/sara', ['localhost:8081', 'localhost']).path, '/u/sara');
  assert.equal(readQr('https://beta.txillapp.com/u/sara', ['beta.txillapp.com']).path, '/u/sara');
});

test('outra ligação: mostra-se o endereço e pergunta-se se abre no browser', () => {
  assert.deepEqual(readQr('https://exemplo.co.mz/menu?mesa=4'), { kind: 'url', href: 'https://exemplo.co.mz/menu?mesa=4', host: 'exemplo.co.mz' });
  assert.deepEqual(readQr('www.exemplo.com/x'), { kind: 'url', href: 'https://www.exemplo.com/x', host: 'www.exemplo.com' });
  assert.equal(readQr('http://wa.me/258841234567').kind, 'url');
  // Um site com "txillapp" no nome não é o Txillapp.
  assert.equal(readQr('https://txillapp.com.mau.site/u/sara').kind, 'url');
  assert.equal(readQr('https://txillapp-login.com/u/sara').kind, 'url');
});

test('texto e esquemas que não se abrem: só se mostram (e copiam)', () => {
  assert.deepEqual(readQr('Olá! Mesa 4'), { kind: 'text', text: 'Olá! Mesa 4' });
  assert.equal(readQr('WIFI:S:Casa;T:WPA;P:segredo;;').kind, 'text');
  assert.equal(readQr('javascript:alert(1)').kind, 'text');
  assert.equal(readQr('mailto:ola@exemplo.com').kind, 'text');
  assert.equal(readQr('https://user:senha@mau.com/x').kind, 'text');
  assert.equal(readQr('ftp://exemplo.com/a').kind, 'text');
  assert.deepEqual(readQr('   '), { kind: 'text', text: '' });
  assert.equal(readQr('sara').kind, 'text'); // sem @, não se adivinha
});
