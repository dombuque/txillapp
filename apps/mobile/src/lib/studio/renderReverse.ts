/**
 * Inverter um vídeo na web: os frames do bocado cortado tiram-se uma vez (24 por segundo, até 15 s, com o lado maior a
 * 960 px), a tocar o vídeo calado a 1,5× (requestVideoFrameCallback; sem isso, a saltar frame a frame), e ficam em memória
 * como JPEG pequenos; ao tocar descodificam-se poucos de cada vez (uma cache curta, a pedir os frames seguintes, que no
 * inverso são os anteriores). Assim a memória fica em poucas dezenas de MB e 4 s invertem-se em ~3 s.
 */
import { REVERSE_FPS, reverseFrameCount } from './effects';

const LONG_SIDE = 960;
const shut = (x: ImageBitmap | HTMLImageElement) => { if ('close' in x) x.close(); };
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
      const seek = (at: number) => new Promise<void>((res) => {
        const done = () => res();
        v.addEventListener('seeked', done, { once: true });
        setTimeout(done, 1500);
        v.currentTime = at;
      });
      const snap = () => { g.drawImage(v, 0, 0, c.width, c.height); return new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', 0.82)); };
      const at = (i: number) => Math.min(end - 0.001, start + (i + 0.5) / REVERSE_FPS);
      const slots: (Promise<Blob | null> | null)[] = new Array(count).fill(null);
      type VFC = HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number };
      const vv = v as VFC;
      // O mais rápido: tocar o bocado (a 1,5×, sem som) e apanhar os frames à passagem (requestVideoFrameCallback). Assim
      // não se salta para cada frame (cada salto obriga a descodificar desde o último keyframe).
      if (typeof vv.requestVideoFrameCallback === 'function') {
        await seek(start);
        let next = 0;
        await new Promise<boolean>((done) => {
          let last = performance.now();
          const guard = setInterval(() => { if (performance.now() - last > 2500) { clearInterval(guard); v.pause(); done(false); } }, 500);
          const onFrame = (_now: number, meta: { mediaTime: number }) => {
            last = performance.now();
            if (cancel()) { clearInterval(guard); v.pause(); done(false); return; }
            if (next < count && meta.mediaTime >= at(next) - 0.5 / REVERSE_FPS) {
              const shot = snap();
              while (next < count && meta.mediaTime >= at(next) - 0.5 / REVERSE_FPS) slots[next++] = shot;
              onProgress(next / count);
            }
            if (next >= count || meta.mediaTime >= end || v.ended) { clearInterval(guard); v.pause(); done(true); return; }
            vv.requestVideoFrameCallback!(onFrame);
          };
          vv.requestVideoFrameCallback!(onFrame);
          v.playbackRate = 1.5;
          v.play().catch(() => { clearInterval(guard); done(false); });
        });
        if (cancel()) return null;
      }
      // O que faltar (sem requestVideoFrameCallback, ou frames que o browser saltou): salta a cada um.
      for (let i = 0; i < count; i++) {
        if (slots[i]) continue;
        if (cancel()) return null;
        await seek(at(i));
        slots[i] = snap();
        if (i % 4 === 0) onProgress(i / count);
      }
      const blobs: Blob[] = [];
      for (const s of slots) { const b = await s; if (!b) return null; blobs.push(b); }
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
        // O último que se mostrou não se fecha (ainda pode ser desenhado); fecha-se quando outro o substituir.
        for (const k of far.slice(0, this.decoded.size - CACHE)) { const x = this.decoded.get(k); this.decoded.delete(k); if (x && x !== this.last) shut(x); }
      }
      return img;
    } catch {
      return null;
    } finally {
      this.pending.delete(i);
    }
  }

  private show(f: ImageBitmap | HTMLImageElement) {
    const old = this.last;
    this.last = f;
    if (old && old !== f && ![...this.decoded.values()].includes(old)) shut(old);
  }
  /** O frame `i` se já estiver pronto (senão o último que se mostrou), e pede-se esse e os próximos (para trás). */
  frame(i: number): ImageBitmap | HTMLImageElement | null {
    const idx = Math.max(0, Math.min(this.count - 1, i));
    for (let k = 0; k < 4; k++) if (idx - k >= 0) void this.decode(idx - k);
    const have = this.decoded.get(idx);
    if (have) this.show(have);
    return have ?? this.last;
  }
  /** Espera pelo frame `i` (para a pausa e para a capa). */
  async frameAsync(i: number): Promise<ImageBitmap | HTMLImageElement | null> {
    const idx = Math.max(0, Math.min(this.count - 1, i));
    for (let n = 0; n < 50; n++) {
      const f = this.decoded.get(idx) ?? (await this.decode(idx));
      if (f) { this.show(f); return f; }
      await new Promise((r) => setTimeout(r, 20));
    }
    return this.last;
  }
  dispose() {
    this.decoded.forEach((x) => shut(x));
    if (this.last) shut(this.last);
    this.last = null;
    this.decoded.clear();
    this.blobs = [];
  }
}
