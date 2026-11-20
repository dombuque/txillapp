// Fotos num formato que o servidor não aceita (HEIC, AVIF, tipo vazio, «image/jpg») passam a JPEG antes de subir: a
// Michelle (Android) não conseguia publicar («Apenas JPEG, PNG ou WebP»).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

test('publicar: o tipo normaliza-se e o que não é JPEG/PNG/WebP é convertido', () => {
  const q = read('lib/publishQueue.ts');
  assert.match(q, /return m === 'image\/jpg' \|\| m === 'image\/pjpeg' \? 'image\/jpeg' : m;/);
  assert.match(q, /if \(!a\.video && !UPLOAD_PHOTO_MIMES\.has\(mime\)\) \{\s*const jpg = await toJpeg\(a\.uri, POST_MAX_SIDE, POST_MAX_SIDE\);/);
  assert.match(read('lib/cropToRatio.ts'), /export const UPLOAD_PHOTO_MIMES: ReadonlySet<string> = new Set\(\['image\/jpeg', 'image\/png', 'image\/webp'\]\);/);
});
