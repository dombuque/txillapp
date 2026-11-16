/**
 * Cliente mínimo do Ollama (POST /api/chat), para o SuperTxill. Com `onText` pede em stream (NDJSON) e vai entregando o
 * texto que o modelo já escreveu; sem `onText`, pede tudo de uma vez. O Ollama corre na máquina da Txillada, atrás
 * do Caddy, que só deixa passar pedidos com `Authorization: Bearer <OLLAMA_TOKEN>` (infra/live/README.md).
 */

export interface OllamaToolCall {
  function: { name: string; arguments: Record<string, unknown> | string };
}

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Só nas respostas do modelo (e quando as devolvemos no histórico). */
  tool_calls?: OllamaToolCall[];
  /** Nas respostas das ferramentas: o nome da ferramenta. */
  tool_name?: string;
  /** O raciocínio (com `think`). Nunca se mostra nem se guarda. */
  thinking?: string;
}

export interface OllamaTool {
  type: 'function';
  function: { name: string; description: string; parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] } };
}

export interface OllamaChatRequest {
  model: string;
  messages: OllamaMessage[];
  tools?: OllamaTool[];
  think?: boolean;
  options?: Record<string, unknown>;
  keep_alive?: string;
}

export interface OllamaChatResponse {
  message: OllamaMessage;
  done: boolean;
  done_reason?: string;
  eval_count?: number;
  eval_duration?: number;
}

export class OllamaError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * O pedido ao Ollama. `onText` (opcional): stream; recebe o texto todo escrito até agora (não só o pedaço novo), a cada
 * pedaço. A resposta final junta tudo (texto, raciocínio e chamadas de ferramentas), como sem stream.
 */
export type OllamaChat = (req: OllamaChatRequest, signal: AbortSignal, onText?: (soFar: string) => void) => Promise<OllamaChatResponse>;

function errorOf(status: number, text: string) {
  let msg = text.slice(0, 300);
  try {
    msg = (JSON.parse(text) as { error?: string }).error ?? msg;
  } catch {
    /* não é JSON */
  }
  return new OllamaError(status, msg);
}

/** Junta as linhas do stream do Ollama (NDJSON) numa só resposta. Uma linha com `error` a meio rebenta como OllamaError. */
export async function readStream(body: ReadableStream<Uint8Array>, onText: (soFar: string) => void): Promise<OllamaChatResponse> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let content = '';
  let thinking = '';
  const calls: OllamaToolCall[] = [];
  let last: Partial<OllamaChatResponse> = {};
  const line = (l: string) => {
    if (!l.trim()) return;
    const j = JSON.parse(l) as Partial<OllamaChatResponse> & { error?: string };
    if (j.error) throw new OllamaError(500, j.error);
    const m = j.message;
    if (m?.thinking) thinking += m.thinking;
    if (m?.tool_calls?.length) calls.push(...m.tool_calls);
    if (m?.content) {
      content += m.content;
      onText(content);
    }
    last = j;
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      line(buf.slice(0, i));
      buf = buf.slice(i + 1);
    }
  }
  line(buf + dec.decode());
  return {
    done: true,
    done_reason: last.done_reason,
    eval_count: last.eval_count,
    eval_duration: last.eval_duration,
    message: { role: 'assistant', content, ...(thinking ? { thinking } : {}), ...(calls.length ? { tool_calls: calls } : {}) },
  };
}

/** O pedido HTTP ao Ollama. `url` sem a barra final (ex.: https://llm.txillapp.com). */
export function ollamaClient(url: string, token?: string): OllamaChat {
  const base = url.replace(/\/+$/, '');
  return async (req, signal, onText) => {
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ ...req, stream: !!onText }),
      signal,
    });
    if (!res.ok) throw errorOf(res.status, await res.text());
    if (onText && res.body) return readStream(res.body, onText);
    return JSON.parse(await res.text()) as OllamaChatResponse;
  };
}

/** Os argumentos de uma chamada de ferramenta (o Ollama manda um objeto; alguns modelos mandam texto JSON). */
export function toolArgs(c: OllamaToolCall): Record<string, unknown> {
  const a = c.function.arguments;
  if (a && typeof a === 'object') return a;
  if (typeof a === 'string') {
    try {
      const v = JSON.parse(a) as unknown;
      return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * O que já se pode mostrar de um texto a meio: sem o raciocínio (<think>…</think>), sem um <think> ainda por fechar, sem
 * o início de uma etiqueta cortada no fim («<thi») e sem emojis.
 */
export function visiblePartial(s: string): string {
  let t = s.replace(/<think>[\s\S]*?<\/think>/gi, '');
  t = t.replace(/^[\s\S]*?<\/think>/i, '');
  const open = t.search(/<think>/i);
  if (open >= 0) t = t.slice(0, open);
  const tail = /<\/?[a-z]{0,5}$/i.exec(t);
  if (tail && '<think>'.startsWith(tail[0].toLowerCase().replace('/', ''))) t = t.slice(0, tail.index);
  return noEmoji(t);
}

/** Tira o raciocínio que alguns modelos deixam no texto (<think>…</think>) quando o `think` não está ligado. */
export function stripThinking(s: string): string {
  return s.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*?<\/think>/i, '').trim();
}

/** Tira os emojis (o SuperTxill não os usa, mas os modelos pequenos às vezes escapam-se). */
export function noEmoji(s: string): string {
  return s
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]/gu, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([.,!?;:])/g, '$1')
    .trim();
}
