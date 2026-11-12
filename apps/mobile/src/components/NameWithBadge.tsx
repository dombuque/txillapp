import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import type { Badged } from '@/lib/api';
import { VerifiedBadge } from './VerifiedBadge';

export type { Badged };

/** O selo tem cerca de 0,9× a altura da letra do nome (nunca menos de 10 px). */
export const badgeSize = (fontSize = 14) => Math.max(10, Math.round(fontSize * 0.9));

/** O selo sozinho, a seguir a um nome que já está noutra linha flex. Nada quando a pessoa não é verificada. */
export function Badge({ who, fontSize, size }: { who?: Badged | null; fontSize?: number; size?: number }) {
  if (!who?.verified) return null;
  return <VerifiedBadge size={size ?? badgeSize(fontSize)} tier={who.verifiedTier ?? 'verified'} />;
}

/**
 * O selo dentro de uma frase que quebra linha (as notificações: «ana e rui brindaram…»). A frase não encolhe com
 * `numberOfLines`, por isso o selo nunca é cortado; desce um pouco para ficar ao meio da letra e não na linha de base.
 */
export function InlineBadge({ who, fontSize = 15 }: { who?: Badged | null; fontSize?: number }) {
  if (!who?.verified) return null;
  const s = badgeSize(fontSize);
  return (
    <View style={{ paddingLeft: 3, width: s + 3, height: s, transform: [{ translateY: Math.round(s * 0.12) }] }}>
      <VerifiedBadge size={s} tier={who.verifiedTier ?? 'verified'} />
    </View>
  );
}

/**
 * Nome (ou @) com o selo de verificado a seguir. O nome encolhe com `numberOfLines`,
 * o selo fica fora do Text que encolhe e nunca é cortado.
 */
export function NameWithBadge({
  name, who, style, numberOfLines = 1, size, center, gap = 3, containerStyle, children, onPress,
}: {
  name: ReactNode;
  who?: Badged | null;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  /** Tamanho do selo; por omissão segue a letra do `style`. */
  size?: number;
  /** Linha centrada (por exemplo, por baixo de um avatar). */
  center?: boolean;
  gap?: number;
  containerStyle?: StyleProp<ViewStyle>;
  /** Mais coisas na mesma linha, depois do selo (hora, etiqueta…). */
  children?: ReactNode;
  onPress?: () => void;
}) {
  const fontSize = StyleSheet.flatten(style)?.fontSize;
  return (
    <View style={[st.row, { gap }, center && st.center, containerStyle]}>
      <Text style={[style, st.name]} numberOfLines={numberOfLines} onPress={onPress}>{name}</Text>
      {who?.verified ? <View style={st.badge}><Badge who={who} fontSize={fontSize} size={size} /></View> : null}
      {children}
    </View>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minWidth: 0 },
  center: { justifyContent: 'center', alignSelf: 'stretch' },
  name: { flexShrink: 1, minWidth: 0 },
  badge: { flexShrink: 0 },
});
