/**
 * O serviço em primeiro plano das chamadas no Android (modules/call-service): com ele, o microfone e a câmara continuam
 * a funcionar quando a pessoa sai da app a meio de uma chamada. Desde o Android 14, sem ele o sistema corta-os.
 *
 * Aqui fica só a regra de quando o serviço corre, sem react-native, para os testes. A ponte para o módulo nativo está em
 * ./callServiceNative.ts e liga-se no CallOverlay.
 * - Corre enquanto há chamada ligada ou a ligar (liguei eu, ou atendi) E já há microfone aberto (o `local`). Só com a
 *   licença do microfone dada é que o Android deixa o tipo microphone. O arranque é sempre com a app à vista, depois
 *   de um toque em Ligar ou Atender, como o Android 14 exige.
 * - É do tipo câmara também enquanto a câmara está ligada.
 * - A tocar (incoming) não corre: ainda não há microfone, e a app pode estar fechada.
 * - Pára em todos os fins: desligar, a outra pessoa desligar, falhar, sair da conta (o signOut desliga a chamada).
 */
import type { CallState } from './types';

export interface CallServiceWant {
  /** O nome na notificação: «Chamada com <nome>». */
  name: string;
  /** Com a câmara ligada: o serviço também é do tipo camera. */
  video: boolean;
}

/** O que o módulo nativo sabe fazer (no iPhone e na web não existe). */
export interface CallServiceNative {
  start(name: string, video: boolean): boolean | void;
  stop(): void;
}

const LIVE = new Set<CallState['phase']>(['outgoing', 'connecting', 'active']);

/** Com este estado da chamada, o serviço deve correr? E como? */
export function callServiceWant(s: Pick<CallState, 'phase' | 'peer' | 'camOn' | 'local'>): CallServiceWant | null {
  if (!LIVE.has(s.phase) || !s.local) return null;
  const name = s.peer?.displayName?.trim() || (s.peer?.username ? `@${s.peer.username}` : 'Txillapp');
  return { name, video: !!s.camOn };
}

/**
 * Liga o estado da chamada ao serviço: chama start/stop só quando muda alguma coisa (arrancar, trocar de tipo ao
 * ligar ou desligar a câmara, parar). `dispose()` pára o que estiver a correr (ao sair da conta ou ao desmontar).
 */
export function createCallServiceSync(native: CallServiceNative) {
  let cur: CallServiceWant | null = null;
  const stop = () => {
    if (!cur) return;
    cur = null;
    try { native.stop(); } catch { /* o serviço já não existe */ }
  };
  return {
    sync(s: Pick<CallState, 'phase' | 'peer' | 'camOn' | 'local'>) {
      const want = callServiceWant(s);
      if (!want) return stop();
      if (cur && cur.name === want.name && cur.video === want.video) return;
      cur = want;
      try { native.start(want.name, want.video); } catch { /* sem o módulo (APK antigo): a chamada segue sem serviço */ }
    },
    dispose: stop,
    /** Para os testes e para o ecrã: o que está a correr agora. */
    current: () => cur,
  };
}
