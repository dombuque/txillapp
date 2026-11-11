// Testes da nota no cabeçalho da conversa (src/lib/chatPeerNote.ts): quando o balão aparece, encolhe e o que diz.
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const t = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'chatPeerNote.ts')).href);

const NOW = Date.parse('2026-11-11T12:00:00.000Z');
const note = (over = {}) => ({ body: 'Loko angali yeso', music: null, createdAt: '2026-11-11T10:00:00.000Z', expiresAt: '2026-11-12T10:00:00.000Z', cheered: false, ...over });

test('activePeerNote: só a nota que ainda vale e que diz alguma coisa', () => {
  assert.equal(t.activePeerNote(null, NOW), null);
  assert.equal(t.activePeerNote(undefined, NOW), null);
  const n = note();
  assert.equal(t.activePeerNote(n, NOW), n);
  assert.equal(t.activePeerNote(note({ expiresAt: '2026-11-11T11:59:59.000Z' }), NOW), null);
  assert.equal(t.activePeerNote(note({ expiresAt: '2026-11-11T12:00:00.000Z' }), NOW), null);
  assert.equal(t.activePeerNote(note({ body: '  ' }), NOW), null);
  assert.ok(t.activePeerNote(note({ body: '', music: { title: 'Xigubo' } }), NOW));
});

test('peerNoteLines e peerNoteLabel: texto, ♪ e título, e o que o leitor de ecrã diz', () => {
  assert.deepEqual(t.peerNoteLines(note()), { text: 'Loko angali yeso', track: '' });
  assert.deepEqual(t.peerNoteLines(note({ music: { title: 'Xigubo' } })), { text: 'Loko angali yeso', track: '♪ Xigubo' });
  assert.deepEqual(t.peerNoteLines(note({ body: '', music: { title: ' Xigubo ' } })), { text: '', track: '♪ Xigubo' });
  assert.equal(t.peerNoteLabel('Ana', note()), 'Nota de Ana: Loko angali yeso. Abrir');
  assert.equal(t.peerNoteLabel('Ana', note({ music: { title: 'Xigubo' } })), 'Nota de Ana: Loko angali yeso, música Xigubo. Abrir');
  assert.equal(t.peerNoteLabel('Ana', note({ body: '', music: { title: 'Xigubo' } })), 'Nota de Ana: música Xigubo. Abrir');
});

test('peerNoteKey: muda com uma nota nova', () => {
  assert.equal(t.peerNoteKey(null), null);
  assert.notEqual(t.peerNoteKey(note()), t.peerNoteKey(note({ createdAt: '2026-11-11T11:00:00.000Z' })));
  assert.equal(t.peerNoteKey(note()), t.peerNoteKey(note({ cheered: true })));
});

test('noteFold: abre quando chega a nota, encolhe ao subir mais de 80 pt ou ao fim do tempo, volta ao tocar', () => {
  const k = t.peerNoteKey(note());
  let s = t.noteFold(t.NOTE_FOLD_START, { type: 'note', key: null, y: 0 });
  assert.equal(s, t.NOTE_FOLD_START, 'sem nota não muda nada');
  s = t.noteFold(s, { type: 'note', key: k, y: 0 });
  assert.equal(s.open, true);
  const seq = s.seq;
  // A mesma nota outra vez (o refetch) não mexe.
  assert.equal(t.noteFold(s, { type: 'note', key: k, y: 500 }), s);
  // Subir pouco não encolhe; mais de 80 pt encolhe.
  assert.equal(t.noteFold(s, { type: 'scroll', y: t.NOTE_FOLD_SCROLL }), s);
  const folded = t.noteFold(s, { type: 'scroll', y: t.NOTE_FOLD_SCROLL + 1 });
  assert.equal(folded.open, false);
  // Já encolhido: deslizar não faz nada; tocar volta a abrir, a contar daqui, e o relógio recomeça.
  assert.equal(t.noteFold(folded, { type: 'scroll', y: 900 }), folded);
  const again = t.noteFold(folded, { type: 'show', y: 300 });
  assert.equal(again.open, true);
  assert.equal(again.anchorY, 300);
  assert.ok(again.seq > seq);
  assert.equal(t.noteFold(again, { type: 'scroll', y: 370 }).open, true);
  assert.equal(t.noteFold(again, { type: 'scroll', y: 381 }).open, false);
  // Descer e voltar a subir conta a partir do ponto mais em baixo.
  const down = t.noteFold(again, { type: 'scroll', y: 100 });
  assert.equal(down.anchorY, 100);
  assert.equal(t.noteFold(down, { type: 'scroll', y: 181 }).open, false);
  // O tempo encolhe; o tempo com o balão já encolhido não faz nada.
  const timed = t.noteFold(again, { type: 'timeout' });
  assert.equal(timed.open, false);
  assert.equal(t.noteFold(timed, { type: 'timeout' }), timed);
});

test('noteFold: nota nova reabre; sem nota fecha e tocar não abre nada', () => {
  const a = t.noteFold(t.NOTE_FOLD_START, { type: 'note', key: 'a', y: 0 });
  const folded = t.noteFold(a, { type: 'timeout' });
  const b = t.noteFold(folded, { type: 'note', key: 'b', y: 40 });
  assert.equal(b.open, true);
  assert.equal(b.anchorY, 40);
  const gone = t.noteFold(b, { type: 'note', key: null, y: 0 });
  assert.equal(gone.open, false);
  assert.equal(gone.key, null);
  assert.equal(t.noteFold(gone, { type: 'show', y: 0 }), gone);
});
