import type { PickedAudio } from './pickAudio';

export type { PickedAudio };

/** No site escolhe-se o ficheiro com o seletor do browser (MP3, M4A ou AAC). */
export const canPickAudio = true;

const MIME_BY_EXT: Record<string, string> = { mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac' };

/** A duração lida pelo browser (para avisar logo se o trecho passa do fim); null se não der. */
function readDuration(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    const a = new Audio();
    const done = (v: number | null) => { a.removeAttribute('src'); resolve(v); };
    a.preload = 'metadata';
    a.onloadedmetadata = () => done(Number.isFinite(a.duration) && a.duration > 0 ? Math.round(a.duration * 1000) : null);
    a.onerror = () => done(null);
    setTimeout(() => done(null), 8000);
    a.src = url;
  });
}

export function pickAudio(): Promise<PickedAudio | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.mp3,.m4a,.aac,audio/mpeg,audio/mp4,audio/aac,audio/x-m4a';
    input.style.display = 'none';
    input.onchange = async () => {
      const f = input.files?.[0];
      input.remove();
      if (!f) return resolve(null);
      const ext = (f.name.split('.').pop() ?? '').toLowerCase();
      const mime = MIME_BY_EXT[ext] ?? (f.type === 'audio/mp3' ? 'audio/mpeg' : f.type === 'audio/x-m4a' ? 'audio/mp4' : f.type);
      const uri = URL.createObjectURL(f);
      resolve({ uri, mime, name: f.name, size: f.size, durationMs: await readDuration(uri) });
    };
    document.body.appendChild(input);
    input.click();
  });
}
