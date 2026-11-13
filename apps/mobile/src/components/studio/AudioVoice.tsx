import { createElement, useEffect, useRef, useState, type ReactNode } from 'react';
// Só no site (o estúdio nativo grava com components/studio/native/NativeVoice.tsx): o react-dom lê-se sem os tipos dele
// (os @types/react-dom podem não estar instalados) e este ficheiro nunca entra no bundle do telemóvel.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createPortal } = require('react-dom') as { createPortal: (children: ReactNode, container: Element) => ReactNode };
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { RangeSlider } from '@/components/RangeSlider';
import { beep, monoOf, sliceBuffer, voiceRecorderType, type StudioGraph } from '@/lib/studio/audioEngine';
import { peaks, voiceActivity, type VoiceTake } from '@/lib/studio/audioMix';
import { fmtS, MIN_VOICE_S } from '@/lib/tchekaRules';
import { colors } from '@/lib/theme';

const dom = createElement as (tag: string, props?: Record<string, unknown>, ...kids: unknown[]) => ReactNode;
const CORAL = colors.brand;
const mmss = (s: number) => { const v = Math.max(0, Math.floor(s)); return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`; };

/** O que a voz-off precisa do estúdio (a pré-visualização e o som). */
export interface VoiceCtl {
  graph(): StudioGraph | null;
  nowT(): number;
  total: number;
  play(from: number): void;
  pause(): void;
  /**
   * O modo de gravação da voz-off: a pré-visualização não grava o vídeo, não toca a voz antiga e pára no fim (`onEnd`).
   */
  voiceMode(on: boolean, onEnd?: () => void): void;
  /** Quando a pré-visualização arrancou de verdade (o relógio de `performance.now()`) e de que instante da tcheka. */
  startedAt(): { perf: number; from: number } | null;
}

type Phase = 'idle' | 'asking' | 'count' | 'rec' | 'saving';

/** Desenha uma onda (picos de 0 a 1) num canvas, em barras simétricas. */
export function drawPeaks(c: HTMLCanvasElement | null, data: ArrayLike<number>, color: string | CanvasGradient | ((g: CanvasRenderingContext2D, w: number) => string | CanvasGradient), opts: { bar?: number; gap?: number } = {}) {
  const g = c?.getContext('2d');
  if (!c || !g) return;
  const w = c.clientWidth, h = c.clientHeight;
  if (!w || !h) return;
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const bar = opts.bar ?? 2, gap = opts.gap ?? 2;
  const n = Math.floor(w / (bar + gap));
  g.fillStyle = typeof color === 'function' ? color(g, w) : color;
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i / n) * data.length), b = Math.max(a + 1, Math.floor(((i + 1) / n) * data.length));
    let p = 0;
    for (let k = a; k < b && k < data.length; k++) p = Math.max(p, data[k]);
    const bh = Math.max(2, p * (h - 4));
    g.fillRect(i * (bar + gap), (h - bh) / 2, bar, bh);
  }
}

/** Onde está a pré-visualização no ecrã (o canvas da montagem), para o foco da gravação. */
function previewBox(): { left: number; top: number; width: number; height: number } | null {
  const el = typeof document !== 'undefined' ? document.querySelector('canvas[aria-label="Pré-visualização da tcheka"]') : null;
  const p = (el?.parentElement ?? el) as HTMLElement | null;
  if (!p) return null;
  const r = p.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? { left: r.left, top: r.top, width: r.width, height: r.height } : null;
}

const coralGrad = (g: CanvasRenderingContext2D, w: number) => { const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, '#ff6b81'); gr.addColorStop(1, CORAL); return gr; };

/**
 * A voz-off: gravar a narração com o microfone por cima da pré-visualização a tocar, com contagem 3-2-1. O microfone só
 * se liga ao carregar em gravar e desliga-se logo ao parar (ou ao sair). Depois: a onda, regravar, apagar e o volume.
 * O atraso do som (colunas e microfone) é descontado, para a voz ficar no sítio certo.
 */
export function AudioVoice({ ctl, take, onTake, onVolume, onDelete, locked }: {
  ctl: VoiceCtl;
  take: VoiceTake | null;
  onTake: (t: VoiceTake) => void;
  onVolume: (v: number) => void;
  onDelete: () => void;
  locked: boolean;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [count, setCount] = useState(3);
  const [elapsed, setElapsed] = useState(0);
  const [err, setErr] = useState('');
  const live = useRef<{ stream: MediaStream; rec: MediaRecorder | null; src: MediaStreamAudioSourceNode | null; an: AnalyserNode | null; cancel: boolean; from: number; delay: number; recAt: number; raf: number; chunks: Blob[]; stop?: () => void } | null>(null);
  const liveCanvas = useRef<HTMLCanvasElement | null>(null);
  const takeCanvas = useRef<HTMLCanvasElement | null>(null);
  const history = useRef<number[]>([]);
  const alive = useRef(true);
  const ctlRef = useRef(ctl);
  ctlRef.current = ctl;

  /** Larga o microfone (e tudo o que estava a ouvi-lo). */
  const release = () => {
    const l = live.current;
    if (!l) return;
    cancelAnimationFrame(l.raf);
    l.stream.getTracks().forEach((t) => t.stop());
    try { l.src?.disconnect(); } catch { /* já desligado */ }
    live.current = null;
  };
  useEffect(() => () => {
    alive.current = false;
    const l = live.current;
    if (l) { l.cancel = true; try { if (l.rec?.state === 'recording') l.rec.stop(); } catch { /* já parou */ } }
    release();
    ctlRef.current.voiceMode(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (take) drawPeaks(takeCanvas.current, take.peaks, coralGrad); }, [take]);

  async function start() {
    if (locked || phase !== 'idle') return;
    setErr('');
    const g = ctl.graph();
    if (!g || typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) { setErr('Este browser não deixa gravar a voz'); return; }
    setPhase('asking');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch {
      if (alive.current) { setPhase('idle'); setErr('Sem acesso ao microfone. Dá licença ao Txillapp nas definições do browser.'); }
      return;
    }
    if (!alive.current) { stream.getTracks().forEach((t) => t.stop()); return; }
    let from = ctl.nowT();
    if (from >= ctl.total - 1) from = 0;
    ctl.pause();
    live.current = { stream, rec: null, src: null, an: null, cancel: false, from, delay: 0, recAt: 0, raf: 0, chunks: [] };
    if (g.ac.state !== 'running') await g.ac.resume().catch(() => undefined);
    // 3-2-1, com um bip em cada número (só nas colunas).
    setPhase('count');
    for (const n of [3, 2, 1]) {
      setCount(n);
      beep(g.ac, 880);
      await new Promise((r) => setTimeout(r, 1000));
      if (!live.current || live.current.cancel) { release(); if (alive.current) setPhase('idle'); return; }
    }
    beep(g.ac, 1320, 0.14);
    const l = live.current;
    // A onda ao vivo (o microfone não vai às colunas: nada de eco).
    try {
      l.src = g.ac.createMediaStreamSource(stream);
      l.an = g.ac.createAnalyser();
      l.an.fftSize = 1024;
      l.src.connect(l.an);
    } catch { l.src = null; l.an = null; }
    const type = voiceRecorderType();
    let rec: MediaRecorder;
    try { rec = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 128_000 } : undefined); } catch { release(); setPhase('idle'); setErr('Não consegui gravar a voz'); return; }
    l.rec = rec;
    rec.ondataavailable = (e) => { if (e.data.size) l.chunks.push(e.data); };
    const done = new Promise<Blob>((res) => { rec.onstop = () => res(new Blob(l.chunks, { type: (rec.mimeType || type || 'audio/webm').split(';')[0] })); });
    history.current = [];
    const t0 = performance.now();
    rec.onstart = () => { l.recAt = performance.now(); l.delay = (l.recAt - t0) / 1000; };
    l.stop = () => void finish(done);
    ctl.voiceMode(true, () => l.stop?.());
    ctl.play(from);
    rec.start(250);
    setPhase('rec');
    setElapsed(0);
    const buf = new Float32Array(1024);
    const tick = () => {
      if (!live.current) return;
      const secs = (performance.now() - t0) / 1000;
      setElapsed(secs);
      if (l.an) {
        l.an.getFloatTimeDomainData(buf);
        let m = 0;
        for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i]));
        history.current.push(Math.min(1, m * 1.6));
        if (history.current.length > 240) history.current.shift();
        drawPeaks(liveCanvas.current, history.current, '#fff', { bar: 3, gap: 2 });
      }
      l.raf = requestAnimationFrame(tick);
    };
    l.raf = requestAnimationFrame(tick);
  }

  async function finish(done: Promise<Blob>) {
    const l = live.current;
    if (!l || !l.rec) return;
    l.stop = undefined;
    const rec = l.rec;
    const settings = l.stream.getAudioTracks()[0]?.getSettings() as (MediaTrackSettings & { latency?: number }) | undefined;
    try { if (rec.state === 'recording') rec.stop(); } catch { /* já parou */ }
    ctl.voiceMode(false);
    ctl.pause();
    const blob = await done;
    const { from, delay, cancel, recAt } = l;
    const started = ctl.startedAt();
    release(); // o microfone desliga-se aqui
    if (!alive.current) return;
    if (cancel) { setPhase('idle'); return; }
    setPhase('saving');
    const g = ctl.graph();
    try {
      if (!g || !blob.size) throw new Error('vazio');
      let buf = await g.ac.decodeAudioData(await blob.arrayBuffer());
      // A voz entra onde estava o que se ouviu: o instante da tcheka quando o gravador arrancou (pelo relógio da
      // pré-visualização), menos o atraso das colunas e do microfone.
      const lat = (g.ac.outputLatency || 0) + (g.ac.baseLatency || 0) + (settings?.latency || 0);
      const recFrom = started && recAt && started.from === from ? from + (recAt - started.perf) / 1000 : from + delay;
      let at = recFrom - lat;
      const skip = at < 0 ? -at : 0;
      if (at < 0) { buf = sliceBuffer(g.ac, buf, -at); at = 0; }
      if (buf.duration < 0.4) throw new Error('curta');
      const mono = monoOf(buf);
      const id = `v${Date.now().toString(36)}`;
      // A gravação anterior fica em memória: desfazer pode trazê-la de volta.
      g.voiceBufs.set(id, buf);
      onTake({
        id,
        at: Math.round(at * 1000) / 1000,
        duration: Math.round(buf.duration * 1000) / 1000,
        volume: take?.volume ?? 1,
        fx: take?.fx ?? 'normal',
        regions: voiceActivity(mono, buf.sampleRate),
        peaks: peaks(mono, Math.min(900, Math.max(40, Math.round(buf.duration * 50)))),
        // O ficheiro fica para o rascunho (ao abri-lo volta a ler-se e a cortar-se igual).
        uri: URL.createObjectURL(blob),
        mime: blob.type || 'audio/webm',
        ...(skip > 0 ? { skip: Math.round(skip * 1000) / 1000 } : {}),
      });
      setPhase('idle');
    } catch {
      setPhase('idle');
      setErr('A gravação ficou vazia ou curta demais. Tenta outra vez.');
    }
  }

  const stopNow = () => live.current?.stop?.();
  const cancelNow = () => { const l = live.current; if (!l) return; l.cancel = true; if (l.stop) l.stop(); };

  const hud = phase === 'count' || phase === 'rec' || phase === 'asking';
  const limit = Math.max(0, ctl.total - (live.current?.from ?? 0));
  // A gravar: um «foco» na pré-visualização (a sombra enorme escurece o resto do ecrã, em qualquer largura); os controlos
  // ficam por cima e por baixo dela.
  const box = phase === 'rec' ? previewBox() : null;
  const overlay = hud && typeof document !== 'undefined' ? createPortal(
    (dom('div', { style: { position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', ...(box
        ? { background: 'transparent' }
        : { background: 'radial-gradient(circle at 50% 45%, rgba(40,6,14,0.78) 0%, rgba(0,0,0,0.9) 70%)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }) } },
      box ? dom('div', { key: 'spot', 'aria-hidden': true, style: { position: 'absolute', left: box.left, top: box.top, width: box.width, height: box.height, borderRadius: 20, boxShadow: '0 0 0 200vmax rgba(0,0,0,0.94), 0 0 40px 6px rgba(214,51,79,0.55)', border: `2px solid ${CORAL}`, pointerEvents: 'none' } }) : null,
      <View style={[st.hudTop, box && { position: 'absolute', left: 0, right: 0, top: Math.max(6, box.top - 52), paddingTop: 0 }]} key="top">
        {phase === 'rec' ? (
          <View style={st.recPill} accessibilityLiveRegion="polite">
            <View style={st.recDot} />
            <Text style={st.recText}>A gravar · {mmss(elapsed)} / {mmss(limit)}</Text>
          </View>
        ) : <Text style={st.hudHint}>{phase === 'asking' ? 'A pedir o microfone…' : 'Prepara-te para falar'}</Text>}
        {box ? null : <Text style={st.hudSub}>Usa auscultadores: assim a música não entra na voz</Text>}
      </View>,
      phase === 'count' ? (
        <View style={st.countWrap} key="count" pointerEvents="none">
          <View style={st.countRing}><Text style={st.countText} accessibilityLiveRegion="assertive">{count}</Text></View>
        </View>
      ) : <View key="mid" />,
      <View style={[st.hudBottom, box && { position: 'absolute', left: 0, right: 0, top: box.top + box.height + 14, paddingBottom: 0 }]} key="bottom">
        {phase === 'rec' ? dom('canvas', { ref: (el: HTMLCanvasElement | null) => { liveCanvas.current = el; }, style: { width: '100%', maxWidth: 520, height: 46, display: 'block', margin: '0 auto' }, 'aria-hidden': true }) : null}
        {phase === 'rec' ? (
          <View style={st.hudBtns}>
            <Pressable onPress={cancelNow} style={st.hudCancel} accessibilityRole="button" accessibilityLabel="Cancelar a gravação"><Text style={st.hudCancelText}>Cancelar</Text></Pressable>
            <Pressable onPress={stopNow} style={st.stopBtn} accessibilityRole="button" accessibilityLabel="Parar a gravação da voz-off">
              <View style={st.stopSquare} />
            </Pressable>
            <View style={{ width: 86 }} />
          </View>
        ) : (
          <Pressable onPress={cancelNow} style={[st.hudCancel, { alignSelf: 'center' }]} accessibilityRole="button" accessibilityLabel="Cancelar a gravação"><Text style={st.hudCancelText}>Cancelar</Text></Pressable>
        )}
        {box ? <Text style={[st.hudSub, { textAlign: 'center' }]}>Usa auscultadores: assim a música não entra na voz</Text> : null}
      </View>,
    )) as ReactNode,
    document.body,
  ) : null;

  const hasVoiceSound = !!take && take.duration >= MIN_VOICE_S;
  return (
    <View style={{ paddingBottom: 6 }}>
      {overlay}
      {!take ? (
        <View style={st.empty}>
          <Pressable onPress={() => void start()} disabled={locked || phase !== 'idle'} style={({ pressed }) => [st.micBig, pressed && { transform: [{ scale: 0.95 }] }]} accessibilityRole="button" accessibilityLabel="Gravar voz-off">
            <Icon name="mic" size={30} color="#fff" strokeWidth={2.2} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={st.title}>Gravar voz-off</Text>
            <Text style={st.sub}>Fala por cima da tcheka a tocar, a partir de {mmss(ctl.nowT() >= ctl.total - 1 ? 0 : ctl.nowT())}. Contagem de 3 s antes de começar.</Text>
            <Text style={st.sub}>Com {MIN_VOICE_S} s ou mais, a voz-off conta como o som da tcheka.</Text>
          </View>
        </View>
      ) : (
        <View style={st.takeCard}>
          <View style={st.takeHead}>
            <View style={st.badge}><Icon name="mic" size={14} color="#fff" strokeWidth={2.2} /></View>
            <View style={{ flex: 1 }}>
              <Text style={st.title}>Voz-off · {fmtS(take.duration)} s</Text>
              <Text style={st.sub}>Entra aos {fmtS(take.at)} s{hasVoiceSound ? ' · conta como som' : ` · grava ${MIN_VOICE_S} s para contar como som`}</Text>
            </View>
            <Pressable onPress={() => { ctl.play(take.at); }} disabled={locked} style={st.iconBtn} accessibilityRole="button" accessibilityLabel="Ouvir a voz-off"><Icon name="play" size={16} color="#fff" solid /></Pressable>
            <Pressable onPress={() => void start()} disabled={locked || phase !== 'idle'} style={st.iconBtn} accessibilityRole="button" accessibilityLabel="Regravar a voz-off"><Icon name="repeat" size={16} color="#fff" strokeWidth={2.2} /></Pressable>
            <Pressable onPress={onDelete} disabled={locked} style={st.iconBtn} accessibilityRole="button" accessibilityLabel="Apagar a voz-off"><Icon name="trash" size={16} color="#fecaca" strokeWidth={2.2} /></Pressable>
          </View>
          {dom('canvas', { ref: (el: HTMLCanvasElement | null) => { takeCanvas.current = el; if (el && take) requestAnimationFrame(() => drawPeaks(el, take.peaks, coralGrad)); }, style: { width: 'calc(100% - 28px)', height: 44, display: 'block', margin: '6px 14px 0' }, 'aria-label': 'Onda da voz-off' })}
          <View style={st.volRow}>
            <Text style={st.volLabel}>Volume</Text>
            <View style={{ flex: 1 }}>
              <RangeSlider label="Volume da voz-off" value={Math.round(take.volume * 100)} min={0} max={100} step={5} format={(v) => `${v}%`} onChange={(v) => onVolume(v / 100)} />
            </View>
            <Text style={st.volVal}>{Math.round(take.volume * 100)}%</Text>
          </View>
        </View>
      )}
      {phase === 'saving' ? <Text style={st.info}>A preparar a voz…</Text> : null}
      {err ? <Text style={st.err} accessibilityRole="alert">{err}</Text> : null}
    </View>
  );
}

const st = StyleSheet.create({
  empty: { flexDirection: 'row', alignItems: 'center', gap: 14, marginHorizontal: 16, marginTop: 10, borderRadius: 18, padding: 14, backgroundColor: 'rgba(214,51,79,0.10)', borderWidth: 1, borderColor: 'rgba(214,51,79,0.35)' },
  micBig: { width: 64, height: 64, borderRadius: 32, backgroundColor: CORAL, alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 0 6px rgba(214,51,79,0.22), 0 0 28px rgba(214,51,79,0.6)' },
  title: { color: '#fff', fontSize: 15, fontWeight: '800' },
  sub: { color: 'rgba(255,255,255,0.65)', fontSize: 14, marginTop: 2 },
  takeCard: { marginHorizontal: 16, marginTop: 8, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', paddingVertical: 10 },
  takeHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14 },
  badge: { width: 28, height: 28, borderRadius: 14, backgroundColor: CORAL, alignItems: 'center', justifyContent: 'center' },
  iconBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  volRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, marginTop: 4 },
  volLabel: { color: '#fff', fontSize: 14, fontWeight: '700', width: 58 },
  volVal: { color: 'rgba(255,255,255,0.75)', fontSize: 14, fontWeight: '700', width: 40, textAlign: 'right' },
  info: { color: 'rgba(255,255,255,0.7)', fontSize: 14, textAlign: 'center', marginTop: 6 },
  err: { color: '#fecaca', fontSize: 14, textAlign: 'center', marginTop: 6, paddingHorizontal: 16 },
  hudTop: { alignItems: 'center', paddingTop: 22, paddingHorizontal: 16, gap: 6 },
  hudHint: { color: '#fff', fontSize: 16, fontWeight: '800' },
  hudSub: { color: 'rgba(255,255,255,0.7)', fontSize: 14 },
  recPill: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999, backgroundColor: '#14060a', borderWidth: 1, borderColor: 'rgba(214,51,79,0.7)', paddingHorizontal: 14, paddingVertical: 7 },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: CORAL, boxShadow: '0 0 10px rgba(255,80,100,0.9)' },
  recText: { color: '#fff', fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },
  countWrap: { alignItems: 'center', justifyContent: 'center' },
  countRing: { width: 148, height: 148, borderRadius: 74, borderWidth: 4, borderColor: CORAL, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(214,51,79,0.16)', boxShadow: '0 0 60px rgba(214,51,79,0.7)' },
  countText: { color: '#fff', fontSize: 84, fontWeight: '900', fontVariant: ['tabular-nums'] },
  hudBottom: { paddingBottom: 34, paddingHorizontal: 20, gap: 14 },
  hudBtns: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', maxWidth: 520, width: '100%', alignSelf: 'center' },
  hudCancel: { width: 86, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  hudCancelText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  stopBtn: { width: 78, height: 78, borderRadius: 39, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(214,51,79,0.35)' },
  stopSquare: { width: 28, height: 28, borderRadius: 6, backgroundColor: CORAL },
});
