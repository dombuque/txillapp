import type { SVGProps } from 'react';

/**
 * Mensagens do Txillapp: o avião de papel, desenhado à medida (cantos suaves e a linha da dobra com um pequeno corte
 * antes da ponta, como o do sino). 24×24, mesmo traço dos outros ícones. `filled` pinta o avião (separador ativo).
 */
export default function PlaneIcon({ size = 24, strokeWidth = 1.9, filled = false, ...rest }: { size?: number | string; strokeWidth?: number | string; filled?: boolean } & Omit<SVGProps<SVGSVGElement>, 'ref'>) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...rest}>
      <path d="M20.9 3.1 3.4 9.7c-.9.35-.88 1.6.02 1.92l6.9 2.45 2.55 6.95c.34.9 1.6.9 1.93.02L20.9 3.1Z" fill={filled ? 'currentColor' : 'none'} />
      <path d="M11.6 12.4 19.3 4.7" stroke={filled ? '#fff' : 'currentColor'} />
    </svg>
  );
}
