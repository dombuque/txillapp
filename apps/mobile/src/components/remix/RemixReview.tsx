import { useVideoPlayer, VideoView } from 'expo-video';
import { useRef, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { clampSticker, type RemixPerson } from '@/lib/remix';
import { colors } from '@/lib/theme';
import { limitBuffer } from '@/lib/videoMemory';
import { Icon } from '../Icon';
import { CommentSticker } from './RemixParts';

/** O autocolante do comentário, que se arrasta por cima do vídeo (posição em fração do vídeo, a partir de cima à esquerda). */
export function DraggableSticker({ author, body, pos, onMove, box }: { author: RemixPerson; body: string; pos: { x: number; y: number }; onMove: (p: { x: number; y: number }) => void; box: { w: number; h: number } }) {
  const size = useRef({ w: 0, h: 0 });
  const start = useRef(pos);
  const live = useRef(pos);
  live.current = pos;
  const boxRef = useRef(box);
  boxRef.current = box;
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => { start.current = live.current; },
      onPanResponderMove: (_e, g) => {
        const b = boxRef.current;
        if (!b.w || !b.h) return;
        onMove(clampSticker(start.current.x + g.dx / b.w, start.current.y + g.dy / b.h, size.current.w / b.w, size.current.h / b.h));
      },
    }),
  ).current;
  return (
    <View
      {...pan.panHandlers}
      onLayout={(e) => { size.current = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height }; }}
      style={{ position: 'absolute', left: pos.x * box.w, top: pos.y * box.h, maxWidth: box.w * 0.62, ...(Platform.OS === 'web' ? ({ cursor: 'grab', touchAction: 'none', userSelect: 'none' } as object) : {}) }}
      accessibilityHint="Arrasta para mudar o autocolante de sítio"
    >
      <CommentSticker author={author} body={body} />
    </View>
  );
}

/**
 * O último passo do dueto e da resposta: o vídeo a tocar (com o autocolante, se houver), a legenda e «Publicar».
 * `overlay` recebe o tamanho do vídeo no ecrã (para o autocolante se arrastar dentro dele).
 */
export function RemixReview({ uri, title, overlay, options, busy, error, onBack, onPublish }: {
  uri: string; title: string; overlay?: (box: { w: number; h: number }) => ReactNode; options?: ReactNode; busy?: boolean; error?: string;
  onBack: () => void; onPublish: (body: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [body, setBody] = useState('');
  const [box, setBox] = useState({ w: 0, h: 0 });
  const player = useVideoPlayer(uri, (p) => { limitBuffer(p, 'full'); p.loop = true; p.play(); });
  // O vídeo 9:16 o maior possível dentro do espaço que sobra (medido: percentagens com aspectRatio falham no browser).
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    const w = Math.max(0, Math.min(width - 32, (height * 9) / 16));
    setBox({ w: Math.round(w), h: Math.round((w * 16) / 9) });
  };
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[st.root, { paddingTop: Math.max(insets.top, 10), paddingBottom: Math.max(insets.bottom, 14) }]}>
      <View style={st.top}>
        <Pressable onPress={onBack} style={st.round} accessibilityRole="button" accessibilityLabel="Voltar"><Icon name="chevron-left" size={24} color="#fff" strokeWidth={2.4} /></Pressable>
        <Text style={st.title} numberOfLines={1}>{title}</Text>
        <View style={{ width: 44 }} />
      </View>
      <View style={st.stage} onLayout={onLayout}>
        <View style={[st.frame, { width: box.w, height: box.h }]}>
          <VideoView player={player} style={[StyleSheet.absoluteFill, { width: '100%', height: '100%' }]} contentFit="cover" nativeControls={false} allowsPictureInPicture={false} />
          {overlay && box.w ? overlay(box) : null}
        </View>
      </View>
      <ScrollView style={{ maxHeight: 220, flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, gap: 10 }} keyboardShouldPersistTaps="handled">
        <TextInput value={body} onChangeText={(t) => setBody(t.slice(0, 2000))} placeholder="Escreve uma legenda… #hashtags e @menções" placeholderTextColor="rgba(255,255,255,0.55)" style={st.input} multiline maxLength={2000} accessibilityLabel="Legenda" />
        {options}
        {error ? <Text style={st.err} accessibilityRole="alert">{error}</Text> : null}
        <Pressable onPress={() => onPublish(body)} disabled={busy} style={[st.cta, busy && { opacity: 0.6 }]} accessibilityRole="button">
          <Text style={st.ctaText}>{busy ? 'A publicar…' : 'Publicar'}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Uma escolha com interruptor, no tema escuro do estúdio. */
export function DarkToggle({ on, onChange, title, sub }: { on: boolean; onChange: (v: boolean) => void; title: string; sub?: string }) {
  return (
    <Pressable onPress={() => onChange(!on)} style={st.toggle} accessibilityRole="switch" accessibilityState={{ checked: on }} accessibilityLabel={title}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={st.toggleTitle}>{title}</Text>
        {sub ? <Text style={st.toggleSub} numberOfLines={2}>{sub}</Text> : null}
      </View>
      <View style={[st.sw, on && { backgroundColor: colors.brand }]}><View style={[st.knob, on && { transform: [{ translateX: 18 }] }]} /></View>
    </Pressable>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 8, gap: 10 },
  round: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, color: '#fff', fontSize: 16, fontWeight: '800', textAlign: 'center' },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, minHeight: 200 },
  frame: { borderRadius: 18, overflow: 'hidden', backgroundColor: '#111' },
  input: { minHeight: 44, maxHeight: 96, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.12)', color: '#fff', paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  err: { color: '#fecaca', fontSize: 13, textAlign: 'center' },
  cta: { height: 48, borderRadius: 24, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 14, paddingVertical: 10 },
  toggleTitle: { color: '#fff', fontSize: 14, fontWeight: '700' },
  toggleSub: { color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 2 },
  sw: { width: 44, height: 26, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.25)', padding: 3 },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' },
});
