/**
 * Lembrete "As tuas notificações estão desligadas" (como o do Instagram): a lógica pura, sem React nem módulos nativos
 * (os testes em tests/pushReminder.test.mjs importam este ficheiro diretamente).
 *
 * - O estado real das notificações neste aparelho (`nativeStatus`, `webStatus`) e o que o botão faz em cada caso
 *   (`reminderAction`): pedir a licença, abrir as definições do sistema, mostrar os passos do cadeado do browser ou,
 *   no iPhone sem a app no ecrã principal, explicar como a instalar.
 * - Quando mostrar (`decideReminder`): nunca na primeira sessão nem antes do acolhimento das permissões, no máximo uma
 *   vez por dia, e depois de cada "Agora não" espera 3, 7, 14 e depois 30 dias. Os tempos guardam-se neste aparelho.
 */

/** O estado das notificações neste aparelho. */
export type PushStatus =
  /** Ligadas (licença dada e, na web, com subscrição). */
  | 'granted'
  /** Ainda não se pediu (ou na web a licença existe mas falta a subscrição): dá para pedir já. */
  | 'undetermined'
  /** Recusou, mas o sistema ainda deixa pedir outra vez (Android). */
  | 'denied'
  /** Recusou e o sistema já não deixa pedir: só nas definições (do telemóvel ou do browser). */
  | 'blocked'
  /** iPhone no Safari sem a app no ecrã principal: aí o push não existe. */
  | 'needs-install'
  /** Este browser não tem push (ou o servidor ainda não o tem ligado). */
  | 'unsupported'
  /** Na web, desligou de propósito no interruptor das Definições: respeita-se. */
  | 'off-by-choice';

export type ReminderPlatform = 'web' | 'ios' | 'android';
/** De onde vem o pedido para mostrar o lembrete. */
export type ReminderTrigger = 'sent' | 'inbox' | 'return';
/** O que faz o botão "Ligar notificações". */
export type ReminderAction = 'ask' | 'settings' | 'browser-steps' | 'install' | 'none';
/** Que browser/aparelho é, para os passos do cadeado. */
export type WebKind = 'ios-pwa' | 'ios-browser' | 'android' | 'android-pwa' | 'mac-safari' | 'desktop';

export const DAY = 86_400_000;
/** Dias de pausa depois do 1.º, 2.º, 3.º e 4.º (ou mais) "Agora não". */
export const SNOOZE_DAYS = [3, 7, 14, 30] as const;
/** Chave no aparelho (o cofre do telemóvel só aceita letras, números, ".", "-" e "_"). */
export const REMINDER_KEY = 'tx_push_reminder_v1';

export const REMINDER_TITLE = 'As tuas notificações estão desligadas';
export const REMINDER_BUTTON = 'Ligar notificações';
export const REMINDER_LATER = 'Agora não';
export const SETTINGS_BANNER = 'As notificações estão desligadas neste aparelho';

/** O texto da folha: com o nome de quem acabaste de escrever, ou o geral. */
export function reminderText(name?: string | null): string {
  const n = (name ?? '').trim();
  return n ? `Não percas quando ${n} responder.` : 'Não percas mensagens, chamadas e quem brinda o que publicas.';
}

/* ───────────── o que se guarda neste aparelho ───────────── */

export interface ReminderMemory {
  /** Quantas vezes a app abriu com sessão iniciada (a primeira é a 1). */
  sessions: number;
  /** Quando apareceu pela última vez. */
  shownAt: number | null;
  /** Quantos "Agora não" seguidos (volta a 0 quando as notificações ficam ligadas). */
  dismissals: number;
  /** Quando foi o último "Agora não". */
  dismissedAt: number | null;
  /** A última vez que a app esteve à frente (para saber se voltou depois de 1 dia ou mais). */
  activeAt: number | null;
}

export const EMPTY_MEMORY: ReminderMemory = { sessions: 0, shownAt: null, dismissals: 0, dismissedAt: null, activeAt: null };

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

/** Lê o que está guardado; lixo ou nada dá o estado vazio (nunca lança). */
export function parseMemory(raw: string | null | undefined): ReminderMemory {
  if (!raw) return { ...EMPTY_MEMORY };
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (!o || typeof o !== 'object') return { ...EMPTY_MEMORY };
    return {
      sessions: Math.floor(num(o.sessions) ?? 0),
      shownAt: num(o.shownAt),
      dismissals: Math.floor(num(o.dismissals) ?? 0),
      dismissedAt: num(o.dismissedAt),
      activeAt: num(o.activeAt),
    };
  } catch {
    return { ...EMPTY_MEMORY };
  }
}

export const serializeMemory = (m: ReminderMemory): string => JSON.stringify(m);

