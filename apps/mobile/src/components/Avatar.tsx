import { Image } from 'expo-image';
import { useSyncExternalStore } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SITE_URL } from '@/lib/config';
import { colors } from '@/lib/theme';

let version = 0;
const listeners = new Set<() => void>();
/** Depois de mudar a foto: todas as fotos voltam a ser pedidas ao servidor. */
export function bumpAvatars() {
  version += 1;
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** Foto de perfil, ou as iniciais (até 2 letras) sobre fundo rosa, como no site. */
export function Avatar({ username, name, size = 40 }: { username?: string; name: string; size?: number }) {
  const v = useSyncExternalStore(subscribe, () => version, () => version);
  const initials = name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <View style={[styles.box, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.initials, { fontSize: Math.max(11, size * 0.3) }]}>{initials}</Text>
      {username ? (
        <Image source={{ uri: `${SITE_URL}/api/v1/avatars/${encodeURIComponent(username)}${v ? `?v=${v}` : ''}` }} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} accessibilityIgnoresInvertColors />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: colors.rose50, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  initials: { color: colors.brand, fontWeight: '700' },
});
