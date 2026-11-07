import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { dropPublish, retryPublish, usePublishTasks } from '@/lib/publishQueue';
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
        <View key={t.id} style={st.row} accessibilityRole="status" accessibilityLiveRegion="polite">
          <View style={st.thumb}>
            {t.thumb ? <Image source={{ uri: t.thumb }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Icon name={t.video ? 'video' : 'file-text'} size={20} color={colors.zinc600} />}
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
            <Text style={st.text} numberOfLines={1}>
              {t.status === 'done' ? 'Publicado!' : t.status === 'error' ? (t.error ?? 'Não consegui publicar') : t.progress >= 1 ? 'A publicar…' : `A enviar… ${Math.round(t.progress * 100)}%`}
            </Text>
            {t.status === 'uploading' && (
              <View style={st.track}><View style={[st.fill, { width: `${Math.max(4, Math.round(t.progress * 100))}%` }]} /></View>
            )}
            {t.status === 'error' && (
              <View style={{ flexDirection: 'row', gap: 14 }}>
                <Pressable onPress={() => retryPublish(t.id, qc)} accessibilityRole="button"><Text style={st.link}>Tentar outra vez</Text></Pressable>
                <Pressable onPress={() => dropPublish(t.id)} accessibilityRole="button"><Text style={[st.link, { color: colors.zinc600 }]}>Descartar</Text></Pressable>
              </View>
            )}
          </View>
          {t.status === 'done' && <Icon name="check-circle" size={22} color="#16a34a" />}
        </View>
      ))}
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
