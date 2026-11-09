import { useState } from 'react';
import { Platform } from 'react-native';
import type { TextInputContentSizeChangeEvent } from 'react-native';

/**
 * Campo de mensagem que cresce com o texto, como no WhatsApp e no Instagram: começa numa linha,
 * cresce até `max` (cerca de 6 linhas) e daí para a frente rola por dentro. No site o textarea não cresce sozinho;
 * aqui mede-se o conteúdo (scrollHeight, já com o espaço interior) e dá-se a altura certa.
 * No telemóvel o campo nativo já cresce sozinho até ao maxHeight do estilo, por isso não se mexe.
 */
export function useGrowInput(min = 40, max = 148) {
  const [height, setHeight] = useState(min);
  const onContentSizeChange = (e: TextInputContentSizeChangeEvent) => {
    if (Platform.OS !== 'web') return;
    setHeight(Math.max(min, Math.min(max, Math.ceil(e.nativeEvent.contentSize.height))));
  };
  /** Depois de enviar: volta a uma linha. */
  const reset = () => setHeight(min);
  /** Estilo a juntar ao campo (só no site). */
  const style = Platform.OS === 'web' ? { height, maxHeight: max } : { maxHeight: max };
  return { style, onContentSizeChange, reset };
}
