import { createElement, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { CAMERA_EVERY_MS, cameraPass } from '@/lib/qrDecode';
import { browserKind, classifyCameraError, permissionSteps, type CamProblem } from '@/lib/webCamera';
import { detectNative, drawPass, loadJsQr, makeCanvas, qrEngine, readJsQr } from '@/lib/qrWeb';
import { QrCameraNote } from './QrCameraNote';
import { t } from '@/lib/i18n';

export interface QrCameraProps {
  /** Parado (a mostrar o que se leu): a câmara fica, mas não lê. */
  paused: boolean;
  onRead: (data: string) => void;
  /** A câmara está a dar imagem (a moldura só varre quando está). */
  onLive?: (live: boolean) => void;
}

type Phase = 'checking' | 'idle' | 'starting' | 'live' | CamProblem;

const NOTES: Record<CamProblem, { title: string; sub: string }> = {
  denied: { get title() { return t('Sem acesso à câmara'); }, get sub() { return t('O browser não deixou usar a câmara. Podes ligá-la assim, ou escolher a imagem do QR:'); } },
  busy: { get title() { return t('A câmara está ocupada'); }, get sub() { return t('Outra app ou separador está a usá-la. Fecha-o e tenta outra vez, ou escolhe a imagem do QR.'); } },
  nocamera: { get title() { return t('Não encontrei câmara'); }, get sub() { return t('Este aparelho não tem câmara. Escolhe a imagem do QR (ou cola-a aqui).'); } },
  insecure: { get title() { return t('A câmara precisa de ligação segura'); }, sub: 'Abre o Txillapp em https://txillapp.com para usar a câmara, ou escolhe a imagem do QR.' },
  constraint: { get title() { return t('Não consegui abrir a câmara'); }, get sub() { return t('Tenta outra vez, ou escolhe a imagem do QR.'); } },
  failed: { get title() { return t('Não consegui abrir a câmara'); }, get sub() { return t('Tenta outra vez, ou escolhe a imagem do QR.'); } },
};

const browserNow = () =>
  browserKind(
    navigator.userAgent,
    (typeof matchMedia !== 'undefined' && matchMedia('(display-mode: standalone)').matches) || (navigator as { standalone?: boolean }).standalone === true,
    navigator.maxTouchPoints > 1,
  );

/**
 * A câmara do leitor de QR no site: getUserMedia (a de trás) e, a cada ~140 ms, o quadrado do meio vai ao
 * BarcodeDetector (Chrome no Android) ou ao jsqr (Safari do iPhone e os outros). Com a licença já dada, liga sozinha;
 * senão espera por um toque (o pedido do browser só aparece quando a pessoa quer). No telemóvel é QrCamera.tsx.
 */
export function QrCamera({ paused, onRead, onLive }: QrCameraProps) {
  const [phase, setPhase] = useState<Phase>('checking');
  const [steps, setSteps] = useState<string[]>([]);
  const video = useRef<HTMLVideoElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const cb = useRef({ paused, onRead });
  useEffect(() => {
    cb.current = { paused, onRead };
  });
  useEffect(() => {
    onLive?.(phase === 'live');
  }, [phase, onLive]);

  function stop() {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }

  async function start() {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setPhase(typeof window !== 'undefined' && window.isSecureContext === false ? 'insecure' : 'nocamera');
      return;
    }
    setPhase('starting');
    const tries: MediaTrackConstraints[] = [
      { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      { facingMode: { ideal: 'environment' } },
    ];
    let lastErr: unknown = null;
    for (const v of tries) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: v, audio: false });
        stop();
        stream.current = s;
        const el = video.current;
        if (el) {
          el.muted = true;
          el.srcObject = s;
          await el.play().catch(() => undefined);
        }
        setPhase('live');
        return;
      } catch (e) {
        lastErr = e;
        const p = classifyCameraError(e as { name?: string }, window.isSecureContext !== false);
        if (p === 'denied' || p === 'insecure' || p === 'nocamera') break;
      }
    }
    const p = classifyCameraError(lastErr as { name?: string }, window.isSecureContext !== false);
    if (p === 'denied') setSteps(permissionSteps(browserNow()));
    setPhase(p);
  }

  // Ao entrar: com a licença já dada, liga logo; senão espera pelo toque.
  useEffect(() => {
    let alive = true;
    void (async () => {
      let granted = false;
      try {
        const st = await navigator.permissions?.query({ name: 'camera' as PermissionName });
        granted = st?.state === 'granted';
      } catch {
        granted = false;
      }
      if (!alive) return;
      if (granted) void start();
      else setPhase('idle');
    })();
    const onHide = () => {
      if (document.visibilityState === 'hidden') {
        stop();
        setPhase((p) => (p === 'live' ? 'idle' : p));
      }
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onHide);
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A leitura, enquanto a câmara está ligada.
  useEffect(() => {
    if (phase !== 'live') return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame = 0;
    let lastHit: { data: string; at: number } | null = null;
    const c = makeCanvas();
    const tick = async () => {
      if (!alive) return;
      const el = video.current;
      if (el && !cb.current.paused && el.readyState >= 2 && el.videoWidth > 0) {
        frame++;
        let hit: string | null = null;
        try {
          const engine = await qrEngine();
          if (engine === 'native') hit = await detectNative(el);
          else if (c) {
            const pass = cameraPass(el.videoWidth, el.videoHeight);
            if (pass) {
              drawPass(c, el, pass);
              // De três em três imagens tenta-se também com as cores trocadas (QR claro num ecrã escuro).
              hit = readJsQr(await loadJsQr(), c, frame % 3 === 0);
            }
          }
        } catch {
          hit = null;
        }
        const now = Date.now();
        if (alive && hit && !cb.current.paused && !(lastHit && lastHit.data === hit && now - lastHit.at < 2000)) {
          lastHit = { data: hit, at: now };
          cb.current.onRead(hit);
        }
      }
      if (alive) timer = setTimeout(() => void tick(), CAMERA_EVERY_MS);
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [phase]);

  const note =
    phase === 'checking' || phase === 'starting' ? (
      <QrCameraNote title={t('A abrir a câmara…')} busy />
    ) : phase === 'idle' ? (
      <QrCameraNote title={t('Ler com a câmara')} sub={t('Aponta a câmara ao QR de outro telemóvel ou de um papel.')} action={t('Ligar a câmara')} onAction={() => void start()} />
    ) : phase !== 'live' ? (
      <QrCameraNote title={NOTES[phase].title} sub={NOTES[phase].sub} steps={phase === 'denied' ? steps : undefined} action={phase === 'nocamera' || phase === 'insecure' ? undefined : t('Tentar outra vez')} onAction={() => void start()} />
    ) : null;

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#111114' }]}>
      {createElement('video', {
        ref: video,
        playsInline: true,
        muted: true,
        autoPlay: true,
        'aria-label': t('Imagem da câmara'),
        style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: phase === 'live' ? 'block' : 'none' },
      })}
      {note}
    </View>
  );
}
