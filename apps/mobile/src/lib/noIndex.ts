import { useEffect } from 'react';
import { Platform } from 'react-native';

/** O que os motores de busca leem nas páginas que nunca podem aparecer nos resultados (as Txilladas). */
export const NO_INDEX = 'noindex, nofollow, noarchive';

/**
 * No site: enquanto o ecrã está aberto, a página diz aos motores de busca que não a indexem, não sigam as ligações nem
 * guardem cópia (`<meta name="robots">`). O nginx manda o mesmo no cabeçalho X-Robots-Tag (o robots.txt não fecha /txillada/: os motores têm de ler o «noindex»);
 * isto cobre quem chega pela navegação dentro da app (a página servida é a de entrada, com «index»). Ao sair, volta ao
 * que estava. No telemóvel não faz nada.
 */
export function useNoIndex(on = true): void {
  useEffect(() => {
    if (!on || Platform.OS !== 'web' || typeof document === 'undefined') return;
    let tag = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    const created = !tag;
    const before = tag?.getAttribute('content') ?? null;
    if (!tag) {
      tag = document.createElement('meta');
      tag.setAttribute('name', 'robots');
      document.head.appendChild(tag);
    }
    tag.setAttribute('content', NO_INDEX);
    const mine = tag;
    return () => {
      if (created) mine.remove();
      else if (before != null) mine.setAttribute('content', before);
    };
  }, [on]);
}
