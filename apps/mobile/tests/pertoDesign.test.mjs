// O desenho do "À tua volta" (src/app/perto.tsx), verificado no código-fonte como o pertoDecisoes: os chips esbatidos nas
// pontas, o estado Visível / Invisível claro, o cartão de invisível com o que a malta vê, o vazio com desenho e caminhos,
// o esqueleto a carregar e as linhas com selo, distância e a imagem certa para cada tipo.
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const perto = readFileSync(path.join(ROOT, 'src', 'app', 'perto.tsx'), 'utf8');

/** O corpo de uma função (do nome até à função seguinte ao mesmo nível). */
function fnBody(src, name) {
  const i = src.indexOf(`function ${name}(`);
  assert.ok(i >= 0, `função ${name} não encontrada`);
  const next = src.indexOf('\nfunction ', i + 10);
  return src.slice(i, next < 0 ? undefined : next);
}

/** Os textos entre etiquetas <Text>…</Text> e os rótulos de acessibilidade (o que se vê e o que se ouve). */
const visibleStrings = (src) => [
  ...[...src.matchAll(/<Text[^>]*>([^<{]+)</g)].map((m) => m[1]),
  ...[...src.matchAll(/accessibility(?:Label|Hint)="([^"]+)"/g)].map((m) => m[1]),
];

test('filtros: a fila esbate nas pontas só onde ainda há mais (nada cortado a seco)', () => {
  const row = fnBody(perto, 'FadeRow');
  assert.match(row, /const left = x > 4;/);
  assert.match(row, /const right = w > 0 && x \+ w < cw - 4;/);
  assert.match(row, /edges\.left \? <LinearGradient/);
  assert.match(row, /edges\.right \? <LinearGradient/);
  assert.match(row, /onScroll=/);
  assert.match(row, /onContentSizeChange=/);
  // As duas filas (o que mostrar e o "quando" dos eventos) usam-na.
  assert.equal((perto.match(/<FadeRow contentContainerStyle=\{st\.chipRow\}( focus=\{chipFocus\})?>/g) ?? []).length, 2);
  // O chip escolhido junto à ponta rola para fora do esbatido.
  assert.match(perto, /if \(at\) setChipFocus\(\{ x: chipGroupX\.current \+ at\.x, w: at\.w \}\);/);
  assert.match(row, /else if \(focus\.x \+ focus\.w > x \+ w - pad\) scroll\.current\?\.scrollTo\(/);
  assert.match(perto, /chipFade: \{ position: 'absolute', top: 0, bottom: 0, width: 40 \}/);
});

test('zona: o sítio e a distância numa pastilha à parte; toca para mudar', () => {
  assert.match(perto, /<Text style=\{st\.zoneText\} numberOfLines=\{1\}>\{locating \? t\('A ver onde estás…'\) : place\.label\}<\/Text>/);
  assert.match(perto, /accessibilityLabel=\{t\('Zona: \{label\}, até \{liveRadius\} km\. Mudar o sítio ou a distância', \{ label: place\.label, liveRadius \}\)\}/);
});

test('Visível / Invisível: bolinha de estado, nome e o que o toque faz', () => {
  assert.match(perto, /backgroundColor: visible \? colors\.green600 : colors\.zinc300/);
  assert.match(perto, /accessibilityHint=\{visible \? t\('Toca para ficares invisível já'\) : t\('Toca para escolher quem te vê'\)\}/);
  // A lógica de sempre: visível fica invisível logo; invisível abre as opções.
  assert.match(perto, /onPress=\{\(\) => \(visible \? setVis\.mutate\('off'\) : setVisSheet\(true\)\)\}/);
});

test('cartão de invisível: o que a malta vê, o que vês tu, a garantia do bairro e a ação', () => {
  const card = fnBody(perto, 'VisibilityCard');
  assert.match(card, />\{t\('Estás invisível'\)\}</);
  assert.match(card, /A malta não te vê no mapa\. Tu vês tudo na mesma\./);
  assert.match(card, /Só o bairro, nunca o sítio exato/);
  assert.match(card, /onPress=\{onOpen\}[\s\S]*Aparecer à malta/);
  assert.match(card, /onPress=\{onLater\}[\s\S]*accessibilityLabel=\{t\('Agora não'\)\}/);
  // Os mesmos casos de antes: só invisível, com idade para aparecer, sem ter fechado e em Tudo ou A malta.
  assert.match(perto, /visibility === 'off' && canEnable && !hideCard && \(filter === 'all' \|\| filter === 'people'\) \?/);
});

test('vazio: desenho, título, frase curta, o botão que resolve e mais caminhos (sítio, convidar, local, tudo)', () => {
  assert.match(perto, /art=\{<RadarArt size=\{desktop \? 112 : 68\} \/>\}/);
  assert.match(perto, /extras=\{emptyExtras\(\{ filter, canEnable \}\)\.map/);
  assert.match(perto, /if \(e === 'place'\) setPlaceSheet\(true\);/);
  assert.match(perto, /else if \(e === 'invite'\) router\.push\('\/invites' as never\);/);
  assert.match(perto, /else if \(e === 'venue'\) router\.push\('\/locais' as never\);/);
  const empty = fnBody(perto, 'EmptyState');
  assert.match(empty, /minHeight|st\.extra/);
  // Toques de pelo menos 44 pt nos botões do vazio: o Button lg (52) ou md (44) no principal, md (44) nos outros caminhos.
  assert.match(empty, /<Button label=\{primary\.label\} onPress=\{primary\.onPress\} size=\{compact \? 'md' : 'lg'\}/);
  assert.match(empty, /<Button key=\{e\.key\} label=\{e\.label\} kind="secondary" size="md"/);
});

test('a carregar: esqueleto com a forma das linhas (e anunciado ao leitor de ecrã), não uma roda sozinha', () => {
  assert.match(perto, /const listEmpty = q\.isLoading \? \(\s*<SkeletonList \/>/);
  const sk = fnBody(perto, 'SkeletonList');
  assert.match(sk, /accessibilityRole="progressbar" accessibilityLabel=\{t\('A procurar o que há à tua volta'\)\}/);
  assert.match(sk, /Animated\.loop/);
  assert.match(sk, /return \(\) => loop\.stop\(\);/);
});

test('linhas: selo de verificado no nome, distância numa pastilha, anel na pessoa, calendário no evento, ícone do tipo no local', () => {
  const row = fnBody(perto, 'Row');
  assert.match(row, /<NameWithBadge name=\{item\.title\} who=\{item\.who\}/);
  assert.match(row, /st\.kmPill/);
  const thumb = fnBody(perto, 'Thumb');
  assert.match(thumb, /colors=\{\[colors\.brand, colors\.brandWarm\]\}/);
  assert.match(thumb, /st\.calTop[\s\S]*MONTHS\(\)\[d!\.getMonth\(\)\]/);
  assert.match(thumb, /VENUE_ICON\[item\.category \?\? ''\] \?\? 'map-pin'/);
  // O tipo do local vai também para o mapa (o pino com o mesmo ícone).
  assert.match(perto, /category: i\.category \?\? null, boosted: !!i\.boost/);
  assert.match(perto, /boost: v\.boosted \?\? null, category: v\.kind,/);
  // Pessoas: "Por perto há 12 min" (a posição é sempre aproximada).
  assert.match(perto, /sub: t\('Por perto \{agoText\}', \{ agoText: agoText\(u\.ago\) \}\)/);
});

test('cabeçalho da lista: quantos há e de que tipo (ícone e número) numa linha só', () => {
  const head = fnBody(perto, 'ListHead');
  assert.match(head, /KIND_ORDER\.filter\(\(k\) => by\.has\(k\)\)/);
  assert.match(head, /accessibilityLabel=\{n \? t\('\{n\} à tua volta\. \{parts\}\. \{sub\}', \{ n, parts: parts\.join\(', '\), sub \}\) : t\('À tua volta\. \{sub\}', \{ sub \}\)\}/);
});

test('computador: mapa à esquerda e a lista numa coluna de 400 px à direita', () => {
  assert.match(perto, /deskList: \{ width: 400,/);
  assert.match(perto, /<View style=\{st\.deskMap\}>/);
});

test('textos visíveis sem travessões nem emojis', () => {
  for (const s of visibleStrings(perto)) assert.doesNotMatch(s, /[–—]|\p{Extended_Pictographic}/u, s);
  assert.doesNotMatch(perto, /'[^'\n]*[–—][^'\n]*'/, 'nenhuma cadeia com travessão');
});

test('vazio no telemóvel: compacto (desenho ao lado do texto, botões numa fila) e a folha espreita um pouco mais', () => {
  assert.match(perto, /const PEEK_EMPTY = 150;/);
  assert.match(perto, /peek=\{items\.length \? PEEK_ROWS : PEEK_EMPTY\}/);
  assert.equal((perto.match(/compact=\{!desktop\}/g) ?? []).length, 2, 'o vazio e o erro');
  const body = fnBody(perto, 'PhoneBody');
  assert.match(body, /if \(wasLow\) snapTo\(snaps\(hRef\.current\)\[2\]\);/);
  const empty = fnBody(perto, 'EmptyState');
  assert.match(empty, /if \(compact\) \{/);
  assert.match(empty, /size=\{compact \? 'md' : 'lg'\} style=\{compact \? st\.emptyPrimaryC : st\.emptyPrimary\}/);
});
