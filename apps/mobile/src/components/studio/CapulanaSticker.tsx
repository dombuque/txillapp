import { useId, useMemo } from 'react';
import Svg, { Defs, Image as SvgImage, Pattern, Polygon } from 'react-native-svg';
import { capulanaDataUri, paletteById, type CapulanaSpec } from '@/lib/studio/capulana';
import { stickerOutline, type CapulanaShapeId } from '@/lib/studio/capulanaShapes';

/**
 * Um sticker de pano em SVG (a mesma forma e as mesmas medidas do `drawCapulanaSticker` do canvas): serve as miniaturas do
 * tabuleiro e o sticker enquanto se arrasta no palco. `size` é o lado da caixa em px.
 */
export function CapulanaSticker({ shape, spec, size = 72 }: { shape: CapulanaShapeId; spec: CapulanaSpec; size?: number }) {
  const id = `pano${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const r = 100;
  const points = useMemo(() => stickerOutline(shape, r).map(([x, y]) => `${x},${y}`).join(' '), [shape]);
  const tile = r * 0.9;
  const uri = useMemo(() => capulanaDataUri(spec, 96), [spec.pattern, spec.palette, spec.seed]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Svg width={size} height={size} viewBox="-125 -125 250 250" accessibilityElementsHidden>
      <Defs>
        <Pattern id={id} patternUnits="userSpaceOnUse" x={-r} y={-r} width={tile} height={tile}>
          <SvgImage href={uri} width={tile} height={tile} preserveAspectRatio="none" />
        </Pattern>
      </Defs>
      <Polygon points={points} fill="rgba(0,0,0,0.3)" stroke="rgba(0,0,0,0.3)" strokeWidth={r * 0.24} strokeLinejoin="round" translateY={r * 0.05} />
      <Polygon points={points} fill="#fff" stroke="#fff" strokeWidth={r * 0.18} strokeLinejoin="round" />
      <Polygon points={points} fill={`url(#${id})`} stroke={paletteById(spec.palette).colors[0]} strokeWidth={r * 0.025} strokeLinejoin="round" />
    </Svg>
  );
}
