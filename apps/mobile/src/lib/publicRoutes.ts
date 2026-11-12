/**
 * Páginas abertas a todos, com ou sem sessão (o primeiro segmento do endereço). As lojas pedem endereços estáveis e sem login
 * para a política de privacidade, os termos, o suporte e o pedido de apagar a conta:
 * txillapp.com/privacidade (= /privacy), /termos (= /terms), /suporte (= /help) e /apagar-conta.
 * `c` é a página de um convite (/c/CÓDIGO).
 */
export const PUBLIC_SEGMENTS = ['terms', 'termos', 'privacy', 'privacidade', 'help', 'suporte', 'apagar-conta', 'c'] as const;

export const isPublicSegment = (s: string | undefined) => !!s && (PUBLIC_SEGMENTS as readonly string[]).includes(s);

/** Os endereços públicos que se põem nas fichas das lojas. */
export const STORE_URLS = {
  privacy: 'https://txillapp.com/privacidade',
  terms: 'https://txillapp.com/termos',
  support: 'https://txillapp.com/suporte',
  deleteAccount: 'https://txillapp.com/apagar-conta',
  marketing: 'https://txillapp.com',
} as const;
