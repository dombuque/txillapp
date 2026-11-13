import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { appealText, canAppeal } from '@/lib/photoAppeal';
import { appealPublish, dropPublish, retryPublish, usePublishTasks } from '@/lib/publishQueue';
import { colors } from '@/lib/theme';
import { Icon } from './Icon';

/** Faixa no topo do Início com as publicações a serem enviadas em segundo plano. */
export function PublishBanner() {
  const tasks = usePublishTasks();
  const qc = useQueryClient();
  if (!tasks.length) return null;
  return (
    <View style={{ gap: 8, marginHorizontal: 16, marginBottom: 10 }}>
      {tasks.map((t) => (
        <View key={t.id} style={st.row} role="status" accessibilityLiveRegion="polite">
          <View style={st.thumb}>
            {t.thumb ? <Image source={{ uri: t.thumb }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Icon name={t.video ? 'video' : 'file-text'} size={20} color={colors.zinc600} />}
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
            <Text style={st.text} numberOfLines={t.status === 'error' ? 4 : 1}>
              {t.status === 'error' && t.appeal && appealText(t.appeal.state) ? appealText(t.appeal.state) : t.status === 'done' ? (t.kind === 'mimo' ? 'Mimo publicado!' : t.kind === 'zas' ? 'Zás enviado!' : 'Publicado!') : t.status === 'error' ? (t.error ?? 'Não consegui publicar') : t.stage === 'prepare' ? 'A preparar o vídeo…' : t.stage === 'post' ? (t.kind === 'mimo' ? 'A publicar o mimo…' : t.kind === 'zas' ? 'A enviar o Zás…' : 'A publicar…') : `${t.kind === 'mimo' ? 'A enviar o mimo' : t.kind === 'zas' ? 'A enviar o Zás' : 'A enviar'}… ${Math.round(t.progress * 100)}%`}
            </Text>
            {t.status === 'uploading' && (
              t.stage === 'prepare'
                ? <Working />
                : <View style={st.track}><View style={[st.fill, { width: `${Math.max(4, Math.round(t.progress * 100))}%` }]} /></View>
            )}
            {t.status === 'error' && (
              <View style={{ flexDirection: 'row', gap: 14, flexWrap: 'wrap' }}>
                {/* Foto recusada pela verificação automática: tentar outra vez dava o mesmo; pede-se a revisão. */}
                {t.appeal ? (
                  canAppeal(t.appeal.state) && <Pressable onPress={() => void appealPublish(t.id, qc)} accessibilityRole="button"><Text style={st.link}>Pedir revisão</Text></Pressable>
                ) : (
                  <Pressable onPress={() => retryPublish(t.id, qc)} accessibilityRole="button"><Text style={st.link}>Tentar outra vez</Text></Pressable>
                )}
                {/* Com o rascunho guardado no servidor, fechar a faixa não cancela nada: o servidor publica quando a foto for aprovada. */}
                <Pressable onPress={() => dropPublish(t.id)} accessibilityRole="button"><Text style={[st.link, { color: colors.zinc600 }]}>{t.appeal && (t.appeal.state === 'held' || t.appeal.state === 'published') ? 'Fechar' : 'Descartar'}</Text></Pressable>
              </View>
            )}
          </View>
          {t.status === 'done' && <Icon name="check-circle" size={22} color="#16a34a" />}
        </View>
      ))}
    </View>
  );
}

/** Barra sem fim (o servidor está a converter o vídeo e não diz quanto falta): um traço que vai e volta. */
function Working() {
  const x = useRef(new Animated.Value(0)).current;
  const [w, setW] = useState(0);
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(x, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(x, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [x]);
  const seg = Math.max(24, w * 0.3);
  return (
    <View style={st.track} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      <Animated.View style={[st.fill, { width: seg, transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [0, Math.max(0, w - seg)] }) }] }]} />
    </View>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, backgroundColor: colors.zinc100, paddingHorizontal: 12, paddingVertical: 10 },
  thumb: { width: 44, height: 44, borderRadius: 10, overflow: 'hidden', backgroundColor: colors.zinc200, alignItems: 'center', justifyContent: 'center' },
  text: { fontSize: 14, fontWeight: '600', color: colors.zinc800 },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.zinc200, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2, backgroundColor: colors.brand },
  link: { fontSize: 13, fontWeight: '700', color: colors.brand },
});
