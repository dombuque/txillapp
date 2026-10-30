/** Mensagens prontas para partilhar o Txillapp (WhatsApp, SMS, redes...): o texto já vem escrito, só falta enviar. */

export const SITE_URL = 'https://txillapp.com';

export interface ShareData {
  title: string;
  text: string;
  url: string;
}

/** Convite para o Txillapp. O parâmetro no fim faz as aplicações lerem o endereço de novo (e dá para contar convites). */
export const inviteShare = (name?: string): ShareData => ({
  title: 'Txillapp, a rede da malta',
  text: `${name ? `${name} convida-te para o` : 'Anda ver o'} Txillapp, a rede social da malta. Posta, mostra e txilla!`,
  url: `${SITE_URL}/?c=convite`,
});

export const profileShare = (displayName: string, username: string, origin = SITE_URL): ShareData => ({
  title: `${displayName} no Txillapp`,
  text: `Segue @${username} no Txillapp, a rede da malta:`,
  url: `${origin}/u/${username}`,
});

export const postShare = (displayName: string, body: string, url: string): ShareData => {
  const snippet = body.trim().replace(/\s+/g, ' ');
  return {
    title: `${displayName} no Txillapp`,
    text: snippet ? `${displayName} no Txillapp: “${snippet.length > 100 ? `${snippet.slice(0, 100).trimEnd()}…` : snippet}”` : `Vê esta publicação de ${displayName} no Txillapp:`,
    url,
  };
};

/**
 * Abre o menu de partilha do aparelho com o texto já escrito. Sem menu de partilha (computador), copia o texto com o link.
 * Devolve o que aconteceu, para a interface avisar.
 */
export async function shareNow(data: ShareData): Promise<'shared' | 'copied' | 'failed' | 'cancelled'> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share(data);
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled';
    }
  }
  try {
    await navigator.clipboard.writeText(`${data.text}\n${data.url}`);
    return 'copied';
  } catch {
    return 'failed';
  }
}
