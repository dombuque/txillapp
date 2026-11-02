import type { SVGProps } from 'react';
import { TX, type TxDef, type TxName } from '../icons/tx';
import CheersIcon from './CheersIcon';

/**
 * Os ícones do Txillapp ("Tx"): desenhados por nós, todos na mesma grelha 24×24 e no mesmo traço, com o pequeno corte do sino.
 * Para usar: `<Icon name="home" />`. Para um ícone novo, desenha-o em `apps/web/scripts/make-txicons.py` e corre o script.
 * `solid` pinta a versão cheia (separador ativo), quando o ícone a tem.
 */
export type IconName = TxName;

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'ref'> {
  name: IconName;
  size?: number | string;
  strokeWidth?: number | string;
  solid?: boolean;
}

export default function Icon({ name, size = 22, strokeWidth = 1.8, solid = false, ...rest }: IconProps) {
  // As canecas do Brindar têm desenho próprio (duas peças espelhadas).
  if (name === 'cheers') return <CheersIcon size={size} strokeWidth={strokeWidth} aria-hidden {...rest} />;
  const d = TX[name] as TxDef;
  const filled = solid && !!d.s;
  const paths = filled ? d.s! : d.p;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={d.w ?? strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      {paths.map((p, i) => (
        <path key={i} d={p} fill={d.f ? 'currentColor' : undefined} />
      ))}
    </svg>
  );
}
