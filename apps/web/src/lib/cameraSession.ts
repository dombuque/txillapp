/**
 * A câmara fica ligada por pouco tempo depois de sair do ecrã (mudar de modo, filtros, voltar atrás), para a app não
 * pedir permissão outra vez a cada passo. Desliga-se sozinha ao fim de IDLE_MS, ou logo que a app vai para segundo plano.
 * O microfone só é pedido (uma vez) quando se entra no modo Reel.
 */
const IDLE_MS = 30_000;

let cur: { stream: MediaStream; facing: 'environment' | 'user' } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

const alive = (s: MediaStream) => s.getVideoTracks().some((t) => t.readyState === 'live');

export function stopCameraNow() {
  if (timer) clearTimeout(timer);
  timer = null;
  cur?.stream.getTracks().forEach((t) => t.stop());
  cur = null;
}

/** Larga a câmara: continua ligada mais uns instantes, caso volte a ser precisa. */
export function releaseCamera(delay = IDLE_MS) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(stopCameraNow, delay);
}

if (typeof document !== 'undefined') {
  // Em segundo plano a câmara desliga (privacidade e bateria).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') stopCameraNow();
  });
}

/** Devolve a câmara pedida, reaproveitando a que já está ligada (sem novo pedido de permissão). */
export async function acquireCamera(facing: 'environment' | 'user', audio: boolean): Promise<MediaStream> {
  if (timer) clearTimeout(timer);
  timer = null;
  if (cur && cur.facing !== facing) stopCameraNow();
  if (cur && !alive(cur.stream)) cur = null;
  if (!cur) {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1920 } },
      audio: false,
    });
    cur = { stream, facing };
  }
  // Sem microfone nesta vez (foto, story, Zás): larga já o que ficou ligado do Reel, para o iPhone não mostrar "a gravar".
  if (!audio) {
    cur.stream.getAudioTracks().forEach((t) => {
      t.stop();
      cur?.stream.removeTrack(t);
    });
  }
  // Microfone: pedido à parte e uma só vez; se recusarem, grava-se sem som.
  if (audio && cur.stream.getAudioTracks().length === 0) {
    try {
      const a = await navigator.mediaDevices.getUserMedia({ audio: true });
      a.getAudioTracks().forEach((t) => cur?.stream.addTrack(t));
    } catch {
      /* sem microfone */
    }
  }
  return cur.stream;
}
