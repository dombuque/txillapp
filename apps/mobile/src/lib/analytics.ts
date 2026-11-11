/**
 * Estatísticas de utilização próprias (nada vai para terceiros), como no site antigo (apps/web/src/lib/analytics.ts).
 * Alimentam o painel do backoffice (GET /admin/stats): ativos por dia/semana/mês, retenção, ecrãs, desempenho, erros e plataformas.
 *
 * Esta é a lógica pura, sem dependências (os testes correm em Node: tests/analytics.test.mjs). Quem a liga à app é
 * lib/analyticsRuntime.ts (rede, armazenamento, segundo plano, sessão da conta, erros globais).
 *
 * - `track(evento, props?)`: só os eventos da lista fechada que a API aceita; tudo em try/catch, nunca rebenta a app.
 * - Fila em memória, enviada em lotes: a cada 15 s, ao chegar a 20 eventos e quando a app vai para segundo plano.
 * - Sem rede (ou servidor em baixo): até 200 eventos ficam guardados no aparelho e seguem depois (até 3 dias).
 * - Respeita "Ajudar a melhorar o Txillapp" (Definições → Privacidade, `shareAnalytics`): desligado, não se envia nada e a
 *   fila é apagada. Enquanto não se sabe a escolha da pessoa, os eventos esperam na fila (não saem do aparelho).
 * - Nada de dados pessoais: nenhum texto escrito pela pessoa (mensagens, legendas, pesquisas), nenhuma posição, nenhum id.
 * - Sessão: um id novo a cada 30 min sem atividade.
 */

/** A lista fechada da API (apps/api/src/analytics/analytics.service.ts → EVENT_NAMES). Outros nomes são recusados lá. */
export const EVENT_NAMES = [
  'app_open', 'screen_view', 'post_create', 'post_open', 'search', 'follow', 'cheer', 'comment', 'repost', 'share',
  'install_prompt', 'install_accepted', 'push_enabled', 'story_view', 'story_create', 'message_send', 'video_view',
  'feed_refresh', 'perf', 'client_error',
] as const;
export type EventName = (typeof EVENT_NAMES)[number];
export type Props = Record<string, string | number | boolean>;
export type AnalyticsPlatform = 'ios' | 'android' | 'web';

/** Um evento na fila. `s` = sessão; `u` = conta que estava aberta (null antes de entrar); `t` = quando aconteceu. */
export interface Queued {
  name: EventName;
  props?: Props;
  t: number;
  s: string;
  u: string | null;
}

/** O corpo do POST /analytics/events. */
export interface Batch {
  sessionId: string;
  platform: AnalyticsPlatform;
  appVersion?: string;
  events: { name: EventName; props?: Props; ago: number }[];
}

/** O resultado de um envio: entregue, tentar mais tarde (sem rede, 401, 429, 5xx) ou deitar fora (400: dados que a API não quer). */
export type SendResult = 'ok' | 'retry' | 'drop';

export interface AnalyticsEnv {
  platform: AnalyticsPlatform;
  version?: string;
  /** `urgent`: a app vai para segundo plano ou a página fecha (na web usa keepalive/sendBeacon). */
  send(batch: Batch, urgent: boolean): Promise<SendResult>;
  /** Guarda a fila no aparelho (pode ser síncrono). */
  save(items: Queued[]): void | Promise<void>;
  load(): Queued[] | Promise<Queued[]>;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
  random?: () => string;
}

export const FLUSH_EVERY_MS = 15_000;
export const FLUSH_AT = 20;
/** A API aceita até 40 eventos por pedido. */
export const BATCH_MAX = 40;
/** Quantos eventos podem esperar no aparelho (sem rede). Os mais antigos saem primeiro. */
export const MAX_STORED = 200;
export const SESSION_IDLE_MS = 30 * 60_000;
/** A API aceita eventos até 3 dias atrás (`ago`); mais velhos já não interessam. */
export const MAX_AGE_MS = 3 * 86_400_000;
const RETRY_MIN_MS = 30_000;
const RETRY_MAX_MS = 5 * 60_000;
/** O mesmo erro conta no máximo 3 vezes por sessão (um ecrã que rebenta em ciclo não enche a fila). */
const SAME_ERROR_MAX = 3;

const isEvent = (n: string): n is EventName => (EVENT_NAMES as readonly string[]).includes(n);

/* ───────────── sem dados pessoais ───────────── */

/** Chaves que nunca vão: texto escrito pela pessoa, posições e contactos. */
const BANNED_KEY = /^(body|text|caption|message_?body|content|q|query|term|lat|lng|lon|latitude|longitude|coords?|location|position|address|email|phone|username|name|user_?id|token)$/i;

