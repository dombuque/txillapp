/**
 * O desenho do pano no canvas 2D: o azulejo (em cache, num OffscreenCanvas quando há), as transições de capulana (no mesmo
 * formato de `drawTransition` do renderTransitions.ts), a moldura das fotos que não são 9:16, a faixa para o texto, as letras
 * preenchidas com o pano e os stickers. Só usa o canvas 2D (funciona igual no browser e num canvas do Node: o servidor só
 * tem de dar a fábrica de canvas com `setCapulanaCanvasFactory`).
 */
import { TILE_SIZE, capulanaKey, capulanaTile, paletteById, type CapulanaSpec } from './capulana';
import { frameLayout, panoShape, stickerOutline, type Box, type CapulanaShapeId, type CapulanaTransitionId, type FrameLayout, type Pt } from './capulanaShapes';

type Ctx = CanvasRenderingContext2D;
type Src = CanvasImageSource;
type TileCanvas = { width: number; height: number; getContext(kind: '2d'): unknown };

let factory: (w: number, h: number) => TileCanvas | null = (w, h) => {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h) as unknown as TileCanvas;
  if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = w; c.height = h; return c as unknown as TileCanvas; }
  return null;
};
/** Fora do browser (canvas do Node): quem cria os canvas de trabalho. */
export function setCapulanaCanvasFactory(f: (w: number, h: number) => TileCanvas | null): void { factory = f; tiles.clear(); }

const tiles = new Map<string, TileCanvas>();
const MAX_TILES = 24;
/** O azulejo de um pano num canvas (gera-se uma vez: uns 20 ms; depois vem da cache). */
export function capulanaTileCanvas(spec: CapulanaSpec, size: number = TILE_SIZE): TileCanvas | null {
  const key = `${capulanaKey(spec)}@${size}`;
  const hit = tiles.get(key);
  if (hit) return hit;
  const c = factory(size, size);
  const g = c?.getContext('2d') as Ctx | null | undefined;
  if (!c || !g) return null;
  const img = g.createImageData(size, size);
  img.data.set(capulanaTile(spec, size));
  g.putImageData(img, 0, 0);
  if (tiles.size >= MAX_TILES) tiles.delete(tiles.keys().next().value as string);
  tiles.set(key, c);
  return c;
}
/** Liberta os azulejos em cache (ao fechar o estúdio). */
export const clearCapulanaCache = () => tiles.clear();

/** O lado do motivo no quadro: um terço da largura (três azulejos de lado a lado em 1080). */
export const clothTile = (W: number) => Math.round(W / 3);

function trace(g: Ctx, polys: Pt[][], close = true) {
  g.beginPath();
  for (const poly of polys) {
    poly.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    if (close) g.closePath();
  }
}

/** Enche a caixa com o pano (o azulejo com `tile` px de lado, deslocado `shift`). Quem chama já fez o `clip`. */
export function paintCloth(g: Ctx, spec: CapulanaSpec, box: Box, tile: number, shift: Pt = [0, 0], folds = 0): void {
  const c = capulanaTileCanvas(spec);
  const pal = paletteById(spec.palette).colors;
  if (!c) { g.fillStyle = pal[1]; g.fillRect(box.x, box.y, box.w, box.h); return; }
  const k = tile / c.width;
  const ox = ((shift[0] % tile) + tile) % tile, oy = ((shift[1] % tile) + tile) % tile;
  g.save();
  g.translate(ox - tile, oy - tile);
  g.scale(k, k);
  const pat = g.createPattern(c as unknown as CanvasImageSource, 'repeat');
  g.fillStyle = pat ?? pal[1];
  g.fillRect((box.x - ox + tile) / k - 1, (box.y - oy + tile) / k - 1, (box.w + tile) / k + 2, (box.h + tile) / k + 2);
  g.restore();
  if (folds > 0) {
    // As dobras do pano: riscas largas e suaves de sombra e de luz, que andam com ele.
    const span = tile * 2.2;
    const x0 = box.x - span + (((shift[0] * 0.6) % span) + span) % span;
    for (let x = x0; x < box.x + box.w; x += span) {
      const gr = g.createLinearGradient(x, 0, x + span, 0);
      gr.addColorStop(0, `rgba(0,0,0,${0.2 * folds})`);
      gr.addColorStop(0.3, 'rgba(0,0,0,0)');
      gr.addColorStop(0.55, `rgba(255,255,255,${0.09 * folds})`);
      gr.addColorStop(0.75, 'rgba(0,0,0,0)');
      gr.addColorStop(1, `rgba(0,0,0,${0.2 * folds})`);
      g.fillStyle = gr;
      g.fillRect(x, box.y, span + 1, box.h);
    }
  }
}

