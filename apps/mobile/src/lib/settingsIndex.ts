/**
 * O mapa das Definições (lógica pura, sem React): os grupos do início, cada opção com os sinónimos por que a pessoa a
 * procura, a pesquisa "Procurar nas definições" e as ligações antigas (`/settings?s=notificacoes`, `/settings#privacidade`…)
 * que continuam a abrir o ecrã certo. Testes em tests/settingsIndex.test.mjs.
 */

import { t } from '@/lib/i18n';
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
  { id: 'conta', get title() { return t('Conta'); }, get subtitle() { return t('Perfil, email, @, dados e eliminar'); }, icon: 'user-circle', get keywords() { return ['account', 'perfil', t('dados pessoais')]; } },
  { id: 'privacidade', get title() { return t('Privacidade'); }, get subtitle() { return t('Quem te vê, quem interage, bloqueados'); }, icon: 'lock', get keywords() { return ['privacy', t('interações'), 'mimos']; } },
  { id: 'notificacoes', get title() { return t('Notificações'); }, get subtitle() { return t('O que te avisa e este aparelho'); }, icon: 'bell', keywords: ['notifications', 'avisos', 'alertas', 'push'] },
  { id: 'conteudo', get title() { return t('Conteúdo e o teu algoritmo'); }, get subtitle() { return t('Algoritmo, guardados, tchekas e mais'); }, icon: 'sliders', get keywords() { return [t('content'), 'feed', t('algoritmo'), t('estatísticas'), t('convites'), 'tchekas', t('sons'), t('duetos'), 'remix']; } },
  { id: 'mensagens', get title() { return t('Mensagens e chamadas'); }, get subtitle() { return t('Quem te escreve e quem te liga'); }, icon: 'messages', keywords: ['messages', 'chat', 'conversas', 'chamadas', 'calls'] },
  { id: 'pagamentos', get title() { return t('Vibes e pagamentos'); }, get subtitle() { return t('Carteira, pedidos e recargas'); }, icon: 'wallet', keywords: ['payments', 'carteira', 'dinheiro', 'vibes', 'vib', 'txills', 'presentes'] },
  { id: 'aparencia', get title() { return t('Idiomas'); }, get subtitle() { return t('O idioma da app'); }, icon: 'globe', get keywords() { return [t('idioma'), t('idiomas'), t('língua'), t('language'), t('languages'), t('português'), t('inglês'), t('english')]; } },
  { id: 'seguranca', get title() { return t('Segurança'); }, get subtitle() { return t('Senha, sessões e aparelhos'); }, icon: 'shield', get keywords() { return [t('security'), t('senha'), t('sessões'), t('aparelhos')]; } },
  { id: 'ajuda', get title() { return t('Ajuda e sobre'); }, get subtitle() { return t('Ajuda, termos, versão e atualizações'); }, icon: 'info', get keywords() { return ['help', 'suporte', t('sobre'), t('versão'), 'privacidade']; } },
];

