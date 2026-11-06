import { createElement, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, Text, TextInput, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@/lib/theme';
import { Icon } from '../Icon';
import { acquireCamera, releaseCamera } from './cameraSession';
import { CurvedCaption } from './CurvedCaption';
import { FUN_FX, createFunRenderer, type FunRenderer } from './funFilters';
import { squircle } from './squircle';

/**
 * A câmara ao vivo dos Zás NA WEB (getUserMedia + <video>/<canvas> dentro do React Native Web), igual ao CameraStudio do site:
 * cartão 3:4 squircle com legenda curva, filtros divertidos em WebGL (deslizar para os lados), flash/lanterna, virar câmara,
 * temporizador (a lógica existe como no site; o site não tem botão), obturador com anel degradê e «para quem vai».
 * Só deve ser montado quando Platform.OS === 'web'. Devolve a foto (JPEG) em `onCapture`.
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
  const fxCanvas = useRef<HTMLCanvasElement | null>(null);
  const fxRenderer = useRef<FunRenderer | null>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const countTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const [area, setArea] = useState({ w: 0, h: 0 });
  const [facing, setFacing] = useState<'user' | 'environment'>('environment');
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState(false);
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

  useEffect(() => {
    let dead = false;
    setReady(false);
    setProblem(false);
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('sem câmara');
        const s = await acquireCamera(facing, false, true);
        if (dead) return;
        if (video.current) {
          video.current.srcObject = s;
          await video.current.play().catch(() => undefined);
        }
        const caps = (s.getVideoTracks()[0]?.getCapabilities?.() ?? {}) as { torch?: boolean };
        setCanTorch(!!caps.torch);
        // Se o aparelho não deu 3:4, tenta forçá-lo (evita a imagem cortada dentro da moldura).
        const vt = s.getVideoTracks()[0];
        const st = vt?.getSettings?.();
        if (vt && st?.width && st?.height && Math.abs(Math.min(st.width, st.height) / Math.max(st.width, st.height) - 0.75) > 0.04) {
          vt.applyConstraints({ aspectRatio: 3 / 4 }).catch(() => undefined);
        }
        setLight(false);
        setReady(true);
      } catch {
        if (!dead) setProblem(true);
      }
    })();
    return () => {
      dead = true;
    };
  }, [facing]);
  useEffect(() => () => { releaseCamera(2_000); clearInterval(countTimer.current); }, []);

  async function shoot() {
    const v = video.current;
    if (!v || !ready || !v.videoWidth || busy || shooting) return;
    setShooting(true);
    // Flash ao obturar: lanterna (câmara de trás, se o aparelho deixar) ou ecrã aceso (câmara da frente).
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
    const c = document.createElement('canvas');
    const fxc = fx > 0 && fxCanvas.current && fxCanvas.current.width > 0 ? fxCanvas.current : null;
    if (fxc && fxRenderer.current) fxRenderer.current.render(v, fx, performance.now() / 1000);
    const src: CanvasImageSource = fxc ?? v;
    c.width = fxc ? fxc.width : v.videoWidth;
    c.height = fxc ? fxc.height : v.videoHeight;
    const g = c.getContext('2d')!;
    // Selfie: a foto sai como a viste no ecrã (espelhada).
    if (facing === 'user') {
      g.translate(c.width, 0);
      g.scale(-1, 1);
    }
    g.drawImage(src, 0, 0);
    setLit(false);
    if (torchOn && vtrack) vtrack.applyConstraints({ advanced: [{ torch: false } as MediaTrackConstraintSet] }).catch(() => undefined);
    buzz(15);
    setFlash(true);
    setTimeout(() => setFlash(false), 140);
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

  // Cartão 3:4: até 440 de altura; a editar, ocupa a área toda.
  const padX = editing ? 8 : 32;
  const availW = Math.max(0, area.w - padX * 2);
  const availH = Math.max(0, area.h - 16);
  let ch = editing ? availH : Math.min(440, availH);
  let cw = ch * 0.75;
  if (editing) {
    cw = availW;
    ch = availH;
  } else if (cw > availW) {
    cw = availW;
    ch = cw / 0.75;
  }
  cw = Math.floor(cw);
  ch = Math.floor(ch);
  const mirror = facing === 'user' ? 'scaleX(-1)' : 'none';
  const fill = { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', objectFit: 'cover' };
  const small = { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' } as const;

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
                onTouchStart: (e: TouchEvent) => { swipe.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; },
                onTouchEnd: (e: TouchEvent) => {
                  const s = swipe.current;
                  swipe.current = null;
                  if (!s || editing || !fxOk || !ready) return;
                  const dx = e.changedTouches[0].clientX - s.x;
                  const dy = e.changedTouches[0].clientY - s.y;
                  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
                    buzz(6);
                    cycleFx(dx < 0 ? 1 : -1);
                  }
                },
              },
              dom('video', { ref: video, playsInline: true, muted: true, autoPlay: true, style: { ...fill, transform: mirror, visibility: ready ? 'visible' : 'hidden' } }),
              dom('canvas', { ref: fxCanvas, 'aria-hidden': true, style: { ...fill, transform: mirror, display: fx > 0 ? 'block' : 'none' } }),
              editing && <View key="dim" pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)' }} />,
              ready && fxOk && !editing && (
                <View key="dots" pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 12, zIndex: 10, flexDirection: 'row', justifyContent: 'center', gap: 4 }}>
                  {FUN_FX.map((f) => <View key={f.id} style={{ height: 6, width: fx === f.id ? 16 : 6, borderRadius: 3, backgroundColor: fx === f.id ? '#fff' : 'rgba(255,255,255,0.4)' }} />)}
                </View>
              ),
              lit && <View key="lit" pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, zIndex: 10, backgroundColor: '#fff' }} />,
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
              flash && <View key="flash" pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#fff' }} />,
              <View key="shade" pointerEvents="none" style={web({ position: 'absolute', left: 0, right: 0, bottom: 0, height: 112, backgroundImage: 'linear-gradient(to top, rgba(0,0,0,0.45), transparent)' })} />,
              <CurvedCaption key="cap" w={cw} h={ch} text={caption || 'Adicionar legenda…'} hint={!caption} caret={editing} caretFirst={!caption} />,
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

      {/* Em baixo: a lanterna, o obturador e virar a câmara; depois, para quem vai. */}
      {!editing && (
        <View style={{ paddingHorizontal: 24, paddingTop: 16, paddingBottom: Math.max(16, insets.bottom) }}>
          {sentBox}
          <View style={{ alignSelf: 'center', width: '100%', maxWidth: 250, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Pressable onPress={() => setLight((v) => !v)} accessibilityRole="button" accessibilityState={{ selected: light }} accessibilityLabel={canTorch ? 'Lanterna' : 'Flash de ecrã'} style={({ pressed }) => [small, { backgroundColor: light ? '#fcd34d' : 'rgba(255,255,255,0.1)', transform: [{ scale: pressed ? 0.9 : 1 }] }]}>
              <FlashIcon on={light} size={25} />
            </Pressable>
            <Pressable onPress={press} disabled={!ready || busy} accessibilityRole="button" accessibilityLabel={count !== null ? 'Cancelar' : 'Tirar e enviar'} style={({ pressed }) => [{ width: 86, height: 86, borderRadius: 43, alignItems: 'center', justifyContent: 'center', opacity: !ready || busy ? 0.5 : 1, transform: [{ scale: pressed ? 0.9 : 1 }] }]}>
              <View style={web({ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, borderRadius: 43, padding: 4, backgroundImage: 'conic-gradient(from 200deg, #ff5c5c, #ff9a5b, #ffd166, #ff5c5c)' })}>
                <View style={{ flex: 1, borderRadius: 39, backgroundColor: '#08080b' }} />
              </View>
              <View style={web({ width: 66, height: 66, borderRadius: 33, alignItems: 'center', justifyContent: 'center', backgroundColor: busy ? colors.brand : '#fff', boxShadow: '0 6px 20px rgba(255,92,92,0.45)' })}>
                <Icon name="bolt" size={30} solid color={busy ? '#fff' : colors.brand} />
              </View>
            </Pressable>
            <Pressable onPress={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))} accessibilityRole="button" accessibilityLabel="Virar câmara" style={({ pressed }) => [small, { backgroundColor: 'rgba(255,255,255,0.1)', transform: [{ scale: pressed ? 0.9 : 1 }] }]}>
              <Icon name="flip-camera" size={25} color="#fff" />
            </Pressable>
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
