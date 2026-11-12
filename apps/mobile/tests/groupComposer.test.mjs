// A barra de escrever dos TxillGroups tem o mesmo desenho da das conversas a dois (components/ChatComposer): antes tinha
// botões de 32 pt (abaixo dos 44), "Enviar" em texto em vez da seta, outra gravação de voz e os botões eram componentes
// criados dentro do render (remontavam a cada tecla).
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const style = (src, name) => (src.match(new RegExp(`\\n  ${name}: (\\{[^\\n]*\\})(?: as object)?,?\\n`)) ?? [])[1];

test('usa os mesmos botões da barra das conversas a dois', () => {
  const g = read('src/components/GroupComposer.tsx');
  const c = read('src/components/ChatComposer.tsx');
  for (const f of ['Tool', 'SendButton', 'Pop', 'RecDot']) assert.match(c, new RegExp(`export function ${f}\\(`), `ChatComposer exporta ${f}`);
  assert.match(g, /import \{ Pop, RecDot, SendButton, Tool \} from '\.\/ChatComposer';/);
  assert.match(g, /<SendButton label="Enviar"/);
  assert.match(g, /<SendButton label="Enviar a mensagem de voz"/);
  assert.doesNotMatch(g, /const Bar = /, 'sem componentes criados dentro do render');
  assert.doesNotMatch(g, /width: 32, height: 32/, 'nada de botões de 32 pt');
});

test('a pílula, o campo e a resposta têm as mesmas medidas nas duas barras', () => {
  const g = read('src/components/GroupComposer.tsx');
  const c = read('src/components/ChatComposer.tsx');
  for (const name of ['pill', 'camera', 'input', 'reply', 'replyBar', 'replyWho', 'replyText', 'recX']) {
    assert.ok(style(c, name), `ChatComposer tem ${name}`);
    assert.equal(style(g, name), style(c, name), name);
  }
  assert.match(g, /paddingBottom: Math\.max\(14, bottom \+ 8\)/);
});

test('abrir os stickers fecha o teclado (como nas conversas a dois)', () => {
  const g = read('src/components/GroupComposer.tsx');
  assert.match(g, /if \(panel !== 'stickers'\) Keyboard\.dismiss\(\);/);
});

test('as duas barras dizem "A enviar…" enquanto a foto, o vídeo ou a voz sobem', () => {
  for (const f of ['src/components/ChatComposer.tsx', 'src/components/GroupComposer.tsx']) {
    assert.match(read(f), /: busy \? <Text style=\{(st|styles)\.busy\} accessibilityLiveRegion="polite">A enviar…<\/Text> : null\}/, f);
  }
});
