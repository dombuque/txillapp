import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { createElement, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { Button } from '@/components/ui/Button';
import { musicApi, type Track } from '@/lib/api.music';
import { showToast } from '@/lib/toast';
import { BookmarkIcon } from './BookmarkIcon';
import { embedAllowed, httpLink, linkPlayerHeight, providerName } from '@/lib/musicLink';
import { colors } from '@/lib/theme';
import { t } from '@/lib/i18n';

/** A cor de cada plataforma (só para a etiqueta pequena). */
const PROVIDER_COLOR: Record<string, string> = { spotify: '#1DB954', youtube: '#FF0033', audiomack: '#FFA200', boomplay: '#0F0F0F', deezer: '#A238FF', apple: '#FA243C' };

/** O leitor oficial da plataforma, embutido (WebView na app, iframe na web), e «Abrir no Spotify». */
export function LinkPlayer({ track, onClose }: { track: Track; onClose: () => void }) {
  const { width } = useWindowDimensions();
  const w = Math.min(width - 32, 560);
  const h = linkPlayerHeight(track.provider, track.linkKind, w);
  const name = providerName(track.provider);
  // Guardar nas «Guardadas» do seletor (para pôr nas minhas notas, mimos e publicações sem copiar a ligação).
  const qc = useQueryClient();
  const favs = useQuery({ queryKey: ['music-favorites'], queryFn: musicApi.favorites, staleTime: 60_000, retry: false });
  const saved = !!favs.data?.some((x) => x.id === track.id);
  const save = useMutation({
    mutationFn: async (): Promise<unknown> => (saved ? musicApi.removeFavorite(track.id) : musicApi.addFavorite(track)),
    onSuccess: () => { showToast(saved ? t('Tirada das guardadas') : t('Guardada na tua música')); void qc.invalidateQueries({ queryKey: ['music-favorites'] }); },
    onError: (e: Error) => showToast(e.message),
  });
  let player: React.ReactNode = null;
  const external = httpLink(track.link ?? track.landing);
  if (track.embedUrl && embedAllowed(track.embedUrl)) {
    if (Platform.OS === 'web') {
      player = createElement('iframe', { src: track.embedUrl, width: '100%', height: h, style: { border: 0, borderRadius: 12 }, allow: 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture', title: track.title, referrerPolicy: 'strict-origin-when-cross-origin' });
    } else {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { WebView } = require('react-native-webview') as typeof import('react-native-webview');
      player = <WebView source={{ uri: track.embedUrl }} style={{ width: w, height: h, borderRadius: 12, backgroundColor: '#000' }} allowsInlineMediaPlayback mediaPlaybackRequiresUserAction={false} javaScriptEnabled originWhitelist={['https://*']} setSupportMultipleWindows={false} />;
    }
  }
  return (
    <Sheet title={track.title} onClose={onClose}>
      <View style={{ paddingHorizontal: 16, paddingBottom: 16, gap: 12, alignItems: 'center' }}>
        {/* A capa por trás enquanto o leitor carrega (nunca uma caixa vazia). */}
        <View style={{ width: w, height: h, borderRadius: 12, overflow: 'hidden', backgroundColor: '#000' }}>
          {track.cover ? <Image source={{ uri: track.cover }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
          <View style={StyleSheet.absoluteFill}>{player}</View>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, alignSelf: 'stretch' }}>
          <Button label={saved ? t('Guardada') : t('Guardar')} icon={<BookmarkIcon on={saved} size={18} color={colors.zinc900} />} kind="secondary" onPress={() => save.mutate()} style={{ flex: 1 }} />
          <Button label={t('Copiar ligação')} icon="link" kind="secondary" onPress={() => void Clipboard.setStringAsync(track.link ?? track.landing ?? '').then(() => showToast(t('Ligação copiada')))} style={{ flex: 1 }} />
        </View>
        {external ? <Button label={t('Abrir no {provider}', { provider: name })} kind="secondary" onPress={() => void Linking.openURL(external).catch(() => undefined)} block /> : null}
        <Text style={st.legal}>{t('A música toca no leitor do {provider} e conta para o artista lá.', { provider: name })}</Text>
      </View>
    </Sheet>
  );
}

/**
 * Música por ligação (Spotify, YouTube…): o cartão com a capa, o título, o artista e a plataforma; ▶ abre o leitor oficial.
 * `pill`: a versão pequena (por cima de uma foto, num mimo, numa nota). `dark`: em fundo escuro.
 */
export function MusicLinkCard({ track, pill = false, dark = false }: { track: Track; pill?: boolean; dark?: boolean }) {
  const [open, setOpen] = useState(false);
  const name = providerName(track.provider);
  const label = t('Ouvir {title} no {provider}', { title: track.title, provider: name });
  const tag = <View style={[st.tag, { backgroundColor: PROVIDER_COLOR[track.provider ?? ''] ?? colors.zinc800 }]}><Text style={st.tagText}>{name}</Text></View>;
  return (
    <>
      {pill ? (
        <Pressable onPress={() => setOpen(true)} style={[st.pill, dark ? st.pillDark : st.pillLight]} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}>
          <Icon name="play" size={12} color={dark ? '#fff' : colors.zinc900} solid />
          <Text style={[st.pillText, { color: dark ? '#fff' : colors.zinc900 }]} numberOfLines={1}>{track.artist ? `${track.title} · ${track.artist}` : track.title}</Text>
          {tag}
        </Pressable>
      ) : (
        <Pressable onPress={() => setOpen(true)} style={({ pressed }) => [st.card, pressed && { opacity: 0.85 }]} accessibilityRole="button" accessibilityLabel={label}>
          {track.cover ? <Image source={{ uri: track.cover }} style={st.cover} contentFit="cover" /> : <View style={[st.cover, st.noCover]}><Icon name="music" size={22} color={colors.zinc500} /></View>}
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text style={st.title} numberOfLines={1}>{track.title}</Text>
            {track.artist ? <Text style={st.artist} numberOfLines={1}>{track.artist}</Text> : null}
            <View style={{ flexDirection: 'row', marginTop: 2 }}>{tag}</View>
          </View>
          <View style={st.play}><Icon name="play" size={18} color="#fff" solid /></View>
        </Pressable>
      )}
      {open ? <LinkPlayer track={track} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

const st = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, backgroundColor: colors.zinc100, padding: 10 },
  cover: { width: 56, height: 56, borderRadius: 10 },
  noCover: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.zinc200 },
  title: { fontSize: 15, fontWeight: '700', color: colors.zinc900 },
  artist: { fontSize: 13, color: colors.zinc600 },
  play: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  tag: { borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
  tagText: { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.2 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, maxWidth: '100%', alignSelf: 'flex-start' },
  pillDark: { backgroundColor: 'rgba(0,0,0,0.55)' },
  pillLight: { backgroundColor: 'rgba(255,255,255,0.9)' },
  pillText: { flexShrink: 1, fontSize: 13, fontWeight: '600' },
  legal: { fontSize: 12, color: colors.zinc500, textAlign: 'center' },
});
