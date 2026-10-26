import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import { authHeader } from './api';

// "A escrever…": quem escreveu há menos de 5 s. Vive em memória; não é guardado em lado nenhum.
const typingAt = new Map<string, number>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const TYPING_MS = 5000;

/** `true` enquanto essa pessoa está a escrever para mim. */
export function useTyping(username: string): boolean {
  const snap = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => (typingAt.get(username) ?? 0) > Date.now() - TYPING_MS,
  );
  // Quando o tempo passa, volta a avaliar.
  useEffect(() => {
    if (!snap) return;
    const t = setTimeout(notify, TYPING_MS + 50);
    return () => clearTimeout(t);
  }, [snap]);
  return snap;
}

/**
 * Liga ao canal em tempo real do chat (Server-Sent Events) enquanto há sessão.
 * Usa fetch em vez de EventSource para poder enviar o token no cabeçalho. Reconecta sozinho.
 */
export default function ChatLive() {
  const qc = useQueryClient();
  useEffect(() => {
    let stop = false;
    let ctrl: AbortController | null = null;
    let wait = 1000;

    function handle(raw: string) {
      let e: { type: string; from?: string };
      try {
        e = JSON.parse(raw);
      } catch {
        return;
      }
      if (e.type === 'ping') return;
      if (e.type === 'typing' && e.from) {
        typingAt.set(e.from, Date.now());
        notify();
        return;
      }
      void qc.invalidateQueries({ queryKey: ['chat-list'] });
      void qc.invalidateQueries({ queryKey: ['chat-unread'] });
      if (e.from) void qc.invalidateQueries({ queryKey: ['chat-thread', e.from] });
      if (e.type === 'message' && e.from) {
        typingAt.delete(e.from);
        notify();
      }
    }

    async function connect() {
      while (!stop) {
        ctrl = new AbortController();
        try {
          const res = await fetch('/api/v1/chat/stream', { headers: { ...authHeader(), Accept: 'text/event-stream' }, signal: ctrl.signal });
          if (!res.ok || !res.body) throw new Error(String(res.status));
          wait = 1000;
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buf = '';
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let i: number;
            while ((i = buf.indexOf('\n\n')) >= 0) {
              const block = buf.slice(0, i);
              buf = buf.slice(i + 2);
              const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
              if (data) handle(data);
            }
          }
        } catch {
          /* cai a ligação: tenta de novo abaixo */
        }
        if (stop) return;
        await new Promise((r) => setTimeout(r, wait));
        wait = Math.min(wait * 2, 30_000);
      }
    }
    void connect();
    return () => {
      stop = true;
      ctrl?.abort();
    };
  }, [qc]);
  return null;
}
