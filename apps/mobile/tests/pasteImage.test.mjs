// Testes de colar ou arrastar uma imagem para a caixa de mensagem (src/lib/pasteImage.ts): achar a imagem num
// DataTransfer, deixar o texto colado em paz, avisar do que o servidor não aceita e não tratar a mesma imagem duas vezes
// (o iPhone pode mandar `paste` e `beforeinput` para o mesmo "Colar das capturas de ecrã").
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const p = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'pasteImage.ts')).href);

const file = (type, size = 1234, name = 'image.png') => ({ type, size, name });
const item = (f, kind = 'file') => ({ kind, type: f.type, getAsFile: () => f });
const textItem = (type = 'text/plain') => ({ kind: 'string', type, getAsFile: () => null });
/** Um DataTransfer falso: `data` são os textos (por tipo), `items` e `files` como no browser. */
function dt({ items = [], files = [], data = {}, types } = {}) {
  return {
    items,
    files,
    types: types ?? [...Object.keys(data), ...(files.length || items.some((i) => i.kind === 'file') ? ['Files'] : [])],
    getData: (t) => data[t] ?? '',
  };
}

test('uma captura de ecrã colada (image/png nos items) é a imagem', () => {
  const png = file('image/png');
  const got = p.imageFromTransfer(dt({ items: [item(png)], files: [png] }));
  assert.equal(got.file, png);
  assert.equal(got.type, 'image/png');
});

test('só em files (sem items) também se acha', () => {
  const jpg = file('image/jpeg', 50, 'foto.jpg');
  assert.equal(p.imageFromTransfer(dt({ files: [jpg] })).file, jpg);
});

test('texto colado: não há imagem e o browser cola o texto como hoje', () => {
  assert.equal(p.imageFromTransfer(dt({ items: [textItem()], data: { 'text/plain': 'olá malta' } })), null);
  assert.equal(p.imageFromTransfer(dt({ data: { 'text/html': '<b>x</b>' }, items: [textItem('text/html')] })), null);
  assert.equal(p.imageFromTransfer(null), null);
  assert.equal(p.imageFromTransfer(undefined), null);
  assert.equal(p.imageFromTransfer(dt()), null);
});

test('texto e imagem juntos (Excel, Word, Notas): ganha o texto ao colar', () => {
  const png = file('image/png');
  const x = dt({ items: [textItem(), item(png)], files: [png], data: { 'text/plain': 'A1\tB1' } });
  assert.equal(p.imageFromTransfer(x), null);
  // Ao arrastar um ficheiro, o ficheiro conta sempre.
  assert.equal(p.imageFromTransfer(x, { preferText: false }).file, png);
});

test('texto só com espaços não tira a imagem', () => {
  const png = file('image/png');
  assert.equal(p.imageFromTransfer(dt({ items: [item(png)], data: { 'text/plain': '  \n' } })).file, png);
});

test('"Copiar imagem" do browser (html + ficheiro, sem texto simples) dá a imagem', () => {
  const png = file('image/png');
  assert.equal(p.imageFromTransfer(dt({ items: [textItem('text/html'), item(png)], data: { 'text/html': '<img src=x>' } })).file, png);
});

test('um ficheiro que não é imagem, ou vazio, não conta', () => {
  const pdf = file('application/pdf', 99, 'a.pdf');
  assert.equal(p.imageFromTransfer(dt({ items: [item(pdf)], files: [pdf] })), null);
  const empty = file('image/png', 0);
  assert.equal(p.imageFromTransfer(dt({ items: [item(empty)], files: [empty] })), null);
  const broken = { kind: 'file', type: 'image/png', getAsFile: () => { throw new Error('já não'); } };
  assert.equal(p.imageFromTransfer(dt({ items: [broken] })), null);
});

test('um GIF continua GIF (não se converte)', () => {
  const gif = file('image/gif', 2000, 'gato.gif');
  const got = p.imageFromTransfer(dt({ files: [gif] }), { preferText: false });
  assert.equal(got.type, 'image/gif');
  assert.equal(got.file, gif);
});

test('ficheiro sem tipo: fica o tipo do item', () => {
  const f = file('', 10);
  const got = p.imageFromTransfer(dt({ items: [{ kind: 'file', type: 'image/PNG', getAsFile: () => f }] }));
  assert.equal(got.type, 'image/png');
});

