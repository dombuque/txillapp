import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { Group, Line } from '@/components/Lines';
import { StackPage } from '@/components/StackPage';
import { colors } from '@/lib/theme';

/**
 * Idioma e traduções. A app ainda só existe em português (o site tem pt-MZ e en, com as frases em apps/web/src/lib/i18n):
 * mostra a lista como no site, com o português escolhido e o inglês "em breve" até a app ter o mesmo sistema de idiomas.
 */
export default function Language() {
  return (
    <StackPage title="Idioma e traduções">
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <Group title="Idioma da app">
          <Pressable accessibilityRole="radio" accessibilityState={{ checked: true }} style={st.row}>
            <Text style={st.label}>Português (Moçambique)</Text>
            <View style={[st.radio, { borderColor: colors.brand, backgroundColor: colors.brand }]}><Icon name="check" size={14} strokeWidth={3} color="#fff" /></View>
          </Pressable>
          <Line icon="globe" label="English" value="em breve na app" />
        </Group>
        <Group title="Traduções">
          <Line icon="globe" label="Traduzir publicações" value="Em breve: ver posts e comentários noutro idioma com um toque" />
        </Group>
        <Text style={st.foot}>O Txillapp está em português e em inglês. Vamos acrescentando idiomas e a tradução de publicações.</Text>
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
