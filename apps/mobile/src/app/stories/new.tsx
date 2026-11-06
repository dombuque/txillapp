import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/Icon';
import { api, uploadMedia } from '@/lib/api';
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
      await api.createStory(id, caption.trim(), audience);
      await qc.invalidateQueries({ queryKey: ['stories'] });
      router.back();
    } catch (e) {
      setErr((e as Error).message || 'Não consegui publicar o story');
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: '#000' }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {asset ? (asset.video ? (
        <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}><Icon name="play" size={64} color="#fff" solid /><Text style={{ color: '#fff', marginTop: 8 }}>Vídeo escolhido</Text></View>
      ) : <Image source={{ uri: asset.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />) : <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}><ActivityIndicator color="#fff" /></View>}
      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} style={styles.circle} accessibilityRole="button" accessibilityLabel="Fechar"><Icon name="x" size={24} color="#fff" strokeWidth={2} /></Pressable>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable onPress={() => void pick('library')} style={styles.circle} accessibilityLabel="Galeria"><Icon name="image" size={22} color="#fff" /></Pressable>
          <Pressable onPress={() => void pick('camera')} style={styles.circle} accessibilityLabel="Câmara"><Icon name="camera" size={22} color="#fff" /></Pressable>
        </View>
      </View>
      <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <TextInput value={caption} onChangeText={setCaption} maxLength={120} placeholder="Escreve uma legenda…" placeholderTextColor="rgba(255,255,255,0.7)" style={styles.caption} accessibilityLabel="Legenda do story" />
        {err ? <Text style={styles.err}>{err}</Text> : null}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
          <Pressable onPress={() => setAudience(audience === 'all' ? 'close_friends' : 'all')} style={[styles.aud, audience === 'close_friends' && { backgroundColor: '#16a34a' }]} accessibilityRole="button">
            <Icon name="star" size={16} color="#fff" solid={audience === 'close_friends'} />
            <Text style={styles.audText}>{audience === 'all' ? 'Todos' : 'Amigos próximos'}</Text>
          </Pressable>
          <Pressable onPress={() => void publish()} disabled={!asset || busy} style={[{ flex: 1 }, (!asset || busy) && { opacity: 0.5 }]} accessibilityRole="button">
            <LinearGradient colors={[colors.brand, colors.brandLight]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.share}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.shareText}>Partilhar no story</Text>}
            </LinearGradient>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', left: 0, right: 0, top: 0, paddingHorizontal: 12, flexDirection: 'row', justifyContent: 'space-between' },
  circle: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, backgroundColor: 'rgba(0,0,0,0.35)' },
  caption: { height: 48, borderRadius: 24, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 18, color: '#fff', fontSize: 16, outlineStyle: 'none' } as object,
  err: { marginTop: 8, color: '#fecaca', textAlign: 'center' },
  aud: { height: 52, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.22)', paddingHorizontal: 16 },
  audText: { color: '#fff', fontWeight: '700' },
  share: { height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  shareText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
