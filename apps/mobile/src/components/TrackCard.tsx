import { useEffect, useRef, useState } from 'react';
import { AppState, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { licenseLabel } from '@/components/MusicPicker';
import { Sheet } from '@/components/Sheet';
import type { Track } from '@/lib/api.music';
import { allowAuto, autoAllowed, playTrack, stopTrack, useMusicMuted } from '@/lib/musicPlayer';
import { colors } from '@/lib/theme';

export { useMusicMuted };

/**
 * Cartão da música de uma publicação: toca/pára; com `autoplay` toca em ciclo e tem o botão do som (vale para tudo).
 * Tocar no nome mostra os créditos e a licença. Para tocar sozinha com o post à vista, passa `visible` (true quando o
 * post está bem à vista no ecrã, p.ex. via onViewableItemsChanged da lista); só toca sozinha depois de a pessoa ter posto
 * uma faixa a tocar à mão, como no site.
 */
export function TrackCard({ track, autoplay = false, visible = false }: { track: Track; autoplay?: boolean; visible?: boolean }) {
  const me = useRef(Symbol('track'));
  const [on, setOn] = useState(false);
  const [muted, toggleMute] = useMusicMuted();
  const [info, setInfo] = useState(false);
  const userPaused = useRef(false); // pausaste à mão: não volta a tocar sozinha enquanto o post estiver à vista
  const playing = useRef(false);

  async function play() {
    const ok = await playTrack(me.current, track.url, { loop: autoplay, onStop: () => { playing.current = false; setOn(false); } });
    playing.current = ok;
    setOn(ok);
  }
  const playRef = useRef(play);
  playRef.current = play;

  useEffect(() => () => stopTrack(me.current), []);

  // Toca sozinha um instante depois de o post ficar à vista; pára quando sai ou a app vai para segundo plano.
  useEffect(() => {
    if (!autoplay) return;
    let dwell: ReturnType<typeof setTimeout> | undefined;
    if (visible) {
      dwell = setTimeout(() => { if (autoAllowed() && !userPaused.current && !playing.current) void playRef.current(); }, 700);
    } else {
      userPaused.current = false;
      stopTrack(me.current);
    }
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active') stopTrack(me.current);
      else if (visible && autoAllowed() && !userPaused.current && !playing.current) void playRef.current();
    });
    return () => { clearTimeout(dwell); sub.remove(); };
  }, [autoplay, visible, track.url]);

  function toggle() {
    if (on) {
      userPaused.current = true;
      allowAuto(false); // parou à mão: os próximos posts não tocam sozinhos
      stopTrack(me.current);
    } else {
      userPaused.current = false;
      allowAuto(true); // pôs a tocar: os próximos posts tocam sozinhos
      void play();
    }
  }

  return (
    <View style={s.card}>
      <Pressable onPress={toggle} style={({ pressed }) => [s.play, pressed && s.pressed]} accessibilityRole="button" accessibilityLabel={on ? 'Parar' : 'Ouvir'}>
        <Icon name={on ? 'pause' : 'play'} size={18} solid color="#fff" />
      </Pressable>
      <Pressable onPress={() => track.kind !== 'clip' && setInfo(true)} style={s.text} accessibilityRole="button" accessibilityLabel="Créditos da música">
        <Text style={s.title} numberOfLines={1}>{track.title}</Text>
        <Text style={s.sub} numberOfLines={1}>{track.kind === 'clip' ? 'Áudio original' : track.artist || 'Autor desconhecido'}</Text>
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
  play: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
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