/** Tira de um texto o que possa identificar alguém: emails, @nomes, endereços, ids e números compridos. */
export function scrub(text: string, max = 150): string {
  return String(text)
    .replace(/https?:\/\/\S+/gi, '<url>')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '<email>')
    .replace(/@[A-Za-z0-9_.]{2,}/g, '@<nome>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>')
    .replace(/-?\d+\.\d{3,}/g, '<n>') // coordenadas e afins
    .replace(/\d{4,}/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Props limpos: só texto curto, números finitos e verdadeiro/falso; no máximo 12; nada das chaves proibidas. */
export function cleanProps(props?: Record<string, unknown>): Props | undefined {
  if (!props) return undefined;
  const out: Props = {};
  let n = 0;
  for (const [k, v] of Object.entries(props)) {
    if (n >= 12) break;
    if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(k) || BANNED_KEY.test(k)) continue;
    if (typeof v === 'string') out[k] = k === 'message' ? scrub(v) : v.slice(0, 100);
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.round(v * 1000) / 1000;
    else if (typeof v === 'boolean') out[k] = v;
    else continue;
    n++;
  }
  return n ? out : undefined;
}

/* ───────────── nomes dos ecrãs ───────────── */

/**
 * O nome de um ecrã a partir dos segmentos do expo-router (`useSegments`): sem grupos "(tabs)", sem "index" e com os
 * parâmetros como estão no ficheiro, nunca o valor (ex.: ['u','[username]'] → '/u/[username]').
 */
export function routeName(segments: readonly string[]): string {
  const parts = segments.filter((s) => s && !/^\(.*\)$/.test(s) && s !== 'index' && s !== '_layout');
  return `/${parts.join('/')}`.replace(/\/+$/, '') || '/';
}

/**
 * Plano B, a partir do endereço (`usePathname`), para quando não há segmentos: troca o que pareça um id ou um nome por
 * um marcador. Mantém só as palavras fixas conhecidas.
 */
