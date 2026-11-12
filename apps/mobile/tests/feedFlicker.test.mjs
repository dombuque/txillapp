// O feed piscava ao rolar no PWA do iPhone (src/lib/listImage.ts):
// - As fotos dos cartões (expo-image na web) eram `loading="lazy"` com fade de entrada. No Safari uma imagem lazy dentro
//   de um contentor com scroll só carrega quando já está no ecrã, e a lista virtualizada desmonta e volta a montar os
//   cartões: cada foto aparecia cinzenta e entrava a esmaecer. Agora, na web, carregam quando o cartão monta e sem fade.
// - Os vídeos (web) ficavam pretos ao arrancar sozinhos: a capa fica por cima até haver o primeiro frame.
// - A lista do Início mantém chaves estáveis (o id) e o cartão é `memo` (sem remontagens a mais).
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(path.join(ROOT, 'src', ...p), 'utf8');
const m = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'listImage.ts')).href);

test('listImageProps: na web carrega logo e sem fade; no nativo fica o fade de sempre', () => {
  assert.deepEqual(m.listImageProps('web', 150), { transition: 0, loading: 'eager' });
  assert.deepEqual(m.listImageProps('web', 150, false), { transition: 0, loading: 'lazy' });
  assert.deepEqual(m.listImageProps('ios', 150), { transition: 150 });
  assert.deepEqual(m.listImageProps('android', 120), { transition: 120 });
  assert.equal('loading' in m.listImageProps('ios', 150), false, 'o nativo não recebe loading');
});

test('as imagens dos cartões do feed usam listImageProps (nada de transition fixo nem lazy por omissão na web)', () => {
  const files = [['components', 'PostCard.tsx'], ['components', 'Avatar.tsx'], ['components', 'QuoteThread.tsx'], ['components', 'VenueCard.tsx'], ['components', 'boost', 'SponsoredCard.tsx'], ['components', 'CarouselVideo.tsx']];
  for (const f of files) {
    // No VenueCard só o logótipo (aparece no cabeçalho dos cartões); o resto é da lista dos Locais.
    const all = read(...f);
    const s = f[1] === 'VenueCard.tsx' ? all.slice(all.indexOf('export function VenueLogo'), all.indexOf('export function FollowVenueButton')) : all;
    const imgs = s.match(/<Image\b[^>]*\/>/g) ?? [];
    assert.ok(imgs.length > 0, f.join('/'));
    for (const tag of imgs) {
      // A capa do NativeVideo é só do nativo; todas as outras passam por listImageProps.
      if (/!started/.test(s.slice(Math.max(0, s.indexOf(tag) - 40), s.indexOf(tag)))) continue;
      assert.match(tag, /\{\.\.\.listImageProps\(Platform\.OS, \d+/, `${f.join('/')}: ${tag.slice(0, 90)}`);
      assert.doesNotMatch(tag, /transition=\{/, `${f.join('/')}: fade fixo`);
    }
  }
});

test('carrossel: na web a foto que se vê e a seguinte carregam logo; as outras ficam lazy', () => {
  const s = read('components', 'PostCard.tsx');
  assert.match(s, /listImageProps\(Platform\.OS, 150, index <= i \+ 1\)/);
});

test('vídeo na web: a capa fica por cima até ao primeiro frame (sem caixa preta ao arrancar)', () => {
  const s = read('components', 'CarouselVideo.tsx');
  const web = s.slice(s.indexOf('function WebVideo'), s.indexOf('function NativeVideo'));
  assert.match(web, /onTimeUpdate: \(e: \{ currentTarget: HTMLVideoElement \}\) => \{\s*if \(!framedRef\.current && e\.currentTarget\.currentTime > 0\)/);
  assert.match(web, /const coverImg = cover && !framed/);
  assert.match(web, /\{video\}\{coverImg\}/, 'tcheka (passive)');
  assert.match(web, /\{video\}\s*\{coverImg\}\s*<Overlay/, 'carrossel');
});

test('Início: chaves estáveis, cartão memo e a mesma janela de virtualização', () => {
  const feed = read('app', '(tabs)', 'index.tsx');
  assert.match(feed, /keyExtractor=\{\(p\) => p\.id\}/);
  assert.doesNotMatch(feed, /keyExtractor=\{\([^)]*index/);
  assert.doesNotMatch(feed, /removeClippedSubviews/, 'no web desmontaria ainda mais');
  assert.match(feed, /windowSize=\{7\}/);
  // As páginas novas acrescentam-se às que já estavam (sem duplicados), por ordem.
  assert.match(feed, /q\.data\?\.pages\.flatMap\(\(p\) => p\.items\)/);
  assert.match(read('components', 'PostCard.tsx'), /export const PostCard = memo\(PostCardBase\);/);
});
