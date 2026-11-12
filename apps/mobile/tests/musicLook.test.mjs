// Testes da música nas publicações e nos mimos (src/lib/musicLook.ts e os componentes PostMusic, SoundWaves, o visor dos
// mimos e o visor de fotos):
// - a cor do texto sobre a capa escolhida pela luminância (branco ou quase preto, o que tiver melhor contraste);
// - o cartão completo nas publicações só com texto e o selo flutuante por cima das fotos e dos vídeos;
// - «Usar este som» só quando a publicação traz `sound`;
// - o artista local (ligação ao perfil e etiqueta «Artista");
// - «reduzir movimento» a parar o marquee, o equalizador, o disco e as ondas;
// - as ondas: transparentes, sem apanhar toques, por baixo dos stickers e dos controlos, e a pastilha do mimo à esquerda.
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const m = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'musicLook.ts')).href);
const wr = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'wavesRunner.ts')).href);
const read = (...f) => readFileSync(path.join(ROOT, 'src', ...f), 'utf8').replace(/\r\n/g, '\n');

const track = (extra = {}) => ({ id: 'ccmixter:1', title: 'Jingle bell rock', artist: 'MonacoLorenzo', url: '/a.mp3', ...extra });
const photo = { kind: 'image' };
const video = { kind: 'video' };

test('cor do texto: branco sobre capas escuras, quase preto sobre capas claras (pela luminância)', () => {
  assert.equal(m.textOn(['#16062a', '#4f1d7a']), m.TEXT_LIGHT); // roxo noite
  assert.equal(m.textOn(['#0c4a6e', '#0b1d3f']), m.TEXT_LIGHT); // mar
  assert.equal(m.textOn(['#d6334f', '#5b1426']), m.TEXT_LIGHT); // a marca
  assert.equal(m.textOn(['#fde68a', '#fef3c7']), m.TEXT_DARK); // amarelo claro
  assert.equal(m.textOn(['#e0f2fe', '#bae6fd']), m.TEXT_DARK); // céu claro
  assert.equal(m.textOn(['#ffffff', '#f4f4f5']), m.TEXT_DARK);
  // Sem cores (ou cores que não são cores): o fundo é o da marca, o texto é branco.
  assert.equal(m.textOn(null), m.TEXT_LIGHT);
  assert.equal(m.textOn(['rgb(0,0,0)', 'azul']), m.TEXT_LIGHT);
  assert.equal(m.TEXT_DARK, '#18181b');
});

test('cor do texto: a escolhida tem sempre o melhor contraste no pior ponto do gradiente', () => {
  const pairs = [['#7a4a06', '#2b1702'], ['#14532d', '#062012'], ['#a1a1aa', '#27272a'], ['#fb7185', '#881337'], ['#f59e0b', '#fde68a'], ['#38bdf8', '#e0f2fe'], ['#808080', '#909090']];
  for (const p of pairs) {
    const pick = m.textOn(p);
    const other = pick === m.TEXT_LIGHT ? m.TEXT_DARK : m.TEXT_LIGHT;
    const worst = (fg) => Math.min(...p.map((c) => m.contrast(fg, c)));
    assert.ok(worst(pick) >= worst(other), `${p}: ${pick}`);
  }
  // Contas WCAG de referência.
  assert.ok(Math.abs(m.contrast('#000000', '#ffffff') - 21) < 1e-9);
  assert.equal(m.luminance('#ffffff'), 1);
  assert.equal(m.luminance('#000'), 0);
});