function strokeLines(g: Ctx, lines: Pt[][], width: number, color: string, alpha = 1) {
  if (!lines.length) return;
  g.save();
  g.globalAlpha = alpha;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.lineWidth = width;
  g.strokeStyle = color;
  trace(g, lines, false);
  g.stroke();
  g.restore();
}

/**
 * Desenha a transição de capulana `type` no ponto `p` (0 a 1) por cima do que estiver em `g` (W×H). `prev` é o último frame
 * do clipe anterior (parado) e `cur` o frame de agora do que entra, tal como em `drawTransition`.
 */
export function drawCapulanaTransition(g: Ctx, prev: Src, cur: Src, type: CapulanaTransitionId, p: number, W: number, H: number, spec: CapulanaSpec): void {
  const s = panoShape(type, p, W, H);
  const pal = paletteById(spec.palette).colors;
  const full = { x: 0, y: 0, w: W, h: H };
  g.save();
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.drawImage(s.base === 'prev' ? prev : cur, 0, 0, W, H);
  if (s.base === 'prev' && s.reveal.length) {
    g.save();
    trace(g, s.reveal);
    g.clip();
    g.drawImage(cur, 0, 0, W, H);
    g.restore();
  }
  // A sombra que o pano faz no que está por baixo.
  strokeLines(g, s.hems, W * 0.06, '#000', 0.14);
  strokeLines(g, s.hems, W * 0.03, '#000', 0.18);
  g.save();
  trace(g, s.cloth);
  g.clip('evenodd');
  paintCloth(g, spec, full, clothTile(W), s.shift, 1);
  g.restore();
  // A bainha: um fio claro e outro escuro ao longo das bordas.
  strokeLines(g, s.hems, W * 0.014, pal[4]);
  strokeLines(g, s.hems, W * 0.004, pal[0]);
  for (const r of s.rolls) {
    // O rolo: o pano apertado (o desenho encolhido na vertical) e o brilho de um cilindro.
    g.save();
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.fillRect(r.x, r.y + r.h * 0.55, r.w, r.h * 0.8);
    g.beginPath();
    g.rect(r.x, r.y, r.w, r.h);
    g.clip();
    g.translate(0, r.y);
    g.scale(1, 0.4);
    paintCloth(g, spec, { x: r.x, y: 0, w: r.w, h: r.h / 0.4 }, clothTile(W), [0, p * H * 3]);
    g.restore();
    const gr = g.createLinearGradient(0, r.y, 0, r.y + r.h);
    gr.addColorStop(0, 'rgba(0,0,0,0.5)');
    gr.addColorStop(0.32, 'rgba(255,255,255,0.28)');
    gr.addColorStop(0.55, 'rgba(0,0,0,0)');
    gr.addColorStop(1, 'rgba(0,0,0,0.6)');
    g.fillStyle = gr;
    g.fillRect(r.x, r.y, r.w, r.h);
  }
  g.restore();
}

function roundRect(g: Ctx, b: Box, r: number) {
  const q = Math.max(0, Math.min(r, b.w / 2, b.h / 2));
  g.beginPath();
  g.moveTo(b.x + q, b.y);
  g.arcTo(b.x + b.w, b.y, b.x + b.w, b.y + b.h, q);
  g.arcTo(b.x + b.w, b.y + b.h, b.x, b.y + b.h, q);
  g.arcTo(b.x, b.y + b.h, b.x, b.y, q);
  g.arcTo(b.x, b.y, b.x + b.w, b.y, q);
  g.closePath();
}
const grow = (b: Box, d: number): Box => ({ x: b.x - d, y: b.y - d, w: b.w + 2 * d, h: b.h + 2 * d });

