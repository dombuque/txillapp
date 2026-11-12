// Testes do ecrã de ver tchekas (ao nível do TikTok): o som (letreiro, disco e a página do som), a barra de progresso
// (segurar e arrastar), o menu de segurar, o «+» para seguir, os separadores «Para ti» / «A seguir» e as ações do lado.
// As contas estão em src/lib/reelView.ts; o resto confirma-se no código dos ecrãs.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const v = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'reelView.ts')).href);
const read = (...p) => readFileSync(path.join(ROOT, 'src', ...p), 'utf8').replace(/\r\n/g, '\n');
const reels = read('app', '(tabs)', 'reels.tsx');
const page = read('app', 'r', '[id].tsx');
const author = { username: 'ana' };

test('som: «Som original · @x» ou «Título · Artista», e o toque abre /som/<id>', () => {
  assert.deepEqual(v.reelSound({ author, sound: { id: 's1', title: 'som original', kind: 'original', author: { username: 'rui' } } }), { label: 'Som original · @rui', cover: null, originalBy: 'rui', href: '/som/s1' });
  // Sem autor no som original: é de quem publicou.
  assert.equal(v.reelSound({ author, sound: { id: 's2', title: '', kind: 'original' } }).label, 'Som original · @ana');
  assert.equal(v.reelSound({ author, sound: { id: 'c 9', title: 'Xitimela', kind: 'catalog', author: 'Ghorwane', cover: '/c.jpg' } }).label, 'Xitimela · Ghorwane');
  assert.equal(v.reelSound({ author, sound: { id: 'c 9', title: 'Xitimela', kind: 'catalog', author: 'Ghorwane', cover: '/c.jpg' } }).href, '/som/c%209');
  assert.equal(v.reelSound({ author, sound: { id: 'c 9', title: 'Xitimela', kind: 'catalog', cover: '/c.jpg' } }).cover, '/c.jpg');
  assert.equal(v.reelSound({ author, sound: { id: 'l1', title: 'Marrabenta', kind: 'local', author: { username: 'dj', displayName: 'DJ Txill' } } }).label, 'Marrabenta · DJ Txill');
  assert.equal(v.reelSound({ author, sound: { id: 'l1', title: 'Marrabenta', kind: 'local', author: { username: 'dj' } } }).label, 'Marrabenta · @dj');
  assert.equal(v.reelSound({ author, sound: { id: 'l2', title: 'Só título', kind: 'catalog' } }).label, 'Só título');
  assert.equal(v.useSoundHref('s 1'), '/tcheka/nova?som=s%201');
});

test('som: sem `sound` da API mostra a música da publicação; sem nada, não há letreiro nem disco', () => {
  assert.deepEqual(v.reelSound({ author, music: { id: 'm1', title: 'Txilla', artist: 'Banda', cover: '/m.jpg' } }), { label: 'Txilla · Banda', cover: '/m.jpg', originalBy: null, href: '/som/m1' });
  assert.equal(v.reelSound({ author, music: { id: 'm2', title: 'gravação', artist: '', kind: 'clip' } }).label, 'Som original · @ana');
  assert.equal(v.reelSound({ author, music: { id: 'm3', title: 'Sem artista', artist: null } }).label, 'Sem artista');
  assert.equal(v.reelSound({ author }), null);
  assert.equal(v.reelSound({ author, sound: null, music: null }), null);
  // O `sound` ganha à música.
  assert.equal(v.reelSound({ author, sound: { id: 's', title: 'A', kind: 'catalog', author: 'B' }, music: { id: 'm', title: 'X', artist: 'Y' } }).label, 'A · B');
});

