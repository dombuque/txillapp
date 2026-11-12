import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ActivityIndicator } from '@/components/PontoLoader';
import { remixApi } from '@/lib/api.remix';
import { enqueuePublish } from '@/lib/publishQueue';
import { STICKER_START } from '@/lib/remix';
import { colors } from '@/lib/theme';
import { Icon } from '../Icon';
import type { Shot } from '../TxCamera';
import { liveCameraSupported } from '../TxCamera';
import { RemixMessage } from './DuetStudio';
import { CommentSticker } from './RemixParts';
import { RemixRecorder } from './RemixRecorder';
import { DraggableSticker, RemixReview } from './RemixReview';

const MAX_MS = 60_500;
const videoMime = (t?: string | null) => (t && ['video/mp4', 'video/quicktime', 'video/webm'].includes(t) ? t : 'video/mp4');

/**
 * «Responder com tcheka» (/tcheka/nova?resposta=<commentId>): grava (ou escolhe da galeria) uma tcheka, com o comentário
 * num autocolante (avatar, @ e texto) que se arrasta para onde se quiser. O autocolante não fica gravado no vídeo: vai com
 * a publicação (a posição) e, por cima da tcheka, leva ao comentário. Funciona no site e no telemóvel.
 */
export function ReplyStudio({ commentId }: { commentId: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const close = useCallback(() => (router.canGoBack() ? router.back() : router.replace('/')), [router]);
  const q = useQuery({ queryKey: ['comment', commentId], queryFn: () => remixApi.comment(commentId), retry: false });
  const [step, setStep] = useState<'choose' | 'record' | 'place'>('choose');
  const [shot, setShot] = useState<Shot | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number }>({ ...STICKER_START });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const onRecorded = useCallback((s: Shot) => { setShot(s); setStep('place'); }, []);
  const c = q.data;

  if (q.isLoading) return <View style={st.loading}><ActivityIndicator color="#fff" /></View>;
  if (!c) return <RemixMessage title="Comentário não encontrado" text="Pode ter sido apagado, ou já não o podes ver." onClose={close} />;
  if (!c.canRemix) return <RemixMessage title="Não dá para responder com tcheka" text="Quem escreveu o comentário, ou o dono da publicação, não deixa responder com tchekas." onClose={close} />;
  const author = { username: c.author.username, displayName: c.author.displayName, hasAvatar: c.author.hasAvatar, verified: c.author.verified, verifiedTier: c.author.verifiedTier };
  const web = Platform.OS === 'web';

  async function pick(source: 'camera' | 'library') {
    setErr('');
    try {
      if (source === 'camera') {
        const p = await ImagePicker.requestCameraPermissionsAsync();
        if (!p.granted) return setErr('Sem permissão para a câmara. Ativa-a nas definições.');
      }
      const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['videos'], videoMaxDuration: 60, quality: 0.85 };
      const r = await (source === 'camera' ? ImagePicker.launchCameraAsync(opts) : ImagePicker.launchImageLibraryAsync(opts));
      if (r.canceled || !r.assets[0]) return;
      const a = r.assets[0];
      if (a.duration && a.duration > MAX_MS) return setErr('A tcheka tem de ter até 60 segundos.');
      setShot({ uri: a.uri, video: true, mime: videoMime(a.mimeType), durationMs: a.duration ?? undefined });
      setStep('place');
    } catch (e) {
      setErr((e as Error).message || 'Não consegui abrir a câmara');
    }
  }

  if (step === 'record') {
    return (
      <RemixRecorder
        original={null}
        title={`Responder a @${author.username}`}
        overlay={<CommentSticker author={author} body={c.body} style={{ position: 'absolute', left: `${pos.x * 100}%`, top: `${pos.y * 100}%`, maxWidth: '62%' }} />}
        onDone={onRecorded}
        onClose={() => setStep('choose')}
      />
    );
  }

  if (step === 'place' && shot) {
    const publish = (body: string) => {
      if (!shot || busy || !c) return;
      setBusy(true);
      enqueuePublish({
        assets: [{ uri: shot.uri, mime: shot.mime, video: true, signed: shot.signed }],
        post: { body, remixOf: { postId: c.postId, kind: 'reply', commentId: c.id, sticker: pos } },
      }, qc);
      router.replace('/');
    };
    return (
      <RemixReview
        uri={shot.uri}
        title={`Responder a @${author.username}`}
        busy={busy}
        error={err}
        onBack={() => { setShot(null); setStep('choose'); }}
        onPublish={publish}
        overlay={(box) => <DraggableSticker author={author} body={c.body} pos={pos} onMove={setPos} box={box} />}
        options={<Text style={st.note}>Arrasta o comentário para onde quiseres. Quem vir a tua tcheka toca nele e vai ao comentário.</Text>}
      />
    );
  }

  return (
    <View style={[st.root, { paddingTop: Math.max(insets.top, 10) + 6, paddingBottom: Math.max(insets.bottom, 16) }]}>
      <View style={st.top}>
        <Pressable onPress={close} style={st.round} accessibilityRole="button" accessibilityLabel="Fechar"><Icon name="x" size={24} color="#fff" strokeWidth={2.2} /></Pressable>
        <Text style={st.title}>Responder com tcheka</Text>
        <View style={{ width: 44 }} />
      </View>
      <View style={st.body}>
        <CommentSticker author={author} body={c.body} style={{ alignSelf: 'center', maxWidth: 320 }} />
        <Text style={st.lead}>Grava uma tcheka a responder a este comentário. Ele aparece por cima do vídeo, num autocolante que podes mudar de sítio.</Text>
        {err ? <Text style={st.err} accessibilityRole="alert">{err}</Text> : null}
        <Pressable
          onPress={() => (web ? (liveCameraSupported() ? setStep('record') : void pick('library')) : void pick('camera'))}
          style={st.cta}
          accessibilityRole="button"
        >
          <Icon name="video" size={20} color="#fff" />
          <Text style={st.ctaText}>Gravar</Text>
        </Pressable>
        <Pressable onPress={() => void pick('library')} style={st.ghost} accessibilityRole="button">
          <Icon name="images" size={20} color="#fff" />
          <Text style={st.ghostText}>Escolher da galeria</Text>
        </Pressable>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  loading: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  root: { flex: 1, backgroundColor: '#000' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, gap: 10 },
  round: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, color: '#fff', fontSize: 16, fontWeight: '800', textAlign: 'center' },
  body: { flex: 1, justifyContent: 'center', paddingHorizontal: 24, gap: 16 },
  lead: { color: 'rgba(255,255,255,0.8)', fontSize: 14, textAlign: 'center', lineHeight: 20 },
  err: { color: '#fecaca', fontSize: 13, textAlign: 'center' },
  cta: { height: 50, borderRadius: 25, backgroundColor: colors.brand, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  ctaText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  ghost: { height: 50, borderRadius: 25, backgroundColor: 'rgba(255,255,255,0.14)', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  ghostText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  note: { color: 'rgba(255,255,255,0.7)', fontSize: 12, textAlign: 'center' },
});
