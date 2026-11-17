import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, dark as D, iconSize, typo, type ButtonKind } from '@/lib/theme';
import { BookmarkIcon } from './BookmarkIcon';
import { Icon, type IconName } from './Icon';
import { Button } from './ui/Button';

export type EmptyAction = { label: string; onPress: () => void; kind?: ButtonKind; icon?: IconName };

export type EmptyStateProps = {
  icon: IconName | 'bookmark';
  title: string;
  text?: string;
  /** Um botão por baixo (ex.: «Procurar pessoas»); `md` e coral por omissão. */
  action?: EmptyAction;
  /** Num ecrã escuro (vídeo, Txillada). */
  dark?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * Estado vazio: ícone claro de 44, título 18/800, frase curta 15 e, se houver, um botão. Margem de cima 48.
 * Todos os vazios da app passam por aqui (os erros por `ErrorState`, que tem o mesmo desenho).
 */
export function EmptyState({ icon, title, text, action, dark = false, style }: EmptyStateProps) {
  const tint = dark ? 'rgba(255,255,255,0.35)' : colors.zinc300;
  return (
    <View style={[st.box, style]}>
      {icon === 'bookmark' ? <BookmarkIcon on={false} size={iconSize.state} color={tint} /> : <Icon name={icon} size={iconSize.state} color={tint} />}
      <Text style={[st.title, dark && { color: D.text }]} accessibilityRole="header">{title}</Text>
      {text ? <Text style={[st.text, dark && { color: D.sub }]}>{text}</Text> : null}
      {action ? <Button label={action.label} onPress={action.onPress} kind={action.kind ?? 'primary'} icon={action.icon} size="md" dark={dark} style={st.action} /> : null}
    </View>
  );
}

/** O nome antigo (mesmas props; agora também aceita `action` e `dark`). */
export const Empty = EmptyState;

const st = StyleSheet.create({
  box: { marginHorizontal: 32, marginTop: 48, alignItems: 'center' },
  title: { marginTop: 12, ...typo.sheetTitle, color: colors.zinc900, textAlign: 'center' },
  text: { marginTop: 6, color: colors.zinc600, textAlign: 'center', fontSize: 15, lineHeight: 21 },
  action: { marginTop: 18 },
});