/** A app abriu (com sessão): conta mais uma sessão e diz se voltou depois de 1 dia ou mais. */
export function startSession(m: ReminderMemory, now: number): { memory: ReminderMemory; returned: boolean } {
  const returned = m.activeAt !== null && now - m.activeAt >= DAY;
  return { memory: { ...m, sessions: m.sessions + 1, activeAt: now }, returned };
}

/** A app voltou para a frente: diz se esteve fora 1 dia ou mais. */
export function markActive(m: ReminderMemory, now: number): { memory: ReminderMemory; returned: boolean } {
  const returned = m.activeAt !== null && now - m.activeAt >= DAY;
  return { memory: { ...m, activeAt: now }, returned };
}

/** A app foi para trás: guarda a hora (é daqui que se conta o "1 dia fora"). */
export const markAway = (m: ReminderMemory, now: number): ReminderMemory => ({ ...m, activeAt: now });
export const markShown = (m: ReminderMemory, now: number): ReminderMemory => ({ ...m, shownAt: now });
export const markDismissed = (m: ReminderMemory, now: number): ReminderMemory => ({ ...m, dismissals: m.dismissals + 1, dismissedAt: now });
/** Ligou as notificações: se um dia as desligar, as pausas recomeçam do início. */
export const markEnabled = (m: ReminderMemory): ReminderMemory => ({ ...m, dismissals: 0, dismissedAt: null });

/** Dias de pausa depois de `dismissals` "Agora não" (0 → sem pausa; 1 → 3; 2 → 7; 3 → 14; 4 ou mais → 30). */
export function snoozeDays(dismissals: number): number {
  if (dismissals <= 0) return 0;
  return SNOOZE_DAYS[Math.min(dismissals, SNOOZE_DAYS.length) - 1];
}

/** A partir de quando pode voltar a aparecer: o dia depois do último e o fim da pausa do último "Agora não". */
export function nextAllowedAt(m: ReminderMemory): number {
  const day = m.shownAt === null ? 0 : m.shownAt + DAY;
  const pause = m.dismissedAt === null ? 0 : m.dismissedAt + snoozeDays(m.dismissals) * DAY;
  return Math.max(day, pause);
}

/* ───────────── quando mostrar ───────────── */

/** Estes estados merecem o lembrete (dá para ligar com um toque, nas definições ou instalando a app). */
export const remindsFor = (s: PushStatus): boolean => s === 'undetermined' || s === 'denied' || s === 'blocked' || s === 'needs-install';

/** Desligou de propósito todos os tipos de aviso nas Definições da app ("O que me pode notificar"). */
export function allCategoriesOff(s: { categories: string[]; off: string[] } | null | undefined): boolean {
  if (!s || !Array.isArray(s.categories) || s.categories.length === 0) return false;
  const off = new Set(s.off ?? []);
  return s.categories.every((c) => off.has(c));
}

/**
 * Só nos ecrãs certos, para nunca tapar uma chamada, a câmara, um Zás ou outra coisa a meio:
 * - 'sent': na conversa com essa pessoa (/messages/<nome>), logo depois de enviar;
 * - 'inbox': na lista de Mensagens;
 * - 'return': no Início ou nas Mensagens.
 */
export function screenAllows(trigger: ReminderTrigger, path: string | null | undefined): boolean {
  const p = (path ?? '').replace(/\/+$/, '') || '/';
  if (trigger === 'sent') return /^\/messages\/[^/]+$/.test(p) && p !== '/messages/new';
  if (trigger === 'inbox') return p === '/messages';
  return p === '/' || p === '/messages';
}

export interface ReminderContext {
  now: number;
  status: PushStatus;
  trigger: ReminderTrigger;
  /** O ecrã atual (o pathname do router). */
  path: string;
  /** Já passou pelo acolhimento das permissões (no nativo; na web não há acolhimento). */
  onboardingDone: boolean;
  allCategoriesOff: boolean;
  /** Há uma chamada, uma folha, a câmara ou um Zás abertos. */
  busy: boolean;
}

export type ReminderWhy = 'show' | 'on-or-unsupported' | 'onboarding' | 'first-session' | 'categories-off' | 'busy' | 'screen' | 'today' | 'snoozed';

/** Mostra ou não, e porquê (o porquê serve para os testes e para perceber o que se passa). */
export function decideReminder(m: ReminderMemory, c: ReminderContext): { show: boolean; why: ReminderWhy } {
  const no = (why: ReminderWhy) => ({ show: false, why });
  if (!remindsFor(c.status)) return no('on-or-unsupported');
  if (!c.onboardingDone) return no('onboarding');
  if (m.sessions < 2) return no('first-session');
  if (c.allCategoriesOff) return no('categories-off');
  if (c.busy) return no('busy');
  if (!screenAllows(c.trigger, c.path)) return no('screen');
  if (m.shownAt !== null && c.now < m.shownAt + DAY) return no('today');
  if (c.now < nextAllowedAt(m)) return no('snoozed');
  return { show: true, why: 'show' };
}

