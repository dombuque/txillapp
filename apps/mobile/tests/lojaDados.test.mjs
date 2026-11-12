import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

test('as lojas têm endereços estáveis e sem sessão: /privacidade, /termos, /suporte e /apagar-conta', () => {
  for (const f of ['privacidade', 'termos', 'suporte', 'apagar-conta']) assert.ok(existsSync(new URL(`../src/app/${f}.tsx`, import.meta.url)), f);
  assert.match(read('app/privacidade.tsx'), /export \{ default \} from '\.\/privacy'/);
  assert.match(read('app/termos.tsx'), /export \{ default \} from '\.\/terms'/);
  assert.match(read('app/suporte.tsx'), /export \{ default \} from '\.\/help'/);
  const routes = read('lib/publicRoutes.ts');
  for (const s of ['terms', 'termos', 'privacy', 'privacidade', 'help', 'suporte', 'apagar-conta', 'c']) assert.match(routes, new RegExp(`'${s}'`), s);
  // O Gate deixa passar sem sessão tudo o que está na lista (e também sem ligação ao servidor).
  const layout = read('app/_layout.tsx');
  assert.match(layout, /const onPublic = isPublicSegment\(segments\[0\]\);/);
  assert.match(layout, /if \(offline && !isPublicSegment\(segments\[0\]\)\)/);
});

test('apagar a conta sem sessão: pede o email, manda a ligação e só apaga depois de confirmar na página da ligação', () => {
  const page = read('app/apagar-conta.tsx');
  assert.match(page, /emailApi\.requestDeletion\(email\.trim\(\)\)/);
  assert.match(page, /emailApi\.deletionPreview\(token\)/);
  // A confirmação só acontece no botão, nunca ao abrir a ligação (os leitores de email abrem as ligações sozinhos).
  const confirmCalls = page.match(/emailApi\.confirmDeletion\(/g) ?? [];
  assert.equal(confirmCalls.length, 1);
  assert.match(page, /async function confirm\(\) \{[\s\S]*emailApi\.confirmDeletion\(token\)/);
  assert.match(page, /DELETION_STEPS\.map/);
  const api = read('lib/api.email.ts');
  assert.match(api, /'\/auth\/delete-account\/request'/);
  assert.match(api, /'\/auth\/delete-account\/preview'/);
  assert.match(api, /'\/auth\/delete-account\/confirm'/);
});

test('os passos da página batem certo com o ecrã de Definições → Conta', () => {
  const steps = read('lib/accountDeletion.ts');
  const conta = read('app/settings/conta.tsx');
  assert.match(conta, /title="Zona perigosa"/);
  assert.match(conta, /title="Eliminar conta"/);
  assert.match(steps, /«Zona perigosa»/);
  assert.match(steps, /«Eliminar conta»/);
  assert.match(read('components/settings/sheets.tsx'), /Eliminar a minha conta/);
  assert.match(steps, /«Eliminar a minha conta»/);
  assert.match(read('components/ProfileView.tsx'), /accessibilityLabel="Definições e privacidade"/);
  assert.match(read('components/Landing.tsx'), /'\/apagar-conta'/);
});