/** O fundo de pano (em vez do fundo desfocado): o pano em todo o quadro, escurecido para a foto sobressair. */
export function drawCapulanaBackdrop(g: Ctx, spec: CapulanaSpec, W: number, H: number, dim = 0.34): void {
  g.save();
  paintCloth(g, spec, { x: 0, y: 0, w: W, h: H }, clothTile(W));
  const gr = g.createRadialGradient(W / 2, H * 0.46, W * 0.2, W / 2, H * 0.46, H * 0.72);
  gr.addColorStop(0, `rgba(0,0,0,${dim * 0.55})`);
  gr.addColorStop(1, `rgba(0,0,0,${Math.min(0.9, dim * 1.9)})`);
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
  g.restore();
}

/**
 * A moldura de capulana: o pano ao fundo e a foto inteira por cima, com margem clara, fio e sombra. `zoom` é o zoom lento da
 * foto (1 = parada) e `focus` o ponto para onde ele aponta (frações da foto).
 */
export function drawCapulanaFrame(g: Ctx, img: Src, iw: number, ih: number, W: number, H: number, spec: CapulanaSpec, zoom = 1, focus: { x: number; y: number } = { x: 0.5, y: 0.5 }): FrameLayout {
  const pal = paletteById(spec.palette).colors;
  const lay = frameLayout(iw, ih, W, H);
  const ph = lay.photo;
  drawCapulanaBackdrop(g, spec, W, H);
  g.save();
  const outer = grow(ph, lay.border);
  for (let i = 4; i >= 1; i--) {
    g.fillStyle = `rgba(0,0,0,${0.09})`;
    roundRect(g, { ...grow(outer, i * W * 0.008), y: outer.y - i * W * 0.004 + W * 0.014 }, lay.radius + i * W * 0.008);
    g.fill();
  }
  g.fillStyle = pal[0];
  roundRect(g, grow(outer, lay.line), lay.radius + lay.line);
  g.fill();
  g.fillStyle = pal[4];
  roundRect(g, outer, lay.radius);
  g.fill();
  roundRect(g, ph, Math.max(2, lay.radius / 2));
  g.clip();
  const z = Math.max(1, zoom);
  const fx = ph.x + ph.w * focus.x, fy = ph.y + ph.h * focus.y;
  g.translate(fx, fy);
  g.scale(z, z);
  g.translate(-fx, -fy);
  g.drawImage(img, ph.x, ph.y, ph.w, ph.h);
  g.restore();
  return lay;
}

export interface BandOptions {
  /** O centro da faixa (px) e a altura dela. */
  y: number; h: number;
  text?: string;
  /** O `font` do canvas sem o tamanho (por exemplo `800 {size}px TxInter, sans-serif`): `{size}` é trocado pelo tamanho. */
  font?: string;
  /** 0 a 1: a faixa a entrar (cresce do meio). */
  open?: number;
}
/** A faixa de capulana para o texto: duas barras de pano e, a meio, uma placa na cor do fundo com as letras claras. */
export function drawCapulanaBand(g: Ctx, spec: CapulanaSpec, W: number, o: BandOptions): Box {
  const pal = paletteById(spec.palette).colors;
  const open = Math.max(0, Math.min(1, o.open ?? 1));
  const h = o.h * open;
  const box = { x: 0, y: o.y - h / 2, w: W, h };
  if (h < 2) return box;
  g.save();
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect(0, box.y + h * 0.06, W, h);
  g.beginPath();
  g.rect(0, box.y, W, h);
  g.clip();
  paintCloth(g, spec, { x: 0, y: o.y - o.h / 2, w: W, h: o.h }, Math.round(o.h * 0.5));
  const plate = { x: 0, y: o.y - h * 0.29, w: W, h: h * 0.58 };
  g.fillStyle = pal[0];
  g.fillRect(plate.x, plate.y, plate.w, plate.h);
  g.fillStyle = pal[4];
  const line = Math.max(2, o.h * 0.022);
  g.fillRect(0, plate.y - line, W, line);
  g.fillRect(0, plate.y + plate.h, W, line);
  g.fillRect(0, box.y, W, line * 0.8);
  g.fillRect(0, box.y + h - line * 0.8, W, line * 0.8);
  if (o.text && open > 0.6) {
    let size = Math.round(o.h * 0.34);
    const font = (px: number) => (o.font ?? '800 {size}px Inter, system-ui, sans-serif').replace('{size}', String(px));
    g.font = font(size);
    const tw = g.measureText(o.text).width;
    if (tw > W * 0.88) { size = Math.max(14, Math.floor((size * W * 0.88) / tw)); g.font = font(size); }
    g.globalAlpha = (open - 0.6) / 0.4;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = pal[4];
    g.fillText(o.text, W / 2, o.y + size * 0.04);
  }
  g.restore();
  return box;
}