test('cores do cartão: as da capa quando são cores a sério, senão o gradiente da marca', () => {
  assert.deepEqual(m.trackColors(track({ coverColors: ['#4f1d7a', '#16062a'] })), ['#4f1d7a', '#16062a']);
  assert.deepEqual(m.trackColors(track()), [...m.BRAND_GRADIENT]);
  assert.deepEqual(m.trackColors(track({ coverColors: ['#4f1d7a'] })), [...m.BRAND_GRADIENT]);
  assert.deepEqual(m.trackColors(track({ coverColors: ['url(x)', '#000'] })), [...m.BRAND_GRADIENT]);
  assert.equal(m.BRAND_GRADIENT[0], '#d6334f');
  assert.equal(m.withAlpha('#d6334f', 0.5), 'rgba(214,51,79,0.5)');
  // O brilho das ondas é a cor da capa clareada: uma capa escura não vira sombra por cima da foto.
  assert.equal(m.mix('#000000', '#ffffff', 0.5), '#808080');
  assert.ok(m.luminance(m.glowOf('#0b1d3f')) > m.luminance('#0b1d3f') + 0.15);
  assert.equal(m.glowOf(null), m.mix('#d6334f', '#ffffff', 0.45));
});

test('onde fica a música: cartão nas publicações só com texto, selo por cima das fotos e dos vídeos', () => {
  const music = track();
  assert.equal(m.musicPlacement({ music, media: [] }), 'card');
  assert.equal(m.musicPlacement({ music, media: null }), 'card');
  assert.equal(m.musicPlacement({ music, media: [photo] }), 'badge');
  assert.equal(m.musicPlacement({ music, media: [video] }), 'badge');
  assert.equal(m.musicPlacement({ music, media: [photo, video] }), 'badge');
  // Numa citação as fotos do original não aparecem: volta o cartão.
  assert.equal(m.musicPlacement({ music, media: [photo], kind: 'repost', body: 'olha isto' }), 'card');
  assert.equal(m.musicPlacement({ music: null, media: [photo] }), 'none');
  assert.equal(m.musicPlacement({ media: [] }), 'none');
  // As ondas só por cima de fotos.
  assert.equal(m.wavesOverMedia([photo]), true);
  assert.equal(m.wavesOverMedia([video]), false);
  assert.equal(m.wavesOverMedia([video, photo]), true);
});

