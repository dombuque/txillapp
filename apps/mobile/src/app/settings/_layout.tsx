import { Slot, Stack } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SettingsHome } from '@/components/settings/SettingsHome';
import { SettingsPaneContext } from '@/components/settings/SettingsPage';
import { useDesktop } from '@/lib/desktop';
import { colors } from '@/lib/theme';

/**
 * Definições. No telemóvel, ecrãs empilhados (o início e cada grupo por cima, com "voltar").
 * No computador, duas colunas: a lista dos grupos sempre à esquerda e o grupo aberto à direita.
 */
export default function SettingsLayout() {
  const desktop = useDesktop();
  if (!desktop) return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.white } }} />;
  return (
    <View style={st.row}>
      <View style={st.left} role="navigation" accessibilityLabel="Definições">
        <ScrollView contentContainerStyle={{ paddingTop: 12, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
          <SettingsHome pane />
        </ScrollView>
      </View>
      <View style={st.right}>
        <SettingsPaneContext.Provider value>
          <Slot />
        </SettingsPaneContext.Provider>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row', backgroundColor: colors.white },
  left: { width: 360, borderRightWidth: 1, borderRightColor: colors.zinc100 },
  right: { flex: 1, minWidth: 0 },
});
