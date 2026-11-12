// Regras das lojas para pagamentos e conteúdo das pessoas (src/lib/storeRules.ts; docs/lojas/pagamentos-e-ugc.md):
// nas versões das lojas (play, appstore) não se compra nada digital por fora da loja, e todo o conteúdo se denuncia.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { helpFaqFor, hiddenSettingsFor, isStoreChannel, paymentsSubtitleFor, purchaseRulesFor } from '../src/lib/storeRules.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(path.join(ROOT, 'src', ...p), 'utf8').replace(/\r\n/g, '\n');
function files(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}

test('nas lojas não se recarregam Txills nem se paga o Bombar; no site e no APK beta fica tudo', () => {
  for (const c of ['play', 'appstore']) {
    assert.equal(isStoreChannel(c), true);
    assert.deepEqual(purchaseRulesFor(c), { buyTxills: false, buyBoosts: false }, c);
  }
  for (const c of ['beta', 'web']) {
    assert.equal(isStoreChannel(c), false);
    assert.deepEqual(purchaseRulesFor(c), { buyTxills: true, buyBoosts: true }, c);
  }
});

test('nas lojas as Definições escondem «Pedidos e pagamentos» (também na pesquisa) e o subtítulo não fala de recargas', () => {
  const store = purchaseRulesFor('appstore');
  const web = purchaseRulesFor('web');
  assert.deepEqual(hiddenSettingsFor(store), ['orders']);
  assert.deepEqual(hiddenSettingsFor(web), []);
  assert.equal(paymentsSubtitleFor(store, 'Carteira, pedidos e recargas'), 'Carteira e presentes');
  assert.equal(paymentsSubtitleFor(web, 'Carteira, pedidos e recargas'), 'Carteira, pedidos e recargas');
});

test('a Ajuda nas lojas não manda recarregar nem bombar; no site fica igual', () => {
  const faq = [
    { q: 'Como ganho Txills?', a: 'Ao criar a conta recebes 500 Txills. Também podes recarregar em Definições, Txills e pagamentos, "Pedidos e pagamentos".' },
    { q: 'Como bombo o meu local?', a: 'Em Gerir, Bombar.' },
    { q: 'Como presenteio alguém?', a: 'Abre o perfil.' },
  ];
  const store = helpFaqFor(purchaseRulesFor('play'), faq);
  assert.deepEqual(store.map((f) => f.q), ['Como ganho Txills?', 'Como presenteio alguém?']);
  assert.equal(store[0].a, 'Ao criar a conta recebes 500 Txills.');
  assert.deepEqual(helpFaqFor(purchaseRulesFor('web'), faq), faq);
  // A pergunta e a frase verdadeiras da Ajuda são as que o filtro apanha.
  const help = read('app', 'help.tsx');
  assert.match(help, /helpFaqFor\(PURCHASES, FAQ\)/);
  assert.match(help, /Também podes recarregar em Definições[^.]*\./);
  assert.match(help, /q: 'Como bombo o meu local\?'/);
});

test('os ecrãs de compra não aparecem nas lojas: /orders vai para a carteira, sem linha nas Definições nem «carrega a carteira»', () => {
  const orders = read('app', 'orders.tsx');
  assert.match(orders, /if \(!PURCHASES\.buyTxills\) return <Redirect href=\{'\/wallet' as never\} \/>;/);
  assert.match(read('app', 'settings', 'pagamentos.tsx'), /PURCHASES\.buyTxills \? <SettingRow anchor="orders"/);
  const home = read('components', 'settings', 'SettingsHome.tsx');
  assert.match(home, /hiddenSettingsFor\(PURCHASES\)/);
  assert.match(home, /paymentsSubtitleFor\(PURCHASES, g\.subtitle\)/);
  assert.match(read('components', 'groups', 'PotPanel.tsx'), /PURCHASES\.buyTxills \? 'Não tens Txills suficientes\. Carrega a carteira primeiro\.' : 'Não tens Txills suficientes\.'/);
  // O Bombar nas lojas: sem campanha nova (só ver e parar as que existem).
  const boost = read('components', 'boost', 'VenueBoost.tsx');
  assert.match(boost, /if \(!PURCHASES\.buyBoosts\) \{/);
  const gated = boost.slice(boost.indexOf('if (!PURCHASES.buyBoosts) {'), boost.indexOf('return (\n    <View style={{ paddingHorizontal: 16, gap: 12 }}>\n      <View style={st.intro}>'));
  assert.doesNotMatch(gated, /boostsApi\.create|Nova campanha|Brevemente/);
  // Ninguém mais leva a /orders (a única ligação é a das Definições, já condicionada).
  const links = files(path.join(ROOT, 'src')).filter((f) => /['"`]\/orders['"`?]/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(links.map((f) => path.relative(path.join(ROOT, 'src'), f).split(path.sep).join('/')).sort(), ['app/settings/pagamentos.tsx', 'lib/settingsIndex.ts']);
});

test('denuncia-se tudo o que os outros veem: publicações, comentários, mimos e os seus comentários, Zás, mensagens, perfis e locais', () => {
  const api = read('lib', 'api.ts');
  const type = /export type ReportType = ([^;]+);/.exec(api)[1];
  for (const t of ['post', 'comment', 'story', 'story_comment', 'instant', 'user', 'message', 'venue']) assert.match(type, new RegExp(`'${t}'`), t);
  const uses = {
    post: ['components', 'PostSheets.tsx'],
    comment: ['components', 'CommentsSheet.tsx'],
    story: ['app', 'stories', '[username].tsx'],
    story_comment: ['components', 'StoryParts.tsx'],
    instant: ['components', 'Instants.tsx'],
    message: ['components', 'ChatParts.tsx'],
    user: ['components', 'ProfileView.tsx'],
    venue: ['app', 'v', '[slug].tsx'],
  };
  for (const [t, file] of Object.entries(uses)) assert.match(read(...file), new RegExp(`<ReportSheet\\s+type="${t}"`), `${t} em ${file.join('/')}`);
  // A API pede o id (uuid) da conta: pelo @ a denúncia do perfil falhava sempre.
  const profile = read('components', 'ProfileView.tsx');
  assert.match(profile, /<ReportSheet type="user" id=\{p\.id\}/);
  assert.doesNotMatch(profile, /<ReportSheet type="user" id=\{p\.username\}/);
  assert.match(read('app', 'v', '[slug].tsx'), /<ReportSheet type="venue" id=\{v\.id\}/);
  // O que se denunciou sai logo do ecrã de quem denunciou.
  for (const [t, file] of Object.entries(uses)) if (t !== 'user' && t !== 'venue') assert.match(read(...file), new RegExp(`<ReportSheet\\s+type="${t}"[^>]*onReported=`), `onReported em ${t}`);
});

test('a folha de denúncia avisa que se analisa em 24 horas e chama onReported só depois de enviada', () => {
  const s = read('components', 'ReportSheet.tsx');
  assert.match(s, /menos de 24 horas/);
  assert.match(s, /await api\.report\(type, id, reason, note\.trim\(\) \|\| undefined\);\n\s+setDone\(true\);\n\s+onReported\?\.\(\);/);
});
