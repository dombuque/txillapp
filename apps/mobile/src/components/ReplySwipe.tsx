import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { GestureDetector, GestureStateManager, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { Icon } from '@/components/Icon';
import {
  REPLY_FAIL_X, REPLY_FAIL_Y, REPLY_ICON, REPLY_START_X, REPLY_LOCK_PX,
  fromLeftEdge, replyArmed, replyLock, replyProgress, replyPull,
} from '@/lib/replySwipe';
import { claimSwipe } from '@/lib/swipeClaim';
import { colors } from '@/lib/theme';

/** Onde está a bolha dentro da mensagem (para o ícone ficar à esquerda dela e à altura do meio): x da esquerda, y e altura da linha. */
export type ReplySpot = { x: number; y: number; h: number };

type Props = {
  /** Esta mensagem pode deslizar (lib/replySwipe, canSwipeReply). Desligado, fica tudo como antes. */
  enabled: boolean;
  onReply: () => void;
  spot: ReplySpot | null;
  /** O que não mexe (a margem de cima). */
  style?: StyleProp<ViewStyle>;
  /** O que segue o dedo (o alinhamento, o recuo do avatar, o destaque). */
  innerStyle?: StyleProp<ViewStyle>;
  children: ReactNode;
};

/** O ícone fica à esquerda da bolha e anda a metade do caminho dela: aparece no espaço que a bolha deixa. */
function iconAt(x: number) {
  'worklet';
  return (x - REPLY_ICON) * 0.5;
}
/** O ícone cresce e fica nítido à medida que se aproxima do limiar (e ao passá-lo dá um "pop"). */
function iconScale(p: number) {
  'worklet';
  return 0.55 + 0.45 * p;
}
function iconOpacity(x: number, p: number) {
  'worklet';
  return x <= 0 ? 0 : 0.25 + 0.75 * p;
}

/** App: a bolha volta ao sítio com uma mola curta. */
const BACK = { damping: 18, stiffness: 260, mass: 0.6 };
/** O "pop" do ícone ao passar o limiar. */
const POP = { damping: 12, stiffness: 320, mass: 0.5 };
/** Web: a mesma volta com mola (um pouco de ressalto). */
const BACK_WEB = '280ms cubic-bezier(0.34, 1.36, 0.64, 1)';
const POP_WEB = '160ms cubic-bezier(0.34, 1.56, 0.64, 1)';

function ReplyIcon() {
  return (
    <View style={st.circle}>
      <Icon name="reply" size={18} color={colors.zinc700} strokeWidth={2.2} />
    </View>
  );
}

/** Onde pôr o ícone: à esquerda da bolha, ao meio da linha dela (sem medida ainda, ao meio da mensagem). */
const iconBox = (spot: ReplySpot | null): ViewStyle =>
  spot ? { left: spot.x, top: spot.y + spot.h / 2 - REPLY_ICON / 2 } : { left: 0, top: 0, bottom: 0, justifyContent: 'center' };

/**
 * Deslizar uma mensagem para a direita para lhe responder, como no WhatsApp/Instagram: a mensagem segue o dedo (com
 * resistência, até REPLY_MAX), o ícone de responder aparece à esquerda e fica cheio ao passar o limiar (com um toque
 * háptico no telemóvel); largar depois do limiar responde, antes volta sem responder. A mensagem volta sempre com mola.
 * Os toques lá dentro (hora, brindar, menu, abrir a foto) não mudam: o gesto só começa com um movimento claramente para a direita.
 */
export function ReplySwipe(props: Props) {
  if (Platform.OS === 'web') return <WebReplySwipe {...props} />;
  return <NativeReplySwipe {...props} />;
}

/**
 * Android/iOS: um pan do react-native-gesture-handler 3, como o das linhas com swipe (components/SwipeRow):
 * - só é da mensagem depois de REPLY_START_X pt para a direita; se antes andar REPLY_FAIL_Y pt na vertical é rolar a lista,
 *   e para a esquerda desiste logo (REPLY_FAIL_X);
 * - um toque nunca ativa o pan, por isso o toque, os dois toques e o carregar e segurar chegam intactos ao Pressable;
 * - se o dedo pousar na borda esquerda do ecrã (REPLY_EDGE) falha logo: esse gesto é o voltar do iPhone.
 */
function NativeReplySwipe({ enabled, onReply, spot, style, innerStyle, children }: Props) {
  const x = useSharedValue(0);
  /** 1 = passou o limiar (largar responde). */
  const armed = useSharedValue(0);
  /** 0..1: o "pop" do ícone ao passar o limiar. */
  const pop = useSharedValue(0);
  /** 1 = este gesto nasceu na borda (não mexe). */
  const skip = useSharedValue(0);
  const replyRef = useRef(onReply);
  replyRef.current = onReply;
  const fire = useCallback(() => replyRef.current(), []);
  const buzz = useCallback(() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined); }, []);

  const pan = usePanGesture(useMemo(() => ({
    enabled,
    maxPointers: 1,
    activeOffsetX: REPLY_START_X,
    failOffsetX: -REPLY_FAIL_X,
    failOffsetY: [-REPLY_FAIL_Y, REPLY_FAIL_Y] as [number, number],
    onTouchesDown: (e: { handlerTag: number; allTouches: { absoluteX: number }[] }) => {
      'worklet';
      const t = e.allTouches[0];
      if (t && fromLeftEdge(t.absoluteX)) GestureStateManager.fail(e.handlerTag);
    },
    onActivate: (e: { absoluteX: number; translationX: number }) => {
      'worklet';
      skip.value = fromLeftEdge(e.absoluteX - e.translationX) ? 1 : 0;
      armed.value = 0;
    },
    onUpdate: (e: { translationX: number }) => {
      'worklet';
      if (skip.value) return;
      const to = replyPull(e.translationX - REPLY_START_X);
      x.value = to;
      const on = replyArmed(to) ? 1 : 0;
      if (on !== armed.value) {
        armed.value = on;
        pop.value = on ? withSpring(1, POP) : withTiming(0, { duration: 120 });
        if (on) scheduleOnRN(buzz);
      }
    },
    onDeactivate: (e: { canceled?: boolean }) => {
      'worklet';
      if (!skip.value && !e.canceled && replyArmed(x.value)) scheduleOnRN(fire);
      skip.value = 0;
      armed.value = 0;
      pop.value = withTiming(0, { duration: 160 });
      x.value = withSpring(0, BACK);
    },
  }), [enabled, x, armed, pop, skip, fire, buzz]));

  const front = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const icon = useAnimatedStyle(() => {
    const p = replyProgress(x.value);
    return { opacity: iconOpacity(x.value, p), transform: [{ translateX: iconAt(x.value) }, { scale: iconScale(p) }] };
  });
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 + 0.18 * pop.value }] }));

  return (
    <GestureDetector gesture={pan}>
      <View style={style} collapsable={false}>
        {enabled ? (
          <Animated.View pointerEvents="none" style={[st.icon, iconBox(spot), icon]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            <Animated.View style={popStyle}><ReplyIcon /></Animated.View>
          </Animated.View>
        ) : null}
        <Animated.View style={[innerStyle, front]}>{children}</Animated.View>
      </View>
    </GestureDetector>
  );
}