export function pathName(pathname: string): string {
  const p = (pathname.split(/[?#]/)[0] ?? '/').replace(/\/+$/, '') || '/';
  return p
    .replace(/^\/u\/[^/]+/, '/u/[username]')
    .replace(/^\/(messages|m|stories)\/(?!new$)[^/]+/, '/$1/[username]')
    .replace(/^\/(p|r|call|g|evento|place|v)\/[^/]+/, '/$1/[id]')
    .replace(/^\/(t|tag)\/[^/]+/, '/$1/[tag]');
}

/* ───────────── sessão ───────────── */

export interface SessionState { id: string; last: number }

/** A sessão para agora: a mesma se houve atividade há menos de 30 min; senão, uma nova. */
export function nextSession(cur: SessionState | null, now: number, newId: () => string): { session: SessionState; fresh: boolean } {
  if (cur && now - cur.last <= SESSION_IDLE_MS && now >= cur.last - 60_000) return { session: { id: cur.id, last: Math.max(cur.last, now) }, fresh: false };
  return { session: { id: newId(), last: now }, fresh: true };
}

export function randomId(): string {
  try {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c?.randomUUID) return c.randomUUID().replace(/-/g, '');
  } catch {
    /* segue para o plano B */
  }
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 8)}`;
}

/* ───────────── lotes ───────────── */

/**
 * O próximo lote a enviar pela conta `user`: eventos dela (ou de antes de entrar), da mesma sessão, até 40.
 * Devolve também os que deixam de ter destino (de outra conta ou demasiado velhos), para saírem da fila.
 */
export function takeBatch(queue: readonly Queued[], user: string, now: number): { batch: Queued[]; stale: Queued[] } {
  const stale = queue.filter((e) => (e.u !== null && e.u !== user) || now - e.t > MAX_AGE_MS);
  const ok = queue.filter((e) => !stale.includes(e));
  if (!ok.length) return { batch: [], stale };
  const s = ok[0].s;
  return { batch: ok.filter((e) => e.s === s).slice(0, BATCH_MAX), stale };
}

export function toBody(batch: readonly Queued[], platform: AnalyticsPlatform, version: string | undefined, now: number): Batch {
  return {
    sessionId: batch[0].s,
    platform,
    ...(version && /^[0-9A-Za-z._+-]{1,32}$/.test(version) ? { appVersion: version } : {}),
    events: batch.map((e) => ({ name: e.name, ...(e.props ? { props: e.props } : {}), ago: Math.min(Math.max(now - e.t, 0), MAX_AGE_MS) })),
  };
}

/** Só o que é válido sai do armazenamento (pode vir de uma versão antiga ou estragado). */
export function sanitizeStored(raw: unknown, now: number): Queued[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e): e is Queued => !!e && typeof e === 'object' && typeof (e as Queued).name === 'string' && isEvent((e as Queued).name) && typeof (e as Queued).t === 'number' && typeof (e as Queued).s === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test((e as Queued).s))
    .filter((e) => now - e.t <= MAX_AGE_MS && e.t <= now + 60_000)
    .map((e) => ({ name: e.name, t: e.t, s: e.s, u: typeof e.u === 'string' ? e.u : null, ...(cleanProps(e.props) ? { props: cleanProps(e.props) } : {}) }))
    .slice(-MAX_STORED);
}

/* ───────────── o motor ───────────── */

export type Consent = 'unknown' | 'on' | 'off';

export function createAnalytics(env: AnalyticsEnv) {
  const now = env.now ?? Date.now;
  const setTimer = env.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = env.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const newId = env.random ?? randomId;

  let queue: Queued[] = [];
  let consent: Consent = 'unknown';
  let user: string | null = null;
  let session: SessionState | null = null;
  let timer: unknown = null;
  let sending: Promise<void> | null = null;
  let again = false;
  let againUrgent = false;
  let failures = 0;
  let screen = '';
  let dirty = false;
  const errorsSeen = new Map<string, number>();

  const safe = <T>(fn: () => T, fallback: T): T => {
    try {
      return fn();
    } catch {
      return fallback;
    }
  };

  function persist() {
    if (!dirty) return;
    dirty = false;
    try {
      const r = env.save(queue.slice(-MAX_STORED));
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => undefined);
    } catch {
      /* sem armazenamento: fica só em memória */
    }
  }

  function schedule(ms: number) {
    if (timer !== null) return;
    timer = setTimer(() => {
      timer = null;
      void flush();
    }, ms);
  }
  function unschedule() {
    if (timer !== null) safe(() => clearTimer(timer), undefined);
    timer = null;
  }

  /** Regista um evento. Nunca lança erros. */
  function track(name: EventName, props?: Record<string, unknown>) {
    try {
      if (consent === 'off' || !isEvent(name)) return;
      const t = now();
      const next = nextSession(session, t, newId);
      session = next.session;
      if (next.fresh) errorsSeen.clear();
      const clean = cleanProps(props);
      queue.push({ name, t, s: session.id, u: user, ...(clean ? { props: clean } : {}) });
      if (queue.length > MAX_STORED) queue = queue.slice(-MAX_STORED);
      dirty = true;
      if (queue.length >= FLUSH_AT && failures === 0 && consent === 'on' && user) void flush();
      else schedule(FLUSH_EVERY_MS);
    } catch {
      /* nunca rebenta a app */
    }
  }

  /** Um ecrã visto (só quando muda). */
  function screenView(path: string) {
    try {
      if (!path || path === screen) return;
      screen = path;
      track('screen_view', { path });
    } catch {
      /* nada */
    }
  }

  /** Um erro do lado da app: só a mensagem curta e sem dados pessoais, e o ecrã onde estava. */
  function error(err: unknown, kind = 'error') {
    try {
      const raw = err instanceof Error ? err.message || err.name : typeof err === 'string' ? err : String((err as { message?: unknown })?.message ?? err);
      const message = scrub(raw || 'erro') || 'erro';
      const n = (errorsSeen.get(message) ?? 0) + 1;
      errorsSeen.set(message, n);
      if (n > SAME_ERROR_MAX) return;
      track('client_error', { message, kind, ...(screen ? { where: screen } : {}) });
    } catch {
      /* nada */
    }
  }

  /** Envia o que houver (um lote de cada vez). `urgent`: a app vai para segundo plano. */
  function flush(urgent = false): Promise<void> {
    if (sending) {
      // Já há um envio a decorrer: quando acabar, corre outra vez (com o que entretanto chegou).
      again = true;
      againUrgent ||= urgent;
      return sending;
    }
    unschedule();
    const run = async () => {
      try {
        if (consent !== 'on' || !user) {
          persist();
          return;
        }
        for (let round = 0; round < (urgent ? 5 : 10); round++) {
          const { batch, stale } = takeBatch(queue, user, now());
          if (stale.length) {
            queue = queue.filter((e) => !stale.includes(e));
            dirty = true;
          }
          if (!batch.length) break;
          let r: SendResult;
          try {
            r = await env.send(toBody(batch, env.platform, env.version, now()), urgent);
          } catch {
            r = 'retry';
          }
          if (r === 'retry') {
            failures++;
            break;
          }
          failures = 0;
          queue = queue.filter((e) => !batch.includes(e));
          dirty = true;
          if (consent !== 'on') break;
        }
        persist();
      } catch {
        /* nunca rebenta a app */
      }
    };
    // O `.then` corre sempre depois desta função voltar, por isso `sending` já está posto quando é limpo.
    sending = run().then((): Promise<void> | void => {
      sending = null;
      if (again) {
        const u = againUrgent;
        again = false;
        againUrgent = false;
        if (!failures) return flush(u);
      }
      safe(() => {
        if (queue.length && consent === 'on' && user) schedule(failures ? Math.min(RETRY_MIN_MS * 2 ** (failures - 1), RETRY_MAX_MS) : FLUSH_EVERY_MS);
      }, undefined);
    });
    return sending;
  }

  /** A escolha da pessoa (Definições → "Ajudar a melhorar o Txillapp"). Desligado apaga a fila, aqui e no aparelho. */
  function setConsent(c: Consent) {
    try {
      if (c === consent) return;
      consent = c;
      if (c === 'off') {
        unschedule();
        queue = [];
        dirty = true;
        persist();
      } else if (c === 'on') {
        void flush();
      }
    } catch {
      /* nada */
    }
  }

  /** A conta com sessão aberta (null ao sair). Ao mudar de conta, a escolha volta a "por saber" até se ler a da nova conta. */
  function setUser(id: string | null) {
    try {
      if (id === user) return;
      user = id;
      consent = 'unknown';
      unschedule();
    } catch {
      /* nada */
    }
  }

  /** Arranque: junta à fila o que ficou guardado no aparelho (sem rede da última vez). */
  async function restore() {
    try {
      const stored = sanitizeStored(await env.load(), now());
      if (!stored.length) return;
      const have = new Set(queue.map((e) => `${e.s}:${e.t}:${e.name}`));
      queue = [...stored.filter((e) => !have.has(`${e.s}:${e.t}:${e.name}`)), ...queue].slice(-MAX_STORED);
      if (consent === 'on' && user) schedule(FLUSH_EVERY_MS);
    } catch {
      /* armazenamento estragado: começa do zero */
    }
  }

  /** Volta do segundo plano: se passou mais de 30 min sem atividade, conta como uma abertura nova (sessão nova). */
  function resumed(): boolean {
    try {
      if (session && now() - session.last <= SESSION_IDLE_MS) return false;
      track('app_open', { resume: true });
      return true;
    } catch {
      return false;
    }
  }

  /** Vai para segundo plano: envia já (ou guarda no aparelho, se não der). */
  function backgrounded() {
    try {
      persist();
      dirty = true;
      void flush(true);
    } catch {
      /* nada */
    }
  }

  return {
    track,
    screenView,
    error,
    flush,
    setConsent,
    setUser,
    restore,
    resumed,
    backgrounded,
    /** Grava já no aparelho (antes de a app fechar por um erro fatal). */
    persistNow: () => {
      dirty = true;
      persist();
    },
    /** Para os testes e para quem precise de saber. */
    state: () => ({ queue: [...queue], consent, user, session, screen, failures, scheduled: timer !== null }),
  };
}

export type Analytics = ReturnType<typeof createAnalytics>;

/* ───────────── a instância da app ───────────── */

/**
 * Antes de a app ligar o motor (lib/analyticsRuntime), os eventos esperam aqui (até 200). Assim `track` pode ser chamado
 * de qualquer sítio (lib/api*.ts, publishQueue…) sem saber se a app já arrancou.
 */
let instance: Analytics | null = null;
const early: [EventName, Record<string, unknown> | undefined][] = [];

export function installAnalytics(a: Analytics) {
  instance = a;
  for (const [n, p] of early.splice(0)) a.track(n, p);
}

/** Regista um evento de uso. Nunca lança erros e nunca atrasa quem chama. */
export function track(name: EventName, props?: Record<string, unknown>) {
  try {
    if (instance) instance.track(name, props);
    else if (early.length < MAX_STORED) early.push([name, props]);
  } catch {
    /* nunca rebenta a app */
  }
}

type MaybeProps = Record<string, unknown> | null | undefined | false;
/**
 * Depois de uma promessa correr bem, regista o evento (com props calculados a partir do resultado, se for preciso; `false`
 * ou `null` = não regista). Devolve o mesmo resultado; se falhar, não regista nada e o erro segue para quem chamou.
 */
export function trackOk<T>(p: Promise<T>, name: EventName, props?: MaybeProps | ((r: T) => MaybeProps)): Promise<T> {
  return p.then((r) => {
    try {
      const v = typeof props === 'function' ? props(r) : props;
      if (v !== false && v !== null) track(name, v ?? undefined);
    } catch {
      /* nada */
    }
    return r;
  });
}

/** No máximo um evento deste nome por `ms` (ex.: a pesquisa, que corre a cada tecla). */
const lastAt = new Map<string, number>();
export function trackThrottled(name: EventName, ms: number, props?: Record<string, unknown>) {
  try {
    const t = Date.now();
    if (t - (lastAt.get(name) ?? 0) < ms) return;
    lastAt.set(name, t);
    track(name, props);
  } catch {
    /* nada */
  }
}
