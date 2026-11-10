import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import type { SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, { useAnimatedStyle, interpolate, Extrapolation, type SharedValue } from 'react-native-reanimated';
import { Icon, type IconName } from '@/components/Icon';
import { useDesktop } from '@/lib/desktop';
import { claimSwipe, navSwipeThreshold, releaseSwipe } from '@/lib/swipeClaim';
import { colors } from '@/lib/theme';

export interface SwipeAction {
  label: string;
  icon: IconName;
  /** Cor do fundo do botão (o texto e o ícone são brancos). */
  color: string;
  onPress: () => void;
}

const W = 84;
/** Web: depois de quantos px se decide se o gesto é para o lado (linha) ou para cima/baixo (rolar a lista). */
const LOCK_PX = 10;
/** Web: para ser da linha, |dx| tem de ser pelo menos 1,5 vezes |dy|; senão é rolar e a linha não mexe. */
const LOCK_RATIO = 1.5;
/** O mesmo rácio que lib/swipeTabs pede para mudar de menu: a linha só larga o gesto se ele servir para isso. */
const NAV_RATIO = 1.8;
/** Web: ao largar, a posição conta com a velocidade deste tempo (ms) à frente, para um deslize curto e rápido abrir a linha. */
const FLING_MS = 120;
/** Web: tempo da animação de abrir/fechar a linha. */
const SETTLE = '220ms cubic-bezier(0.2, 0.8, 0.2, 1)';

function Buttons({ actions }: { actions: SwipeAction[] }) {
  return (
    <>
      {actions.map((a) => (
        <Pressable key={a.label} onPress={a.onPress} style={({ pressed }) => [st.action, { backgroundColor: a.color }, pressed && { opacity: 0.85 }]} accessibilityRole="button" accessibilityLabel={a.label}>
          <Icon name={a.icon} size={22} color="#fff" />
          <Text style={st.actionText} numberOfLines={1}>{a.label}</Text>
        </Pressable>
      ))}
    </>
  );
}

function ActionButtons({ actions, side, progress }: { actions: SwipeAction[]; side: 'left' | 'right'; progress: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({ opacity: interpolate(progress.value, [0, 0.6, 1], [0, 0.8, 1], Extrapolation.CLAMP) }));
  return (
    <Animated.View style={[{ flexDirection: 'row', width: W * actions.length }, side === 'left' ? { justifyContent: 'flex-start' } : { justifyContent: 'flex-end' }, style]}>
      <Buttons actions={actions} />
    </Animated.View>
  );
}

/** A linha que está aberta agora: só uma de cada vez (abrir outra fecha esta, como no WhatsApp). */
let openRow: { close(): void } | null = null;
/** Fechar a linha aberta (ex.: quando a lista começa a rolar). */
export function closeOpenSwipe() {
  openRow?.close();
  openRow = null;
}

type RowGesture = {
  x0: number;
  y0: number;
  /** Onde a linha estava quando o dedo pousou (0 fechada, +largura com `left` à vista, -largura com `right`). */
  base: number;
  /** wait: ainda não se sabe; row: a linha segue o dedo; nav: passou o limite, é de mudar de menu; free: para o lado mas sem ações desse lado; off: rolar. */
  mode: 'wait' | 'row' | 'nav' | 'free' | 'off';
  pts: { x: number; t: number }[];
};

/** Na web, a ref de uma View do react-native-web é o próprio elemento do DOM. */
const dom = (r: { current: HTMLElement | null }) => r.current;

/**
 * Telemóvel na web (browser/PWA). O gesto é nosso, com toques do DOM, para combinar com a navegação entre separadores
 * (lib/swipeTabs) através de lib/swipeClaim:
 * - deslize pequeno para o lado (até navSwipeThreshold) é da linha: segue o dedo, abre ou fecha ao largar;
 * - se o dedo passar esse limite, a linha volta ao sítio e o gesto passa a ser de mudar de menu;
 * - para cima/baixo é rolar a lista e a linha não mexe; enquanto a linha mexe a lista não rola;
 * - tocar abre a conversa; um deslize nunca a abre; tocar numa linha com outra aberta só fecha essa.
 */
function WebSwipeRow({ left, right, children }: { left: SwipeAction[]; right: SwipeAction[]; children: ReactNode }) {
  const box = useRef<HTMLElement>(null);
  const front = useRef<HTMLElement>(null);
  const paneL = useRef<HTMLElement>(null);
  const paneR = useRef<HTMLElement>(null);
  const widths = useRef({ l: 0, r: 0 });
  widths.current = { l: W * left.length, r: W * right.length };
  const closeMe = useRef<() => void>(() => {});

  useEffect(() => {
    const el = dom(box);
    if (!el) return;
    el.style.touchAction = 'pan-y'; // o browser só rola na vertical; para o lado é connosco
    let x = 0;
    let g: RowGesture | null = null;
    let quietUntil = 0;
    const quiet = () => { quietUntil = Date.now() + 450; };

    const paint = (to: number, animate: boolean) => {
      x = to;
      const { l, r } = widths.current;
      const fr = dom(front);
      if (fr) {
        fr.style.transition = animate ? `transform ${SETTLE}` : 'none';
        fr.style.transform = to ? `translate3d(${to}px, 0, 0)` : '';
      }
      const fade = (p: HTMLElement | null, v: number, w: number) => {
        if (!p) return;
        p.style.transition = animate ? `opacity ${SETTLE}` : 'none';
        p.style.opacity = v > 0 && w ? String(Math.min(1, v / (w * 0.6))) : '0';
      };
      fade(dom(paneL), to, l);
      fade(dom(paneR), -to, r);
    };
    const me = { close: () => settle(0) };
    const settle = (to: number) => {
      paint(to, true);
      if (to) {
        if (openRow && openRow !== me) openRow.close();
        openRow = me;
      } else if (openRow === me) openRow = null;
    };
    closeMe.current = () => settle(0);
    /** Até à largura das ações segue o dedo; depois disso custa mais (e para um lado sem ações não sai do sítio). */
    const resist = (v: number) => {
      const { l, r } = widths.current;
      if (v > l) return l ? l + (v - l) * 0.3 : 0;
      if (v < -r) return r ? -r - (-r - v) * 0.3 : 0;
      return v;
    };
    /** O toque deixa de ser um "toque" para o Pressable lá dentro (sem cinzento ao arrastar, e não abre a conversa).
     * O sistema de toques do react-native-web cancela o toque quando um antepassado faz scroll; é esse o sinal. */
    const cancelPress = () => el.dispatchEvent(new Event('scroll'));
    const speed = (pts: RowGesture['pts']) => {
      const a = pts[0];
      const b = pts[pts.length - 1];
      if (!a || !b || b.t - a.t <= 0 || Date.now() - b.t > 100) return 0;
      return (b.x - a.x) / (b.t - a.t);
    };

    const start = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        if (g?.mode === 'row') settle(0);
        g = null;
        return;
      }
      const t = e.touches[0];
      g = { x0: t.clientX, y0: t.clientY, base: x, mode: 'wait', pts: [{ x: t.clientX, t: Date.now() }] };
    };
    const move = (e: TouchEvent) => {
      if (!g || g.mode === 'off' || g.mode === 'free') return;
      const t = e.touches[0];
      const dx = t.clientX - g.x0;
      const dy = t.clientY - g.y0;
      if (g.mode === 'wait') {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < LOCK_PX) return;
        // Não cancelável = o browser já começou a rolar: é rolar, mesmo que o dedo tenha ido um pouco para o lado.
        if (Math.abs(dx) <= Math.abs(dy) * LOCK_RATIO || !e.cancelable) {
          g.mode = 'off'; // rolar: fica com o browser, e fecha a linha que estiver aberta
          closeOpenSwipe();
          return;
        }
        cancelPress();
        const { l, r } = widths.current;
        if (g.base === 0 && !(dx > 0 ? l : r)) {
          g.mode = 'free'; // sem ações para esse lado: a linha não mexe e o gesto fica para a navegação
          return;
        }
        g.mode = 'row';
        claimSwipe();
        if (openRow && openRow !== me) closeOpenSwipe();
      }
      e.preventDefault(); // a lista não rola enquanto o gesto é para o lado
      e.stopPropagation(); // nem o "puxar para atualizar" o vê
      if (g.mode === 'nav') return;
      if (Math.abs(dx) >= navSwipeThreshold() && Math.abs(dx) >= Math.abs(dy) * NAV_RATIO) {
        g.mode = 'nav';
        releaseSwipe(); // lib/swipeTabs muda de menu ao largar
        settle(0);
        return;
      }
      const now = Date.now();
      g.pts.push({ x: t.clientX, t: now });
      while (g.pts.length > 2 && now - g.pts[0].t > 100) g.pts.shift();
      paint(resist(g.base + dx), false);
    };
    const end = (e: TouchEvent) => {
      const gg = g;
      g = null;
      if (!gg) return;
      if (gg.mode === 'row') {
        quiet();
        const { l, r } = widths.current;
        const proj = x + speed(gg.pts) * FLING_MS;
        const want = l && proj >= l * 0.5 ? l : r && proj <= -r * 0.5 ? -r : 0;
        // Estava aberta para um lado e o gesto foi para o outro: primeiro fecha (a não ser que já tenha passado para lá).
        settle(gg.base && want && Math.sign(want) !== Math.sign(gg.base) && Math.sign(x) !== Math.sign(want) ? 0 : want);
      } else if (gg.mode === 'nav' || gg.mode === 'free') {
        quiet();
      } else if (gg.mode === 'wait') {
        // Um toque com uma linha aberta fecha-a em vez de abrir a conversa (nesta linha, os botões das ações funcionam).
        if (openRow && openRow !== me) {
          quiet();
          closeOpenSwipe();
        } else if (x !== 0 && dom(front)?.contains(e.target as Node)) {
          quiet();
          settle(0);
        }
      }
    };
    const cancel = () => {
      if (g?.mode === 'row') {
        const { l, r } = widths.current;
        settle(l && x >= W * 0.6 ? l : r && x <= -W * 0.6 ? -r : 0);
      }
      g = null;
    };
    const swallow = (e: MouseEvent) => {
      if (Date.now() < quietUntil) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', cancel);
    el.addEventListener('click', swallow, true);
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', cancel);
      el.removeEventListener('click', swallow, true);
      if (openRow === me) openRow = null;
    };
  }, []);

  const run = (a: SwipeAction): SwipeAction => ({ ...a, onPress: () => { closeMe.current(); a.onPress(); } });
  return (
    <View ref={box as never} style={st.web}>
      {left.length ? <View ref={paneL as never} style={[st.pane, { left: 0 }]}><Buttons actions={left.map(run)} /></View> : null}
      {right.length ? <View ref={paneR as never} style={[st.pane, { right: 0 }]}><Buttons actions={right.map(run)} /></View> : null}
      <View ref={front as never} style={{ backgroundColor: '#fff' }}>{children}</View>
    </View>
  );
}

