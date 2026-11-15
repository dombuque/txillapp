/** Nomes que ninguém pode escolher: confundem-se com a marca, a equipa ou rotas da app. */
const RESERVED = new Set([
  'admin', 'administrator', 'root', 'support', 'suporte', 'help', 'ajuda', 'moderator', 'moderacao',
  'txill', 'txills', 'txillapp', 'txilapp', 'supertxill', 'oficial', 'official', 'staff', 'equipa', 'team',
  'api', 'www', 'app', 'login', 'logout', 'register', 'registo', 'settings', 'null', 'undefined',
  'system', 'sistema', 'security', 'seguranca', 'wallet', 'carteira', 'stories', 'posts', 'me',
  // Rotas das Mensagens (app/messages/escondidas: «Conversas escondidas»).
  'escondidas',
]);

export const isReservedUsername = (u: string) => RESERVED.has(u.toLowerCase().replace(/[._]/g, ''));
