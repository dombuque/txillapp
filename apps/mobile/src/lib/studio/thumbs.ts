/**
 * Miniaturas dos vídeos para a linha do tempo (só web): frames tirados com um <video> escondido e um canvas pequeno,
 * um ficheiro de cada vez e um frame de cada vez (o telemóvel não aguenta muitos vídeos a descodificar). Ficam em memória
 * por ficheiro e instante (arredondado), como JPEG pequeno.
 */
const cache = new Map<string, string>();
const waiting = new Map<string, ((url: string) => void)[]>();
const queue: { uri: string; t: number; id: string }[] = [];
let busy = false;
const H = 96;

export const thumbId = (uri: string, t: number) => `${uri}@${t.toFixed(2)}`;
export const cachedThumb = (uri: string, t: number) => cache.get(thumbId(uri, t)) ?? null;

/** O frame de `uri` no instante `t` (segundos do ficheiro). */
export function videoThumb(uri: string, t: number): Promise<string> {
  const id = thumbId(uri, t);
  const have = cache.get(id);
  if (have) return Promise.resolve(have);
  return new Promise((res) => {
    const l = waiting.get(id);
    if (l) { l.push(res); return; }
    waiting.set(id, [res]);
    queue.push({ uri, t, id });
    void pump();
  });
}

const videos = new Map<string, HTMLVideoElement>();
function videoOf(uri: string): HTMLVideoElement {
  let v = videos.get(uri);
  if (!v) {
    v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.crossOrigin = 'anonymous';
    v.src = uri;
    videos.set(uri, v);
    if (videos.size > 6) { const [k, old] = videos.entries().next().value as [string, HTMLVideoElement]; old.removeAttribute('src'); old.load(); videos.delete(k); }
  }
  return v;
}
const once = (v: HTMLVideoElement, ev: string, ms: number) => new Promise<void>((r) => { const t = setTimeout(r, ms); v.addEventListener(ev, () => { clearTimeout(t); r(); }, { once: true }); });

async function pump() {
  if (busy) return;
  busy = true;
  try {
    while (queue.length) {
      // O mais recente primeiro: é o que está à vista agora.
      const job = queue.pop()!;
      if (cache.has(job.id)) { flush(job.id); continue; }
      let url = '';
      try {
        const v = videoOf(job.uri);
        if (v.readyState < 1) await once(v, 'loadedmetadata', 4000);
        const to = Math.max(0, Math.min((v.duration || job.t) - 0.05, job.t));
        if (Math.abs(v.currentTime - to) > 0.01) { v.currentTime = to; await once(v, 'seeked', 2500); }
        if (v.readyState >= 2 && v.videoWidth) {
          const c = document.createElement('canvas');
          c.height = H;
          c.width = Math.round((H * v.videoWidth) / v.videoHeight) || 54;
          c.getContext('2d')?.drawImage(v, 0, 0, c.width, c.height);
          url = c.toDataURL('image/jpeg', 0.6);
        }
      } catch { /* fica sem miniatura */ }
      cache.set(job.id, url);
      flush(job.id);
    }
  } finally {
    busy = false;
  }
}
function flush(id: string) {
  const url = cache.get(id) ?? '';
  for (const f of waiting.get(id) ?? []) f(url);
  waiting.delete(id);
}

/** O ficheiro saiu (URL libertado): larga o <video> escondido dele. As miniaturas já tiradas ficam (são data URLs). */
export function dropThumbVideo(uri: string) {
  const v = videos.get(uri);
  if (!v) return;
  v.removeAttribute('src');
  v.load();
  videos.delete(uri);
}