import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';
import { SITE_URL } from '@/lib/config';
import { colors } from '@/lib/theme';

/** Foto de perfil (ou as iniciais, se a pessoa não tem). */
export function Avatar({ username, name, size = 40 }: { username: string; name: string; size?: number }) {
  return (
    <View style={[styles.box, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.initial, { fontSize: size * 0.42 }]}>{(name || username).slice(0, 1).toUpperCase()}</Text>
      <Image
        source={{ uri: `${SITE_URL}/api/v1/avatars/${encodeURIComponent(username)}` }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        transition={150}
        accessibilityIgnoresInvertColors
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: colors.soft, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  initial: { color: colors.muted, fontWeight: '700' },
});
