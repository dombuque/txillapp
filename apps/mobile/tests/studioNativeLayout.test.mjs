// Estúdio nativo: as medidas (topo → imagem → linha do tempo → folha), nos ecrãs de 411×914 dp (1080×2400 a 420 dpi) e de
// 360×740 dp. A folha nunca fica por cima da imagem: a coluna soma sempre a altura do ecrã.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const L = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'studio', 'nativeLayout.ts')).href);

/** A largura da imagem num ecrã e numa altura da folha (barras do sistema de 24 dp em cima e em baixo). */
function stage(winW, winH, sheet, kb = 0) {
  const timelineH = sheet === 'baixa' ? L.TIMELINE_H : L.TIMELINE_DENSE_H;
  const o = L.studioLayout({ winW, winH, top: 24, bottom: 24, kb, timelineH, sheet });
  const f = L.fitStage(winW, o.stageAreaH);
  // A coluna inteira cabe no ecrã: nada fica por trás de nada.
  const used = 24 + 24 + kb + L.TOP_H + (o.sheetH > 0 ? 0 : L.CONTROLS_H) + timelineH + L.SHEET_HEAD + o.sheetH + o.stageAreaH;
  assert.equal(used, winH, `${winW}×${winH} ${sheet}`);
  assert.ok(!f.shown || f.h <= o.stageAreaH - L.STAGE_PAD_V + 1, 'a imagem cabe na área dela');
  return { ...o, ...f };
}

test('411×914 dp: fechada 337 px de imagem, média 217 px, alta recolhe', () => {
  const b = stage(411, 914, 'baixa'), m = stage(411, 914, 'media'), a = stage(411, 914, 'alta');
  assert.deepEqual([b.w, b.shown], [337, true]);
  assert.deepEqual([m.w, m.shown, m.sheetH], [217, true, 275]);
  assert.equal(a.shown, false);
  assert.equal(a.sheetH, 586);
  // Média ≈ 38 % do ecrã (com a pega e os separadores).
  assert.ok(Math.abs((m.sheetH + L.SHEET_HEAD) / 914 - 0.38) < 0.01);
});

test('360×740 dp: fechada 239 px, média 133 px (como os 136 do site), alta recolhe', () => {
  const b = stage(360, 740, 'baixa'), m = stage(360, 740, 'media'), a = stage(360, 740, 'alta');
  assert.deepEqual([b.w, b.shown], [239, true]);
  assert.deepEqual([m.w, m.shown, m.sheetH], [133, true, 250]);
  assert.equal(a.shown, false);
  assert.ok(m.sheetH >= 250, 'o primeiro controlo de cada painel cabe inteiro');
});

test('com o teclado aberto o painel cabe por cima dele e a imagem recolhe', () => {
  const o = stage(411, 914, 'alta', 300);
  assert.equal(o.shown, false);
  assert.ok(o.sheetH >= 120);
  assert.ok(o.sheetH <= 914 - 48 - 300 - L.TOP_H - L.TIMELINE_DENSE_H - L.SHEET_HEAD);
});

test('fitStage: 9:16, dentro da largura, e recolhe abaixo de 96 px', () => {
  assert.deepEqual(L.fitStage(400, 2000), { w: 376, h: 668, shown: true });
  assert.equal(L.fitStage(400, 90).shown, false);
});

test('o estúdio nativo usa estas medidas: a folha no fim da coluna (não por cima), linha do tempo densa e sem a fila dos clipes nos efeitos', () => {
  const s = readFileSync(path.join(ROOT, 'src', 'components', 'TchekaStudio.native.tsx'), 'utf8');
  assert.match(s, /studioLayout\(\{ winH: win\.height/);
  assert.match(s, /dense=\{dense\}/);
  assert.doesNotMatch(s, /position: 'absolute', left: 0, right: 0, backgroundColor: '#0b0b11'/);
  const fx = readFileSync(path.join(ROOT, 'src', 'components', 'studio', 'native', 'NativeFxPanel.tsx'), 'utf8');
  assert.doesNotMatch(fx, /clipBar/);
  assert.match(fx, /label: 'Transição'/);
});