test('ecrã: o disco e o letreiro abrem a página do som; sem som ficam escondidos', () => {
  assert.match(reels, /const sound = reelSound\(post\);/);
  assert.match(reels, /const goSound = \(\) => \{ if \(sound\) router\.push\(sound\.href as never\); \};/);
  assert.match(reels, /\{sound && <SoundDisc sound=\{sound\} spinning=\{shouldPlay\} onPress=\{goSound\} \/>\}/);
  assert.match(reels, /\{sound && <SoundMarquee sound=\{sound\} running=\{shouldPlay\} onPress=\{goSound\}/);
  const disc = read('components', 'reel', 'ReelSound.tsx');
  assert.match(disc, /if \(!spinning\) return;/, 'o disco só roda enquanto toca');
  assert.match(disc, /if \(!overflow \|\| !running\) return;/, 'o letreiro só corre se não couber e estiver a tocar');
  assert.match(disc, /accessibilityRole="link" accessibilityLabel=\{`Som: \$\{sound\.label\}`\}/);
});

test('barra de progresso: o tempo e o sítio para onde salta ao arrastar', () => {
  assert.equal(v.clock(0), '0:00');
  assert.equal(v.clock(7.9), '0:07');
  assert.equal(v.clock(65), '1:05');
  assert.equal(v.clock(NaN), '0:00');
  assert.equal(v.clock(-3), '0:00');
  // Pousou a meio de uma barra de 300 px e andou 75 px para a direita: 75%.
  assert.equal(v.seekRatio(0.5, 75, 300), 0.75);
  assert.equal(v.seekRatio(0.5, -600, 300), 0, 'não passa do início');
  assert.equal(v.seekRatio(0.9, 600, 300), 1, 'nem do fim');
  assert.equal(v.seekRatio(0.3, 50, 0), 0.3, 'barra ainda sem largura');
  assert.equal(v.seekTime(0.5, 20), 10);
  assert.ok(v.seekTime(1, 20) < 20, 'não salta mesmo para o fim (acabava e mostrava o ecrã do fim)');
  assert.equal(v.seekTime(0.5, 0), 0);
  // Setas ← / → no computador: 5 s, sem sair do vídeo.
  assert.equal(v.stepTime(10, 30, 5), 15);
  assert.equal(v.stepTime(2, 30, -5), 0);
  assert.ok(v.stepTime(28, 30, 5) < 30);
});

test('barra de progresso: segurar engrossa e mostra o tempo; arrastar avança e recua e, ao largar, continua', () => {
  const bar = read('components', 'reel', 'SeekBar.tsx');
  assert.match(bar, /onPanResponderGrant: \(e\) => \{/);
  assert.match(bar, /wasPlaying = pl\(\)\.playing; pl\(\)\.pause\(\);/, 'pára enquanto se arrasta');
  assert.match(bar, /d\.ratio = seekRatio\(d\.start, g\.dx, width\.current\);/);
  assert.match(bar, /pl\(\)\.currentTime = seekTime\(d\.ratio, pl\(\)\.duration\);/);
  assert.match(bar, /if \(d\.wasPlaying\) pl\(\)\.play\(\);/, 'ao largar continua dali');
  assert.match(bar, /\{clock\(scrub\.ratio \* scrub\.duration\)\}/);
  assert.match(bar, /height: scrub \? 6 : 3/);
  assert.match(bar, /onPanResponderTerminationRequest: \(\) => false/, 'a lista não rouba o gesto a meio');
  assert.match(reels, /<SeekBar player=\{player\} bottom=\{barBottom\} onScrub=\{setScrubbing\} \/>/);
  // Enquanto se arrasta, a legenda e os botões saem da frente.
  assert.match(reels, /const chrome = Animated\.multiply\(.*scrubbing \? 0 : 1\);/);
});

test('menu de segurar: Não me interessa e Denunciar nas dos outros; Guardar e Velocidade em todas; Legendas se houver', () => {
  assert.deepEqual(v.holdMenu({ mine: false, captions: false }), ['not-interested', 'report', 'save', 'speed', 'more']);
  assert.deepEqual(v.holdMenu({ mine: true, captions: false }), ['save', 'speed', 'more']);
  assert.deepEqual(v.holdMenu({ mine: false, captions: true, canGift: true }), ['not-interested', 'report', 'save', 'speed', 'captions', 'gift', 'more']);
  assert.deepEqual(v.holdMenu({ mine: true, captions: true, canGift: true }), ['save', 'speed', 'captions', 'more'], 'não se presenteia a si');
  assert.deepEqual([...v.SPEEDS], [0.5, 0.75, 1, 1.25, 1.5, 2]);
  assert.deepEqual(v.SPEEDS.map(v.speedLabel), ['0,5×', '0,75×', '1×', '1,25×', '1,5×', '2×']);
});

test('menu de segurar: abre ao segurar (telemóvel e browser) e cada opção faz o que diz', () => {
  assert.match(reels, /const hold = useLongPressGesture\(\{ minDuration: HOLD_MS,/);
  assert.match(reels, /const taps = useExclusiveGestures\(hold, dblTap, oneTap\);/);
  assert.match(reels, /onPress=\{onScreenTap\} onLongPress=\{openHold\} delayLongPress=\{HOLD_MS\}/);
  // Web: o «click» que o browser manda ao largar o dedo não fecha o menu acabado de abrir (só esse; os toques seguintes contam).
  assert.match(reels, /swallowReleaseClick\(\);\n\s+setSheet\('hold'\);/);
  assert.match(reels, /if \(upAt\) return;\n\s+upAt = Date\.now\(\);\n\s+setTimeout\(done, 400\);/);
  assert.match(reels, /if \(it === 'not-interested'\) return notInterested\(\);/);
  assert.match(reels, /if \(it === 'report'\) return setSheet\('report'\);/);
  assert.match(reels, /\{sheet === 'report' && <ReportSheet type="post" id=\{post\.id\}/);
  assert.match(reels, /if \(it === 'save'\) \{ setSheet\(null\); return void save\(\); \}/);
  assert.match(reels, /if \(it === 'captions'\) \{ setSheet\(null\); return toggleCaptions\(\); \}/);
  assert.match(reels, /player\.playbackRate = speed; player\.preservesPitch = true;/);
  // «Legendas» só aparece se o vídeo as tiver.
  assert.match(reels, /availableSubtitleTracksChange', \(\{ availableSubtitleTracks \}\) => setCaptions\(\(s\) => \(\{ \.\.\.s, has: availableSubtitleTracks\.length > 0 \}\)\)/);
  assert.match(reels, /captions=\{captions\.has\}/);
  const menu = read('components', 'reel', 'HoldMenu.tsx');
  assert.match(menu, /const items = holdMenu\(\{ mine, captions, canGift \}\);/);
  for (const t of ["'Não me interessa'", "'Denunciar'", "'Guardar'", '>Velocidade<', "'Legendas'"]) assert.ok(menu.includes(t), t);
});

test('«Não me interessa» ensina o feed (o mesmo do «Não interessado») e passa à seguinte', () => {
  assert.match(reels, /void feedApi\.setInterest\(post\.id, -1\)\.catch\(\(\) => undefined\);/);
  assert.match(reels, /setTimeout\(\(\) => onMore\?\.\(\), 650\);/);
  assert.match(read('components', 'TeachBar.tsx'), /await feedApi\.setInterest\(postId, v\);/, 'o mesmo pedido do TeachBar do feed');
});

test('ações do lado: avatar com «+» (seguir), brindar, comentários, repostar, guardar, partilhar, o sítio do remix e o disco', () => {
  assert.equal(v.showFollowPlus({ mine: false, authorFollowed: false }), true);
  assert.equal(v.showFollowPlus({ mine: false, authorFollowed: true }), false);
  assert.equal(v.showFollowPlus({ mine: true, authorFollowed: false }), false);
  assert.equal(v.showFollowPlus({ mine: false, authorFollowed: false, followedNow: true }), false);
  assert.equal(v.showFollowPlus({ mine: false }), false, 'sem saber se segue, não mostra');
  assert.match(reels, /await api\.follow\(post\.author\.username\);/);
  const order = ['<AuthorBubble', "accessibilityLabel={post.cheered ? 'Tirar o brinde' : 'Brindar'}", "onPress={() => setSheet('comments')}", "onPress={() => setSheet('repost')}", 'onPress={() => void save()}', "onPress={() => setSheet('share')}", '{extraActions ?? <ReelExtraActions post={post} active={active} />}', '{sound && <SoundDisc'];
  let at = reels.indexOf('<Animated.View style={[st.rails');
  assert.ok(at > 0);
  for (const s of order) {
    const i = reels.indexOf(s, at);
    assert.ok(i > at, `${s} a seguir`);
    at = i;
  }
  // O sítio do remix: um componente à parte (a equipa do remix só mexe nele) e o prop `extraActions`.
  const slot = read('components', 'reel', 'ReelExtraActions.tsx');
  assert.match(slot, /export function ReelExtraActions\(_props: \{ post: Post; active: boolean \}\): ReactNode \{\n {2}return null;\n\}/);
  assert.match(slot, /export function RailButton\(/);
});

test('comentários: abrem por cima, o vídeo continua a tocar e encolhe para a parte de cima', () => {
  assert.match(reels, /const comments = sheet === 'comments' && !desktop;/);
  assert.match(reels, /const room = Math\.max\(96, win\.height \* \(1 - COMMENTS_SHARE\) - headTop - 8\);/);
  assert.match(reels, /outputRange: \[0, headTop \+ room \/ 2 - height \/ 2\]/, 'fica entre o topo e a folha');
  assert.match(reels, /<CommentsSheet post=\{post\} dim=\{desktop \? undefined : 0\.08\}/);
  // Abrir os comentários não entra nas contas de quando a tcheka toca.
  assert.match(reels, /sharing: sheet === 'share' \}\);/);
  assert.match(read('components', 'Sheet.tsx'), /outputRange: \[dim, 0\]/);
});

test('em baixo: o @ com o selo, a legenda que expande ao tocar e as hashtags clicáveis', () => {
  assert.equal(v.captionIsLong('curta'), false);
  assert.equal(v.captionIsLong('a'.repeat(81)), true);
  assert.equal(v.captionIsLong('um\ndois\ntrês'), true);
  assert.equal(v.captionIsLong(null), false);
  assert.match(reels, /<RichText text=\{post\.body\} style=\{st\.body\} numberOfLines=\{2\} \/>/);
  assert.match(reels, /onPress=\{\(\) => setCaptionOpen\(true\)\} disabled=\{!longCaption\}/);
  assert.match(read('components', 'RichText.tsx'), /router\.push\(\(m\[1\] \? `\/u\/\$\{name\}` : `\/t\/\$\{encodeURIComponent\(name\)\}`\)/, 'hashtags e @ levam à página');
});

test('separadores «Para ti» e «A seguir»: listas à parte, a de «A seguir» só de quem segues', () => {
  assert.deepEqual(v.REEL_TABS.map((t) => t.label), ['Para ti', 'A seguir']);
  assert.deepEqual(v.reelsKey('foryou'), ['reels']);
  assert.deepEqual(v.reelsKey('following'), ['reels', 'following']);
  assert.match(reels, /queryKey: reelsKey\(tab\),\n\s+queryFn: \(\{ pageParam \}\) => api\.reels\(pageParam, tab === 'following'\),/);
  assert.match(reels, /<FlatList\n\s+key=\{tab\}/, 'mudar de separador recomeça a lista');
  assert.match(reels, /accessibilityRole="tablist"/);
  assert.match(read('lib', 'api.ts'), /reels: \(cursor\?: string, following = false\): Promise<Page<Post>> => raw\(`\/feed\/reels\?limit=6\$\{cursor \? `&cursor=\$\{cursor\}` : ''\}\$\{following \? '&following=1' : ''\}`\),/);
  const ctrl = readFileSync(path.join(ROOT, '..', 'api', 'src', 'posts', 'posts.controller.ts'), 'utf8');
  assert.match(ctrl, /@Query\('following'\) following\?: string/);
  // As alterações (brindar, guardar…) chegam às duas listas e à da página /r.
  assert.match(reels, /qc\.setQueriesData<InfiniteData<Page<Post>>>\(\{ queryKey: \['reels'\] \}/);
  assert.match(page, /patchReels\(qc, pid, c\);/);
});

test('fluidez: sem pretos (a capa fica até à primeira imagem), a seguinte e a anterior carregadas, um só vídeo com som', () => {
  assert.match(reels, /onFirstFrameRender=\{\(\) => setShown\(true\)\}/);
  assert.match(reels, /useExoShutter=\{false\}/);
  assert.match(reels, /\{m\.posterUrl && !shown \? <Image/);
  assert.match(reels, /windowSize=\{3\}\n\s+initialNumToRender=\{2\}/);
  assert.match(reels, /player\.muted = silent \|\| !active;/, 'as que não estão em cena ficam mudas');
});

test('computador: ↑/↓ e a roda mudam de tcheka, espaço pausa, ←/→ recuam e avançam 5 s', () => {
  const hooks = read('lib', 'desktopHooks.ts');
  assert.match(hooks, /prev: \(\) => setSeekSignal\(\(s\) => \(\{ n: s\.n \+ 1, by: -5 \}\)\),/);
  assert.match(hooks, /next: \(\) => setSeekSignal\(\(s\) => \(\{ n: s\.n \+ 1, by: 5 \}\)\),/);
  assert.match(hooks, /return \{ ref, pauseSignal, seekSignal \};/);
  assert.match(reels, /seekSignal=\{desk\.seekSignal\}/);
  assert.match(page, /seekSignal=\{desk\.seekSignal\}/);
  assert.match(reels, /player\.currentTime = stepTime\(player\.currentTime, player\.duration, seekSignal\.by\);/);
});
