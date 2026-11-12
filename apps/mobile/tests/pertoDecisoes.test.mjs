// Decisões da revisão do "À tua volta" que vivem nos ecrãs (verificadas no código-fonte, como o a11yRoles):
// a ação "Abrir" do leitor de ecrã, o "quando" que se pede, a presença ao abrir sem autorização e ao terminar sessão,
// a função morta da pesquisa do mapa e os mosaicos do chat pelo servidor do Txillapp.
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
const perto = read('src', 'app', 'perto.tsx');

/** O corpo de uma função (do nome até à função seguinte ao mesmo nível). */
function fnBody(src, name) {
  const i = src.indexOf(`function ${name}(`);
  assert.ok(i >= 0, `função ${name} não encontrada`);
  const next = src.indexOf('\nfunction ', i + 10);
  return src.slice(i, next < 0 ? undefined : next);
}

test('linhas da lista: ação "Abrir" do leitor de ecrã que abre logo; o toque normal fica', () => {
  const row = fnBody(perto, 'Row');
  assert.match(perto, /OPEN_ACTIONS[^=]*=\s*\[\{\s*name:\s*'open',\s*label:\s*'Abrir'\s*\}\]/);
  assert.match(row, /accessibilityActions=\{OPEN_ACTIONS\}/);
  assert.match(row, /onAccessibilityAction=\{\(e\)\s*=>\s*\{\s*if \(e\.nativeEvent\.actionName === 'open'\) onOpen\(\);/);
  assert.match(row, /onPress=\{onPress\}/);
  // 'activate' não se declara: se se declarasse, o duplo toque deixava de chamar o onPress.
  assert.doesNotMatch(perto, /name:\s*'activate'/);
});

test('"Tudo" pede os eventos da semana: o pedido usa whenToFetch (e a chave da cache também)', () => {
  assert.match(perto, /const fetchWhen = whenToFetch\(filter, when\);/);
  assert.match(perto, /queryKey: \['nearby', [^\]]*fetchWhen\]/);
  assert.match(perto, /nearbyApi\.around\(\{[^}]*when: fetchWhen \}\)/);
  assert.match(perto, /emptyHint\(\{ filter, when: fetchWhen,/);
});

test('ao abrir sem autorização de localização, a presença sai logo', () => {
  const i = perto.indexOf('const perm = await Location.getForegroundPermissionsAsync().catch(() => null);');
  assert.ok(i >= 0);
  const after = perto.slice(i, i + 600);
  assert.match(after, /if \(!perm\?\.granted\) void nearbyApi\.clearPresence\(\)\.catch\(\(\) => undefined\);/);
});

test('terminar sessão tira a presença antes de limpar a sessão (sem prender a saída)', () => {
  const auth = read('src', 'lib', 'auth.tsx');
  const s = auth.slice(auth.indexOf('const signOut = useCallback'));
  const leave = s.indexOf('await leaveMapOnSignOut();');
  const logout = s.indexOf('await api.logout();');
  assert.ok(leave > 0 && logout > leave, 'leaveMapOnSignOut tem de vir antes de api.logout');
  assert.match(read('src', 'lib', 'api.nearby.ts'), /export const leaveMapOnSignOut = \(\) => clearOnSignOut\(\(\) => nearbyApi\.clearPresence\(\)\);/);
});

test('a função morta nearbyApi.places (tipo errado: o servidor devolve { venues, events }) saiu', () => {
  const src = read('src', 'lib', 'api.nearby.ts');
  assert.doesNotMatch(src, /^\s*places:/m);
  assert.doesNotMatch(src, /PlaceHit/);
});

test('mosaicos: nenhum mapa da app vai direto ao tile.openstreetmap.org; o do chat usa o /tiles do Txillapp', () => {
  const files = (dir) => readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|jsx?)$/.test(n) ? [p] : [];
  });
  const direct = files(path.join(ROOT, 'src')).filter((f) => readFileSync(f, 'utf8').includes('tile.openstreetmap.org'));
  assert.deepEqual(direct.map((f) => path.relative(ROOT, f)), []);
  const runtime = read('src', 'components', 'nearby', 'mapRuntime.ts');
  assert.match(runtime, /export const TILE_URL = 'https:\/\/txillapp\.com\/tiles\/\{z\}\/\{x\}\/\{y\}\.png';/);
  assert.equal((runtime.match(/L\.tileLayer\(TILE_URL,/g) ?? []).length, 2);
  assert.match(read('src', 'components', 'nearby', 'leafletInline.ts'), /const TILE_URL = 'https:\/\/txillapp\.com\/tiles\/\{z\}\/\{x\}\/\{y\}\.png';/); // gerado de novo
  const chat = read('src', 'components', 'ChatBubbles.tsx');
  assert.match(chat, /import \{ TILE_URL \} from '@\/components\/nearby\/mapRuntime';/);
  assert.match(chat, /source=\{\{ uri: tileUri\(t\.x, t\.y\) \}\}/);
});

test('abre onde estás: com o GPS autorizado a cidade guardada só fica se o GPS não der, e o mapa centra na posição exata', () => {
  assert.match(perto, /if \(city\) \{\s*if \(perm\?\.granted && !\(await locate\(false\)\)\) return;/);
  assert.match(perto, /const at = \{ lat: pos\.coords\.latitude, lng: pos\.coords\.longitude \};/);
  assert.match(perto, /\(place\.gps && place\.at\) \|\| \{ lat: place\.lat, lng: place\.lng \}/);
});
