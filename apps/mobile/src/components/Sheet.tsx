import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Dimensions, Keyboard, PanResponder, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Modal, iosWeb } from '@/components/Modal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@/lib/theme';
import { useDesktop } from '@/lib/desktop';
import { useOverlay } from '@/lib/overlays';

/** Os conteúdos rolantes avisam a folha de onde estão (só se fecha a arrastar quando estão no topo). */
const ScrollCtx = createContext<{ top: React.MutableRefObject<boolean> } | null>(null);
export const useSheetScroll = () => useContext(ScrollCtx);

/**
 * Folha de baixo igual à do site: cantos de 28, pega de arrastar, título e ×. Puxar para baixo fecha-a
 * (a página por trás não se mexe). `full` ocupa 78% do ecrã (comentários); sem ele ajusta-se ao conteúdo.
 */
export function Sheet({ title, onClose, children, full = false, plain = false }: { title?: string; onClose: () => void; children: ReactNode; full?: boolean; plain?: boolean }) {
  const insets = useSafeAreaInsets();
  const h = Dimensions.get('window').height;
  const y = useRef(new Animated.Value(h)).current;
  const atTop = useRef(true);
  const [kb, setKb] = useState(0);
  // Enquanto está aberta, os avisos "de tempos a tempos" (lib/overlays) esperam.
  useOverlay();

  useEffect(() => {
    Animated.timing(y, { toValue: 0, duration: 230, useNativeDriver: Platform.OS !== 'web' }).start();
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e) => setKb(e.endCoordinates.height));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKb(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [y]);

  // No computador a folha abre ao centro, como uma janela (sem a pega de arrastar).
  const desktop = useDesktop();
  const close = () => Animated.timing(y, { toValue: h, duration: 180, useNativeDriver: Platform.OS !== 'web' }).start(() => onClose());

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (e, g) => {
        if (!(g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx) * 1.4 && atTop.current)) return false;
        // Na web: se o dedo começou numa lista que já está rolada, o gesto é da lista (senão a folha seguia o dedo e fechava-se).
        if (Platform.OS === 'web') {
          let n = (e.nativeEvent as unknown as { target?: HTMLElement | null }).target ?? null;
          for (let k = 0; n && k < 30; k++, n = n.parentElement) if (n.scrollTop > 0) return false;
        }
        return true;
      },
      onPanResponderMove: (_e, g) => y.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_e, g) => {
        if (g.dy > 120 || g.vy > 0.9) close();
        else Animated.spring(y, { toValue: 0, useNativeDriver: Platform.OS !== 'web', bounciness: 0 }).start();
      },
      // A lista tirou-nos o gesto a meio: a folha volta ao lugar.
      onPanResponderTerminate: () => Animated.spring(y, { toValue: 0, useNativeDriver: Platform.OS !== 'web', bounciness: 0 }).start(),
    }),
  ).current;

  const backdrop = y.interpolate({ inputRange: [0, h], outputRange: [0.4, 0], extrapolate: 'clamp' });

  // «Voltar» do browser fecha a folha (no iPhone sem animar: o arrastar para trás já mostrou o ecrã de baixo).
  return (
    <Modal transparent visible animationType="none" onRequestClose={close} onWebBack={iosWeb ? onClose : close} statusBarTranslucent>
      <View style={[styles.root, desktop && { justifyContent: 'center', padding: 24 }]}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: backdrop }]} />
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Fechar" />
        <Animated.View
          {...(desktop ? {} : pan.panHandlers)}
          style={[styles.sheet, full ? { height: Math.round(h * 0.78) } : { maxHeight: Math.round(h * 0.85) }, { paddingBottom: Math.max(insets.bottom, 16) + (kb ? kb - insets.bottom : 0), transform: [{ translateY: y }] }, desktop && { maxWidth: 540, borderRadius: 24, paddingBottom: 20, transform: [{ translateY: Animated.multiply(y, 0.15) }] }]}
          accessibilityViewIsModal
        >
          <ScrollCtx.Provider value={{ top: atTop }}>
            {desktop ? <View style={{ height: 8 }} /> : <View style={styles.handle} />}
            {title && !plain ? (
              <View style={styles.head}>
                <Text style={styles.title}>{title}</Text>
              </View>
            ) : null}
            {children}
          </ScrollCtx.Provider>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end', alignItems: 'center' },
  sheet: { width: '100%', maxWidth: 576, backgroundColor: colors.white, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 12 },
  handle: { alignSelf: 'center', width: 40, height: 6, borderRadius: 3, backgroundColor: colors.zinc300, marginBottom: 12 },
  head: { paddingHorizontal: 24, marginBottom: 16 },
  title: { fontSize: 20, fontWeight: '700', color: colors.zinc900 },
});
