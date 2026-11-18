import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { appealText, canAppeal } from '@/lib/photoAppeal';
import { appealPublish, dropPublish, retryPublish, usePublishTasks } from '@/lib/publishQueue';
import { colors } from '@/lib/theme';
import { Icon } from './Icon';
import { t } from '@/lib/i18n';

/** Faixa no topo do Início com as publicações a serem enviadas em segundo plano. */
export function PublishBanner() {
  const tasks = usePublishTasks();
  const qc = useQueryClient();
  if (!tasks.length) return null;
  return (
    <View style={{ gap: 8, marginHorizontal: 16, marginBottom: 10 }}>
      {tasks.map((publishTask) => (
        <View key={publishTask.id} style={st.row} role="status" accessibilityLiveRegion="polite">
          <View style={st.thumb}>
            {publishTask.thumb ? <Image source={{ uri: publishTask.thumb }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Icon name={publishTask.video ? 'video' : 'file-text'} size={20} color={colors.zinc600} />}
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
            <Text style={st.text} numberOfLines={publishTask.status === 'error' ? 4 : 1}>
              {publishTask.status === 'error' && publishTask.appeal && appealText(publishTask.appeal.state) ? appealText(publishTask.appeal.state) : publishTask.status === 'done' ? (publishTask.kind === 'mimo' ? t('Mimo publicado!') : publishTask.kind === 'zas' ? t('Zás enviado!') : t('Publicado!')) : publishTask.status === 'error' ? (publishTask.error ?? t('Não consegui publicar')) : publishTask.retrying && publishTask.status === 'uploading' ? t('Sem ligação ao servidor. A tentar outra vez…') : publishTask.stage === 'prepare' ? t('A preparar o vídeo…') : publishTask.stage === 'post' ? (publishTask.kind === 'mimo' ? t('A publicar o mimo…') : publishTask.kind === 'zas' ? t('A enviar o Zás…') : t('A publicar…')) : `${publishTask.kind === 'mimo' ? t('A enviar o mimo') : publishTask.kind === 'zas' ? t('A enviar o Zás') : t('A enviar')}… ${Math.round(publishTask.progress * 100)}%`}
            </Text>
            {publishTask.status === 'uploading' && (
              publishTask.stage === 'prepare'
                ? <Working />
                : <View style={st.track}><View style={[st.fill, { width: `${Math.max(4, Math.round(publishTask.progress * 100))}%` }]} /></View>
            )}
            {publishTask.status === 'error' && (
              <View style={{ flexDirection: 'row', gap: 14, flexWrap: 'wrap' }}>
                {/* Foto recusada pela verificação automática: tentar outra vez dava o mesmo; pede-se a revisão. */}
                {publishTask.appeal ? (
                  canAppeal(publishTask.appeal.state) && <Pressable onPress={() => void appealPublish(publishTask.id, qc)} accessibilityRole="button"><Text style={st.link}>{t('Pedir revisão')}</Text></Pressable>
                ) : (
                  <Pressable onPress={() => retryPublish(publishTask.id, qc)} accessibilityRole="button"><Text style={st.link}>{t('Tentar outra vez')}</Text></Pressable>
                )}
                {/* Com o rascunho guardado no servidor, fechar a faixa não cancela nada: o servidor publica quando a foto for aprovada. */}
                <Pressable onPress={() => dropPublish(publishTask.id)} accessibilityRole="button"><Text style={[st.link, { color: colors.zinc600 }]}>{publishTask.appeal && (publishTask.appeal.state === 'held' || publishTask.appeal.state === 'published') ? t('Fechar') : t('Descartar')}</Text></Pressable>
              </View>
            )}
          </View>
          {publishTask.status === 'done' && <Icon name="check-circle" size={22} color="#16a34a" />}
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
