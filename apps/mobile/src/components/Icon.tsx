import { Platform } from 'react-native';
import Svg, { G, Path } from 'react-native-svg';
import { TX, type TxDef } from '@/icons/tx';
import { colors } from '@/lib/theme';

export type IconName = keyof typeof TX | 'cheers';

/** Os ícones "Tx" do Txillapp (os mesmos do site, na mesma grelha 24×24 e no mesmo traço). `solid` pinta a versão cheia. */
export function Icon({ name, size = 22, strokeWidth = 1.8, solid = false, color = colors.zinc900 }: { name: IconName; size?: number; strokeWidth?: number; solid?: boolean; color?: string }) {
  if (name === 'cheers') return <Cheers size={size} strokeWidth={strokeWidth} color={color} />;
  // "Voltar": o chevron que as apps usam no iPhone e no site; no Android a seta do sistema (igual ao BackButton).
  const d = TX[name === 'back' && Platform.OS !== 'android' ? 'chevron-left' : name] as TxDef;
  const filled = solid && !!d.s;
  const paths = filled ? d.s! : d.p;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? color : 'none'} stroke={color} strokeWidth={d.w ?? strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {paths.map((p, i) => (
        <Path key={i} d={p} fill={d.f || filled ? color : 'none'} />
      ))}
    </Svg>
  );
}

/** Duas canecas de cerveja a brindar (o "Brindar" do Txillapp). */
function Cheers({ size, strokeWidth, color }: { size: number; strokeWidth: number; color: string }) {
  const mug = (
    <>
      <Path d="M4.5 10.5h6.2v8.2a1.6 1.6 0 0 1-1.6 1.6H6.1a1.6 1.6 0 0 1-1.6-1.6z" />
      <Path d="M4.5 12.4H3.4a1.4 1.4 0 0 0-1.4 1.4v1.9a1.4 1.4 0 0 0 1.4 1.4h1.1" />
      <Path d="M4.2 10.5c-.9-.3-1.2-1.2-.9-1.9.3-.8 1.2-1.1 1.9-.8.3-.7 1-1.1 1.8-1 .8.1 1.4.6 1.5 1.3.8-.2 1.5.2 1.7 1 .2.7-.1 1.4-.8 1.6" />
    </>
  );
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <G transform="rotate(12 7.6 20)">{mug}</G>
      <G transform="translate(24 0) scale(-1 1) rotate(12 7.6 20)">{mug}</G>
      <Path d="M12 2.2v1.6M9.4 3.1l.8 1.2M14.6 3.1l-.8 1.2" />
    </Svg>
  );
}
