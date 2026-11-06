import { StyleSheet, Text, View } from 'react-native';
import { colors } from '@/lib/theme';
import { BookmarkIcon } from './BookmarkIcon';
import { Icon, type IconName } from './Icon';

/** Estado vazio / erro: ícone claro, título e frase curta. */
export function Empty({ icon, title, text }: { icon: IconName | 'bookmark'; title: string; text?: string }) {
  return (
    <View style={st.box}>
      {icon === 'bookmark' ? <BookmarkIcon on={false} size={44} color={colors.zinc300} /> : <Icon name={icon} size={44} color={colors.zinc300} />}
      <Text style={st.title}>{title}</Text>
      {text ? <Text style={st.text}>{text}</Text> : null}
    </View>
  );
}
const st = StyleSheet.create({
  box: { marginHorizontal: 32, marginTop: 56, alignItems: 'center' },
  title: { marginTop: 12, fontSize: 20, fontWeight: '700', color: colors.zinc900, textAlign: 'center' },
  text: { marginTop: 4, color: colors.zinc600, textAlign: 'center', fontSize: 16 },
});