/**
 * Uma linha de lista com ações escondidas, como no WhatsApp:
 * - telemóvel: deslizar para a direita mostra `left`, para a esquerda mostra `right`;
 * - computador: as mesmas ações aparecem como botões pequenos ao passar o rato.
 * Tocar numa ação fecha a linha antes de a correr.
 */
export function SwipeRow({ left = [], right = [], children }: { left?: SwipeAction[]; right?: SwipeAction[]; children: ReactNode }) {
  const desktop = useDesktop();
  const ref = useRef<SwipeableMethods>(null);
  const [hover, setHover] = useState(false);
  const run = (a: SwipeAction) => () => { ref.current?.close(); a.onPress(); };

  if (desktop && Platform.OS === 'web') {
    const all = [...left, ...right];
    return (
      <View
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{ position: 'relative' }}
      >
        {children}
        {hover && all.length ? (
          <View style={st.hoverBar}>
            {all.map((a) => (
              <Pressable key={a.label} onPress={a.onPress} style={({ pressed }) => [st.hoverBtn, pressed && { backgroundColor: colors.zinc200 }]} accessibilityRole="button" accessibilityLabel={a.label}>
                <Icon name={a.icon} size={18} color={a.color === colors.red600 ? colors.red600 : colors.zinc800} />
                <Text style={[st.hoverText, a.color === colors.red600 && { color: colors.red600 }]}>{a.label}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
    );
  }

  if (Platform.OS === 'web') return <WebSwipeRow left={left} right={right}>{children}</WebSwipeRow>;

  return (
    <ReanimatedSwipeable
      ref={ref}
      friction={2}
      leftThreshold={W * 0.6}
      rightThreshold={W * 0.6}
      overshootLeft={false}
      overshootRight={false}
      // Só começa depois de um arrasto claramente horizontal: rolar a lista não abre linhas por engano.
      dragOffsetFromLeft={28}
      dragOffsetFromRight={28}
      onSwipeableWillOpen={() => {
        if (openRow && openRow !== ref.current) openRow.close();
        openRow = ref.current;
      }}
      onSwipeableClose={() => { if (openRow === ref.current) openRow = null; }}
      renderLeftActions={left.length ? (p) => <ActionButtons actions={left.map((a) => ({ ...a, onPress: run(a) }))} side="left" progress={p} /> : undefined}
      renderRightActions={right.length ? (p) => <ActionButtons actions={right.map((a) => ({ ...a, onPress: run(a) }))} side="right" progress={p} /> : undefined}
      childrenContainerStyle={{ backgroundColor: '#fff' }}
    >
      {children}
    </ReanimatedSwipeable>
  );
}

const st = StyleSheet.create({
  action: { width: W, alignItems: 'center', justifyContent: 'center', gap: 4 },
  actionText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  web: { position: 'relative', overflow: 'hidden' },
  pane: { position: 'absolute', top: 0, bottom: 0, flexDirection: 'row', opacity: 0 },
  hoverBar: { position: 'absolute', right: 72, top: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 6 },
  hoverBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 12, borderRadius: 17, backgroundColor: colors.zinc100, boxShadow: '0 1px 4px rgba(0,0,0,0.12)' } as object,
  hoverText: { fontSize: 13, fontWeight: '600', color: colors.zinc800 },
});
