import { StyleSheet, View } from 'react-native';
import { SFX } from '@/lib/studio/audioDsp';
import type { StudioMix } from '@/lib/studio/audioMix';
import { fmtS } from '@/lib/tchekaRules';
import { t } from '@/lib/i18n';

/** As marcas do som na barra do tempo (a voz-off numa faixa e os efeitos sonoros em losangos), como no site (AudioPanel). */
export function AudioMarks({ mix, total }: { mix: StudioMix; total: number }) {
  if (!(total > 0)) return null;
  const pct = (t: number) => `${Math.min(100, Math.max(0, (t / total) * 100))}%` as `${number}%`;
  const v = mix.voice;
  return (
    <>
      {v ? <View style={[st.voiceBar, { left: pct(v.at), width: pct(Math.min(v.duration, total - v.at)) }]} accessibilityLabel={t('Voz-off dos {s} aos {s2} s', { s: fmtS(v.at), s2: fmtS(v.at + v.duration) })} /> : null}
      {mix.sfx.map((s) => <View key={s.key} style={[st.sfxMark, { left: pct(s.at) }]} accessibilityLabel={t('Efeito {name} aos {s} s', { name: String(SFX.find((x) => x.id === s.id)?.name), s: fmtS(s.at) })} />)}
    </>
  );
}

const st = StyleSheet.create({
  voiceBar: { position: 'absolute', top: -1, height: 6, borderRadius: 3, backgroundColor: 'rgba(214,51,79,0.85)' },
  sfxMark: { position: 'absolute', top: -5, width: 9, height: 9, marginLeft: -4.5, borderRadius: 2, transform: [{ rotate: '45deg' }], backgroundColor: '#ffd60a', borderWidth: 1, borderColor: 'rgba(0,0,0,0.5)' },
});
