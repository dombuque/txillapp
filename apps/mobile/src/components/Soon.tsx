import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@/lib/theme';

/** Ecrã que ainda está a ser passado para a app nativa. */
export function Soon({ title, text }: { title: string; text: string }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.wrap, { paddingTop: insets.top }]}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white, paddingHorizontal: 36, gap: 8 },
  title: { fontSize: 22, fontWeight: '800', color: colors.ink },
  text: { fontSize: 15, color: colors.muted, textAlign: 'center' },
});
