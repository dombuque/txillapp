import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { colors, dark as D, disabledOpacity, iconSize } from '@/lib/theme';
import { Icon, type IconName } from '../Icon';

export type ChipProps = {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
  /** `brand`: escolhido fica coral (só para «ligado» em filtros de criação); por omissão escolhido = zinc900. */
  tone?: 'neutral' | 'brand';
  dark?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

/** Chip de escolha: 36 de altura (área de toque de 44), pílula zinc100; escolhido zinc900 com texto branco. */
export function Chip({ label, selected = false, onPress, icon, tone = 'neutral', dark = false, disabled, accessibilityLabel, style }: ChipProps) {
  const onBg = tone === 'brand' ? colors.brand : dark ? '#ffffff' : colors.zinc900;
  const onFg = tone === 'brand' ? '#ffffff' : dark ? colors.zinc900 : '#ffffff';
  const bg = selected ? onBg : dark ? D.raised : colors.zinc100;
  const fg = selected ? onFg : dark ? D.text : colors.zinc800;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected, disabled: !!disabled }}
      style={({ pressed }) => [st.chip, { backgroundColor: bg }, disabled && { opacity: disabledOpacity }, pressed && { opacity: 0.85 }, style]}
    >
      {icon ? <Icon name={icon} size={iconSize.field - 2} color={fg} /> : null}
      <Text style={[st.text, { color: fg }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  chip: { height: 36, borderRadius: 999, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6 },
  text: { fontSize: 14, fontWeight: '600' },
});
