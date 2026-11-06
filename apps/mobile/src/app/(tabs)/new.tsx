import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { Icon, type IconName } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { api, uploadMedia } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/theme';

const MAX_PHOTOS = 10;
interface Asset { uri: string; video: boolean; mime: string; durationMs?: number }

/** Cartão grande do primeiro passo. */
function Tile({ icon, title, sub, tone, onPress }: { icon: IconName; title: string; sub: string; tone: [string, string]; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.tileWrap, pressed && { transform: [{ scale: 0.97 }] }]} accessibilityRole="button" accessibilityLabel={title}>
      <LinearGradient colors={tone} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.tile}>
        <View style={styles.tileIcon}><Icon name={icon} size={26} color="#fff" /></View>
        <View>
          <Text style={styles.tileTitle}>{title}</Text>
          <Text style={styles.tileSub}>{sub}</Text>
        </View>
      </LinearGradient>
    </Pressable>
  );
}

/**
 * Nova publicação em dois passos: primeiro escolhes o que publicar (câmara, galeria, vídeo ou só texto), depois escreves
 * com a pré-visualização grande e o botão de publicar sempre à mão.
 */
export default function Compose() {
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const col = Math.min(width, 576);
  const [step, setStep] = useState<'choose' | 'write'>('choose');
  const [body, setBody] = useState('');
  const [place, setPlace] = useState('');
  const [placeOpen, setPlaceOpen] = useState(false);
  const [placeDraft, setPlaceDraft] = useState('');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [err, setErr] = useState('');

  const video = assets.find((a) => a.video);
  const photos = assets.filter((a) => !a.video);
  const canPost = !busy && (body.trim().length > 0 || assets.length > 0);
  const first = user?.displayName.split(' ')[0] ?? '';

  async function add(source: 'camera' | 'library', kind: 'photo' | 'video') {
    setErr('');
    try {
      if (source === 'camera') {
        const p = await ImagePicker.requestCameraPermissionsAsync();
        if (!p.granted) return setErr('Preciso de acesso à câmara.');
      }
      const opts: ImagePicker.ImagePickerOptions = {
        mediaTypes: kind === 'video' ? ['videos'] : ['images'],
        quality: 0.85,
        videoMaxDuration: 60,
        allowsMultipleSelection: source === 'library' && kind === 'photo',
        selectionLimit: Math.max(1, MAX_PHOTOS - photos.length),
      };
      const r = await (source === 'camera' ? ImagePicker.launchCameraAsync(opts) : ImagePicker.launchImageLibraryAsync(opts));
      if (r.canceled) return;
      const next = r.assets.map((a): Asset => ({ uri: a.uri, video: a.type === 'video', mime: a.mimeType ?? (a.type === 'video' ? 'video/mp4' : 'image/jpeg'), durationMs: a.duration ?? undefined }));
      setAssets((cur) => (kind === 'video' ? next.slice(0, 1) : [...cur.filter((a) => !a.video), ...next].slice(0, MAX_PHOTOS)));
      setStep('write');
    } catch (e) {
      setErr((e as Error).message || 'Não consegui abrir a câmara');
    }
  }
  function leave() {
    if (step === 'write' && (body.trim() || assets.length)) {
      return Alert.alert('Sair sem publicar?', 'Perdes o que escreveste.', [
        { text: 'Continuar a editar', style: 'cancel' },
        { text: 'Descartar', style: 'destructive', onPress: () => { setBody(''); setAssets([]); setPlace(''); setStep('choose'); router.replace('/'); } },
      ]);
    }
    if (step === 'write') return setStep('choose');
    router.replace('/');
  }
  async function submit() {
    if (!canPost) return;
    setBusy(true);
    setErr('');
    try {
      const ids: string[] = [];
      for (let i = 0; i < assets.length; i++) {
        setProgress(assets.length > 1 ? `A enviar ${i + 1} de ${assets.length}…` : 'A enviar…');
        ids.push(await uploadMedia(assets[i].uri, assets[i].mime, 'public'));
      }
      setProgress('A publicar…');
      await api.createPost({ body: body.trim(), mediaIds: ids, ...(place ? { locationLabel: place } : null) });
      setBody('');
      setAssets([]);
      setPlace('');
      setStep('choose');
      await Promise.all([qc.invalidateQueries({ queryKey: ['feed'] }), qc.invalidateQueries({ queryKey: ['profile-posts'] })]);
      router.replace('/');
    } catch (e) {
      setErr((e as Error).message || 'Não consegui publicar');
    } finally {
      setBusy(false);
      setProgress('');
    }
  }

  const header = (
    <View style={styles.top}>
      <Pressable onPress={leave} style={styles.x} accessibilityRole="button" accessibilityLabel={step === 'write' ? 'Voltar' : 'Fechar'}>
        <Icon name={step === 'write' ? 'back' : 'x'} size={step === 'write' ? 26 : 24} strokeWidth={2} />
      </Pressable>
      <Text style={styles.title}>{step === 'choose' ? 'Nova publicação' : video ? 'Novo reel' : 'Escreve a legenda'}</Text>
      <View style={{ width: 44 }} />
    </View>
  );

  if (step === 'choose') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.white, paddingTop: insets.top }}>
        {header}
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
          <Text style={styles.hello}>O que vais partilhar, {first}?</Text>
          <Text style={styles.helloSub}>Escolhe um para começar. Podes sempre juntar mais depois.</Text>
          <View style={styles.grid}>
            <Tile icon="camera" title="Tirar foto" sub="Câmara" tone={[colors.brand, '#ff8a5b']} onPress={() => void add('camera', 'photo')} />
            <Tile icon="image" title="Galeria" sub="Até 10 fotos" tone={['#6366f1', '#a855f7']} onPress={() => void add('library', 'photo')} />
            <Tile icon="video" title="Vídeo" sub="Até 60 s" tone={['#0ea5e9', '#22d3ee']} onPress={() => void add('library', 'video')} />
            <Tile icon="pencil" title="Só texto" sub="Uma ideia, um desabafo" tone={['#18181b', '#52525b']} onPress={() => setStep('write')} />
          </View>
          {err ? <Text style={styles.err} accessibilityRole="alert">{err}</Text> : null}
        </ScrollView>
      </View>
    );
  }

  const size = col - 32;
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.white, paddingTop: insets.top }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {header}
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
        {(video || photos.length > 0) && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }} snapToInterval={size + 10} decelerationRate="fast">
            {video && (
              <View style={[styles.preview, { width: size, height: size * 1.1, backgroundColor: colors.zinc900, alignItems: 'center', justifyContent: 'center' }]}>
                <Icon name="play" size={48} color="#fff" solid />
                <Text style={{ color: '#fff', marginTop: 8, fontWeight: '600' }}>Vídeo{video.durationMs ? ` · ${Math.round(video.durationMs / 1000)} s` : ''}</Text>
                <Pressable onPress={() => setAssets([])} style={styles.remove} accessibilityLabel="Tirar o vídeo"><Icon name="x" size={16} color="#fff" /></Pressable>
              </View>
            )}
            {photos.map((a, i) => (
              <View key={a.uri} style={[styles.preview, { width: photos.length === 1 ? size : size * 0.82, height: photos.length === 1 ? size * 1.1 : size * 0.82 * 1.2 }]}>
                <Image source={{ uri: a.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
                <Pressable onPress={() => setAssets((cur) => { const n = cur.filter((x) => x.uri !== a.uri); if (!n.length) setStep('choose'); return n; })} style={styles.remove} accessibilityLabel={`Tirar a foto ${i + 1}`}><Icon name="x" size={16} color="#fff" /></Pressable>
                {photos.length > 1 && <View style={styles.counter}><Text style={styles.counterText}>{i + 1}/{photos.length}</Text></View>}
              </View>
            ))}
            {!video && photos.length < MAX_PHOTOS && (
              <Pressable onPress={() => void add('library', 'photo')} style={[styles.add, { height: photos.length === 1 ? size * 1.1 : size * 0.82 * 1.2 }]} accessibilityRole="button" accessibilityLabel="Juntar mais fotos">
                <Icon name="plus" size={28} color={colors.brand} strokeWidth={2.4} />
                <Text style={styles.addText}>Juntar</Text>
              </Pressable>
            )}
          </ScrollView>
        )}

        <View style={styles.writeRow}>
          <Avatar name={user?.displayName ?? '?'} username={user?.username} size={44} />
          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder={assets.length ? 'Escreve uma legenda…' : `Bora, ${first}, solta a vibe!`}
            placeholderTextColor={colors.zinc500}
            multiline
            maxLength={2000}
            autoFocus={assets.length === 0}
            style={styles.input}
            accessibilityLabel="Texto da publicação"
          />
        </View>
        <Text style={styles.left}>{body.length > 1600 ? `${2000 - body.length} restantes` : ' '}</Text>

        <Pressable onPress={() => { setPlaceDraft(place); setPlaceOpen(true); }} style={styles.row} accessibilityRole="button">
          <View style={styles.rowIcon}><Icon name="map-pin" size={20} color={place ? colors.brand : colors.zinc800} /></View>
          <Text style={[styles.rowText, place ? { color: colors.brand } : null]} numberOfLines={1}>{place || 'Adicionar local'}</Text>
          {place ? <Pressable onPress={() => setPlace('')} hitSlop={10} accessibilityLabel="Tirar o local"><Icon name="x" size={18} color={colors.zinc500} /></Pressable> : <Text style={styles.chev}>›</Text>}
        </Pressable>
        {err ? <Text style={styles.err} accessibilityRole="alert">{err}</Text> : null}
        {progress ? <Text style={styles.progress}>{progress}</Text> : null}
      </ScrollView>

      <View style={[styles.cta, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <Pressable onPress={() => void submit()} disabled={!canPost} style={({ pressed }) => [styles.ctaWrap, !canPost && { opacity: 0.4 }, pressed && { transform: [{ scale: 0.98 }] }]} accessibilityRole="button">
          <LinearGradient colors={[colors.brand, colors.brandLight]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.ctaBtn}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>Publicar</Text>}
          </LinearGradient>
        </Pressable>
      </View>

      {placeOpen && (
        <Sheet title="Onde estás?" onClose={() => setPlaceOpen(false)}>
          <View style={{ paddingHorizontal: 24 }}>
            <TextInput value={placeDraft} onChangeText={setPlaceDraft} autoFocus maxLength={80} placeholder="Escreve o sítio (ex.: Costa do Sol)" placeholderTextColor={colors.zinc500} style={styles.placeInput} accessibilityLabel="Local" />
            <Pressable onPress={() => { setPlace(placeDraft.trim()); setPlaceOpen(false); }} style={styles.ok}><Text style={styles.okText}>Guardar</Text></Pressable>
          </View>
        </Sheet>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingBottom: 8, paddingTop: 4 },
  x: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  title: { fontSize: 18, fontWeight: '800', color: colors.zinc900 },
  hello: { fontSize: 28, fontWeight: '800', lineHeight: 32, color: colors.zinc900, marginTop: 8 },
  helloSub: { marginTop: 6, fontSize: 16, color: colors.zinc600, marginBottom: 20 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tileWrap: { width: '48%', flexGrow: 1 },
  tile: { height: 160, borderRadius: 24, padding: 16, justifyContent: 'space-between' },
  tileIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' },
  tileTitle: { color: '#fff', fontSize: 20, fontWeight: '800' },
  tileSub: { color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 2 },
  preview: { borderRadius: 24, overflow: 'hidden', backgroundColor: colors.zinc100 },
  remove: { position: 'absolute', right: 10, top: 10, width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  counter: { position: 'absolute', left: 10, top: 10, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 10, paddingVertical: 4 },
  counterText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  add: { width: 96, borderRadius: 24, borderWidth: 2, borderStyle: 'dashed', borderColor: colors.zinc300, alignItems: 'center', justifyContent: 'center', gap: 4 },
  addText: { fontSize: 13, fontWeight: '700', color: colors.brand },
  writeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 16, paddingTop: 16 },
  input: { flex: 1, minHeight: 90, paddingTop: 8, paddingBottom: 8, fontSize: 18, lineHeight: 26, color: colors.zinc900, textAlignVertical: 'top', outlineStyle: 'none' } as object,
  left: { paddingHorizontal: 20, textAlign: 'right', fontSize: 12, color: colors.zinc500, minHeight: 16 },
  row: { marginHorizontal: 16, marginTop: 4, minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, borderTopColor: colors.zinc100, paddingTop: 8 },
  rowIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, fontSize: 16, fontWeight: '600', color: colors.zinc800 },
  chev: { fontSize: 24, color: '#a1a1aa', paddingHorizontal: 4 },
  err: { marginTop: 12, paddingHorizontal: 24, textAlign: 'center', color: colors.red600 },
  progress: { paddingHorizontal: 24, marginTop: 8, textAlign: 'center', color: colors.zinc600 },
  cta: { paddingHorizontal: 16, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.zinc100, backgroundColor: colors.white },
  ctaWrap: { borderRadius: 999, boxShadow: '0 10px 24px rgba(214,51,79,0.3)' },
  ctaBtn: { height: 56, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  placeInput: { borderRadius: 16, backgroundColor: colors.zinc100, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: colors.zinc900 },
  ok: { marginTop: 12, height: 48, borderRadius: 24, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  okText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
