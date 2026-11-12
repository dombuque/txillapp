/**
 * Como se escolhem fotos e vídeos do telemóvel.
 *
 * - iPhone: a galeria dentro do Txillapp (GalleryPicker, como no Instagram), com a licença das Fotos.
 * - Android: o seletor de fotos do sistema (Photo Picker, pelo expo-image-picker), que não precisa de licença nenhuma.
 *   A política do Google Play (Photo and Video Permissions) só deixa READ_MEDIA_IMAGES/READ_MEDIA_VIDEO a apps cujo
 *   núcleo é gerir a galeria; o app.json bloqueia-as (android.blockedPermissions). Guardar na galeria continua a
 *   funcionar: no Android 13+ escrever não precisa de licença, e até ao 12 usa-se WRITE_EXTERNAL_STORAGE.
 *
 * Sem react-native aqui, para os testes (node:test) o poderem importar.
 */
export function inAppGalleryFor(os: string): boolean {
  return os === 'ios';
}

/** Vídeos acima disto ficam de fora (o servidor recusa-os). */
export const MAX_PICK_VIDEO_MS = 60_500;

/** O que o seletor do sistema devolve (o essencial de um ImagePickerAsset). */
export interface PickedAsset { uri: string; type?: string | null; mimeType?: string | null; duration?: number | null; fileName?: string | null }

/** Passa o que veio do seletor do sistema para o formato da câmara (Shot), sem os vídeos longos demais. */
export function shotsFromPicker(list: PickedAsset[]): { shots: { uri: string; video: boolean; mime: string; durationMs?: number }[]; tooLong: number } {
  const shots: { uri: string; video: boolean; mime: string; durationMs?: number }[] = [];
  let tooLong = 0;
  for (const a of list) {
    const video = a.type === 'video' || /^video\//.test(a.mimeType ?? '');
    // O expo-image-picker dá a duração em milissegundos.
    const durationMs = video && a.duration ? Math.round(a.duration) : undefined;
    if (video && durationMs && durationMs > MAX_PICK_VIDEO_MS) { tooLong++; continue; }
    const mime = a.mimeType || (video ? 'video/mp4' : 'image/jpeg');
    shots.push({ uri: a.uri, video, mime, durationMs });
  }
  return { shots, tooLong };
}
