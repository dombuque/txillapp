/**
 * «Seguinte» no estúdio nativo: enviar os ficheiros, pedir a montagem e esperar por ela (sem React nem rede; testado em
 * tests/studioComposeJob.test.mjs). A rede está em lib/studio/composeRunner.ts; aqui estão as contas e as decisões:
 * - que ficheiros falta enviar (um por `media`; os que já foram numa tentativa anterior não voltam a ir);
 * - o progresso de tudo (os envios e depois o do servidor) e a fase que se mostra, com as palavras do docs/montagem.md;
 * - as mensagens dos erros do servidor (400 com a dica, 409, 429…) e quando vale a pena tentar outra vez;
 * - o registo guardado no aparelho, para retomar a montagem ao voltar à app (ou ao abri-la de novo).
 *
 * Só importa tipos (o node corre este ficheiro direto).
 */

export const JOB_VERSION = 1;
/** A montagem tem 480 s de prazo no servidor e pode esperar na fila: passado este tempo, um registo já não se retoma. */
export const JOB_MAX_AGE_MS = 20 * 60_000;
/** Do progresso total, a parte dos envios (o resto é a montagem no servidor). */
export const UPLOAD_SHARE = 0.4;
/** Quantas vezes se volta a tentar um envio que caiu por falta de rede. */
export const UPLOAD_RETRIES = 4;

export interface UploadFile {
  /** A chave `media` do clipe, ou `voz:<id>` para a voz-off. */
  key: string;
  uri: string;
  mime: string;
  kind: 'video' | 'photo' | 'voice';
}
export interface SentFile { uri: string; mediaId: string }
export interface JobRecord {
  v: number;
  /** O rascunho do estúdio a que pertence. */
  draftId: string;
  /** Os ficheiros já enviados (pela chave), com o caminho de onde saíram. */
  sent: Record<string, SentFile>;
  /** A montagem pedida e de que projeto (a assinatura do pedido). */
  jobId?: string;
  sig?: string;
  /** Quando se pediu (ms). */
  at?: number;
  /** A pessoa desistiu de esperar: a montagem continua no servidor, mas a app não a retoma sozinha. */
  cancelled?: boolean;
}
export const emptyRecord = (draftId: string): JobRecord => ({ v: JOB_VERSION, draftId, sent: {} });

/** Lê um registo guardado (null se não servir). */
export function parseRecord(text: string | null | undefined): JobRecord | null {
  if (!text) return null;
  try {
    const r = JSON.parse(text) as Partial<JobRecord>;
    if (!r || r.v !== JOB_VERSION || typeof r.draftId !== 'string' || !r.sent || typeof r.sent !== 'object') return null;
    const sent: Record<string, SentFile> = {};
    for (const [k, v] of Object.entries(r.sent)) if (v && typeof v.uri === 'string' && typeof v.mediaId === 'string') sent[k] = { uri: v.uri, mediaId: v.mediaId };
    return { v: JOB_VERSION, draftId: r.draftId, sent, ...(typeof r.jobId === 'string' ? { jobId: r.jobId } : {}), ...(typeof r.sig === 'string' ? { sig: r.sig } : {}), ...(typeof r.at === 'number' ? { at: r.at } : {}), ...(r.cancelled ? { cancelled: true } : {}) };
  } catch { return null; }
}

/** Os ficheiros do projeto, um por `media` (as partes divididas e as cópias partilham o ficheiro), e a voz-off. */
export function uploadFiles(clips: readonly { media: string; uri: string; mime: string; video: boolean }[], voice?: { id: string; uri?: string; mime?: string } | null): UploadFile[] {
  const out: UploadFile[] = [];
  const seen = new Set<string>();
  for (const c of clips) {
    if (seen.has(c.media)) continue;
    seen.add(c.media);
    out.push({ key: c.media, uri: c.uri, mime: c.mime, kind: c.video ? 'video' : 'photo' });
  }
  if (voice?.uri) out.push({ key: `voz:${voice.id}`, uri: voice.uri, mime: voice.mime || 'audio/mp4', kind: 'voice' });
  return out;
}

/** O que já foi enviado e ainda vale (o mesmo ficheiro, do mesmo caminho) e o que falta enviar. */
export function uploadPlan(files: readonly UploadFile[], rec: JobRecord | null | undefined): { ready: Record<string, string>; pending: UploadFile[] } {
  const ready: Record<string, string> = {};
  const pending: UploadFile[] = [];
  for (const f of files) {
    const s = rec?.sent[f.key];
    if (s && s.uri === f.uri) ready[f.key] = s.mediaId; else pending.push(f);
  }
  return { ready, pending };
}

