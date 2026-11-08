import { File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library/legacy';
import { authHeaders } from './api';
import { SITE_URL } from './config';

/** Descarrega um ficheiro da API (caminho sem o /api/v1, com sessão) e guarda-o na galeria do telemóvel. */
export async function saveToGallery(path: string, name: string): Promise<'saved' | 'denied'> {
  const perm = await MediaLibrary.requestPermissionsAsync(true);
  if (!perm.granted) return 'denied';
  const dest = new File(Paths.cache, name);
  if (dest.exists) dest.delete();
  const f = await File.downloadFileAsync(`${SITE_URL}/api/v1${path}`, dest, { headers: authHeaders() });
  await MediaLibrary.saveToLibraryAsync(f.uri);
  try { f.delete(); } catch { /* fica na cache */ }
  return 'saved';
}
