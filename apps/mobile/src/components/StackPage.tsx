import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@/lib/theme';
import { BackButton } from './BackButton';

/** Página própria em ecrã inteiro: seta de voltar e título no topo (igual à do site), sem a barra de baixo. */
export function StackPage({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));
  return (
    <View style={{ flex: 1, backgroundColor: colors.white, paddingTop: insets.top }}>
      <View style={styles.header}>
        <BackButton onPress={back} />
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        {right}
      </View>
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 4, borderBottomWidth: 1, borderBottomColor: colors.zinc100, backgroundColor: colors.white, paddingHorizontal: 8, paddingVertical: 8 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  title: { flex: 1, fontSize: 20, fontWeight: '800', color: colors.zinc900 },
});
