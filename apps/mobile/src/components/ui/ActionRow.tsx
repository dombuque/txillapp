import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, dark as D, disabledOpacity, iconSize } from '@/lib/theme';
import { Icon, type IconName } from '../Icon';
import { useSheetDark, useSheetMode } from '../Sheet';

export type ActionRowProps = {
  /** Ícone Tx (desenhado a 22) ou um nó próprio (ex.: BookmarkIcon). */
  icon: IconName | ReactNode;
  title: string;
  /** A explicação por baixo (no menu pendente do computador aparece ao passar o rato). */
  text?: string;
  onPress: () => void;
  disabled?: boolean;
  /** Irreversível ou contra alguém (Apagar, Bloquear, Denunciar, Sair, Retirar): ícone e título a vermelho. */
  danger?: boolean;
  /** O que fica à direita (um visto, um interruptor…). */
  right?: ReactNode;
};

/**
 * A linha de um menu de ações (folhas do «⋯», segurar numa bolha…): ícone de 22 num círculo de 40, título 16/600,
 * explicação opcional 13, altura mínima 52. Na folha escura (Sheet `dark`) pinta-se sozinha de claro.
 */
export function ActionRow({ icon, title, text, onPress, disabled, danger, right }: ActionRowProps) {
  // Menu pendente do computador: uma linha compacta (ícone e título; a explicação aparece ao passar o rato).
  const compact = useSheetMode() === 'menu';
  const onDark = useSheetDark();
  const fg = danger ? (onDark ? '#fca5a5' : colors.danger) : onDark ? D.text : colors.zinc900;
  const node = typeof icon === 'string' ? <Icon name={icon as IconName} size={compact ? 20 : iconSize.menu} color={fg} /> : icon;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={(s) => [st.row, compact && st.rowCompact, ((s as { hovered?: boolean }).hovered || s.pressed) && { backgroundColor: onDark ? D.raised : colors.zinc100 }, disabled && { opacity: disabledOpacity }]}
      accessibilityRole={compact ? 'menuitem' : 'button'}
      accessibilityLabel={title}
      accessibilityHint={text}
      accessibilityState={{ disabled: !!disabled }}
      {...(compact && text ? ({ dataSet: { tip: text } } as object) : null)}
    >
      <View style={compact ? st.iconCompact : [st.icon, onDark && { backgroundColor: D.raised }, danger && !onDark && { backgroundColor: colors.dangerSoft }]}>{node}</View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[compact ? st.titleCompact : st.title, { color: fg }]} numberOfLines={compact ? 1 : undefined}>{title}</Text>
        {compact || !text ? null : <Text style={[st.text, onDark && { color: D.sub }]}>{text}</Text>}
      </View>
      {right}
    </Pressable>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 52, borderRadius: 16, paddingHorizontal: 4, paddingVertical: 6 },
  icon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 16, fontWeight: '600', color: colors.zinc900 },
  text: { marginTop: 1, fontSize: 13, color: colors.zinc600 },
  rowCompact: { gap: 12, minHeight: 0, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 9 },
  iconCompact: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  titleCompact: { fontSize: 15, fontWeight: '500', color: colors.zinc900 },
});
