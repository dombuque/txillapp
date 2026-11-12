import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Dimensions, Keyboard, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Modal, iosWeb } from '@/components/Modal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@/lib/theme';
import { useDesktop } from '@/lib/desktop';
import { menuPosition, type Rect } from '@/lib/desktopKeys';
import { useOverlay } from '@/lib/overlays';
import { sheetHeights, sheetViewport } from '@/lib/sheetViewport';
import { Icon } from './Icon';
import { ListReset } from './ListReset';
import { useVisibleViewport } from './zas/useVisibleViewport';

/** Os conteúdos rolantes avisam a folha de onde estão (só se fecha a arrastar quando estão no topo). */
const ScrollCtx = createContext<{ top: React.MutableRefObject<boolean> } | null>(null);
export const useSheetScroll = () => useContext(ScrollCtx);
/** Em que forma está a folha à volta (as linhas de menu ficam compactas no menu pendente do computador). */
const ModeCtx = createContext<SheetMode>('bottom');
export const useSheetMode = () => useContext(ModeCtx);

/**
 * Como a folha aparece no computador (no telemóvel é sempre a folha de baixo):
 * - `dialog` (por omissão): janela ao centro, com o título e o ×;
 * - `menu`: menu pendente junto ao botão «⋯» (ou ao rato, no botão direito), sem escurecer a página. Sem `anchor` é uma
 *   janela ao centro;
 * - `panel`: painel à direita, da altura da janela (comentários).
 */
export type SheetVariant = 'dialog' | 'menu' | 'panel';
export type SheetMode = 'bottom' | SheetVariant;
export const sheetMode = (desktop: boolean, variant: SheetVariant = 'dialog', anchor: Rect | null = null): SheetMode =>
  !desktop ? 'bottom' : variant === 'menu' && !anchor ? 'dialog' : variant;
/** Largura do menu pendente e do painel no computador. */
export const MENU_W = 300;
export const PANEL_W = 460;

/**
 * Folha de baixo igual à do site: cantos de 28, pega de arrastar, título e ×. Puxar para baixo fecha-a
 * (a página por trás não se mexe). `full` ocupa 78% do ecrã (comentários); sem ele ajusta-se ao conteúdo.
 * No computador muda de forma (`variant`, ver SheetVariant), não se arrasta e fecha com Esc, com um clique fora ou no ×.
 * `dark`: a folha escura (fundo #1c1c1e, como o seletor de música por cima do mimo ou do vídeo).
 */
