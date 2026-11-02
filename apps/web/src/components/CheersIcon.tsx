import type { SVGProps } from 'react';

/**
 * Duas canecas de cerveja a brindar (o "Brindar" do Txillapp), no mesmo traço dos outros ícones:
 * 24×24, contorno arredondado, cor do texto. Cada caneca é a outra espelhada e inclinam-se uma para a outra.
 */
export default function CheersIcon({ size = 24, strokeWidth = 1.75, ...rest }: { size?: number | string; strokeWidth?: number | string } & Omit<SVGProps<SVGSVGElement>, 'ref'>) {
  const mug = (
    <>
      {/* corpo, asa e espuma */}
      <path d="M4.5 10.5h6.2v8.2a1.6 1.6 0 0 1-1.6 1.6H6.1a1.6 1.6 0 0 1-1.6-1.6z" />
      <path d="M4.5 12.4H3.4a1.4 1.4 0 0 0-1.4 1.4v1.9a1.4 1.4 0 0 0 1.4 1.4h1.1" />
      <path d="M4.2 10.5c-.9-.3-1.2-1.2-.9-1.9.3-.8 1.2-1.1 1.9-.8.3-.7 1-1.1 1.8-1 .8.1 1.4.6 1.5 1.3.8-.2 1.5.2 1.7 1 .2.7-.1 1.4-.8 1.6" />
    </>
  );
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...rest}>
      <g transform="rotate(12 7.6 20)">{mug}</g>
      <g transform="translate(24 0) scale(-1 1) rotate(12 7.6 20)">{mug}</g>
      <path d="M12 2.2v1.6M9.4 3.1l.8 1.2M14.6 3.1l-.8 1.2" />
    </svg>
  );
}
