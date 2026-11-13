import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { abs } from '@/lib/config';
import type { ComposeProblem, RunState } from '@/lib/studio/composeJob';
import { limitBuffer } from '@/lib/videoMemory';

const CORAL = '#d6334f';

/** O vídeo montado no servidor, a tocar em ciclo (o que se vai publicar). */
function Result({ mediaId, onPublish, onEdit, note, topInset, bottomInset }: { mediaId: string; onPublish: () => void; onEdit: () => void; note: string | null; topInset: number; bottomInset: number }) {
  const player = useVideoPlayer({ uri: abs(`/api/v1/media/${mediaId}`) ?? '' }, (p) => { p.loop = true; limitBuffer(p, 'full'); p.play(); });
  useEffect(() => () => { try { player.pause(); } catch { /* já libertado */ } }, [player]);
  return (
    <View style={[StyleSheet.absoluteFill, st.root, { paddingTop: topInset + 8, paddingBottom: bottomInset + 12 }]}>
      <Text style={st.title}>A tua tcheka está pronta</Text>
      <View style={st.videoBox}>
        <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />
      </View>
      {note ? <Text style={st.note}>{note}</Text> : null}
      <View style={st.row}>
        <Pressable onPress={onEdit} style={[st.btn, st.ghost]} accessibilityRole="button"><Text style={st.btnText}>Voltar a editar</Text></Pressable>
        <Pressable onPress={onPublish} style={[st.btn, st.primary]} accessibilityRole="button"><Text style={st.btnText}>Seguinte</Text></Pressable>
      </View>
    </View>
  );
}

/**
 * «Seguinte» no telemóvel: por cima do estúdio (que fica bloqueado), o progresso real (os envios e depois a montagem no
 * servidor, com a fase), «Parar» com confirmação, os erros em frases claras e, no fim, o vídeo montado para publicar.
 */
export function NativeComposeOverlay({ run, problem, result, note, onCancel, onRetry, onDismiss, onPublish, onEdit, topInset, bottomInset }: {
  run: RunState | null;
  problem: ComposeProblem | null;
  result: { mediaId: string } | null;
  note: string | null;
  onCancel: () => void;
  onRetry: () => void;
  onDismiss: () => void;
  onPublish: () => void;
  onEdit: () => void;
  topInset: number;
  bottomInset: number;
}) {
  if (result) return <Result mediaId={result.mediaId} onPublish={onPublish} onEdit={onEdit} note={note} topInset={topInset} bottomInset={bottomInset} />;
  if (problem) {
    return (
      <View style={[StyleSheet.absoluteFill, st.dim]} accessibilityViewIsModal>
        <View style={st.card}>
          <Text style={st.cardTitle}>{problem.kind === 'corrigir' ? 'Falta uma coisa' : problem.kind === 'ocupado' ? 'Uma de cada vez' : 'Não deu para montar'}</Text>
          <Text style={st.cardText} accessibilityRole="alert">{problem.message}</Text>
          <View style={st.row}>
            <Pressable onPress={onDismiss} style={[st.btn, st.ghost]} accessibilityRole="button"><Text style={st.btnText}>{problem.kind === 'corrigir' ? 'Corrigir' : 'Fechar'}</Text></Pressable>
            {problem.kind === 'rede' || problem.kind === 'servidor' || problem.kind === 'ocupado' ? (
              <Pressable onPress={onRetry} style={[st.btn, st.primary]} accessibilityRole="button"><Text style={st.btnText}>Tentar outra vez</Text></Pressable>
            ) : null}
          </View>
        </View>
      </View>
    );
  }
  if (!run) return null;
  const pct = Math.round(run.progress * 100);
  return (
    <View style={[StyleSheet.absoluteFill, st.dim]} accessibilityViewIsModal>
      <View style={st.card}>
        <ActivityIndicator color="#fff" />
        <Text style={st.cardTitle} accessibilityLiveRegion="polite">{run.title}</Text>
        <View style={st.track}><View style={[st.fill, { width: `${Math.max(2, pct)}%` }]} /></View>
        <Text style={st.pct}>{pct}%</Text>
        <Text style={st.cardText}>{run.detail}</Text>
        <Pressable onPress={onCancel} style={[st.btn, st.ghost, { alignSelf: 'center', marginTop: 6 }]} accessibilityRole="button" accessibilityLabel="Parar a montagem"><Text style={st.btnText}>Parar</Text></Pressable>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  root: { backgroundColor: '#000', zIndex: 80, paddingHorizontal: 16, gap: 12 },
  title: { color: '#fff', fontSize: 18, fontWeight: '800', textAlign: 'center' },
  videoBox: { flex: 1, borderRadius: 16, overflow: 'hidden', backgroundColor: '#111' },
  note: { color: 'rgba(255,255,255,0.7)', fontSize: 14, textAlign: 'center' },
  dim: { backgroundColor: 'rgba(0,0,0,0.72)', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 80 },
  card: { width: '100%', maxWidth: 420, borderRadius: 22, backgroundColor: '#15151c', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', padding: 20, gap: 10 },
  cardTitle: { color: '#fff', fontSize: 18, fontWeight: '800', textAlign: 'center' },
  cardText: { color: 'rgba(255,255,255,0.78)', fontSize: 15, textAlign: 'center' },
  track: { height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.14)', overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: CORAL },
  pct: { color: '#fff', fontSize: 14, fontWeight: '800', textAlign: 'center', fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', gap: 10, justifyContent: 'center' },
  btn: { minHeight: 48, flex: 1, maxWidth: 200, borderRadius: 24, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  primary: { backgroundColor: CORAL },
  ghost: { backgroundColor: 'rgba(255,255,255,0.14)' },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