/** Na web, a ref de uma View do react-native-web é o próprio elemento do DOM. */
const dom = (r: { current: HTMLElement | null }) => r.current;

/**
 * Telemóvel na web (browser/PWA): o mesmo gesto com os toques do DOM, como a WebSwipeRow (components/SwipeRow):
 * - `touch-action: pan-y`: o browser só rola na vertical; para o lado é connosco;
 * - ao fim de REPLY_LOCK_PX decide-se (lib/replySwipe, replyLock): claramente para a direita é da mensagem (a lista não
 *   rola, o toque do Pressable é cancelado e lib/swipeClaim fica a saber); para cima/baixo ou para a esquerda fica tudo
 *   com o browser (rolar, selecionar texto), sem preventDefault;
 * - um gesto que nasce na borda esquerda (REPLY_EDGE) é do Safari (voltar) e não mexe.
 */
function WebReplySwipe({ enabled, onReply, spot, style, innerStyle, children }: Props) {
  const box = useRef<HTMLElement>(null);
  const front = useRef<HTMLElement>(null);
  const icon = useRef<HTMLElement>(null);
  const pop = useRef<HTMLElement>(null);
  const on = useRef({ enabled, onReply });
  on.current = { enabled, onReply };

  useEffect(() => {
    const el = dom(box);
    if (!el) return;
    el.style.touchAction = 'pan-y pinch-zoom';
    let x = 0;
    let armed = false;
    let g: { x0: number; y0: number; mode: 'wait' | 'reply' | 'off' } | null = null;
    let quietUntil = 0;

    const paint = (to: number, animate: boolean) => {
      x = to;
      const fr = dom(front);
      if (fr) {
        fr.style.transition = animate ? `transform ${BACK_WEB}` : 'none';
        fr.style.transform = to ? `translate3d(${to}px, 0, 0)` : '';
      }
      const ic = dom(icon);
      if (ic) {
        const p = replyProgress(to);
        ic.style.transition = animate ? `transform ${BACK_WEB}, opacity 160ms ease-out` : 'none';
        ic.style.opacity = String(iconOpacity(to, p));
        ic.style.transform = `translate3d(${iconAt(to)}px, 0, 0) scale(${iconScale(p)})`;
      }
      const now = replyArmed(to);
      if (now !== armed) {
        armed = now;
        const pp = dom(pop);
        if (pp) {
          pp.style.transition = `transform ${POP_WEB}`;
          pp.style.transform = now ? 'scale(1.18)' : '';
        }
      }
    };
    /** O sistema de toques do react-native-web cancela o toque quando um antepassado faz scroll: sem hora, sem menu, sem abrir. */
    const cancelPress = () => el.dispatchEvent(new Event('scroll'));

    const start = (e: TouchEvent) => {
      g = null;
      if (!on.current.enabled || e.touches.length !== 1) {
        if (x) paint(0, true);
        return;
      }
      const t = e.touches[0];
      if (fromLeftEdge(t.clientX)) return;
      g = { x0: t.clientX, y0: t.clientY, mode: 'wait' };
    };
    const move = (e: TouchEvent) => {
      if (!g || g.mode === 'off') return;
      const t = e.touches[0];
      const dx = t.clientX - g.x0;
      const dy = t.clientY - g.y0;
      if (g.mode === 'wait') {
        const d = replyLock(dx, dy, e.cancelable);
        if (d === 'wait') return;
        if (d === 'off') {
          g.mode = 'off';
          return;
        }
        g.mode = 'reply';
        cancelPress();
        claimSwipe();
      }
      e.preventDefault(); // a lista não rola enquanto a mensagem vai para o lado
      e.stopPropagation();
      paint(replyPull(dx - REPLY_LOCK_PX), false);
    };
    const end = () => {
      const gg = g;
      g = null;
      if (gg?.mode !== 'reply') return;
      quietUntil = Date.now() + 450;
      const go = replyArmed(x);
      paint(0, true);
      if (go) on.current.onReply();
    };
    const cancel = () => {
      if (g?.mode === 'reply') paint(0, true);
      g = null;
    };
    /** Depois de deslizar, o clique que o browser ainda manda não conta como toque. */
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
    };
  }, []);

  return (
    <View ref={box as never} style={style}>
      {enabled ? (
        <View ref={icon as never} pointerEvents="none" style={[st.icon, iconBox(spot), { opacity: 0 }]} aria-hidden>
          <View ref={pop as never}><ReplyIcon /></View>
        </View>
      ) : null}
      <View ref={front as never} style={innerStyle}>{children}</View>
    </View>
  );
}

const st = StyleSheet.create({
  icon: { position: 'absolute', width: REPLY_ICON },
  circle: { width: REPLY_ICON, height: REPLY_ICON, borderRadius: REPLY_ICON / 2, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 3px rgba(24,24,27,0.16)' } as object,
});
