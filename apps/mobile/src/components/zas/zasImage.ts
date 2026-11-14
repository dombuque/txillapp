import { Alert, Platform, Share } from 'react-native';
import { fetchAuthed } from '@/lib/api';
import { saveToGallery } from '@/lib/saveToGallery';

/**
 * Guardar e partilhar os MEUS Zás (só aparecem no visor dos meus e no menu de «Os meus Zás»). A imagem vem sempre do
 * servidor, `GET /instants/:id/download`: a foto com a legenda a correr pela curva (como no ecrã) e a assinatura do
 * Txillapp (o logótipo e o meu @, com o selo se a conta for verificada), a mesma dos mimos. No telemóvel e na web sai o
 * mesmo ficheiro: o @ e o selo vêm da conta (não do aparelho), a assinatura tem um só desenho (media/signature.ts) e a
 * moldura squircle com os cantos transparentes não servia, porque cortava a assinatura, que fica no canto.
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

/** Partilhar a foto: na web o ficheiro assinado (Web Share API; sem ela copia a legenda). */
export async function shareZas(it: Z) {
  if (Platform.OS !== 'web') return void (await Share.share({ url: it.url, message: it.caption || undefined }).catch(() => undefined));
  try {
    const f = await signedFile(it);
    if (navigator.canShare?.({ files: [f] })) await navigator.share({ files: [f], text: it.caption || undefined });
    else await navigator.clipboard?.writeText(it.caption || '');
  } catch {
    /* cancelado ou sem rede: nada a fazer */
  }
}
