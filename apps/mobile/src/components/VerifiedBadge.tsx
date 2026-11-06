import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

const SEAL =
  'M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91c-1.31.67-2.2 1.91-2.2 3.34s.89 2.67 2.2 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34z';

/** Selo de perfil verificado: azul (pessoa ou negócio) ou coral (conta oficial do Txillapp). */
export function VerifiedBadge({ size = 16, tier = 'verified' }: { size?: number; tier?: 'verified' | 'official' | null }) {
  const official = tier === 'official';
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityLabel={official ? 'Conta oficial do Txillapp' : 'Perfil verificado'}>
      {official && (
        <Defs>
          <LinearGradient id="off" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#ff6b81" />
            <Stop offset="1" stopColor="#d6334f" />
          </LinearGradient>
        </Defs>
      )}
      <Path fill={official ? 'url(#off)' : '#1d9bf0'} d={SEAL} />
      <Path fill="none" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" d="m8 12.4 2.8 2.8L16.4 9.4" />
    </Svg>
  );
}
