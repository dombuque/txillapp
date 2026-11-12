import { useEffect, useRef, useState } from 'react';
import { AppState, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { licenseLabel } from '@/lib/musicCatalog';
import { Sheet } from '@/components/Sheet';
import { LocalTrackLine, RightsReportSheet } from '@/components/LocalArtists';
import type { Track } from '@/lib/api.music';
import { artistHref, isLocalTrack } from '@/lib/artists';
import { useRouter } from 'expo-router';
import { playTrack, stopTrack, useMusicMuted } from '@/lib/musicPlayer';
import { colors } from '@/lib/theme';

export { useMusicMuted };

/**
 * Cartão da música de uma publicação. Não tem play nem pausa: a música toca sozinha enquanto o post está à vista
 * (`visible`, dito pela lista) e pára quando sai do ecrã, quando se muda de ecrã ou quando a app vai para segundo plano.
 * O único controlo é o som (silenciar / ativar), que vale para toda a app. Tocar no nome mostra os créditos e a licença.
 * `playNow` toca logo ao aparecer (nota de música aberta pela pessoa). Sem `autoplay`, é só informativo (ex.: ao compor).
 */
export function TrackCard({ track, autoplay = false, visible = false, playNow = false }: { track: Track; autoplay?: boolean; visible?: boolean; playNow?: boolean }) {
  const me = useRef(Symbol('track'));
  const [on, setOn] = useState(false);
  const [muted, toggleMute] = useMusicMuted();
  const [info, setInfo] = useState(false);
  const playing = useRef(false);
  const router = useRouter();
  const local = isLocalTrack(track);
  const artistTo = artistHref(track);

  async function play() {
    const ok = await playTrack(me.current, track.url, { loop: true, onStop: () => { playing.current = false; setOn(false); } });
    playing.current = ok;
    setOn(ok);
  }
  const playRef = useRef(play);
  playRef.current = play;

  useEffect(() => () => stopTrack(me.current), []);

  // Toca um instante depois de ficar à vista; pára quando sai ou a app vai para segundo plano.
  const shown = autoplay && (visible || playNow);
  useEffect(() => {
    let dwell: ReturnType<typeof setTimeout> | undefined;
    if (shown) {
      dwell = setTimeout(() => { if (!playing.current) void playRef.current(); }, playNow ? 0 : 400);
    } else {
      stopTrack(me.current);
    }
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active') stopTrack(me.current);
      else if (shown && !playing.current) void playRef.current();
    });
    return () => { clearTimeout(dwell); sub.remove(); };
  }, [shown, playNow, track.url]);

  return (
    <View style={s.card}>
      <View style={[s.disc, on && !muted && s.discOn]} accessibilityLabel={on ? 'A tocar' : 'Música'}>
        <Icon name="music" size={20} color="#fff" />
      </View>
      <Pressable onPress={() => track.kind !== 'clip' && setInfo(true)} style={s.text} accessibilityRole="button" accessibilityLabel="Créditos da música">
        {local ? (
          // Programa de artistas: «♪ Título · Artista», com o nome a levar ao perfil do artista.
          <>
            <LocalTrackLine track={track} style={s.title} linkStyle={{ color: colors.brand }} onArtist={artistTo ? () => router.push(artistTo as never) : undefined} />
            <Text style={s.sub} numberOfLines={1}>Artistas de Moçambique</Text>
          </>
        ) : (
          <>
            <Text style={s.title} numberOfLines={1}>{track.title}</Text>
            <Text style={s.sub} numberOfLines={1}>{track.kind === 'clip' ? 'Áudio original' : track.artist || 'Autor desconhecido'}</Text>
          </>
        )}
      </Pressable>
      {autoplay && (
        <Pressable onPress={toggleMute} style={({ pressed }) => [s.mute, pressed && s.pressed]} accessibilityRole="button" accessibilityState={{ selected: muted }} accessibilityLabel={muted ? 'Ativar o som' : 'Silenciar'}>
          <Icon name={muted ? 'volume-off' : 'volume'} size={20} color={colors.zinc700} />
        </Pressable>
      )}
      {info && <TrackCredits track={track} onClose={() => setInfo(false)} />}
    </View>
  );
}

/** Só ligações https viram links (defesa a mais: o servidor já recusa o resto). */
const safeHref = (u: string | null | undefined) => (u && /^https:\/\//i.test(u) ? u : null);

/** Créditos da faixa (licença Creative Commons e origem). Ficam fora do cartão, mas sempre à mão. */
export function TrackCredits({ track, onClose }: { track: Track; onClose: () => void }) {
  const lic = safeHref(track.licenseUrl);
  const land = safeHref(track.landing);
  const router = useRouter();
  const [report, setReport] = useState(false);
  if (isLocalTrack(track)) {
    // Faixa do programa de artistas: a licença é a do Txillapp, com a ligação ao perfil e a denúncia de direitos de autor.
    const to = artistHref(track);
    if (report) return <RightsReportSheet track={track} onClose={onClose} />;
    return (
      <Sheet title="Créditos da música" onClose={onClose}>
        <View style={{ paddingHorizontal: 24 }}>
          <Text style={s.cTitle}>{track.title}</Text>
          <Text style={s.cArtist}>{track.artist}</Text>
          <Text style={s.cLine}>Artistas de Moçambique · Licença de uso de música no Txillapp (o artista autorizou o uso em mimos e tchekas).</Text>
          {to ? <Text style={[s.cLine, { marginTop: 8 }]}><Text style={s.link} onPress={() => { onClose(); router.push(to as never); }}>Ver o perfil do artista</Text></Text> : null}
          <Text style={[s.cLine, { marginTop: 8 }]}><Text style={s.link} onPress={() => setReport(true)}>Denunciar por direitos de autor</Text></Text>
        </View>
      </Sheet>
    );
  }
  return (
    <Sheet title="Créditos da música" onClose={onClose}>
      <View style={{ paddingHorizontal: 24 }}>
        <Text style={s.cTitle}>{track.title}</Text>
        <Text style={s.cArtist}>{track.artist || 'Autor desconhecido'}</Text>
        <Text style={s.cLine}>
          Licença:{' '}
          {lic ? <Text style={s.link} onPress={() => void Linking.openURL(lic)}>{licenseLabel(track.license)}</Text> : licenseLabel(track.license)}
        </Text>
        {land && <Text style={[s.cLine, { marginTop: 4 }]}><Text style={s.link} onPress={() => void Linking.openURL(land)}>Origem</Text></Text>}
      </View>
    </Sheet>
  );
}

const s = StyleSheet.create({
  card: { marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, backgroundColor: '#fafafa', borderWidth: 1, borderColor: colors.zinc100, padding: 12 },
  disc: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.zinc300, alignItems: 'center', justifyContent: 'center' },
  discOn: { backgroundColor: colors.brand },
  text: { flex: 1, minWidth: 0 },
  title: { fontSize: 16, fontWeight: '600', color: colors.zinc900 },
  sub: { fontSize: 12, color: colors.zinc500 },
  mute: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.zinc200, alignItems: 'center', justifyContent: 'center' },
  pressed: { transform: [{ scale: 0.95 }] },
  cTitle: { fontSize: 17, fontWeight: '600', color: colors.zinc900 },
  cArtist: { fontSize: 16, color: colors.zinc600 },
  cLine: { marginTop: 12, fontSize: 14, color: colors.zinc600 },
  link: { fontWeight: '600', textDecorationLine: 'underline', color: colors.zinc600 },
});
