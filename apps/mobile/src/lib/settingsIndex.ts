/**
 * O mapa das Definições (lógica pura, sem React): os grupos do início, cada opção com os sinónimos por que a pessoa a
 * procura, a pesquisa "Procurar nas definições" e as ligações antigas (`/settings?s=notificacoes`, `/settings#privacidade`…)
 * que continuam a abrir o ecrã certo. Testes em tests/settingsIndex.test.mjs.
 */

export type SettingsGroupId = 'conta' | 'privacidade' | 'notificacoes' | 'conteudo' | 'mensagens' | 'pagamentos' | 'aparencia' | 'seguranca' | 'ajuda';
/** `inicio` é o próprio início das Definições (contas e sair). */
export type SettingsPlace = SettingsGroupId | 'inicio';

export interface SettingsGroup {
  id: SettingsGroupId;
  title: string;
  /** Uma linha, no início das Definições. */
  subtitle: string;
  /** Nome do ícone Tx (components/Icon). */
  icon: string;
  keywords: string[];
}

export interface SettingsEntry {
  /** Também é a âncora da linha no ecrã do grupo (`?o=<id>`). */
  id: string;
  group: SettingsPlace;
  title: string;
  keywords: string[];
  /** Opções que são um ecrã próprio: a pesquisa leva diretamente lá. */
  to?: string;
}

export const SETTINGS_GROUPS: SettingsGroup[] = [
  { id: 'conta', title: 'Conta', subtitle: 'Perfil, email, @, dados e eliminar', icon: 'user-circle', keywords: ['account', 'perfil', 'dados pessoais'] },
  { id: 'privacidade', title: 'Privacidade', subtitle: 'Quem te vê, quem interage, bloqueados', icon: 'lock', keywords: ['privacy', 'interações', 'mimos'] },
  { id: 'notificacoes', title: 'Notificações', subtitle: 'O que te avisa e este aparelho', icon: 'bell', keywords: ['notifications', 'avisos', 'alertas', 'push'] },
  { id: 'conteudo', title: 'Conteúdo e o teu algoritmo', subtitle: 'Algoritmo, guardados, geleira e mais', icon: 'sliders', keywords: ['content', 'feed', 'algoritmo', 'estatísticas', 'convites'] },
  { id: 'mensagens', title: 'Mensagens e chamadas', subtitle: 'Quem te escreve e quem te liga', icon: 'messages', keywords: ['messages', 'chat', 'conversas', 'chamadas', 'calls'] },
  { id: 'pagamentos', title: 'Txills e pagamentos', subtitle: 'Carteira, pedidos e recargas', icon: 'wallet', keywords: ['payments', 'carteira', 'dinheiro', 'txills', 'presentes'] },
  { id: 'aparencia', title: 'Aparência e idioma', subtitle: 'Idioma, traduções e tema', icon: 'globe', keywords: ['appearance', 'idioma', 'língua', 'tema', 'language'] },
  { id: 'seguranca', title: 'Segurança', subtitle: 'Senha, sessões e aparelhos', icon: 'shield', keywords: ['security', 'senha', 'sessões', 'aparelhos'] },
  { id: 'ajuda', title: 'Ajuda e sobre', subtitle: 'Ajuda, termos, versão e atualizações', icon: 'info', keywords: ['help', 'suporte', 'sobre', 'versão', 'privacidade'] },
];

/** Os tipos de aviso (as categorias que o servidor manda em /notifications/settings): título e explicação curta. */
export const NOTIFY_LABELS: Record<string, [string, string]> = {
  messages: ['Mensagens', 'Conversas e TxillGroups (pedidos para entrar, quem entrou, quem te fez administrador). Desligado, os pedidos para entrar continuam na lista, sem aviso'],
  follows: ['Seguidores', 'Quem começa a seguir-te e pedidos aceites'],
  comments: ['Comentários e respostas', 'Na tua publicação, no teu comentário e nos teus mimos'],
  mentions: ['Menções e marcações', 'Quando alguém te menciona ou te identifica'],
  reposts: ['Reposts', 'Quando repostam uma publicação tua'],
  gifts: ['Presentes', 'Quando te oferecem Txills'],
  reactions: ['Brindes e reações', 'Brindes nas tuas publicações, Tchekas, comentários, notas e geleira, e reações aos teus Zás'],
  invites: ['Convites', 'Quando alguém entra com o teu convite e quando um convite te dá Txills'],
  calls: ['Chamadas perdidas', 'Quando te ligam e não atendes (o toque de quem liga não se desliga aqui)'],
  venues: ['Locais que geres', 'Convites para gerir uma página e pagamentos em Txills recebidos'],
  // Lembretes de regresso (API: src/reminders/comeback-reminder.service.ts). Ligado por omissão.
  comeback: ['Lembretes quando não passo por cá', 'Se não abrires o Txillapp há uns dias, avisamos-te do que há de novo, de vez em quando e nunca à noite (sem notificações, por e-mail)'],
};

