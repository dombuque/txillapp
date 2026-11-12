import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Image } from 'expo-image';
import { useEffect } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChatVideoPlayer } from '@/components/ChatBubbles';
import { Icon } from '@/components/Icon';
import { onceView, type OnceContent } from '@/lib/onceView';

/**
 * "Ver uma vez" aberta (o servidor já a deu por vista): foto, vídeo, voz ou texto em ecrã inteiro, como no site
 * (apps/web/src/components/OnceViewer). Fecha no X, no botão de voltar do Android ou a tocar fora do conteúdo.
 * Antes mostrava tudo como imagem: o vídeo e a voz ficavam num ecrã preto.
 */
export function OnceViewer({ content, onClose }: { content: OnceContent; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const v = onceView(content);
  return (
    <Modal visible transparent={false} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={[st.root, { paddingTop: Math.max(insets.top, 12), paddingBottom: Math.max(insets.bottom, 16) }]} accessibilityViewIsModal>
        <View style={st.top}>
          <Pressable onPress={onClose} style={st.x} accessibilityRole="button" accessibilityLabel="Fechar"><Icon name="x" size={24} color="#fff" /></Pressable>
          <View style={st.badge}><Icon name="once" size={16} color="#fff" /><Text style={st.badgeText}>Só podes ver uma vez</Text></View>
          <View style={{ width: 44 }} />
        </View>
        {/* Tocar à volta do conteúdo fecha (o vídeo e a voz têm os seus botões). */}
        <Pressable onPress={onClose} style={st.mid} accessibilityLabel="Fechar">
          {v === 'image' ? <Image source={{ uri: content.url! }} style={st.fill} contentFit="contain" accessibilityLabel="Foto de ver uma vez" />
            : v === 'video' ? <Pressable onPress={() => undefined} style={st.fill}><ChatVideoPlayer url={content.url!} autoPlay inModal /></Pressable>
            : v === 'voice' ? <Pressable onPress={() => undefined}><OnceVoice url={content.url!} /></Pressable>
            : <Text style={st.text}>{content.body}</Text>}
        </Pressable>
        <Text style={st.hint}>Ao fechar, esta mensagem desaparece para sempre.</Text>
      </View>
    </Modal>
  );
}

/** A voz de ver uma vez: começa a tocar sozinha; tocar no botão pausa ou continua. */
function OnceVoice({ url }: { url: string }) {
  const player = useAudioPlayer(url);
  const status = useAudioPlayerStatus(player);
  useEffect(() => {
    try { player.play(); } catch { /* sem áudio */ }
    return () => { try { player.pause(); } catch { /* já libertado */ } };
  }, [player]);
  const toggle = () => {
    try {
      if (status.playing) player.pause();
      else {
        if (status.duration && status.currentTime >= status.duration - 0.2) void player.seekTo(0);
        player.play();
      }
    } catch { /* sem áudio */ }
  };
  const left = Math.max(0, Math.round((status.duration || 0) - (status.currentTime || 0)));
  return (
    <View style={st.voice}>
      <Icon name="mic" size={36} color="#fff" />
      <Pressable onPress={toggle} style={st.play} accessibilityRole="button" accessibilityLabel={status.playing ? 'Pausar' : 'Ouvir'}>
        <Icon name={status.playing ? 'pause' : 'play'} size={26} solid color="#18181b" />
      </Pressable>
      <Text style={st.voiceTime}>{status.duration ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : ' '}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12 },
  x: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 12, paddingVertical: 6 },
  badgeText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  mid: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, paddingVertical: 16 },
  fill: { width: '100%', height: '100%' },
  text: { maxWidth: 380, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 24, paddingVertical: 20, textAlign: 'center', color: '#fff', fontSize: 22, lineHeight: 29, fontWeight: '600', overflow: 'hidden' },
  voice: { width: 280, alignItems: 'center', gap: 16, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.1)', padding: 24 },
  play: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  voiceTime: { color: 'rgba(255,255,255,0.85)', fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  hint: { paddingHorizontal: 24, paddingTop: 12, textAlign: 'center', color: 'rgba(255,255,255,0.7)', fontSize: 14 },
});