/** Os tipos de aviso (as categorias que o servidor manda em /notifications/settings): título e explicação curta. */
export const NOTIFY_LABELS: Record<string, [string, string]> = {
  get messages() { return [t('Mensagens'), t('Conversas e TxillGroups (pedidos para entrar, quem entrou, quem te fez administrador, capturas de ecrã), e capturas dos teus Zás. Desligado, os pedidos para entrar continuam na lista, sem aviso')] as [string, string]; },
  get follows() { return [t('Seguidores'), t('Quem começa a seguir-te e pedidos aceites')] as [string, string]; },
  get comments() { return [t('Comentários e respostas'), t('Na tua publicação, no teu comentário e nos teus mimos')] as [string, string]; },
  get mentions() { return [t('Menções e marcações'), t('Quando alguém te menciona ou te identifica')] as [string, string]; },
  get reposts() { return [t('Reposts'), t('Quando repostam uma publicação tua')] as [string, string]; },
  get gifts() { return [t('Presentes'), t('Quando te oferecem vibes')] as [string, string]; },
  get reactions() { return [t('Brindes e reações'), t('Brindes nas tuas publicações, Tchekas, comentários, notas e geleira, e reações aos teus Zás')] as [string, string]; },
  get invites() { return [t('Convites'), t('Quando alguém entra com o teu convite e quando um convite te dá vibes')] as [string, string]; },
  get calls() { return [t('Chamadas perdidas'), t('Quando te ligam e não atendes (o toque de quem liga não se desliga aqui)')] as [string, string]; },
  get venues() { return [t('Locais que geres'), t('Convites para gerir uma página e pagamentos em vibes recebidas')] as [string, string]; },
  // Lembretes de regresso (API: src/reminders/comeback-reminder.service.ts). Ligado por omissão.
  get comeback() { return [t('Lembretes quando não passo por cá'), t('Se não abrires o Txillapp há 3 dias ou mais, avisamos-te do que há de novo: no máximo um por semana e só entre as 9h e as 20h. Se a notificação não chegar, vai por email')] as [string, string]; },
  // Remix das tchekas (API: src/posts/remix.ts, 0134).
  get remixes() { return [t('Duetos e respostas'), t('Quando fazem um dueto com a tua tcheka ou respondem com uma tcheka a um comentário teu (ou na tua publicação)')] as [string, string]; },
  // «Sexta da gelada» (API: src/gelada/gelada-friday.service.ts, 0145). Ligado por omissão.
  get gelada() { return [t('Sexta da gelada'), t('À sexta por volta das 17h: quem ainda te deve uma e um lembrete para pedires à malta. No máximo um por sexta')] as [string, string]; },
  // Txillada, o live (API: src/txillada, 0158). Ligado por omissão; no máximo um aviso por pessoa por hora.
  // Também o convite de uma menção num comentário e o «reabriu a Txillada» (txillada-voltar, 0174) e os avisos da Txillada
  // agendada (0176): o txillada_live a quem pediu lembrete, txillada_scheduled_cancelled e, ao anfitrião, _soon e _now.
  get txilladas() { return ['Txilladas', t('Quando alguém que segues abre ou reabre uma Txillada, quando reabrem uma em que ofereceste ou pagaste a entrada, os convites para transmitir ou para vir ver quando te mencionam, e as Txilladas agendadas: quando começa uma que pediste para lembrar (ou a cancelam, mudam de hora ou a moderação a retira) e os avisos das tuas, 15 min antes e na hora')] as [string, string]; },
  // O resumo semanal dos Zás (API: src/instants, 0164). Ligado por omissão; no máximo um por semana.
  zas: ['Resumo dos Zás', 'Ao domingo à noite, quando o teu resumo da semana fica pronto'],
  // O Mixar, o feed a dois e o do grupo (API: src/mixar, 0150, 0170 e 0173). Ligado por omissão; a seleção do dia no máximo uma vez por dia.
  mixar: ['Mixar', 'Convites e convites aceites, propostas de Mixar do grupo, a seleção de cada dia (só entre as 8h e as 21h e se ainda não abriste o Mixar) e o Mixa Challenge: quando já escolheram e falta a tua escolha, e o resultado'],
};

const NOTIFY_KEYWORDS: Record<string, string[]> = {
  get messages() { return [t('avisos de mensagens'), 'chat', 'txillgroups', 'grupos']; },
  get follows() { return [t('novos seguidores'), t('pedidos para seguir')]; },
  comments: ['respostas', 'comentar'],
  mentions: ['@', 'identificar', 'marcar'],
  reposts: ['partilhas'],
  get gifts() { return [t('vibes recebidas'), t('txills recebidos'), 'oferta']; },
  get reactions() { return ['brindes', 'gostos', t('likes'), t('reações'), 'zás']; },
  invites: ['convidados'],
  get calls() { return [t('chamadas'), t('perdidas'), t('ligações')]; },
  venues: ['locais', 'bar', 'restaurante'],
  get comeback() { return ['lembretes', 'lembrar', t('não passo por cá'), 'saudades', 'e-mail', 'email', 'voltar', 'ausente', 'afastado', 'regresso', t('lembretes de regresso'), t('deixar de receber'), 'inativo']; },
  get remixes() { return ['duetos', 'dueto', 'remix', t('responder com tcheka'), t('respostas com tcheka'), 'tchekas']; },
  gelada: ['sexta', 'gelada', 'cerveja', 'refresco', 'cobrar', 'livro', 'paga-me uma', 'sexta-feira'],
  get txilladas() { return ['txillada', 'live', 'lives', t('ao vivo'), 'direto', t('em direto'), t('transmissão'), 'transmitir', 'reabrir', t('angariação'), t('menção na txillada'), t('vem ver'), 'agendar', 'agendada', t('txillada agendada'), 'lembrar-me', t('em breve')]; },
  zas: ['zás', 'resumo dos zás', 'resumo semanal', 'resumo da semana', 'recap', 'domingo', 'aviso do resumo'],
  mixar: ['mixar', 'feed a dois', 'blend', 'seleção do dia', 'mixa challenge', 'desafio', 'convite do mixar', 'mixar do grupo', 'mixar de grupo', 'propôs um mixar'],
};

