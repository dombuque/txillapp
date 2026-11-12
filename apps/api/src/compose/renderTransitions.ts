/**
 * As transições entre clipes no canvas 2D: `prev` é o último frame do clipe anterior (parado, já com os efeitos dele) e
 * `cur` o frame de agora do clipe que entra; `p` vai de 0 a 1 ao longo da transição. Só usa o canvas 2D (funciona igual no
 * browser e num canvas do Node, se o servidor quiser o desenho igual em vez do `xfade` do ffmpeg).
 */
import { easeInOutCubic, type TransitionId } from './effects';

type Src = CanvasImageSource;
type Ctx = CanvasRenderingContext2D;
/** Um canvas de trabalho com o tamanho pedido (o estúdio guarda-os para não criar um por frame). */
export type Scratch = (name: string, w: number, h: number) => { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null;

/** Quanto é preciso ampliar um quadro w×h rodado `deg` graus para não se verem cantos vazios. */
export function coverScaleForRotation(w: number, h: number, deg: number): number {
  const a = Math.abs((deg * Math.PI) / 180), c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  return Math.max((w * c + h * s) / w, (w * s + h * c) / h);
}
/** Pseudo-aleatório estável (o glitch é igual em cada volta e na montagem). */
const rnd = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

function drawAt(g: Ctx, src: Src, W: number, H: number, o: { alpha?: number; scale?: number; rot?: number; dx?: number; dy?: number } = {}) {
  g.save();
  g.globalAlpha = o.alpha ?? 1;
  g.translate(W / 2 + (o.dx ?? 0), H / 2 + (o.dy ?? 0));
  if (o.rot) g.rotate((o.rot * Math.PI) / 180);
  const s = o.scale ?? 1;
  g.scale(s, s);
  g.drawImage(src, -W / 2, -H / 2, W, H);
  g.restore();
}
/** Desfoque barato e igual em todo o lado: reduzir e voltar a ampliar (duas vezes, para ficar suave). */
function blurred(src: Src, W: number, H: number, amount: number, scratch: Scratch, tag: string): Src {
  if (amount < 0.02) return src;
  const k = 1 + amount * 26;
  const w1 = Math.max(4, Math.round(W / k)), h1 = Math.max(4, Math.round(H / k));
  const a = scratch(`${tag}-a`, w1, h1), b = scratch(`${tag}-b`, Math.max(4, Math.round(w1 / 2)), Math.max(4, Math.round(h1 / 2)));
  if (!a || !b) return src;
  a.g.imageSmoothingEnabled = b.g.imageSmoothingEnabled = true;
  a.g.clearRect(0, 0, w1, h1);
  a.g.drawImage(src, 0, 0, w1, h1);
  b.g.drawImage(a.c, 0, 0, b.c.width, b.c.height);
  a.g.drawImage(b.c, 0, 0, w1, h1);
  return a.c;
}

/** Desenha a transição `type` no ponto `p` (0 a 1) por cima de tudo o que já estiver em `g` (W×H). */
export function drawTransition(g: Ctx, prev: Src, cur: Src, type: TransitionId, p: number, W: number, H: number, scratch: Scratch): void {
  const e = easeInOutCubic(p);
  const bell = Math.sin(Math.PI * Math.min(1, Math.max(0, p)));
  g.save();
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  switch (type) {
    case 'fundido':
      drawAt(g, cur, W, H);
      drawAt(g, prev, W, H, { alpha: 1 - e });
      break;
    case 'deslizar-esquerda':
      drawAt(g, prev, W, H, { dx: -W * e });
      drawAt(g, cur, W, H, { dx: W * (1 - e) });
      break;
    case 'deslizar-direita':
      drawAt(g, prev, W, H, { dx: W * e });
      drawAt(g, cur, W, H, { dx: -W * (1 - e) });
      break;
    case 'deslizar-cima':
      drawAt(g, prev, W, H, { dy: -H * e });
      drawAt(g, cur, W, H, { dy: H * (1 - e) });
      break;
    case 'deslizar-baixo':
      drawAt(g, prev, W, H, { dy: H * e });
      drawAt(g, cur, W, H, { dy: -H * (1 - e) });
      break;
    case 'zoom':
      // Entra-se no anterior (amplia e desaparece) e o novo assenta de perto.
      drawAt(g, cur, W, H, { scale: 1.4 - 0.4 * e });
      drawAt(g, prev, W, H, { scale: 1 + 1.2 * e, alpha: 1 - Math.min(1, e * 1.25) });
      break;
    case 'desfoque': {
      const first = p < 0.5;
      drawAt(g, blurred(first ? prev : cur, W, H, bell, scratch, 'tb'), W, H);
      const mix = Math.min(1, Math.max(0, (p - 0.35) / 0.3));
      if (first && mix > 0) drawAt(g, blurred(cur, W, H, bell, scratch, 'tc'), W, H, { alpha: mix });
      else if (!first && mix < 1) drawAt(g, blurred(prev, W, H, bell, scratch, 'tc'), W, H, { alpha: 1 - mix });
      break;
    }
    case 'girar': {
      // Meia volta: o anterior roda até 90° e o novo vem de -90°; ampliados para não haver cantos vazios.
      const rot = p < 0.5 ? 180 * e : -180 * (1 - e);
      const s = coverScaleForRotation(W, H, rot) * (1 + 0.15 * bell);
      drawAt(g, blurred(p < 0.5 ? prev : cur, W, H, bell * 0.35, scratch, 'tr'), W, H, { rot, scale: s });
      break;
    }
    case 'flash': {
      drawAt(g, p < 0.5 ? prev : cur, W, H);
      g.globalAlpha = Math.pow(bell, 1.6);
      g.fillStyle = '#fff';
      g.fillRect(0, 0, W, H);
      g.globalAlpha = 1;
      break;
    }
    case 'brilho': {
      // Fundido com uma luz quente que atravessa o quadro (coral e dourado), em modo de luz.
      drawAt(g, cur, W, H);
      drawAt(g, prev, W, H, { alpha: 1 - e });
      g.globalCompositeOperation = 'lighter';
      drawAt(g, blurred(p < 0.5 ? prev : cur, W, H, 0.6, scratch, 'tg'), W, H, { alpha: 0.55 * bell });
      const cx = -W * 0.3 + W * 1.6 * p, cy = H * (0.35 + 0.2 * p);
      const R = Math.max(W, H) * 0.75;
      const grad = g.createRadialGradient(cx, cy, 0, cx, cy, R);
      grad.addColorStop(0, `rgba(255,214,140,${0.85 * bell})`);
      grad.addColorStop(0.35, `rgba(255,92,108,${0.45 * bell})`);
      grad.addColorStop(1, 'rgba(255,92,108,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'source-over';
      break;
    }
    case 'glitch': {
      const base = p < 0.5 ? prev : cur;
      const other = p < 0.5 ? cur : prev;
      drawAt(g, base, W, H);
      const step = Math.floor(p * 14);
      const bands = 9;
      for (let i = 0; i < bands; i++) {
        const r = rnd(step * 31 + i);
        if (r > 0.25 + 0.5 * (1 - bell)) continue;
        const y = Math.floor(rnd(step * 7 + i * 3) * H);
        const bh = Math.max(8, Math.floor(rnd(step + i * 11) * H * 0.09));
        const dx = (rnd(step * 13 + i) - 0.5) * W * 0.22 * bell;
        const src = rnd(i * 17 + step) > 0.5 ? other : base;
        g.drawImage(src, 0, y, W, bh, dx, y, W, bh);
      }
      // Separação das cores: tiras cião e magenta, em modo de ecrã.
      g.globalCompositeOperation = 'screen';
      g.globalAlpha = 0.5 * bell;
      g.fillStyle = 'rgba(0,255,240,0.35)';
      g.fillRect(rnd(step + 1) * W * 0.06, 0, W, H * 0.5 * rnd(step + 2));
      g.fillStyle = 'rgba(255,0,170,0.35)';
      g.fillRect(-rnd(step + 3) * W * 0.06, H * rnd(step + 4) * 0.6, W, H * 0.3);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
      break;
    }
    case 'corte':
    default:
      drawAt(g, cur, W, H);
  }
  g.restore();
}
