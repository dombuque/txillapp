import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ActivityIndicator } from '@/components/PontoLoader';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/Icon';
import { MusicPicker } from '@/components/MusicPicker';
import { CloseFriendsSheet } from '@/components/StoryParts';
import { api, uploadMedia } from '@/lib/api';
import { musicApi, type Track } from '@/lib/api.music';
import { colors } from '@/lib/theme';

/** Criar um story: foto ou vídeo (até 30 s), legenda e para quem vai (todos ou amigos próximos). */
export default function NewStory() {
  const router = useRouter();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const [asset, setAsset] = useState<{ uri: string; video: boolean; mime: string } | null>(null);
  const [caption, setCaption] = useState('');
  const [audience, setAudience] = useState<'all' | 'close_friends'>('all');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const [music, setMusic] = useState<Track | null>(null);
  const [pickMusic, setPickMusic] = useState(false);
  const friends = useQuery({ queryKey: ['close-friends'], queryFn: api.closeFriends });

  async function pick(source: 'camera' | 'library') {
    setErr('');
    try {
      if (source === 'camera') {
        const p = await ImagePicker.requestCameraPermissionsAsync();
        if (!p.granted) return setErr('Preciso de acesso à câmara.');
      }
      const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images', 'videos'], quality: 0.85, videoMaxDuration: 30 };
      const r = await (source === 'camera' ? ImagePicker.launchCameraAsync(opts) : ImagePicker.launchImageLibraryAsync(opts));
      const a = r.canceled ? null : r.assets[0];
      if (a) setAsset({ uri: a.uri, video: a.type === 'video', mime: a.mimeType ?? (a.type === 'video' ? 'video/mp4' : 'image/jpeg') });
      else if (!asset) router.back();
    } catch (e) {
      setErr((e as Error).message || 'Não consegui abrir a câmara');
    }
  }
  useEffect(() => {
    void pick('library'); // abre logo a galeria; a câmara está num botão
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function publish() {
    if (!asset || busy) return;
    setBusy(true);
    setErr('');
    try {
      const id = await uploadMedia(asset.uri, asset.mime, 'public');
      await musicApi.createStory(id, caption.trim(), audience, music);
      await qc.invalidateQueries({ queryKey: ['stories'] });
      router.back();
    } catch (e) {
      setErr((e as Error).message || 'Não consegui publicar o story');
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: '#000' }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {asset ? (asset.video ? <VideoPreview uri={asset.uri} /> : <Image source={{ uri: asset.uri }} style={StyleSheet.absoluteFill} contentFit="contain" accessibilityLabel="Pré-visualização do story" />) : <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}><ActivityIndicator color="#fff" /></View>}
      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} style={{ paddingHorizontal: 8 }} accessibilityRole="button" accessibilityLabel="Cancelar"><Text style={{ fontSize: 30, lineHeight: 36, color: '#fff' }}>×</Text></Pressable>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable onPress={() => void pick('library')} style={styles.circle} accessibilityLabel="Galeria"><Icon name="image" size={22} color="#fff" /></Pressable>
          <Pressable onPress={() => void pick('camera')} style={styles.circle} accessibilityLabel="Câmara"><Icon name="camera" size={22} color="#fff" /></Pressable>
        </View>
      </View>
      <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <TextInput value={caption} onChangeText={setCaption} maxLength={200} placeholder="Escreve uma legenda…" placeholderTextColor="rgba(255,255,255,0.7)" style={styles.caption} accessibilityLabel="Legenda do story" />
        {music ? (
          <View style={[styles.musicRow, { paddingVertical: 6, paddingRight: 6 }]}>
            <Icon name="music" size={18} color="#fff" />
            <Text style={{ flex: 1, color: '#fff', fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{music.title}{music.kind === 'clip' ? '' : ` · ${music.artist || 'Autor desconhecido'}`}</Text>
            <Pressable onPress={() => setMusic(null)} style={styles.musicX} accessibilityRole="button" accessibilityLabel="Tirar a música"><Icon name="x" size={16} color="#fff" /></Pressable>
          </View>
        ) : (
          <Pressable onPress={() => setPickMusic(true)} style={[styles.musicRow, { justifyContent: 'center', gap: 8 }]} accessibilityRole="button">
            <Icon name="music" size={18} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>Adicionar música</Text>
          </Pressable>
        )}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }} accessibilityRole="radiogroup">
          {([['all', 'globe', 'Os teus stories'], ['close_friends', 'heart', 'Amigos próximos']] as const).map(([v, ic, label]) => (
            <Pressable key={v} onPress={() => setAudience(v)} style={[styles.radio, audience === v && { backgroundColor: v === 'all' ? '#fff' : '#10b981' }]} accessibilityRole="radio" accessibilityState={{ checked: audience === v }}>
              <Icon name={ic} size={18} color={audience === v && v === 'all' ? '#18181b' : '#fff'} />
              <Text style={[styles.audText, audience === v && v === 'all' && { color: '#18181b' }]}>{label}</Text>
            </Pressable>
          ))}
        </View>
        {audience === 'close_friends' && (
          <Pressable onPress={() => setListOpen(true)} style={{ marginTop: 8 }} accessibilityRole="button">
            <Text style={{ textAlign: 'center', fontSize: 14, fontWeight: '600', color: '#6ee7b7' }}>{friends.data?.length ? `${friends.data.length} na lista · gerir` : 'A tua lista está vazia · adicionar amigos'}</Text>
          </Pressable>
        )}
        <Text accessibilityRole="alert" style={styles.err}>{err}</Text>
        <Pressable onPress={() => void publish()} disabled={!asset || busy} style={[styles.share, { backgroundColor: audience === 'close_friends' ? '#059669' : colors.brand }, (!asset || busy) && { opacity: 0.5 }]} accessibilityRole="button">
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.shareText}>{audience === 'close_friends' ? 'Partilhar com amigos próximos' : 'Partilhar no story'}</Text>}
        </Pressable>
      </View>
      {listOpen && <CloseFriendsSheet onClose={() => setListOpen(false)} />}
      {pickMusic && <MusicPicker hint={caption} onClose={() => setPickMusic(false)} onPick={(t) => { setMusic(t); setPickMusic(false); }} />}
    </KeyboardAvoidingView>
  );
}

function VideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => { p.loop = true; p.muted = true; p.play(); });
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />;
}

const styles = StyleSheet.create({
  top: { position: 'absolute', left: 0, right: 0, top: 0, paddingHorizontal: 12, flexDirection: 'row', justifyContent: 'space-between' },
  circle: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, backgroundColor: '#000' },
  caption: { height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 16, color: '#fff', fontSize: 16, outlineStyle: 'none' } as object,
  err: { marginTop: 12, minHeight: 20, color: '#f87171', textAlign: 'center', fontSize: 14, lineHeight: 20 },
  musicRow: { marginTop: 12, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 16 },
  musicX: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  radio: { flex: 1, height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.15)' },
  aud: { height: 52, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.22)', paddingHorizontal: 16 },
  audText: { color: '#fff', fontWeight: '700' },
  share: { marginTop: 12, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  shareText: { color: '#fff', fontSize: 18, fontWeight: '600' },
});
