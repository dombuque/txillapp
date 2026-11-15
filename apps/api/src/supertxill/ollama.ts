/**
 * Cliente mínimo do Ollama (POST /api/chat, sem streaming), para o SuperTxill. O Ollama corre na máquina da Txillada, atrás
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

export type OllamaChat = (req: OllamaChatRequest, signal: AbortSignal) => Promise<OllamaChatResponse>;

/** O pedido HTTP ao Ollama. `url` sem a barra final (ex.: https://llm.txillapp.com). */
export function ollamaClient(url: string, token?: string): OllamaChat {
  const base = url.replace(/\/+$/, '');
  return async (req, signal) => {
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ ...req, stream: false }),
      signal,
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = text.slice(0, 300);
      try {
        msg = (JSON.parse(text) as { error?: string }).error ?? msg;
      } catch {
        /* não é JSON */
      }
      throw new OllamaError(res.status, msg);
    }
    return JSON.parse(text) as OllamaChatResponse;
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

/** Tira o raciocínio que alguns modelos deixam no texto (<think>…</think>) quando o `think` não está ligado. */
export function stripThinking(s: string): string {
  return s.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*?<\/think>/i, '').trim();
}