export function Sheet({ title, onClose, children, full = false, plain = false, variant = 'dialog', anchor = null, dark = false }: { title?: string; onClose: () => void; children: ReactNode; full?: boolean; plain?: boolean; variant?: SheetVariant; anchor?: Rect | null; dark?: boolean }) {
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

  // Web (iPhone): o teclado tapa a página sem a encolher. Com ele aberto, a folha vive só na zona visível e a página não rola
  // (como o visor dos mimos e o Zás). No nativo `vv` é null: lá vale o `kb` de cima (o Keyboard da web não dá eventos).
  const vv = useVisibleViewport();
  const box = Platform.OS === 'web' && typeof window !== 'undefined' ? sheetViewport(vv, window.innerHeight, window.innerWidth) : null;
  const heights = sheetHeights(h, box);
  useEffect(() => {
    if (!box || typeof window === 'undefined') return;
    const fix = () => window.scrollTo(0, 0);
    fix();
    window.addEventListener('scroll', fix);
    return () => window.removeEventListener('scroll', fix);
  }, [box?.top, box?.height]); // eslint-disable-line react-hooks/exhaustive-deps

  // No computador a folha abre ao centro, como uma janela (sem a pega de arrastar), ou como menu/painel (variant).
  const desktop = useDesktop();
  const mode = sheetMode(desktop, variant, anchor);
  const win = useWindowDimensions();
  const [menuSize, setMenuSize] = useState<{ w: number; h: number } | null>(null);
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

  const head = title && !plain ? (
    <View style={[styles.head, mode !== 'bottom' && styles.deskHead, mode === 'menu' && styles.menuHead]}>
      <Text style={[styles.title, mode === 'menu' && styles.menuTitle, dark && { color: '#fff' }]} numberOfLines={1}>{title}</Text>
      {mode === 'dialog' || mode === 'panel' ? (
        <Pressable onPress={close} style={(s) => [styles.x, (s as { hovered?: boolean }).hovered && { backgroundColor: dark ? DARK.hover : colors.zinc100 }]} accessibilityRole="button" accessibilityLabel="Fechar" {...({ dataSet: { tip: 'Fechar (Esc)' } } as object)}>
          <Icon name="x" size={20} color={dark ? DARK.icon : colors.zinc700} strokeWidth={2.2} />
        </Pressable>
      ) : null}
    </View>
  ) : null;
  // Computador: o que não cabe na janela (ecrãs baixos, listas compridas) rola com a roda e a barra, em vez de ficar cortado
  // por baixo (a mesma ideia da equipa das Mensagens). No telemóvel fica como estava (lá arrastar para baixo fecha a folha).
  const body = mode !== 'bottom' && !full ? <ScrollView style={styles.deskScroll} keyboardShouldPersistTaps="handled">{children}</ScrollView> : children;

  if (mode === 'menu' && anchor) {
    // Menu pendente: junto ao botão (por baixo e alinhado à direita dele, ou para cima se não couber), sem escurecer a página.
    // Antes de se medir fica fora da janela (sem saltar de sítio).
    const pos = menuSize ? menuPosition(anchor, menuSize, { w: win.width, h: win.height }) : { left: -9999, top: 0 };
    return (
      <Modal transparent visible animationType="none" onRequestClose={close} onWebBack={close} statusBarTranslucent>
        <View style={StyleSheet.absoluteFill}>
          <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Fechar o menu" />
          <Animated.View
            onLayout={(e) => {
              const { width, height } = e.nativeEvent.layout;
              if (!menuSize || Math.abs(menuSize.h - height) > 1 || Math.abs(menuSize.w - width) > 1) setMenuSize({ w: width, h: height });
            }}
            style={[styles.menu, dark && { backgroundColor: DARK.bg, borderColor: DARK.hover }, { left: pos.left, top: pos.top, maxHeight: win.height - 16, opacity: y.interpolate({ inputRange: [0, h * 0.4], outputRange: [1, 0], extrapolate: 'clamp' }) }]}
            accessibilityViewIsModal
            role="menu"
          >
            <ListReset><ModeCtx.Provider value={mode}><ScrollCtx.Provider value={{ top: atTop }}>
              {head}
              {body}
            </ScrollCtx.Provider></ModeCtx.Provider></ListReset>
          </Animated.View>
        </View>
      </Modal>
    );
  }

  if (mode === 'panel') {
    // Painel à direita (comentários): a página fica à vista à esquerda.
    const w = Math.min(PANEL_W, win.width);
    return (
      <Modal transparent visible animationType="none" onRequestClose={close} onWebBack={close} statusBarTranslucent>
        <View style={StyleSheet.absoluteFill}>
          <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: y.interpolate({ inputRange: [0, h], outputRange: [0.25, 0], extrapolate: 'clamp' }) }]} />
          <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Fechar" />
          <Animated.View style={[styles.panel, dark && { backgroundColor: DARK.bg }, { width: w, transform: [{ translateX: y.interpolate({ inputRange: [0, h], outputRange: [0, w], extrapolate: 'clamp' }) }] }]} accessibilityViewIsModal>
            <ListReset><ModeCtx.Provider value={mode}><ScrollCtx.Provider value={{ top: atTop }}>
              {head}
              <View style={{ flex: 1, minHeight: 0 }}>{children}</View>
              {head ? null : (
                // Folha «plain» (desenha o seu título): o × fica no canto do painel.
                <Pressable onPress={close} style={(s) => [styles.x, styles.panelX, (s as { hovered?: boolean }).hovered && { backgroundColor: dark ? DARK.hover : colors.zinc100 }]} accessibilityRole="button" accessibilityLabel="Fechar" {...({ dataSet: { tip: 'Fechar (Esc)' } } as object)}>
                  <Icon name="x" size={20} color={dark ? DARK.icon : colors.zinc700} strokeWidth={2.2} />
                </Pressable>
              )}
            </ScrollCtx.Provider></ModeCtx.Provider></ListReset>
          </Animated.View>
        </View>
      </Modal>
    );
  }

  // «Voltar» do browser fecha a folha (no iPhone sem animar: o arrastar para trás já mostrou o ecrã de baixo).
  return (
    <Modal transparent visible animationType="none" onRequestClose={close} onWebBack={iosWeb ? onClose : close} statusBarTranslucent>
      <View style={[styles.root, box && { position: 'absolute', left: 0, right: 0, top: box.top, height: box.height, flex: 0 }, desktop && { justifyContent: 'center', padding: 24 }]}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: backdrop }]} />
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Fechar" />
        <Animated.View
          {...(desktop ? {} : pan.panHandlers)}
          style={[styles.sheet, dark && { backgroundColor: DARK.bg }, full ? { height: heights.full } : { maxHeight: heights.max }, { paddingBottom: box ? 12 : Math.max(insets.bottom, 16) + (kb ? kb - insets.bottom : 0), transform: [{ translateY: y }] }, desktop && { maxWidth: 540, borderRadius: 24, paddingBottom: 20, transform: [{ translateY: Animated.multiply(y, 0.15) }] }]}
          accessibilityViewIsModal
        >
          <ListReset><ModeCtx.Provider value={mode}><ScrollCtx.Provider value={{ top: atTop }}>
            {desktop ? <View style={{ height: 8 }} /> : <View style={[styles.handle, dark && { backgroundColor: DARK.handle }]} />}
            {head}
            {body}
          </ScrollCtx.Provider></ModeCtx.Provider></ListReset>
        </Animated.View>
      </View>
    </Modal>
  );
}

