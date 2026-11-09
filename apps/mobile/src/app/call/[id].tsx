import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Pressable, Text, View } from 'react-native';
import { expandCall, getCall, openIncomingCall, useCall } from '@/lib/calls';

/**
 * /call/[id]: abre uma chamada a entrar por endereço (por exemplo a partir da notificação).
 * Parâmetros opcionais: from (username, é o que a notificação manda), name, avatar=1|0, video=1|0. O ecrã da chamada em si é o CallOverlay (no layout raiz),
 * que fica por cima; esta página só o acorda e, quando a chamada acaba, volta para trás.
 */
export default function CallRoute() {
  const { id = '', from, username: u, name, avatar, video } = useLocalSearchParams<{ id: string; from?: string; username?: string; name?: string; avatar?: string; video?: string }>();
  const username = from || u;
  const router = useRouter();
  const c = useCall();
  const seen = useRef(false);

  useEffect(() => {
    const cur = getCall();
    if (cur.callId === id && cur.phase !== 'idle') expandCall();
    else if (username) openIncomingCall({ callId: id, from: { username, displayName: name || username, hasAvatar: avatar !== '0' }, video: video === '1' });
  }, [id, username, name, avatar, video]);

  const live = c.callId === id && c.phase !== 'idle';
  if (live) seen.current = true;
  const leave = () => (router.canGoBack() ? router.back() : router.replace('/messages' as never));
  useEffect(() => {
    if (seen.current && !live) leave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  return (
    <View style={{ flex: 1, backgroundColor: '#0b0b0c', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      {!live ? (
        <>
          <Text style={{ color: '#fff', fontSize: 20, fontWeight: '700', textAlign: 'center' }}>Esta chamada já acabou</Text>
          <Pressable onPress={leave} style={{ marginTop: 16 }} accessibilityRole="button"><Text style={{ color: '#fff', fontSize: 16, fontWeight: '600', textDecorationLine: 'underline' }}>Voltar</Text></Pressable>
        </>
      ) : null}
    </View>
  );
}
