import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Modal } from '@/components/Modal';
import { ZoomableImage } from '@/components/ZoomableImage';
import { api } from '@/lib/api';
import { AVATAR_BIG_W } from '@/lib/avatarSrc';
import { useOwnSeen } from '@/lib/ownSeen';
import { seenSegments } from '@/lib/ownStorySeen';
import { Avatar, avatarUri, useAvatarVersion } from './Avatar';
import { Ring } from './StoryRing';
import { LiveRing } from './txillada/TxilladaParts';
import { useTxilladaEnabled } from '@/lib/api.txillada';
import { t } from '@/lib/i18n';

/**
 * Foto do perfil com story: anel a cores/cinzento/verde e, ao tocar, abre o story (o servidor só devolve se eu puder ver).
 * Toque longo: foto em grande, nítida (1080), com zoom de dois dedos e duplo toque; um toque a 1× fecha. Como no site.
 * Ao vivo (`liveId`, a Txillada a decorrer): a roda coral «AO VIVO» e tocar entra no live.
 */
export function ProfileStoryAvatar({ username, displayName, isMe, hasAvatar, size = 96, liveId, livePrice }: { username: string; displayName: string; isMe: boolean; hasAvatar: boolean; size?: number; liveId?: string | null; /** Uma Txillada privada que ainda não paguei (0167): o cadeado e o preço. */ livePrice?: number | null }) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [show, setShow] = useState(false);
  const held = useRef(false);
  const ownSeenAt = useOwnSeen(isMe ? username : null);
  const q = useQuery({ queryKey: ['stories', username], queryFn: () => api.storiesOf(username), retry: false });
  const list = q.data ?? [];
  const avatarName = displayName || username;
  const avatarV = useAvatarVersion();
  const txilladaOn = useTxilladaEnabled();
  const live = txilladaOn && !isMe ? liveId ?? null : null;

  const longPress = hasAvatar ? () => { held.current = true; setShow(true); } : undefined;
  const big = Math.min(width * 0.8, 420);
  const close = () => setShow(false);
  // A de 1080 (nítida, mesmo ampliada); a pequena (a mesma da bolinha, já na cache) fica por baixo enquanto a grande chega.
  const preview = (
    <Modal transparent visible={show} animationType="fade" onRequestClose={close} statusBarTranslucent>
      <View style={styles.backdrop}>
        {show ? (
          <ZoomableImage
            uri={avatarUri(username, avatarV, AVATAR_BIG_W)}
            placeholderUri={avatarUri(username, avatarV)}
            size={big}
            onClose={close}
            accessibilityLabel={t('Foto de {avatarName}', { avatarName })}
          />
        ) : null}
      </View>
    </Modal>
  );

  const box = size + 12;
  if (live) {
    return (
      <>
        <Pressable
          onPress={() => { if (held.current) { held.current = false; return; } router.push(`/txillada/${live}` as never); }}
          onLongPress={longPress}
          delayLongPress={400}
          accessibilityRole="button"
          accessibilityLabel={t('{avatarName} está ao vivo: ver a Txillada', { avatarName })}
          style={{ width: box, height: box }}
        >
          <View style={{ position: 'absolute', left: (box - 72) / 2, top: (box - 72) / 2, width: 72, height: 72, transform: [{ scale: box / 72 }] }}>
            <LiveRing price={livePrice}><Avatar name={avatarName} username={hasAvatar ? username : undefined} size={56} /></LiveRing>
          </View>
        </Pressable>
        {preview}
      </>
    );
  }

  if (list.length === 0) {
    return (
      <>
        <Pressable onLongPress={longPress} delayLongPress={400} disabled={!hasAvatar} accessibilityLabel={t('Foto de {avatarName}', { avatarName })}>
          <Avatar name={avatarName} username={hasAvatar ? username : undefined} size={size} />
        </Pressable>
        {preview}
      </>
    );
  }

  const seenCount = seenSegments(list, isMe, ownSeenAt);
  const green = list.every((x) => x.audience === 'close_friends');
  return (
    <>
      <Pressable
        onPress={() => { if (held.current) { held.current = false; return; } router.push(`/stories/${username}` as never); }}
        onLongPress={longPress}
        delayLongPress={400}
        accessibilityRole="button"
        accessibilityLabel={t('Ver mimo de {avatarName}', { avatarName })}
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
  // Sem margens: os dedos apanham-se no ecrã todo (o círculo já é no máximo 80% da largura) e, ampliada, a foto enche-o.
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', overflow: 'hidden' },
});