const NOTIFY_KEYWORDS: Record<string, string[]> = {
  messages: ['avisos de mensagens', 'chat', 'txillgroups', 'grupos'],
  follows: ['novos seguidores', 'pedidos para seguir'],
  comments: ['respostas', 'comentar'],
  mentions: ['@', 'identificar', 'marcar'],
  reposts: ['partilhas'],
  gifts: ['txills recebidos', 'oferta'],
  reactions: ['brindes', 'gostos', 'likes', 'reações', 'zás'],
  invites: ['convidados'],
  calls: ['chamadas', 'perdidas', 'ligações'],
  venues: ['locais', 'bar', 'restaurante'],
  comeback: ['lembretes', 'lembrar', 'não passo por cá', 'saudades', 'e-mail', 'email', 'voltar', 'ausente', 'afastado'],
};

/** Notificações: a âncora de cada categoria. */
export const notifyEntryId = (category: string) => `notify-${category}`;

export const SETTINGS_ENTRIES: SettingsEntry[] = [
  // Conta
  { id: 'editProfile', group: 'conta', title: 'Editar perfil', keywords: ['nome', 'foto', 'fotografia', 'avatar', 'bio', 'biografia', 'cidade', 'site', 'imagem de perfil'] },
  { id: 'email', group: 'conta', title: 'Email', keywords: ['e-mail', 'correio', 'confirmar email', 'ativar conta', 'endereço'] },
  { id: 'username', group: 'conta', title: 'Nome de utilizador', keywords: ['@', 'arroba', 'username', 'utilizador', 'handle'] },
  { id: 'gender', group: 'conta', title: 'Como me identifico', keywords: ['género', 'sexo', 'masculino', 'feminino'] },
  { id: 'showGender', group: 'conta', title: 'Mostrar no perfil', keywords: ['mostrar género', 'género no perfil'] },
  { id: 'verification', group: 'conta', title: 'Verificação', keywords: ['selo', 'verificado', 'verificar conta', 'selo vermelho', 'selo azul', 'conta oficial', 'cores do selo'] },
  { id: 'region', group: 'conta', title: 'A tua região', keywords: ['país', 'rede', 'região', 'moçambique'] },
  { id: 'exportData', group: 'conta', title: 'Descarregar os meus dados', keywords: ['exportar', 'cópia', 'transferir', 'download', 'rgpd', 'os meus dados', 'backup'] },
  { id: 'deleteAccount', group: 'conta', title: 'Eliminar conta', keywords: ['apagar conta', 'apagar', 'remover conta', 'fechar conta', 'desativar', 'sair de vez', 'apagar conta pelo site', 'apagar-conta', 'sem a app'] },
  // Privacidade
  { id: 'accountType', group: 'privacidade', title: 'Tipo de perfil', keywords: ['privado', 'público', 'conta privada', 'perfil privado', 'perfil público', 'fechar perfil'] },
  { id: 'connections', group: 'privacidade', title: 'Quem vê seguidores e a quem sigo', keywords: ['seguidores', 'seguindo', 'a seguir', 'listas'] },
  { id: 'suggestable', group: 'privacidade', title: 'Aparecer nas sugestões', keywords: ['sugestões', 'descobrir', 'sugerido', 'recomendar'] },
  { id: 'presence', group: 'privacidade', title: 'Mostrar quando estou online', keywords: ['online', 'visto por último', 'visto há', 'presença', 'ativo agora', 'última vez'] },
  { id: 'nearby', group: 'privacidade', title: 'Aparecer em À tua volta', keywords: ['localização', 'mapa', 'perto', 'à tua volta', 'gps', 'onde estou'] },
  { id: 'blocked', group: 'privacidade', title: 'Contas bloqueadas', keywords: ['bloquear', 'bloqueados', 'desbloquear', 'block'] },
  { id: 'comments', group: 'privacidade', title: 'Quem pode comentar', keywords: ['comentários', 'comentar'] },
  { id: 'mentions', group: 'privacidade', title: 'Quem pode mencionar-me', keywords: ['menções', 'mencionar', '@', 'marcar', 'identificar'] },
  { id: 'gifts', group: 'privacidade', title: 'Quem pode presentear-me', keywords: ['presentes', 'presentear', 'oferecer', 'txills'] },
  { id: 'repostsVisible', group: 'privacidade', title: 'Quem vê quem repostou', keywords: ['reposts', 'repostar', 'partilhas'] },
  { id: 'cheersVisible', group: 'privacidade', title: 'Quem vê quem brindou', keywords: ['brindes', 'brindar', 'gostos', 'likes'] },
  { id: 'giftsVisible', group: 'privacidade', title: 'Quem vê quem presenteou', keywords: ['presentes', 'quem ofereceu'] },
  { id: 'storyReplies', group: 'privacidade', title: 'Quem pode responder aos mimos', keywords: ['mimos', 'stories', 'histórias', 'respostas', 'reações aos mimos'] },
  { id: 'closeFriends', group: 'privacidade', title: 'Amigos próximos', keywords: ['melhores amigos', 'close friends', 'lista de amigos', 'mimos'] },
  { id: 'hiddenStory', group: 'privacidade', title: 'Esconder mimo de…', keywords: ['esconder', 'ocultar', 'mimos', 'stories', 'não mostrar'] },
  { id: 'findByContacts', group: 'privacidade', title: 'Deixar que me encontrem pelos contactos', keywords: ['contactos', 'agenda', 'encontrar-me'] },
  { id: 'analytics', group: 'privacidade', title: 'Ajudar a melhorar o Txillapp', keywords: ['estatísticas de uso', 'analytics', 'dados de uso', 'telemetria', 'rastreio', 'melhorar'] },
  // Notificações
  { id: 'deviceNotif', group: 'notificacoes', title: 'Notificações no telemóvel', keywords: ['push', 'alertas', 'avisos', 'ligar notificações', 'desligadas', 'notificação de teste', 'neste aparelho'] },
  { id: 'installApp', group: 'notificacoes', title: 'Instalar a app', keywords: ['ecrã principal', 'pwa', 'adicionar ao ecrã', 'instalar'] },
  ...Object.entries(NOTIFY_LABELS).map(([cat, [title]]): SettingsEntry => ({ id: notifyEntryId(cat), group: 'notificacoes', title, keywords: ['notificações', 'avisos', ...(NOTIFY_KEYWORDS[cat] ?? [])] })),
  // Conteúdo e o teu algoritmo
  { id: 'algorithm', group: 'conteudo', title: 'O teu algoritmo', to: '/reels/filtros', keywords: ['feed', 'tchekas', 'reels', 'interesses', 'tópicos', 'ver mais', 'ver menos', 'filtros', 'explorar', 'recomendações'] },
  { id: 'saved', group: 'conteudo', title: 'Guardados', to: '/saved', keywords: ['favoritos', 'guardar', 'marcadores', 'coleções'] },
  { id: 'geleira', group: 'conteudo', title: 'A minha geleira', to: '/geleira', keywords: ['bebidas', 'gostos', 'frigorífico'] },
  { id: 'insights', group: 'conteudo', title: 'Estatísticas do perfil', to: '/insights', keywords: ['visitas', 'alcance', 'números', 'insights', 'estatísticas'] },
  { id: 'locais', group: 'conteudo', title: 'Tenho um local (bar, restaurante…)', to: '/locais', keywords: ['negócio', 'bar', 'restaurante', 'página', 'empresa', 'local'] },
  { id: 'invites', group: 'conteudo', title: 'Convida a tua malta', to: '/invites', keywords: ['convites', 'convidar', 'código de convite', 'amigos'] },
  { id: 'contacts', group: 'conteudo', title: 'Encontrar amigos nos contactos', keywords: ['contactos', 'amigos', 'agenda', 'procurar amigos'] },
  // Mensagens e chamadas
  { id: 'dms', group: 'mensagens', title: 'Quem pode enviar-me mensagens', keywords: ['mensagens', 'conversas', 'dm', 'chat', 'txillgroups', 'grupos', 'escrever-me'] },
  // Estas duas mudam-se no menu «⋯» de cada conversa: a linha no ecrã explica onde e leva às Mensagens.
  { id: 'temporaryMessages', group: 'mensagens', title: 'Mensagens temporárias', keywords: ['desaparecer', 'temporárias', 'efémeras', 'apagar sozinhas', 'autodestruir', '24 horas', '7 dias', '90 dias', 'disappearing'] },
  { id: 'clearChat', group: 'mensagens', title: 'Limpar conversa', keywords: ['limpar', 'esvaziar', 'apagar mensagens', 'limpar chat', 'apagar histórico', 'clear chat'] },
  { id: 'calls', group: 'mensagens', title: 'Quem me pode ligar', keywords: ['chamadas', 'ligar', 'videochamada', 'chamada de voz'] },
  { id: 'relay', group: 'mensagens', title: 'Esconder o meu IP nas chamadas', keywords: ['ip', 'endereço', 'servidor', 'relay'] },
  { id: 'callLog', group: 'mensagens', title: 'Registo de chamadas', to: '/calls', keywords: ['histórico de chamadas', 'chamadas', 'apagar chamadas'] },
  // Txills e pagamentos
  { id: 'wallet', group: 'pagamentos', title: 'Txills e presentes', to: '/wallet', keywords: ['carteira', 'saldo', 'txills', 'moedas', 'presentes', 'o que são txills', 'levantar', 'trocar por dinheiro'] },
  { id: 'orders', group: 'pagamentos', title: 'Pedidos e pagamentos', to: '/orders', keywords: ['recarregar', 'comprar txills', 'pagamentos', 'm-pesa', 'mpesa', 'pedidos', 'recarga'] },
  // Aparência e idioma
  { id: 'language', group: 'aparencia', title: 'Idioma e traduções', to: '/language', keywords: ['língua', 'português', 'inglês', 'english', 'traduzir', 'tradução'] },
  { id: 'theme', group: 'aparencia', title: 'Tema', keywords: ['modo escuro', 'escuro', 'claro', 'dark mode', 'cores', 'aparência'] },
  // Segurança
  { id: 'password', group: 'seguranca', title: 'Alterar senha', keywords: ['palavra-passe', 'password', 'mudar senha', 'senha', 'palavra passe'] },
  { id: 'devices', group: 'seguranca', title: 'Os teus aparelhos', keywords: ['sessões', 'dispositivos', 'telemóveis', 'computadores', 'terminar sessão noutros', 'sessão iniciada', 'aparelhos'] },
  // Ajuda e sobre
  { id: 'help', group: 'ajuda', title: 'Ajuda', to: '/help', keywords: ['perguntas', 'suporte', 'faq', 'dúvidas', 'apoio', 'denunciar', 'denúncia', 'reportar', 'abuso'] },
  { id: 'terms', group: 'ajuda', title: 'Termos de utilização', to: '/terms', keywords: ['termos', 'regras', 'condições', 'tolerância zero', 'regras da malta'] },
  { id: 'privacyPolicy', group: 'ajuda', title: 'Política de privacidade', to: '/privacy', keywords: ['rgpd', 'dados pessoais', 'privacidade'] },
  { id: 'about', group: 'ajuda', title: 'Sobre', to: '/about', keywords: ['sobre o txillapp', 'informações'] },
  { id: 'version', group: 'ajuda', title: 'Versão e atualizações', keywords: ['atualizar', 'versão', 'procurar atualização', 'recarregar', 'build', 'nova versão'] },
  // Início: contas e sair
  { id: 'addAccount', group: 'inicio', title: 'Adicionar conta', keywords: ['nova conta', 'outra conta', 'várias contas'] },
  { id: 'switchAccount', group: 'inicio', title: 'Trocar de conta', keywords: ['mudar de conta', 'outra conta', 'várias contas'] },
  { id: 'logout', group: 'inicio', title: 'Terminar sessão', keywords: ['sair', 'logout', 'desligar', 'fechar sessão'] },
];

