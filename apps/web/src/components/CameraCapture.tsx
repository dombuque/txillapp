import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { tr } from '../lib/i18n';
import Icon from './Icon';

/**
 * Tira uma foto na hora com a câmara (sem galeria): usada na verificação para ler a cara e para a selfie ao lado do documento.
 * Pede a câmara da frente; se o aparelho não deixar, avisa em vez de aceitar uma foto antiga.
 */
export default function CameraCapture({ title, hint, facing = 'user', onTake, onClose }: { title: string; hint: string; facing?: 'user' | 'environment'; onTake: (f: File) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [err, setErr] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let off = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('no-camera');
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false });
        if (off) return s.getTracks().forEach((t) => t.stop());
        stream.current = s;
        if (video.current) {
          video.current.srcObject = s;
          await video.current.play().catch(() => undefined);
          setReady(true);
        }
      } catch {
        setErr(tr('Não consegui abrir a câmara. Dá permissão à câmara nas definições do navegador.'));
      }
    })();
    return () => {
      off = true;
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, [facing]);

  function snap() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    const side = Math.min(1280, Math.max(v.videoWidth, v.videoHeight));
    const scale = side / Math.max(v.videoWidth, v.videoHeight);
    c.width = Math.round(v.videoWidth * scale);
    c.height = Math.round(v.videoHeight * scale);
    const ctx = c.getContext('2d')!;
    if (facing === 'user') {
      ctx.translate(c.width, 0);
      ctx.scale(-1, 1); // a selfie sai como no espelho
    }
    ctx.drawImage(v, 0, 0, c.width, c.height);
    c.toBlob((b) => {
      if (!b) return;
      stream.current?.getTracks().forEach((t) => t.stop());
      onTake(new File([b], `${facing === 'user' ? 'selfie' : 'foto'}.jpg`, { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.9);
  }

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[120] flex flex-col bg-black text-white">
      <div className="flex items-center gap-3 px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button type="button" onClick={onClose} aria-label={tr('Cancelar')} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 active:scale-90"><Icon name="x" size={22} /></button>
        <div className="min-w-0">
          <p className="truncate font-bold">{title}</p>
          <p className="text-sm text-white/75">{hint}</p>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        {err ? (
          <p role="alert" className="mx-auto mt-24 max-w-xs px-6 text-center text-white/90">{err}</p>
        ) : (
          <>
            <video ref={video} playsInline muted className={`absolute inset-0 h-full w-full object-cover ${facing === 'user' ? '-scale-x-100' : ''}`} />
            {facing === 'user' && <div className="pointer-events-none absolute left-1/2 top-1/2 h-[62%] w-[62%] max-w-[360px] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border-4 border-white/80" aria-hidden />}
          </>
        )}
      </div>
      <div className="flex justify-center pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
        <button type="button" onClick={snap} disabled={!ready} aria-label={tr('Tirar foto')} className="h-[72px] w-[72px] rounded-full border-4 border-white bg-white/30 transition active:scale-90 disabled:opacity-40" />
      </div>
    </div>,
    document.body,
  );
}
