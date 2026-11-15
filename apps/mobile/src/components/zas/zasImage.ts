import { File as FsFile, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Alert, Platform, Share } from 'react-native';
import { authHeaders, fetchAuthed } from '@/lib/api';
import { SITE_URL } from '@/lib/config';
import { saveToGallery } from '@/lib/saveToGallery';

/**
 * Guardar e partilhar os MEUS Zás (só aparecem no visor dos meus e no menu de «Os meus Zás»). A imagem vem sempre do
 * servidor, `GET /instants/:id/download`: o Zás com o desenho da app (api/src/instants/zas-card.ts), num quadro 9:16 — o
 * cartão squircle com a foto, a legenda na curva na letra escolhida, a marca do Zás e a hora — e a assinatura do Txillapp
 * (o logótipo e o meu @, com o selo se a conta for verificada) no canto de baixo, fora da foto. No telemóvel e na web sai o
 * mesmo ficheiro, e partilhar leva esse ficheiro (nunca a foto crua).
 */
type Z = { id: string; url: string; caption?: string };
const downloadPath = (it: Z) => `/instants/${it.id}/download`;
const fileName = (it: Z) => `txillapp-zas-${it.id.slice(0, 8)}.jpg`;

/** Na web: o JPEG assinado como ficheiro (com a sessão, como os outros pedidos da app). */
async function signedFile(it: Z): Promise<File> {
  const res = await fetchAuthed(downloadPath(it));
  if (!res.ok) throw new Error('Não consegui preparar o Zás');
  const blob = await res.blob();
  return new File([blob], fileName(it), { type: blob.type || 'image/jpeg' });
}

/** Descarrega um ficheiro (sem folha de partilha). */
function downloadFile(f: File) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(f);
  a.download = f.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 8000);
}

/**
 * Guardar o Zás, assinado. No telemóvel vai direto para a galeria; devolve 'saved' quando lá ficou, 'denied' sem licença
 * (avisa), 'failed' se não deu. Na web, 'gallery' abre a folha do sistema no telemóvel («Guardar imagem») e 'file'
 * descarrega o JPG; devolve 'failed' se não deu, nada quando correu bem.
 */
export async function saveZas(it: Z, mode: 'gallery' | 'file' = 'gallery'): Promise<'saved' | 'denied' | 'failed' | void> {
  if (Platform.OS !== 'web') {
    try {
      const r = await saveToGallery(downloadPath(it), fileName(it));
      if (r === 'denied') Alert.alert('Sem acesso à galeria', 'Dá acesso às fotos nas definições do telemóvel para guardar o Zás.');
      return r;
    } catch {
      return 'failed';
    }
  }
  try {
    const f = await signedFile(it);
    if (mode === 'gallery' && navigator.canShare?.({ files: [f] })) {
      try {
        return void (await navigator.share({ files: [f] }));
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
      }
    }
    downloadFile(f);
  } catch {
    return 'failed';
  }
}

/** No telemóvel: o Zás desenhado, descarregado para a cache (com a sessão), para a folha de partilha. */
async function signedCacheFile(it: Z): Promise<string> {
  const dest = new FsFile(Paths.cache, fileName(it));
  if (dest.exists) dest.delete();
  const f = await FsFile.downloadFileAsync(`${SITE_URL}/api/v1${downloadPath(it)}`, dest, { headers: authHeaders() });
  return f.uri;
}

/**
 * Partilhar o Zás desenhado. No telemóvel: no Android com o expo-sharing (desde a 1.51.0) a folha leva a imagem; no iPhone
 * a folha do sistema leva-a pelo `url`. Na web o ficheiro assinado (Web Share API; sem ela copia a legenda).
 */
export async function shareZas(it: Z) {
  if (Platform.OS !== 'web') {
    try {
      const uri = await signedCacheFile(it);
      if (Platform.OS === 'android' && (await Sharing.isAvailableAsync().catch(() => false))) await Sharing.shareAsync(uri, { mimeType: 'image/jpeg', dialogTitle: 'Partilhar Zás' });
      else await Share.share({ url: uri, message: it.caption || undefined });
    } catch {
      /* cancelado ou sem rede: nada a fazer */
    }
    return;
  }
  try {
    const f = await signedFile(it);
    if (navigator.canShare?.({ files: [f] })) await navigator.share({ files: [f], text: it.caption || undefined });
    else await navigator.clipboard?.writeText(it.caption || '');
  } catch {
    /* cancelado ou sem rede: nada a fazer */
  }
}
