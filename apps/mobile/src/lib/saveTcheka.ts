import { Alert, Platform } from 'react-native';
import { track } from './analytics';
import { fetchAuthed } from './api';
import { saveToGallery } from './saveToGallery';
import { downloadName, downloadPath, downloadTarget, quickRefusal, refusalMessage, type DownloadablePost } from './tchekaDownload';
import { t } from '@/lib/i18n';

/**
 * Guarda a tcheka com a assinatura e o cartão do fim (lib/tchekaDownload). No telemóvel: na galeria (pede acesso às fotos);
 * no site: a folha de partilha do sistema ou o ficheiro descarregado. Devolve se correu bem (os avisos já aparecem aqui).
 * Se a API recusar (quem publicou não deixa guardar), mostra a mensagem dela.
 */
export async function saveTcheka(post: DownloadablePost): Promise<boolean> {
  const tv = downloadTarget(post);
  if (!tv) return false;
  try {
    const r = await saveToGallery(downloadPath(tv), downloadName(tv));
    if (r === 'denied') {
      Alert.alert(t('Sem acesso à galeria'), t('Dá acesso às fotos nas definições do telemóvel para guardar a tcheka.'));
      return false;
    }
    track('share', { target: 'download' });
    if (Platform.OS !== 'web') Alert.alert(t('Guardado'), t('A tcheka está na tua galeria, com a assinatura do Txillapp.'));
    return true;
  } catch (e) {
    const refused = Platform.OS === 'web' ? null : quickRefusal(e);
    if (refused) Alert.alert(t('Não dá para guardar'), await refusalText(tv, refused));
    else Alert.alert(t('Não consegui guardar'), (e as Error).message || t('Tenta outra vez.'));
    return false;
  }
}

/**
 * No telemóvel o descarregamento não traz a resposta: pede-se outra vez só para ler a mensagem da API (uma recusa sai logo,
 * sem preparar o vídeo). No site o erro já vem com ela (saveToGallery.web).
 */
async function refusalText(t: DownloadablePost, status: number): Promise<string> {
  try {
    const res = await fetchAuthed(downloadPath(t));
    if (!res.ok) return refusalMessage(res.status, await res.json().catch(() => null));
    void res.body?.cancel().catch(() => undefined);
  } catch {
    /* sem rede: a frase de reserva */
  }
  return refusalMessage(status, null);
}