export const settingsGroup = (id: string): SettingsGroup | undefined => SETTINGS_GROUPS.find((g) => g.id === id);
export const settingsEntry = (id: string): SettingsEntry | undefined => SETTINGS_ENTRIES.find((e) => e.id === id);

/** O caminho do ecrã de um grupo (o início é `/settings`). */
export const groupPath = (g: SettingsPlace) => (g === 'inicio' ? '/settings' : `/settings/${g}`);

/** Para onde leva uma opção: o seu ecrã próprio, ou o ecrã do grupo com a linha assinalada (`?o=`). */
export function entryPath(e: SettingsEntry): string {
  if (e.to) return e.to;
  return `${groupPath(e.group)}?o=${encodeURIComponent(e.id)}`;
}

/** Minúsculas, sem acentos, só letras/números/@ separados por um espaço. */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9@]+/g, ' ')
    .trim();
}

export interface SettingsHit {
  kind: 'group' | 'entry';
  id: string;
  title: string;
  /** O grupo onde está (vazio para os próprios grupos e para o início). */
  where: string;
  path: string;
}

function score(q: string, words: string[], title: string, keywords: string[], extra: string): number {
  const t = normalize(title);
  const ks = keywords.map(normalize);
  const hay = `${t} ${ks.join(' ')} ${normalize(extra)}`;
  // Todas as palavras têm de aparecer (no título, nos sinónimos ou no nome do grupo): no início de uma palavra ou,
  // a partir de 3 letras, em qualquer lado ("bloq" acha "desbloquear").
  const hayWords = hay.split(' ');
  if (!words.every((w) => hayWords.some((h) => h.startsWith(w)) || (w.length >= 3 && hay.includes(w)))) return 0;
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  if (ks.some((k) => k === q)) return 70;
  if (t.split(' ').some((w) => w.startsWith(q))) return 60;
  if (t.includes(q)) return 50;
  if (ks.some((k) => k.startsWith(q))) return 40;
  if (ks.some((k) => k.includes(q))) return 30;
  return 10;
}