/** O registo com mais um ficheiro enviado. */
export const withSent = (rec: JobRecord, key: string, s: SentFile): JobRecord => ({ ...rec, sent: { ...rec.sent, [key]: s } });
/** O registo sem um ficheiro (o servidor recusou-o ou perdeu-o: envia-se de novo). */
export function withoutSent(rec: JobRecord, key: string): JobRecord {
  const sent = { ...rec.sent };
  delete sent[key];
  return { ...rec, sent };
}
/** O registo com a montagem pedida. */
export const withJob = (rec: JobRecord, jobId: string, sig: string, now: number): JobRecord => ({ v: rec.v, draftId: rec.draftId, sent: rec.sent, jobId, sig, at: now });
/** A montagem acabou (bem ou mal): os ficheiros enviados ficam (servem para tentar outra vez), a montagem sai. */
export const withoutJob = (rec: JobRecord): JobRecord => ({ v: rec.v, draftId: rec.draftId, sent: rec.sent });

export type Resume = { action: 'none' } | { action: 'poll'; jobId: string; same: boolean };
/**
 * Há uma montagem a meio para retomar? Sim se o registo tem um `jobId` recente. `same` diz se é deste projeto tal como
 * está agora (a mesma assinatura): se for, o resultado serve; se não, é uma montagem antiga que ainda ocupa a vez no servidor.
 */
export function resumeOf(rec: JobRecord | null | undefined, sig: string | null, now: number): Resume {
  if (!rec?.jobId) return { action: 'none' };
  if (rec.at != null && now - rec.at > JOB_MAX_AGE_MS) return { action: 'none' };
  return { action: 'poll', jobId: rec.jobId, same: !!sig && rec.sig === sig };
}

// ---------------------------------------------------------------- progresso e fases

export type RunPhase = 'enviar' | 'preparar-ficheiros' | 'pedir' | 'fila' | 'preparar' | 'clipes' | 'final' | 'acabar';
export interface RunState {
  phase: RunPhase;
  /** 0 a 1 de tudo. */
  progress: number;
  /** A frase grande. */
  title: string;
  /** A linha por baixo. */
  detail: string;
}

/** A fase da montagem no servidor a partir do `status` e do `progress` dele (docs/montagem.md, secção 3). */
export function serverPhase(status: string, progress: number): RunPhase {
  if (status === 'queued') return 'fila';
  if (progress < 0.08) return 'preparar';
  if (progress < 0.45) return 'clipes';
  if (progress < 0.95) return 'final';
  return 'acabar';
}

const PHASE_TITLE: Record<RunPhase, string> = {
  enviar: 'A enviar os clipes…',
  'preparar-ficheiros': 'A preparar os vídeos…',
  pedir: 'A pedir a montagem…',
  fila: 'Na fila da montagem…',
  preparar: 'A preparar a montagem…',
  clipes: 'A montar os clipes…',
  final: 'A juntar o vídeo final…',
  acabar: 'Quase pronto…',
};

/** O estado durante os envios: `index` é o ficheiro que está a ir (a contar do 0), `part` o progresso dele (0 a 1). */
export function uploadState(index: number, count: number, part: number, kind: UploadFile['kind'] = 'photo', retry = 0): RunState {
  const n = Math.max(1, count);
  const p = Math.max(0, Math.min(1, (index + Math.max(0, Math.min(1, part))) / n));
  const what = kind === 'voice' ? 'a voz-off' : kind === 'video' ? `o vídeo ${Math.min(index + 1, n)} de ${n}` : `o ficheiro ${Math.min(index + 1, n)} de ${n}`;
  return {
    phase: 'enviar', progress: p * UPLOAD_SHARE, title: PHASE_TITLE.enviar,
    detail: retry > 0 ? `A rede caiu. A tentar outra vez (${retry} de ${UPLOAD_RETRIES})…` : `A enviar ${what} · ${Math.round(Math.max(0, Math.min(1, part)) * 100)}%`,
  };
}
/** Os vídeos enviados estão a ser convertidos no servidor. */
export const preparingState = (): RunState => ({ phase: 'preparar-ficheiros', progress: UPLOAD_SHARE, title: PHASE_TITLE['preparar-ficheiros'], detail: 'O servidor está a converter os vídeos enviados.' });
export const requestingState = (): RunState => ({ phase: 'pedir', progress: UPLOAD_SHARE, title: PHASE_TITLE.pedir, detail: 'Os ficheiros já estão no servidor.' });
/** O estado durante a montagem no servidor. */
export function serverState(status: string, progress: number, waitedMs = 0): RunState {
  const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  const phase = serverPhase(status, p);
  const detail = phase === 'fila'
    ? 'Há outras tchekas à frente. A tua começa logo a seguir.'
    : waitedMs > 90_000 ? 'Está a demorar um pouco mais. Podes sair da app: a montagem continua no servidor.' : 'A montagem faz-se no servidor. Podes sair da app e voltar.';
  return { phase, progress: UPLOAD_SHARE + (1 - UPLOAD_SHARE) * p, title: PHASE_TITLE[phase], detail };
}

