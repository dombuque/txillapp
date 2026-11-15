import { fetchAuthed } from './api';

/** No browser: no telemóvel abre a folha do sistema (Guardar imagem/vídeo); no computador descarrega o ficheiro. */
export async function saveToGallery(path: string, name: string): Promise<'saved' | 'denied'> {
  const res = await fetchAuthed(path);
  // A recusa da API traz a razão (por exemplo, quem publicou não deixa guardar as suas tchekas): mostra-se essa.
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: unknown } | null;
    const msg = Array.isArray(body?.message) ? body.message[0] : body?.message;
    throw new Error(typeof msg === 'string' && msg.trim() ? msg : 'Não consegui preparar o ficheiro');
  }
  const blob = await res.blob();
  const f = new File([blob], name, { type: blob.type });
  if (navigator.canShare?.({ files: [f] })) {
    try {
      await navigator.share({ files: [f] });
      return 'saved';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'saved';
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(f);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 8000);
  return 'saved';
}
