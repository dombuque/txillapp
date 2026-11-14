import { Alert, Platform } from 'react-native';
import { track } from './analytics';
import { saveToGallery } from './saveToGallery';
import { downloadName, downloadPath, downloadTarget, type DownloadablePost } from './tchekaDownload';

/**
 * Guarda a tcheka com a assinatura e o cartão do fim (lib/tchekaDownload). No telemóvel: na galeria (pede acesso às fotos);
 * no site: a folha de partilha do sistema ou o ficheiro descarregado. Devolve se correu bem (os avisos já aparecem aqui).
 */
export async function saveTcheka(post: DownloadablePost): Promise<boolean> {
  const t = downloadTarget(post);
  if (!t) return false;
  try {
    const r = await saveToGallery(downloadPath(t), downloadName(t));
    if (r === 'denied') {
      Alert.alert('Sem acesso à galeria', 'Dá acesso às fotos nas definições do telemóvel para guardar a tcheka.');
      return false;
    }
    track('share', { target: 'download' });
    if (Platform.OS !== 'web') Alert.alert('Guardado', 'A tcheka está na tua galeria, com a assinatura do Txillapp.');
    return true;
  } catch (e) {
    Alert.alert('Não consegui guardar', (e as Error).message || 'Tenta outra vez.');
    return false;
  }
}
