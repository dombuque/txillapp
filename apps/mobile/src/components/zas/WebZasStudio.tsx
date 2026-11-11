import { createElement, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, Text, TextInput, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@/lib/theme';
import { Icon } from '../Icon';
import { acquireCamera, releaseCamera } from './cameraSession';
import { CurvedCaption } from './CurvedCaption';
import { FUN_FX, createFunRenderer, type FunRenderer } from './funFilters';
import { squircle } from './squircle';
import { ZAS_ASPECT, coverBox, coverCrop, inCaptionZone, isTap, outSize, pinchZoom, roundCrop, tapToSource, zasCardSize } from './zasFrame';

/**
 * A câmara ao vivo dos Zás NA WEB (getUserMedia + <video>/<canvas> dentro do React Native Web), igual ao CameraStudio do site:
 * cartão 3:4 squircle com legenda curva, filtros divertidos em WebGL (deslizar para os lados), flash/lanterna, virar câmara,
 * temporizador (a lógica existe como no site; o site não tem botão), obturador com anel degradê e «para quem vai».
 * Só deve ser montado quando Platform.OS === 'web'. Devolve a foto (JPEG) em `onCapture`.
 *
 * A imagem enche SEMPRE a forma: o <video> não fica entregue ao `object-fit` (o Safari do iPhone não o recalcula quando a
 * câmara muda de formato depois de começar, ou quando roda a imagem, e a imagem ficava encolhida dentro da forma). Em vez
 * disso o tamanho e a posição do vídeo são calculados aqui (zasFrame.coverBox) com as medidas reais da câmara, lidas no
 * `loadedmetadata` e em cada `resize`. A foto é recortada com as mesmas contas (zasFrame.coverCrop): sai o que se viu.
 */
export type StudioProps = {
  caption: string;
  onCaption: (s: string) => void;
  audience: 'friends' | 'close';
  onAudience: (a: 'friends' | 'close') => void;
  busy: boolean;
  err: string;
  editing: boolean;
  onEditing: (b: boolean) => void;
  onCapture: (blob: Blob) => void;
  /** O aviso «Zás enviado! / Desfazer», pousado por cima dos controlos. */
  sentBox: ReactNode;
};

const buzz = (ms: number) => {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* sem vibração */
  }
};
const dom = createElement as (tag: string, props?: Record<string, unknown>, ...kids: unknown[]) => ReactNode;
const web = (o: Record<string, unknown>) => o as never;
const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

type FocusCaps = { focusMode?: string[] };
/** Foco num ponto: só onde o browser e a câmara o deixam (Chrome no Android, em muitos aparelhos). */
function focusSupport(t: MediaStreamTrack | undefined): string | null {
  try {
    const sup = navigator.mediaDevices?.getSupportedConstraints?.() as Record<string, boolean> | undefined;
    if (!t || !sup?.pointsOfInterest) return null;
    const modes = ((t.getCapabilities?.() ?? {}) as FocusCaps).focusMode ?? [];
    return modes.includes('single-shot') ? 'single-shot' : modes.includes('continuous') ? 'continuous' : null;
  } catch {
    return null;
  }
}

function FlashIcon({ on, size }: { on: boolean; size: number }) {
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="bolt" size={size} solid={on} color={on ? colors.zinc900 : '#fff'} />
      {!on && <View pointerEvents="none" style={{ position: 'absolute', height: 2, borderRadius: 1, width: size * 1.3, backgroundColor: '#fff', transform: [{ rotate: '-45deg' }] }} />}
    </View>
  );
}

