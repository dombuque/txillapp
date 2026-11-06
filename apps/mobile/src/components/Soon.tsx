import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@/lib/theme';
import { BackButton } from './BackButton';

/** Ecrã que ainda está a ser passado para a app nativa. */
export function Soon({ title, text, back = false }: { title: string; text: string; back?: boolean }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <View style={[styles.wrap, { paddingTop: insets.top }]}>
      {back && (
        <BackButton style={{ position: 'absolute', left: 4, top: insets.top + 4 }} />
      )}
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white, paddingHorizontal: 36, gap: 8 },
  back: { position: 'absolute', left: 8, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '800', color: colors.zinc900 },
  text: { fontSize: 18, fontWeight: '300', color: colors.zinc600, textAlign: 'center' },
});