test('o que o servidor não aceita avisa-se logo', () => {
  assert.equal(p.pastedImageProblem({ type: 'image/png', file: file('image/png') }), null);
  assert.equal(p.pastedImageProblem({ type: 'image/jpeg', file: file('image/jpeg') }), null);
  assert.equal(p.pastedImageProblem({ type: 'image/webp', file: file('image/webp') }), null);
  assert.match(p.pastedImageProblem({ type: 'image/gif', file: file('image/gif') }), /GIF/);
  assert.match(p.pastedImageProblem({ type: 'image/heic', file: file('image/heic') }), /JPEG, PNG ou WebP/);
  assert.match(p.pastedImageProblem({ type: 'image/png', file: file('image/png', p.MAX_PASTED_IMAGE_BYTES + 1) }), /8 MB/);
  assert.equal(p.pastedImageProblem({ type: 'image/png', file: file('image/png', p.MAX_PASTED_IMAGE_BYTES) }), null);
});

test('os formatos e o limite batem certo com o servidor', () => {
  const src = readFileSync(path.join(ROOT, '..', 'api', 'src', 'media', 'media.service.ts'), 'utf8');
  const allowed = /const ALLOWED = new Set\(\[([^\]]*)\]\)/.exec(src)[1].match(/'[^']+'/g).map((s) => s.slice(1, -1));
  assert.deepEqual([...allowed].sort(), [...p.SENDABLE_IMAGE_TYPES].sort());
  assert.match(src, /MAX_IMAGE_BYTES = 8 \* 1024 \* 1024/);
});

test('paste e beforeinput da mesma imagem: só a primeira conta', () => {
  const g = p.createPasteGate(1500);
  // O iPhone dá um File diferente em cada evento, com o mesmo tipo, tamanho e nome.
  const a = { type: 'image/png', file: file('image/png', 4096, 'image.png') };
  const b = { type: 'image/png', file: file('image/png', 4096, 'image.png') };
  assert.equal(g.accept(a, 1000), true);
  assert.equal(g.accept(b, 1005), false);
  assert.equal(g.accept(b, 1400), false);
  // Mais tarde, colar outra vez a mesma imagem já conta.
  assert.equal(g.accept(b, 1000 + 1500), true);
});

test('outra imagem logo a seguir conta; reset esquece', () => {
  const g = p.createPasteGate();
  assert.equal(g.accept({ type: 'image/png', file: file('image/png', 10) }, 0), true);
  assert.equal(g.accept({ type: 'image/png', file: file('image/png', 11) }, 5), true);
  assert.equal(g.accept({ type: 'image/jpeg', file: file('image/jpeg', 11) }, 6), true);
  g.reset();
  assert.equal(g.accept({ type: 'image/jpeg', file: file('image/jpeg', 11) }, 7), true);
  // Relógio para trás (não deve bloquear para sempre).
  assert.equal(g.accept({ type: 'image/jpeg', file: file('image/jpeg', 11) }, 1), true);
});

test('arrastar: só se deixa largar quando há ficheiros', () => {
  assert.equal(p.transferHasFiles(dt({ types: ['Files'] })), true);
  assert.equal(p.transferHasFiles(dt({ items: [item(file('image/png'))], types: [] })), true);
  assert.equal(p.transferHasFiles(dt({ data: { 'text/plain': 'x' } })), false);
  assert.equal(p.transferHasFiles(null), false);
});

test('as duas caixas de mensagem usam o colar e a pré-visualização; nada se envia sem Enviar', () => {
  for (const f of ['ChatComposer.tsx', 'GroupComposer.tsx']) {
    const src = readFileSync(path.join(ROOT, 'src', 'components', f), 'utf8');
    assert.match(src, /usePastedImage(<[^(]*>)?\(\{/, f);
    assert.match(src, /ref=\{paste\.ref\}/, f);
    assert.match(src, /<PastedImageSheet[^>]*onSend=\{\(c\) => void sendPasted\(c\)\}/, f);
    // A legenda escrita na pré-visualização é a que vai com a imagem.
    assert.match(src, /body: \(caption \?\? text\)\.trim\(\) \|\| undefined/, f);
    // O mesmo caminho da galeria: pick e sendPasted passam por sendMedia.
    assert.equal((src.match(/await sendMedia\(/g) ?? []).length, 2, f);
  }
  const hook = readFileSync(path.join(ROOT, 'src', 'lib', 'usePastedImage.ts'), 'utf8');
  for (const ev of ['paste', 'beforeinput', 'dragover', 'drop']) assert.match(hook, new RegExp(`addEventListener\\('${ev}'`));
  assert.match(hook, /insertFromPaste/);
  assert.doesNotMatch(hook, /uploadChatMedia|chatSend/);
  const sheet = readFileSync(path.join(ROOT, 'src', 'components', 'PastedImageSheet.tsx'), 'utf8');
  assert.match(sheet, /useState\(caption \?\? ''\)/);
  assert.match(sheet, /placeholder="Adicionar uma legenda…"/);
});