export function WebZasStudio({ caption, onCaption, audience, onAudience, busy, err, editing, onEditing, onCapture, sentBox }: StudioProps) {
  const insets = useSafeAreaInsets();
  const video = useRef<HTMLVideoElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const fxCanvas = useRef<HTMLCanvasElement | null>(null);
  const fxRenderer = useRef<FunRenderer | null>(null);
  const swipe = useRef<{ x: number; y: number; t: number } | null>(null);
  const pinch = useRef<{ d0: number; z0: number } | null>(null);
  const countTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const [area, setArea] = useState({ w: 0, h: 0 });
  const [facing, setFacing] = useState<'user' | 'environment'>('environment');
  // Ligar outra vez (voltar do segundo plano: a câmara desliga-se quando a página fica escondida).
  const [session, setSession] = useState(0);
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState(false);
  // Medidas reais da imagem da câmara (mudam quando o aparelho troca o formato ou o iPhone roda a imagem).
  const [vdim, setVdim] = useState({ w: 0, h: 0 });
  const [vkey, setVkey] = useState(0);
  // Zoom digital da pinça: o mesmo na pré-visualização e no recorte da foto.
  const [zoom, setZoom] = useState(1);
  const [focusRing, setFocusRing] = useState<{ x: number; y: number; n: number } | null>(null);
  const [flash, setFlash] = useState(false);
  const [light, setLight] = useState(false);
  const [canTorch, setCanTorch] = useState(false);
  const [lit, setLit] = useState(false);
  const [delay] = useState<0 | 3 | 10>(0);
  const [count, setCount] = useState<number | null>(null);
  const [fx, setFx] = useState(0);
  const [fxOk, setFxOk] = useState(true);
  const [shooting, setShooting] = useState(false);
  const cycleFx = (dir: 1 | -1) => setFx((f) => (f + dir + FUN_FX.length) % FUN_FX.length);

  // Filtros em direto: o canvas mostra o resultado e é dele que sai a foto.
  useEffect(() => {
    if (!ready || fx === 0 || !fxCanvas.current) return;
    fxRenderer.current ??= createFunRenderer(fxCanvas.current);
    const r = fxRenderer.current;
    if (!r) {
      setFxOk(false);
      setFx(0);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const loop = () => {
      if (video.current) r.render(video.current, fx, (performance.now() - t0) / 1000);
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [ready, fx]);
  useEffect(() => () => fxRenderer.current?.dispose(), []);

  /** Lê as medidas da imagem; se ela rodar (deitada ↔ ao alto), monta o <video> de novo (o Safari fica com a forma velha). */
  const readDims = () => {
    const v = video.current;
    if (!v || !v.videoWidth || !v.videoHeight) return;
    setVdim((d) => {
      if (d.w === v.videoWidth && d.h === v.videoHeight) return d;
      if (d.w && (d.w > d.h) !== (v.videoWidth > v.videoHeight)) setVkey((k) => k + 1);
      return { w: v.videoWidth, h: v.videoHeight };
    });
  };
  /** Liga o stream ao <video> (também quando o <video> é montado de novo). Sem som e em linha, para o iPhone o tocar. */
  const attach = useRef((el: HTMLVideoElement | null) => {
    video.current = el;
    const s = stream.current;
    if (!el || !s || el.srcObject === s) return;
    el.muted = true;
    el.setAttribute('playsinline', '');
    el.setAttribute('webkit-playsinline', '');
    el.srcObject = s;
    void el.play().catch(() => undefined);
  }).current;

  useEffect(() => {
    let dead = false;
    setReady(false);
    setProblem(false);
    setZoom(1);
    setFocusRing(null);
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('sem câmara');
        // Pede 3:4 ao alto e insiste ANTES de mostrar (cameraSession.fixPortrait): mudar o formato depois de começar era
        // o que fazia a imagem saltar de tamanho. Se o aparelho não der 3:4, o corte "cover" trata do resto.
        const s = await acquireCamera(facing, false, true);
        if (dead) return;
        stream.current = s;
        const v = video.current;
        if (v && v.srcObject !== s) {
          v.muted = true;
          v.setAttribute('playsinline', '');
          v.srcObject = s;
        }
        await v?.play().catch(() => undefined);
        if (dead) return;
        const vt = s.getVideoTracks()[0];
        const caps = (vt?.getCapabilities?.() ?? {}) as { torch?: boolean };
        setCanTorch(!!caps.torch);
        // Se a câmara for desligada por fora (outra app, o sistema), liga-se outra vez.
        if (vt) vt.onended = () => { if (!dead && document.visibilityState === 'visible') setSession((n) => n + 1); };
        readDims();
        setLight(false);
        setReady(true);
      } catch {
        if (!dead) setProblem(true);
      }
    })();
    return () => {
      dead = true;
    };
  }, [facing, session]); // eslint-disable-line react-hooks/exhaustive-deps
  // Voltar do segundo plano: a câmara foi desligada (cameraSession); liga-se outra vez.
  useEffect(() => {
    const on = () => {
      if (document.visibilityState !== 'visible') return;
      const alive = stream.current?.getVideoTracks().some((t) => t.readyState === 'live');
      if (!alive) setSession((n) => n + 1);
    };
    document.addEventListener('visibilitychange', on);
    window.addEventListener('pageshow', on);
    return () => {
      document.removeEventListener('visibilitychange', on);
      window.removeEventListener('pageshow', on);
    };
  }, []);
  useEffect(() => () => { releaseCamera(2_000); clearInterval(countTimer.current); }, []);

  async function shoot() {
    const v = video.current;
    if (!v || !ready || !v.videoWidth || busy || shooting) return;
    setShooting(true);
    // Flash ao obturar: lanterna (câmara de trás, se o aparelho deixar) ou o ecrã todo aceso (câmara da frente).
    const vtrack = (v.srcObject as MediaStream | null)?.getVideoTracks()[0];
    let torchOn = false;
    if (light) {
      if (canTorch && vtrack) {
        try {
          await vtrack.applyConstraints({ advanced: [{ torch: true } as MediaTrackConstraintSet] });
          torchOn = true;
        } catch {
          /* sem lanterna: acende o ecrã */
        }
      }
      if (!torchOn) setLit(true);
      await new Promise((r) => setTimeout(r, 420));
    }
    const fxc = fx > 0 && fxCanvas.current && fxCanvas.current.width > 0 ? fxCanvas.current : null;
    if (fxc && fxRenderer.current) fxRenderer.current.render(v, fx, performance.now() / 1000);
    const src: CanvasImageSource = fxc ?? v;
    const sw = fxc ? fxc.width : v.videoWidth;
    const sh = fxc ? fxc.height : v.videoHeight;
    // A parte que se via na forma (o mesmo corte "cover" e o mesmo zoom), em 3:4 e até 1080 × 1440.
    const crop = roundCrop(coverCrop(sw, sh, ZAS_ASPECT, zoom), sw, sh);
    // Com muito zoom o recorte fica pequeno: amplia-se até 720 de largura (o Zás não sai minúsculo).
    const o = outSize(crop.sw, crop.sh, undefined, 720);
    const c = document.createElement('canvas');
    c.width = o.w;
    c.height = o.h;
    const g = c.getContext('2d')!;
    g.imageSmoothingQuality = 'high';
    // Selfie: a foto sai como a viste no ecrã (espelhada). O corte é centrado, por isso espelhar não o mexe.
    if (facing === 'user') {
      g.translate(c.width, 0);
      g.scale(-1, 1);
    }
    g.drawImage(src, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, o.w, o.h);
    setLit(false);
    if (torchOn && vtrack) vtrack.applyConstraints({ advanced: [{ torch: false } as MediaTrackConstraintSet] }).catch(() => undefined);
    buzz(15);
    setFlash(true);
    setTimeout(() => setFlash(false), 160);
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', 0.9));
    setShooting(false);
    if (blob) onCapture(blob);
  }
  /** Obturador: com temporizador faz a contagem e só depois tira; tocar outra vez cancela. */
  function press() {
    if (count !== null) {
      clearInterval(countTimer.current);
      return setCount(null);
    }
    if (!delay) return void shoot();
    let n: number = delay;
    setCount(n);
    countTimer.current = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(countTimer.current);
        setCount(null);
        void shoot();
      } else setCount(n);
    }, 1000);
  }

  // Cartão 3:4 (0,75 exata): até 440 de altura; a editar, ocupa a área toda (e a imagem continua a cobri-la).
  const padX = editing ? 8 : 32;
  let cw: number;
  let ch: number;
  if (editing) {
    cw = Math.floor(Math.max(0, area.w - padX * 2));
    ch = Math.floor(Math.max(0, area.h - 16));
  } else ({ w: cw, h: ch } = zasCardSize(area.w, area.h - 16, 440, padX));
  const mirror = facing === 'user' ? 'scaleX(-1)' : 'none';
  // Onde fica a imagem: cobre o cartão todo, centrada, com a proporção real da câmara (sem depender do object-fit).
  const box = coverBox(cw, ch, vdim.w, vdim.h, zoom);
  const fill = { position: 'absolute', left: box.left, top: box.top, width: box.width, height: box.height, maxWidth: 'none', objectFit: 'cover', transformOrigin: 'center center' };
  const small = { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' } as const;

  /** Tocar para focar (onde o browser deixa): o ponto do toque passado para a imagem da câmara. */
  function focusTap(x: number, y: number) {
    if (!ready || editing || inCaptionZone(y, ch)) return;
    const t = stream.current?.getVideoTracks()[0];
    const mode = focusSupport(t);
    const p = tapToSource(x, y, cw, ch, vdim.w, vdim.h, zoom, facing === 'user');
    if (!t || !mode || !p) return;
    t.applyConstraints({ advanced: [{ pointsOfInterest: [p], focusMode: mode } as unknown as MediaTrackConstraintSet] }).catch(() => undefined);
    buzz(5);
    setFocusRing((r) => ({ x, y, n: (r?.n ?? 0) + 1 }));
  }
  useEffect(() => {
    if (!focusRing) return;
    const t = setTimeout(() => setFocusRing(null), 900);
    return () => clearTimeout(t);
  }, [focusRing]);

  return (
    <>
      {/* A câmara: um cartão 3:4 de cantos bem redondos. A legenda fica dentro, afastada das curvas. */}
      <View onLayout={(e: LayoutChangeEvent) => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })} style={{ flex: 1, minHeight: 0, width: '100%', alignItems: 'center', justifyContent: 'center', paddingVertical: 8 }}>
        {cw > 0 && ch > 0 && (
          <View style={web({ width: cw, height: ch, filter: 'drop-shadow(0 18px 36px rgba(255,92,92,0.3))' })}>
            {dom(
              'div',
              {
                style: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#18181b', touchAction: 'pan-y', ...(squircle(cw) as object) },
                onTouchStart: (e: TouchEvent) => {
                  if (e.touches.length >= 2) {
                    swipe.current = null;
                    if (ready && !editing) pinch.current = { d0: Math.max(1, dist(e.touches)), z0: zoom };
                    return;
                  }
                  swipe.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
                },
                onTouchMove: (e: TouchEvent) => {
                  const p = pinch.current;
                  if (p && e.touches.length >= 2) setZoom(pinchZoom(p.z0, dist(e.touches) / p.d0));
                },
                onTouchEnd: (e: TouchEvent) => {
                  if (pinch.current) {
                    if (e.touches.length < 2) pinch.current = null;
                    return;
                  }
                  const s = swipe.current;
                  swipe.current = null;
                  if (!s || editing || !ready) return;
                  const dx = e.changedTouches[0].clientX - s.x;
                  const dy = e.changedTouches[0].clientY - s.y;
                  if (fxOk && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
                    buzz(6);
                    cycleFx(dx < 0 ? 1 : -1);
                    return;
                  }
                  if (isTap(dx, dy, Date.now() - s.t)) {
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    focusTap(e.changedTouches[0].clientX - r.left, e.changedTouches[0].clientY - r.top);
                  }
                },
              },
              dom('video', { key: `v${vkey}`, ref: attach, playsInline: true, muted: true, autoPlay: true, disablePictureInPicture: true, onLoadedMetadata: readDims, onResize: readDims, onPlaying: readDims, style: { ...fill, transform: mirror, visibility: ready ? 'visible' : 'hidden' } }),
              dom('canvas', { ref: fxCanvas, 'aria-hidden': true, style: { ...fill, transform: mirror, display: fx > 0 ? 'block' : 'none' } }),
              editing && <View key="dim" pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)' }} />,
              ready && fxOk && !editing && (
                <View key="dots" pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 12, zIndex: 10, flexDirection: 'row', justifyContent: 'center', gap: 4 }}>
                  {FUN_FX.map((f) => <View key={f.id} style={{ height: 6, width: fx === f.id ? 16 : 6, borderRadius: 3, backgroundColor: fx === f.id ? '#fff' : 'rgba(255,255,255,0.4)' }} />)}
                </View>
              ),
              zoom > 1.05 && !editing && (
                <View key="zoom" pointerEvents="none" style={{ position: 'absolute', alignSelf: 'center', bottom: 28, zIndex: 10, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 10, paddingVertical: 4 }}>
                  <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>{zoom.toFixed(1).replace('.', ',')}×</Text>
                </View>
              ),
              focusRing && (
                <View key={`ring${focusRing.n}`} pointerEvents="none" style={web({ position: 'absolute', zIndex: 10, left: focusRing.x - 32, top: focusRing.y - 32, width: 64, height: 64, borderRadius: 32, borderWidth: 2, borderColor: '#fcd34d', animationKeyframes: [{ '0%': { opacity: 0, transform: [{ scale: 1.4 }] }, '25%': { opacity: 1, transform: [{ scale: 1 }] }, '100%': { opacity: 0, transform: [{ scale: 0.95 }] } }], animationDuration: '900ms', animationFillMode: 'forwards' })} />
              ),
              count !== null && (
                <View key="count" pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, zIndex: 10, alignItems: 'center', justifyContent: 'center' }}>
                  <Text accessibilityLiveRegion="assertive" style={web({ fontSize: 120, fontWeight: '900', color: '#fff', textShadow: '0 4px 20px rgba(0,0,0,0.6)' })}>{count}</Text>
                </View>
              ),
              !ready && (
                <View key="wait" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 48 }}>
                  <Text style={{ textAlign: 'center', fontSize: 16, color: 'rgba(255,255,255,0.8)' }}>{problem ? 'Não consegui abrir a câmara. Os Zás só se mandam na hora.' : 'A acordar a câmara…'}</Text>
                </View>
              ),
              flash && <View key="flash" pointerEvents="none" style={web({ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, zIndex: 11, backgroundColor: '#fff', animationKeyframes: [{ '0%': { opacity: 0.95 }, '100%': { opacity: 0 } }], animationDuration: '160ms', animationFillMode: 'forwards' })} />,
              <View key="shade" pointerEvents="none" style={web({ position: 'absolute', left: 0, right: 0, bottom: 0, height: 112, backgroundImage: 'linear-gradient(to top, rgba(0,0,0,0.45), transparent)' })} />,
              (caption || editing) && <CurvedCaption key="cap" w={cw} h={ch} text={caption || 'Adicionar legenda…'} hint={!caption} caret={editing} caretFirst={!caption} />,
              <TextInput
                key="inp"
                value={caption}
                onChangeText={onCaption}
                onFocus={() => onEditing(true)}
                onBlur={() => onEditing(false)}
                onSubmitEditing={() => (document.activeElement as HTMLElement | null)?.blur?.()}
                maxLength={80}
                enterKeyHint="done"
                autoComplete="off"
                accessibilityLabel="Legenda"
                style={web({ position: 'absolute', left: 0, top: 0, width: '100%', height: editing ? '100%' : '40%', zIndex: 5, opacity: 0, fontSize: 16, outlineStyle: 'none', caretColor: 'transparent', backgroundColor: 'transparent' })}
              />,
              err ? <Text key="err" accessibilityRole="alert" style={{ position: 'absolute', left: 32, right: 32, top: 24, overflow: 'hidden', borderRadius: 22, backgroundColor: 'rgba(220,38,38,0.9)', paddingHorizontal: 16, paddingVertical: 8, textAlign: 'center', fontSize: 14, fontWeight: '600', color: '#fff' }}>{err}</Text> : null,
            )}
          </View>
        )}
      </View>

      {/* Iluminação de ecrã (câmara da frente, ou sem lanterna, com o flash ligado): o ecrã TODO branco ao tirar.
          Fora do cartão: dentro dele (filter/clip-path) só acendia a forma. */}
      {lit ? dom('div', { 'aria-hidden': true, style: { position: 'fixed', left: 0, top: 0, right: 0, bottom: 0, zIndex: 2147483000, backgroundColor: '#fff', pointerEvents: 'none' } }) : null}

      {/* Em baixo: a lanterna, o obturador e virar a câmara; depois, para quem vai. */}
      {!editing && (
        <View style={{ paddingHorizontal: 24, paddingTop: 16, paddingBottom: Math.max(16, insets.bottom) }}>
          {sentBox}
          <View style={{ alignSelf: 'center', width: '100%', maxWidth: 250, flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1, alignItems: 'center' }}>
            <Pressable onPress={() => setLight((v) => !v)} accessibilityRole="button" accessibilityState={{ selected: light }} accessibilityLabel={canTorch ? 'Lanterna' : 'Flash de ecrã'} style={({ pressed }) => [small, { backgroundColor: light ? '#fcd34d' : 'rgba(255,255,255,0.1)', transform: [{ scale: pressed ? 0.9 : 1 }] }]}>
              <FlashIcon on={light} size={25} />
            </Pressable>
            </View>
            <View style={{ flex: 1, alignItems: 'center' }}>
            <Pressable onPress={press} disabled={!ready || busy} accessibilityRole="button" accessibilityLabel={count !== null ? 'Cancelar' : 'Tirar e enviar'} style={({ pressed }) => [{ width: 86, height: 86, borderRadius: 43, alignItems: 'center', justifyContent: 'center', opacity: !ready || busy ? 0.5 : 1, transform: [{ scale: pressed ? 0.9 : 1 }] }]}>
              <View style={web({ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, borderRadius: 43, padding: 4, backgroundImage: 'conic-gradient(from 200deg, #ff5c5c, #ff9a5b, #ffd166, #ff5c5c)' })}>
                <View style={{ flex: 1, borderRadius: 39, backgroundColor: '#08080b' }} />
              </View>
              <View style={web({ width: 66, height: 66, borderRadius: 33, alignItems: 'center', justifyContent: 'center', backgroundColor: busy ? colors.brand : '#fff', boxShadow: '0 6px 20px rgba(255,92,92,0.45)' })}>
                <Icon name="bolt" size={30} solid color={busy ? '#fff' : colors.brand} />
              </View>
            </Pressable>
            </View>
            <View style={{ flex: 1, alignItems: 'center' }}>
            <Pressable onPress={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))} accessibilityRole="button" accessibilityLabel="Virar câmara" style={({ pressed }) => [small, { backgroundColor: 'rgba(255,255,255,0.1)', transform: [{ scale: pressed ? 0.9 : 1 }] }]}>
              <Icon name="flip-camera" size={25} color="#fff" />
            </Pressable>
            </View>
          </View>
          {/* Para quem vai: amigos (próximos e mútuos) ou só os amigos próximos. */}
          <View accessibilityRole="radiogroup" accessibilityLabel="Para quem vai" style={{ alignSelf: 'center', marginTop: 20, flexDirection: 'row', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.1)', padding: 4 }}>
            {([['friends', 'Amigos'], ['close', 'Próximos']] as const).map(([id, label]) => {
              const on = audience === id;
              return (
                <Pressable key={id} onPress={() => onAudience(id)} accessibilityRole="radio" accessibilityState={{ checked: on }} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 24, paddingVertical: 8, backgroundColor: on ? (id === 'close' ? '#10b981' : '#fff') : 'transparent' }}>
                  {id === 'close' && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: on ? '#fff' : '#34d399' }} />}
                  <Text style={{ fontSize: 14, fontWeight: '700', color: on ? (id === 'close' ? '#fff' : colors.zinc900) : 'rgba(255,255,255,0.7)' }}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}
    </>
  );
}
