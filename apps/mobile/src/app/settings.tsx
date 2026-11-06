import { useRouter } from 'expo-router';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from '@/components/Icon';
import { StackPage } from '@/components/StackPage';
import { useAuth } from '@/lib/auth';
import { SITE_URL } from '@/lib/config';
import { colors } from '@/lib/theme';

const site = (path: string) => void Linking.openURL(`${SITE_URL || 'https://txillapp.com'}${path}`);

function Row({ icon, label, value, onPress, danger }: { icon: IconName; label: string; value?: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.zinc100 }]} accessibilityRole="button">
      <View style={styles.icon}><Icon name={icon} size={20} color={danger ? colors.red600 : colors.zinc800} /></View>
      <Text style={[styles.label, danger && { color: colors.red600 }]}>{label}</Text>
      {value ? <Text style={styles.value}>{value}</Text> : null}
      {!danger && <Text style={styles.chev}>›</Text>}
    </Pressable>
  );
}

/** Definições: por agora a conta e a saída; o resto abre no site até ser passado para a app. */
export default function Settings() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const out = () =>
    Alert.alert('Sair da conta?', 'Voltas a precisar da senha para entrar.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Sair', style: 'destructive', onPress: () => void signOut().then(() => router.replace('/login')) },
    ]);
  return (
    <StackPage title="Definições">
      <ScrollView>
        <Text style={styles.h}>Conta</Text>
        <Row icon="user-circle" label="Como me chamo" value={user?.displayName} onPress={() => site('/settings')} />
        <Row icon="at" label="Utilizador" value={`@${user?.username ?? ''}`} onPress={() => site('/settings')} />
        <Text style={styles.h}>Mais</Text>
        <Row icon="shield" label="Privacidade e segurança" onPress={() => site('/settings')} />
        <Row icon="bell" label="Notificações" onPress={() => site('/settings')} />
        <Row icon="wallet" label="Carteira de Txills" onPress={() => site('/wallet')} />
        <Row icon="user-plus" label="Convidar a malta" onPress={() => site('/invites')} />
        <Row icon="info" label="Termos, privacidade e ajuda" onPress={() => site('/help')} />
        <View style={{ height: 12 }} />
        <Row icon="logout" label="Sair da conta" onPress={out} danger />
        <View style={{ height: 32 }} />
      </ScrollView>
    </StackPage>
  );
}

const styles = StyleSheet.create({
  h: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 6, fontSize: 13, fontWeight: '700', color: colors.zinc500, textTransform: 'uppercase', letterSpacing: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 56, paddingHorizontal: 20, paddingVertical: 10 },
  icon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  label: { flex: 1, fontSize: 16, fontWeight: '600', color: colors.zinc900 },
  value: { fontSize: 14, color: colors.zinc500, maxWidth: '40%' },
  chev: { fontSize: 22, color: '#a1a1aa' },
});
