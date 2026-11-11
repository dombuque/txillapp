// Segurar uma bolha abre SEMPRE o menu da mensagem, seja qual for o tipo (texto, foto, vídeo, voz, sticker, localização
// fixa e em direto, presente, GIF, publicação partilhada, chamada, resposta a mimo/Zás, visualização única, sondagem, apagada).
// No React Native e no react-native-web quem fica com o toque é o Pressable mais fundo: um Pressable de dentro sem
// onLongPress (o mapa da localização, a foto, a publicação...) "comia" o segurar e o menu não abria. Este teste lê o
// código e garante que cada Pressable de dentro das bolhas leva o segurar da bolha (`{...hold}`, de components/bubbleHold).
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(ROOT, 'src', f), 'utf8').replace(/\r\n/g, '\n');
const BUBBLES = read('components/ChatBubbles.tsx');

/** O corpo de `function Nome(` até à função seguinte do ficheiro (as funções de topo começam na coluna 0). */
function body(src, name) {
  const re = new RegExp(`^(export )?function ${name}\\(`, 'm');
  const m = re.exec(src);
  assert.ok(m, `falta a função ${name}`);
  const rest = src.slice(m.index + 1);
  const next = /^(export )?(function|const|type|interface) /m.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

/** Cada `<Pressable` tem de levar o segurar da bolha logo à cabeça (`{...hold}`, depois de um `key` se houver) ou um onLongPress. */
function pressablesWithoutHold(code) {
  const bad = [];
  const re = /<Pressable\b/g;
  let m;
  while ((m = re.exec(code))) {
    const head = code.slice(m.index, m.index + 260);
    const ok = /^<Pressable(\s+key=\{[^}]*\})?\s+\{\.\.\.hold\}/.test(head) || /^<Pressable[^>]*?onLongPress=/.test(head);
    if (!ok) bad.push(head.split('\n').slice(0, 2).join(' ').slice(0, 120));
  }
  return bad;
}

// O que cada tipo de mensagem desenha dentro da bolha (e onde está o código).
const PARTS = [
  ['Bubble', BUBBLES, 'texto, foto, vídeo, sticker, localização (fixa e em direto), presente, ver uma vez, citação, reações, apagada'],
  ['VoiceMessage', BUBBLES, 'voz'],
  ['SharedPost', BUBBLES, 'publicação partilhada'],
  ['CallLine', BUBBLES, 'chamada'],
  ['QuotedMedia', BUBBLES, 'resposta a mimo/Zás'],
  ['PollView', read('components/groups/PollCard.tsx'), 'sondagem (nos TxillGroups)'],
];

for (const [name, src, what] of PARTS) {
  test(`${name} (${what}): todos os Pressable passam o segurar da bolha`, () => {
    const code = body(src, name);
    if (name !== 'Bubble') assert.match(code, /const hold = useBubbleHold\(\)/, `${name} tem de ler o segurar da bolha`);
    assert.deepEqual(pressablesWithoutHold(code), []);
  });
}

test('a bolha: o Pressable de fora segura, dá o contexto ao conteúdo e cobre cada tipo de mensagem', () => {
  const b = body(BUBBLES, 'Bubble');
  assert.match(b, /const hold: BubbleHold = real \? \{ onLongPress: openMenu, delayLongPress: HOLD_MS \} : \{\}/);
  assert.match(b, /<BubbleHoldCtx\.Provider value=\{hold\}>\{content\}<\/BubbleHoldCtx\.Provider>/);
  // A web também abre o menu ao segurar em qualquer ponto da mensagem (e com o botão direito do rato).
  assert.match(b, /onMenu=\{real \? openMenu : undefined\}/);
  // Cada tipo tem o seu ramo (e nenhum fica de fora do Pressable da bolha, que envolve `content`).
  for (const k of ["m.kind === 'gift'", "m.kind === 'sticker'", "m.kind === 'gif'", "m.kind === 'post'", "m.kind === 'location'", "=== 'poll'", "m.kind === 'call'", "m.kind === 'voice'", "m.kind === 'image' || m.kind === 'video'", "m.kind === 'story_reaction'", "m.kind === 'zas_reply'", 'm.viewOnce', 'if (gone)']) {
    assert.ok(b.includes(k), `falta o ramo ${k}`);
  }
});

test('a bolha de localização (se estiver num componente à parte) também abre o menu ao segurar', () => {
  const f = path.join(ROOT, 'src/components/LocationBubble.tsx');
  if (!existsSync(f)) return; // ainda está dentro da Bubble (coberta acima)
  const code = readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
  assert.deepEqual(pressablesWithoutHold(code), []);
});

test('o texto da bolha só é selecionável com rato (no telemóvel, segurar abria a seleção em vez do menu)', () => {
  assert.match(BUBBLES, /<Text selectable=\{SELECTABLE\}/);
  assert.doesNotMatch(BUBBLES, /<Text selectable[ >]/);
  assert.match(BUBBLES, /const SELECTABLE = Platform\.OS === 'web' && .*\(pointer: fine\)/);
});

test('web: a mensagem não tem a seleção nem o menu do Safari e tem o seu próprio segurar e o botão direito', () => {
  const rs = read('components/ReplySwipe.tsx');
  assert.match(rs, /webkitTouchCallout = 'none'/);
  assert.match(rs, /webkitUserSelect = 'none'/);
  assert.match(rs, /setTimeout\(\(\) => \{\s*hold = null;\s*held = true;\s*on\.current\.onMenu\?\.\(\);\s*\}, HOLD_MS\)/);
  assert.match(rs, /addEventListener\('contextmenu', context\)/);
  // Antes de o gesto ser de responder não há preventDefault (o browser e o toque longo ficam como estão).
  const move = rs.slice(rs.indexOf('const move = (e: TouchEvent) =>'), rs.indexOf('const end = () =>'));
  assert.ok(move.indexOf("g.mode = 'reply'") < move.indexOf('e.preventDefault()'));
});

test('a bolha do GIF não tem Pressable próprio: tocar e segurar são os da bolha (menu, hora, brindar)', () => {
  const code = body(BUBBLES, 'GifBubble');
  assert.doesNotMatch(code, /<Pressable\b/);
  assert.match(code, /accessibilityLabel=\{gifLabel\(gif\.title\)\}/);
  // "Reduzir movimento": parado.
  assert.match(code, /autoplay=\{!reduce\}/);
});
