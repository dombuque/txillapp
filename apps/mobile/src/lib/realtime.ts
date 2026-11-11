/**
 * Tempo real do chat. Liga a GET /api/v1/chat/stream (Server-Sent Events), o mesmo canal do site
 * (apps/web/src/lib/chatLive.tsx). Eventos: JSON em linhas "data:", ex. {type:'message'|'typing'|'ping', from?, group?}.
 *
 * Como liga:
 *  - Web: fetch com leitura em streaming (o cookie da sessão vai com credentials).
 *  - iOS/Android: `fetch` de 'expo/fetch' (suporta ReadableStream); o token vem de refreshSession() a cada ligação,
 *    porque '@/lib/api' não exporta o access token.
 *  - Se o streaming falhar 3 vezes seguidas, passa a "polling inteligente": invalida as queries de 4 em 4 s e volta a
 *    tentar o stream de 60 em 60 s. Em segundo plano (AppState; na web, o separador escondido) tudo pára; ao voltar,
 *    liga e atualiza logo.
 *  - Vigia (lib/streamEvents): sem dados há mais de 60 s (o ping vem de 25 em 25 s), o stream caiu em silêncio
 *    (proxy, rede móvel, iOS em segundo plano breve): aborta e volta a ligar, em vez de ficar pendurado no read().
 *
 * A mesma conta em vários aparelhos: o servidor manda também a mim o eco do que faço (`self: true`, com `from` = o outro
 * lado da conversa). Esses só põem os dados em dia (lib/streamEvents → planChatEvent): sem "a escrever…" nem onEvent.
 */
import { useQueryClient } from '@tanstack/react-query';
import { fetch as expoFetch } from 'expo/fetch';
import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { SITE_URL } from '@/lib/config';
import { authHeaders, refreshSession } from '@/lib/api';
import { planChatEvent, refreshKeys, startWatchdog, type StreamChatEvent } from '@/lib/streamEvents';

export type ChatEvent = StreamChatEvent;

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
    /** Corta a ligação atual (aborta o pedido e cancela a leitura, para o read() não ficar pendurado). */
    let kill: (() => void) | null = null;
    let wake: (() => void) | null = null;

    const invalidate = (keys: readonly (readonly unknown[])[]) => {
      for (const queryKey of keys) void qc.invalidateQueries({ queryKey });
    };
    const refresh = (e?: ChatEvent) => invalidate(refreshKeys(e));

    function handle(data: string) {
      let e: ChatEvent;
      try { e = JSON.parse(data) as ChatEvent; } catch { return; }
      if (e.type === 'ping') return;
      if (e.type === 'call') {
        callSubs.forEach((f) => f(e));
        void qc.invalidateQueries({ queryKey: ['calls'] });
        return;
      }
      if (e.type === 'group') {
        // TxillGroups: mudou o Plano, uma sondagem, a lista, as despesas ou a vaquinha. Só refresca o que mudou.
        const g = e as ChatEvent & { groupId?: string; what?: string };
        if (!g.groupId) return;
        if (g.what === 'pot') {
          void qc.invalidateQueries({ queryKey: ['group-pot', g.groupId] });
          void qc.invalidateQueries({ queryKey: ['wallet'] });
        }
        void qc.invalidateQueries({ queryKey: ['group-plan', g.groupId] });
        if (g.what === 'plan' || g.what === 'pot' || g.what === 'info') {
          void qc.invalidateQueries({ queryKey: ['chat-groups'] });
          void qc.invalidateQueries({ queryKey: ['chat-group', g.groupId] });
        }
        // 'info': mudou o nome, a foto ou quem vê e quem entra, ou chegou (ou saiu) um pedido para entrar (os admins recebem-no).
        if (g.what === 'info') {
          void qc.invalidateQueries({ queryKey: ['group-join-requests', g.groupId] });
          void qc.invalidateQueries({ queryKey: ['group-public', g.groupId] });
        }
        return;
      }
      // Eco do que eu fiz (self): só põe os dados em dia; não desliga o "a escrever…" do outro nem chega ao onEvent.
      const plan = planChatEvent(e);
      if (plan.notify) {
        typingSubs.forEach((f) => f(e));
        cb.current?.(e);
      }
      invalidate(plan.keys);
    }

    const sleep = (ms: number) => new Promise<void>((r) => {
      const t = setTimeout(() => { wake = null; r(); }, ms);
      wake = () => { clearTimeout(t); wake = null; r(); };
    });

    async function readStream() {
      const ac = new AbortController();
      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
      const cut = () => {
        ac.abort();
        void reader?.cancel().catch(() => undefined);
      };
      kill = cut;
      // Vigia: sem nada do servidor (nem o ping de 25 s) em 60 s, desiste desta ligação e volta a ligar.
      // Aborta o pedido e cancela a leitura (o read() pendurado acaba com done, ou com erro do abort).
      let stalled = false;
      let got = false;
      const dog = startWatchdog(() => {
        stalled = true;
        cut();
      });
      try {
        await readFrom(ac, (r) => { reader = r; }, () => { got = true; dog.feed(); });
        // Respondeu mas nunca mandou nada (ex.: um proxy que guarda o stream): é uma falha, para cair no polling.
        if (stalled && !got) throw new Error('stalled');
        return got;
      } catch (err) {
        // Pendurada depois de já ter recebido dados: é uma ligação que acabou (volta a ligar logo, sem contar como falha).
        // Se nunca chegou nada (o pedido nem respondeu), conta como falha (3 seguidas → polling).
        if (stalled && got) return true;
        throw err;
      } finally {
        dog.stop();
        if (kill === cut) kill = null;
      }
    }

    async function readFrom(ac: AbortController, onReader: (r: ReadableStreamDefaultReader<Uint8Array>) => void, feed: () => void) {
      const headers: Record<string, string> = { Accept: 'text/event-stream', 'X-Requested-With': 'txillapp' };
      let res: { ok: boolean; status: number; body: ReadableStream<Uint8Array> | null };
      if (isWeb) {
        // No site o cookie da sessão só vai para /auth (HttpOnly, por conta): o stream precisa do token e da conta,
        // como qualquer pedido da API. Sem isto dava 401 e o chat caía para o polling (e as chamadas não ligavam).
        const s = await refreshSession();
        res = await fetch(`${SITE_URL}/api/v1/chat/stream`, { headers: { ...authHeaders(), ...headers, Authorization: `Bearer ${s.accessToken}` }, credentials: 'include', signal: ac.signal });
      } else {
        const s = await refreshSession();
        headers.Authorization = `Bearer ${s.accessToken}`;
        headers['X-Client'] = 'txillapp-mobile';
        res = (await expoFetch(`${SITE_URL}/api/v1/chat/stream`, { headers, signal: ac.signal })) as unknown as typeof res;
      }
      if (!res.ok || !res.body) throw new Error(String(res.status));
      if (ac.signal.aborted) throw new Error('aborted');
      const reader = res.body.getReader();
      onReader(reader);
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        feed();
        buf += decoder.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
          if (data) handle(data);
        }
      }
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
      if (!active) kill?.();
      else if (!was) { refresh(); wake?.(); }
    };
    const sub = AppState.addEventListener('change', (s) => onState(s));
    const onHold = () => onState();
    holdSubs.add(onHold);
    void loop();
    return () => {
      stop = true;
      kill?.();
      wake?.();
      sub.remove();
      holdSubs.delete(onHold);
    };
  }, [qc, enabled]);
}
