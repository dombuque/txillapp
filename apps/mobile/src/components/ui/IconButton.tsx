import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type AccessibilityState, type GestureResponderEvent, type StyleProp, type ViewStyle } from 'react-native';
import { colors, dark as D, disabledOpacity, minTouch } from '@/lib/theme';
import { Icon, type IconName } from '../Icon';

/**
 * - `light` (por omissão): ícone escuro, sem fundo (cabeçalhos, linhas, folhas claras);
 * - `soft`: círculo zinc100 por trás do ícone;
 * - `dark`: ícone claro, sem fundo (folhas escuras, ecrãs pretos);
 * - `glass`: círculo de vidro escuro por cima de foto ou vídeo, ícone branco.
 */
export type IconButtonVariant = 'light' | 'soft' | 'dark' | 'glass';

export type IconButtonProps = {
  /** Ícone Tx; para um desenho próprio usa `children`. */
  icon?: IconName;
  children?: ReactNode;
  /** Obrigatório: é o que o leitor de ecrã diz (e a dica no computador). */
  label: string;
  onPress?: (e: GestureResponderEvent) => void;
  onLongPress?: () => void;
  variant?: IconButtonVariant;
  /** Tamanho da caixa (44 por omissão). Mais pequena que 44 ganha `hitSlop` até aos 44. */
  size?: number;
  /** Tamanho do ícone (22 por omissão). */
  iconSize?: number;
  /** Cor do ícone (por omissão a da variante). */
  color?: string;
  solid?: boolean;
  strokeWidth?: number;
  disabled?: boolean;
  /** Ponto vermelho (`true`) ou um número no canto. */
  badge?: boolean | number;
  accessibilityState?: AccessibilityState;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const fgOf = (v: IconButtonVariant) => (v === 'dark' || v === 'glass' ? '#ffffff' : colors.zinc900);
const bgOf = (v: IconButtonVariant) => (v === 'soft' ? colors.zinc100 : v === 'glass' ? D.glass : 'transparent');
const pressOf = (v: IconButtonVariant) => (v === 'dark' ? 'rgba(255,255,255,0.12)' : v === 'glass' ? 'rgba(0,0,0,0.55)' : v === 'soft' ? colors.zinc200 : colors.zinc100);

/** Botão só com ícone: área de toque de 44 no mínimo, `label` obrigatório e o papel de botão já posto. */
export function IconButton({ icon, children, label, onPress, onLongPress, variant = 'light', size = minTouch, iconSize = 22, color, solid, strokeWidth, disabled, badge, accessibilityState, style, testID }: IconButtonProps) {
  const slop = Math.max(0, Math.ceil((minTouch - size) / 2));
  const fg = color ?? fgOf(variant);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      hitSlop={slop || undefined}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, ...accessibilityState }}
      testID={testID}
      {...({ dataSet: { tip: label } } as object)}
      style={(s) => [
        st.box,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: bgOf(variant) },
        (s.pressed || (s as { hovered?: boolean }).hovered) && !disabled && { backgroundColor: pressOf(variant) },
        disabled && { opacity: disabledOpacity },
        style,
      ]}
    >
      {children ?? (icon ? <Icon name={icon} size={iconSize} color={fg} solid={solid} strokeWidth={strokeWidth} /> : null)}
      {badge ? (
        <View style={[st.badge, typeof badge === 'number' ? st.count : st.dot]} pointerEvents="none">
          {typeof badge === 'number' ? <Text style={st.countText}>{badge > 99 ? '99+' : badge}</Text> : null}
        </View>
      ) : null}
    </Pressable>
  );
}

const st = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', backgroundColor: colors.brand, borderWidth: 2, borderColor: '#fff' },
  dot: { top: 6, right: 6, width: 12, height: 12, borderRadius: 6 },
  count: { top: 2, right: 0, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  countText: { color: '#fff', fontSize: 11, fontWeight: '800' },
});