/**
 * "Procurar nas definições": encontra grupos e opções pelo nome e pelos sinónimos, sem ligar a acentos nem maiúsculas.
 * `hidden`: opções que este aparelho não mostra (ex.: instalar a app na app nativa).
 */
export function searchSettings(query: string, opts: { limit?: number; hidden?: readonly string[] } = {}): SettingsHit[] {
  const q = normalize(query);
  if (!q) return [];
  const words = q.split(' ').filter(Boolean);
  const hidden = new Set(opts.hidden ?? []);
  const hits: (SettingsHit & { s: number; order: number })[] = [];
  SETTINGS_GROUPS.forEach((g, i) => {
    const s = score(q, words, g.title, [...g.keywords, g.subtitle], '');
    if (s) hits.push({ kind: 'group', id: g.id, title: g.title, where: '', path: groupPath(g.id), s, order: 1000 + i });
  });
  SETTINGS_ENTRIES.forEach((e, i) => {
    if (hidden.has(e.id)) return;
    const g = e.group === 'inicio' ? undefined : settingsGroup(e.group);
    const s = score(q, words, e.title, e.keywords, g?.title ?? '');
    if (s) hits.push({ kind: 'entry', id: e.id, title: e.title, where: g?.title ?? 'Definições', path: entryPath(e), s, order: i });
  });
  // Empate: primeiro as opções (pela ordem do índice), depois os grupos (que só ganham pelo título).
  hits.sort((a, b) => b.s - a.s || a.order - b.order);
  return hits.slice(0, opts.limit ?? 20).map(({ s: _s, order: _o, ...h }) => h);
}