export interface ClothTextOptions {
  /** O centro do texto (px). */
  x: number; y: number;
  /** A altura da letra (px) e o `font` do canvas já com ela. */
  size: number; font: string;
  /** Um canvas de trabalho (o estúdio guarda-os; o mesmo formato do `Scratch` do renderTransitions.ts). */
  scratch: (name: string, w: number, h: number) => { c: CanvasImageSource; g: Ctx } | null;
  /** O contorno escuro à volta das letras (por omissão sim: é o que as deixa ler por cima de qualquer vídeo). */
  outline?: boolean;
  alpha?: number;
}
/** Letras preenchidas com o pano (uma linha por `\n`), com contorno e sombra. Devolve a caixa do texto. */
export function drawCapulanaText(g: Ctx, text: string, spec: CapulanaSpec, o: ClothTextOptions): Box {
  const pal = paletteById(spec.palette).colors;
  const lines = text.split('\n');
  const lh = o.size * 1.12;
  g.save();
  g.font = o.font;
  const tw = Math.max(1, ...lines.map((l) => g.measureText(l).width));
  g.restore();
  const pad = Math.ceil(o.size * 0.3);
  const w = Math.ceil(tw + pad * 2), h = Math.ceil(lh * lines.length + pad * 2);
  const box = { x: o.x - w / 2, y: o.y - h / 2, w, h };
  const sc = o.scratch('capulana-texto', w, h);
  const put = (c: Ctx, fill: boolean) => lines.forEach((l, i) => { const y = pad + lh * (i + 0.5); if (fill) c.fillText(l, w / 2, y); else c.strokeText(l, w / 2, y); });
  g.save();
  g.globalAlpha = o.alpha ?? 1;
  g.translate(box.x, box.y);
  g.font = o.font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  if (o.outline !== false) {
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = o.size * 0.3;
    g.translate(0, o.size * 0.05);
    put(g, false);
    g.translate(0, -o.size * 0.05);
    g.strokeStyle = pal[0];
    g.lineWidth = o.size * 0.2;
    put(g, false);
    g.strokeStyle = pal[4];
    g.lineWidth = o.size * 0.085;
    put(g, false);
  }
  if (sc) {
    const s = sc.g;
    s.save();
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.globalCompositeOperation = 'source-over';
    s.globalAlpha = 1;
    s.clearRect(0, 0, w, h);
    s.font = o.font;
    s.textAlign = 'center';
    s.textBaseline = 'middle';
    s.fillStyle = '#fff';
    put(s, true);
    s.globalCompositeOperation = 'source-in';
    paintCloth(s, spec, { x: 0, y: 0, w, h }, Math.max(48, Math.round(o.size * 0.9)));
    s.restore();
    g.drawImage(sc.c, 0, 0, w, h, 0, 0, w, h);
  } else {
    g.fillStyle = pal[1];
    put(g, true);
  }
  g.restore();
  return box;
}

/** Um sticker de pano: a forma recortada (com a margem branca de um autocolante) e o pano por dentro. */
export function drawCapulanaSticker(g: Ctx, shape: CapulanaShapeId, spec: CapulanaSpec, x: number, y: number, r: number, rot = 0): void {
  const pal = paletteById(spec.palette).colors;
  const out = stickerOutline(shape, r);
  g.save();
  g.translate(x, y);
  if (rot) g.rotate((rot * Math.PI) / 180);
  g.lineJoin = 'round';
  g.save();
  g.translate(0, r * 0.05);
  trace(g, [out]);
  g.strokeStyle = 'rgba(0,0,0,0.3)';
  g.lineWidth = r * 0.24;
  g.stroke();
  g.restore();
  trace(g, [out]);
  g.strokeStyle = '#fff';
  g.lineWidth = r * 0.18;
  g.stroke();
  g.fillStyle = '#fff';
  g.fill();
  g.save();
  trace(g, [out]);
  g.clip();
  paintCloth(g, spec, { x: -r, y: -r, w: 2 * r, h: 2 * r }, Math.round(r * 0.9));
  g.restore();
  trace(g, [out]);
  g.strokeStyle = pal[0];
  g.lineWidth = Math.max(1.5, r * 0.025);
  g.stroke();
  g.restore();
}
