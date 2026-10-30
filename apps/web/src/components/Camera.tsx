import Icon from './Icon';
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';

const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const icon = { width: 26, height: 26, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

interface CameraProps {
  /** Quantas fotos a publicação já tem e o máximo, para o contador e para travar o obturador. */
  count: number;
  max: number;
  onShot: (file: File) => void;
  onGallery: (files: File[]) => void;
  onClose: () => void;
}

type Problem = null | 'denied' | 'unsupported' | 'failed';

/**
 * Câmara do Txillapp: o ecrã de captura é nosso (não o da câmara do telemóvel).
 * A galeria está dentro da câmara, como no Instagram. Precisa de HTTPS ou localhost (regra dos browsers).
 */
export default function Camera({ count, max, onShot, onGallery, onClose }: CameraProps) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);
  const [flash, setFlash] = useState(false);
  const [canFlip, setCanFlip] = useState(false);
  const full = count >= max;

  const stop = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };

  const start = useCallback(async (mode: 'environment' | 'user') => {
    stop();
    setReady(false);
    setProblem(null);
    if (!navigator.mediaDevices?.getUserMedia) return setProblem('unsupported');
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: mode }, width: { ideal: 1920 }, height: { ideal: 1920 } },
        audio: false,
      });
      stream.current = s;
      if (video.current) {
        video.current.srcObject = s;
        await video.current.play().catch(() => undefined);
      }
      setReady(true);
      const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      setCanFlip(devices.filter((d) => d.kind === 'videoinput').length > 1);
    } catch (e) {
      setProblem((e as DOMException).name === 'NotAllowedError' ? 'denied' : 'failed');
    }
  }, []);

  useEffect(() => {
    void start(facing);
    return stop;
  }, [facing, start]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  function shoot() {
    const v = video.current;
    if (!v || !ready || full || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0);
    c.toBlob(
      (blob) => {
        if (blob) onShot(new File([blob], `txill-${Date.now()}.jpg`, { type: 'image/jpeg' }));
      },
      'image/jpeg',
      0.9,
    );
    setFlash(true);
    setTimeout(() => setFlash(false), 140);
    navigator.vibrate?.(15);
  }

  function gallery(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length) onGallery(files);
  }

  const round = 'flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-md transition active:scale-90';
  const galleryInput = (
    <input type="file" multiple accept={TYPES.join(',')} onChange={gallery} className="sr-only" aria-label="Escolher fotos da galeria" />
  );

  return (
    <div role="dialog" aria-modal="true" aria-label="Câmara" className="fixed inset-0 z-[80] flex flex-col bg-black text-white">
      <video
        ref={video}
        playsInline
        muted
        className={`absolute inset-0 h-full w-full object-cover ${facing === 'user' ? '-scale-x-100' : ''} ${ready ? '' : 'invisible'}`}
      />
      {flash && <div className="pointer-events-none absolute inset-0 bg-white" />}

      <div className="relative z-10 flex items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <button type="button" onClick={onClose} aria-label="Fechar câmara" className={round}>
          <Icon name="x" size={26} />
        </button>
        {canFlip && ready && (
          <button type="button" onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))} aria-label="Virar câmara" className={round}>
            <Icon name="flip-camera" size={26} />
          </button>
        )}
      </div>

      {!ready && (
        <div className="relative z-10 m-auto max-w-xs px-6 text-center">
          {problem === null ? (
            <p className="text-white/80">A acordar a câmara…</p>
          ) : (
            <>
              <Icon name="alert" size={48} className="mx-auto text-white/70" />
              <p className="mt-3 text-lg font-bold">
                {problem === 'denied' ? 'Sem permissão para a câmara' : problem === 'unsupported' ? 'A câmara precisa de ligação segura' : 'Não consegui abrir a câmara'}
              </p>
              <p className="mt-1 text-sm text-white/70">
                {problem === 'denied' ? 'Ativa a câmara nas definições do browser, ou escolhe fotos da galeria.' : 'Podes sempre escolher fotos da galeria.'}
              </p>
              <label className="mt-5 inline-flex h-12 cursor-pointer items-center rounded-full bg-brand px-6 font-bold">
                Abrir galeria
                {galleryInput}
              </label>
            </>
          )}
        </div>
      )}
      {ready && <div className="flex-1" />}

      <div className="relative z-10 flex items-center justify-between px-6 pb-[max(1.75rem,env(safe-area-inset-bottom))] pt-6">
        <label className={`${round} h-14 w-14 cursor-pointer rounded-2xl`} title="Galeria" aria-label="Galeria">
          <Icon name="image" size={26} />
          {galleryInput}
        </label>

        <button
          type="button"
          onClick={shoot}
          disabled={!ready || full}
          aria-label="Tirar foto"
          className="flex h-[78px] w-[78px] items-center justify-center rounded-full border-[5px] border-white transition active:scale-90 disabled:opacity-40"
        >
          <span className="h-[58px] w-[58px] rounded-full bg-white" />
        </button>

        {count > 0 ? (
          <button type="button" onClick={onClose} className="flex h-12 min-w-[92px] items-center justify-center gap-1.5 rounded-full bg-brand px-4 font-bold shadow-lg active:scale-95">
            Feito <span className="rounded-full bg-white/25 px-2 text-sm">{count}</span>
          </button>
        ) : (
          <span className="w-[92px]" aria-hidden />
        )}
      </div>
      {full && <p role="status" className="absolute inset-x-0 bottom-32 text-center text-sm font-semibold">Máximo de {max} fotos</p>}
    </div>
  );
}