// ---------------------------------------------------------------- erros

export interface ComposeProblem {
  /** A frase para a pessoa. */
  message: string;
  /** O que fazer: corrigir o projeto, esperar a montagem que já corre, tentar mais tarde, ou tentar já outra vez. */
  kind: 'corrigir' | 'ocupado' | 'limite' | 'sessao' | 'rede' | 'servidor';
  /** O pedido tem campos que este servidor não conhece (pode tentar-se sem os panos e sem o som por clipe). */
  unknownField?: boolean;
}

/** A mensagem de um erro do pedido de montagem (o servidor já escreve em português as dicas das regras). */
export function composeProblem(status: number, message?: string | null): ComposeProblem {
  const msg = (message ?? '').trim();
  if (status === 400) return { kind: 'corrigir', message: msg || 'A tcheka ainda não cumpre as regras.', unknownField: /^Pedido inválido/i.test(msg) };
  if (status === 422) return { kind: 'corrigir', message: msg || 'Um texto ou um ficheiro desta tcheka não pode ser publicado.' };
  if (status === 403 || status === 404) return { kind: 'corrigir', message: msg || 'Um dos ficheiros já não está disponível.' };
  if (status === 409) return { kind: 'ocupado', message: msg || 'Já tens uma tcheka a montar. Espera que acabe.' };
  if (status === 429) return { kind: 'limite', message: 'Fizeste muitas montagens na última hora. Tenta outra vez daqui a pouco.' };
  if (status === 401) return { kind: 'sessao', message: 'A sessão acabou. Entra outra vez para montar a tcheka.' };
  if (status === 413) return { kind: 'corrigir', message: msg || 'Um dos ficheiros é pesado demais.' };
  if (status === 0) return { kind: 'rede', message: 'Sem ligação. Vê a rede e tenta outra vez: os clipes já enviados não voltam a ir.' };
  return { kind: 'servidor', message: status >= 500 ? 'O servidor não conseguiu montar a tcheka agora. Tenta outra vez.' : msg || 'Não consegui montar a tcheka. Tenta outra vez.' };
}

/** Um erro de rede (sem resposta do servidor): vale a pena tentar outra vez sozinho. */
export const isNetworkError = (status: number | undefined | null) => status === 0 || status === undefined || status === null;

/** A espera antes de voltar a tentar um envio que caiu (ms): 1,5 s, 3 s, 6 s, 10 s. */
export const retryDelay = (attempt: number) => Math.min(10_000, 1500 * 2 ** Math.max(0, attempt - 1));

/** De quanto em quanto se pergunta pela montagem (ms): 1 s; com falhas de rede seguidas, mais devagar (até 8 s). */
export const pollDelay = (failures = 0) => (failures <= 0 ? 1000 : Math.min(8000, 1000 * 2 ** failures));
/** Quantas falhas de rede seguidas a perguntar pela montagem até se desistir (a montagem continua no servidor). */
export const POLL_MAX_FAILURES = 8;

/** O estado final de uma pergunta ao servidor. */
export type PollOutcome = { kind: 'wait' } | { kind: 'done'; mediaId: string; durationMs?: number } | { kind: 'failed'; message: string } | { kind: 'gone' };
export function pollOutcome(status: number, body: { status?: string; mediaId?: string; durationMs?: number; error?: string } | null | undefined): PollOutcome {
  if (status === 404) return { kind: 'gone' };
  if (!body || status < 200 || status >= 300) return { kind: 'wait' };
  if (body.status === 'done' && body.mediaId) return { kind: 'done', mediaId: body.mediaId, ...(typeof body.durationMs === 'number' ? { durationMs: body.durationMs } : {}) };
  if (body.status === 'failed') return { kind: 'failed', message: body.error || 'Não consegui montar a tcheka. Tenta outra vez.' };
  return { kind: 'wait' };
}