/* ───────────── o estado real, por plataforma ───────────── */

/** Nativo: o que o expo-notifications `getPermissionsAsync` devolve. `resync`: licença dada mas sem código registado no servidor. */
export function nativeStatus(p: { granted: boolean; status: string; canAskAgain: boolean; hasToken: boolean }): { status: PushStatus; resync: boolean } {
  if (p.granted) return { status: 'granted', resync: !p.hasToken };
  if (p.status === 'undetermined') return { status: 'undetermined', resync: false };
  return { status: p.canAskAgain ? 'denied' : 'blocked', resync: false };
}

/**
 * Web: `Notification.permission`, o suporte a service worker/PushManager e, no iPhone, se está no ecrã principal.
 * `choice` é o que a pessoa escolheu no interruptor deste browser ('on', 'off' ou nada).
 * `resync`: a licença está dada e já tinha ligado, mas a subscrição desapareceu: refaz-se em silêncio.
 */
export function webStatus(e: { ios: boolean; standalone: boolean; supported: boolean; permission: string; subscribed: boolean; choice: 'on' | 'off' | null }): { status: PushStatus; resync: boolean } {
  if (e.ios && !e.standalone) return { status: 'needs-install', resync: false };
  if (!e.supported) return { status: 'unsupported', resync: false };
  if (e.permission === 'denied') return { status: 'blocked', resync: false };
  if (e.permission === 'granted') {
    if (e.subscribed) return { status: 'granted', resync: false };
    if (e.choice === 'off') return { status: 'off-by-choice', resync: false };
    return { status: 'undetermined', resync: e.choice === 'on' };
  }
  return { status: 'undetermined', resync: false };
}

/** O que faz o botão "Ligar notificações" em cada estado e plataforma. */
export function reminderAction(status: PushStatus, platform: ReminderPlatform): ReminderAction {
  if (status === 'undetermined' || status === 'denied') return 'ask';
  if (status === 'blocked') return platform === 'web' ? 'browser-steps' : 'settings';
  if (status === 'needs-install') return 'install';
  return 'none';
}

/** Que browser/aparelho é (pelo user agent), para mostrar os passos certos. */
export function webKind(ua: string, o: { standalone: boolean; touchMac?: boolean }): WebKind {
  const ios = /iPad|iPhone|iPod/.test(ua) || !!o.touchMac;
  if (ios) return o.standalone ? 'ios-pwa' : 'ios-browser';
  if (/Android/i.test(ua)) return o.standalone ? 'android-pwa' : 'android';
  if (/Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|CriOS|Edg\/|Firefox|OPR\//.test(ua)) return 'mac-safari';
  return 'desktop';
}

/** No iPhone: é o Safari (só ele instala no ecrã principal em todas as versões)? */
export const isIosSafari = (ua: string): boolean => !/CriOS|FxiOS|EdgiOS|OPiOS|GSA/.test(ua);

/** Os passos para desbloquear as notificações no browser (o "cadeado"). */
export function blockedSteps(kind: WebKind): string[] {
  switch (kind) {
    case 'ios-pwa':
    case 'ios-browser':
      return ['Abre as Definições do iPhone.', 'Toca em Notificações e escolhe Txillapp.', 'Liga “Permitir notificações” e volta ao Txillapp.'];
    case 'android':
      return ['Toca no ícone à esquerda do endereço, em cima (o cadeado ou o das definições).', 'Toca em Permissões › Notificações e escolhe Permitir.', 'Volta aqui e recarrega a página.'];
    case 'android-pwa':
      return ['Toca sem largar no ícone do Txillapp no ecrã principal e escolhe Informações da app (ⓘ).', 'Toca em Notificações e liga-as.', 'Volta ao Txillapp.'];
    case 'mac-safari':
      return ['No menu Safari, abre Definições › Websites.', 'À esquerda, escolhe Notificações.', 'Ao lado do Txillapp, escolhe Permitir e recarrega a página.'];
    default:
      return ['Clica no cadeado (ou no ícone das definições) à esquerda do endereço.', 'Em Notificações, escolhe Permitir.', 'Recarrega a página.'];
  }
}

/** iPhone sem a app no ecrã principal: os passos para a pôr lá (no Safari; noutro browser, primeiro abrir no Safari). */
export function installSteps(safari: boolean): string[] {
  const steps = [
    'Toca em Partilhar (o quadrado com a seta para cima).',
    'Escolhe “Adicionar ao ecrã principal” e depois “Adicionar”.',
    'Abre o Txillapp pelo ícone novo e liga as notificações.',
  ];
  return safari ? steps : ['Abre o Txillapp no Safari.', ...steps];
}

export const INSTALL_NOTE = 'No iPhone, as notificações só funcionam com o Txillapp no ecrã principal.';
