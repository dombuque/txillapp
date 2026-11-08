import { fetchAuthed } from './api';

/** No browser: no telemóvel abre a folha do sistema (Guardar imagem/vídeo); no computador descarrega o ficheiro. */
export async function saveToGallery(path: string, name: string): Promise<'saved' | 'denied'> {
  const res = await fetchAuthed(path);
  if (!res.ok) throw new Error('Não consegui preparar o ficheiro');
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