test('PostCard: o cartão só nas publicações de texto e o selo dentro da caixa da imagem (nada por baixo dela)', () => {
  const pc = read('components', 'PostCard.tsx');
  assert.doesNotMatch(pc, /<TrackCard /);
  assert.match(pc, /post\.music && musicPlacement\(post\) === 'card' \? <MusicCard track=\{post\.music\} visible=\{musicOn\} soundTo=\{soundHref\(/);
  // Num dueto ou resposta com tcheka o som já vem no vídeo: sem selo a tocar por cima (fica a etiqueta do remix).
  assert.match(pc, /mute=\{!!post\.music && !post\.remixOf\}/);
  assert.match(pc, /overlay=\{post\.music && !post\.remixOf \? <MusicBadge track=\{post\.music\} visible=\{musicOn\} waves=\{wavesOverMedia\(post\.media\)\} \/> : undefined\}/);
  // O selo vai por cima das fotos e por baixo dos controlos; as pessoas identificadas passam para a direita.
  assert.match(pc, /\{overlay\}\n\s+\{tags\.length > 0 && \(/);
  assert.match(pc, /overlay \? styles\.tagsRight : null/);
  // O visor de fotos sabe a música.
  assert.match(pc, /music=\{viewer\.of\.music\}/);
});

test('«Usar este som» só quando a publicação traz `sound`', () => {
  assert.equal(m.soundHref({}), null);
  assert.equal(m.soundHref(null), null);
  assert.equal(m.soundHref({ sound: null }), null);
  assert.equal(m.soundHref({ sound: 'abc-123' }), '/som/abc-123');
  assert.equal(m.soundHref({ sound: { id: 'ccmixter:77' } }), '/som/ccmixter%3A77');
  assert.equal(m.soundHref({ sound: { id: '../../x' } }), null);
  assert.equal(m.soundHref({ sound: { id: 42 } }), null);
  const pm = read('components', 'PostMusic.tsx');
  assert.match(pm, /\{soundTo \? \(\n\s+<Pressable onPress=\{\(\) => router\.push\(soundTo as never\)\}[^\n]*accessibilityLabel="Usar este som">/);
});

test('artista local: o nome leva ao perfil e leva a etiqueta «Artista»; os outros não', () => {
  const local = m.trackArtist(track({ source: 'local', artist: 'Mano Txill', artistUsername: 'mano_txill' }));
  assert.deepEqual(local, { name: 'Mano Txill', local: true, href: '/u/mano_txill' });
  assert.deepEqual(m.trackArtist(track()), { name: 'MonacoLorenzo', local: false, href: null });
  // Um @ que não parece um @ não vira ligação; sem nome, mostra-se o @.
  assert.equal(m.trackArtist(track({ source: 'local', artistUsername: 'a b/../c' })).href, null);
  assert.equal(m.trackArtist(track({ source: 'local', artist: '', artistUsername: 'lizha' })).name, '@lizha');
  assert.equal(m.trackArtist(track({ kind: 'clip' })).name, 'Áudio original');
  assert.equal(m.trackArtist(track({ artist: '' })).name, 'Autor desconhecido');
  const pm = read('components', 'PostMusic.tsx');
  assert.match(pm, /\{artist\.href \? \(\n\s+<Pressable onPress=\{\(\) => router\.push\(artist\.href as never\)\}/);
  assert.match(pm, /\{artist\.local \? \(\n\s+<View style=\{\[s\.tag[^\n]*accessibilityLabel="Artista">/);
});

test('acessibilidade: «Música: Título, de Artista. Toca para silenciar ou ligar o som»', () => {
  assert.equal(m.musicA11yLabel(track()), 'Música: Jingle bell rock, de MonacoLorenzo. Toca para silenciar ou ligar o som');
  assert.equal(m.musicA11yLabel(track(), true), 'Música: Jingle bell rock, de MonacoLorenzo. Sem som. Toca para silenciar ou ligar o som');
  assert.equal(m.badgeLine(track()), '♪ Jingle bell rock · MonacoLorenzo');
  assert.equal(m.badgeLine(track({ kind: 'clip', title: 'Áudio de @ana' })), '♪ Áudio de @ana');
  const pm = read('components', 'PostMusic.tsx');
  assert.equal((pm.match(/accessibilityLabel=\{musicA11yLabel\(track, muted\)\}/g) ?? []).length >= 3, true); // cartão, selo e pastilha
});

test('reduzir movimento: para o marquee, o equalizador, o disco e as ondas', () => {
  assert.equal(m.motionOn({ reduce: true, playing: true, visible: true, muted: false }), false);
  assert.equal(m.motionOn({ reduce: true, playing: true, needsSound: false }), false);
  assert.equal(m.motionOn({ reduce: false, playing: true, visible: true, muted: false }), true);
  // Sem tocar, fora de vista ou sem som (o marquee corre sem som, o equalizador não).
  assert.equal(m.motionOn({ reduce: false, playing: false }), false);
  assert.equal(m.motionOn({ reduce: false, playing: true, visible: false }), false);
  assert.equal(m.motionOn({ reduce: false, playing: true, muted: true }), false);
  assert.equal(m.motionOn({ reduce: false, playing: true, muted: true, needsSound: false }), true);
  // O hook lê a preferência certa em cada sítio e segue as mudanças.
  const rm = read('lib', 'reduceMotion.ts');
  assert.match(rm, /\(prefers-reduced-motion: reduce\)/);
  assert.match(rm, /AccessibilityInfo\.isReduceMotionEnabled\(\)/);
  assert.match(rm, /addEventListener\('reduceMotionChanged'/);
  assert.match(rm, /mq\.addEventListener\?\.\('change'/);
  // Todos os que mexem usam-no.
  const pm = read('components', 'PostMusic.tsx');
  assert.equal((pm.match(/const reduce = useReduceMotion\(\);/g) ?? []).length, 3);
  assert.match(read('components', 'SoundWaves.tsx'), /const wants = active && !reduce;/);
});

test('marquee: só corre se o texto não couber, a uma velocidade calma', () => {
  assert.deepEqual(m.marquee(120, 200), { run: false, distance: 0, ms: 0 });
  assert.deepEqual(m.marquee(0, 200), { run: false, distance: 0, ms: 0 });
  const r = m.marquee(300, 200);
  assert.equal(r.run, true);
  assert.equal(r.distance, 300 + m.MARQUEE_GAP);
  assert.equal(r.ms, Math.round((r.distance / 28) * 1000));
});

test('anel de progresso e duração do trecho', () => {
  assert.equal(m.ringProgress(15, 30), 0.5);
  assert.equal(m.ringProgress(45, 30), 0.5); // em ciclo
  assert.equal(m.ringProgress(0, 30), 0);
  assert.equal(m.ringProgress(5, null), 0);
  assert.equal(m.snippetSeconds(28.4, 30000), 28.4);
  assert.equal(m.snippetSeconds(NaN, 30000), 30);
  assert.equal(m.snippetSeconds(null, null), 30);
});

test('ondas: o nível pelo RMS, a «respiração» sem análise e o caminho a meio da imagem', () => {
  assert.equal(m.rmsLevel([]), 0);
  assert.equal(m.rmsLevel(new Float32Array(2048)), 0);
  assert.ok(m.rmsLevel(Float32Array.from({ length: 2048 }, (_, i) => Math.sin(i / 8) * 0.25)) > 0.4);
  assert.equal(m.rmsLevel(Float32Array.from({ length: 1024 }, () => 1)), 1);
  for (let t = 0; t < 20; t += 0.137) {
    const b = m.breath(t);
    assert.ok(b >= 0.25 && b <= 1, `breath(${t}) = ${b}`);
  }
  const d = m.wavePath(390, 100, 0, 30, 1.4, 28);
  assert.match(d, /^M0\.0 50\.0/);
  assert.equal((d.match(/[ML]/g) ?? []).length, 29);
  // Todos os pontos ficam dentro da faixa.
  for (const [, y] of d.matchAll(/[ML][\d.]+ ([\d.-]+)/g)) assert.ok(Number(y) >= 0 && Number(y) <= 100);
});

test('ondas: um só SVG, transparentes, sem apanhar toques e só a desenhar enquanto tocam', () => {
  const sw = read('components', 'SoundWaves.tsx');
  assert.equal((sw.match(/<Svg /g) ?? []).length, 1);
  assert.match(sw, /<View style=\{StyleSheet\.absoluteFill\} pointerEvents="none"/);
  for (const [, a] of sw.matchAll(/alpha: (0\.\d+)/g)) assert.ok(Number(a) >= 0.15 && Number(a) <= 0.25, `opacidade ${a}`);
  assert.match(sw, /useFrameCallback\([\s\S]*?, false\)/); // não arranca sozinho
  assert.match(sw, /frame\.setActive\(false\)/);
  assert.match(sw, /withTiming\(on \? 1 : 0/); // fade a entrar e a sair
  // A amplitude segue o som na web quando dá (mesma origem ou CORS e a página já tocada); senão respira.
  const al = read('lib', 'audioLevel.ts');
  assert.match(al, /Platform\.OS !== 'web'/);
  assert.match(al, /userActivation\?\.hasBeenActive === true/);
  assert.match(al, /setAudioSamplingEnabled\(true\)/);
  assert.match(sw, /breath\(t\.value\)/);
});

test('mimos: as ondas por baixo dos stickers e a pastilha à esquerda, longe da assinatura', () => {
  const sv = read('app', 'stories', '[username].tsx');
  // Em todos os mimos com música (foto ou vídeo); o som do próprio vídeo não leva ondas.
  assert.ok(sv.includes('{cur.music ? <SoundWaves active={tune.playing && !tuneMuted && !typing}'));
  assert.equal((sv.match(/<SoundWaves /g) ?? []).length, 1);
  const waves = sv.indexOf('<SoundWaves active={tune.playing && !tuneMuted && !typing}');
  const stickers = sv.indexOf('<StickerLayer stickers={cur.stickers}');
  assert.ok(waves > 0 && stickers > waves, 'as ondas vêm antes dos stickers (ficam por baixo)');
  assert.match(sv, /<MusicPill track=\{track\} live=\{playing\} muted=\{muted\} onToggleMute=\{toggleMute\}/);
  // O som do mimo é o mesmo da app (silenciar aqui silencia as publicações).
  assert.match(sv, /const \[muted, toggleMute\] = useMusicMuted\(\);/);
  const pm = read('components', 'PostMusic.tsx');
  assert.match(pm, /pill: \{ alignSelf: 'flex-start', maxWidth: '72%'/);
  assert.match(pm, /badge: \{ position: 'absolute', left: 12, bottom: 12, maxWidth: '68%'/);
});

test('ondas: só um conjunto corre de cada vez (o do som que começou por último)', () => {
  const a = Symbol('a');
  const b = Symbol('b');
  assert.equal(wr.runningWaves(), null);
  wr.claimWaves(a);
  assert.equal(wr.runningWaves(), a);
  wr.claimWaves(b); // o visor de fotos abre por cima da publicação
  assert.equal(wr.runningWaves(), b);
  wr.claimWaves(b);
  assert.equal(wr.runningWaves(), b);
  wr.releaseWaves(b); // fecha: a da publicação volta
  assert.equal(wr.runningWaves(), a);
  wr.releaseWaves(a);
  wr.releaseWaves(a);
  assert.equal(wr.runningWaves(), null);
  let n = 0;
  const off = wr.subscribeWaves(() => n++);
  wr.claimWaves(a);
  wr.releaseWaves(a);
  off();
  wr.claimWaves(a);
  assert.equal(n, 2);
  wr.releaseWaves(a);
  assert.match(read('components', 'SoundWaves.tsx'), /const on = wants && front;/);
});

test('ondas: só onde se juntou música (publicações, mimos, notas e o visor de fotos); tchekas e vídeos não', () => {
  const uses = (f) => read(...f).includes('<SoundWaves');
  for (const f of [['components', 'PostMusic.tsx'], ['components', 'PhotoViewer.tsx'], ['components', 'TrackCard.tsx'], ['app', 'stories', '[username].tsx']]) assert.ok(uses(f), f.join('/'));
  for (const f of [['app', '(tabs)', 'reels.tsx'], ['components', 'CarouselVideo.tsx'], ['components', 'ChatBubbles.tsx'], ['components', 'MusicPicker.tsx'], ['components', 'zas', 'ZasDeckCard.tsx']]) assert.ok(!uses(f), f.join('/'));
  // Publicações: por cima das fotos (o selo) e dentro do cartão das de texto; num vídeo, não.
  const pm = read('components', 'PostMusic.tsx');
  assert.ok(pm.includes('{waves ? <SoundWaves active={live && !muted && visible}'));
  assert.ok(pm.includes('<SoundWaves active={live && !muted && visible} subtle band={0.8} tint={fg}'));
  // Notas: só quando a música da nota toca com som.
  assert.ok(read('components', 'TrackCard.tsx').includes('{autoplay ? <SoundWaves active={live && !muted} subtle'));
});

test('visor de fotos: as mesmas ondas enquanto a música da publicação toca com som', () => {
  const pv = read('components', 'PhotoViewer.tsx');
  assert.match(pv, /music\?: Track \| null/);
  assert.match(pv, /\{music \? <ViewerWaves music=\{music\} \/> : null\}/);
  assert.match(pv, /const live = useUrlLive\(music\.url\);/);
  assert.match(pv, /<SoundWaves active=\{live && !muted\}/);
});
