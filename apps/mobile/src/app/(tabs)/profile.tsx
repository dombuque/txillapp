import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/theme';

/** Perfil (por agora só o essencial: quem és e sair da conta). */
export default function Profile() {
  const { user, signOut } = useAuth();
  const insets = useSafeAreaInsets();
  if (!user) return null;
  return (
    <View style={[styles.wrap, { paddingTop: insets.top + 40 }]}>
      <Avatar username={user.username} name={user.displayName} size={96} />
      <Text style={styles.name}>{user.displayName}</Text>
      <Text style={styles.handle}>@{user.username}</Text>
      <Pressable onPress={() => void signOut()} style={styles.btn} accessibilityRole="button">
        <Text style={styles.btnText}>Sair da conta</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', backgroundColor: colors.white, paddingHorizontal: 28 },
  name: { fontSize: 24, fontWeight: '800', color: colors.ink, marginTop: 16 },
  handle: { fontSize: 16, color: colors.muted, marginTop: 2 },
  btn: { marginTop: 36, height: 48, paddingHorizontal: 28, borderRadius: 24, backgroundColor: colors.soft, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: 15, fontWeight: '700', color: colors.ink },
});
