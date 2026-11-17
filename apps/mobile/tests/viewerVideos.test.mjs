// Visor em ecrã inteiro (PhotoViewer) com fotos e vídeos misturados. No iPhone do dono, uma publicação com fotos e vídeos
// abria o visor só com as fotos («1/2» quando tinha 3) e noutra foto que não a tocada: o PostCard filtrava os vídeos.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(path.join(ROOT, 'src', ...p), 'utf8');
const vm = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'viewerMedia.ts')).href);

const media = [
  { url: 'a.jpg', kind: 'image', width: 1080, height: 1350, tags: [{ username: 'ana' }] },
  { url: 'b.mp4', kind: 'video', posterUrl: 'b.jpg', width: 1080, height: 1920, durationMs: 8000 },
  { url: 'c.jpg', width: 1080, height: 1080 },
];

test('o visor recebe todos os itens, pela ordem da publicação (fotos e vídeos)', () => {
  const items = vm.viewerMedia(media);
  assert.equal(items.length, 3, 'contador «n/3», não «n/2»');
  assert.deepEqual(items.map((m) => m.url), ['a.jpg', 'b.mp4', 'c.jpg']);
  assert.deepEqual(items.map(vm.isViewerVideo), [false, true, false]);
  assert.equal(items[1].posterUrl, 'b.jpg', 'o vídeo leva a capa (cartaz enquanto carrega)');
  assert.equal(items[1].durationMs, 8000);
  assert.deepEqual(items[0].tags, [{ username: 'ana' }], 'as fotos levam as etiquetas das pessoas');
  assert.equal(items[1].tags, undefined);
  assert.deepEqual(vm.viewerMedia(null), []);
});

test('o item onde abre conta todos os itens (o vídeo tocado, a foto depois do vídeo)', () => {
  assert.equal(vm.viewerStart(1, 3), 1, 'tocar no vídeo abre no vídeo');
  assert.equal(vm.viewerStart(2, 3), 2, 'a foto depois do vídeo é a 3/3, não a 2/2');
  assert.equal(vm.viewerStart(9, 3), 2);
  assert.equal(vm.viewerStart(-1, 3), 0);
  assert.equal(vm.viewerStart(Number.NaN, 3), 0);
  assert.equal(vm.viewerStart(0, 0), 0);
});

test('PostCard: o visor recebe todos os itens e o start sem filtrar vídeos; o som segue o musicPlayback', () => {
  const s = read('components', 'PostCard.tsx');
  assert.match(s, /photos=\{viewerMedia\(viewer\.of\.media\)\}/);
  assert.match(s, /start=\{viewer\.start\}/);
  assert.match(s, /muteVideo=\{musicPlayback\(viewer\.of\)\.muteVideo\}/);
  assert.doesNotMatch(s, /filter\(\(m\) => m\.kind !== 'video'\)/, 'sem tirar os vídeos ao visor');
});

test('carrossel misto: tocar no vídeo abre o visor nesse vídeo; com o visor aberto o vídeo do feed larga o leitor', () => {
  const s = read('components', 'PostCard.tsx');
  assert.match(s, /const reel = m\.kind === 'video' && media\.length < 2;/, 'só a tcheka (vídeo sozinho) abre a Tcheka');
  assert.match(s, /onPress=\{\(\) => tap\(reel \? \(reelId \? \(\) => pushOnce\(router, `\/r\/\$\{reelId\}`\) : undefined\) : \(\) => onOpen\?\.\(index\)\)\}/);
  assert.match(s, /active=\{\(reel \|\| index === i\) && !covered\} inView=\{inView\} mute=\{mute\} passive \/>/);
  assert.match(s, /covered=\{!!viewer\}/);
});

test('PhotoViewer: o vídeo usa o leitor do feed (CarouselVideo) em modo visor, só o item à vista toca', () => {
  const pv = read('components', 'PhotoViewer.tsx');
  assert.match(pv, /import \{ CarouselVideo \} from '\.\/CarouselVideo';/);
  assert.match(pv, /isViewerVideo\(item\)\s*\/\/[^\n]*\n\s*\? <ViewerVideo item=\{item\} w=\{page\.w\} h=\{page\.h\} active=\{index === i\} mute=\{muteVideo\} soundBottom=\{footH \+ 10\} \/>/);
  const vv = pv.slice(pv.indexOf('function ViewerVideo'), pv.indexOf('export function PhotoViewer'));
  assert.match(vv, /<CarouselVideo\s+url=\{item\.url\} poster=\{item\.posterUrl\} durationMs=\{item\.durationMs\} width=\{w\} height=\{h\} active=\{active\} inView mute=\{mute\} viewer\s+fit=\{fit\}/);
  // Zoom (roda do rato, duplo clique) só nas fotos: o vídeo não passa pelo Photo.
  assert.match(pv, /: <Photo photo=\{item\}/);
  assert.match(pv, /const start = viewerStart\(asked, photos\.length\);/);
  assert.doesNotMatch(pv, /useVideoPlayer|createElement\('video'/, 'sem um segundo leitor de vídeo no visor');
});

test('CarouselVideo em modo visor: fit do visor (cover/contain), toque pausa/retoma, som num botão, capa enquanto carrega', () => {
  const s = read('components', 'CarouselVideo.tsx');
  const web = s.slice(s.indexOf('function WebVideo'), s.indexOf('function NativeVideo('));
  assert.match(web, /objectFit: viewer \? fit : 'cover'/);
  assert.match(web, /contentFit=\{viewer \? fit : 'cover'\}/, 'a capa enche como o vídeo (sem saltos quando arranca)');
  assert.match(web, /onLoadedMetadata:[\s\S]*?onSize\?\.\(v\.videoWidth, v\.videoHeight\)/);
  assert.match(web, /if \(v\.paused\) start\(\);\s*else v\.pause\(\);/);
  assert.match(web, /\{video\}\s*\{coverImg\}/);
  assert.match(web, /\{!mute \? <SoundButton muted=\{muted\} onPress=\{toggle\} viewer bottom=\{soundBottom\} \/> : null\}/);
  assert.match(web, /loop: true/);
  const live = s.slice(s.indexOf('function NativeVideoLive'));
  assert.match(live, /const fit = viewer \? viewerFit : 'cover';/);
  assert.match(live, /addListener\('sourceLoad'/, 'sem width\/height na publicação, o tamanho vem do vídeo quando carrega');
  assert.match(live, /\{!mute \? <SoundButton muted=\{muted\} onPress=\{toggle\} viewer bottom=\{soundBottom\} \/> : null\}/);
  assert.match(live, /if \(player\.playing\) player\.pause\(\);\s*else player\.play\(\);/);
  assert.match(live, /\{cover && !started \? <Image/);
  assert.match(live, /p\.loop = true;/);
  // O som respeita o estado lembrado da app (o mesmo `soundOn` do feed).
  assert.match(live, /soundOn = !player\.muted;/);
  const idle = s.slice(s.indexOf('function NativeVideoIdle'), s.indexOf('function NativeVideoLive'));
  assert.match(idle, /contentFit=\{viewer \? fit : 'cover'\}/);
});

test('repost com comentário: uma original com fotos e vídeos abre o visor (a tcheka sozinha abre a publicação)', () => {
  const q = read('components', 'QuoteThread.tsx');
  assert.match(q, /video && original\.media\.length < 2 \? onOpen\?\.\(original\) : tap\(\(\) => onPhoto\?\.\(original\)\)/);
});