/* ───────────── ligações antigas ───────────── */

/** Nomes antigos (e em inglês) das secções do ecrã único de Definições → o grupo novo. */
const GROUP_ALIASES: Record<string, SettingsGroupId> = {
  conta: 'conta', account: 'conta', perfil: 'conta', profile: 'conta', 'o teu perfil': 'conta', dados: 'conta', exportar: 'conta', export: 'conta', eliminar: 'conta', delete: 'conta', verificacao: 'conta', verification: 'conta', regiao: 'conta', region: 'conta',
  privacidade: 'privacidade', privacy: 'privacidade', 'privacidade da conta': 'privacidade', interacoes: 'privacidade', interactions: 'privacidade', mimos: 'privacidade', stories: 'privacidade', 'privacidade dos dados': 'privacidade', bloqueados: 'privacidade', blocked: 'privacidade', localizacao: 'privacidade', location: 'privacidade',
  notificacoes: 'notificacoes', notifications: 'notificacoes', notificacao: 'notificacoes', notif: 'notificacoes', push: 'notificacoes', avisos: 'notificacoes', 'o que me pode notificar': 'notificacoes',
  conteudo: 'conteudo', content: 'conteudo', algoritmo: 'conteudo', feed: 'conteudo', convidar: 'conteudo', invites: 'conteudo', convites: 'conteudo',
  mensagens: 'mensagens', messages: 'mensagens', chat: 'mensagens', dms: 'mensagens', chamadas: 'mensagens', calls: 'mensagens',
  pagamentos: 'pagamentos', payments: 'pagamentos', carteira: 'pagamentos', wallet: 'pagamentos', txills: 'pagamentos', pedidos: 'pagamentos', orders: 'pagamentos',
  aparencia: 'aparencia', appearance: 'aparencia', idioma: 'aparencia', language: 'aparencia', tema: 'aparencia', theme: 'aparencia',
  seguranca: 'seguranca', security: 'seguranca', senha: 'seguranca', password: 'seguranca', sessoes: 'seguranca', sessions: 'seguranca', dispositivos: 'seguranca', devices: 'seguranca', aparelhos: 'seguranca',
  ajuda: 'ajuda', help: 'ajuda', sobre: 'ajuda', about: 'ajuda', apoio: 'ajuda', 'apoio e informacoes': 'ajuda', versao: 'ajuda', version: 'ajuda', atualizacao: 'ajuda', update: 'ajuda',
};

