// Estúdio das tchekas: a pré-visualização a tocar enquanto se edita (botão tocar/pausar com o tempo, cada mudança vê-se logo
// sem voltar ao início, escolher um clipe salta para ele, sair ou abrir o seletor de música pára) e a montagem em curso, que
// bloqueia a edição (esbatida, sem toques nem teclado) com o × a pedir «Cancelar a montagem?».
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const r = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'tchekaRules.ts')).href);
const studio = readFileSync(path.join(ROOT, 'src', 'components', 'TchekaStudio.tsx'), 'utf8').replace(/\r\n/g, '\n');

test('depois de uma mudança continua do ponto onde estava, a tocar ou parada', () => {
  assert.deepEqual(r.previewResume({ playing: true, at: 7.2, total: 20 }), { action: 'play', at: 7.2 });
  assert.deepEqual(r.previewResume({ playing: false, at: 7.2, total: 20 }), { action: 'show', at: 7.2 }, 'em pausa fica parada no frame');
  assert.deepEqual(r.previewResume({ playing: true, at: 19.9, total: 20 }), { action: 'play', at: 0 }, 'no fim recomeça do princípio');
  assert.deepEqual(r.previewResume({ playing: true, at: 25, total: 12 }), { action: 'play', at: 0 }, 'a sequência encolheu para antes do ponto');
  assert.deepEqual(r.previewResume({ playing: true, at: NaN, total: 10 }), { action: 'play', at: 0 });
});

test('o tempo por baixo do botão: «0:07 / 0:20»', () => {
  assert.equal(r.previewClock(7.9, 20), '0:07 / 0:20');
  assert.equal(r.previewClock(65, 70), '1:05 / 1:10');
  assert.equal(r.previewClock(30, 20), '0:20 / 0:20', 'nunca passa do total');
  assert.equal(r.previewClock(-1, 0), '0:00 / 0:00');
});

