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
  // Filtro, transição, texto, cor e sticker: lidos a cada frame (cfg.current) e, em pausa, redesenhados no frame parado.
  assert.match(studio, /cfg\.current\.transition/);
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
  assert.match(studio, /if \(playingRef\.current\) pause\(\);\s*onClose\(\);/, 'o × pára antes de fechar');
  assert.match(studio, /e\.videos\.forEach\(\(v\) => \{ v\.pause\(\);/, 'ao desmontar, os vídeos param');
  assert.match(studio, /void e\.ac\?\.close\(\)/, 'e o som fecha');
});
