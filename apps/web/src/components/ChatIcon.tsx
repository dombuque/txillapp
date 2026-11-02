import type { SVGProps } from 'react';

/**
 * Mensagens do Txillapp: um balão arredondado com um pequeno avião lá dentro (conversa + enviar).
 * 24×24, contorno arredondado, na cor do texto, no mesmo traço dos outros ícones. `filled` pinta o balão (separador ativo).
 */
export default function ChatIcon({ size = 24, strokeWidth = 1.9, filled = false, ...rest }: { size?: number | string; strokeWidth?: number | string; filled?: boolean } & Omit<SVGProps<SVGSVGElement>, 'ref'>) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...rest}>
      <path d="M12 2.9c-5 0-9 3.55-9 8.1 0 2.35 1.07 4.46 2.8 5.95L4.9 20.9a.5.5 0 0 0 .69.58l3.9-1.7c.77.19 1.6.29 2.5.29 5 0 9-3.55 9-8.1S17 2.9 12 2.9Z" fill={filled ? 'currentColor' : 'none'} />
      <path d="m8.6 12.4 6.9-3-2.5 6.7-1.3-3-3.1-.7Z" stroke={filled ? '#fff' : 'currentColor'} />
    </svg>
  );
}