/** Parâmetros que as ligações antigas usavam para apontar uma secção. */
const LEGACY_KEYS = ['s', 'secao', 'seccao', 'section', 'sec', 'tab', 'aba', 'grupo', 'group'] as const;

/** Uma palavra solta (nome de grupo, de secção antiga ou de opção) → para onde ir. `null` se não se conhece. */
export function settingsTargetFor(raw: string | null | undefined): string | null {
  const v = normalize(decodeSafe(raw ?? '').replace(/^#/, '').replace(/[-_]+/g, ' '));
  if (!v) return null;
  if (v === 'inicio' || v === 'home' || v === 'definicoes' || v === 'settings') return '/settings';
  // Uma opção pelo id (`?s=blocked`, `#accountType`) vai direta à linha.
  const byId = SETTINGS_ENTRIES.find((e) => normalize(e.id) === v.replace(/ /g, '') || normalize(e.id) === v);
  if (byId) return entryPath(byId);
  const g = GROUP_ALIASES[v];
  if (g) return groupPath(g);
  // Pelo nome exato de uma opção ou de um sinónimo ("bloqueados", "senha"…).
  const byName = SETTINGS_ENTRIES.find((e) => normalize(e.title) === v || e.keywords.some((k) => normalize(k) === v));
  return byName ? entryPath(byName) : null;
}

function decodeSafe(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

/**
 * As ligações antigas: `/settings?s=notificacoes`, `?section=privacy`, `/settings#notificacoes`… → o ecrã novo
 * (ex.: `/settings/notificacoes`). `null` quando é o início sem nada a apontar.
 */
export function legacySettingsTarget(params: Record<string, string | string[] | undefined>, hash?: string | null): string | null {
  for (const k of LEGACY_KEYS) {
    const raw = params[k];
    const v = Array.isArray(raw) ? raw[0] : raw;
    if (v) {
      const t = settingsTargetFor(v);
      if (t && t !== '/settings') return t;
    }
  }
  if (hash) {
    const t = settingsTargetFor(hash);
    if (t && t !== '/settings') return t;
  }
  return null;
}