/** As cores da folha escura. */
export const DARK = { bg: '#1c1c1e', hover: '#2c2c2e', handle: '#5a5a5e', icon: '#e5e5ea' } as const;

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end', alignItems: 'center' },
  sheet: { width: '100%', maxWidth: 576, backgroundColor: colors.white, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 12 },
  handle: { alignSelf: 'center', width: 40, height: 6, borderRadius: 3, backgroundColor: colors.zinc300, marginBottom: 12 },
  head: { paddingHorizontal: 24, marginBottom: 16 },
  title: { fontSize: 20, fontWeight: '700', color: colors.zinc900 },
  deskHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8, paddingRight: 14 },
  menuHead: { paddingHorizontal: 16, paddingTop: 6, marginBottom: 2 },
  menuTitle: { fontSize: 13, fontWeight: '600', color: colors.zinc500 },
  x: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  panelX: { position: 'absolute', right: 12, top: 12 },
  deskScroll: { flexGrow: 0, flexShrink: 1, minHeight: 0 },
  menu: { position: 'absolute', width: MENU_W, backgroundColor: colors.white, borderRadius: 14, paddingVertical: 6, borderWidth: 1, borderColor: colors.zinc100, boxShadow: '0 12px 32px rgba(0,0,0,0.16), 0 2px 6px rgba(0,0,0,0.06)' },
  panel: { position: 'absolute', right: 0, top: 0, bottom: 0, backgroundColor: colors.white, borderTopLeftRadius: 20, borderBottomLeftRadius: 20, paddingTop: 12, boxShadow: '-12px 0 40px rgba(0,0,0,0.16)' },
});