test('o botão tocar/pausar está sempre na pré-visualização (fora dos separadores) e o toque no vídeo também pausa', () => {
  const preview = studio.indexOf('<Pressable style={st.preview} onPress={togglePlay}');
  const tabs = studio.indexOf('<View style={st.tabs}');
  assert.ok(preview > 0 && tabs > preview, 'a pré-visualização vem antes dos separadores e é comum a todos');
  const btn = studio.indexOf("accessibilityLabel={playing ? 'Pausar a pré-visualização' : 'Tocar a pré-visualização'}");
  assert.ok(btn > preview && btn < tabs, 'o botão está dentro da pré-visualização');
  assert.match(studio, /<Icon name=\{playing \? 'pause' : 'play'\}/);
  assert.match(studio, /\{previewClock\(playT, playTotal\)\}/);
  assert.match(studio, /<View style=\{\[st\.timeFill/, 'a barra fina do tempo');
});

test('cada mudança vê-se logo, sem voltar ao início', () => {
  // Filtro, ajustes, transição, textos e stickers: lidos a cada frame (cfg.current) e, em pausa, redesenhados no frame parado.
  assert.match(studio, /s\.key in cfg\.current\.fxs \? cfg\.current\.fxs\[s\.key\]/, 'os efeitos de cada clipe lidos a cada frame');
  assert.match(studio, /drawOverlays\(g, cfg\.current\.overlays, t,/, 'os textos e stickers lidos a cada frame');
  assert.match(studio, /const tr = transitionFor\(fxOf\(s\), i, s\.dur\);/, 'a transição de cada junção também');
  assert.match(studio, /Em pausa, o que se muda .* vê-se logo no frame parado/);
  // O volume muda sem recomeçar.
  assert.match(studio, /e\.musicGain!\.gain\.value = musicVol; e\.origGain!\.gain\.value = origVol;/);
  // Corte, duração de uma foto e velocidade: continuam do clipe mexido; ritmo e tirar a música: do ponto de agora.
  assert.match(studio, /const edit = \(i: number, patch: \(it: Item\) => Item\) => \{ restartFrom\.current = segs\[i\]\?\.start \?\? 0;/);
  assert.match(studio, /'Ao ritmo', \(\) => \{ restartFrom\.current = nowT\(\);/);
  assert.match(studio, /'Manual', \(\) => \{ restartFrom\.current = nowT\(\);/);
  assert.match(studio, /restartFrom\.current = nowT\(\); setMusic\(null\);/);
  assert.doesNotMatch(studio, /restartFrom\.current = 0; set(Rhythm|Music)/, 'nenhuma mudança manda para o início');
  // Ao recomeçar segue o estado (a tocar ou em pausa).
  assert.match(studio, /seekTo\(restartFrom\.current, resumeAfterPick\.current \? \{ play: true \} : \{\}\);/);
  // A música nova entra no ponto certo: o som começa nesse instante da faixa.
  assert.match(studio, /restartFrom\.current = pausedAt\.current;\n\s+resumeAfterPick\.current = true;/);
  assert.match(studio, /musicNode\.start\(0, from % e\.music\.buf\.duration\)/);
});

test('escolher um clipe na fila salta para o início dele', () => {
  assert.match(studio, /onPress=\{\(\) => \{ setSel\(i\); seekTo\(segs\[i\]\?\.start \?\? 0\); \}\}/);
});

test('sair do estúdio ou abrir o seletor de música pára a pré-visualização', () => {
  assert.match(studio, /function openPicker\(\) \{ pickerWasPlaying\.current = playingRef\.current; if \(playingRef\.current\) pause\(\); setPickMusic\(true\); \}/);
  assert.match(studio, /<Pressable onPress=\{openPicker\}/);
  assert.match(studio, /<MusicPicker allowLocal onClose=\{closePicker\}/);
  assert.match(studio, /if \(playingRef\.current\) pause\(\);\n\s+onClose\(\);/, 'o × pára antes de fechar');
  assert.match(studio, /e\.videos\.forEach\(\(v\) => \{ v\.pause\(\);/, 'ao desmontar, os vídeos param');
  assert.match(studio, /void e\.ac\?\.close\(\)/, 'e o som fecha');
});

test('com a montagem em curso, os controlos de edição estão desativados', () => {
  assert.equal(r.editLocked(null), false);
  assert.equal(r.editLocked(undefined), false);
  assert.equal(r.editLocked(0), true, 'logo ao carregar em Seguinte (0%)');
  assert.equal(r.editLocked(0.6), true);
  assert.match(studio, /const locked = editLocked\(progress\);/);
  // A caixa com os separadores e todos os controlos (transição, filtro, texto, cor, stickers, música, clipes, durações,
  // cortes e capa): esbatida, sem toques e sem teclado.
  const box = studio.indexOf("pointerEvents={locked ? 'none' : 'auto'}");
  const tabs = studio.indexOf('<View style={st.tabs}');
  const end = studio.indexOf('{pickMusic ? <MusicPicker');
  assert.ok(box > 0 && box < tabs, 'a caixa bloqueada começa antes dos separadores');
  for (const ctl of ['<FxPanel', '<TextPanel', '<StickerTray', 'onPress={openPicker}', 'remove(i)', 'cycle(i)', 'Início do clipe', 'Momento da capa']) {
    const at = studio.indexOf(ctl, tabs);
    assert.ok(at > box && at < end, `${ctl} está dentro da caixa bloqueada`);
  }
  assert.match(studio, /style=\{\[\{ flexShrink: 0 \}, locked && st\.locked\]\}/);
  assert.match(studio, /locked: \{ opacity: 0\.35 \}/);
  assert.match(studio, /accessibilityState=\{\{ disabled: locked \}\}/);
  assert.match(studio, /el\.setAttribute\('inert', ''\)/, 'no browser, inert tira o foco e o teclado');
  // Os painéis dos efeitos, do texto e dos stickers (components/studio) também: as mudanças não passam e o teclado sai.
  assert.match(studio, /<TextPanel [^>]*locked=\{locked\}/);
  assert.match(studio, /<StickerTray [^>]*locked=\{locked\}/);
  assert.match(studio, /const setFx = [^\n]*\n\s+if \(locked\) return;/, 'os efeitos não mudam a meio da montagem');
  assert.match(studio, /<FxStage [^>]*locked=\{locked\}/, 'nem se arrastam os textos na pré-visualização');
  const tp = readFileSync(path.join(ROOT, 'src', 'components', 'studio', 'TextPanel.tsx'), 'utf8');
  assert.match(tp, /editable=\{!locked\}/);
  assert.match(tp, /if \(cur && !locked\) onChange/);
  assert.match(studio, /disabled=\{locked\} style=\{st\.hint\}/);
});

test('o × durante a montagem pede confirmação; cancelar ou falhar volta à edição sem perder nada', () => {
  assert.match(studio, /Alert\.alert\('Cancelar a montagem\?'/);
  assert.match(studio, /\{ text: 'Cancelar a montagem', style: 'destructive', onPress: cancelBuild \}/);
  assert.match(studio, /function cancelBuild\(\) \{ if \(progressRef\.current === null\) return; cancelled\.current = true; gen\.current \+= 1; \}/);
  // Depois: a montagem acaba (progress volta a null, a edição fica ativa) e o que se editou fica (o estado não muda).
  assert.match(studio, /if \(cancelled\.current\) \{ cancelled\.current = false; play\(0\); return; \}/);
  assert.match(studio, /\} catch \{\n\s+setProgress\(null\);/);
});
