import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { PhotoTag } from '../lib/api';

interface Props {
  src: string;
  alt: string;
  tags: PhotoTag[];
  /** Quando existe, tocar na foto devolve a posição (0 a 1) — usado para identificar pessoas. */
  onPoint?: (x: number, y: number) => void;
  /** Quando existe, cada etiqueta mostra um ✕ (modo de edição). */
  onRemove?: (index: number) => void;
  /** Ponto onde se está a identificar alguém (ainda sem pessoa escolhida). */
  pending?: { x: number; y: number } | null;
}

/**
 * Foto inteira (sem cortes) com as etiquetas das pessoas por cima, nas posições certas.
 * Mede o tamanho real da imagem para as etiquetas acompanharem a foto, não o ecrã.
 */
export default function TaggedImage({ src, alt, tags, onPoint, onRemove, pending }: Props) {
  const img = useRef<HTMLImageElement>(null);
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  const measure = useCallback(() => {
    const el = img.current;
    if (el) setBox({ left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight });
  }, []);
  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  function tap(e: React.MouseEvent<HTMLImageElement>) {
    if (!onPoint) return;
    const r = e.currentTarget.getBoundingClientRect();
    onPoint(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)));
  }

  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <img
        ref={img}
        src={src}
        alt={alt}
        onLoad={measure}
        onClick={tap}
        draggable={false}
        className={`max-h-full max-w-full object-contain ${onPoint ? 'cursor-crosshair' : ''}`}
      />
      {box && (
        <div className="pointer-events-none absolute" style={{ left: box.left, top: box.top, width: box.width, height: box.height }}>
          {pending && <span className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-full border-2 border-white bg-brand" style={{ left: `${pending.x * 100}%`, top: `${pending.y * 100}%` }} />}
          {tags.map((t, i) => {
            // Perto das margens a etiqueta alinha para dentro, para não sair do ecrã.
            const shift = t.x < 0.22 ? '0%' : t.x > 0.78 ? '-100%' : '-50%';
            return (
              <span key={`${t.username}-${i}`} className="pointer-events-auto absolute" style={{ left: `${t.x * 100}%`, top: `${t.y * 100}%`, transform: `translate(${shift}, 10px)` }}>
                <span className="absolute -top-[14px] h-2.5 w-2.5 rotate-45 bg-black/80" style={{ left: shift === '0%' ? 6 : shift === '-100%' ? 'calc(100% - 16px)' : 'calc(50% - 5px)' }} aria-hidden />
                <span className="flex items-center gap-1 whitespace-nowrap rounded-lg bg-black/80 px-2.5 py-1 text-sm font-semibold text-white shadow-lg">
                  {onRemove ? (
                    <>
                      {t.displayName}
                      <button type="button" onClick={() => onRemove(i)} aria-label={`Tirar a identificação de ${t.displayName}`} className="-mr-1 flex h-6 w-6 items-center justify-center rounded-full text-white/80 active:bg-white/20">✕</button>
                    </>
                  ) : (
                    <Link to={`/u/${t.username}`} onClick={(e) => e.stopPropagation()}>{t.displayName}</Link>
                  )}
                </span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
