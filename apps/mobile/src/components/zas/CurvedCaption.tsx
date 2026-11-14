import { useEffect, useId, useMemo, useState } from 'react';
import { View } from 'react-native';
import Svg, { Defs, Path, Text as SvgText, TextPath, TSpan } from 'react-native-svg';
import { textFontStyle } from '@/lib/textFonts';
import { DEFAULT_TEXT_FONT, normTextFont } from '@/lib/textLayers';
import { useTextFonts } from '@/lib/useTextFonts';
import { arcPoints } from './squircle';

/**
 * Legenda dos Zás: o texto corre pela curva do cartão (em maiúsculas, com letras espaçadas), como nos Instants do Instagram.
 * O cartão tem de ter `w` x `h` conhecidos (px). `hint`: legenda de ajuda a esmorecer; `caret`: cursor a piscar.
 * `font`: a letra escolhida (`captionFont`, lib/textLayers); a clássica (ou nenhuma) é a de sempre, em negrito.
 */
export function CurvedCaption({ w, h, text, hint = false, caret = false, caretFirst = false, arc = 'top', font = null }: { w: number; h: number; text: string; hint?: boolean; caret?: boolean; caretFirst?: boolean; arc?: 'top' | 'bottom'; font?: string | null }) {
  const fid = normTextFont(font);
  useTextFonts([fid === DEFAULT_TEXT_FONT ? null : fid]);
  const pid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const [blink, setBlink] = useState(true);
  useEffect(() => {
    if (!caret) return;
    const t = setInterval(() => setBlink((b) => !b), 500);
    return () => clearInterval(t);
  }, [caret]);
  const { d, len } = useMemo(() => {
    if (!w || !h) return { d: '', len: 0 };
    const pts = arcPoints(w, h, arc);
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    return { d: pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' '), len };
  }, [w, h, arc]);
  if (!d) return null;
  const label = text.toUpperCase();
  const chars = Math.max(1, label.length + (caret ? 1 : 0));
  // O mesmo tamanho e espaçamento em todas as letras (como a cópia gravada pelo servidor, instants/zas-caption.ts).
  const fs = Math.max(8, Math.min(Math.min(w, h) * 0.052, (len - 14) / (chars * 0.8)));
  // Letra própria: só a família (e, na web, o peso e o estilo do ficheiro); no Android um peso a mais inventava negrito.
  const own = fid === DEFAULT_TEXT_FONT ? null : textFontStyle(fid);
  const cursor = <TSpan fill="#3b82f6" fillOpacity={blink ? 1 : 0}>|</TSpan>;
  const body = (
    <TextPath href={`#${pid}`}>
      {caretFirst && caret ? cursor : ''}
      {label}
      {!caretFirst && caret ? cursor : ''}
    </TextPath>
  );
  const common = own
    ? { fontSize: fs, fontFamily: own.fontFamily, ...(own.fontWeight ? { fontWeight: own.fontWeight as '700' } : null), ...(own.fontStyle ? { fontStyle: own.fontStyle } : null), letterSpacing: fs * 0.16 }
    : { fontSize: fs, fontWeight: '700' as const, letterSpacing: fs * 0.16 };
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: w, height: h, zIndex: 4 }}>
      <Svg width={w} height={h} style={{ overflow: 'visible' }}>
        <Defs><Path id={pid} d={d} /></Defs>
        {/* Contorno por baixo e preenchimento por cima (o paint-order não existe no nativo). */}
        <SvgText {...common} fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth={2.4} strokeLinejoin="round">{body}</SvgText>
        <SvgText {...common} fill="#fff" fillOpacity={hint ? 0.72 : 1}>{body}</SvgText>
      </Svg>
    </View>
  );
}