/** Notificações: a âncora de cada categoria. */
export const notifyEntryId = (category: string) => `notify-${category}`;

export const SETTINGS_ENTRIES: SettingsEntry[] = [
  // Conta
  { id: 'editProfile', group: 'conta', get title() { return t('Editar perfil'); }, get keywords() { return ['nome', 'foto', 'fotografia', 'avatar', 'bio', 'biografia', 'cidade', 'site', t('imagem de perfil')]; } },
  { id: 'email', group: 'conta', get title() { return t('Email'); }, get keywords() { return ['e-mail', 'correio', t('confirmar email'), t('ativar conta'), t('endereço')]; } },
  { id: 'username', group: 'conta', get title() { return t('Nome de utilizador'); }, keywords: ['@', 'arroba', 'username', 'utilizador', 'handle'] },
  { id: 'gender', group: 'conta', get title() { return t('Como me identifico'); }, get keywords() { return [t('género'), t('sexo'), t('masculino'), t('feminino')]; } },
  { id: 'showGender', group: 'conta', get title() { return t('Mostrar no perfil'); }, get keywords() { return [t('mostrar género'), t('género no perfil')]; } },
  { id: 'verification', group: 'conta', get title() { return t('Verificação'); }, get keywords() { return ['selo', 'verificado', t('verificar conta'), t('selo vermelho'), t('selo azul'), t('conta oficial'), t('cores do selo')]; } },
  { id: 'artist', group: 'conta', get title() { return t('Sou artista'); }, get keywords() { return ['artista', t('músico'), 'musico', 'editora', t('carregar música'), t('carregar musica'), t('as minhas músicas'), t('artistas de moçambique'), t('direitos de autor')]; } },
  { id: 'region', group: 'conta', get title() { return t('A tua região'); }, get keywords() { return [t('país'), 'rede', t('região'), t('moçambique')]; } },
  { id: 'exportData', group: 'conta', get title() { return t('Descarregar os meus dados'); }, get keywords() { return ['exportar', t('cópia'), 'transferir', 'download', 'rgpd', t('os meus dados'), 'backup']; } },
  { id: 'deleteAccount', group: 'conta', get title() { return t('Eliminar conta'); }, get keywords() { return [t('apagar conta'), 'apagar', t('remover conta'), t('fechar conta'), 'desativar', t('sair de vez'), t('apagar conta pelo site'), 'apagar-conta', t('sem a app')]; } },
  // Privacidade
  { id: 'accountType', group: 'privacidade', get title() { return t('Tipo de perfil'); }, get keywords() { return ['privado', t('público'), t('conta privada'), t('perfil privado'), t('perfil público'), t('fechar perfil')]; } },
  { id: 'connections', group: 'privacidade', get title() { return t('Quem vê seguidores e a quem sigo'); }, keywords: ['seguidores', 'seguindo', 'a seguir', 'listas'] },
  { id: 'suggestable', group: 'privacidade', get title() { return t('Aparecer nas sugestões'); }, get keywords() { return [t('sugestões'), t('descobrir'), t('sugerido'), t('recomendar')]; } },
  { id: 'presence', group: 'privacidade', get title() { return t('Mostrar quando estou online'); }, get keywords() { return ['online', t('visto por último'), t('visto há'), t('presença'), t('ativo agora'), t('última vez')]; } },
  { id: 'nearby', group: 'privacidade', get title() { return t('Aparecer em À tua volta'); }, get keywords() { return [t('localização'), 'mapa', 'perto', t('à tua volta'), 'gps', t('onde estou')]; } },
  { id: 'blocked', group: 'privacidade', get title() { return t('Contas bloqueadas'); }, keywords: ['bloquear', 'bloqueados', 'desbloquear', 'block'] },
  { id: 'comments', group: 'privacidade', get title() { return t('Quem pode comentar'); }, get keywords() { return [t('comentários'), t('comentar')]; } },
  { id: 'mentions', group: 'privacidade', get title() { return t('Quem pode mencionar-me'); }, get keywords() { return [t('menções'), 'mencionar', '@', 'marcar', 'identificar']; } },
  { id: 'gifts', group: 'privacidade', get title() { return t('Quem pode presentear-me'); }, keywords: ['presentes', 'presentear', 'oferecer', 'vibes', 'txills'] },
  { id: 'repostsVisible', group: 'privacidade', get title() { return t('Quem vê quem repostou'); }, keywords: ['reposts', 'repostar', 'partilhas'] },
  { id: 'cheersVisible', group: 'privacidade', get title() { return t('Quem vê quem brindou'); }, keywords: ['brindes', 'brindar', 'gostos', 'likes'] },
  { id: 'giftsVisible', group: 'privacidade', get title() { return t('Quem vê quem presenteou'); }, get keywords() { return ['presentes', t('quem ofereceu')]; } },
  { id: 'storyReplies', group: 'privacidade', get title() { return t('Quem pode responder aos mimos'); }, get keywords() { return ['mimos', 'stories', t('histórias'), 'respostas', t('reações aos mimos')]; } },
  { id: 'closeFriends', group: 'privacidade', get title() { return t('Amigos próximos'); }, get keywords() { return [t('melhores amigos'), t('close friends'), t('lista de amigos'), 'mimos', 'notas', t('quem vê a minha nota')]; } },
  { id: 'hiddenStory', group: 'privacidade', get title() { return t('Esconder mimo de…'); }, get keywords() { return ['esconder', 'ocultar', 'mimos', 'stories', t('não mostrar')]; } },
  { id: 'zasKeep', group: 'privacidade', get title() { return t('Guardar os meus Zás para o resumo semanal'); }, get keywords() { return ['zás', 'zas', 'resumo', t('resumo semanal'), t('resumo da semana'), t('resumo dos zás'), t('guardar zás'), t('guardar os zás'), '7 dias', t('sete dias'), 'arquivo', t('os meus zás'), 'recap', 'instants', t('apagar às 24 horas')]; } },
  { id: 'findByContacts', group: 'privacidade', get title() { return t('Deixar que me encontrem pelos contactos'); }, keywords: ['contactos', 'agenda', 'encontrar-me'] },
  { id: 'analytics', group: 'privacidade', get title() { return t('Ajudar a melhorar o Txillapp'); }, get keywords() { return [t('estatísticas de uso'), 'analytics', t('dados de uso'), 'telemetria', 'rastreio', 'melhorar']; } },
  // Mixar (0172): os temas que nunca aparecem nos meus Mixar (ecrã próprio; a linha está em Privacidade e em Mensagens e chamadas).
  { id: 'mixarPrivateTopics', group: 'privacidade', get title() { return t('Temas privados no Mixar'); }, to: '/settings/mixar-temas', get keywords() { return [t('temas privados'), 'mixar', t('esconder temas'), t('gostos privados'), 'compatibilidade', 'afinidade', t('temas em comum')]; } },
  // Mixar (0179): ver juntos, sugestões e o resumo da semana (interruptores em Privacidade).
  { id: 'mixarPresence', group: 'privacidade', get title() { return t('Mostrar que estou a ver contigo'); }, get keywords() { return ['mixar', t('ver juntos'), t('está a ver contigo'), t('presença no mixar'), t('esconder que estou a ver'), t('estou aqui')]; } },
  { id: 'mixarSuggestable', group: 'privacidade', get title() { return t('Aparecer nas sugestões de Mixar'); }, get keywords() { return ['mixar', t('faz um mixar com'), t('sugestões do mixar'), t('não me sugerir'), t('sugestões')]; } },
  { id: 'mixarWeekInclude', group: 'privacidade', get title() { return t('Deixar que o resumo da semana me inclua'); }, get keywords() { return ['mixar', t('resumo da semana do mixar'), t('resumo da semana'), t('partilhar o resumo'), 'zás', 'mimos', 'recap']; } },
  // Notificações
  { id: 'deviceNotif', group: 'notificacoes', get title() { return t('Notificações no telemóvel'); }, get keywords() { return ['push', 'alertas', 'avisos', t('ligar notificações'), 'desligadas', t('notificação de teste'), t('neste aparelho')]; } },
  { id: 'installApp', group: 'notificacoes', get title() { return t('Instalar a app'); }, get keywords() { return [t('ecrã principal'), 'pwa', t('adicionar ao ecrã'), 'instalar']; } },
  ...Object.entries(NOTIFY_LABELS).map(([cat, [title]]): SettingsEntry => ({ id: notifyEntryId(cat), group: 'notificacoes', title, keywords: [t('notificações'), 'avisos', ...(NOTIFY_KEYWORDS[cat] ?? [])] })),
  // Conteúdo e o teu algoritmo
  { id: 'dataSaver', group: 'conteudo', get title() { return t('Poupar megas'); }, get keywords() { return ['megas', 'dados', t('dados móveis'), t('poupar dados'), 'data saver', 'internet', 'mb', t('gastar menos'), t('qualidade'), t('vídeos a tocar sozinhos'), 'autoplay']; } },
  { id: 'algorithm', group: 'conteudo', get title() { return t('O teu algoritmo'); }, to: '/reels/filtros', get keywords() { return ['feed', 'tchekas', 'reels', 'interesses', t('tópicos'), t('ver mais'), t('ver menos'), 'filtros', 'explorar', t('recomendações')]; } },
  { id: 'saved', group: 'conteudo', get title() { return t('Guardados'); }, to: '/saved', get keywords() { return [t('favoritos'), t('guardar'), t('marcadores'), t('coleções')]; } },
  { id: 'geleira', group: 'conteudo', get title() { return t('A minha geleira'); }, to: '/geleira', get keywords() { return [t('bebidas'), 'gostos', t('frigorífico')]; } },
  { id: 'geladaBook', group: 'conteudo', get title() { return t('Mostrar o livro das geladas a quem vê a geleira'); }, get keywords() { return [t('livro das geladas'), t('dívidas'), 'deve', 'devo', 'paga-me uma', 'gelada', 'geladas', t('quem me deve')]; } },
  { id: 'remix', group: 'conteudo', get title() { return t('Deixar fazer duetos e respostas com as minhas tchekas'); }, get keywords() { return ['dueto', 'duetos', 'remix', 'remisturar', t('responder com tcheka'), t('respostas com tcheka'), t('resposta em vídeo'), t('responder com vídeo'), t('lado a lado'), t('fazer dueto'), 'reutilizar', 'duet', 'stitch', 'tchekas', 'reels']; } },
  { id: 'insights', group: 'conteudo', get title() { return t('Estatísticas do perfil'); }, to: '/insights', get keywords() { return [t('visitas'), t('alcance'), t('números'), t('insights'), t('estatísticas')]; } },
  { id: 'locais', group: 'conteudo', get title() { return t('Tenho um local (bar, restaurante…)'); }, to: '/locais', get keywords() { return [t('negócio'), 'bar', 'restaurante', t('página'), t('empresa'), 'local']; } },
  { id: 'allowReposts', group: 'conteudo', get title() { return t('Deixar repostar as minhas publicações'); }, get keywords() { return ['repostar', 'repost', 'reposts', 'repostagem', t('partilhar no perfil'), t('partilhar no perfil deles'), 'citar', t('citação'), t('citações'), t('repostar com comentário'), 'retweet', 'retuitar', 'quote', t('impedir que repostem'), t('não deixar repostar'), t('conta privada'), t('publicações')]; } },
  { id: 'soundReuse', group: 'conteudo', get title() { return t('Deixar usar o meu som'); }, get keywords() { return ['som', 'sons', t('som original'), t('usar este som'), t('usar o meu som'), 'reutilizar', t('sons em alta'), t('áudio'), t('música'), 'direitos', 'tchekas', 'reels', 'sound']; } },
  { id: 'allowDownloads', group: 'conteudo', get title() { return t('Deixar guardar as minhas tchekas'); }, get keywords() { return ['guardar', t('guardar vídeo'), t('guardar o vídeo'), t('guardar tchekas'), 'descarregar', t('descarregar vídeo'), 'download', 'baixar', 'transferir', 'galeria', t('copiar vídeo'), t('impedir que guardem'), t('não deixar guardar'), 'tchekas', t('vídeos'), 'reels']; } },
  { id: 'mySounds', group: 'conteudo', get title() { return t('Os meus sons'); }, to: '/settings/sons', get keywords() { return ['som', 'sons', t('som original'), t('retirar o som'), t('retirar o meu som'), t('apagar som'), t('tirar o som'), 'direitos', t('música'), 'tchekas', 'sound']; } },
  { id: 'invites', group: 'conteudo', get title() { return t('Convida a tua malta'); }, to: '/invites', get keywords() { return ['convites', 'convidar', t('código de convite'), 'amigos']; } },
  { id: 'contacts', group: 'conteudo', get title() { return t('Encontrar amigos nos contactos'); }, get keywords() { return ['contactos', 'amigos', 'agenda', t('procurar amigos')]; } },
  // Mensagens e chamadas
  { id: 'dms', group: 'mensagens', get title() { return t('Quem pode enviar-me mensagens'); }, keywords: ['mensagens', 'conversas', 'dm', 'chat', 'txillgroups', 'grupos', 'escrever-me'] },
  // Estas duas mudam-se no menu «⋯» de cada conversa: a linha no ecrã explica onde e leva às Mensagens.
  { id: 'temporaryMessages', group: 'mensagens', get title() { return t('Mensagens temporárias'); }, get keywords() { return ['desaparecer', t('temporárias'), t('efémeras'), t('apagar sozinhas'), 'autodestruir', '24 horas', '7 dias', '90 dias', 'disappearing']; } },
  { id: 'clearChat', group: 'mensagens', get title() { return t('Limpar conversa'); }, get keywords() { return ['limpar', 'esvaziar', t('apagar mensagens'), t('limpar chat'), t('apagar histórico'), t('clear chat')]; } },
  // Só explica (não há opção na API): os avisos de captura nas conversas e o bloqueio no Zás dos outros.
  { id: 'screenshots', group: 'mensagens', get title() { return t('Capturas de ecrã'); }, get keywords() { return ['captura', 'capturas', t('captura de ecrã'), 'print', 'printscreen', 'screenshot', t('aviso de captura'), 'zás']; } },
  // Mixar (0150): a linha explica e leva aos teus Mixar (sair, convites). Os avisos são a categoria «mixar» (0170) e os temas
  // privados têm a entrada mixarPrivateTopics (0172).
  { id: 'mixar', group: 'mensagens', get title() { return t('Os meus Mixar'); }, to: '/mixar', get keywords() { return ['mixar', t('feed a dois'), 'blend', t('mixa challenge'), 'desafio', t('sair do mixar'), t('convite mixar'), 'afinidade', t('guardados do mixar'), t('resumo da semana do mixar'), 'mais 5', t('ver juntos')]; } },
  { id: 'calls', group: 'mensagens', get title() { return t('Quem me pode ligar'); }, get keywords() { return ['chamadas', 'ligar', 'videochamada', t('chamada de voz')]; } },
  { id: 'relay', group: 'mensagens', get title() { return t('Esconder o meu IP nas chamadas'); }, get keywords() { return [t('ip'), t('endereço'), 'servidor', t('relay')]; } },
  { id: 'callLog', group: 'mensagens', get title() { return t('Registo de chamadas'); }, to: '/calls', get keywords() { return [t('histórico de chamadas'), 'chamadas', t('apagar chamadas')]; } },
  // Vibes e pagamentos
  { id: 'wallet', group: 'pagamentos', get title() { return t('Vibes e presentes'); }, to: '/wallet', get keywords() { return ['carteira', 'saldo', 'vibes', 'vib', 'txills', 'moedas', 'presentes', t('o que são vibes'), t('o que são txills'), 'levantar', t('trocar por dinheiro')]; } },
  { id: 'orders', group: 'pagamentos', get title() { return t('Pedidos e pagamentos'); }, to: '/orders', get keywords() { return ['recarregar', t('comprar vibes'), t('comprar txills'), 'pagamentos', 'm-pesa', 'mpesa', 'pedidos', 'recarga']; } },
  // Idiomas
  { id: 'language', group: 'aparencia', get title() { return t('Idiomas'); }, to: '/language', get keywords() { return [t('idioma'), t('língua'), t('português'), t('inglês'), t('english'), t('language'), t('languages')]; } },
  // Segurança
  { id: 'password', group: 'seguranca', get title() { return t('Alterar senha'); }, get keywords() { return ['palavra-passe', 'password', t('mudar senha'), 'senha', t('palavra passe')]; } },
  { id: 'devices', group: 'seguranca', get title() { return t('Os teus aparelhos'); }, get keywords() { return [t('sessões'), 'dispositivos', t('telemóveis'), 'computadores', t('terminar sessão noutros'), t('sessão iniciada'), 'aparelhos']; } },
  // Ajuda e sobre
  { id: 'help', group: 'ajuda', get title() { return t('Ajuda'); }, to: '/help', get keywords() { return ['perguntas', 'suporte', 'faq', t('dúvidas'), 'apoio', 'denunciar', t('denúncia'), 'reportar', 'abuso',
    // O estúdio das tchekas não tem opções nas Definições: quem o procura aqui vai dar às perguntas dele na Ajuda.
    t('estúdio'), t('estúdio das tchekas'), t('editar tcheka'), 'voz-off', t('narração'), 'microfone', t('montagem mágica'), 'rascunhos', t('linha do tempo'), t('cortar clipe'), 'capulana',
    'encher', 'inteiro', 'enquadrar', t('foto cortada'), t('vídeo cortado'), t('vídeo deitado'), t('fundo desfocado'),
    // As letras ao publicar (textos nos mimos, publicações só com texto, legenda do Zás) também não têm opção: só a Ajuda.
    'letra', 'letras', 'fonte', 'fontes', t('tipo de letra'), t('texto no mimo'), t('texto nos mimos'),
    // Guardar uma tcheka (GET /posts/:id/download): a opção é «Deixar guardar as minhas tchekas» (acima, em Conteúdo); como
    // guardar, o que leva a cópia e a música gravada no vídeo (que não tem opção) estão na Ajuda.
    t('guardar tcheka'), t('guardar vídeo'), t('descarregar tcheka'), t('descarregar vídeo'), t('impedir que guardem'), t('marca de água'), 'assinatura', t('música gravada')]; } },
  { id: 'terms', group: 'ajuda', get title() { return t('Termos de utilização'); }, to: '/terms', get keywords() { return ['termos', 'regras', t('condições'), t('tolerância zero'), t('regras da malta')]; } },
  { id: 'privacyPolicy', group: 'ajuda', get title() { return t('Política de privacidade'); }, to: '/privacy', get keywords() { return ['rgpd', t('dados pessoais'), 'privacidade']; } },
  { id: 'about', group: 'ajuda', get title() { return t('Sobre'); }, to: '/about', get keywords() { return [t('sobre o txillapp'), t('informações')]; } },
  { id: 'version', group: 'ajuda', get title() { return t('Versão e atualizações'); }, get keywords() { return ['atualizar', t('versão'), t('procurar atualização'), 'recarregar', 'build', t('nova versão')]; } },
  // Início: contas e sair
  { id: 'addAccount', group: 'inicio', get title() { return t('Adicionar conta'); }, get keywords() { return [t('nova conta'), t('outra conta'), t('várias contas')]; } },
  { id: 'switchAccount', group: 'inicio', get title() { return t('Trocar de conta'); }, get keywords() { return [t('mudar de conta'), t('outra conta'), t('várias contas')]; } },
  { id: 'logout', group: 'inicio', get title() { return t('Terminar sessão'); }, get keywords() { return ['sair', 'logout', 'desligar', t('fechar sessão')]; } },
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
    if (s) hits.push({ kind: 'entry', id: e.id, title: e.title, where: g?.title ?? t('Definições'), path: entryPath(e), s, order: i });
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
  pagamentos: 'pagamentos', payments: 'pagamentos', carteira: 'pagamentos', wallet: 'pagamentos', vibes: 'pagamentos', txills: 'pagamentos', pedidos: 'pagamentos', orders: 'pagamentos',
  aparencia: 'aparencia', appearance: 'aparencia', idioma: 'aparencia', language: 'aparencia',
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
