import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { Group } from '@/components/Lines';
import { StackPage } from '@/components/StackPage';
import { colors } from '@/lib/theme';

/**
 * O idioma da app (a ligação «Idioma» do rodapé no computador). A app está em português: mostra só o idioma que existe,
 * sem idiomas nem traduções por vir (App Store 2.1/2.2, Google Play).
 */
export default function Language() {
  return (
    <StackPage title="Idioma">
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <Group title="Idioma da app">
          <View accessibilityRole="radio" accessibilityState={{ checked: true }} style={st.row}>
            <Text style={st.label}>Português (Moçambique)</Text>
            <View style={[st.radio, { borderColor: colors.brand, backgroundColor: colors.brand }]}><Icon name="check" size={14} strokeWidth={3} color="#fff" /></View>
          </View>
        </Group>
        <Text style={st.foot}>A app está em português.</Text>
      </ScrollView>
    </StackPage>
  );
}

const st = StyleSheet.create({
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  label: { flex: 1, fontSize: 16, fontWeight: '600', color: colors.zinc900 },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  foot: { marginHorizontal: 24, marginTop: 20, textAlign: 'center', fontSize: 14, color: colors.zinc500 },
});
