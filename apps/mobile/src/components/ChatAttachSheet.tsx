import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Animated, Easing, Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Modal } from '@/components/Modal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@/lib/theme';
import { Icon, type IconName } from './Icon';

const nativeDriver = Platform.OS !== 'web';
/** Distância entre o menu e a barra de escrever. */
const GAP = 8;

/**
 * O menu "+" da barra de escrever: um cartão branco com sombra que abre por cima do "+", com uma lista curta
 * (ícone + texto). Fecha ao tocar fora, com o botão de voltar ou ao escolher. Mede a barra no ecrã (`anchor`), por isso
 * fica sempre logo acima dela, também com o teclado aberto; se não couber, a lista rola.
 */
export function ChatAttachMenu({
  anchor, firstName, canGift, once, onClose, onCamera, onLibrary, onPlace, onGift, onToggleOnce,
}: {
  /** A pílula da barra de escrever: o menu alinha-se à direita dela e abre por cima. */
  anchor: RefObject<React.ComponentRef<typeof View> | null>;
  firstName?: string;
  canGift?: boolean;
  once: boolean;
  onClose: () => void;
  onCamera: () => void;
  onLibrary: () => void;
  onPlace: () => void;
  onGift: () => void;
  onToggleOnce: () => void;
}) {
  const insets = useSafeAreaInsets();
  const win = useWindowDimensions();
  const [box, setBox] = useState<{ top: number; right: number } | null>(null);
  const v = useRef(new Animated.Value(0)).current;

  const measure = useCallback(() => {
    anchor.current?.measureInWindow((x, y, w) => {
      // Sem medida (a barra ainda não está no ecrã): encosta-o ao fundo, à direita.
      if (!w && !y) return setBox({ top: win.height - insets.bottom - 64, right: 8 });
      setBox({ top: Math.round(y), right: Math.max(8, Math.round(win.width - (x + w))) });
    });
  }, [anchor, win.width, win.height, insets.bottom]);

  useEffect(() => {
    measure();
    // O teclado a abrir ou a fechar mexe a barra: volta a medir para o menu ficar colado a ela.
    // (Duas vezes: a barra ainda pode estar a acabar de subir ou descer.)
    const timers: ReturnType<typeof setTimeout>[] = [];
    const again = () => { timers.push(setTimeout(measure, 30), setTimeout(measure, 250)); };
    const subs = [Keyboard.addListener('keyboardDidShow', again), Keyboard.addListener('keyboardDidHide', again)];
    return () => { subs.forEach((s) => s.remove()); timers.forEach(clearTimeout); };
  }, [measure]);

  useEffect(() => {
    if (box) Animated.timing(v, { toValue: 1, duration: 150, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver }).start();
  }, [box, v]);

  // No iPhone, a câmara, a galeria e a folha do presente só abrem depois de este menu (um Modal) sair do ecrã.
  const choose = (run: () => void) => () => { onClose(); if (Platform.OS === 'ios') setTimeout(run, 320); else run(); };
  const item = (icon: IconName, label: string, run: () => void, a11y?: string, on?: boolean) => (
    <Pressable
      key={label}
      onPress={choose(run)}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [st.item, (pressed || hovered) && { backgroundColor: colors.zinc100 }]}
      accessibilityRole="menuitem"
      accessibilityState={on === undefined ? undefined : { checked: on }}
      accessibilityLabel={on === undefined ? (a11y ?? label) : `${label}, ${on ? 'ligado' : 'desligado'}. A próxima foto, vídeo ou voz só se abre uma vez.`}
    >
      <Icon name={icon} size={21} color={on ? colors.brand : colors.zinc700} />
      <Text style={st.label} numberOfLines={1}>{label}</Text>
      {on !== undefined && (
        <View style={[st.track, on && { backgroundColor: colors.brand }]} pointerEvents="none">
          <View style={[st.knob, on && { alignSelf: 'flex-end' }]} />
        </View>
      )}
    </Pressable>
  );

  const rise = v.interpolate({ inputRange: [0, 1], outputRange: [8, 0] });
  const scale = v.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] });
  // Espaço entre o topo do ecrã (abaixo da barra de estado) e a barra de escrever: o cartão nunca passa daí.
  const room = box ? Math.max(0, box.top - GAP - insets.top - 8) : 0;

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Fechar o menu" />
      {box && (
        <View pointerEvents="box-none" style={[st.zone, { height: box.top - GAP, paddingTop: insets.top + 8, right: box.right }]}>
          <Animated.View style={[st.card, { maxHeight: room, opacity: v, transform: [{ translateY: rise }, { scale }] }]} accessibilityRole="menu" accessibilityLabel="Partilhar" accessibilityViewIsModal>
            <ScrollView bounces={false} keyboardShouldPersistTaps="handled" contentContainerStyle={st.list}>
              {item('camera', 'Câmara', onCamera, 'Tirar foto ou vídeo com a câmara')}
              {item('image', 'Foto e vídeo', onLibrary, 'Enviar foto ou vídeo da galeria')}
              {item('map-pin', 'Localização', onPlace, 'Localização: escolher o que enviar')}
              {canGift ? item('gift', 'Presente', onGift, `Oferecer Txills${firstName ? ` a ${firstName}` : ''}`) : null}
              {item('once', 'Ver uma vez', onToggleOnce, undefined, once)}
            </ScrollView>
          </Animated.View>
        </View>
      )}
    </Modal>
  );
}

const st = StyleSheet.create({
  // Vai do topo do ecrã até logo acima da barra; o cartão fica encostado ao fundo (por cima do "+").
  zone: { position: 'absolute', top: 0, justifyContent: 'flex-end', alignItems: 'flex-end' },
  card: {
    width: 232,
    borderRadius: 18,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.06)',
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  list: { paddingVertical: 6 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44, paddingHorizontal: 16, paddingVertical: 10 },
  label: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '500', color: colors.zinc900 },
  track: { width: 36, height: 22, borderRadius: 11, backgroundColor: colors.zinc300, padding: 2, justifyContent: 'center' },
  knob: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff' },
});
