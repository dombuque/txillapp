import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, dark as D, typo } from '@/lib/theme';
import { BackButton } from './BackButton';
import { FillView } from './FillView';

/**
 * Página própria em ecrã inteiro: seta de voltar e título no topo (igual à do site), sem a barra de baixo.
 * Título 20/800 à esquerda; `center` centra-o (só em visores escuros de ecrã inteiro). `dark`: fundo preto, letras claras.
 * `right`: ações à direita (com IconButton).
 */
export function StackPage({ title, children, right, dark = false, center = false }: { title: string; children: ReactNode; right?: ReactNode; dark?: boolean; center?: boolean }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const bg = dark ? '#000' : colors.white;
  return (
    <View style={{ flex: 1, backgroundColor: bg, paddingTop: insets.top }}>
      <View style={[styles.header, { backgroundColor: bg }, dark && { borderBottomColor: D.line }]}>
        <BackButton onPress={back} color={dark ? D.text : colors.zinc900} />
        <Text style={[styles.title, center && styles.center, dark && { color: D.text }]} numberOfLines={1} accessibilityRole="header">{title}</Text>
        {right ?? (center ? <View style={styles.spacer} /> : null)}
      </View>
      <FillView>{children}</FillView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 4, borderBottomWidth: 1, borderBottomColor: colors.zinc100, backgroundColor: colors.white, paddingHorizontal: 8, paddingVertical: 8 },
  title: { flex: 1, ...typo.title, color: colors.zinc900 },
  center: { textAlign: 'center' },
  /** Do tamanho do «voltar», para o título centrado ficar mesmo ao centro. */
  spacer: { width: 48, height: 48 },
});
