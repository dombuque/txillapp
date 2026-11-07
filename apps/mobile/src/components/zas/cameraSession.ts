/**
 * A câmara fica ligada por pouco tempo depois de sair do ecrã (mudar de modo, filtros, voltar atrás), para a app não
 * pedir permissão outra vez a cada passo. Desliga-se sozinha ao fim de IDLE_MS, ou logo que a app vai para segundo plano.
 * O microfone só é pedido (uma vez) quando se entra no modo Reel.
 */
const IDLE_MS = 30_000;

let cur: { stream: MediaStream; facing: 'environment' | 'user'; portrait: boolean } | null = null;
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

/** Retrato 3:4 inteiro: se o aparelho abriu noutro formato (a imagem fica cortada na moldura), insiste até ele mudar. */
async function fixPortrait(s: MediaStream) {
  const t = s.getVideoTracks()[0];
  if (!t) return;
  for (let i = 0; i < 4; i++) {
    const st = t.getSettings?.();
    if (st?.width && st?.height && Math.abs(Math.min(st.width, st.height) / Math.max(st.width, st.height) - 0.75) < 0.04) return;
    try {
      await t.applyConstraints({ width: { ideal: 1080 }, height: { ideal: 1440 }, aspectRatio: { ideal: 3 / 4 } });
    } catch {
      /* o aparelho não aceita: fica como está */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** Devolve a câmara pedida, reaproveitando a que já está ligada (sem novo pedido de permissão). */
let pending: Promise<unknown> | null = null;
export async function acquireCamera(facing: 'environment' | 'user', audio: boolean, portrait = false): Promise<MediaStream> {
  // Um pedido de cada vez: dois toques rápidos em "virar" abriam duas câmaras e uma ficava ligada para sempre.
  while (pending) { try { await pending; } catch { /* o outro pedido falhou: segue */ } }
  if (timer) clearTimeout(timer);
  timer = null;
  if (cur && (cur.facing !== facing || cur.portrait !== portrait)) stopCameraNow();
  if (cur && !alive(cur.stream)) cur = null;
  if (!cur) {
    const req = navigator.mediaDevices.getUserMedia({
      // Retrato 3:4 (Zás): é o formato inteiro do sensor, sem cortar o campo de visão (por isso não parece "ampliado").
      video: portrait
        ? { facingMode: { ideal: facing }, width: { ideal: 1080 }, height: { ideal: 1440 }, aspectRatio: { ideal: 3 / 4 } }
        : { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1920 } },
      audio: false,
    });
    pending = req;
    let stream: MediaStream;
    try { stream = await req; } finally { pending = null; }
    const already = cur as { stream: MediaStream } | null;
    if (already && alive(already.stream)) { stream.getTracks().forEach((t) => t.stop()); }
    else cur = { stream, facing, portrait };
  }
  const cam = cur as { stream: MediaStream } | null;
  if (!cam) throw new Error('Não consegui abrir a câmara');
  // Sem microfone nesta vez (foto, story, Zás): larga já o que ficou ligado do Reel, para o iPhone não mostrar "a gravar".
  if (!audio) {
    cam.stream.getAudioTracks().forEach((t) => {
      t.stop();
      cam.stream.removeTrack(t);
    });
  }
  // Microfone: pedido à parte e uma só vez; se recusarem, grava-se sem som.
  if (audio && cam.stream.getAudioTracks().length === 0) {
    try {
      const a = await navigator.mediaDevices.getUserMedia({ audio: true });
      a.getAudioTracks().forEach((t) => cam.stream.addTrack(t));
    } catch {
      /* sem microfone */
    }
  }
  if (portrait) await fixPortrait(cam.stream);
  return cam.stream;
}
