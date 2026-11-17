import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { defaultMix, type StudioMix } from '@/lib/studio/audioMix';
import { isSfx } from '@/lib/studio/audioDsp';
import { sanitizeFx, sanitizeOverlay, type Overlay } from '@/lib/studio/effects';
import type { MagicResult } from '@/lib/studio/magic';
import { createClockStore } from './native/clockStore';
import { NativeOverlays } from './native/NativeOverlays';
import { NativeStage, type StageSeg } from './native/NativeStage';
import { usePreviewAudio } from './native/usePreviewAudio';
import { t } from '@/lib/i18n';

const noop = () => undefined;

/** Os bocados da pré-visualização (os mesmos do palco do estúdio) a partir da montagem. */
export function magicStageSegs(result: MagicResult): StageSeg[] {
  return result.clips.map((c, i) => ({
    key: c.key, uri: c.uri, video: c.video, start: result.starts[i] ?? 0, dur: result.durations[i] ?? 0,
    from: c.video ? c.trim.start : 0, len: c.video ? Math.max(0, c.trim.end - c.trim.start) : result.durations[i] ?? 0,
    speed: c.video ? c.speed || 1 : 1, fx: sanitizeFx(c.fx), volume: c.video && c.hasAudio !== false ? 1 : 0, length: c.video ? c.length : undefined,
  }));
}

/** A mistura do som da pré-visualização: o trecho da música, os fades e os efeitos sonoros da onda. */
export function magicPreviewMix(result: MagicResult): StudioMix {
  const m = defaultMix();
  if (!result.music) return { ...m, sfx: [] };
  return {
    ...m, musicStartMs: result.music.startMs, musicStartAuto: false, fadeIn: result.music.fadeIn, fadeOut: result.music.fadeOut,
    sfx: result.sfx.filter((x) => isSfx(x.id)).map((x, i) => ({ key: `magica-${i}`, id: x.id as StudioMix['sfx'][number]['id'], at: x.at })),
  };
}

/**
 * A pré-visualização da montagem mágica no telemóvel: o palco do estúdio (components/studio/native/NativeStage, com as fotos
 * enquadradas, os vídeos no melhor momento, as transições e o filtro) a tocar em ciclo, com o texto de abertura, a música
 * do trecho e os efeitos sonoros. Antes só se via a primeira foto (e um quadro preto quando eram só vídeos).
 */
export function MagicPreview({ result, playing, musicUrl, onClip, style }: { result: MagicResult; playing: boolean; musicUrl?: string | null; onClip?: (index: number) => void; style?: StyleProp<ViewStyle> }) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const total = Math.max(0.1, result.total);
  const clock = useMemo(() => createClockStore(total), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => clock.dispose(), [clock]);
  const live = useRef({ playing, onClip, index: -1 });
  live.current.playing = playing;
  live.current.onClip = onClip;

  // Outra versão: volta ao início.
  useEffect(() => {
    clock.resize(total);
    live.current.index = -1;
    if (live.current.playing) clock.play(0); else clock.seek(0);
  }, [clock, result]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (playing) clock.play(); else clock.pause(); }, [clock, playing]);

  // Em ciclo, e o clipe à vista para o ecrã do resultado.
  useEffect(() => clock.subscribe((t, on) => {
    if (!on && live.current.playing && t >= clock.total() - 0.02) { setTimeout(() => { if (live.current.playing) clock.play(0); }, 0); return; }
    const starts = result.starts;
    let i = starts.length - 1;
    for (let k = 0; k < starts.length; k++) if (t < starts[k] + (result.durations[k] ?? 0)) { i = k; break; }
    if (i !== live.current.index) { live.current.index = i; live.current.onClip?.(i); }
  }), [clock, result]);

  const origVol = musicUrl && result.music ? 0.5 : 1;
  const segs = useMemo(() => magicStageSegs(result), [result]);
  const overlays = useMemo(() => result.overlays.map(sanitizeOverlay).filter((o): o is Overlay => !!o), [result]);
  const mix = useMemo(() => magicPreviewMix(result), [result]);
  usePreviewAudio({ clock, musicUrl: musicUrl ?? null, mix, musicVol: 1, total, muteVoice: false, muted: false });

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox((b) => (Math.abs(b.w - width) < 0.5 && Math.abs(b.h - height) < 0.5 ? b : { w: width, h: height }));
  };
  return (
    <View style={[st.box, style]} onLayout={onLayout} accessibilityLabel={t('Pré-visualização da montagem')}>
      {box.w > 0 ? (
        <>
          <NativeStage segs={segs} clock={clock} W={box.w} H={box.h} origVol={origVol} pano={result.pano} refVolume={0} />
          <NativeOverlays overlays={overlays} clock={clock} W={box.w} H={box.h} selId={null} locked showSafe={false} onSelect={noop} onEdit={noop} onChange={noop} />
        </>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({ box: { aspectRatio: 9 / 16, backgroundColor: '#000', overflow: 'hidden' } });
