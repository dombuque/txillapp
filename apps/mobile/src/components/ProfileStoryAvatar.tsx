import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { api } from '@/lib/api';
import { SITE_URL } from '@/lib/config';
import { useOwnSeen } from '@/lib/ownSeen';
import { seenSegments } from '@/lib/ownStorySeen';
import { Avatar } from './Avatar';
import { Ring } from './StoryRing';

/**
 * Foto do perfil com story: anel a cores/cinzento/verde e, ao tocar, abre o story (o servidor só devolve se eu puder ver).
 * Toque longo: foto em grande (toca para fechar). Como no site.
 */
export function ProfileStoryAvatar({ username, displayName, isMe, hasAvatar, size = 96 }: { username: string; displayName: string; isMe: boolean; hasAvatar: boolean; size?: number }) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [show, setShow] = useState(false);
  const held = useRef(false);
  const ownSeenAt = useOwnSeen(isMe ? username : null);
  const q = useQuery({ queryKey: ['stories', username], queryFn: () => api.storiesOf(username), retry: false });
  const list = q.data ?? [];
  const avatarName = displayName || username;

  const longPress = hasAvatar ? () => { held.current = true; setShow(true); } : undefined;
  const big = Math.min(width * 0.8, 420);
  const preview = (
    <Modal transparent visible={show} animationType="fade" onRequestClose={() => setShow(false)} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={() => setShow(false)} accessibilityRole="button" accessibilityLabel={`Foto de ${avatarName}`}>
        <Image
          source={{ uri: `${SITE_URL}/api/v1/avatars/${encodeURIComponent(username)}` }}
          style={{ width: big, height: big, borderRadius: big / 2, borderWidth: 4, borderColor: '#fff' }}
          contentFit="cover"
          accessibilityIgnoresInvertColors
        />
      </Pressable>
    </Modal>
  );

  if (list.length === 0) {
    return (
      <>
        <Pressable onLongPress={longPress} delayLongPress={400} disabled={!hasAvatar} accessibilityLabel={`Foto de ${avatarName}`}>
          <Avatar name={avatarName} username={hasAvatar ? username : undefined} size={size} />
        </Pressable>
        {preview}
      </>
    );
  }

  const seenCount = seenSegments(list, isMe, ownSeenAt);
  const green = list.every((x) => x.audience === 'close_friends');
  const box = size + 12;
  return (
    <>
      <Pressable
        onPress={() => { if (held.current) { held.current = false; return; } router.push(`/stories/${username}` as never); }}
        onLongPress={longPress}
        delayLongPress={400}
        accessibilityRole="button"
        accessibilityLabel={`Ver mimo de ${avatarName}`}
        style={{ width: box, height: box }}
      >
        {/* O anel mede 72px; amplia-se para acompanhar a foto grande do perfil. */}
        <View style={{ position: 'absolute', left: (box - 72) / 2, top: (box - 72) / 2, width: 72, height: 72, transform: [{ scale: box / 72 }] }}>
          <Ring count={list.length} seenCount={seenCount} green={green}>
            <Avatar name={avatarName} username={hasAvatar ? username : undefined} size={56} />
          </Ring>
        </View>
      </Pressable>
      {preview}
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.8)', padding: 24 },
});
