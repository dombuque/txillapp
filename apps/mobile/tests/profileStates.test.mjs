// O perfil (components/ProfileView.tsx), seguidores / a seguir (app/u/[username]/connections.tsx) e o QR do perfil
// (components/ProfileQrSheet.tsx): sem rede há "Tentar outra vez" (não "Essa pessoa não existe"), o "voltar" funciona
// mesmo sem histórico e já está à mão enquanto o perfil carrega, bloquear não aceita dois toques, os botões da fila têm
// toque de 44 px, os textos do próprio falam por "tu" e o QR leva o logótipo oficial.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(path.join(ROOT, 'src', ...p), 'utf8');
const profile = read('components', 'ProfileView.tsx');
const conn = read('app', 'u', '[username]', 'connections.tsx');

test('perfil: 404 → "não existe"; sem rede → "Tentar outra vez"; voltar com recurso ao Início', () => {
  assert.match(profile, /if \(q\.isError && !p\)/);
  assert.match(profile, /onPress=\{\(\) => void q\.refetch\(\)\}/);
  // Voltar sem histórico vai para o Início: o goBack partilhado (lib/nav, do ramo ux-navegacao).
  assert.match(profile, /import \{ goBack \} from '@\/lib\/nav'/);
  assert.match(profile, /onPress=\{\(\) => goBack\(router\)\}/);
  assert.doesNotMatch(profile, /onPress=\{\(\) => router\.back\(\)\}/);
});

test('perfil de outra pessoa a carregar: já tem o botão de voltar e o @', () => {
  const loading = profile.slice(profile.indexOf('if (!p) {'), profile.indexOf('const blocked ='));
  assert.match(loading, /<BackButton \/>/);
  assert.match(loading, /@\{username\}/);
});

test('bloquear e desbloquear: um toque só, com erro dito em vez de engolido', () => {
  for (const fn of ['async function block()', 'async function unblock()']) {
    const body = profile.slice(profile.indexOf(fn), profile.indexOf(fn) + 600);
    assert.match(body, /if \(acting\) return;/, fn);
    assert.match(body, /Alert\.alert\('Não deu'/, fn);
  }
  assert.match(profile, /disabled=\{acting\} style=\{\[styles\.blockBtn/);
});

test('a fila de botões do perfil: toque de 44 px (36 + 4 + 4) e papel de botão', () => {
  assert.match(profile, /const ROW_SLOP = \{ top: 4, bottom: 4 \}/);
  for (const line of profile.split(/\r?\n/).filter((l) => l.includes('style={[styles.small,'))) {
    assert.match(line, /hitSlop=\{ROW_SLOP\}/);
    assert.match(line, /accessibilityRole="button"/);
  }
});

test('os números de seguidores dizem ao leitor de ecrã o que são', () => {
  assert.match(profile, /accessibilityLabel=\{`\$\{n\.toLocaleString\('pt-PT'\)\} \$\{label\}`\}/);
});

test('seguidores / a seguir: a carregar, sem rede, 404, voltar sem histórico e "segues" quando é o próprio', () => {
  assert.match(conn, /profile\.isLoading \? <ActivityIndicator/);
  assert.match(conn, /Não consegui abrir as listas/);
  assert.match(conn, /onPress=\{\(\) => goBack\(router\)\}/);
  assert.match(conn, /username === me \? 'Ainda não segues ninguém' : 'Ainda não segue ninguém'/);
  assert.match(conn, /aria-selected=\{cur === k\}/);
  assert.doesNotMatch(conn, /user!/);
});

test('o QR do perfil leva o logótipo oficial (Wordmark), como o cartão do convite', () => {
  const qr = read('components', 'ProfileQrSheet.tsx');
  assert.match(qr, /<Wordmark height=\{22\} \/>/);
  assert.doesNotMatch(qr, />txillapp<\/Text>/);
});
