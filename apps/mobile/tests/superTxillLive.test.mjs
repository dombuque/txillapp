// O SuperTxill a escrever ao vivo: antes do primeiro bocado de texto «está a pensar…»; depois a bolha cresce com o texto
// que o servidor já tem (writing), com os três pontinhos no fim; quando fica pronta, é uma bolha normal.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { liveState } = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'superTxillLive.ts')).href);
const read = (p) => readFileSync(path.join(ROOT, 'src', p), 'utf8');

test('o estado: a pensar antes do texto, a escrever com a resposta a meio, nada quando está pronta', () => {
  const q = { role: 'user' };
  assert.equal(liveState([], false), 'idle');
  assert.equal(liveState([q], true), 'thinking');
  assert.equal(liveState([q, { role: 'assistant', writing: true }], true), 'writing');
  // Mesmo que o pedido ainda não tenha dito «pending», a resposta a meio conta como a escrever.
  assert.equal(liveState([q, { role: 'assistant', writing: true }], false), 'writing');
  assert.equal(liveState([q, { role: 'assistant', writing: false }], false), 'idle');
  assert.equal(liveState([q, { role: 'assistant' }], true), 'thinking'); // acabou de enviar outra
});

test('a bolha a escrever: o texto parcial com os três pontinhos no fim; o «a pensar» só antes do primeiro texto', () => {
  const panel = read('components/SuperTxillPanel.tsx');
  assert.match(panel, /m\.writing \? \(\s*<Writing key=\{m\.id\} body=\{m\.body\} \/>/);
  assert.match(panel, /<Text style=\{s\.writeText\}>\{body\}<\/Text>\s*<View style=\{s\.writeDots\} accessibilityLabel=\{t\('SuperTxill está a escrever…'\)\}><Dots \/><\/View>/);
  assert.match(panel, /\{chat\.live === 'thinking' && <Thinking \/>\}/);
  assert.match(panel, /chat\.live === 'writing' \? t\('está a escrever…'\)/);
  // Continua a perguntar de 1,5 em 1,5 s enquanto há resposta a caminho (o servidor diz pending enquanto escreve).
  assert.match(panel, /refetchInterval: \(query\) => \(query\.state\.data\?\.pending \? 1500 : false\)/);
  assert.match(read('lib/api.ai.ts'), /writing\?: boolean/);
});
