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

/** O link limpo de uma publicação ou reel: txillapp.com/p/Ab3xK9q (reels: /r/…). Sempre no site público, que mostra a pré-visualização. */
export const postLink = (post: { code: string; media: { kind?: string }[] }, origin = SITE_URL) => `${origin}/${post.media[0]?.kind === 'video' ? 'r' : 'p'}/${post.code}`;

export const profileShare = (displayName: string, username: string, origin = SITE_URL): ShareData => ({
  title: `${displayName} no Txillapp`,
  text: `Segue @${username} no Txillapp, a rede da malta:`,
  url: `${origin}/u/${username}`,
});

/** Só a ligação: o cartão de pré-visualização já mostra o autor e o texto da publicação, por isso não se repete em texto. */
export const postShare = (displayName: string, _body: string, url: string): ShareData => ({ title: `${displayName} no Txillapp`, text: '', url });

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
    await navigator.clipboard.writeText(data.text ? `${data.text}\n${data.url}` : data.url);
    return 'copied';
  } catch {
    return 'failed';
  }
}
