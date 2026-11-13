import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { useEffect, useRef } from 'react';
import { DUCK, fadeGain, SFX, type SfxId } from '@/lib/studio/audioDsp';
import { curveAt, duckPoints, type StudioMix } from '@/lib/studio/audioMix';
import { sfxFile } from '@/lib/studio/nativeAudio';
import { channelVolume, cuesBetween, drift, musicPosition, voicePosition } from '@/lib/studio/previewClock';
import type { ClockStore } from './clockStore';

const nowMs = () => Date.now();
function safeRemove(p: AudioPlayer | null) { try { p?.pause(); p?.remove(); } catch { /* já libertado */ } }

/** Toca um efeito sonoro já (o mesmo som que o servidor põe no vídeo). */
export function playSfx(id: SfxId, volume = 1) {
  const uri = sfxFile(id);
  if (!uri) return;
  try {
    const p = createAudioPlayer({ uri });
    p.volume = Math.max(0, Math.min(1, volume));
    p.play();
    const secs = SFX.find((s) => s.id === id)?.seconds ?? 2;
    setTimeout(() => safeRemove(p), (secs + 0.8) * 1000);
  } catch { /* sem som: não faz mal */ }
}

/**
 * O som da pré-visualização nativa, todo pelo relógio do projeto: a música (do trecho, em ciclo, com os fades e o ducking por
 * baixo da voz-off), a voz-off no sítio dela e os efeitos sonoros no instante deles. Com um efeito de voz (robô, eco…),
 * `voiceUri` é o som da voz-off já com o efeito (preparado no servidor, useVoicePreview.ts; os mesmos tempos da gravação);
 * enquanto não chega, ouve-se a voz normal.
 */
export function usePreviewAudio(o: { clock: ClockStore; musicUrl: string | null; mix: StudioMix; musicVol: number; total: number; muteVoice: boolean; muted: boolean; voiceUri?: string | null }) {
  const cfg = useRef(o);
  cfg.current = o;
  const music = useRef<AudioPlayer | null>(null);
  const voice = useRef<AudioPlayer | null>(null);
  const voiceUri = o.mix.voice ? o.voiceUri || o.mix.voice.uri || null : null;

  useEffect(() => {
    if (!o.musicUrl) return;
    let p: AudioPlayer | null = null;
    try { p = createAudioPlayer({ uri: o.musicUrl }); p.loop = false; } catch { p = null; }
    music.current = p;
    return () => { music.current = null; safeRemove(p); };
  }, [o.musicUrl]);
  useEffect(() => {
    if (!voiceUri) return;
    let p: AudioPlayer | null = null;
    try { p = createAudioPlayer({ uri: voiceUri }); } catch { p = null; }
    voice.current = p;
    return () => { voice.current = null; safeRemove(p); };
  }, [voiceUri]);

  useEffect(() => {
    let prevT = o.clock.time();
    const mem = { mSeek: 0, vSeek: 0, check: 0 };
    return o.clock.subscribe((t, playing) => {
      const c = cfg.current;
      const ms = nowMs();
      const back = t < prevT - 0.05 || t > prevT + 1.5;
      const from = prevT;
      prevT = t;
      // Os efeitos sonoros do bocado que passou (num salto para trás ou grande, nenhum).
      if (playing && !c.muted && !back) for (const s of cuesBetween(c.mix.sfx, from, t)) playSfx(s.id, c.mix.sfxVolume);
      if (playing && !back && ms - mem.check < 120) return;
      mem.check = ms;
      const v = c.mix.voice;
      const m = music.current;
      if (m) {
        try {
          const duck = v && c.mix.ducking && !c.muteVoice ? curveAt(duckPoints(v.regions.map((r) => ({ start: r.start + v.at, end: r.end + v.at })), c.total, DUCK), t) : 1;
          const vol = c.muted ? 0 : channelVolume(c.musicVol, fadeGain(t, c.total, c.mix.fadeIn, c.mix.fadeOut), duck);
          if (Math.abs(m.volume - vol) > 0.01) m.volume = vol;
          const pos = musicPosition(t, c.mix.musicStartMs, m.duration > 0 ? m.duration : null);
          if (playing) {
            if (!m.playing) { void m.seekTo(pos); m.play(); mem.mSeek = ms; }
            else if (back || (ms - mem.mSeek > 700 && drift(pos, m.currentTime, 1, 0.3) === 'seek')) { void m.seekTo(pos); mem.mSeek = ms; }
          } else if (m.playing) m.pause();
        } catch { /* a carregar */ }
      }
      const vp = voice.current;
      if (vp && v) {
        try {
          const pos = voicePosition(t, v, c.total);
          vp.volume = c.muted || c.muteVoice ? 0 : channelVolume(v.volume);
          if (playing && pos != null) {
            if (!vp.playing) { void vp.seekTo(pos); vp.play(); mem.vSeek = ms; }
            else if (back || (ms - mem.vSeek > 700 && drift(pos, vp.currentTime, 1, 0.3) === 'seek')) { void vp.seekTo(pos); mem.vSeek = ms; }
          } else if (vp.playing) vp.pause();
        } catch { /* a carregar */ }
      }
    });
  }, [o.clock]);

  /** A duração da música (s), quando já se sabe. */
  return { musicDuration: () => { try { return music.current?.duration ?? 0; } catch { return 0; } } };
}
