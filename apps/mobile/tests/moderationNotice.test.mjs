// Testes dos avisos da moderação nas notificações (src/lib/moderationNotice.ts): o texto, o motivo e o destino.
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const m = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'moderationNotice.ts')).href);

test('o que foi removido: publicação, tcheka, comentário, mimo e mensagem', () => {
  assert.equal(m.moderationVerb('content_removed', { type: 'post', reason: 'Spam' }).text, 'removeu a tua publicação por não cumprir as regras');
  assert.equal(m.moderationVerb('content_removed', { type: 'post', tcheka: true }).text, 'removeu a tua tcheka por não cumprir as regras');
  assert.equal(m.moderationVerb('content_removed', { type: 'comment' }).text, 'removeu o teu comentário por não cumprir as regras');
  assert.equal(m.moderationVerb('content_removed', { type: 'story' }).text, 'removeu o teu mimo por não cumprir as regras');
  assert.equal(m.moderationVerb('content_removed', { type: 'message' }).text, 'removeu a tua mensagem por não cumprir as regras');
});

test('o motivo vai por baixo; sem motivo, uma frase genérica (só na remoção)', () => {
  assert.equal(m.moderationVerb('content_removed', { type: 'post', reason: '  Burla ou spam ' }).sub, 'Motivo: Burla ou spam');
  assert.equal(m.moderationVerb('content_removed', { type: 'post' }).sub, 'Não cumpria as regras do Txillapp.');
  assert.equal(m.moderationVerb('content_restored', { type: 'post' }).sub, undefined);
  assert.equal(m.moderationVerb('moderation_warning', { type: 'comment', reason: 'Linguagem' }).text, 'deixou-te um aviso sobre o teu comentário');
  assert.equal(m.moderationVerb('moderation_warning', { type: 'comment', reason: 'Linguagem' }).sub, 'Motivo: Linguagem');
});

test('destino: só a publicação reposta abre', () => {
  assert.equal(m.moderationTarget('content_restored', { type: 'post', postId: 'p1' }), '/p/p1');
  assert.equal(m.moderationTarget('content_restored', { type: 'comment', postId: 'p1' }), null);
  assert.equal(m.moderationTarget('content_removed', { type: 'post', postId: 'p1' }), null);
  assert.equal(m.moderationTarget('moderation_warning', { type: 'post', postId: 'p1' }), null);
  assert.equal(m.isModerationKind('content_removed'), true);
  assert.equal(m.isModerationKind('cheer'), false);
});

test('o ecrã de notificações usa estes textos e não abre o perfil da equipa', () => {
  const src = readFileSync(path.join(ROOT, 'src', 'app', 'notifications.tsx'), 'utf8');
  assert.match(src, /moderationVerb\(/);
  assert.match(src, /moderationTarget\(/);
  assert.match(src, /actor\.staff|\.staff\b/);
});
