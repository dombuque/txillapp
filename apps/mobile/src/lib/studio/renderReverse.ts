/**
 * Inverter um vídeo na web: os frames do bocado cortado tiram-se uma vez (24 por segundo, até 15 s, com o lado maior a
 * 960 px) e ficam em memória como JPEG pequenos; ao tocar descodificam-se poucos de cada vez (uma cache curta, a pedir os
 * frames seguintes, que no inverso são os anteriores). Assim a memória fica em poucas dezenas de MB.
 */
import { REVERSE_FPS, reverseFrameCount } from './effects';

const LONG_SIDE = 960;
const CACHE = 10;

export class ReverseFrames {
  readonly key: string;
  readonly count: number;
  readonly w: number;
  readonly h: number;
  private blobs: Blob[];
  private decoded = new Map<number, ImageBitmap | HTMLImageElement>();
  private pending = new Set<number>();
  private last: ImageBitmap | HTMLImageElement | null = null;

  constructor(key: string, blobs: Blob[], w: number, h: number) {
    this.key = key;
    this.blobs = blobs;
    this.count = blobs.length;
    this.w = w;
    this.h = h;
  }

  /** A chave de um corte (o mesmo vídeo com outro corte precisa de outros frames). */
  static keyOf(uri: string, start: number, end: number) { return `${uri}|${start.toFixed(2)}|${end.toFixed(2)}`; }

  /**
   * Tira os frames de `uri` entre `start` e `end` (segundos do ficheiro). `onProgress` de 0 a 1; `cancel()` true pára.
   * Devolve null se o vídeo for comprido demais ou não se conseguir ler.
   */
  static async extract(uri: string, start: number, end: number, onProgress: (p: number) => void, cancel: () => boolean): Promise<ReverseFrames | null> {
    const count = reverseFrameCount(end - start);
    if (!count) return null;
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.crossOrigin = 'anonymous';
    v.setAttribute('playsinline', '');
    v.src = uri;
    try {
      await new Promise<void>((res, rej) => {
        if (v.readyState >= 2) return res();
        v.addEventListener('loadeddata', () => res(), { once: true });
        v.addEventListener('error', () => rej(new Error('video')), { once: true });
        setTimeout(() => rej(new Error('tempo')), 15000);
      });
      const vw = v.videoWidth || 720, vh = v.videoHeight || 1280;
      const k = Math.min(1, LONG_SIDE / Math.max(vw, vh));
      const c = document.createElement('canvas');
      c.width = Math.round(vw * k);
      c.height = Math.round(vh * k);
      const g = c.getContext('2d');
      if (!g) return null;
      const blobs: Blob[] = [];
      for (let i = 0; i < count; i++) {
        if (cancel()) return null;
        const at = Math.min(end - 0.001, start + (i + 0.5) / REVERSE_FPS);
        await new Promise<void>((res) => {
          const done = () => res();
          v.addEventListener('seeked', done, { once: true });
          setTimeout(done, 1500);
          v.currentTime = at;
        });
        g.drawImage(v, 0, 0, c.width, c.height);
        const b = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', 0.82));
        if (!b) return null;
        blobs.push(b);
        if (i % 4 === 0) onProgress(i / count);
      }
      onProgress(1);
      return new ReverseFrames(ReverseFrames.keyOf(uri, start, end), blobs, c.width, c.height);
    } catch {
      return null;
    } finally {
      v.removeAttribute('src');
      v.load();
    }
  }

  private async decode(i: number): Promise<ImageBitmap | HTMLImageElement | null> {
    const have = this.decoded.get(i);
    if (have) return have;
    if (this.pending.has(i)) return null;
    this.pending.add(i);
    try {
      const b = this.blobs[i];
      let img: ImageBitmap | HTMLImageElement;
      if (typeof createImageBitmap === 'function') img = await createImageBitmap(b);
      else {
        const url = URL.createObjectURL(b);
        img = await new Promise<HTMLImageElement>((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url; });
      }
      this.decoded.set(i, img);
      // Cache curta: fica com os mais perto do pedido.
      if (this.decoded.size > CACHE) {
        const far = [...this.decoded.keys()].sort((a, b) => Math.abs(b - i) - Math.abs(a - i));
        for (const k of far.slice(0, this.decoded.size - CACHE)) { const x = this.decoded.get(k); if (x && 'close' in x) x.close(); this.decoded.delete(k); }
      }
      return img;
    } catch {
      return null;
    } finally {
      this.pending.delete(i);
    }
  }

  /** O frame `i` se já estiver pronto (senão o último que se mostrou), e pede-se esse e os próximos (para trás). */
  frame(i: number): ImageBitmap | HTMLImageElement | null {
    const idx = Math.max(0, Math.min(this.count - 1, i));
    for (let k = 0; k < 4; k++) if (idx - k >= 0) void this.decode(idx - k);
    const have = this.decoded.get(idx);
    if (have) this.last = have;
    return have ?? this.last;
  }
  /** Espera pelo frame `i` (para a pausa e para a capa). */
  async frameAsync(i: number): Promise<ImageBitmap | HTMLImageElement | null> {
    const idx = Math.max(0, Math.min(this.count - 1, i));
    for (let n = 0; n < 50; n++) {
      const f = this.decoded.get(idx) ?? (await this.decode(idx));
      if (f) { this.last = f; return f; }
      await new Promise((r) => setTimeout(r, 20));
    }
    return this.last;
  }
  dispose() {
    this.decoded.forEach((x) => { if ('close' in x) x.close(); });
    this.decoded.clear();
    this.blobs = [];
  }
}
