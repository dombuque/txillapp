/**
 * Tempo real do chat. Liga a GET /api/v1/chat/stream (Server-Sent Events), o mesmo canal do site
 * (apps/web/src/lib/chatLive.tsx). Eventos: JSON em linhas "data:", ex. {type:'message'|'typing'|'ping', from?, group?}.
 *
 * Como liga:
 *  - Web: fetch com leitura em streaming (o cookie da sessão vai com credentials).
 *  - iOS/Android: `fetch` de 'expo/fetch' (suporta ReadableStream); o token vem de refreshSession() a cada ligação,
 *    porque '@/lib/api' não exporta o access token.
 *  - Se o streaming falhar 3 vezes seguidas, passa a "polling inteligente": invalida as queries de 4 em 4 s e volta a
 *    tentar o stream de 60 em 60 s. Em segundo plano (AppState) tudo pára; ao voltar, liga e atualiza logo.
 */
import { useQueryClient } from '@tanstack/react-query';
import { fetch as expoFetch } from 'expo/fetch';
import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { SITE_URL } from '@/lib/config';
import { refreshSession } from '@/lib/api';

export interface ChatEvent { type: string; from?: string; group?: string }

const POLL_MS = 4000;
const RETRY_STREAM_MS = 60_000;
const isWeb = Platform.OS === 'web';

const typingSubs = new Set<(e: ChatEvent) => void>();

/**
 * Chamadas (src/lib/calls): os eventos {type:'call'} vêm no mesmo stream e vão só para quem se inscreve aqui
 * (não mexem nas queries do chat). Durante uma chamada o stream fica ligado mesmo com o separador escondido.
 */
const callSubs = new Set<(e: unknown) => void>();
export function onCallEvent(f: (e: unknown) => void): () => void {
  callSubs.add(f);
  return () => void callSubs.delete(f);
}
let held = false;
const holdSubs = new Set<() => void>();
/** Mantém o stream ligado em segundo plano (durante uma chamada a sinalização não pode parar). */
export function holdStream(on: boolean) {
  if (held === on) return;
  held = on;
  holdSubs.forEach((f) => f());
}

/** "A escrever…" da pessoa `from` (some 5 s depois do último aviso ou quando chega uma mensagem dela). */
export function useTyping(from: string): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!from) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const f = (e: ChatEvent) => {
      if (e.from !== from) return;
      if (e.type === 'typing') {
        setOn(true);
        clearTimeout(t);
        t = setTimeout(() => setOn(false), 5000);
      } else if (e.type === 'message') {
        clearTimeout(t);
        setOn(false);
      }
    };
    typingSubs.add(f);
    return () => {
      typingSubs.delete(f);
      clearTimeout(t);
    };
  }, [from]);
  return on;
}

export function useChatStream(onEvent?: (e: ChatEvent) => void, enabled = true) {
  const qc = useQueryClient();
  const cb = useRef(onEvent);
  cb.current = onEvent;

  useEffect(() => {
    if (!enabled) return;
    let stop = false;
    const isActive = (st = AppState.currentState) => st === 'active' || held;
    let active = isActive();
    let ctrl: AbortController | null = null;
    let wake: (() => void) | null = null;

    const refresh = (e?: ChatEvent) => {
      void qc.invalidateQueries({ queryKey: ['chat-list'] });
      void qc.invalidateQueries({ queryKey: ['chat-unread'] });
      void qc.invalidateQueries({ queryKey: ['chat-groups'] });
      if (e?.group) void qc.invalidateQueries({ queryKey: ['chat-group', e.group] });
      else if (!e) void qc.invalidateQueries({ queryKey: ['chat-group'] });
      if (e?.from) void qc.invalidateQueries({ queryKey: ['chat-thread', e.from] });
      else if (!e) void qc.invalidateQueries({ queryKey: ['chat-thread'] });
    };

    function handle(data: string) {
      let e: ChatEvent;
      try { e = JSON.parse(data) as ChatEvent; } catch { return; }
      if (e.type === 'ping') return;
      if (e.type === 'call') {
        callSubs.forEach((f) => f(e));
        void qc.invalidateQueries({ queryKey: ['calls'] });
        return;
      }
      typingSubs.forEach((f) => f(e));
      cb.current?.(e);
      if (e.type !== 'typing') refresh(e);
    }

    const sleep = (ms: number) => new Promise<void>((r) => {
      const t = setTimeout(() => { wake = null; r(); }, ms);
      wake = () => { clearTimeout(t); wake = null; r(); };
    });

    async function readStream() {
      ctrl = new AbortController();
      const headers: Record<string, string> = { Accept: 'text/event-stream', 'X-Requested-With': 'txillapp' };
      let res: { ok: boolean; status: number; body: ReadableStream<Uint8Array> | null };
      if (isWeb) {
        res = await fetch(`${SITE_URL}/api/v1/chat/stream`, { headers, credentials: 'include', signal: ctrl.signal });
      } else {
        const s = await refreshSession();
        headers.Authorization = `Bearer ${s.accessToken}`;
        headers['X-Client'] = 'txillapp-mobile';
        res = (await expoFetch(`${SITE_URL}/api/v1/chat/stream`, { headers, signal: ctrl.signal })) as unknown as typeof res;
      }
      if (!res.ok || !res.body) throw new Error(String(res.status));
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let got = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        got = true;
        buf += decoder.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
          if (data) handle(data);
        }
      }
      return got;
    }

    async function loop() {
      let fails = 0;
      let wait = 1000;
      while (!stop) {
        if (!active) { await sleep(60_000); continue; }
        if (fails >= 3) {
          // Polling inteligente até ser altura de tentar o stream outra vez.
          const until = Date.now() + RETRY_STREAM_MS;
          while (!stop && active && Date.now() < until) {
            refresh();
            await sleep(POLL_MS);
          }
          if (!stop && active) fails = 2; // uma tentativa de stream; se falhar volta ao polling
          continue;
        }
        try {
          const t0 = Date.now();
          refresh(); // apanha o que se perdeu entre ligações
          await readStream();
          if (Date.now() - t0 > 10_000) { fails = 0; wait = 1000; } else if (active) fails++;
        } catch {
          if (active) fails++;
        }
        if (stop) return;
        await sleep(wait);
        wait = Math.min(wait * 2, 30_000);
      }
    }

    const onState = (s = AppState.currentState) => {
      const was = active;
      active = isActive(s);
      if (!active) ctrl?.abort();
      else if (!was) { refresh(); wake?.(); }
    };
    const sub = AppState.addEventListener('change', (s) => onState(s));
    const onHold = () => onState();
    holdSubs.add(onHold);
    void loop();
    return () => {
      stop = true;
      ctrl?.abort();
      wake?.();
      sub.remove();
      holdSubs.delete(onHold);
    };
  }, [qc, enabled]);
}
